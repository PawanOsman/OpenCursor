/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, it, expect, afterEach } from "vitest";
import { webSearchTool, _internals } from "./web";

function decodeEntities(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&#x2F;/g, "/").replace(/\s+/g, " ").trim();
}
function unwrapDdg(href: string): string {
  const m = href.match(/[?&]uddg=([^&]+)/);
  let url = m ? decodeURIComponent(m[1]) : href;
  if (url.startsWith("//")) url = "https:" + url;
  return url;
}
interface SearchHit { title: string; url: string; snippet?: string; }
function parseDdgHtml(html: string, limit: number): SearchHit[] {
  const hits: SearchHit[] = []; const seen = new Set<string>();
  const blockRe = /<div class="result__body">([\s\S]*?)<\/div>\s*<\/div>/g;
  let bm: RegExpExecArray | null;
  while ((bm = blockRe.exec(html)) && hits.length < limit) {
    const block = bm[1]; const link = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue; const url = unwrapDdg(link[1]); if (seen.has(url)) continue; seen.add(url);
    const snip = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    hits.push({ url, title: decodeEntities(link[2]) || "(untitled)", snippet: snip ? decodeEntities(snip[1]) : undefined });
  }
  if (hits.length === 0) { const re = /href="([^"]*\/l\/?\?uddg=[^"]+)"[^>]*>([\s\S]*?)<\/a>/g; let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && hits.length < limit) { const url = unwrapDdg(m[1]); if (seen.has(url) || !url.startsWith("http")) continue; seen.add(url); hits.push({ url, title: decodeEntities(m[2]) || "(untitled)" }); } }
  if (hits.length === 0) { const re = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g; let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && hits.length < limit) { const url = m[1]; if (seen.has(url)) continue; const title = decodeEntities(m[2]); if (!title || title.length < 3) continue; seen.add(url); hits.push({ url, title }); } }
  return hits;
}
describe("decodeEntities", () => {
  it("strips HTML tags", () => { expect(decodeEntities("<b>bold</b>")).toBe("bold"); });
  it("decodes entities", () => { expect(decodeEntities("&amp;&lt;div&gt;")).toBe("&<div>"); });
  it("normalizes whitespace", () => { expect(decodeEntities("  hello   world  ")).toBe("hello world"); });
});
describe("unwrapDdg", () => {
  it("unwraps DDG redirect", () => { expect(unwrapDdg("/l/?uddg=https%3A%2F%2Fexample.com%2Fpage")).toBe("https://example.com/page"); });
  it("returns direct URLs unchanged", () => { expect(unwrapDdg("https://example.com")).toBe("https://example.com"); });
  it("fixes protocol-relative URLs", () => { expect(unwrapDdg("//example.com")).toBe("https://example.com"); });
});
describe("parseDdgHtml", () => {
  it("parses result__body blocks", () => { const html = '<div class="result__body"><div><a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com">Title</a><a class="result__snippet">Snippet</a></div></div>'; const hits = parseDdgHtml(html, 10); expect(hits).toHaveLength(1); expect(hits[0].url).toBe("https://example.com"); expect(hits[0].title).toBe("Title"); expect(hits[0].snippet).toBe("Snippet"); });
  it("falls back to DDG redirect anchors", () => { const html = '<a href="/l/?uddg=https%3A%2F%2Ftest.com">Link</a>'; const hits = parseDdgHtml(html, 10); expect(hits).toHaveLength(1); expect(hits[0].url).toBe("https://test.com"); });
  it("falls back to any external href", () => { const html = '<a href="https://example.org/article">Article Title</a>'; const hits = parseDdgHtml(html, 10); expect(hits).toHaveLength(1); expect(hits[0].url).toBe("https://example.org/article"); });
  it("returns empty for empty HTML", () => { expect(parseDdgHtml("", 10)).toHaveLength(0); });
  it("respects limit", () => { const html = '<div class="result__body"><a class="result__a" href="/l/?uddg=https%3A%2F%2Fa.com">A</a></div><div class="result__body"><a class="result__a" href="/l/?uddg=https%3A%2F%2Fb.com">B</a></div><div class="result__body"><a class="result__a" href="/l/?uddg=https%3A%2F%2Fc.com">C</a></div>'; expect(parseDdgHtml(html, 2)).toHaveLength(2); });
  it("deduplicates by URL", () => { const html = '<div class="result__body"><a class="result__a" href="/l/?uddg=https%3A%2F%2Fdup.com">First</a></div><div class="result__body"><a class="result__a" href="/l/?uddg=https%3A%2F%2Fdup.com">Second</a></div>'; const hits = parseDdgHtml(html, 10); expect(hits).toHaveLength(1); expect(hits[0].title).toBe("First"); });
  it("decodes entities in titles", () => { const html = '<div class="result__body"><a class="result__a" href="/l/?uddg=https%3A%2F%2Ftest.com">Test &amp; Title</a></div>'; const hits = parseDdgHtml(html, 10); expect(hits[0].title).toBe("Test & Title"); });
});

describe("parseYdcResults", () => {
  it("parses hits with snippets arrays", () => {
    const body = { hits: [{ title: "Result A", url: "https://a.com", snippets: ["part one.", "part two."] }, { title: "Result B", url: "https://b.com", description: "plain description" }] };
    const hits = _internals.parseYdcResults(body, 10);
    expect(hits).toHaveLength(2);
    expect(hits[0].snippet).toBe("part one. part two.");
    expect(hits[1].snippet).toBe("plain description");
  });
  it("accepts a bare array body", () => {
    const hits = _internals.parseYdcResults([{ title: "Only", url: "https://only.com" }], 10);
    expect(hits).toHaveLength(1);
    expect(hits[0].snippet).toBeUndefined();
  });
  it("skips entries without a usable url/title", () => {
    const hits = _internals.parseYdcResults({ hits: [{ title: "no url" }, { url: "https://x.com" }, { title: "ok", url: "https://ok.com" }] }, 10);
    expect(hits).toHaveLength(1);
    expect(hits[0].url).toBe("https://ok.com");
  });
  it("deduplicates by URL and respects limit", () => {
    const body = { hits: [
      { title: "First", url: "https://dup.com" },
      { title: "Second", url: "https://dup.com" },
      { title: "A", url: "https://a.com" },
      { title: "B", url: "https://b.com" },
      { title: "C", url: "https://c.com" },
    ] };
    expect(_internals.parseYdcResults(body, 2)).toHaveLength(2);
    expect(_internals.parseYdcResults(body, 10)).toHaveLength(4);
  });
  it("returns empty for null/unknown bodies", () => {
    expect(_internals.parseYdcResults(null, 10)).toHaveLength(0);
    expect(_internals.parseYdcResults({ unexpected: true }, 10)).toHaveLength(0);
  });
});

describe("ydcApiKey", () => {
  const original = process.env.YDC_API_KEY;
  afterEach(() => { if (original === undefined) delete process.env.YDC_API_KEY; else process.env.YDC_API_KEY = original; });
  it("is unset by default", () => { delete process.env.YDC_API_KEY; expect(_internals.ydcApiKey()).toBeUndefined(); });
  it("trims whitespace and rejects empty keys", () => {
    process.env.YDC_API_KEY = "  secret-key  ";
    expect(_internals.ydcApiKey()).toBe("secret-key");
    process.env.YDC_API_KEY = "   ";
    expect(_internals.ydcApiKey()).toBeUndefined();
  });
});

describe("WebSearch engine selection", () => {
  it("uses You.com when YDC_API_KEY is set and returns results, labelling the engine", async () => {
    process.env.YDC_API_KEY = "test-key";
    const original = _internals.ydcSearch;
    _internals.ydcSearch = async (term, _signal, limit) =>
      [{ title: `You.com hit for ${term}`, url: "https://you.com/docs", snippet: "docs snippet" }].slice(0, limit);
    try {
      const r = await webSearchTool.execute({ search_term: "mcp protocol" });
      expect(r.output).toContain("via you.com");
      expect(r.output).toContain("https://you.com/docs");
    } finally {
      _internals.ydcSearch = original;
      delete process.env.YDC_API_KEY;
    }
  });
  it("falls back to DuckDuckGo when the You.com call fails", async () => {
    process.env.YDC_API_KEY = "bad-key";
    const originalYdc = _internals.ydcSearch;
    const originalFetch = globalThis.fetch;
    _internals.ydcSearch = async () => { throw new Error("HTTP 401"); };
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u.startsWith("https://html.duckduckgo.com/html/")) {
        return new Response('<div class="result__body"><a class="result__a" href="/l/?uddg=https%3A%2F%2Fddg.com">DDG Hit</a></div>', { status: 200 });
      }
      return new Response("", { status: 200 });
    }) as typeof fetch;
    try {
      const r = await webSearchTool.execute({ search_term: "anything" });
      expect(r.output).toContain("via duckduckgo");
      expect(r.output).toContain("https://ddg.com");
    } finally {
      _internals.ydcSearch = originalYdc;
      globalThis.fetch = originalFetch;
      delete process.env.YDC_API_KEY;
    }
  });
  it("does not call You.com when no key is set", async () => {
    delete process.env.YDC_API_KEY;
    let called = false;
    const original = _internals.ydcSearch;
    _internals.ydcSearch = async () => { called = true; return []; };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u.startsWith("https://html.duckduckgo.com/html/")) {
        return new Response('<div class="result__body"><a class="result__a" href="/l/?uddg=https%3A%2F%2Fdefault.com">Default Hit</a></div>', { status: 200 });
      }
      return new Response("", { status: 200 });
    }) as typeof fetch;
    try {
      const r = await webSearchTool.execute({ search_term: "default path" });
      expect(called).toBe(false);
      expect(r.output).toContain("via duckduckgo");
    } finally {
      _internals.ydcSearch = original;
      globalThis.fetch = originalFetch;
    }
  });
});
