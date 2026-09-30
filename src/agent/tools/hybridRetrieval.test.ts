/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { lexicalCodeSearch, fuseRetrieval } from "./hybridRetrieval";
import { invalidateScanCache } from "./fileScan";

const host = vi.hoisted(() => ({ root: "", documents: [] as any[], semantic: vi.fn() }));
vi.mock("vscode", () => ({ workspace: { get workspaceFolders() { return [{ uri: { fsPath: host.root } }]; }, get textDocuments() { return host.documents; } } }));
vi.mock("../semanticIndex", () => ({ search: host.semantic, isIndexing: () => false, isIndexingEnabled: () => false }));
import { semanticSearchTool } from "./search";

beforeEach(async () => { host.root = await fs.mkdtemp(path.join(tmpdir(), "ocursor-hybrid-")); host.documents = []; host.semantic.mockReset(); host.semantic.mockResolvedValue([]); });
afterEach(async () => { invalidateScanCache(); await fs.rm(host.root, { recursive: true, force: true }); });
async function file(relative: string, text: string) { const target = path.join(host.root, relative); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, text); return target; }

it("retrieves exact identifiers even when vector search returns unrelated nonempty hits", async () => {
  await file("auth.ts", "export function validateSessionToken() { return true; }");
  await file("other.ts", "export const unrelated = true;");
  host.semantic.mockResolvedValue([{ path: "other.ts", start: 1, end: 1, text: "export const unrelated = true;", score: 0.9 }]);
  const result = await semanticSearchTool.execute({ query: "validateSessionToken" });
  expect(result.output).toContain("auth.ts:1-1 [lexical]");
  expect(result.output).toContain("validateSessionToken");
  expect(result.output).toContain("other.ts:1-1 [semantic]");
});

it("fuses overlapping evidence while keeping the fresh lexical excerpt", () => {
  const hits = fuseRetrieval([{ path: "a.ts", start: 1, end: 40, text: "semantic excerpt", score: 0.9 }], [{ path: "a.ts", start: 5, end: 12, text: "current exact identifier", score: 9 }]);
  expect(hits).toHaveLength(1);
  expect(hits[0]).toMatchObject({ text: "current exact identifier", signals: ["lexical", "semantic"], start: 5 });
});

it("searches unsaved buffers and omits the disk vector for those files", async () => {
  const target = await file("draft.ts", "const oldDiskValue = true;");
  host.documents = [{ isDirty: true, uri: { scheme: "file", fsPath: target }, version: 8, getText: () => "const pendingEditorValue = true;" }];
  const result = await semanticSearchTool.execute({ query: "pendingEditorValue" });
  expect(result.output).toContain("unsaved editor buffer");
  expect(result.output).toContain("pendingEditorValue");
  expect(result.output).not.toContain("oldDiskValue");
  expect(host.semantic.mock.calls[0][3]("draft.ts")).toBe(false);
});

it("honors current ignore rules, multiple scopes, and explicit scan budgets", async () => {
  await file("a/first.ts", "const uniqueMarker = 1;");
  await file("b/second.ts", "const uniqueMarker = 2;");
  await file("private/secret.ts", "const uniqueMarker = 3;");
  await file(".cursorignore", "private/\n");
  const result = await lexicalCodeSearch(host.root, "uniqueMarker", { maxFiles: 1, filter: (relative) => /^[ab]\//.test(relative) });
  expect(result.incomplete).toBe(true); expect(result.scannedFiles).toBe(1);
  expect(result.hits).toHaveLength(1); expect(result.hits[0].path).not.toContain("private");
  const tool = await semanticSearchTool.execute({ query: "uniqueMarker", target_directories: ["a", "b"] });
  expect(tool.output).toContain("a/first.ts"); expect(tool.output).toContain("b/second.ts");
  expect(tool.output).not.toContain("private");
  expect((await semanticSearchTool.execute({ query: "uniqueMarker", target_directories: [".."] })).output).toContain("inside the current workspace");
});
