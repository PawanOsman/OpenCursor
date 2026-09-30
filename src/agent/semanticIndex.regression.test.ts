/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, stat, utimes } from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import * as semantic from "./semanticIndex";
import * as scan from "./tools/fileScan";
import { indexDocSource, searchDocs, setDocsStorageDir } from "./docsIndex";
import { ApiKeyPool } from "./provider/apiKeyPool";
vi.mock("../runtimeDeps", () => ({ importRuntimeDep: vi.fn() }));
let fixture: string, root: string, storage: string;
let requests: Array<{ endpoint: string; texts: string[] }>;
let fail: (request: number) => boolean;
beforeEach(async () => {
  fixture = await mkdtemp(path.join(tmpdir(), "ocursor-index-"));
  root = path.join(fixture, "workspace"); storage = path.join(fixture, "storage");
  await mkdir(root);
  semantic.setIndexStorageDir(storage);
  semantic.setIndexingEnabled(true);
  semantic.setRemoteEmbedModel({ id: "fixture-model", baseUrl: "https://one.example.test/v1", apiKey: "fixture-key" });
  setDocsStorageDir(storage);
  requests = []; fail = () => false;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    if (!String(url).endsWith("/embeddings")) return new Response("<html><title>Guide</title><p>Use the repository documentation to configure tests and run the application.</p></html>", { headers: { "content-type": "text/html" } });
    const body = JSON.parse(String(init.body));
    requests.push({ endpoint: String(url), texts: body.input });
    if (fail(requests.length)) return new Response("unavailable", { status: 503 });
    return new Response(JSON.stringify({ data: body.input.map((_: string, index: number) => ({ index, embedding: [1, 0, 0] })) }));
  }));
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await rm(fixture, { recursive: true, force: true }); });
async function meta() { const name = (await readdir(storage)).find((n) => n.startsWith("index-") && n.endsWith(".json"))!; return JSON.parse(await readFile(path.join(storage, name), "utf8")); }

describe("production index transactions and retrieval identity", () => {
  it("passes documentation cancellation through to the remote embedding request", async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
      requestSignal = init.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => requestSignal!.addEventListener("abort", () => reject(requestSignal!.reason), { once: true }));
    }));
    const task = semantic.embedTexts(["Documentation page"], controller.signal);
    const rejected = expect(task).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(new DOMException("Cancelled", "AbortError"));
    await rejected;
    expect(requestSignal?.aborted).toBe(true);
  });

  it("balances remote embedding keys and fails over before returning vectors", async () => {
    const baseUrl = "https://one.example.test/v1";
    const pool = new ApiKeyPool("embed", baseUrl, async () => ({ balance: "round-robin", credentials: [
      { id: "expired", apiKey: "expired-key", legacy: false },
      { id: "work", apiKey: "work-key", legacy: false },
      { id: "backup", apiKey: "backup-key", legacy: false },
    ] }));
    semantic.setRemoteEmbedModel({ id: "fixture-model", baseUrl, apiKey: "unused-legacy", apiKeyPool: pool });
    const fingerprint = semantic.getEmbedFingerprint();
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const key = new Headers(init.headers).get("authorization")!;
      seen.push(key);
      return key === "Bearer expired-key"
        ? new Response("invalid", { status: 401 })
        : new Response(JSON.stringify({ data: [{ index: 0, embedding: [3, 0, 0] }] }));
    }));
    expect(await semantic.embedQuery("first query")).toEqual([1, 0, 0]);
    expect(await semantic.embedQuery("next query")).toEqual([1, 0, 0]);
    expect(seen).toEqual(["Bearer expired-key", "Bearer work-key", "Bearer backup-key"]);
    expect(semantic.getEmbedFingerprint()).toBe(fingerprint);
  });

  it("never pairs old embeddings and line coordinates with newly changed file contents", async () => {
    const target = path.join(root, "fresh.ts");
    await writeFile(target, "export const original = 1;");
    await semantic.buildIndex(root);
    expect((await semantic.search(root, "original"))[0]?.text).toContain("original");
    const before = await stat(target);
    // Same byte length and restored timestamps defeat metadata-only freshness checks.
    await writeFile(target, "export const replaced = 2;");
    await utimes(target, before.atime, before.mtime);
    expect(await semantic.search(root, "original")).toEqual([]);
    await semantic.upsertFile(root, "fresh.ts");
    expect((await semantic.search(root, "replaced"))[0]?.text).toContain("replaced");
    expect((await meta()).files["fresh.ts"]).toMatch(/:[a-f0-9]{64}$/);
  });
  it("retries unchanged files after embedding failed", async () => {
    await writeFile(path.join(root, "a.ts"), "export const a = 1;");
    fail = () => true;
    await semantic.buildIndex(root);
    expect(semantic.getStatus(root)).toMatchObject({ files: 0, chunks: 0 });
    fail = () => false;
    await semantic.buildIndex(root);
    expect(requests).toHaveLength(2);
    expect(semantic.getStatus(root)).toMatchObject({ files: 1, chunks: 1 });
  });

  it("retains the old file vectors and hash until all replacement batches succeed", async () => {
    await writeFile(path.join(root, "a.ts"), "export const a = 1;");
    await semantic.buildIndex(root);
    const before = await meta();
    await writeFile(path.join(root, "a.ts"), Array.from({ length: 3000 }, (_, i) => `export const line${i} = ${i};`).join("\n"));
    fail = (n) => n === 3;
    await semantic.buildIndex(root);
    expect(requests.length).toBeGreaterThan(3);
    expect((await meta()).files).toEqual(before.files);
    expect(semantic.getStatus(root).chunks).toBe(1);
    fail = () => false;
    await semantic.buildIndex(root);
    expect(semantic.getStatus(root).chunks).toBeGreaterThan(1);
    expect((await meta()).files).not.toEqual(before.files);
  });

  it("applies root, nested and Cursor ignore policies before incremental remote embedding", async () => {
    await mkdir(path.join(root, "private")); await mkdir(path.join(root, "nested"));
    await writeFile(path.join(root, ".gitignore"), "private/\n");
    await writeFile(path.join(root, ".cursorignore"), "cursor-private.ts\n");
    await writeFile(path.join(root, "nested", ".gitignore"), "*.ts\n!keep.ts\n");
    for (const rel of ["private/secret.ts", "nested/secret.ts", "cursor-private.ts", "nested/keep.ts"]) await writeFile(path.join(root, rel), `export const marker = '${rel}';`);
    await semantic.buildIndex(root);
    expect(semantic.getStatus(root).files).toBe(1);
    const count = requests.length;
    for (const rel of ["private/secret.ts", "nested/secret.ts", "cursor-private.ts"]) await semantic.upsertFile(root, rel);
    expect(requests).toHaveLength(count);
    expect(requests.flatMap((r) => r.texts).join("\n")).toContain("nested/keep.ts");
    expect(requests.flatMap((r) => r.texts).join("\n")).not.toContain("secret.ts");
  });

  it("excludes symlinks that point outside the workspace", async () => {
    await writeFile(path.join(fixture, "outside.ts"), "export const privateValue = 'outside';");
    await symlink(path.join(fixture, "outside.ts"), path.join(root, "linked.ts"));
    await semantic.upsertFile(root, "linked.ts");
    await semantic.buildIndex(root);
    expect(requests).toHaveLength(0);
  });

  it("stops serving newly ignored content before the watcher rebuild completes", async () => {
    await writeFile(path.join(root, "private.ts"), "export const secret = 'private content';");
    await semantic.buildIndex(root);
    expect((await semantic.search(root, "private content")).length).toBe(1);
    await writeFile(path.join(root, ".gitignore"), "private.ts\n");
    expect(await semantic.search(root, "private content")).toEqual([]);
  });

  it("does not embed an ignored file through an in-workspace symlink alias", async () => {
    await mkdir(path.join(root, "private"));
    await writeFile(path.join(root, ".gitignore"), "private/\n");
    await writeFile(path.join(root, "private", "secret.ts"), "export const secret = 'keep private';");
    await symlink(path.join(root, "private", "secret.ts"), path.join(root, "alias.ts"));
    await semantic.upsertFile(root, "alias.ts");
    await semantic.buildIndex(root);
    expect(requests).toHaveLength(0);
  });

  it("does not delete unseen indexed files when a full scan was truncated", async () => {
    await writeFile(path.join(root, "a.ts"), "export const a = 1;");
    await writeFile(path.join(root, "b.ts"), "export const b = 2;");
    await semantic.buildIndex(root);
    const complete = await scan.scanFiles(root);
    vi.spyOn(scan, "scanFiles").mockResolvedValueOnce({ files: complete.files.slice(0, 1), truncated: true });
    await semantic.buildIndex(root);
    expect(semantic.getStatus(root).files).toBe(2);
    expect(semantic.getStatus(root).chunks).toBe(2);
  });

  it("keeps code vector spaces separate for the same model on different endpoints", async () => {
    await writeFile(path.join(root, "a.ts"), "export const a = 1;");
    await semantic.buildIndex(root);
    const fingerprint = semantic.getEmbedFingerprint();
    semantic.setRemoteEmbedModel({ id: "fixture-model", baseUrl: "https://two.example.test/v1", apiKey: "another-key" });
    expect(semantic.getEmbedFingerprint()).not.toBe(fingerprint);
    expect((await semantic.warmIndex(root)).files).toBe(0);
    semantic.setRemoteEmbedModel({ id: "fixture-model", baseUrl: "https://one.example.test/v1", apiKey: "rotated-key" });
    expect((await semantic.warmIndex(root)).files).toBe(1);
    expect(semantic.getEmbedFingerprint()).toBe(fingerprint);
  });

  it("rejects stale documentation vectors before requesting a query embedding", async () => {
    await indexDocSource({ id: "guide", name: "Guide", url: "https://docs.example.test/guide", maxPages: 1 });
    expect((await searchDocs("guide", "configuration")).length).toBeGreaterThan(0);
    semantic.setRemoteEmbedModel({ id: "fixture-model", baseUrl: "https://two.example.test/v1", apiKey: "key" });
    const count = requests.length;
    await expect(searchDocs("guide", "configuration")).rejects.toThrow("Reindex this source");
    expect(requests).toHaveLength(count);
  });
});
