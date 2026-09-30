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

// Drop dangerous nodes/attributes. AI output is semi-trusted; the webview CSP
// also blocks inline scripts, but defence in depth is cheap here.
function sanitize(html: string): string {
  // Inspect markup only: escaped examples of attributes inside code are text.
  return html.replace(/<\/?[a-z](?:[^"'>]|"[^"]*"|'[^']*')*>/gi, tag => {
    if (/^<\/?(?:script|style|iframe|object|embed|link|meta|base)\b/i.test(tag)) return "";
    return tag
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
  });
}

/** Resolve each prose block independently so mixed-language replies stay readable. */
function textDirections(html: string): string {
  return html.replace(/<(p|h[1-6]|ul|ol|li|blockquote|table|th|td|pre|code)\b([^>]*)>/gi, (_tag, name: string, attrs: string) => {
    if (/\sdir\s*=/i.test(attrs)) return `<${name}${attrs}>`;
    return `<${name} dir="${/^(pre|code)$/i.test(name) ? "ltr" : "auto"}"${attrs}>`;
  });
}

// Parsing + sanitizing is the single most expensive thing the webview does per
// frame: during streaming the same message is re-rendered on every delta, each
// time re-parsing the ENTIRE text from scratch (quadratic in message length).
// Bound both entries and string storage: streaming revisions can each contain
// hundreds of kilobytes even when the number of entries is small.
const CACHE_LIMIT = 240;
const CACHE_BYTES = 4 * 1024 * 1024;
const MAX_ENTRY_BYTES = 512 * 1024;
const cache = new Map<string, string>();
let cacheBytes = 0;

function cached(src: string, compute: () => string): string {
  const hit = cache.get(src);
  if (hit !== undefined) {
    // Refresh recency (Map preserves insertion order).
    cache.delete(src);
    cache.set(src, hit);
    return hit;
  }
  const html = compute();
  // Account for UTF-16 source and output. Oversized documents still render, but
  // retaining their intermediate streaming revisions offers little reuse.
  const bytes = (src.length + html.length) * 2;
  if (bytes > MAX_ENTRY_BYTES) return html;
  cache.set(src, html);
  cacheBytes += bytes;
  while (cache.size > CACHE_LIMIT || cacheBytes > CACHE_BYTES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cacheBytes -= (oldest.length + cache.get(oldest)!.length) * 2;
    cache.delete(oldest);
  }
  return html;
}

export function renderMarkdown(srcIn: string): string {
  const src = String(srcIn == null ? "" : srcIn);
  if (!src) return "";
  return cached(src, () => {
    try {
      highlightRemaining = HIGHLIGHT_BUDGET;
      return textDirections(sanitize(marked.parse(src, { async: false }) as string));
    } catch {
      // Fallback: render as escaped plain text on parser failure.
      return '<p dir="auto">' + src.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</p>";
    }
  });
}

export function basename(p: string): string {
  if (!p) return "";
  const parts = String(p).split(/[\\/]/);
  return parts[parts.length - 1] || p;
}
