/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { join, resolve } from "path";
import { tmpdir } from "os";
import { describe, expect, it, vi } from "vitest";
vi.mock("vscode", () => ({ workspace: {}, Uri: {} }));
import { applyCwdSideEffect, type ShellSession } from "./shared";

describe("shell cwd carry-over", () => {
  const root = resolve(tmpdir(), "oc-cwd-root");
  const session = (): ShellSession => ({ cwd: root, queue: Promise.resolve(), running: new Set() });
  it("follows `cd` inside the workspace", () => {
    const s = session();
    applyCwdSideEffect(s, "cd src", root);
    expect(s.cwd).toBe(join(root, "src"));
  });
  it.each(["cd ..", "cd /", `cd "${tmpdir()}"`])("never carries %j outside the workspace", (command) => {
    const s = session();
    applyCwdSideEffect(s, command, root);
    expect(s.cwd).toBe(root);
  });
});
