/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { beforeEach, expect, it, vi } from "vitest";
vi.mock("vscode", () => ({ EventEmitter: class { event = () => ({ dispose() {} }); fire() {} }, workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } }));
const editor = vi.hoisted(() => ({ tabs: [] as string[], visible: [] as string[], selection: undefined as string | undefined, rules: vi.fn(async (_paths: string[]) => "") }));
vi.mock("./workspaceUtils", () => ({ getWorkspaceRoot: () => "/workspace", getRecentFiles: () => editor.tabs }));
vi.mock("./workspaceContext", () => ({
  getActiveSelection: () => editor.selection,
  getOpenFiles: () => editor.visible,
  listSkills: async () => [],
  getGitContext: async () => "",
  listRulesForPrompt: editor.rules,
}));
import { buildOpenFilesBlock, buildUserInfoBlock } from "./cursorContext";

beforeEach(() => { editor.tabs = []; editor.visible = []; editor.selection = undefined; editor.rules.mockClear(); });

it("reports actual open tabs, visible files, and selection without inventing recency", async () => {
  editor.tabs = ["/workspace/app.ts", "/workspace/test.ts", "/workspace/app.ts"];
  editor.visible = ["app.ts"];
  editor.selection = "app.ts (L10-12):\nselected code";
  const block = await buildOpenFilesBlock();
  expect(block).toContain("Open file tabs in this workspace:\n- /workspace/app.ts\n- /workspace/test.ts");
  expect(block.match(/- \/workspace\/app.ts/g)).toHaveLength(1);
  expect(block).toContain("Visible editor files in this workspace:\n- app.ts");
  expect(block).toContain("<active_selection>\napp.ts (L10-12):\nselected code");
  expect(block).not.toContain("doesn't have any open files");
  expect(block).not.toContain("recent at the top");
});

it("reports no workspace tabs or visible files when none exist", async () => {
  const block = await buildOpenFilesBlock();
  expect(block).toContain("Open file tabs in this workspace:\n(none)");
  expect(block).toContain("Visible editor files in this workspace:\n(none)");
  expect(block).not.toContain("<active_selection>");
});

it("retains direct user restrictions when automatic workspace context is disabled", async () => {
  const block = await buildUserInfoBlock({ enableWorkspaceContext: false, userRules: "Do not execute tests for this task." });
  expect(block).toContain("<user_rules");
  expect(block).toContain("Do not execute tests for this task.");
  expect(block).not.toContain("<agent_skills>");
});

it("resolves scoped rules using open tabs, visible files and newly targeted files", async () => {
  editor.tabs = ["/workspace/hidden.ts"];
  editor.visible = ["visible.ts"];
  await buildUserInfoBlock({ matchFiles: ["src/new.ts"] });
  expect(editor.rules).toHaveBeenCalledWith(["visible.ts", "/workspace/hidden.ts", "src/new.ts"]);
});
