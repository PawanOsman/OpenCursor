/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it } from "vitest";
import { createDocPolicy, extractDocPage, extractLlmsLinks, extractSitemapUrls, rankDocCandidates } from "./docsDiscovery";

describe("documentation URL policy", () => {
  it("uses path segments, not prefix substrings, and stays on the source origin", () => {
    const policy = createDocPolicy("https://example.com/docs/");
    expect(policy.startUrl).toBe("https://example.com/docs");
    expect(policy.normalize("guide")).toBe("https://example.com/docs/guide");
    expect(policy.normalize("/docs/reference/client")).toBe("https://example.com/docs/reference/client");
    for (const path of ["/docset", "/docs-old", "/", "https://other.com/docs", "http://example.com/docs", "https://user@example.com/docs", "javascript:alert(1)"]) {
      expect(policy.normalize(path), path).toBeNull();
    }
  });

  it("deduplicates anchors, tracking, trailing slashes, and index pages, but rejects functional queries", () => {
    const policy = createDocPolicy("https://example.com/docs");
    for (const path of ["/docs/guide/", "/docs/guide/index.html", "/docs/guide#usage", "/docs/gu%69de", "/docs/guide?utm_source=menu&gclid=x"]) {
      expect(policy.normalize(path), path).toBe("https://example.com/docs/guide");
    }
    for (const query of ["?page=1", "?page=999999", "?q=docs", "?version=next", "?lang=fr", "?utm_source=nav&sort=desc", "?route=api"]) {
      expect(policy.normalize(`/docs/guide${query}`), query).toBeNull();
    }
  });

  it("keeps HTML seeds within their parent and supports exact page mode", () => {
    const section = createDocPolicy("https://example.com/docs/reference/start.html");
    expect(section.scopePath).toBe("/docs/reference");
    expect(section.allows("https://example.com/docs/reference/client.html")).toBe(true);
    expect(section.allows("https://example.com/docs/guides")).toBe(false);
    const page = createDocPolicy("https://example.com/docs/start.html", { scope: "page" });
    expect(page.normalize("/docs/start.html#install")).toBe(page.startUrl);
    expect(page.normalize("/docs/next.html")).toBeNull();
    const index = createDocPolicy("https://example.com/docs/index.html");
    expect(index.scopePath).toBe("/docs");
  });

  it("accepts narrower scope and exclusions but prevents silently widening it", () => {
    const policy = createDocPolicy("https://example.com/docs", { scopePath: "/docs/guides", excludePaths: ["/docs/guides/advanced/*"] });
    expect(policy.startUrl).toBe("https://example.com/docs/guides");
    expect(policy.allows(policy.startUrl)).toBe(true);
    expect(policy.normalize("start")).toBe("https://example.com/docs/guides/start");
    expect(policy.allows("https://example.com/docs/guides/start")).toBe(true);
    expect(policy.allows("https://example.com/docs/guides/advanced/deep")).toBe(false);
    expect(policy.allows("https://example.com/docs/guides/advanced-basics")).toBe(true);
    for (const scopePath of ["/", "/docset", "https://other.com/docs"]) {
      expect(() => createDocPolicy("https://example.com/docs", { scopePath })).toThrow(/scope/);
    }
    expect(() => createDocPolicy("https://example.com/docs/start", { scope: "page", scopePath: "/docs/start/subpage" })).toThrow(/single-page/);
  });

  it("pins locale and release namespaces to the seed without excluding genuine API paths", () => {
    const unversioned = createDocPolicy("https://example.com/docs");
    for (const path of ["/docs/fr/install", "/docs/en/install", "/docs/v1/install", "/docs/latest/install", "/docs/next/install"]) {
      expect(unversioned.normalize(path), path).toBeNull();
    }
    expect(unversioned.normalize("/docs/reference/v1/auth/login")).not.toBeNull();
    expect(unversioned.normalize("/docs/api/search")).not.toBeNull();
    const versioned = createDocPolicy("https://example.com/en/docs/v2/");
    expect(versioned.normalize("/en/docs/v2/guide")).not.toBeNull();
    expect(versioned.normalize("/en/docs/v1/guide")).toBeNull();
    expect(versioned.normalize("/fr/docs/v2/guide")).toBeNull();
  });

  it("rejects generated archives and asset traps", () => {
    const policy = createDocPolicy("https://example.com/docs");
    for (const route of ["blog/one", "calendar/2026/09", "search", "tags/javascript", "page/1000", "guide/icon.svg", "bundle.js", "source.map", "download.zip", "a%2fb", "a%00b"]) {
      expect(policy.normalize(`/docs/${route}`), route).toBeNull();
    }
    for (let i = 0; i < 2000; i++) expect(policy.normalize(`/docs/list?page=${i}`)).toBeNull();
    expect(policy.normalize("/docs/authentication")).not.toBeNull();
    expect(policy.normalize("/docs/guide.md")).not.toBeNull();
    expect(policy.normalize("/docs/guide.txt")).not.toBeNull();
    expect(policy.normalize("/docs/llms.txt")).toBeNull();
    expect(policy.normalize("/docs/llms-full.txt")).toBeNull();
  });

  it("does not turn a corporate home page into a site-wide crawl", () => {
    const corporate = createDocPolicy("https://example.com/");
    expect(corporate.normalize("/docs")).not.toBeNull();
    expect(corporate.normalize("/guides/client")).not.toBeNull();
    for (const path of ["/products/widget", "/customers/story", "/about", "/pricing", "/blog/code"]) expect(corporate.normalize(path)).toBeNull();
    const docs = createDocPolicy("https://docs.example.com/");
    expect(docs.normalize("/configuration/environment")).not.toBeNull();
    expect(docs.normalize("/blog/news")).toBeNull();
  });
});

describe("documentation content extraction", () => {
  const html = `<!doctype html><html><head><title>Install &amp; run | Example</title>
    <link href="/docs/install/" rel="canonical"><meta content="noindex, follow" name="robots">
    <script>const markup = '<main>wrong</main>';</script></head><body>
    <header>Corporate sales <a href="/pricing">Pricing</a></header>
    <nav><a href="/docs/quickstart">Quick start</a><a href="/docs/api/client">Client API</a></nav>
    <main><article><h1>Install &#x26; run &#128640;</h1><p>Call <code>run()</code> to start.</p>
    <pre><code class="language-ts">if (value &lt; 2) {\n  run(&quot;ok&quot;);\n}</code></pre>
    <p>See <a title="x > y" href="./client?utm_source=docs">the client</a>.</p>
    <aside class="toc">Contents duplicated</aside><div hidden>Hidden text</div>
    <footer>Privacy boilerplate</footer></article></main><footer>Newsletter</footer></body></html>`;

  it("extracts semantic main content, entities, and indented code without chrome", () => {
    const page = extractDocPage(html, "https://example.com/docs/install/", true);
    expect(page.title).toBe("Install & run 🚀");
    expect(page.text).toContain("Call `run()` to start.");
    expect(page.text).toContain('```ts\nif (value < 2) {\n  run("ok");\n}\n```');
    for (const excluded of ["Corporate", "Contents duplicated", "Privacy", "Newsletter", "Hidden text", "wrong"]) expect(page.text).not.toContain(excluded);
    expect(page.canonical).toBe("https://example.com/docs/install/");
    expect(page.noindex).toBe(true);
    expect(page.links.find(link => link.title === "Client API")?.source).toBe("navigation");
    expect(page.links.find(link => link.title === "the client")?.url).toBe("https://example.com/docs/install/client?utm_source=docs");
  });

  it("ignores hidden navigation and script routes, bounds hostile markup, and preserves inline text", () => {
    const page = extractDocPage(`<nav aria-hidden="true"><a href="/hidden">hidden</a></nav><article><p>Use <strong>one</strong> client.</p><script><a href="/trap">x</a></script>${'<div>'.repeat(250)}tail${'</div>'.repeat(250)}</article>`, "https://example.com/docs", true);
    expect(page.links).toHaveLength(0);
    expect(page.text).toContain("Use one client.");
    expect(page.text).toContain("tail");
    expect(page.noindex).toBe(false);
  });

  it("keeps markdown code intact and does not discover example links in fences", () => {
    const text = '# Start\n\n[Client](./client.md)\n\n```md\n[Example](https://other.com/example)\n  indented\n```';
    const page = extractDocPage(text, "https://example.com/docs/start.md", false);
    expect(page.title).toBe("Start");
    expect(page.text).toBe(text);
    expect(page.links).toEqual([{ url: "https://example.com/docs/client.md", title: "Client", source: "link" }]);
  });

  it("bounds link extraction on a generated navigation page", () => {
    const body = `<main>${Array.from({ length: 2500 }, (_, i) => `<a href="/docs/${i}">Page ${i}</a>`).join("")}</main>`;
    expect(extractDocPage(body, "https://example.com/docs", true).links).toHaveLength(1500);
  });
});

describe("curated documentation manifests", () => {
  it("reads sitemap pages and sitemap indexes, CDATA, namespaces, and entities", () => {
    expect(extractSitemapUrls('<?xml version="1.0"?><urlset><url><loc>https://example.com/docs/a</loc></url><url><loc><![CDATA[/docs/b?x=1&y=2]]></loc></url></urlset>', "https://example.com/sitemap.xml")).toEqual({ pages: ["https://example.com/docs/a", "https://example.com/docs/b?x=1&y=2"], sitemaps: [] });
    expect(extractSitemapUrls('<s:sitemapindex xmlns:s="x"><s:sitemap><s:loc>/docs/sitemap.xml</s:loc></s:sitemap></s:sitemapindex>', "https://example.com/sitemap.xml")).toEqual({ pages: [], sitemaps: ["https://example.com/docs/sitemap.xml"] });
  });

  it("rejects entity declarations and unrelated XML and caps sitemap size", () => {
    for (const xml of ['<!DOCTYPE urlset [<!ENTITY x SYSTEM "file:///secret">]><urlset><url><loc>&x;</loc></url></urlset>', '<feed><loc>https://example.com/docs</loc></feed>']) {
      expect(extractSitemapUrls(xml, "https://example.com/")).toEqual({ pages: [], sitemaps: [] });
    }
    const xml = `<urlset>${Array.from({ length: 1700 }, (_, i) => `<url><loc>https://example.com/docs/${i}</loc></url>`).join("")}</urlset>`;
    expect(extractSitemapUrls(xml, "https://example.com/").pages).toHaveLength(1500);
  });

  it("uses llms markdown titles and relative URLs, skipping images and duplicate links", () => {
    expect(extractLlmsLinks('# Docs\n- [**Install**](./install.md): Start here\n- [API](<https://example.com/docs/api>)\n![Image](./logo.png)\n[Again](./install.md)', "https://example.com/docs/llms.txt")).toEqual([
      { url: "https://example.com/docs/install.md", title: "Install", source: "llms" },
      { url: "https://example.com/docs/api", title: "API", source: "llms" },
    ]);
  });

  it("prioritizes focus matches and seed, deduplicates manifests, and returns a finite plan", () => {
    const ranked = rankDocCandidates([
      { url: "https://example.com/docs/unrelated", title: "Other feature", source: "navigation" },
      { url: "https://example.com/docs/client", title: "Client authentication", source: "sitemap" },
      { url: "https://example.com/docs/client/#setup", title: "Client authentication setup", source: "llms" },
      { url: "https://example.com/docs", title: "Docs", source: "seed" },
    ], "How to use client authentication", 3);
    expect(ranked.map(item => item.url)).toEqual(["https://example.com/docs", "https://example.com/docs/client"]);
    expect(ranked[1].source).toBe("llms");
    expect(rankDocCandidates(ranked, "", 1)).toHaveLength(1);
    expect(rankDocCandidates(ranked, "", -1)).toHaveLength(0);
  });

  it("keeps a small setup foundation while excluding unrelated pages from a focused plan", () => {
    const ranked = rankDocCandidates([
      { url: "https://example.com/docs", title: "Docs", source: "seed" },
      { url: "https://example.com/docs/installation", title: "Installation", source: "navigation" },
      { url: "https://example.com/docs/api/authentication", title: "Authentication", source: "sitemap" },
      { url: "https://example.com/docs/billing", title: "Billing", source: "navigation" },
    ], "authentication", 200);
    expect(ranked.map(item => item.title)).toEqual(["Docs", "Authentication", "Installation"]);
  });

  it("recognizes short technical topics without matching substrings in other product names", () => {
    const ranked = rankDocCandidates([
      { url: "https://example.com/docs/go/client", title: "Go client", source: "navigation" },
      { url: "https://example.com/docs/django/client", title: "Django client", source: "navigation" },
      { url: "https://example.com/docs/python/client", title: "Python client", source: "navigation" },
    ], "Go", 200);
    expect(ranked.map(item => item.title)).toEqual(["Go client"]);
  });
});
