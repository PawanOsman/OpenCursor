/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveMentions, searchFilesAndFolders } from "./mentions";
import { turnsToTranscript } from "../shared/turns";
vi.mock("vscode", () => ({}));
vi.mock("./workspaceUtils", () => ({ getWorkspaceRoot: () => process.cwd() }));
vi.mock("../agent/semanticIndex", () => ({}));
vi.mock("./workspaceContext", () => ({}));
const scan = vi.hoisted(() => ({ files: [] as { rel: string; mtimeMs: number }[] }));
vi.mock("../agent/tools/fileScan", () => ({ scanFilesCached: async () => ({ files: scan.files }), scorePath: () => 0 }));
let dir: string | undefined;
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });
describe("production explicit context resolution", () => {
  it("selects late file lines before limiting their content", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ocursor-mention-"));
    const file = path.join(dir, "large.ts");
    await writeFile(file, [...Array.from({ length: 219 }, () => "x".repeat(80)), "selected-220", "selected-221", "unselected"].join("\n"));
    const result = await resolveMentions([{ kind: "code", name: "selection", path: `${file}:220-221` }], "explain", []);
    expect(result).toContain("selected-220\nselected-221");
    expect(result).not.toContain("unselected");
    expect(result.length).toBeLessThan(1000);
  });
  it("preserves assistant replies and submitted answers in an attached conversation", async () => {
    const transcript = turnsToTranscript([{ role: "user", text: "What branch?" }, { role: "assistant", blocks: [{ kind: "text", text: "We will use main." }, { kind: "tool", name: "AskQuestion", callId: "q", status: "completed", input: {}, answers: { "0": ["main"] } }] }]);
    const result = await resolveMentions([{ kind: "composer", name: "Previous chat", path: "chat" }], "continue", [], { summarize: () => transcript });
    expect(result).toContain("Assistant: We will use main.");
    expect(result).toContain('Answers: {"0":["main"]}');
  });
  it("lists the newest files for an empty query without reordering ties", async () => {
    scan.files = Array.from({ length: 500 }, (_, i) => ({ rel: `src/f${i}.ts`, mtimeMs: (i * 7919) % 97 }));
    const expected = scan.files.slice().sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 6).map((f) => f.rel);
    const items = await searchFilesAndFolders("", 3);
    expect(items.filter((item) => item.kind === "file").map((item) => item.path)).toEqual(expected.slice(0, items.filter((item) => item.kind === "file").length));
    expect(items).toHaveLength(3);
  });
});
