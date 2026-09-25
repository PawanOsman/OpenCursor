/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerEditor, type ComposerCodeBlock } from "./ComposerEditor";

let element: HTMLDivElement;
let editor: ComposerEditor;
let blocks: ComposerCodeBlock[];
let changes: ReturnType<typeof vi.fn>;
let ctrlEnter = false;

function placeCaret(node: Node, offset = node.textContent?.length || 0) {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges(); selection.addRange(range);
}

function key(name: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...options });
  element.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.useFakeTimers(); ctrlEnter = false; blocks = []; changes = vi.fn();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  element = document.createElement("div"); document.body.append(element);
  editor = new ComposerEditor(element, {
    onChange: changes,
    onCodeBlocks: value => { blocks = value; },
    submitWithCtrlEnter: () => ctrlEnter,
    createMention: item => {
      const mention = document.createElement("span");
      mention.className = "mention"; mention.contentEditable = "false";
      mention.dataset.kind = item.kind; mention.dataset.name = item.name; mention.dataset.path = item.path;
      mention.textContent = item.name;
      return mention;
    },
  });
});

afterEach(() => { editor.destroy(); element.remove(); vi.useRealTimers(); });

describe("placeholder state", () => {
  it("only treats one empty paragraph as an untouched composer", () => {
    expect(editor.isEmptyParagraph()).toBe(true);
    editor.insertText("   ");
    expect(editor.isEmptyParagraph()).toBe(false);
    expect(editor.isEmpty()).toBe(true);
    editor.setText("");
    expect(editor.isEmptyParagraph()).toBe(true);
    element.focus();
    key("Enter", { shiftKey: true });
    expect(element.querySelectorAll("p")).toHaveLength(2);
    expect(editor.isEmptyParagraph()).toBe(false);
    expect(editor.isEmpty()).toBe(true);
  });

  it.each([
    ["empty code", "```\n\n```"],
    ["empty heading", "#"],
    ["empty quote", ">"],
    ["empty list", "-"],
    ["horizontal rule", "---"],
  ])("hides the placeholder for %s without treating it as sendable text", (_name, markdown) => {
    editor.setText(markdown);
    expect(editor.isEmptyParagraph()).toBe(false);
    expect(editor.isEmpty()).toBe(true);
  });

  it("restores the placeholder after undoing inserted structure", () => {
    editor.insertText("```\n\n```", true);
    expect(editor.isEmptyParagraph()).toBe(false);
    expect(editor.isEmpty()).toBe(true);
    editor.undo();
    expect(editor.isEmptyParagraph()).toBe(true);
    editor.redo();
    expect(editor.isEmptyParagraph()).toBe(false);
  });

  it("synchronizes native edits before checking placeholder visibility", () => {
    element.querySelector("p")!.textContent = " ";
    expect(editor.isEmptyParagraph()).toBe(false);
    expect(editor.isEmpty()).toBe(true);
  });

  it("clears an empty code block with select all and Backspace", () => {
    editor.insertText("```");
    key("Enter", { shiftKey: true });
    expect(editor.isEmptyParagraph()).toBe(false);
    expect(key("a", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(key("Backspace").defaultPrevented).toBe(true);
    expect(editor.isEmptyParagraph()).toBe(true);
    expect(blocks).toHaveLength(0);
  });

  it("imports a new native caret after selecting all", () => {
    editor.setText("# Heading\n\n```\ncode\n```");
    element.focus();
    key("a", { ctrlKey: true });
    placeCaret(element.querySelector("code")!.firstChild!, 2);
    editor.insertText("!");
    expect(element.querySelector("h1")?.textContent).toBe("Heading");
    expect(blocks[0].code).toBe("co!de");
  });
});

describe("editable Markdown", () => {
  it("renders and round-trips headings, emphasis, lists, quotes and soft line breaks", () => {
    const input = "# Title\n\n**Bold** and *italic* with ~~removed~~\nnext line\n\n- One\n- Two\n\n> Quote";
    editor.setText(input);
    expect(element.querySelector("h1")?.textContent).toBe("Title");
    expect(element.querySelector("strong")?.textContent).toBe("Bold");
    expect(element.querySelector("em")?.textContent).toBe("italic");
    expect(element.querySelector("s")?.textContent).toBe("removed");
    expect(element.querySelectorAll("li")).toHaveLength(2);
    const serialized = editor.getText();
    expect(serialized).toContain("~~removed~~\nnext line");
    editor.setText(serialized);
    expect(element.querySelector("blockquote")?.textContent).toBe("Quote");
    expect(element.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders pasted Markdown in an empty editor and synchronously serializes native edits", () => {
    editor.insertText("## Pasted\n\n**Bold**", true);
    expect(element.querySelector("h2")?.textContent).toBe("Pasted");
    expect(editor.getText()).toBe("## Pasted\n\n**Bold**");
    element.querySelector("strong")!.firstChild!.textContent = "Updated";
    expect(editor.getText()).toBe("## Pasted\n\n**Updated**");
  });

  it("never executes pasted HTML and keeps HTML text intact in fenced code", () => {
    editor.setText('<script>alert("x")</script>\n\n```html\n<img src=x onerror="alert(1)">\n```');
    expect(element.querySelector("script, img")).toBeNull();
    expect(element.textContent).toContain('<script>alert("x")</script>');
    expect(element.querySelector("code")?.textContent).toBe('<img src=x onerror="alert(1)">');
    expect(editor.getText()).toContain('```html\n<img src=x onerror="alert(1)">\n```');
  });

  it("sets automatic direction on prose and left-to-right direction on code", () => {
    editor.setText("# مرحبا\n\nHello\n\n```\nlet x = 1;\n```");
    expect(element.getAttribute("dir")).toBe("auto");
    expect(element.querySelector("h1")?.getAttribute("dir")).toBe("auto");
    expect(element.querySelector("p")?.getAttribute("dir")).toBe("auto");
    expect(element.querySelector("pre")?.getAttribute("dir")).toBe("ltr");
  });

  it("retains complete context mentions through edits and undo", () => {
    const mention = '<attached type="file" title="A &amp; B.ts" content="src/a.ts" />';
    editor.setText(`Before ${mention} after`);
    expect(element.querySelector(".mention")?.textContent).toBe("A & B.ts");
    expect(editor.getText()).toBe(`Before ${mention} after`);
    editor.removeMention(element.querySelector(".mention")!);
    expect(editor.getText()).toBe("Before after");
    editor.undo();
    expect(editor.getText()).toBe(`Before ${mention} after`);
    editor.redo();
    expect(element.querySelector(".mention")).toBeNull();
  });

  it("imports a browser selection before replacing an @ query with a mention", () => {
    editor.setText("Before @src after");
    const text = element.querySelector("p")!.firstChild!;
    const range = document.createRange(); range.setStart(text, 7); range.setEnd(text, 11);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    editor.insertMention({ kind: "file", path: "src/index.ts", name: "index.ts" });
    expect(editor.getText()).toContain('Before <attached type="file" title="index.ts" content="src/index.ts" />');
    expect(editor.getText()).not.toContain("@src");
    expect(editor.getText()).toContain(" after");
  });

  it("supports undo and redo of pasted document structure without leaking earlier drafts", () => {
    editor.insertText("# First", true);
    editor.undo(); expect(editor.isEmpty()).toBe(true);
    editor.redo(); expect(element.querySelector("h1")?.textContent).toBe("First");
    editor.setText("Other chat"); editor.undo(); expect(editor.getText()).toBe("Other chat");
  });

  it("preserves literal angle brackets instead of turning escaped prose into HTML", () => {
    editor.setText("Use &lt;component&gt; and \\<value> in text");
    expect(editor.getText()).toBe("Use \\<component> and \\<value> in text");
    editor.setText(editor.getText());
    expect(element.textContent).toBe("Use <component> and <value> in text");
  });

  it("renders task states and retains their Markdown semantics after editing", () => {
    editor.setText("- [ ] Pending\n- [x] Done\n  - [ ] Nested");
    expect(Array.from(element.querySelectorAll("li[data-checked]"), node => node.getAttribute("data-checked"))).toEqual(["false", "true", "false"]);
    const markdown = editor.getText();
    expect(markdown).toContain("[ ] Pending");
    expect(markdown).toContain("[x] Done");
    expect(markdown).not.toContain("\\[x");
    editor.setText(markdown);
    expect(element.querySelectorAll("li[data-checked]")).toHaveLength(3);
  });

  it("renders tables and preserves alignment, inline formatting, and escaped pipes", () => {
    editor.setText("| Name | Value |\n| :--- | ---: |\n| **A** | `x\\|y` |");
    expect(element.querySelectorAll("th")).toHaveLength(2);
    expect(element.querySelectorAll("td")).toHaveLength(2);
    expect(element.querySelector("th")?.style.textAlign).toBe("left");
    expect(element.querySelector("td strong")?.textContent).toBe("A");
    expect(element.querySelector("td code")?.textContent).toBe("x|y");
    const markdown = editor.getText();
    expect(markdown).toContain("`x\\|y`");
    editor.setText(markdown);
    expect(element.querySelector("td code")?.textContent).toBe("x|y");
    expect(element.querySelectorAll("th")).toHaveLength(2);
  });
});

describe("code blocks", () => {
  it.each(["Backspace", "Delete"])("removes an empty restored code block with %s", name => {
    editor.setText("```\n\n```");
    element.focus();
    placeCaret(element.querySelector("code")!, 0);
    expect(key(name).defaultPrevented).toBe(true);
    expect(editor.isEmptyParagraph()).toBe(true);
    expect(blocks).toHaveLength(0);
    editor.undo();
    expect(blocks).toHaveLength(1);
  });

  it.each(["Backspace", "Delete"])("clears a native selection of a sole code block's contents with %s", name => {
    editor.setText('```js\nconsole.log("hello");\n```');
    element.focus();
    const range = document.createRange(); range.selectNodeContents(element.querySelector("code")!);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    expect(key(name).defaultPrevented).toBe(true);
    expect(editor.isEmptyParagraph()).toBe(true);
    editor.undo(); expect(blocks[0].code).toBe('console.log("hello");');
  });

  it("handles native backward deletion of an empty code block", () => {
    editor.setText("```\n\n```");
    const event = new InputEvent("beforeinput", { inputType: "deleteContentBackward", bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.isEmptyParagraph()).toBe(true);
  });

  it.each(["ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"])("leaves a lone code block with %s and allows prose outside it", name => {
    editor.setText("```js\nvalue\n```");
    element.focus();
    key("a", { ctrlKey: true });
    const before = name === "ArrowUp" || name === "ArrowLeft";
    placeCaret(element.querySelector("code")!.firstChild!, before ? 0 : 5);
    expect(key(name).defaultPrevented).toBe(true);
    editor.insertText(before ? "Before code" : "After code");
    expect(blocks[0].code).toBe("value");
    expect((before ? element.firstElementChild : element.lastElementChild)?.tagName).toBe("P");
    expect((before ? element.firstElementChild : element.lastElementChild)?.textContent).toBe(before ? "Before code" : "After code");
  });

  it("moves to existing prose without adding duplicate blank paragraphs or intercepting arrows inside code", () => {
    editor.setText("Before\n\n```\none\ntwo\nthree\n```\n\nAfter");
    element.focus();
    placeCaret(element.querySelector("code")!.firstChild!, 5);
    expect(key("ArrowUp").defaultPrevented).toBe(false);
    expect(key("ArrowDown").defaultPrevented).toBe(false);
    placeCaret(element.querySelector("code")!.firstChild!, 0);
    key("ArrowUp"); editor.insertText("!");
    expect(element.querySelector("p")?.textContent).toBe("Before!");
    placeCaret(element.querySelector("code")!.firstChild!);
    key("ArrowDown"); editor.insertText("!");
    expect(element.lastElementChild?.textContent).toBe("!After");
    expect(element.querySelectorAll("p")).toHaveLength(2);
  });

  it("adds prose on either side through block actions and removes only the chosen block with undo", () => {
    editor.setText("```\nfirst\n```\n\n```\nsecond\n```");
    const id = blocks[0].id;
    editor.insertTextBesideCode(id, -1); editor.insertText("Before");
    editor.insertTextBesideCode(id, 1); editor.insertText("Between");
    editor.removeCodeBlock(id);
    expect(blocks.map(block => block.code)).toEqual(["second"]);
    expect(element.querySelectorAll("p")).toHaveLength(2);
    editor.undo(); expect(Array.from(element.querySelectorAll("pre code"), code => code.textContent)).toEqual(["first", "second"]);
  });

  it("defaults unlabeled code to auto and keeps explicit languages and whitespace", () => {
    editor.setText("```\n  console.log(1);\n\n```\n\n```python\nprint('hello')\n```");
    expect(blocks.map(block => block.language)).toEqual(["auto", "python"]);
    expect(blocks[0].code).toBe("  console.log(1);\n");
    expect(editor.getText()).toBe("```\n  console.log(1);\n\n```\n\n```python\nprint('hello')\n```");
  });

  it("excludes toolbar labels from Markdown and empty-state checks", () => {
    editor.setText("```\n\n```");
    blocks[0].element.textContent = "Auto (Plain text)";
    expect(editor.isEmpty()).toBe(true);
    expect(editor.getText()).toBe("```\n\n```");
  });

  it("changes language independently per block and restores it with undo", () => {
    editor.setText("```\nconsole.log(1);\n```\n\n```\nprint(1)\n```");
    const first = blocks[0].id;
    editor.setCodeLanguage(first, "python");
    expect(blocks.map(block => block.language)).toEqual(["python", "auto"]);
    expect(editor.getText()).toContain("```python");
    editor.undo(); expect(blocks.map(block => block.language)).toEqual(["auto", "auto"]);
    editor.setCodeLanguage(blocks[0].id, "plaintext");
    expect(editor.getText()).toContain("```plaintext");
  });

  it("keeps pasted Markdown literal when the selection is inside code", () => {
    editor.setText("```\nvalue\n```");
    placeCaret(element.querySelector("code")!.firstChild!);
    editor.insertText("\n# literal\n**value**", true);
    expect(element.querySelector("h1, strong")).toBeNull();
    expect(blocks[0].code).toBe("value\n# literal\n**value**");
  });

  it("uses longer fences when code itself contains backticks", () => {
    editor.setText("````\n```js\nconst x = 1\n```\n````");
    expect(editor.getText()).toBe("````\n```js\nconst x = 1\n```\n````");
  });

  it.each([0, 4, 8])("preserves fenced code pasted at position %s within existing prose", offset => {
    editor.setText("existing");
    placeCaret(element.querySelector("p")!.firstChild!, offset);
    editor.insertText("```\nconsole.log(1);\n```", true);
    expect(element.querySelector("pre code")?.textContent).toBe("console.log(1);");
    expect(blocks).toHaveLength(1);
    expect(editor.getText()).toContain("```\nconsole.log(1);\n```");
    expect(Array.from(element.querySelectorAll("p"), node => node.textContent).join("")).toBe("existing");
  });

  it("serializes large code containing many backtick runs without argument stack overflow", () => {
    const code = "`x` ".repeat(70_000);
    editor.setText(`\`\`\`\n${code}\n\`\`\``);
    expect(editor.getText()).toBe(`\`\`\`\n${code}\n\`\`\``);
  });

  it("decorates code without replacing content or adding an undo step", () => {
    editor.setText('```javascript\nconsole.log("hello");\n```');
    const before = editor.getText();
    vi.advanceTimersByTime(151);
    expect(element.querySelector('code [class^="code-token-"]')).not.toBeNull();
    expect(editor.getText()).toBe(before);
    editor.undo(); expect(editor.getText()).toBe(before);
  });

  it("lets Enter submit prose while code Enter adds a newline and Mod Enter exits", () => {
    editor.setText("Hello");
    expect(key("Enter").defaultPrevented).toBe(false);
    editor.setText("```\nx\n```");
    placeCaret(element.querySelector("code")!.firstChild!);
    editor.insertText(""); // import the selection without changing content
    expect(key("Enter").defaultPrevented).toBe(true);
    expect(blocks[0].code).toBe("x\n");
    expect(key("Enter", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(element.querySelector("p")).not.toBeNull();
  });

  it("splits prose with Enter when configured for Ctrl Enter submission", () => {
    ctrlEnter = true;
    editor.setText("Hello");
    placeCaret(element.querySelector("p")!.firstChild!);
    editor.insertText("");
    expect(key("Enter").defaultPrevented).toBe(true);
    expect(element.querySelectorAll("p")).toHaveLength(2);
    expect(key("Enter", { ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it.each([{}, { shiftKey: true }, { altKey: true }])("turns a typed fence after existing formatted blocks into editable code with %j", modifiers => {
    editor.setText("# Typed heading\n\n**bold**");
    element.focus();
    placeCaret(element.querySelector("strong")!.firstChild!);
    expect(key("Enter", { shiftKey: true }).defaultPrevented).toBe(true);
    editor.insertText("```");
    expect(element.lastElementChild?.tagName).toBe("P");
    expect(element.lastElementChild?.textContent).toBe("```");
    expect(key("Enter", modifiers).defaultPrevented).toBe(true);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].language).toBe("auto");
    editor.insertText('console.log("typed");');
    expect(element.querySelector("pre code")?.textContent).toBe('console.log("typed");');
    expect(element.querySelector("h1")?.textContent).toBe("Typed heading");
    expect(element.querySelector("strong")?.textContent).toBe("bold");
    expect(editor.getText()).toContain('```\nconsole.log("typed");\n```');
  });

  it.each(["```", "````", "~~~"])("opens and closes a typed %s fence with Shift Enter without sending", fence => {
    editor.setText("#Hello");
    element.focus();
    key("Enter", { shiftKey: true });
    editor.insertText(fence);
    expect(key("Enter", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(blocks).toHaveLength(1);
    editor.insertText('console.log("hello");');
    key("Enter", { shiftKey: true });
    editor.insertText(fence);
    expect(key("Enter", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(blocks[0].code).toBe('console.log("hello");');
    expect(element.lastElementChild?.tagName).toBe("P");
    editor.insertText("After code");
    expect(element.lastElementChild?.textContent).toBe("After code");
    expect(element.querySelector("h1")).toBeNull();
    expect(editor.getText()).toContain('```\nconsole.log("hello");\n```');
    editor.undo(); editor.undo();
    expect(blocks[0].code).toContain(fence);
  });

  it("keeps literal or nonmatching fences inside code", () => {
    editor.insertText("````markdown");
    key("Enter", { shiftKey: true });
    editor.insertText("```\ninner example\n```");
    key("Enter", { shiftKey: true });
    expect(blocks[0].code).toBe("```\ninner example\n```\n");
    expect(element.querySelector("p")).toBeNull();
    editor.setText("````markdown\n```\n````");
    key("Enter", { shiftKey: true });
    expect(blocks[0].code).toBe("```\n");
  });
});
