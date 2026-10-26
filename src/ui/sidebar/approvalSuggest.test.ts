/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it } from "vitest";
import { suggestPattern } from "./approvalSuggest";

describe("suggestPattern stays narrow", () => {
  it("suggests a fixed subcommand or the exact command, never `cmd *`", () => {
    expect(suggestPattern("shell", "Shell", "git status --short")).toBe("git status");
    expect(suggestPattern("shell", "Shell", "npm run build")).toBe("npm run build");
    expect(suggestPattern("shell", "Shell", "python -c 'import os'")).toBe("python -c 'import os'");
    expect(suggestPattern("shell", "Shell", "node  scripts/x.js")).toBe("node scripts/x.js");
    expect(suggestPattern("shell", "Shell", "rm -rf build")).toBe("rm -rf build");
    for (const cmd of ["git status", "ls -la", "npx foo"]) expect(suggestPattern("shell", "Shell", cmd)).not.toMatch(/\*/);
  });
  it("suggests the exact edit path, never an extension glob", () => {
    expect(suggestPattern("edits", "Write", "src\\a.ts")).toBe("src/a.ts");
    expect(suggestPattern("delete", "Delete", "tmp/out.log")).toBe("tmp/out.log");
  });
  it.each([".vscode/tasks.json", "a/.git/hooks/pre-commit", ".github/workflows/ci.yml"])("never suggests auto-allow for %s", (path) => {
    expect(suggestPattern("edits", "Write", path)).toBeUndefined();
    expect(suggestPattern("outside", "Read", `/x/${path}`)).toBeUndefined();
  });
  it("keeps web and MCP suggestions scoped", () => {
    expect(suggestPattern("web", "WebFetch", "https://docs.rs/a?b=1")).toBe("https://docs.rs/*");
    expect(suggestPattern("mcp", "mcp__srv__tool", "mcp__srv__tool")).toBe("mcp__srv__tool");
  });
});
