/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, describe, it, expect, vi } from "vitest";
import { assertPublicUrl, guardedFetch, isBlockedAddress, webFetchTool } from "./web";

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
describe("WebFetch SSRF guard", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.100.100.200", "::1", "::", "fe80::1", "fd00:ec2::254", "fc00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "[::ffff:a9fe:a9fe]", "64:ff9b::a9fe:a9fe"])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });
  it.each(["8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows public %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });
  it("rejects hosts that resolve to private addresses and localhost names", async () => {
    await expect(assertPublicUrl(new URL("http://localhost:8080/"))).rejects.toThrow(/local/);
    await expect(assertPublicUrl(new URL("http://2130706433/"))).rejects.toThrow(/non-public/);
    await expect(assertPublicUrl(new URL("http://[::1]/"))).rejects.toThrow(/non-public/);
    const lookup = async () => [{ address: "93.184.216.34" }, { address: "10.0.0.5" }];
    await expect(assertPublicUrl(new URL("https://rebind.example/"), lookup)).rejects.toThrow(/10\.0\.0\.5/);
    await expect(assertPublicUrl(new URL("https://ok.example/"), async () => [{ address: "93.184.216.34" }])).resolves.toBeUndefined();
  });
  it("re-validates every redirect hop", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(guardedFetch(new URL("https://ok.example/"), {}, async () => [{ address: "93.184.216.34" }])).rejects.toThrow(/non-public/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown[])[1]).toMatchObject({ redirect: "manual" });
  });
  it("stops after too many redirects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 301, headers: { location: "https://8.8.8.8/next" } })));
    await expect(guardedFetch(new URL("https://8.8.8.8/"), {})).rejects.toThrow(/too many redirects/);
  });
  it("refuses loopback URLs through the tool", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const out = await webFetchTool.execute({ url: "http://127.0.0.1:3000/admin" }, undefined as any, "c1", {} as any);
    expect(out.output).toMatch(/^error: fetch failed: refusing/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("caps the streamed body instead of buffering it whole", async () => {
    let pulled = 0;
    const chunk = new Uint8Array(1024 * 1024).fill(97);
    const body = new ReadableStream<Uint8Array>({ pull(c) { pulled++; if (pulled > 50) c.close(); else c.enqueue(chunk); } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200, headers: { "content-type": "text/plain" } })));
    const out = await webFetchTool.execute({ url: "https://8.8.8.8/big" }, undefined as any, "c2", {} as any);
    expect(out.output).toMatch(/truncated\)$/);
    expect(pulled).toBeLessThan(10);
  });
});
