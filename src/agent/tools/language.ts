/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getWorkspaceRoot, safePath } from "../../context/workspaceUtils";
import { isWithinDirectory } from "../../context/scopedInstructions";
import { defineTool, type ToolResult } from "./types";

const PROVIDER_TIMEOUT_MS = 15_000;
class ProviderAborted extends Error {}

function failure(error: unknown): ToolResult {
  const aborted = error instanceof ProviderAborted;
  return { output: `error: ${error instanceof Error ? error.message : String(error)}`, outcome: { status: aborted ? "aborted" : "failed" } };
}

/** executeCommand cannot cancel providers, but abandoned read-only requests must not block a run. */
async function provider<T>(command: string, args: unknown[], signal?: AbortSignal): Promise<T | undefined> {
  if (signal?.aborted) throw new ProviderAborted("Language service request cancelled.");
  return new Promise<T | undefined>((resolve, reject) => {
    const abort = () => finish(new ProviderAborted("Language service request cancelled."));
    const timer = setTimeout(() => finish(new Error("Language service timed out; it may still be indexing. Narrow the request or use text search.")), PROVIDER_TIMEOUT_MS);
    let settled = false;
    const finish = (error?: unknown, value?: T) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(value);
    };
    signal?.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => vscode.commands.executeCommand<T>(command, ...args)).then((value) => finish(undefined, value), (error) => finish(error));
  });
}

async function allowedFile(uri: vscode.Uri): Promise<boolean> {
  const root = getWorkspaceRoot();
  if (uri.scheme !== "file" || !isWithinDirectory(root, uri.fsPath)) return false;
  try { return isWithinDirectory(await fs.realpath(root), await fs.realpath(uri.fsPath)); }
  catch { return false; }
}

async function source(input: any) {
  if (typeof input.path !== "string" || !input.path.trim()) throw new Error("path is required");
  if (!Number.isSafeInteger(input.line) || input.line < 1 || !Number.isSafeInteger(input.column) || input.column < 1) throw new Error("line and column must be positive 1-based integers");
  const uri = vscode.Uri.file(safePath(input.path));
  if (!await allowedFile(uri)) throw new Error("Language tools require a real file inside the current workspace.");
  const document = await vscode.workspace.openTextDocument(uri);
  if (input.line > document.lineCount || input.column > document.lineAt(input.line - 1).text.length + 1) throw new Error("The requested position is outside the current editor buffer. Read the file again.");
  return { uri, position: new vscode.Position(input.line - 1, input.column - 1), version: document.version };
}

function location(uri: vscode.Uri, range: vscode.Range) {
  return { path: path.relative(getWorkspaceRoot(), uri.fsPath).split(path.sep).join("/"), line: range.start.line + 1, column: range.start.character + 1, endLine: range.end.line + 1, endColumn: range.end.character + 1 };
}

function limitOf(value: unknown): number {
  if (value === undefined) return 100;
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 500) throw new Error("limit must be an integer from 1 to 500");
  return Number(value);
}

async function locations(values: Array<vscode.Location | vscode.LocationLink>, limit: number) {
  const results: ReturnType<typeof location>[] = [], seen = new Set<string>();
  let omittedOutsideWorkspace = 0, truncated = false;
  for (const value of values) {
    const uri = "targetUri" in value ? value.targetUri : value.uri;
    const range = "targetUri" in value ? value.targetSelectionRange ?? value.targetRange : value.range;
    if (!uri || !range || !await allowedFile(uri)) { omittedOutsideWorkspace++; continue; }
    const item = location(uri, range), key = JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    if (results.length >= limit) { truncated = true; continue; }
    results.push(item);
  }
  return { results, truncated, omittedOutsideWorkspace };
}

const emptyNote = "No results from the installed language providers. A provider may be unavailable or still indexing; use text search to investigate.";

export const goToDefinitionTool = defineTool("GoToDefinition", false, async (input, signal) => {
  try {
    const commands: Record<string, string> = { definition: "vscode.executeDefinitionProvider", typeDefinition: "vscode.executeTypeDefinitionProvider", implementation: "vscode.executeImplementationProvider" };
    const command = commands[input.kind ?? "definition"];
    if (!command) throw new Error("kind must be definition, typeDefinition, or implementation");
    const at = await source(input);
    const values = await provider<Array<vscode.Location | vscode.LocationLink>>(command, [at.uri, at.position], signal);
    const result = await locations(values ?? [], 100);
    return { output: JSON.stringify({ sourceVersion: at.version, ...result, ...(!result.results.length ? { note: emptyNote } : {}) }) };
  } catch (error) { return failure(error); }
});

export const findReferencesTool = defineTool("FindReferences", false, async (input, signal) => {
  try {
    const limit = limitOf(input.limit), at = await source(input);
    const values = await provider<vscode.Location[]>("vscode.executeReferenceProvider", [at.uri, at.position], signal);
    const result = await locations(values ?? [], limit);
    return { output: JSON.stringify({ sourceVersion: at.version, ...result, ...(!result.results.length ? { note: emptyNote } : {}) }) };
  } catch (error) { return failure(error); }
});

export const workspaceSymbolsTool = defineTool("WorkspaceSymbols", false, async (input, signal) => {
  try {
    if (typeof input.query !== "string" || !input.query.trim()) throw new Error("query must be a nonempty symbol name or fragment");
    const limit = limitOf(input.limit);
    const values = await provider<vscode.SymbolInformation[]>("vscode.executeWorkspaceSymbolProvider", [input.query], signal);
    const results: Array<ReturnType<typeof location> & { name: string; kind: number; container?: string }> = [];
    let omittedOutsideWorkspace = 0, truncated = false;
    for (const value of values ?? []) {
      if (!value.location?.range || !await allowedFile(value.location.uri)) { omittedOutsideWorkspace++; continue; }
      if (results.length >= limit) { truncated = true; continue; }
      results.push({ name: value.name, kind: value.kind, container: value.containerName, ...location(value.location.uri, value.location.range) });
    }
    return { output: JSON.stringify({ results, truncated, omittedOutsideWorkspace, ...(!results.length ? { note: emptyNote } : {}) }) };
  } catch (error) { return failure(error); }
});

export const renamePreviewTool = defineTool("RenamePreview", false, async (input, signal) => {
  try {
    if (typeof input.new_name !== "string" || !input.new_name.trim() || input.new_name.length > 200 || /[\r\n]/.test(input.new_name)) throw new Error("new_name must be a nonempty symbol name of at most 200 characters");
    const at = await source(input);
    const edit = await provider<vscode.WorkspaceEdit>("vscode.executeDocumentRenameProvider", [at.uri, at.position, input.new_name], signal);
    const files: Array<{ path: string; version: number; edits: Array<ReturnType<typeof location> & { newText: string }> }> = [];
    let count = 0, characters = 0, truncated = false, omittedOutsideWorkspace = 0;
    for (const [uri, edits] of edit?.entries() ?? []) {
      if (!await allowedFile(uri)) { omittedOutsideWorkspace++; continue; }
      const document = await vscode.workspace.openTextDocument(uri);
      const shown = [];
      for (const replacement of edits) {
        if (count >= 300 || characters + replacement.newText.length > 48_000) { truncated = true; continue; }
        count++; characters += replacement.newText.length;
        shown.push({ ...location(uri, replacement.range), newText: replacement.newText });
      }
      if (shown.length) files.push({ path: path.relative(getWorkspaceRoot(), uri.fsPath).split(path.sep).join("/"), version: document.version, edits: shown });
    }
    return { output: JSON.stringify({ applied: false, previewOnly: true, sourceVersion: at.version, files, truncated, omittedOutsideWorkspace, note: files.length ? "Text edits only. No changes were applied. Verify file contents/versions before applying approved edits; other provider operations are not applied by this tool." : emptyNote }) };
  } catch (error) { return failure(error); }
});
