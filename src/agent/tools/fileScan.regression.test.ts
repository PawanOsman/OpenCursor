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
import { afterEach, describe, expect, it } from "vitest";
import { scanFiles } from "./fileScan";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("scanFiles nested .gitignore", () => {
  it("keeps every sibling directory's rules when workers load them concurrently", async () => {
    const root = mkdtempSync(join(tmpdir(), "oc-scan-")); roots.push(root);
    for (let i = 0; i < 24; i++) {
      const dir = join(root, `pkg${i}`);
      mkdirSync(join(dir, "nested"), { recursive: true });
      writeFileSync(join(dir, ".gitignore"), "secret.txt\n");
      writeFileSync(join(dir, "secret.txt"), "x");
      writeFileSync(join(dir, "keep.txt"), "x");
      writeFileSync(join(dir, "nested", "secret.txt"), "x");
    }
    const { files } = await scanFiles(root);
    const rels = files.map(f => f.rel);
    expect(rels.filter(r => r.endsWith("keep.txt"))).toHaveLength(24);
    expect(rels.filter(r => r.endsWith("secret.txt"))).toEqual([]);
  });
});
