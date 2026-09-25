/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import type { DocSource } from "./docsIndex";

const embedding = vi.hoisted(() => ({ fingerprint: "fixture-embedding-v1", texts: vi.fn() }));
vi.mock("./semanticIndex", () => ({
  embedTexts: (...args: unknown[]) => embedding.texts(...args),
  embedQuery: async () => [1, 0, 0],
  getEmbedFingerprint: () => embedding.fingerprint,
}));

import { cancelDocIndex, chunkDocText, getDocLogs, getDocsStatus, indexDocSource, searchDocs, setDocSourcesProvider, setDocsStorageDir } from "./docsIndex";

const origin = "https://example.test";
const source: DocSource = { id: "guide", name: "Guide", url: `${origin}/docs`, useAi: false, maxPages: 100_000 };
let storage: string;
let routes: Map<string, () => Response | Promise<Response>>;
let requests: string[];
let fallback: ((url: string) => Response | Promise<Response>) | undefined;
const url = (pathname: string) => new URL(pathname, origin).toString();
const html = (text: string, links = "", head = "") => `<!doctype html><html><head><title>Reference</title>${head}</head><body><main><p>${text}</p>${links}</main></body></html>`;
const paragraph = (name: string) => `${name}: this reference explains configuration, usage examples, and behavior for this documentation page.`;
const link = (href: string, name = href) => `<a href="${href}">${name}</a>`;
function page(pathname: string, body = html(paragraph(pathname)), headers: Record<string, string> = {}) {
  routes.set(url(pathname), () => new Response(body, { headers: { "content-type": "text/html", ...headers } }));
}
function resource(pathname: string, body: string, contentType = "text/plain") {
  routes.set(url(pathname), () => new Response(body, { headers: { "content-type": contentType } }));
}
const file = () => path.join(storage, "docs-guide.json");
const readIndex = async () => JSON.parse(await fs.readFile(file(), "utf8")) as { fingerprint: string; pages: { url: string; hash: string }[]; chunks: { url: string; title: string; text: string; vec: number[] }[] };

beforeEach(async () => {
  setDocSourcesProvider(() => []);
  storage = await fs.mkdtemp(path.join(tmpdir(), "ocursor-docs-"));
  setDocsStorageDir(storage);
  embedding.fingerprint = "fixture-embedding-v1";
  embedding.texts.mockReset().mockImplementation(async (texts: string[]) => texts.map(() => [1, 0, 0]));
  routes = new Map(); requests = []; fallback = undefined;
  page("/docs");
  resource("/robots.txt", "User-agent: *\nAllow: /\n");
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const href = String(input); requests.push(href);
    return routes.get(href)?.() ?? fallback?.(href) ?? new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  }));
});

afterEach(async () => {
  setDocSourcesProvider(() => []);
  cancelDocIndex();
  vi.unstubAllGlobals();
  // Fixture deletion is restricted to the directory created for this test.
  const target = path.resolve(storage);
  if (path.dirname(target) !== path.resolve(tmpdir()) || !path.basename(target).startsWith("ocursor-docs-")) throw new Error("Unsafe documentation test fixture path");
  await fs.rm(target, { recursive: true, force: true });
});

describe("bounded documentation discovery and selection", () => {
  it("keeps curated relevant pages when a seed contains a large cross-link list", async () => {
    page("/docs", html(paragraph("Overview"), Array.from({ length: 1500 }, (_, i) => link(`/docs/item-${i}`)).join("")));
    resource("/docs/llms.txt", "# Documentation\n- [Authentication guide](/docs/authentication)");
    page("/docs/authentication");
    const result = await indexDocSource({ ...source, maxPages: 2, focus: "Authentication" });
    expect(result.pages).toBe(2);
    expect(requests).toContain(url("/docs/authentication"));
    expect(requests.some(value => value.includes("/docs/item-"))).toBe(false);
  });

  it("does not follow an infinite chain of links found on indexed pages, even with a huge page limit", async () => {
    page("/docs", html(paragraph("Overview"), link("/docs/chain/0")));
    fallback = href => {
      const match = /^\/docs\/chain\/(\d+)$/.exec(new URL(href).pathname);
      return match ? new Response(html(paragraph(`Chain ${match[1]}`), link(`/docs/chain/${Number(match[1]) + 1}`)), { headers: { "content-type": "text/html" } })
        : new Response("Not found", { status: 404 });
    };
    const result = await indexDocSource(source);
    expect(result).toMatchObject({ pages: 2, selected: 2, scope: `${origin}/docs` });
    expect(requests).toContain(url("/docs/chain/0"));
    expect(requests).not.toContain(url("/docs/chain/1"));
    expect(requests.length).toBeLessThan(10);
    expect(getDocLogs(source.id).join("\n")).toContain("Links on indexed pages will not expand this plan");
    expect(getDocsStatus()).toMatchObject({ phase: "complete", indexing: undefined, done: 2, total: 2 });
  });

  it("honors segment-level section boundaries, excludes query variants, and deduplicates canonical links", async () => {
    page("/docs", html(paragraph("Overview"), ["/docs/guide", "/docs/guide/", "/docs/guide#example", "/docs/guide?utm_source=nav",
      "/docset/unrelated", "/docs-old/guide", "/pricing", "/docs/search?q=anything", "https://other.test/docs/guide"].map(href => link(href)).join("")));
    page("/docs/guide");
    const result = await indexDocSource(source);
    expect(result.pages).toBe(2);
    expect(requests.filter(href => href === url("/docs/guide"))).toHaveLength(1);
    expect(requests.some(href => /docset|docs-old|pricing|search\?|other\.test/.test(href))).toBe(false);
  });

  it("restricts a generic site's root to documentation sections", async () => {
    page("/", html(paragraph("Project home"), ["/docs/start", "/reference/client", "/products/shop", "/pricing", "/community"].map(href => link(href)).join("")));
    page("/docs/start"); page("/reference/client");
    const result = await indexDocSource({ ...source, url: `${origin}/` });
    expect(result.pages).toBe(3);
    expect(requests.some(href => /products\/shop|pricing|community/.test(href))).toBe(false);
  });

  it("fetches duplicate failing candidates only once and finishes its fixed plan", async () => {
    const links = Array.from({ length: 80 }, (_, n) => link(`/docs/missing?utm_source=${n}`)).join("");
    page("/docs", html(paragraph("Overview"), links));
    const result = await indexDocSource(source);
    expect(result).toMatchObject({ pages: 1, selected: 2 });
    expect(requests.filter(href => href === url("/docs/missing"))).toHaveLength(1);
    expect(getDocsStatus()).toMatchObject({ phase: "complete", done: 2, total: 2, skipped: 1 });
  });

  it("uses bounded llms and sitemap discovery without recursively following indexed-page links", async () => {
    resource("/robots.txt", `User-agent: *\nAllow: /\nSitemap: ${origin}/maps.xml`);
    resource("/docs/llms.txt", "# Reference\n- [Guide](/docs/guide)\n- [Unrelated](/blog/news)");
    resource("/llms.txt", "- [API](/docs/api/client)\n- [Outside](https://other.test/docs)");
    resource("/maps.xml", `<sitemapindex>${Array.from({ length: 100 }, (_, n) => `<sitemap><loc>${origin}/maps/${n}.xml</loc></sitemap>`).join("")}</sitemapindex>`, "application/xml");
    resource("/maps/0.xml", `<urlset><url><loc>${origin}/docs/config</loc></url><url><loc>${origin}/pricing</loc></url></urlset>`, "application/xml");
    for (const pathname of ["/docs/guide", "/docs/api/client", "/docs/config"]) page(pathname, html(paragraph(pathname), link(`${pathname}/must-not-follow`)));
    const result = await indexDocSource(source);
    expect(result.pages).toBe(4);
    expect(requests.filter(href => href.endsWith(".xml"))).toHaveLength(4);
    expect(requests).not.toContain(url("/maps/1.xml"));
    expect(requests.some(href => /must-not-follow|\/blog\/|\/pricing|other\.test/.test(href))).toBe(false);
  });

  it("skips noindex content and refuses external redirects before requesting their destination", async () => {
    page("/docs", html(paragraph("Overview"), ["/docs/meta", "/docs/header", "/docs/redirect", "/docs/good"].map(href => link(href)).join("")));
    page("/docs/meta", html(paragraph("Private meta marker"), "", '<meta name="robots" content="noindex, follow">'));
    page("/docs/header", html(paragraph("Private header marker")), { "x-robots-tag": "noindex" });
    routes.set(url("/docs/redirect"), () => new Response(null, { status: 302, headers: { location: "https://outside.test/secret" } }));
    page("/docs/good");
    const result = await indexDocSource(source);
    expect(result.pages).toBe(2);
    expect(requests).not.toContain("https://outside.test/secret");
    const text = (await readIndex()).chunks.map(chunk => chunk.text).join("\n");
    expect(text).not.toMatch(/Private meta marker|Private header marker/);
    expect(getDocsStatus().skipped).toBe(3);
  });

  it("indexes curated Markdown with a search noindex header when the site explicitly permits AI retrieval", async () => {
    resource("/robots.txt", "User-agent: *\nContent-Signal: ai-train=yes, search=yes, ai-input=yes\nAllow: /\nDisallow: /docs/restricted\nContent-Signal: /docs/denied ai-input=no");
    resource("/docs/llms.txt", "# Documentation\n- [Payments tour](/docs/payments.md)\n- [Restricted](/docs/restricted)\n- [Denied](/docs/denied)\n- [HTML excluded](/docs/excluded)");
    page("/docs/payments.md", `# Payments tour\n\n${paragraph("Create and confirm a payment")}\n\n[Next steps](/docs/unplanned)`, { "content-type": "text/markdown; charset=utf-8", "x-robots-tag": "none" });
    page("/docs/excluded", html(paragraph("Excluded HTML"), "", '<meta name="robots" content="noindex">'));
    const result = await indexDocSource(source);
    expect(result).toMatchObject({ pages: 2, selected: 3 });
    const saved = await readIndex();
    expect(saved.chunks.some(chunk => chunk.url === url("/docs/payments.md") && chunk.text.includes("Create and confirm a payment"))).toBe(true);
    expect(saved.chunks.some(chunk => chunk.text.includes("Excluded HTML"))).toBe(false);
    expect(requests).not.toContain(url("/docs/restricted"));
    expect(requests).not.toContain(url("/docs/denied"));
    expect(requests).not.toContain(url("/docs/unplanned"));
    expect(getDocLogs(source.id).join("\n")).toContain("explicitly permits AI retrieval");
  });

  it("honors AI retrieval restrictions before requesting pages or replacing an existing index", async () => {
    await indexDocSource({ ...source, scope: "page" });
    const previous = await fs.readFile(file(), "utf8");
    requests = [];
    resource("/robots.txt", "User-agent: *\nAllow: /\nContent-Signal: ai-input=no");
    await expect(indexDocSource({ ...source, scope: "page" })).rejects.toThrow("disallows AI retrieval");
    expect(requests).toEqual([url("/robots.txt")]);
    expect(await fs.readFile(file(), "utf8")).toBe(previous);
    expect(embedding.texts).toHaveBeenCalledTimes(1);
  });

  it("reports exact selected-page skip reasons instead of treating exclusions as empty content", async () => {
    page("/docs", html(paragraph("Discovery"), link("/docs/markdown.md") + link("/docs/missing") + link("/docs/empty")));
    page("/docs/markdown.md", `# Configuration\n\n${paragraph("Readable Markdown")}`, { "content-type": "text/markdown", "x-robots-tag": "none" });
    page("/docs/empty", html("Empty"));
    const selector = async () => [url("/docs/markdown.md"), url("/docs/missing"), url("/docs/empty")];
    await expect(indexDocSource({ ...source, useAi: true }, { selectPages: selector })).rejects.toThrow("1 page: excluded by noindex");
    expect(getDocsStatus().error).toContain("1 page: HTTP 404");
    expect(getDocsStatus().error).toContain("1 page: no readable documentation content");
    expect(embedding.texts).not.toHaveBeenCalled();
  });

  it("allows AI to narrow the plan but never add a new URL", async () => {
    page("/docs", html(paragraph("Overview"), link("/docs/guide") + link("/docs/api/client")));
    page("/docs/guide"); page("/docs/api/client");
    const selector = vi.fn(async () => [url("/docs/api/client"), url("/docs/not-discovered"), "https://outside.test/secret"]);
    const result = await indexDocSource({ ...source, useAi: true }, { selectPages: selector });
    expect(selector).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ pages: 1, selected: 1 });
    expect((await readIndex()).pages.map(page => page.url)).toEqual([url("/docs/api/client")]);
    expect(requests).not.toContain(url("/docs/guide"));
    expect(requests.some(href => /not-discovered|outside\.test/.test(href))).toBe(false);
  });

  it("falls back to the same finite scoped plan after AI selection fails", async () => {
    page("/docs", html(paragraph("Overview"), link("/docs/guide"))); page("/docs/guide");
    const selector = vi.fn(async () => { throw new Error("Planner unavailable"); });
    expect(await indexDocSource({ ...source, useAi: true }, { selectPages: selector })).toMatchObject({ pages: 2, selected: 2 });
    expect(selector).toHaveBeenCalledTimes(1);
    expect(getDocLogs(source.id).join("\n")).toContain("using the scoped page plan");
  });
});

describe("documentation index transactions and content integrity", () => {
  it("keeps whitespace-sensitive code pages distinct and ignores malformed reuse metadata", async () => {
    page("/docs", html(paragraph("Overview"), ["/docs/a", "/docs/b"].map(href => link(href)).join("")));
    page("/docs/a", html(`<pre>if connected:\n    send_request()\n    close_connection()\n# A complete configuration example used in applications.</pre>`));
    page("/docs/b", html(`<pre>if connected:\n    send_request()\nclose_connection()\n# A complete configuration example used in applications.</pre>`));
    expect((await indexDocSource(source)).pages).toBe(3);
    const previous = await readIndex();
    await fs.writeFile(file(), JSON.stringify({ ...previous, pages: { broken: true }, chunks: [null, ...previous.chunks] }));
    expect((await indexDocSource(source)).pages).toBe(3);
  });

  it("applies changed exclusions to retrieval immediately and rejects an index from a different source", async () => {
    page("/docs", html(paragraph("Overview"), link("/docs/private"))); page("/docs/private");
    await indexDocSource(source);
    setDocSourcesProvider(() => [{ ...source, excludePaths: ["/docs/private"] }]);
    expect((await searchDocs(source.id, "configuration")).map(hit => hit.url)).toEqual([url("/docs")]);
    setDocSourcesProvider(() => [{ ...source, url: "https://other.test/docs" }]);
    await expect(searchDocs(source.id, "configuration")).rejects.toThrow("scope changed");
  });

  it("hashes complete page content, preserving pages with matching first 8k characters", async () => {
    page("/docs", html(paragraph("Overview"), ["/docs/a", "/docs/b", "/docs/duplicate-a"].map(href => link(href)).join("")));
    const shared = "Shared reference example and configuration code. ".repeat(220);
    const a = html(`${shared}Unique endpoint alpha returns a streaming response with alpha event types.`);
    const b = html(`${shared}Unique endpoint beta returns a streaming response with beta event types.`);
    page("/docs/a", a); page("/docs/b", b); page("/docs/duplicate-a", a);
    const result = await indexDocSource(source);
    expect(result.pages).toBe(3);
    const saved = await readIndex();
    expect(saved.pages.map(page => page.url)).toContain(url("/docs/a"));
    expect(saved.pages.map(page => page.url)).toContain(url("/docs/b"));
    expect(saved.pages.map(page => page.url)).not.toContain(url("/docs/duplicate-a"));
    expect(saved.chunks.some(chunk => chunk.text.includes("endpoint alpha"))).toBe(true);
    expect(saved.chunks.some(chunk => chunk.text.includes("endpoint beta"))).toBe(true);
  });

  it("reuses unchanged vectors and refreshes page titles on reindex", async () => {
    const original = html(paragraph("Stable API content")); page("/docs", original);
    await indexDocSource({ ...source, scope: "page" });
    const first = await readIndex();
    embedding.texts.mockClear();
    page("/docs", original.replace("<title>Reference</title>", "<title>Updated Reference Title</title>"));
    await indexDocSource({ ...source, scope: "page" });
    expect(embedding.texts).not.toHaveBeenCalled();
    expect((await readIndex()).chunks.map(chunk => chunk.vec)).toEqual(first.chunks.map(chunk => chunk.vec));
    expect((await readIndex()).chunks[0].title).toBe("Updated Reference Title");
    expect(getDocLogs(source.id).join("\n")).toContain("REUSE");
  });

  it("preserves the old index when a fetch is cancelled and rejects overlapping jobs", async () => {
    await indexDocSource({ ...source, scope: "page" });
    const previous = await fs.readFile(file(), "utf8");
    routes.set(url("/docs"), () => new Promise<Response>(() => {}));
    requests = [];
    const run = indexDocSource({ ...source, scope: "page" });
    const rejected = expect(run).rejects.toThrow(/cancelled/i);
    await vi.waitFor(() => expect(requests).toContain(url("/docs")));
    await expect(indexDocSource({ ...source, id: "second" })).rejects.toThrow("already being indexed");
    expect(cancelDocIndex("different-source")).toBe(false);
    expect(cancelDocIndex(source.id)).toBe(true);
    await rejected;
    expect(await fs.readFile(file(), "utf8")).toBe(previous);
    expect(getDocsStatus()).toMatchObject({ phase: "cancelled", indexing: undefined });
    expect(cancelDocIndex()).toBe(false);
  });

  it("preserves the old index when embedding is cancelled, even if the runtime completes later", async () => {
    await indexDocSource({ ...source, scope: "page" });
    const previous = await fs.readFile(file(), "utf8");
    page("/docs", html(paragraph("Changed content requiring new embeddings")));
    let complete!: (vectors: number[][]) => void;
    embedding.texts.mockClear().mockImplementation(() => new Promise<number[][]>(resolve => { complete = resolve; }));
    const run = indexDocSource({ ...source, scope: "page" });
    const rejected = expect(run).rejects.toThrow(/cancelled/i);
    await vi.waitFor(() => expect(embedding.texts).toHaveBeenCalledTimes(1));
    cancelDocIndex(); await rejected;
    complete([[0, 1, 0]]); await Promise.resolve();
    expect(await fs.readFile(file(), "utf8")).toBe(previous);
    expect((await fs.readdir(storage)).filter(name => name.endsWith(".tmp"))).toEqual([]);
  });

  it("does not replace a good index with an empty or noindex result", async () => {
    await indexDocSource({ ...source, scope: "page" });
    const previous = await fs.readFile(file(), "utf8");
    page("/docs", html("Empty"));
    await expect(indexDocSource({ ...source, scope: "page" })).rejects.toThrow("No readable documentation was indexed");
    expect(await fs.readFile(file(), "utf8")).toBe(previous);
    page("/docs", html(paragraph("New noindex content")), { "x-robots-tag": "noindex" });
    await expect(indexDocSource({ ...source, scope: "page" })).rejects.toThrow("No readable documentation was indexed");
    expect(await fs.readFile(file(), "utf8")).toBe(previous);
  });

  it("keeps the old index when embedding vectors are invalid", async () => {
    await indexDocSource({ ...source, scope: "page" });
    const previous = await fs.readFile(file(), "utf8");
    page("/docs", html(paragraph("Replacement needing embeddings")));
    embedding.texts.mockResolvedValue([[Number.NaN, 0, 0]]);
    await expect(indexDocSource({ ...source, scope: "page" })).rejects.toThrow("Embedding failed");
    expect(await fs.readFile(file(), "utf8")).toBe(previous);
  });

  it("bounds long paragraphs and code blocks without dropping their final content", () => {
    const text = "x".repeat(1600 * 12) + "IMPORTANT_TAIL";
    const chunks = chunkDocText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(chunk => chunk.length <= 1600)).toBe(true);
    expect(chunks.join("")).toBe(text);
    expect(chunkDocText("tiny")).toEqual([]);
  });
});
