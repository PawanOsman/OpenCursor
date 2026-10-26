/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import * as path from "path";

vi.mock("vscode", () => ({}));
const pending = vi.hoisted(() => ({ paths: [] as string[], accept: vi.fn() }));
vi.mock("../stores/pendingChanges", () => ({ pendingChanges: { list: () => pending.paths.map((p) => ({ path: p })), accept: pending.accept } }));
vi.mock("../context/workspaceUtils", () => ({ safePath: (p: string) => p }));

import { isInsideRoot, owningRoot, syncRepository } from "./gitSync";

const root = path.resolve("/work/app");
afterEach(() => { pending.accept.mockClear(); pending.paths = []; });

describe("git repository ownership", () => {
  it("requires a path separator boundary", () => {
    expect(isInsideRoot(path.join(root, "src", "a.ts"), root)).toBe(true);
    expect(isInsideRoot(root, root)).toBe(true);
    expect(isInsideRoot(path.resolve("/work/app-other/a.ts"), root)).toBe(false);
    expect(isInsideRoot(path.join(root, "a.ts"), "")).toBe(false);
  });

  it.runIf(process.platform === "win32")("compares Windows paths case-insensitively", () => {
    expect(isInsideRoot(path.join(root.toUpperCase(), "a.ts"), root)).toBe(true);
  });

  it("lets only the deepest nested repository own a file", () => {
    const nested = path.join(root, "vendor", "lib");
    const roots = [root, nested];
    expect(owningRoot(path.join(nested, "x.ts"), roots)).toBe(nested);
    expect(owningRoot(path.join(root, "vendor", "libx", "x.ts"), roots)).toBe(root);
    expect(owningRoot(path.resolve("/elsewhere/x.ts"), roots)).toBeUndefined();
  });
});

describe("git state sync", () => {
  const file = path.join(root, "src", "edited.ts");
  const nested = path.join(root, "vendor", "lib");
  const nestedFile = path.join(nested, "x.ts");
  const change = (p: string) => ({ uri: { fsPath: p } });
  const repo = (repoRoot: string, dirty: string[], staged: string[] = []) => ({
    rootUri: { fsPath: repoRoot },
    state: { workingTreeChanges: dirty.map(change), indexChanges: staged.map(change), mergeChanges: [] },
  });

  it("keeps a pending edit once git reports it clean after having seen it dirty", () => {
    pending.paths = [file];
    const unrelated = Array.from({ length: 5000 }, (_, i) => path.join(root, "untracked", `${i}.txt`));
    syncRepository(repo(root, [...unrelated, file]), [root]);
    expect(pending.accept).not.toHaveBeenCalled();
    syncRepository(repo(root, [], [file]), [root]);
    expect(pending.accept).not.toHaveBeenCalled();
    syncRepository(repo(root, unrelated), [root]);
    expect(pending.accept).toHaveBeenCalledWith(file);
  });

  it("never keeps an edit git has not reported dirty, and does nothing without pending edits", () => {
    pending.paths = [];
    syncRepository(repo(root, [file]), [root]);
    pending.paths = [path.join(root, "ignored.log")];
    syncRepository(repo(root, []), [root]);
    expect(pending.accept).not.toHaveBeenCalled();
  });

  it("lets only the owning nested repository keep its files", () => {
    pending.paths = [nestedFile];
    syncRepository(repo(nested, [nestedFile]), [root, nested]);
    syncRepository(repo(root, []), [root, nested]);
    expect(pending.accept).not.toHaveBeenCalled();
    syncRepository(repo(nested, []), [root, nested]);
    expect(pending.accept).toHaveBeenCalledWith(nestedFile);
  });
});
