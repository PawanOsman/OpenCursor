/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("vscode", () => ({ extensions: { getExtension: () => undefined } }));
import { localDevPackageDir } from "./runtimeDeps";

describe("development runtime resolution", () => {
  it("only accepts packages whose real path stays inside the extension", () => {
    const base = mkdtempSync(join(tmpdir(), "oc-runtime-deps-"));
    try {
      const root = join(base, "extension");
      const outside = join(base, "outside-pkg");
      mkdirSync(join(root, "node_modules", "@scope", "inside"), { recursive: true });
      writeFileSync(join(root, "node_modules", "@scope", "inside", "package.json"), "{}");
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(outside, "package.json"), "{}");
      symlinkSync(outside, join(root, "node_modules", "escaped"), process.platform === "win32" ? "junction" : "dir");
      // A parent node_modules (like ~/node_modules) is never consulted.
      mkdirSync(join(base, "node_modules", "parent-only"), { recursive: true });
      writeFileSync(join(base, "node_modules", "parent-only", "package.json"), "{}");

      expect(localDevPackageDir("@scope/inside", root)).toBe(realpathSync(join(root, "node_modules", "@scope", "inside")));
      expect(localDevPackageDir("escaped", root)).toBeUndefined();
      expect(localDevPackageDir("parent-only", root)).toBeUndefined();
      expect(localDevPackageDir("missing", undefined)).toBeUndefined();
    } finally { rmSync(base, { recursive: true, force: true }); }
  });
});
