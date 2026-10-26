/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it, vi } from "vitest";
import * as path from "path";

vi.mock("vscode", () => ({}));
vi.mock("../stores/pendingChanges", () => ({ pendingChanges: { list: () => [], accept: vi.fn() } }));
vi.mock("../context/workspaceUtils", () => ({ safePath: (p: string) => p }));

import { isInsideRoot, owningRoot } from "./gitSync";

const root = path.resolve("/work/app");

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
