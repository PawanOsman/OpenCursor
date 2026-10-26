/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { Marked } from "marked";
import { escapeCodeHtml, getCodeLanguage, highlightCode } from "./codeLanguages";

// GFM markdown (tables, task lists, fenced code, etc.). marked passes raw HTML
// through, so we sanitize the output before injecting into the webview.
// Keep highlighting bounded across all blocks in a streaming response.
const HIGHLIGHT_BUDGET = 128_000;
let highlightRemaining = 0;
const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    code({ text, lang }) {
      const code = text.replace(/\n$/, "") + "\n";
      const prefix = code.slice(0, Math.min(64_000, highlightRemaining));
      highlightRemaining -= prefix.length;
      const language = getCodeLanguage(prefix, lang?.trim().split(/\s+/, 1)[0]).id;
      const content = highlightCode(prefix, language) + escapeCodeHtml(code.slice(prefix.length));
      return `<pre><code class="language-${language}">${content}</code></pre>\n`;
    },
  },
});

// Allowlist sanitiser. AI output is semi-trusted and marked passes raw HTML
// through, so rebuild the DOM keeping only markdown's own elements and safe
// attributes. Parsing through a <template> never runs scripts or loads images.
const ALLOWED_TAGS = new Set([
  "p", "a", "code", "pre", "em", "strong", "del", "s", "b", "i", "u", "mark", "small", "sub", "sup", "kbd",
  "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "br", "img", "span", "div",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col", "details", "summary", "input",
  // Inline icons inside mention pills.
  "svg", "path", "circle", "rect", "line", "polyline", "polygon", "g", "ellipse",
]);
/** Removed together with their content; any other unknown tag is unwrapped to its text. */
const DROPPED_TAGS = new Set([
  "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet", "link", "meta", "base", "form",
  "button", "textarea", "select", "option", "optgroup", "noscript", "template", "math", "video", "audio", "source",
  "track", "canvas", "dialog", "portal", "foreignobject", "title", "head", "xmp", "plaintext", "noembed", "noframes",
]);
const COMMON_ATTRS = new Set(["title", "class", "dir", "align"]);
const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href"]), img: new Set(["src", "alt", "width", "height"]), ol: new Set(["start"]),
  th: new Set(["colspan", "rowspan"]), td: new Set(["colspan", "rowspan"]), col: new Set(["span"]),
  input: new Set(["type", "checked", "disabled"]), details: new Set(["open"]),
  span: new Set(["data-kind", "data-path"]), code: new Set(["data-language"]),
};
const SVG_ATTRS = new Set(["xmlns", "viewbox", "width", "height", "fill", "stroke", "stroke-width", "stroke-linecap",
  "stroke-linejoin", "fill-rule", "clip-rule", "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2", "y2",
  "points", "transform", "aria-hidden", "focusable", "opacity"]);
const SVG_TAGS = new Set(["svg", "path", "circle", "rect", "line", "polyline", "polygon", "g", "ellipse"]);

/** Scheme after browser-style normalization (entities are already decoded by the parser). */
function scheme(value: string): string | undefined {
  const compact = value.replace(/[\u0000-\u0020\u007f-\u009f]+/g, "");
  return /^([a-z][a-z0-9+.-]*):/i.exec(compact)?.[1].toLowerCase();
}
function safeHref(value: string): boolean {
  const found = scheme(value);
  return found === undefined ? !/^[\\/]{2}/.test(value.trim()) : found === "http" || found === "https" || found === "mailto";
}
function safeSrc(value: string): boolean {
  const found = scheme(value);
  return found === "https" || (found === "data" && /^\s*data:image\/(?:png|gif|jpe?g|webp|avif|bmp);/i.test(value));
}

function cleanNode(node: Node): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) continue; // text
    if (child.nodeType !== 1) { child.remove(); continue; } // comments, processing instructions
    const element = child as Element;
    const tag = element.localName.toLowerCase();
    if (DROPPED_TAGS.has(tag)) { element.remove(); continue; }
    if (!ALLOWED_TAGS.has(tag) || (tag === "input" && element.getAttribute("type")?.toLowerCase() !== "checkbox")) {
      if (tag === "input") { element.remove(); continue; }
      cleanNode(element);
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }
    const svg = SVG_TAGS.has(tag);
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const allowed = svg ? SVG_ATTRS.has(name) || name === "class" : COMMON_ATTRS.has(name) || !!TAG_ATTRS[tag]?.has(name);
      if (!allowed) { element.removeAttribute(attribute.name); continue; }
      if (name === "href" && !safeHref(attribute.value)) element.setAttribute(attribute.name, "#");
      else if (name === "src" && !safeSrc(attribute.value)) element.removeAttribute(attribute.name);
      else if (svg && /url\s*\(|javascript:/i.test(attribute.value)) element.removeAttribute(attribute.name);
    }
    // Task-list checkboxes are display only.
    if (tag === "input") element.setAttribute("disabled", "");
    if (tag === "a" && element.hasAttribute("href")) element.setAttribute("rel", "noopener noreferrer");
    cleanNode(element);
  }
}

export function sanitizeHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  cleanNode(template.content);
  return template.innerHTML;
}

/** Resolve each prose block independently so mixed-language replies stay readable. */
function textDirections(html: string): string {
  return html.replace(/<(p|h[1-6]|ul|ol|li|blockquote|table|th|td|pre|code)\b([^>]*)>/gi, (_tag, name: string, attrs: string) => {
    if (/\sdir\s*=/i.test(attrs)) return `<${name}${attrs}>`;
    return `<${name} dir="${/^(pre|code)$/i.test(name) ? "ltr" : "auto"}"${attrs}>`;
  });
}

// Parsing + sanitizing is the single most expensive thing the webview does per
// frame: during streaming the same message is re-rendered on every delta.
// Re-parsing, re-highlighting and re-sanitizing the ENTIRE text each time is
// quadratic in message length, so the document is split into its top-level
// blocks and each block is rendered (and cached) on its own: while streaming
// only the trailing block changes and every earlier block is a cache hit.
// Bound both entries and string storage: streaming revisions can each contain
// hundreds of kilobytes even when the number of entries is small.
const CACHE_LIMIT = 240;
const CACHE_BYTES = 4 * 1024 * 1024;
const MAX_ENTRY_BYTES = 512 * 1024;
interface Rendered { html: string; highlighted: number }
const cache = new Map<string, Rendered>();
let cacheBytes = 0;

function cached(key: string, compute: () => Rendered): Rendered {
  const hit = cache.get(key);
  if (hit !== undefined) {
    // Refresh recency (Map preserves insertion order).
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const entry = compute();
  // Account for UTF-16 source and output. Oversized documents still render, but
  // retaining their intermediate streaming revisions offers little reuse.
  const bytes = (key.length + entry.html.length) * 2;
  if (bytes > MAX_ENTRY_BYTES) return entry;
  cache.set(key, entry);
  cacheBytes += bytes;
  while (cache.size > CACHE_LIMIT || cacheBytes > CACHE_BYTES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cacheBytes -= (oldest.length + cache.get(oldest)!.html.length) * 2;
    cache.delete(oldest);
  }
  return entry;
}

/** Whole-document path, for documents whose blocks cannot be rendered independently. */
export function renderWhole(src: string): string {
  return cached("doc\u0000" + src, () => {
    try {
      highlightRemaining = HIGHLIGHT_BUDGET;
      return { html: textDirections(sanitizeHtml(marked.parse(src, { async: false }) as string)), highlighted: 0 };
    } catch {
      // Fallback: render as escaped plain text on parser failure.
      return { html: '<p dir="auto">' + src.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</p>", highlighted: 0 };
    }
  }).html;
}

function renderBlocks(src: string): readonly string[] {
  const tokens = marked.lexer(src);
  // Raw HTML can open an element in one block and close it in a later one (and
  // the HTML parser carries unclosed formatting tags across paragraphs), so
  // only documents without raw HTML are split.
  let rawHtml = false;
  marked.walkTokens(tokens, token => { if (token.type === "html") rawHtml = true; });
  if (rawHtml) return [renderWhole(src)];
  // Reference definitions change how other blocks resolve their links.
  const links = Object.keys(tokens.links).length ? JSON.stringify(tokens.links) : "";
  const blocks: string[] = [];
  let budget = HIGHLIGHT_BUDGET;
  for (const token of tokens) {
    if (token.type === "space" || token.type === "def") continue;
    // The highlight budget is shared across blocks in document order, so it is
    // part of the key: an identical block later in a long reply may get less.
    const start = budget;
    const entry = cached(`${start}\u0000${token.type}\u0000${links}\u0000${token.raw}`, () => {
      highlightRemaining = start;
      const html = textDirections(sanitizeHtml(marked.parser([token])));
      return { html, highlighted: start - highlightRemaining };
    });
    budget = start - entry.highlighted;
    if (entry.html) blocks.push(entry.html);
  }
  return blocks;
}

/**
 * Render markdown as sanitized HTML fragments, one per top-level block.
 * Joined together they equal the whole-document render.
 */
export function renderMarkdownBlocks(srcIn: string): readonly string[] {
  const src = String(srcIn == null ? "" : srcIn);
  if (!src) return [];
  try {
    return renderBlocks(src);
  } catch {
    return [renderWhole(src)];
  }
}

export function renderMarkdown(srcIn: string): string {
  return renderMarkdownBlocks(srcIn).join("");
}

export function basename(p: string): string {
  if (!p) return "";
  const parts = String(p).split(/[\\/]/);
  return parts[parts.length - 1] || p;
}
