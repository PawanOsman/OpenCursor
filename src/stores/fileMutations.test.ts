/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const editor = vi.hoisted(() => ({ root: "", documents: [] as any[] }));
vi.mock("vscode", () => ({ workspace: { get workspaceFolders() { return [{ uri: { fsPath: editor.root } }]; }, get textDocuments() { return editor.documents; } } }));
import { pendingChanges } from "./pendingChanges";
import { mutateFile } from "./fileMutations";
import { writeTool, strReplaceTool, deleteFileTool, editNotebookTool } from "../agent/tools/files";

let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "ocursor-mutation-test-")); editor.root = root; editor.documents = []; });
afterEach(async () => { pendingChanges.acceptAll(); await fs.rm(root, { recursive: true, force: true }); });
const context = (conversationId: string, turnIndex = 0) => ({ todos: [], changeOwner: { conversationId, runId: `run-${conversationId}`, turnIndex } });

describe("production file transactions and undo", () => {
  it.each([Buffer.from([0, 255, 128, 72, 101]), Buffer.alloc(2 * 1024 * 1024 + 1, 88)])("restores exact bytes after Delete", async (contents) => {
    const file = path.join(root, "original.bin"); await fs.writeFile(file, contents);
    expect((await deleteFileTool.execute({ path: file })).output).toBe(`deleted ${file}`);
    await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
    await pendingChanges.reject(file);
    expect(await fs.readFile(file)).toEqual(contents);
    expect(pendingChanges.has(file)).toBe(false);
  });
  it("preserves executable permissions when restoring a deleted file", async () => {
    const file = path.join(root, "script"); await fs.writeFile(file, "echo hello\n", { mode: 0o755 });
    const originalPermissions = (await fs.stat(file)).mode & 0o777;
    await deleteFileTool.execute({ path: file }); await pendingChanges.reject(file);
    expect((await fs.stat(file)).mode & 0o777).toBe(originalPermissions);
  });
  it("serializes disjoint replacements through canonical aliases", async () => {
    const file = path.join(root, "real.txt"), alias = path.join(root, "alias.txt");
    await fs.writeFile(file, "alpha\nbeta\n"); await fs.symlink(file, alias);
    const results = await Promise.all([
      strReplaceTool.execute({ path: file, old_string: "alpha", new_string: "ALPHA" }),
      strReplaceTool.execute({ path: alias, old_string: "beta", new_string: "BETA" }),
    ]);
    expect(results.every((r) => !r.output.startsWith("error:"))).toBe(true);
    expect(await fs.readFile(file, "utf8")).toBe("ALPHA\nBETA\n");
    await pendingChanges.reject(file); expect(await fs.readFile(file, "utf8")).toBe("alpha\nbeta\n");
  });
  it("refuses stale whole-file and hunk undo while preserving newer user content and tracking", async () => {
    const file = path.join(root, "manual.txt"); await fs.writeFile(file, "original\n");
    await writeTool.execute({ path: file, contents: "agent\n" }); await fs.appendFile(file, "manual\n");
    await expect(pendingChanges.reject(file)).rejects.toThrow("changed after");
    await expect(pendingChanges.rejectHunk(file, 0)).rejects.toThrow("newer changes");
    expect(await fs.readFile(file, "utf8")).toBe("agent\nmanual\n"); expect(pendingChanges.has(file)).toBe(true);
  });
  it("scopes earlier-turn undo to the originating conversation and turn", async () => {
    const a = path.join(root, "a"), b = path.join(root, "b"), old = path.join(root, "old");
    await writeTool.execute({ path: a, contents: "A" }, undefined, undefined, context("A", 4));
    await writeTool.execute({ path: b, contents: "B" }, undefined, undefined, context("B", 5));
    await writeTool.execute({ path: old, contents: "older A" }, undefined, undefined, context("A", 1));
    await pendingChanges.rejectAll({ conversationId: "A", fromTurnIndex: 4 });
    await expect(fs.stat(a)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(b, "utf8")).toBe("B"); expect(await fs.readFile(old, "utf8")).toBe("older A");
  });
  it("does not revert another conversation's later edit to the same file", async () => {
    const file = path.join(root, "shared"); await fs.writeFile(file, "original");
    await writeTool.execute({ path: file, contents: "A" }, undefined, undefined, context("A"));
    await writeTool.execute({ path: file, contents: "B" }, undefined, undefined, context("B"));
    await expect(pendingChanges.rejectAll({ conversationId: "A" })).rejects.toThrow("changed after");
    expect(await fs.readFile(file, "utf8")).toBe("B");
    await pendingChanges.rejectAll({ conversationId: "B" }); expect(await fs.readFile(file, "utf8")).toBe("A");
  });
  it("checks external changes before committing an edit", async () => {
    const file = path.join(root, "raced"); await fs.writeFile(file, "original");
    await expect(mutateFile(file, {}, async () => {
      await fs.writeFile(file, "external change"); return { data: Buffer.from("agent"), result: true };
    })).rejects.toThrow("changed during");
    expect(await fs.readFile(file, "utf8")).toBe("external change"); expect(pendingChanges.has(file)).toBe(false);
  });
  it("does not reassign other conversations' changes during partial hunk review", async () => {
    const file = path.join(root, "mixed-hunks"); await fs.writeFile(file, "a\nb\nc");
    await strReplaceTool.execute({ path: file, old_string: "a", new_string: "A" }, undefined, undefined, context("A"));
    await strReplaceTool.execute({ path: file, old_string: "c", new_string: "C" }, undefined, undefined, context("B"));
    await expect(pendingChanges.acceptHunk(file, 0)).rejects.toThrow("multiple conversations or turns");
    expect(pendingChanges.list({ conversationId: "A" })).toHaveLength(1);
    expect(pendingChanges.list({ conversationId: "B" })).toHaveLength(1);
    expect(await fs.readFile(file, "utf8")).toBe("A\nb\nC");
  });
  it("refuses dirty editor files", async () => {
    const file = path.join(root, "dirty"); await fs.writeFile(file, "disk");
    editor.documents.push({ uri: { scheme: "file", fsPath: file }, version: 4, isDirty: true });
    expect((await writeTool.execute({ path: file, contents: "agent" })).output).toContain("unsaved editor");
    expect(await fs.readFile(file, "utf8")).toBe("disk");
  });
  it("does not execute an already-cancelled write or a mutation cancelled during preparation", async () => {
    const file = path.join(root, "cancelled"); await fs.writeFile(file, "before");
    const controller = new AbortController(); controller.abort();
    expect((await writeTool.execute({ path: file, contents: "after" }, controller.signal)).output).toContain("aborted:");
    const late = new AbortController();
    await expect(mutateFile(file, { signal: late.signal }, () => {
      late.abort(); return { data: Buffer.from("after"), result: true };
    })).rejects.toThrow("aborted:");
    expect(await fs.readFile(file, "utf8")).toBe("before"); expect(pendingChanges.has(file)).toBe(false);
  });
  it("cancels a queued mutation promptly without releasing another writer's lock", async () => {
    const file = path.join(root, "queued"); await fs.writeFile(file, "original");
    let release!: () => void, started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const first = mutateFile(file, {}, async () => { started(); await barrier; return { data: Buffer.from("first"), result: true }; });
    await entered;
    const controller = new AbortController();
    const cancelled = mutateFile(file, { signal: controller.signal }, () => { throw new Error("cancelled updater must not run"); });
    const cancelledCheck = expect(cancelled).rejects.toThrow("aborted:");
    await new Promise((resolve) => setTimeout(resolve, 5)); controller.abort(); await cancelledCheck;
    let thirdStarted = false;
    const third = mutateFile(file, {}, (snapshot) => { thirdStarted = true; return { data: Buffer.from(snapshot.data!.toString() + " third"), result: true }; });
    await new Promise((resolve) => setTimeout(resolve, 5)); expect(thirdStarted).toBe(false);
    release(); await Promise.all([first, third]);
    expect(await fs.readFile(file, "utf8")).toBe("first third");
  });
  it("tracks notebook edits for undo using the same transaction", async () => {
    const file = path.join(root, "notebook.ipynb");
    const original = JSON.stringify({ cells: [{ cell_type: "code", metadata: {}, source: ["print(1)"] }], metadata: {}, nbformat: 4, nbformat_minor: 5 });
    await fs.writeFile(file, original);
    const result = await editNotebookTool.execute({ target_notebook: file, cell_idx: 0, old_string: "print(1)", new_string: "print(2)", cell_language: "python" });
    expect(result.output).toContain("Edited cell 0"); await pendingChanges.reject(file);
    expect(await fs.readFile(file, "utf8")).toBe(original);
  });
  it("accepts and rejects single hunks without removing the other pending edit", async () => {
    const file = path.join(root, "hunks"); await fs.writeFile(file, "a\nb\nc\nd\ne");
    await writeTool.execute({ path: file, contents: "A\nb\nc\nd\nE" });
    await pendingChanges.acceptHunk(file, 0); await pendingChanges.rejectHunk(file, 0);
    expect(await fs.readFile(file, "utf8")).toBe("A\nb\nc\nd\ne"); expect(pendingChanges.has(file)).toBe(false);
  });
});
