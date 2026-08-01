/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { defineTool } from "./types";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

// ---------------------------------------------------------------------------
// Config — reads searxng_url from ~/.ocursor/config.json if present.
// ---------------------------------------------------------------------------
function loadSearxngUrl(): string | null {
  try {
    const cfgPath = path.join(os.homedir(), ".ocursor", "config.json");
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      if (cfg.searxng_url && typeof cfg.searxng_url === "string") {
        return cfg.searxng_url.replace(/\/$/, "");
      }
    }
  } catch { /* ignore */ }
  return null;
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------
interface SearchHit {
  title: string;
  url: string;
  snippet?: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x2F;/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// SearXNG backend — JSON API
// ---------------------------------------------------------------------------
async function searxngSearch(
  term: string,
  baseUrl: string,
  signal: AbortSignal | undefined,
  limit: number,
): Promise<SearchHit[]> {
  const url = `${baseUrl}/search?q=${encodeURIComponent(term)}&format=json&categories=general&language=en`;
  const r = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json" },
    signal,
  });
  if (!r.ok) throw new Error(`SearXNG HTTP ${r.status}`);
  const data = (await r.json()) as { results?: { title?: string; url?: string; content?: string }[] };
  const hits: SearchHit[] = [];
  for (const res of data.results ?? []) {
    if (!res.url) continue;
    hits.push({
      title: decodeEntities(res.title || "(untitled)"),
      url: res.url,
      snippet: res.content ? decodeEntities(res.content) : undefined,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

// ---------------------------------------------------------------------------
// DuckDuckGo fallback — HTML scrape
// ---------------------------------------------------------------------------
function unwrapDdg(href: string): string {
  const m = href.match(/[?&]uddg=([^&]+)/);
  let url = m ? decodeURIComponent(m[1]) : href;
  if (url.startsWith("//")) url = "https:" + url;
  return url;
}

function parseDdgHtml(html: string, limit: number): SearchHit[] {
  const hits: SearchHit[] = [];
  const blockRe = /<div class="result__body">([\s\S]*?)<\/div>\s*<\/div>/g;
  let bm: RegExpExecArray | null;
  while ((bm = blockRe.exec(html)) && hits.length < limit) {
    const block = bm[1];
    const link = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    const snip = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    hits.push({
      url: unwrapDdg(link[1]),
      title: decodeEntities(link[2]) || "(untitled)",
      snippet: snip ? decodeEntities(snip[1]) : undefined,
    });
  }
  if (hits.length === 0) {
    const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && hits.length < limit) {
      hits.push({ url: unwrapDdg(m[1]), title: decodeEntities(m[2]) || "(untitled)" });
    }
  }
  return hits;
}

async function ddgSearch(term: string, endpoint: string, signal: AbortSignal | undefined, limit: number): Promise<SearchHit[]> {
  const r = await fetch(`${endpoint}?q=${encodeURIComponent(term)}`, {
    headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
    signal,
  });
  if (!r.ok) throw new Error(`DDG HTTP ${r.status}`);
  return parseDdgHtml(await r.text(), limit);
}

// ---------------------------------------------------------------------------
// Unified search: SearXNG first, DDG fallback
// ---------------------------------------------------------------------------
async function search(term: string, signal: AbortSignal | undefined, limit: number): Promise<{ hits: SearchHit[]; engine: string }> {
  const searxngUrl = loadSearxngUrl();

  if (searxngUrl) {
    try {
      const hits = await searxngSearch(term, searxngUrl, signal, limit);
      if (hits.length > 0) return { hits, engine: "SearXNG" };
    } catch (e) {
      // fall through to DDG
    }
  }

  // DuckDuckGo fallback
  let hits = await ddgSearch(term, "https://html.duckduckgo.com/html/", signal, limit);
  if (hits.length === 0) {
    hits = await ddgSearch(term, "https://lite.duckduckgo.com/lite/", signal, limit);
  }
  return { hits, engine: "DuckDuckGo" };
}

// ---------------------------------------------------------------------------
// WebSearch tool
// ---------------------------------------------------------------------------
export const webSearchTool = defineTool("WebSearch", false, async (input, abortSignal) => {
  const term = String(input.search_term || "").trim();
  if (!term) return { output: "error: search_term is required" };
  const LIMIT = 10;

  try {
    const { hits, engine } = await search(term, abortSignal, LIMIT);
    if (hits.length === 0) return { output: `No results for "${term}".` };

    const explanation = input.explanation ? String(input.explanation).trim() : "";
    const header = `Web results for "${term}" [via ${engine}]${explanation ? ` — ${explanation}` : ""}:`;
    const body = hits
      .map((h, i) => {
        const lines = [`${i + 1}. ${h.title}`, `   ${h.url}`];
        if (h.snippet) lines.push(`   ${h.snippet}`);
        return lines.join("\n");
      })
      .join("\n\n");
    return { output: `${header}\n\n${body}` };
  } catch (e) {
    return { output: `error: web search failed: ${e instanceof Error ? e.message : String(e)}` };
  }
});

// ---------------------------------------------------------------------------
// WebFetch tool (unchanged)
// ---------------------------------------------------------------------------
const BINARY_CT = /^(image|audio|video|font)\/|application\/(pdf|zip|octet-stream|gzip|x-tar|vnd\.|wasm|java-archive)/i;

function htmlToMarkdown(html: string): string {
  let s = html.replace(/[\s\S]*?<body[^>]*>/i, "").replace(/<\/body>[\s\S]*$/i, "");
  s = s
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  s = s
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_m, t) => `\n\n# ${t}\n\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_m, t) => `\n\n## ${t}\n\n`)
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_m, t) => `\n\n### ${t}\n\n`)
    .replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, (_m, t) => `\n\n#### ${t}\n\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, t) => `\n- ${t}`)
    .replace(/<(p|div|section|article|tr|br|hr)[^>]*>/gi, "\n")
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, t) => {
      const text = decodeEntities(t);
      return href && !href.startsWith("#") && text ? `[${text}](${href})` : text;
    })
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/(strong|b)>/gi, (_m, _g, t) => `**${t}**`)
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/(em|i)>/gi, (_m, _g, t) => `*${t}*`)
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m, t) => `\`${decodeEntities(t)}\``);

  s = s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[ \t]+/gm, "")
    .trim();
  return s;
}

export const webFetchTool = defineTool("WebFetch", false, async (input, abortSignal) => {
  const raw = String(input.url || "").trim();
  if (!raw) return { output: "error: url is required" };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { output: `error: invalid URL: ${raw}` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { output: `error: unsupported protocol "${url.protocol}" (only http/https)` };
  }

  try {
    const r = await fetch(url.toString(), {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" },
      redirect: "follow",
      signal: abortSignal,
    });

    if (r.status === 401 || r.status === 403) {
      return { output: `error: HTTP ${r.status} — authentication is required and not supported for ${url.host}` };
    }
    if (!r.ok) {
      return { output: `error: HTTP ${r.status} ${r.statusText} for ${url.toString()}` };
    }

    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (BINARY_CT.test(ct)) {
      return { output: `error: cannot fetch binary content (${ct.split(";")[0]}); use the Shell tool for static assets, media, or PDFs` };
    }

    const text = await r.text();
    const isHtml = ct.includes("html") || /^\s*<(!doctype|html)/i.test(text);
    const out = isHtml ? htmlToMarkdown(text) : text.trim();
    const finalNote = r.url && r.url !== url.toString() ? `> fetched: ${r.url}\n\n` : "";
    return { output: (finalNote + out).slice(0, 20000) || "(empty document)" };
  } catch (e) {
    return { output: `error: fetch failed: ${e instanceof Error ? e.message : String(e)}` };
  }
});
