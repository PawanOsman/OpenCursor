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
import { pathToFileURL } from "node:url";
import * as semantic from "./semanticIndex";
import { importRuntimeDep, resolveRuntimeDepEntry } from "../runtimeDeps";

vi.mock("../runtimeDeps", () => ({ importRuntimeDep: vi.fn(), resolveRuntimeDepEntry: vi.fn() }));

// Stand-in for @huggingface/transformers, loaded by the real embedding worker.
const FAKE_TRANSFORMERS = `
import { isMainThread } from "node:worker_threads";
export const env = {};
export async function pipeline(task, repo, options) {
  const provider = options.session_options.executionProviders?.[0];
  if (provider && provider.deviceId === 9) throw new Error("The object was not found.");
  const run = async (texts) => {
    if (texts.includes("crash")) process.exit(3);
    const dim = 4, data = new Float32Array(texts.length * dim);
    for (let r = 0; r < texts.length; r++) {
      data[r * dim] = isMainThread ? 1 : 2;
      data[r * dim + 1] = options.session_options.intraOpNumThreads;
      data[r * dim + 2] = options.device === "cpu" ? 1 : 0;
      data[r * dim + 3] = provider ? 10 + provider.deviceId : 0;
    }
    return { data, dims: [texts.length, dim], dispose() {} };
  };
  run.dispose = async () => {};
  return run;
}
`;

let fixture: string;
beforeEach(async () => {
  fixture = await fs.mkdtemp(path.join(tmpdir(), "ocursor-embed-worker-"));
  const entry = path.join(fixture, "fake-transformers.mjs");
  await fs.writeFile(entry, FAKE_TRANSFORMERS);
  vi.mocked(resolveRuntimeDepEntry).mockResolvedValue(pathToFileURL(entry).href);
  semantic.setIndexStorageDir(path.join(fixture, "storage"));
  semantic.setIndexingEnabled(true);
  semantic.setEmbedModel("minilm");
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  semantic.setEmbedAccelerator("cpu");
  await semantic.releaseEmbedder();
  semantic.setIndexingEnabled(false);
  vi.restoreAllMocks();
  await fs.rm(fixture, { recursive: true, force: true });
});

describe("embedding worker", () => {
  it("runs inference off the extension host thread with a capped CPU session", async () => {
    const vector = await semantic.embedQuery("find the parser");
    expect(vector).toEqual([2, semantic.cpuThreadBudget(), 1, 0]);
    expect(semantic.getEmbedDevice()).toBe("cpu");
    expect(importRuntimeDep).not.toHaveBeenCalled();
    expect(await semantic.embedTexts(["a", "b", "c"])).toHaveLength(3);
  });

  it("replaces a crashed worker on the next request", async () => {
    await expect(semantic.embedTexts(["crash"])).rejects.toThrow("exited");
    expect(await semantic.embedQuery("after crash")).toEqual([2, semantic.cpuThreadBudget(), 1, 0]);
  });
});

// DirectML on Windows, CUDA on Linux x64; Core ML has no adapter index.
const gpuBackend = process.platform === "win32" ? "dml" : process.platform === "linux" && process.arch === "x64" ? "cuda" : null;

describe.skipIf(!gpuBackend)("embedding device selection", () => {
  it("defaults to the CPU", async () => {
    expect(await semantic.embedQuery("cpu by default")).toEqual([2, semantic.cpuThreadBudget(), 0 + 1, 0]);
    expect(semantic.getEmbedAcceleratorId()).toBe("cpu");
  });

  it("pins the session to the selected GPU adapter", async () => {
    semantic.setEmbedAccelerator(`${gpuBackend}:2`, "Test GPU");
    expect(await semantic.embedQuery("on the gpu")).toEqual([2, semantic.cpuThreadBudget(), 0, 12]);
    expect(semantic.getEmbedDevice()).toBe(gpuBackend);
    const status = semantic.getStatus(fixture);
    expect(status.acceleratorId).toBe(`${gpuBackend}:2`);
    expect(status.accelerator).toBe("gpu");
    expect(status.deviceLabel).toContain("Test GPU");
    expect(status.acceleratorError).toBeUndefined();
  });

  it("falls back to the CPU and reports why when the GPU cannot load", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    semantic.setEmbedAccelerator(`${gpuBackend}:9`, "Missing GPU");
    expect(await semantic.embedQuery("fallback")).toEqual([2, semantic.cpuThreadBudget(), 1, 0]);
    const status = semantic.getStatus(fixture);
    expect(status.device).toBe("cpu");
    expect(status.acceleratorError).toContain("not found");
    expect(status.deviceLabel).toBe("CPU (selected GPU unavailable)");
  });

  it("switching back to CPU reloads the session", async () => {
    semantic.setEmbedAccelerator(`${gpuBackend}:1`, "Test GPU");
    expect((await semantic.embedQuery("gpu"))?.[3]).toBe(11);
    semantic.setEmbedAccelerator("cpu");
    expect((await semantic.embedQuery("cpu"))?.[3]).toBe(0);
    expect(semantic.getEmbedDevice()).toBe("cpu");
  });
});
