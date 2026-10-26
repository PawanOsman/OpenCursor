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
  const run = async (texts) => {
    if (texts.includes("crash")) process.exit(3);
    const dim = 4, data = new Float32Array(texts.length * dim);
    for (let r = 0; r < texts.length; r++) {
      data[r * dim] = isMainThread ? 1 : 2;
      data[r * dim + 1] = options.session_options.intraOpNumThreads;
      data[r * dim + 2] = options.device === "cpu" ? 1 : 0;
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
