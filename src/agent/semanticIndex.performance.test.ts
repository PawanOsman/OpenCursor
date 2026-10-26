/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import * as semantic from "./semanticIndex";
import * as scan from "./tools/fileScan";
import { importRuntimeDep } from "../runtimeDeps";

vi.mock("../runtimeDeps", () => ({ importRuntimeDep: vi.fn() }));
vi.mock("fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile), readFile: vi.fn(actual.readFile) };
});
let fixture: string, root: string;
let dispose: ReturnType<typeof vi.fn>;
let pipeline: ReturnType<typeof vi.fn>;
let run: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  fixture = await fs.mkdtemp(path.join(tmpdir(), "ocursor-index-perf-"));
  root = path.join(fixture, "workspace");
  await fs.mkdir(root);
  semantic.setIndexStorageDir(path.join(fixture, "storage"));
  semantic.setIndexingEnabled(true);
  semantic.setEmbedModel("minilm");
  dispose = vi.fn(async () => {});
  run = vi.fn(async (texts: string[]) => ({ tolist: () => texts.map(() => Array.from({ length: 384 }, (_, i) => Number(i === 0))), dispose: vi.fn() }));
  pipeline = vi.fn(async () => Object.assign(run, { dispose }));
  vi.mocked(importRuntimeDep).mockResolvedValue({ env: {}, pipeline });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  await semantic.releaseEmbedder();
  semantic.setIndexingEnabled(false);
  vi.useRealTimers();
  vi.restoreAllMocks();
  await fs.rm(fixture, { recursive: true, force: true });
});

describe("semantic indexing resource budgets", () => {
  it("does not load a native model for an empty or disabled index search", async () => {
    expect(await semantic.search(root, "find code")).toEqual([]);
    semantic.setIndexingEnabled(false);
    expect(await semantic.search(root, "find code")).toEqual([]);
    expect(pipeline).not.toHaveBeenCalled();
  });

  it("releases the native session after one idle minute and lazily restores it", async () => {
    vi.useFakeTimers();
    await semantic.embedQuery("first");
    await vi.advanceTimersByTimeAsync(59_999);
    expect(dispose).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(semantic.getEmbedDevice()).toBe(null);
    await semantic.embedQuery("second");
    expect(pipeline).toHaveBeenCalledTimes(2);
  });

  it("serializes native inference and waits for in-flight work before disposal", async () => {
    let finish!: () => void;
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { finish = resolve; });
    let concurrent = 0, peak = 0;
    run.mockImplementation(async () => {
      concurrent++;
      peak = Math.max(peak, concurrent);
      started();
      await gate;
      concurrent--;
      return { tolist: () => [[1, 0]], dispose: vi.fn() };
    });
    const first = semantic.embedQuery("first");
    await entered;
    const second = semantic.embedQuery("second");
    const release = semantic.releaseEmbedder();
    await Promise.resolve();
    expect(dispose).not.toHaveBeenCalled();
    finish();
    await Promise.all([first, second, release]);
    expect(peak).toBe(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("frees the local session when switching to remote embeddings", async () => {
    await semantic.embedQuery("local query");
    semantic.setRemoteEmbedModel({ id: "remote", apiKey: "fixture", baseUrl: "https://example.test/v1" });
    await semantic.releaseEmbedder();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("does not preallocate vectors for the entire discovered workspace", async () => {
    const target = path.join(root, "a.ts");
    await fs.writeFile(target, "export const a = 1;");
    const info = await fs.stat(target);
    vi.spyOn(scan, "scanFiles").mockResolvedValue({ files: Array.from({ length: 100_000 }, (_, i) => ({
      rel: i ? `file-${i}.ts` : "a.ts", abs: i ? path.join(root, `file-${i}.ts`) : target,
      size: info.size, mtimeMs: info.mtimeMs,
    })), truncated: false });
    const stop = new Error("stop after first progress event");
    let allocated = Infinity;
    await expect(semantic.buildIndex(root, () => {
      allocated = semantic.getStatus(root).vectorBytes;
      throw stop;
    })).rejects.toBe(stop);
    expect(allocated).toBeLessThan(1024 * 1024);
  });

  it("batches changed files into one embedding pass and one persisted snapshot", async () => {
    await fs.writeFile(path.join(root, "a.ts"), "export const a = 1;");
    await fs.writeFile(path.join(root, "b.ts"), "export const b = 2;");
    const write = vi.mocked(fs.writeFile).mockClear();
    await semantic.applyFileChanges(root, new Map([["a.ts", "up"], ["b.ts", "up"]]));
    expect(run).toHaveBeenCalledTimes(1);
    expect(semantic.getStatus(root)).toMatchObject({ files: 2, chunks: 2 });
    expect(write.mock.calls.filter(([file]) => String(file).endsWith(".tmp"))).toHaveLength(2);
    write.mockClear();
    await semantic.applyFileChanges(root, new Map([["a.ts", "up"], ["b.ts", "up"]]));
    expect(run).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
  });

  it("keeps a quantised model on a thread-capped CPU session", async () => {
    await semantic.embedQuery("query");
    expect(pipeline).toHaveBeenCalledTimes(1);
    expect(pipeline.mock.calls[0][2]).toMatchObject({ dtype: "q8", device: "cpu", session_options: { intraOpNumThreads: semantic.cpuThreadBudget(), interOpNumThreads: 1 } });
    expect([1, 2, 4, 8, 16, 32, 64].map(cores => semantic.cpuThreadBudget(cores))).toEqual([1, 1, 1, 2, 4, 4, 4]);
  });

  it("does not re-embed a saved file whose content is unchanged", async () => {
    const target = path.join(root, "a.ts");
    await fs.writeFile(target, "export const a = 1;");
    await semantic.applyFileChanges(root, new Map([["a.ts", "up"]]));
    expect(run).toHaveBeenCalledTimes(1);
    const later = new Date(Date.now() + 60_000);
    await fs.utimes(target, later, later); // git checkout / save without edits
    await semantic.applyFileChanges(root, new Map([["a.ts", "up"]]));
    await semantic.upsertFile(root, "a.ts");
    await semantic.buildIndex(root);
    expect(run).toHaveBeenCalledTimes(1);
    expect(semantic.getStatus(root)).toMatchObject({ files: 1, chunks: 1 });
  });

  it("re-embeds only the chunks an edit touched", async () => {
    const lines = Array.from({ length: 300 }, (_, i) => `export const value${i} = ${i};`);
    await fs.writeFile(path.join(root, "big.ts"), lines.join("\n"));
    await semantic.applyFileChanges(root, new Map([["big.ts", "up"]]));
    const embedded = () => run.mock.calls.reduce((n, [texts]) => n + (texts as string[]).length, 0);
    const initial = embedded();
    const chunks = semantic.getStatus(root).chunks;
    expect(initial).toBe(chunks);
    lines[5] = "export const value5 = 'edited';";
    await fs.writeFile(path.join(root, "big.ts"), lines.join("\n"));
    await semantic.applyFileChanges(root, new Map([["big.ts", "up"]]));
    expect(embedded() - initial).toBe(1); // only the window containing line 6
    expect(semantic.getStatus(root).chunks).toBe(chunks);
  });

  it("holds background embedding batches while the user is typing", async () => {
    await fs.writeFile(path.join(root, "a.ts"), "export const a = 1;");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(Date.now() - 60_000); // keep the activity mark in the past for later tests
    semantic.noteUserActivity();
    const update = semantic.applyFileChanges(root, new Map([["a.ts", "up"]]));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    await update;
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized stored vectors before reading them into host memory", async () => {
    await fs.writeFile(path.join(root, "a.ts"), "export const a = 1;");
    await semantic.buildIndex(root);
    const storage = path.join(fixture, "storage");
    const vectorPath = path.join(storage, (await fs.readdir(storage)).find(file => file.endsWith(".vec"))!);
    await fs.truncate(vectorPath, 65 * 1024 * 1024);
    semantic.setIndexingEnabled(false);
    semantic.setIndexingEnabled(true);
    const read = vi.mocked(fs.readFile).mockClear();
    expect(await semantic.warmIndex(root)).toMatchObject({ files: 0, chunks: 0, vectorBytes: 0 });
    expect(read.mock.calls.some(([file]) => String(file) === vectorPath)).toBe(false);
  });
});
