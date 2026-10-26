/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { lookup as dnsLookup } from "dns/promises";
import { isIP } from "net";
import { defineTool } from "./types";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

/** Decode the handful of HTML entities that show up in result text. */
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

/** DuckDuckGo wraps external links as /l/?uddg=<encoded>. Unwrap to the real URL. */
function unwrapDdg(href: string): string {
  const m = href.match(/[?&]uddg=([^&]+)/);
  let url = m ? decodeURIComponent(m[1]) : href;
  if (url.startsWith("//")) url = "https:" + url;
  return url;
}

interface SearchHit {
  title: string;
  url: string;
  snippet?: string;
}

/** Parse the DuckDuckGo HTML endpoint (rich: title + url + snippet). */
function parseDdgHtml(html: string, limit: number): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();

  // Strategy 1: result__body blocks (original DDG HTML layout).
  const blockRe = /<div class="result__body">([\s\S]*?)<\/div>\s*<\/div>/g;
  let bm: RegExpExecArray | null;
  while ((bm = blockRe.exec(html)) && hits.length < limit) {
    const block = bm[1];
    const link = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    const url = unwrapDdg(link[1]);
    if (seen.has(url)) continue;
    seen.add(url);
    const snip = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    hits.push({
      url,
      title: decodeEntities(link[2]) || "(untitled)",
      snippet: snip ? decodeEntities(snip[1]) : undefined,
    });
  }

  // Strategy 2: any anchor with /l/?uddg= (DDG redirect wrapper) — works across layouts.
  if (hits.length === 0) {
    const re = /href="([^"]*\/l\/?\?uddg=[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && hits.length < limit) {
      const url = unwrapDdg(m[1]);
      if (seen.has(url) || !url.startsWith("http")) continue;
      seen.add(url);
      hits.push({ url, title: decodeEntities(m[2]) || "(untitled)" });
    }
  }

  // Strategy 3: any <a> with external href and meaningful text (broader fallback).
  if (hits.length === 0) {
    const re = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && hits.length < limit) {
      const url = m[1];
      if (seen.has(url)) continue;
      const title = decodeEntities(m[2]);
      if (!title || title.length < 3) continue;
      seen.add(url);
      hits.push({ url, title });
    }
  }

  return hits;
}

async function ddgSearch(term: string, endpoint: string, signal: AbortSignal | undefined, limit: number): Promise<SearchHit[]> {
  const r = await fetch(`${endpoint}?q=${encodeURIComponent(term)}`, {
    headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
    signal,
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return parseDdgHtml(await r.text(), limit);
}

// ---- WebSearch ----
// Returns ranked results (title, URL, snippet) from DuckDuckGo, with the lite
// endpoint as a fallback when the HTML endpoint returns nothing.
export const webSearchTool = defineTool("WebSearch", false, async (input, abortSignal) => {
  const term = String(input.search_term || "").trim();
  if (!term) return { output: "error: search_term is required" };
  const LIMIT = 10;

  try {
    let hits = await ddgSearch(term, "https://html.duckduckgo.com/html/", abortSignal, LIMIT);
    if (hits.length === 0) {
      // Fallback engine/endpoint.
      hits = await ddgSearch(term, "https://lite.duckduckgo.com/lite/", abortSignal, LIMIT);
    }
    if (hits.length === 0) return { output: `No results found for "${term}". Try rephrasing the query or using WebFetch on a specific URL directly.` };

    const explanation = input.explanation ? String(input.explanation).trim() : "";
    const header = `Web results for "${term}"${explanation ? ` — ${explanation}` : ""}:`;
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

// Content types we refuse (binary / non-webpage). Per the schema, WebFetch does
// not support media or PDFs — the model should use Shell for those.
const BINARY_CT = /^(image|audio|video|font)\/|application\/(pdf|zip|octet-stream|gzip|x-tar|vnd\.|wasm|java-archive)/i;

/** Convert an HTML document into compact, readable markdown. */
function htmlToMarkdown(html: string): string {
  // Prefer the <body>; drop non-content elements entirely.
  let s = html.replace(/[\s\S]*?<body[^>]*>/i, "").replace(/<\/body>[\s\S]*$/i, "");
  s = s
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  // Structural elements -> markdown.
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

  // Strip whatever tags remain, decode entities, normalise whitespace.
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

// ---- SSRF guard ----
// No setting exists for local URLs, so loopback/private/link-local targets are
// always refused. Every redirect hop is re-resolved and re-checked.
const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
}

/** Expand an IPv6 literal to eight 16-bit groups (handles `::` and a dotted v4 tail). */
function v6Groups(ip: string): number[] | undefined {
  let s = ip.toLowerCase().split("%")[0];
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) {
    const n = v4ToInt(tail[1]);
    s = s.slice(0, -tail[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, rest] = s.split("::");
  const a = head ? head.split(":") : [];
  const b = rest !== undefined && rest ? rest.split(":") : [];
  const fill = s.includes("::") ? 8 - a.length - b.length : 0;
  const groups = [...a, ...Array(Math.max(0, fill)).fill("0"), ...b].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : undefined;
}

/** True for loopback, private, link-local, CGNAT, metadata, multicast and unspecified addresses. */
export function isBlockedAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "");
  if (isIP(ip) === 4) {
    const n = v4ToInt(ip);
    return BLOCKED_V4.some(([base, bits]) => (n >>> (32 - bits)) === (v4ToInt(base) >>> (32 - bits)));
  }
  if (isIP(ip) !== 6) return true;
  const g = v6Groups(ip);
  if (!g) return true;
  const zeroPrefix = (count: number) => g.slice(0, count).every((x) => x === 0);
  // IPv4-mapped / compatible / NAT64: judge the embedded IPv4 address.
  const embedded = `${g[6] >>> 8}.${g[6] & 0xff}.${g[7] >>> 8}.${g[7] & 0xff}`;
  if (zeroPrefix(5) && g[5] === 0xffff) return isBlockedAddress(embedded);
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isBlockedAddress(embedded);
  if (zeroPrefix(6)) return true; // ::, ::1, and v4-compatible
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

type Lookup = (host: string) => Promise<Array<{ address: string }>>;
const systemLookup: Lookup = (host) => dnsLookup(host, { all: true, verbatim: true });

/** Reject URLs whose host is, or resolves to, a non-public address. */
export async function assertPublicUrl(url: URL, lookup: Lookup = systemLookup): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`unsupported protocol "${url.protocol}" (only http/https)`);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) throw new Error("missing host");
  if (/^localhost$|\.localhost$/i.test(host)) throw new Error(`refusing to fetch local address ${host}`);
  const addresses = isIP(host) ? [host] : (await lookup(host)).map((a) => a.address);
  if (!addresses.length) throw new Error(`could not resolve ${host}`);
  const bad = addresses.find(isBlockedAddress);
  if (bad) throw new Error(`refusing to fetch ${host}: resolves to non-public address ${bad}`);
}

/** Read at most `cap` bytes of a body, cancelling the stream past the cap. */
async function readCapped(r: Response, cap: number): Promise<{ text: string; truncated: boolean }> {
  if (!r.body) return { text: "", truncated: false };
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = cap - size;
    if (value.byteLength > room) {
      text += decoder.decode(value.subarray(0, room), { stream: true });
      await reader.cancel().catch(() => {});
      return { text: text + decoder.decode(), truncated: true };
    }
    size += value.byteLength;
    text += decoder.decode(value, { stream: true });
  }
  return { text: text + decoder.decode(), truncated: false };
}

/** Fetch with manual redirects; each hop is validated before it is requested. */
export async function guardedFetch(start: URL, init: RequestInit, lookup?: Lookup): Promise<{ response: Response; url: URL }> {
  let url = start;
  for (let hop = 0; ; hop++) {
    await assertPublicUrl(url, lookup);
    const response = await fetch(url.toString(), { ...init, redirect: "manual" });
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) return { response, url };
    await response.body?.cancel().catch(() => {});
    if (hop >= MAX_REDIRECTS) throw new Error(`too many redirects (>${MAX_REDIRECTS})`);
    url = new URL(location, url);
  }
}

// ---- WebFetch ----
// Fetches a URL and returns its content as readable markdown. Read-only.
// Rejects non-http(s) URLs, non-public hosts, auth-required pages, non-200
// responses, and binary content (use Shell for static assets / media / PDFs).
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
    const { response: r, url: finalUrl } = await guardedFetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" },
      signal: abortSignal,
    });

    if (r.status === 401 || r.status === 403) {
      await r.body?.cancel().catch(() => {});
      return { output: `error: HTTP ${r.status} — authentication is required and not supported for ${finalUrl.host}` };
    }
    if (!r.ok) {
      await r.body?.cancel().catch(() => {});
      return { output: `error: HTTP ${r.status} ${r.statusText} for ${finalUrl.toString()}` };
    }

    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (BINARY_CT.test(ct)) {
      await r.body?.cancel().catch(() => {});
      return { output: `error: cannot fetch binary content (${ct.split(";")[0]}); use the Shell tool for static assets, media, or PDFs` };
    }

    const { text, truncated } = await readCapped(r, MAX_BODY_BYTES);
    const isHtml = ct.includes("html") || /^\s*<(!doctype|html)/i.test(text);
    const out = isHtml ? htmlToMarkdown(text) : text.trim();
    const finalNote = finalUrl.toString() !== url.toString() ? `> fetched: ${finalUrl.toString()}\n\n` : "";
    const capNote = truncated ? `\n\n(response exceeded ${MAX_BODY_BYTES / 1024 / 1024} MB; truncated)` : "";
    return { output: ((finalNote + out).slice(0, 20000) || "(empty document)") + capNote };
  } catch (e) {
    return { output: `error: fetch failed: ${e instanceof Error ? e.message : String(e)}` };
  }
});
