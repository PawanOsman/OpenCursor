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

const host = vi.hoisted(() => ({ root: "", execute: vi.fn(), applyEdit: vi.fn(), open: vi.fn() }));
vi.mock("vscode", () => ({
  workspace: { get workspaceFolders() { return [{ uri: { fsPath: host.root } }]; }, openTextDocument: host.open, applyEdit: host.applyEdit },
  commands: { executeCommand: host.execute },
  Uri: { file: (fsPath: string) => ({ scheme: "file", fsPath }) },
  Position: class { constructor(public line: number, public character: number) {} },
}));
import { goToDefinitionTool, findReferencesTool, workspaceSymbolsTool, renamePreviewTool } from "./language";

let directory: string;
const range = { start: { line: 0, character: 7 }, end: { line: 0, character: 13 } };
const uri = (relative: string) => ({ scheme: "file", fsPath: path.join(host.root, relative) });
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(tmpdir(), "ocursor-language-")); host.root = path.join(directory, "workspace"); await fs.mkdir(host.root);
  await fs.writeFile(path.join(host.root, "app.ts"), "export function sample() {}\n");
  await fs.writeFile(path.join(host.root, "usage.ts"), "sample();\n");
  host.execute.mockReset(); host.applyEdit.mockReset(); host.open.mockReset();
  host.open.mockImplementation(async (target: { fsPath: string }) => {
    const lines = (await fs.readFile(target.fsPath, "utf8")).split("\n");
    return { version: 7, lineCount: lines.length, lineAt: (line: number) => ({ text: lines[line] }) };
  });
});
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

it("normalizes location links and filters duplicate/external locations without leaking them", async () => {
  const external = path.join(directory, "outside.ts"); await fs.writeFile(external, "private");
  host.execute.mockResolvedValue([
    { targetUri: uri("app.ts"), targetRange: range, targetSelectionRange: range },
    { uri: uri("app.ts"), range },
    { uri: { scheme: "file", fsPath: external }, range },
  ]);
  const result = JSON.parse((await goToDefinitionTool.execute({ path: "app.ts", line: 1, column: 18 })).output);
  expect(result).toMatchObject({ sourceVersion: 7, omittedOutsideWorkspace: 1, results: [{ path: "app.ts", line: 1, column: 8, endLine: 1, endColumn: 14 }] });
  expect(result.results).toHaveLength(1);
  expect(host.execute.mock.calls[0][0]).toBe("vscode.executeDefinitionProvider");
  expect(host.execute.mock.calls[0][2]).toEqual({ line: 0, character: 17 });
  expect(JSON.stringify(result)).not.toContain("outside.ts");
});

it("checks current buffer bounds before invoking a provider", async () => {
  const result = await findReferencesTool.execute({ path: "app.ts", line: 50, column: 1 });
  expect(result.outcome?.status).toBe("failed");
  expect(result.output).toContain("outside the current editor buffer");
  expect(host.execute).not.toHaveBeenCalled();
});

it("returns bounded references and explains missing provider results", async () => {
  host.execute.mockResolvedValue([{ uri: uri("app.ts"), range }, { uri: uri("usage.ts"), range }]);
  const result = JSON.parse((await findReferencesTool.execute({ path: "app.ts", line: 1, column: 18, limit: 1 })).output);
  expect(result.results).toHaveLength(1); expect(result.truncated).toBe(true);
  host.execute.mockResolvedValue(undefined);
  expect((await goToDefinitionTool.execute({ path: "app.ts", line: 1, column: 18, kind: "implementation" })).output).toContain("provider may be unavailable");
  expect(host.execute.mock.calls.at(-1)?.[0]).toBe("vscode.executeImplementationProvider");
});

it("searches language symbols with source provenance", async () => {
  host.execute.mockResolvedValue([{ name: "sample", kind: 11, containerName: "module", location: { uri: uri("app.ts"), range } }]);
  const result = JSON.parse((await workspaceSymbolsTool.execute({ query: "sample" })).output);
  expect(result.results[0]).toMatchObject({ name: "sample", path: "app.ts", column: 8, container: "module" });
});

it("previews cross-file rename without applying any edit", async () => {
  const before = await fs.readFile(path.join(host.root, "app.ts"), "utf8");
  host.execute.mockResolvedValue({ entries: () => [[uri("app.ts"), [{ range, newText: "renamed" }]], [uri("usage.ts"), [{ range, newText: "renamed" }]]] });
  const result = JSON.parse((await renamePreviewTool.execute({ path: "app.ts", line: 1, column: 18, new_name: "renamed" })).output);
  expect(result).toMatchObject({ applied: false, previewOnly: true, truncated: false });
  expect(result.files).toHaveLength(2);
  expect(result.files[0]).toMatchObject({ version: 7, edits: [{ newText: "renamed", line: 1 }] });
  expect(host.applyEdit).not.toHaveBeenCalled();
  expect(await fs.readFile(path.join(host.root, "app.ts"), "utf8")).toBe(before);
});

it("abandons a provider that ignores cancellation without claiming a successful search", async () => {
  host.execute.mockImplementation(() => new Promise(() => {}));
  const abort = new AbortController();
  const work = findReferencesTool.execute({ path: "app.ts", line: 1, column: 18 }, abort.signal);
  await vi.waitFor(() => expect(host.execute).toHaveBeenCalled());
  abort.abort();
  expect((await work).outcome?.status).toBe("aborted");
});
