/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { Schema, Slice, type Node as DocumentNode, type MarkType } from "prosemirror-model";
import { AllSelection, EditorState, Plugin, PluginKey, TextSelection, type Command } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView, type NodeView } from "prosemirror-view";
import { defaultMarkdownParser, defaultMarkdownSerializer, MarkdownParser, MarkdownSerializer } from "prosemirror-markdown";
import { baseKeymap, chainCommands, createParagraphNear, exitCode, liftEmptyBlock, newlineInCode, splitBlock, toggleMark } from "prosemirror-commands";
import { closeHistory, history, redo, undo } from "prosemirror-history";
import { InputRule, inputRules, textblockTypeInputRule, undoInputRule, wrappingInputRule } from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import { liftListItem, sinkListItem, splitListItem } from "prosemirror-schema-list";
import { highlightCode, normalizeCodeLanguage } from "../../shared/codeLanguages";
import type { MentionItem } from "../types";

export interface ComposerCodeBlock {
  id: string;
  /** Non-editable toolbar mount, outside the editable code content. */
  element: HTMLElement;
  language: string;
  code: string;
}

interface ComposerEditorOptions {
  onChange: () => void;
  createMention: (mention: MentionItem) => HTMLElement;
  onCodeBlocks: (blocks: ComposerCodeBlock[]) => void;
  submitWithCtrlEnter?: () => boolean;
  onSubmit?: () => void;
  /** Allows suggestion menus to own Enter, Tab, Escape and arrow keys. */
  shouldHandleKeys?: () => boolean;
}

let codeId = 0;
const newCodeId = () => `composer-code-${++codeId}`;
const escapeAttribute = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const decodeAttribute = (value: string) => value.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

const basicSchema = defaultMarkdownParser.schema;
let nodes = basicSchema.spec.nodes
  .update("paragraph", { ...basicSchema.nodes.paragraph.spec, toDOM: () => ["p", { dir: "auto" }, 0] })
  .update("heading", { ...basicSchema.nodes.heading.spec, content: "inline*", toDOM: node => [`h${node.attrs.level}`, { dir: "auto" }, 0] })
  .update("blockquote", { ...basicSchema.nodes.blockquote.spec, toDOM: () => ["blockquote", { dir: "auto" }, 0] })
  .update("list_item", {
    ...basicSchema.nodes.list_item.spec,
    attrs: { checked: { default: null } },
    parseDOM: [{ tag: "li", getAttrs: element => ({ checked: element.hasAttribute("data-checked") ? element.getAttribute("data-checked") === "true" : null }) }],
    toDOM: node => ["li", node.attrs.checked == null ? {} : { class: "composer-task-item", "data-checked": String(node.attrs.checked) }, 0],
  })
  .update("code_block", {
    ...basicSchema.nodes.code_block.spec,
    attrs: { language: { default: "auto" }, id: { default: null }, inputFence: { default: null } },
    parseDOM: [{ tag: "pre", preserveWhitespace: "full", getAttrs: element => ({
      language: element.getAttribute("data-language") || element.querySelector("code")?.getAttribute("data-language") || "auto",
      id: newCodeId(),
    }) }],
    toDOM: node => ["pre", { dir: "ltr", "data-language": node.attrs.language }, ["code", 0]],
  });
nodes = nodes.addBefore("text", "mention", {
  group: "inline", inline: true, atom: true, selectable: true,
  attrs: { kind: { default: "file" }, name: { default: "" }, path: { default: "" } },
  parseDOM: [{ tag: "span.mention", getAttrs: element => ({
    kind: element.getAttribute("data-kind") || "file", name: element.getAttribute("data-name") || "", path: element.getAttribute("data-path") || "",
  }) }],
  toDOM: node => ["span", { class: "mention", "data-kind": node.attrs.kind, "data-name": node.attrs.name, "data-path": node.attrs.path, contenteditable: "false" }, node.attrs.name],
});
nodes = nodes.append({
  table: { content: "table_row+", group: "block", isolating: true, parseDOM: [{ tag: "table" }], toDOM: () => ["table", ["tbody", 0]] },
  table_row: { content: "(table_header | table_cell)+", parseDOM: [{ tag: "tr" }], toDOM: () => ["tr", 0] },
  table_header: {
    content: "inline*", isolating: true, attrs: { align: { default: null } },
    parseDOM: [{ tag: "th", getAttrs: element => ({ align: element.style.textAlign || null }) }],
    toDOM: node => ["th", { dir: "auto", style: node.attrs.align ? `text-align: ${node.attrs.align}` : null }, 0],
  },
  table_cell: {
    content: "inline*", isolating: true, attrs: { align: { default: null } },
    parseDOM: [{ tag: "td", getAttrs: element => ({ align: element.style.textAlign || null }) }],
    toDOM: node => ["td", { dir: "auto", style: node.attrs.align ? `text-align: ${node.attrs.align}` : null }, 0],
  },
});

const schema = new Schema({ nodes, marks: basicSchema.spec.marks.addToEnd("strike", {
  parseDOM: [{ tag: "s" }, { tag: "del" }], toDOM: () => ["s", 0],
}) });

// Use a separate tokenizer so custom context tokens never alter other Markdown parsers.
const tokenizer = new (defaultMarkdownParser.tokenizer.constructor as new (preset: string, options: { html: boolean }) => typeof defaultMarkdownParser.tokenizer)("commonmark", { html: false });
tokenizer.enable(["strikethrough", "table"]);
interface InlineTokenState {
  src: string; pos: number;
  push: (type: string, tag: string, nesting: -1 | 0 | 1) => { attrSet: (name: string, value: string) => void };
}
tokenizer.inline.ruler.before("html_inline", "attached_mention", (state: InlineTokenState, silent: boolean) => {
  if (!state.src.startsWith("<attached ", state.pos)) return false;
  const match = /^<attached\s+((?:[\w-]+\s*=\s*"[^"]*"\s*)+)\/?>/.exec(state.src.slice(state.pos));
  if (!match) return false;
  const attrs: Record<string, string> = {};
  for (const item of match[1].matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) attrs[item[1]] = decodeAttribute(item[2]);
  if (attrs.content == null) return false;
  if (!silent) {
    const token = state.push("attached_mention", "", 0);
    token.attrSet("kind", attrs.type || "file");
    token.attrSet("name", attrs.title || attrs.content);
    token.attrSet("path", attrs.content);
  }
  state.pos += match[0].length;
  return true;
});

const parser = new MarkdownParser(schema, tokenizer, {
  ...defaultMarkdownParser.tokens,
  code_block: { block: "code_block", noCloseToken: true, getAttrs: () => ({ language: "auto", id: newCodeId() }) },
  fence: { block: "code_block", noCloseToken: true, getAttrs: token => ({ language: token.info.trim() || "auto", id: newCodeId() }) },
  softbreak: { node: "hard_break" },
  attached_mention: { node: "mention", getAttrs: token => ({ kind: token.attrGet("kind"), name: token.attrGet("name"), path: token.attrGet("path") }) },
  s: { mark: "strike" },
  list_item: { block: "list_item", getAttrs: (_token, tokens, index) => {
    const inline = tokens[index + 2];
    const first = inline?.type === "inline" ? inline.children?.[0] : undefined;
    const task = first?.type === "text" ? /^\[([ xX])\]\s+/.exec(first.content) : null;
    if (!task || !first) return { checked: null };
    first.content = first.content.slice(task[0].length);
    return { checked: task[1] !== " " };
  } },
  table: { block: "table" }, thead: { ignore: true }, tbody: { ignore: true }, tr: { block: "table_row" },
  th: { block: "table_header", getAttrs: token => ({ align: /^text-align:(left|center|right)$/.exec(token.attrGet("style") || "")?.[1] || null }) },
  td: { block: "table_cell", getAttrs: token => ({ align: /^text-align:(left|center|right)$/.exec(token.attrGet("style") || "")?.[1] || null }) },
});

const serializer = new MarkdownSerializer({
  ...defaultMarkdownSerializer.nodes,
  code_block(state, node) {
    let longest = 2;
    for (const match of node.textContent.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
    const fence = "`".repeat(longest + 1);
    state.write(`${fence}${node.attrs.language === "auto" ? "" : node.attrs.language}\n`);
    state.text(node.textContent, false);
    state.write(`\n${fence}`);
    state.closeBlock(node);
  },
  mention(state, node) {
    state.write(`<attached type="${escapeAttribute(node.attrs.kind)}" title="${escapeAttribute(node.attrs.name)}" content="${escapeAttribute(node.attrs.path)}" />`);
  },
  hard_break(state) { state.write("\n"); },
  list_item(state, node) {
    if (node.attrs.checked != null) state.write(node.attrs.checked ? "[x] " : "[ ] ");
    state.renderContent(node);
  },
  table(state, node) {
    node.forEach((row, _offset, rowIndex) => {
      const cells: string[] = [];
      row.forEach(cell => {
        const paragraph = schema.nodes.paragraph.create(null, cell.content);
        const text = serializer.serialize(schema.nodes.doc.create(null, paragraph));
        cells.push(text.replace(/(?<!\\)\|/g, "\\|"));
      });
      state.write(`| ${cells.join(" | ")} |\n`);
      if (rowIndex === 0) {
        const separators: string[] = [];
        row.forEach(cell => separators.push(cell.attrs.align === "center" ? ":---:" : cell.attrs.align === "right" ? "---:" : cell.attrs.align === "left" ? ":---" : "---"));
        state.write(`| ${separators.join(" | ")} |\n`);
      }
    });
    state.closeBlock(node);
  },
}, { ...defaultMarkdownSerializer.marks, strike: { open: "~~", close: "~~", mixable: true, expelEnclosingWhitespace: true } }, { escapeExtraCharacters: /[<|]/g });

function markRule(pattern: RegExp, mark: MarkType): InputRule {
  return new InputRule(pattern, (state, match, start, end) => {
    const content = match[1];
    return state.tr.delete(start, end).insertText(content, start).addMark(start, start + content.length, mark.create()).removeStoredMark(mark);
  }, { inCodeMark: false });
}

const fencePattern = /^ {0,3}(`{3,}|~{3,})([\w+#.-]*)[ \t]*$/;

/** All newline shortcuts use the same fence handling before inserting a line. */
const openCodeFence: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type !== schema.nodes.paragraph || $from.parentOffset !== $from.parent.content.size) return false;
  const fence = fencePattern.exec($from.parent.textContent);
  if (!fence) return false;
  const position = $from.before();
  const transaction = closeHistory(state.tr).delete($from.start(), $from.end());
  transaction.setNodeMarkup(position, schema.nodes.code_block, { language: fence[2] || "auto", id: newCodeId(), inputFence: fence[1] });
  transaction.setSelection(TextSelection.create(transaction.doc, position + 1));
  dispatch?.(transaction);
  return true;
};

const closeCodeFence: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  const opening = $from.parent.attrs.inputFence as string | null;
  if (!empty || $from.parent.type !== schema.nodes.code_block || !opening || $from.parentOffset !== $from.parent.content.size) return false;
  const text = $from.parent.textContent;
  const lineStart = text.lastIndexOf("\n") + 1;
  const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(text.slice(lineStart));
  if (!closing || closing[1][0] !== opening[0] || closing[1].length < opening.length) return false;
  const transaction = closeHistory(state.tr).delete($from.start() + Math.max(0, lineStart - 1), $from.end());
  transaction.setNodeMarkup($from.before(), undefined, { ...$from.parent.attrs, inputFence: null });
  const after = transaction.selection.$from.after();
  transaction.insert(after, schema.nodes.paragraph.create());
  transaction.setSelection(TextSelection.create(transaction.doc, after + 1));
  dispatch?.(transaction);
  return true;
};

function paragraphBesideCode(state: EditorState, position: number, direction: -1 | 1, dispatch?: (transaction: EditorState["tr"]) => void): boolean {
  const code = state.doc.nodeAt(position);
  if (code?.type !== schema.nodes.code_block) return false;
  const $position = state.doc.resolve(position);
  const index = $position.index() + (direction < 0 ? -1 : 1);
  const neighbor = index >= 0 && index < $position.parent.childCount ? $position.parent.child(index) : null;
  const boundary = direction < 0 ? position : position + code.nodeSize;
  if (neighbor?.isTextblock && !neighbor.type.spec.code) {
    dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, boundary + direction)).scrollIntoView());
    return true;
  }
  const insertionIndex = $position.index() + (direction < 0 ? 0 : 1);
  if (!$position.parent.canReplaceWith(insertionIndex, insertionIndex, schema.nodes.paragraph)) return false;
  const transaction = closeHistory(state.tr).insert(boundary, schema.nodes.paragraph.create());
  transaction.setSelection(TextSelection.create(transaction.doc, boundary + 1));
  dispatch?.(transaction.scrollIntoView());
  return true;
}

function leaveCodeBoundary(direction: -1 | 1, vertical: boolean): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection;
    if (!empty || $from.parent.type !== schema.nodes.code_block) return false;
    const offset = $from.parentOffset;
    const text = $from.parent.textContent;
    const boundary = direction < 0
      ? vertical ? !text.slice(0, offset).includes("\n") : offset === 0
      : vertical ? !text.slice(offset).includes("\n") : offset === text.length;
    return boundary && paragraphBesideCode(state, $from.before(), direction, dispatch);
  };
}

const clearCodeBlock: Command = (state, dispatch) => {
  const { $from, $to, empty } = state.selection;
  if ($from.parent.type !== schema.nodes.code_block || !$from.sameParent($to)) return false;
  const wholeDraft = state.doc.childCount === 1 && $from.depth === 1 && $from.parentOffset === 0 && $to.parentOffset === $from.parent.content.size;
  // Native Select All can cover only the code's contents, especially when its
  // toolbar is non-editable. Clearing that sole block must leave a usable line.
  if ($from.parent.content.size !== 0 && (empty || !wholeDraft)) return false;
  const position = $from.before();
  const transaction = closeHistory(state.tr).replaceWith(position, $from.after(), schema.nodes.paragraph.create());
  transaction.setSelection(TextSelection.create(transaction.doc, position + 1));
  dispatch?.(transaction.scrollIntoView());
  return true;
};

const highlightKey = new PluginKey<DecorationSet>("composer-code-highlights");
interface CodeView { node: DocumentNode; element: HTMLElement; getPos: () => number | undefined }

/** Owns the editable document; React owns only the surrounding controls and code toolbars. */
export class ComposerEditor {
  private readonly view: EditorView;
  private readonly codeViews = new Map<string, CodeView>();
  private destroyed = false;
  private flushing = false;
  private highlightTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly plugins: Plugin[];
  private emittedCodeBlocks: ComposerCodeBlock[] = [];
  private serializedDoc?: DocumentNode;
  private serializedText = "";

  constructor(element: HTMLDivElement, private readonly options: ComposerEditorOptions) {
    const paragraph = chainCommands(splitListItem(schema.nodes.list_item), createParagraphNear, liftEmptyBlock, splitBlock);
    const submit: Command = () => {
      if (!this.options.onSubmit) return false;
      this.options.onSubmit();
      return true;
    };
    const modifiedEnter: Command = (state, dispatch, view) => {
      if (!this.options.submitWithCtrlEnter?.() && exitCode(state, dispatch, view)) return true;
      return submit(state, dispatch, view);
    };
    const base = { ...baseKeymap };
    delete base.Enter;
    delete base["Mod-Enter"];
    this.plugins = [
      history({ depth: 100, newGroupDelay: 400 }),
      inputRules({ rules: [
        textblockTypeInputRule(/^(#{1,6})\s$/, schema.nodes.heading, match => ({ level: match[1].length })),
        wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote),
        wrappingInputRule(/^\s*([-+*])\s$/, schema.nodes.bullet_list, { tight: true }),
        wrappingInputRule(/^(\d+)\.\s$/, schema.nodes.ordered_list, match => ({ order: Number(match[1]), tight: true })),
        textblockTypeInputRule(/^ {0,3}(`{3,}|~{3,})([\w+#.-]*)\s$/, schema.nodes.code_block, match => ({ language: match[2] || "auto", id: newCodeId(), inputFence: match[1] })),
        markRule(/\*\*([^*\n]+)\*\*$/, schema.marks.strong),
        markRule(/__([^_\n]+)__$/, schema.marks.strong),
        markRule(/(?<!\*)\*([^*\n]+)\*$/, schema.marks.em),
        markRule(/(?<!_)_([^_\n]+)_$/, schema.marks.em),
        markRule(/~~([^~\n]+)~~$/, schema.marks.strike),
        markRule(/`([^`\n]+)`$/, schema.marks.code),
      ] }),
      keymap({
        ...base,
        "Mod-z": undo, "Shift-Mod-z": redo, "Mod-y": redo,
        "Mod-b": toggleMark(schema.marks.strong), "Mod-i": toggleMark(schema.marks.em),
        Backspace: chainCommands(clearCodeBlock, undoInputRule, baseKeymap.Backspace),
        Delete: chainCommands(clearCodeBlock, baseKeymap.Delete),
        ArrowUp: leaveCodeBoundary(-1, true), ArrowDown: leaveCodeBoundary(1, true),
        ArrowLeft: leaveCodeBoundary(-1, false), ArrowRight: leaveCodeBoundary(1, false),
        Enter: (state, dispatch, view) => {
          if (closeCodeFence(state, dispatch, view) || openCodeFence(state, dispatch, view)) return true;
          if (state.selection.$from.parent.type === schema.nodes.code_block) return newlineInCode(state, dispatch);
          return this.options.submitWithCtrlEnter?.() ? paragraph(state, dispatch, view) : submit(state, dispatch, view);
        },
        "Shift-Enter": chainCommands(closeCodeFence, openCodeFence, newlineInCode, paragraph),
        "Alt-Enter": chainCommands(closeCodeFence, openCodeFence, newlineInCode, paragraph),
        "Ctrl-Enter": modifiedEnter,
        "Meta-Enter": modifiedEnter,
        "Shift-Mod-Enter": (state, dispatch) => state.selection.$from.parent.type === schema.nodes.code_block && paragraphBesideCode(state, state.selection.$from.before(), -1, dispatch),
        Tab: chainCommands(this.indentCode(false), sinkListItem(schema.nodes.list_item)),
        "Shift-Tab": chainCommands(this.indentCode(true), liftListItem(schema.nodes.list_item)),
      }),
      new Plugin<DecorationSet>({
        key: highlightKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (transaction, value) => transaction.getMeta(highlightKey) ?? value.map(transaction.mapping, transaction.doc),
        },
        props: { decorations: state => highlightKey.getState(state) },
      }),
    ];
    this.view = new EditorView({ mount: element }, {
      state: this.newState(parser.parse("")),
      attributes: { dir: "auto", role: "textbox", "aria-multiline": "true", spellcheck: "true" },
      dispatchTransaction: transaction => {
        this.view.updateState(this.view.state.apply(transaction));
        if (transaction.docChanged) {
          if (this.emitCodeBlocks()) this.scheduleHighlight();
          this.options.onChange();
        }
      },
      handleDOMEvents: {
        keydown: (view, event) => {
          if (event.isComposing || event.keyCode === 229 || view.composing || this.options.shouldHandleKeys?.() === false) return true;
          this.importSelection();
          return false;
        },
        beforeinput: (view, event) => {
          const input = event as InputEvent;
          if (input.isComposing || view.composing || !input.cancelable || !["deleteContentBackward", "deleteContentForward", "deleteByCut"].includes(input.inputType)) return false;
          this.importSelection();
          if (!clearCodeBlock(view.state, view.dispatch)) return false;
          event.preventDefault();
          return true;
        },
        // Attachment and workspace-code handling stays with the surrounding composer.
        paste: () => true,
        drop: () => true,
      },
      nodeViews: {
        mention: node => ({
          dom: this.options.createMention(node.attrs as MentionItem),
          ignoreMutation: () => true,
          stopEvent: event => (event.target as HTMLElement | null)?.closest(".mention-x") != null,
        }),
        code_block: (node, _view, getPos) => this.createCodeView(node, getPos),
        image: node => {
          const dom = document.createElement("span");
          dom.className = "composer-inline-image";
          dom.contentEditable = "false";
          dom.textContent = node.attrs.alt || "Image";
          dom.title = node.attrs.src;
          return { dom };
        },
      },
    });
  }

  private newState(doc: DocumentNode): EditorState {
    return EditorState.create({ schema, doc, selection: TextSelection.atEnd(doc), plugins: this.plugins });
  }

  private createCodeView(node: DocumentNode, getPos: () => number | undefined): NodeView {
    const id = newCodeId();
    const dom = document.createElement("div");
    dom.className = "composer-code-block";
    dom.dir = "ltr";
    dom.dataset.codeId = id;
    const header = document.createElement("div");
    header.className = "composer-code-header";
    header.contentEditable = "false";
    const pre = document.createElement("pre");
    pre.dir = "ltr";
    const contentDOM = document.createElement("code");
    contentDOM.spellcheck = false;
    pre.append(contentDOM);
    dom.append(header, pre);
    const entry = { node, element: header, getPos };
    this.codeViews.set(id, entry);
    return {
      dom, contentDOM,
      update: updated => {
        if (updated.type !== schema.nodes.code_block) return false;
        entry.node = updated;
        return true;
      },
      ignoreMutation: mutation => mutation.type !== "selection" && (header === mutation.target || header.contains(mutation.target)),
      stopEvent: event => header.contains(event.target as Node),
      destroy: () => { this.codeViews.delete(id); },
    };
  }

  private emitCodeBlocks(): boolean {
    const blocks = Array.from(this.codeViews, ([id, entry]) => ({
      id, element: entry.element, language: entry.node.attrs.language || "auto", code: entry.node.textContent,
    }));
    if (blocks.length === this.emittedCodeBlocks.length && blocks.every((block, index) => {
      const previous = this.emittedCodeBlocks[index];
      return block.id === previous.id && block.element === previous.element && block.language === previous.language && block.code === previous.code;
    })) return false;
    this.emittedCodeBlocks = blocks;
    this.options.onCodeBlocks(blocks);
    return true;
  }

  private scheduleHighlight(): void {
    if (this.highlightTimer) clearTimeout(this.highlightTimer);
    this.highlightTimer = setTimeout(() => {
      this.highlightTimer = undefined;
      if (this.destroyed) return;
      const decorations: Decoration[] = [];
      let remaining = 128_000;
      this.view.state.doc.descendants((node, position) => {
        if (node.type !== schema.nodes.code_block || remaining <= 0) return;
        const text = node.textContent.slice(0, Math.min(64_000, remaining));
        remaining -= text.length;
        const root = document.createElement("div");
        root.innerHTML = highlightCode(text, node.attrs.language || "auto");
        let offset = 0;
        for (const child of Array.from(root.childNodes)) {
          const length = child.textContent?.length || 0;
          if (child instanceof HTMLElement && child.className && length) {
            decorations.push(Decoration.inline(position + 1 + offset, position + 1 + offset + length, { class: child.className }));
          }
          offset += length;
        }
        return false;
      });
      this.view.dispatch(this.view.state.tr.setMeta(highlightKey, DecorationSet.create(this.view.state.doc, decorations)).setMeta("addToHistory", false));
    }, 150);
  }

  private flush(): void {
    if (this.destroyed || this.flushing || this.view.composing) return;
    this.flushing = true;
    try {
      // Synchronize pending native contenteditable edits before a synchronous send/draft read.
      (this.view as unknown as { domObserver: { flush: () => void } }).domObserver.flush();
    } finally { this.flushing = false; }
  }

  private importSelection(): void {
    this.flush();
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.anchorNode || !selection.focusNode ||
        !this.view.dom.contains(selection.anchorNode) || !this.view.dom.contains(selection.focusNode)) return;
    if (selection.anchorNode.parentElement?.closest("[contenteditable=false]")) return;
    try {
      const anchor = this.view.posAtDOM(selection.anchorNode, selection.anchorOffset);
      const head = this.view.posAtDOM(selection.focusNode, selection.focusOffset);
      // Keep structural selections when the browser still reflects them.
      // Converting select-all to a text selection excludes empty blocks.
      if (anchor === this.view.state.selection.anchor && head === this.view.state.selection.head) return;
      const next = TextSelection.between(this.view.state.doc.resolve(anchor), this.view.state.doc.resolve(head));
      if (!next.eq(this.view.state.selection)) this.view.dispatch(this.view.state.tr.setSelection(next));
    } catch { /* A removed popup or DOM node can leave a stale browser selection. */ }
  }

  setText(markdown: string): void {
    this.view.updateState(this.newState(parser.parse(markdown)));
    this.emitCodeBlocks();
    this.scheduleHighlight();
  }

  getText(): string {
    this.flush();
    const doc = this.view.state.doc;
    if (doc !== this.serializedDoc) {
      this.serializedText = serializer.serialize(doc);
      this.serializedDoc = doc;
    }
    return this.serializedText;
  }

  isEmpty(): boolean {
    this.flush();
    let content = false;
    this.view.state.doc.descendants(node => {
      if (node.isText && node.textContent.trim() || node.type === schema.nodes.mention || node.type === schema.nodes.image) content = true;
    });
    return !content;
  }

  isEmptyParagraph(): boolean {
    this.flush();
    const doc = this.view.state.doc;
    return doc.childCount === 1 && doc.firstChild?.type === schema.nodes.paragraph && doc.firstChild.content.size === 0;
  }

  isInCodeBlock(): boolean {
    this.importSelection();
    return this.view.state.selection.$from.parent.type === schema.nodes.code_block;
  }

  insertText(text: string, markdown = false): void {
    this.importSelection();
    const state = this.view.state;
    const transaction = closeHistory(state.tr);
    if (!markdown || state.selection.$from.parent.type === schema.nodes.code_block) {
      transaction.insertText(text.replace(/\r\n?/g, "\n"));
    } else {
      const doc = parser.parse(text);
      if (state.doc.childCount === 1 && state.doc.firstChild?.type === schema.nodes.paragraph && state.doc.firstChild.content.size === 0) {
        transaction.replaceWith(0, state.doc.content.size, doc.content);
        transaction.setSelection(TextSelection.atEnd(transaction.doc));
      } else {
        const structural = Array.from({ length: doc.childCount }, (_, index) => doc.child(index)).some(node => node.type !== schema.nodes.paragraph);
        // Opening a fenced-code/heading boundary would merge its text into the
        // surrounding paragraph. Keep structural blocks closed and let the
        // transaction split surrounding prose around the insertion.
        transaction.replaceSelection(structural ? new Slice(doc.content, 0, 0) : Slice.maxOpen(doc.content));
      }
    }
    this.view.dispatch(transaction);
    this.view.focus();
  }

  insertMention(mention: MentionItem): void {
    this.importSelection();
    if (this.view.state.selection.$from.parent.type === schema.nodes.code_block) {
      this.insertText(mention.path);
      return;
    }
    const transaction = closeHistory(this.view.state.tr).replaceSelectionWith(schema.nodes.mention.create(mention));
    transaction.insertText(" ", transaction.selection.to);
    this.view.dispatch(transaction);
    this.view.focus();
  }

  removeMention(element: HTMLElement): void {
    this.flush();
    if (!this.view.dom.contains(element)) return;
    const position = this.view.posAtDOM(element, 0);
    const node = this.view.state.doc.nodeAt(position);
    if (node?.type !== schema.nodes.mention) return;
    const after = this.view.state.doc.textBetween(position + node.nodeSize, Math.min(this.view.state.doc.content.size, position + node.nodeSize + 1));
    const transaction = closeHistory(this.view.state.tr).delete(position, position + node.nodeSize + (after === " " || after === "\u00a0" ? 1 : 0));
    this.view.dispatch(transaction);
    this.view.focus();
  }

  setCodeLanguage(id: string, value: string): void {
    this.flush();
    const entry = this.codeViews.get(id);
    const position = entry?.getPos();
    if (position == null) return;
    const node = this.view.state.doc.nodeAt(position);
    if (node?.type !== schema.nodes.code_block) return;
    this.view.dispatch(closeHistory(this.view.state.tr).setNodeMarkup(position, undefined, { ...node.attrs, language: normalizeCodeLanguage(value) }));
    this.view.focus();
  }

  insertTextBesideCode(id: string, direction: -1 | 1): void {
    this.flush();
    const position = this.codeViews.get(id)?.getPos();
    if (position == null) return;
    if (paragraphBesideCode(this.view.state, position, direction, this.view.dispatch)) this.view.focus();
  }

  removeCodeBlock(id: string): void {
    this.flush();
    const position = this.codeViews.get(id)?.getPos();
    if (position == null) return;
    const node = this.view.state.doc.nodeAt(position);
    if (node?.type !== schema.nodes.code_block) return;
    const transaction = closeHistory(this.view.state.tr).delete(position, position + node.nodeSize);
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(Math.min(position, transaction.doc.content.size))));
    this.view.dispatch(transaction.scrollIntoView());
    this.view.focus();
  }

  selectAll(): void {
    this.flush();
    this.view.dispatch(this.view.state.tr.setSelection(new AllSelection(this.view.state.doc)));
    this.view.focus();
  }

  undo(): void { this.flush(); undo(this.view.state, this.view.dispatch); this.view.focus(); }
  redo(): void { this.flush(); redo(this.view.state, this.view.dispatch); this.view.focus(); }

  private indentCode(outdent: boolean): Command {
    return (state, dispatch) => {
      const { $from, $to } = state.selection;
      if ($from.parent.type !== schema.nodes.code_block || !$from.sameParent($to)) return false;
      if (!outdent && state.selection.empty) { dispatch?.(state.tr.insertText("  ")); return true; }
      const text = $from.parent.textContent;
      const start = text.lastIndexOf("\n", Math.max(0, $from.parentOffset - 1)) + 1;
      const end = $to.parentOffset;
      const offsets = [start];
      for (let i = text.indexOf("\n", start); i >= 0 && i < end; i = text.indexOf("\n", i + 1)) offsets.push(i + 1);
      const transaction = state.tr;
      for (let i = offsets.length - 1; i >= 0; i--) {
        const offset = offsets[i];
        if (outdent) {
          const length = /^(?:\t| {1,2})/.exec(text.slice(offset))?.[0].length || 0;
          if (length) transaction.delete($from.start() + offset, $from.start() + offset + length);
        } else transaction.insertText("  ", $from.start() + offset);
      }
      dispatch?.(transaction);
      return true;
    };
  }

  destroy(): void {
    this.destroyed = true;
    if (this.highlightTimer) clearTimeout(this.highlightTimer);
    this.view.destroy();
    this.codeViews.clear();
  }
}
