/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, expect, it, vi } from "vitest";
import { aborted, fetchDocResource, parseDocRobots, DocLimitError, type DocFetchBudget } from "./docsFetch";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const budget = (maxRequests = 10): DocFetchBudget => ({ requests: 0, maxRequests, bytes: 0, maxBytes: 8 * 1024 * 1024 });
const allowed = (url: string) => url.startsWith("https://docs.test/guide");
const options = (signal = new AbortController().signal, counts = budget()) => ({ signal, budget: counts, allowUrl: allowed });

it("checks each redirect destination before requesting it", async () => {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 302, headers: { location: "https://outside.test/trap" } }));
  vi.stubGlobal("fetch", fetch);
  await expect(fetchDocResource("https://docs.test/guide", options())).rejects.toThrow("Outside documentation scope");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
});

it("deduplicates redirect loops and resolves relative links using the final response URL", async () => {
  const fetch = vi.fn(async (url: string) => url.endsWith("/guide")
    ? new Response(null, { status: 301, headers: { location: "/guide/" } })
    : new Response("<main>Read the guide.</main>", { headers: { "content-type": "text/html" } }));
  vi.stubGlobal("fetch", fetch);
  expect(await fetchDocResource("https://docs.test/guide", options())).toMatchObject({ url: "https://docs.test/guide/", isHtml: true });
  fetch.mockImplementation(async () => new Response(null, { status: 302, headers: { location: "/guide" } }));
  await expect(fetchDocResource("https://docs.test/guide", options())).rejects.toThrow("redirect loop");
});

it("counts retry attempts against the request budget", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(async () => new Response(null, { status: 503, headers: { "retry-after": "0" } }));
  vi.stubGlobal("fetch", fetch);
  const counts = budget(1);
  const check = expect(fetchDocResource("https://docs.test/guide", options(undefined, counts))).rejects.toBeInstanceOf(DocLimitError);
  await vi.advanceTimersByTimeAsync(300);
  await check;
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(counts.requests).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps the deadline alive until a stalled response body stops", async () => {
  vi.useFakeTimers();
  const cancelled = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ cancel: cancelled }), { headers: { "content-type": "text/html" } })));
  const check = expect(fetchDocResource("https://docs.test/guide", options())).rejects.toThrow("Timed out");
  await vi.advanceTimersByTimeAsync(15_001);
  await check;
  expect(cancelled).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("cancels immediately even when a fetch adapter does not honor AbortSignal", async () => {
  const controller = new AbortController();
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  const task = fetchDocResource("https://docs.test/guide", options(controller.signal));
  const check = expect(task).rejects.toMatchObject({ name: "AbortError" });
  controller.abort(aborted());
  await check;
});

it("bounds streamed response bytes even without Content-Length", async () => {
  const cancelled = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); }, cancel: cancelled,
  }), { headers: { "content-type": "text/html" } })));
  await expect(fetchDocResource("https://docs.test/guide", options())).rejects.toThrow("response size limit");
  expect(cancelled).toHaveBeenCalled();
});

it("enforces a shared download budget and refuses binary pages", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("documentation text", { headers: { "content-type": "text/plain" } })));
  const counts = budget(); counts.maxBytes = 4;
  await expect(fetchDocResource("https://docs.test/guide", options(undefined, counts))).rejects.toBeInstanceOf(DocLimitError);
  vi.stubGlobal("fetch", vi.fn(async () => new Response("binary", { headers: { "content-type": "application/pdf" } })));
  await expect(fetchDocResource("https://docs.test/guide", options())).rejects.toThrow("Unsupported documentation");
});

it("reports header noindex and permits markdown documentation", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("# Configuration\nUse these options.", { headers: { "content-type": "text/markdown", "x-robots-tag": "noindex, follow" } })));
  expect(await fetchDocResource("https://docs.test/guide", options())).toMatchObject({ isHtml: false, noindex: true });
});

it("merges matching robots groups, uses longest rules and lets Allow win ties", () => {
  const robots = parseDocRobots("User-agent: *\nDisallow: /\nUser-agent: OpenCursor-Docs\nDisallow: /private\nAllow: /private/public\nUser-agent: OpenCursor-Docs\nDisallow: /equal\nAllow: /equal\nSitemap: https://docs.test/sitemap.xml");
  expect(robots.allows("https://docs.test/guide")).toBe(true);
  expect(robots.allows("https://docs.test/private/secret")).toBe(false);
  expect(robots.allows("https://docs.test/private/public/guide")).toBe(true);
  expect(robots.allows("https://docs.test/equal")).toBe(true);
  expect(robots.sitemaps).toEqual(["https://docs.test/sitemap.xml"]);
});

it("does not merge the wildcard group into a specific group with empty directives", () => {
  const robots = parseDocRobots("User-agent: OpenCursor-Docs\nDisallow:\nUser-agent: *\nDisallow: /");
  expect(robots.allows("https://docs.test/guide")).toBe(true);
});

it("honors robots wildcards, terminal matches and encoded paths", () => {
  const robots = parseDocRobots("User-agent: *\nDisallow: /old/*/download$\nDisallow: /%70rivate\nDisallow: /日本語\nAllow: /private/public");
  expect(robots.allows("https://docs.test/old/v1/download")).toBe(false);
  expect(robots.allows("https://docs.test/old/v1/download/help")).toBe(true);
  expect(robots.allows("https://docs.test/private/file")).toBe(false);
  expect(robots.allows("https://docs.test/%E6%97%A5%E6%9C%AC%E8%AA%9E")).toBe(false);
  expect(robots.allows("https://docs.test/private/public")).toBe(true);
});

it("recognizes explicit AI retrieval permission separately from crawl access", () => {
  const robots = parseDocRobots("Sitemap: https://docs.test/sitemap.xml\nUser-agent: *\nContent-Signal: ai-train=yes, search=yes, ai-input=yes\nAllow: /\nDisallow: /handoff");
  expect(robots.aiInputAllowed).toBe(true);
  expect(robots.aiInputAllowedFor("https://docs.test/payments.md")).toBe(true);
  expect(robots.allows("https://docs.test/payments.md")).toBe(true);
  expect(robots.allows("https://docs.test/handoff")).toBe(false);
});

it("does not infer retrieval permission from other categories or malformed values", () => {
  for (const content of ["", "ai-train=yes, search=yes", "ai-input=true", "ai-input=yes please", "x-ai-input=yes", "/private/ai-input=yes"]) {
    const robots = parseDocRobots(`User-agent: *\nContent-Signal: ${content}\nAllow: /`);
    expect(robots.aiInputAllowed, content).toBeUndefined();
    expect(robots.aiInputAllowedFor("https://docs.test/guide"), content).toBeUndefined();
  }
});

it("separates signal-only agent groups and applies only matching agents", () => {
  const robots = parseDocRobots("User-agent: OtherBot\nContent-Signal: ai-input=no\nUser-agent: *\nContent-Signal: ai-input=no\nUser-agent: OpenCursor-Docs\nContent-Signal: AI-INPUT = YES");
  expect(robots.aiInputAllowed).toBe(true);
  expect(robots.aiInputAllowedFor("https://docs.test/guide")).toBe(true);
  const other = parseDocRobots("User-agent: OtherBot\nContent-Signal: ai-input=yes\nUser-agent: *\nAllow: /");
  expect(other.aiInputAllowed).toBeUndefined();
});

it("gives denial precedence for conflicting signals at the same scope", () => {
  for (const values of ["yes, ai-input=no", "no, ai-input=yes"]) {
    const robots = parseDocRobots(`User-agent: *\nContent-Signal: ai-input=${values}\nAllow: /`);
    expect(robots.aiInputAllowed).toBe(false);
  }
  const robots = parseDocRobots("User-agent: OpenCursor-Docs\nContent-Signal: ai-input=no\nUser-agent: OpenCursor-Docs\nContent-Signal: ai-input=yes");
  expect(robots.aiInputAllowed).toBe(false);
});

it("uses path-specific restrictions and exceptions without changing unrelated paths", () => {
  const denyPrivate = parseDocRobots("User-agent: *\nContent-Signal: ai-input=yes\nContent-Signal: /private/ ai-input=no\nAllow: /");
  expect(denyPrivate.aiInputAllowed).toBe(true);
  expect(denyPrivate.aiInputAllowedFor("https://docs.test/private/guide")).toBe(false);
  expect(denyPrivate.aiInputAllowedFor("https://docs.test/private-other/guide")).toBe(true);
  const allowPublic = parseDocRobots("User-agent: *\nContent-Signal: ai-input=no\nContent-Signal: /public/ ai-input=yes\nContent-Signal: /public/internal/ ai-input=no\nAllow: /");
  expect(allowPublic.aiInputAllowed).toBe(false);
  expect(allowPublic.aiInputAllowedFor("https://docs.test/public/guide")).toBe(true);
  expect(allowPublic.aiInputAllowedFor("https://docs.test/public/internal/guide")).toBe(false);
  expect(allowPublic.aiInputAllowedFor("https://docs.test/other")).toBe(false);
});

it("applies global declarations and preserves undefined for unspecified paths", () => {
  const global = parseDocRobots("Content-Signal: ai-input=yes\nUser-agent: *\nAllow: /\nContent-Signal: /private/ ai-input=no");
  expect(global.aiInputAllowed).toBe(true);
  expect(global.aiInputAllowedFor("https://docs.test/guide")).toBe(true);
  expect(global.aiInputAllowedFor("https://docs.test/private/guide")).toBe(false);
  const scoped = parseDocRobots("User-agent: *\nContent-Signal: /%70rivate/ ai-input=no\nAllow: /");
  expect(scoped.aiInputAllowed).toBeUndefined();
  expect(scoped.aiInputAllowedFor("https://docs.test/guide")).toBeUndefined();
  expect(scoped.aiInputAllowedFor("https://docs.test/private/guide")).toBe(false);
});
