/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scanFiles } from "./fileScan";
import { nextShellId, notifyShellSettled, pushShellOutput, waitForShell, type BgShell } from "./shared";

vi.mock("vscode", () => ({ workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } }));

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "oc-perf-")); roots.push(root);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

describe("scanFiles ignore rules per directory", () => {
  it("applies ancestor rules in order and never leaks sibling rules", async () => {
    const root = tree({
      ".gitignore": "*.log\nbuild/\n",
      "a/.gitignore": "!keep.log\nsecret.txt\n",
      "a/keep.log": "", "a/drop.log": "", "a/secret.txt": "", "a/ok.txt": "",
      "a/deep/keep.log": "", "a/deep/.cursorignore": "local.txt\n", "a/deep/local.txt": "", "a/deep/build/x.txt": "",
      "b/keep.log": "", "b/secret.txt": "", "b/local.txt": "",
      "c/.gitignore": "*.txt\n", "c/d/.gitignore": "!kept.txt\n", "c/d/kept.txt": "", "c/d/other.txt": "",
    });
    const rels = (await scanFiles(root)).files.map((f) => f.rel).filter((rel) => !rel.endsWith("ignore")).sort();
    expect(rels).toEqual(["a/deep/keep.log", "a/keep.log", "a/ok.txt", "b/local.txt", "b/secret.txt", "c/d/kept.txt"]);
  });

  it("can disable ignore files entirely", async () => {
    const root = tree({ ".gitignore": "*.log\n", "a/.gitignore": "x.txt\n", "a/x.txt": "", "a/y.log": "" });
    const rels = (await scanFiles(root, { useGitignore: false })).files.map((f) => f.rel).sort();
    expect(rels).toEqual([".gitignore", "a/.gitignore", "a/x.txt", "a/y.log"]);
  });
});

describe("waitForShell wake-ups", () => {
  const job = (): BgShell => ({ id: nextShellId(), command: "x", output: "", outputChars: 0, done: false, exitCode: null, startedAt: Date.now(), status: "running" });

  it("resolves as soon as the job is marked settled, without waiting for a poll", async () => {
    const sh = job();
    const started = performance.now();
    const waiting = waitForShell(sh, 10_000);
    setTimeout(() => { sh.done = true; notifyShellSettled(sh); }, 5);
    await waiting;
    expect(performance.now() - started).toBeLessThan(200);
    expect(sh.settleListeners?.size ?? 0).toBe(0);
  });

  it("still notices a job settled without notification and matches retained and arriving output", async () => {
    const sh = job();
    pushShellOutput(sh, "server listening on 3000\n");
    await waitForShell(sh, 10_000, /listening on \d+/);
    const arriving = waitForShell(sh, 10_000, /compiled successfully/);
    pushShellOutput(sh, "compiled succ");
    pushShellOutput(sh, "essfully\n");
    await arriving;
    expect(sh.outputListeners?.size ?? 0).toBe(0);
    const silent = waitForShell(sh, 10_000);
    sh.done = true;
    const started = performance.now();
    await silent;
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
