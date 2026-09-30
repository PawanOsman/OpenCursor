/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("vscode", () => ({ workspace: { textDocuments: [], workspaceFolders: [] } }));
import { RunJournal } from "./runJournal";
import { PendingChangesStore } from "./pendingChanges";
const directories: string[] = [];
async function fixture() { const root = await fs.mkdtemp(path.join(os.tmpdir(), "ocursor-recovery-")); directories.push(root); return root; }
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
it("restores undo ownership after restarting and refuses newer user changes", async () => {
  const root = await fixture(), file = path.join(root, "code.txt");
  await fs.writeFile(file, "after");
  const store = new PendingChangesStore(); await store.initialize(root);
  store.record(file, "before", "after", true, { conversationId: "thread" });
  const recovered = new PendingChangesStore(); await recovered.initialize(root);
  expect(recovered.list()[0].owner?.conversationId).toBe("thread");
  await fs.writeFile(file, "user changed this");
  await expect(recovered.reject(file)).rejects.toThrow("changed after");
  expect(await fs.readFile(file, "utf8")).toBe("user changed this");
  await fs.writeFile(file, "after"); await recovered.reject(file);
  expect(await fs.readFile(file, "utf8")).toBe("before");
  const final = new PendingChangesStore(); await final.initialize(root); expect(final.count()).toBe(0);
});
it("recovers edits captured through a stable directory alias and rejects stale content", async () => {
  const root = await fixture(), real = path.join(root, "real"), alias = path.join(root, "alias");
  await fs.mkdir(real); await fs.symlink(real, alias, process.platform === "win32" ? "junction" : "dir");
  const file = path.join(alias, "code.txt"); await fs.writeFile(file, "after");
  const store = new PendingChangesStore(); await store.initialize(root);
  store.record(file, "before", "after", true, { conversationId: "thread" });
  expect(store.list()[0].path).toBe(await fs.realpath(file));
  const recovered = new PendingChangesStore(); await recovered.initialize(root);
  expect(recovered.has(file)).toBe(true);
  await fs.writeFile(file, "user changed this");
  await expect(recovered.reject(file)).rejects.toThrow("changed after");
  await expect(recovered.rejectHunk(file, 0)).rejects.toThrow("newer changes");
  expect(recovered.has(file)).toBe(true);
  await fs.writeFile(file, "after"); await recovered.reject(file);
  expect(await fs.readFile(file, "utf8")).toBe("before");
  expect(recovered.count()).toBe(0);
});
it.skipIf(process.platform !== "win32")("uses the same identity for Windows short paths during capture, lookup and recovered undo", async (ctx) => {
  const root = await fixture(), file = path.join(root, "code.txt");
  await fs.writeFile(file, "after");
  const { stdout } = await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:OPENCURSOR_PATH_FIXTURE).ShortPath"],
  { windowsHide: true, timeout: 10_000, env: { ...process.env, OPENCURSOR_PATH_FIXTURE: root } });
  const shortRoot = stdout.trim();
  if (!shortRoot || shortRoot.toLowerCase() === (await fs.realpath(root)).toLowerCase()) ctx.skip(); // Short-name creation can be disabled on the volume.
  const shortFile = path.join(shortRoot, "code.txt");
  const store = new PendingChangesStore(); await store.initialize(root);
  store.record(shortFile, "before", "after", true);
  expect(store.list()[0].path).toBe(await fs.realpath(file));
  expect(store.has(file)).toBe(true);
  expect(store.has(shortFile)).toBe(true);
  const recovered = new PendingChangesStore(); await recovered.initialize(root);
  await recovered.reject(shortFile);
  expect(await fs.readFile(file, "utf8")).toBe("before");
  expect(recovered.count()).toBe(0);
  const missing = path.join(shortRoot, "nested", "new.txt");
  recovered.recordBytes(missing, null, Buffer.from("new"));
  expect(recovered.has(path.join(await fs.realpath(root), "nested", "new.txt"))).toBe(true);
}, 20_000);
it("does not reinterpret a recovered destination after its parent is replaced by a symlink", async () => {
  const root = await fixture(), directory = path.join(root, "original"), moved = path.join(root, "moved"), other = path.join(root, "other");
  await fs.mkdir(directory); await fs.mkdir(other);
  const file = path.join(await fs.realpath(directory), "code.txt"), otherFile = path.join(other, "code.txt");
  await fs.writeFile(file, "after"); await fs.writeFile(otherFile, "after");
  const store = new PendingChangesStore(); await store.initialize(root); store.record(file, "before", "after", true);
  await fs.rename(directory, moved); await fs.symlink(other, directory, process.platform === "win32" ? "junction" : "dir");
  const recovered = new PendingChangesStore(); await recovered.initialize(root);
  expect(recovered.has(file)).toBe(true);
  await expect(recovered.reject(file)).rejects.toThrow("destination changed");
  expect(await fs.readFile(otherFile, "utf8")).toBe("after");
  expect(await fs.readFile(path.join(moved, "code.txt"), "utf8")).toBe("after");
  expect(recovered.count()).toBe(1);
});
it.each(["accept", "reject"])("does not %s hunks from another pending file after a parent symlink retarget", async (action) => {
  const root = await fixture(), original = path.join(root, "original"), moved = path.join(root, "moved"), other = path.join(root, "other");
  await fs.mkdir(original); await fs.mkdir(other);
  const file = path.join(await fs.realpath(original), "code.txt"), otherFile = path.join(await fs.realpath(other), "code.txt");
  await fs.writeFile(file, "after A"); await fs.writeFile(otherFile, "after B");
  const store = new PendingChangesStore(); await store.initialize(root);
  store.record(file, "before A", "after A", true); store.record(otherFile, "before B", "after B", true);
  await fs.rename(original, moved); await fs.symlink(other, original, process.platform === "win32" ? "junction" : "dir");
  const recovered = new PendingChangesStore(); await recovered.initialize(root);
  const review = action === "accept" ? recovered.acceptHunk(file, 0) : recovered.rejectHunk(file, 0);
  await expect(review).rejects.toThrow("destination changed");
  expect(await fs.readFile(otherFile, "utf8")).toBe("after B");
  expect(await fs.readFile(path.join(moved, "code.txt"), "utf8")).toBe("after A");
  expect(recovered.count()).toBe(2);
  expect(recovered.get(otherFile)?.before).toBe("before B");
});
it("durably orders parallel events and tolerates only a torn final journal record", async () => {
  const root = await fixture(), journal = new RunJournal(root, "conversation/with/path");
  await Promise.all([journal.append({ type: "intent", at: 1 }), journal.append({ type: "result", at: 2 })]);
  await fs.appendFile(journal.file, '{"type":');
  expect((await new RunJournal(root, "conversation/with/path").read()).map(e => e.type)).toEqual(["intent", "result"]);
  await fs.appendFile(journal.file, '\n{"type":"end","at":3}\n');
  await expect(journal.read()).rejects.toThrow("corrupt");
});
it("preserves and repairs a torn tail before appending another run", async () => {
  const root = await fixture(), journal = new RunJournal(root, "thread");
  await journal.append({ type: "start", at: 1 });
  await fs.appendFile(journal.file, '{"type":"res');
  const restarted = new RunJournal(root, "thread");
  await restarted.append({ type: "interrupted", at: 2 });
  expect((await restarted.read()).map(row => row.type)).toEqual(["start", "interrupted"]);
  const preserved = (await fs.readdir(root)).find(name => name.includes(".torn-"))!;
  expect(await fs.readFile(path.join(root, preserved), "utf8")).toBe('{"type":"res');
});
it("reconciles interrupted preparations without inventing an edit", async () => {
  const root = await fixture(), file = path.join(root, "code.txt");
  await fs.writeFile(file, "before");
  const store = new PendingChangesStore(); await store.initialize(root);
  store.recordBytes(file, Buffer.from("before"), Buffer.from("after"), { conversationId: "thread" }, undefined, undefined, true);
  const unapplied = new PendingChangesStore(); await unapplied.initialize(root); expect(unapplied.count()).toBe(0);
  unapplied.recordBytes(file, Buffer.from("before"), Buffer.from("after"), { conversationId: "thread" }, undefined, undefined, true);
  await fs.writeFile(file, "after");
  const applied = new PendingChangesStore(); await applied.initialize(root); expect(applied.count()).toBe(1);
  await applied.reject(file); expect(await fs.readFile(file, "utf8")).toBe("before");
});
it("preserves undo tracking when acceptance persistence fails and retries restored undo safely", async () => {
  const root = await fixture(), file = path.join(root, "code.txt"), journal = path.join(root, "pending-edits.json"), saved = path.join(root, "saved.json");
  await fs.writeFile(file, "after");
  const store = new PendingChangesStore(); await store.initialize(root); store.record(file, "before", "after", true);
  await fs.rename(journal, saved); await fs.mkdir(journal);
  expect(() => store.accept(file)).toThrow(); expect(store.count()).toBe(1);
  await expect(store.reject(file)).rejects.toThrow(); expect(store.count()).toBe(1);
  expect(await fs.readFile(file, "utf8")).toBe("before");
  await fs.rmdir(journal); await fs.rename(saved, journal);
  await store.reject(file); expect(store.count()).toBe(0);
  expect(await fs.readFile(file, "utf8")).toBe("before");
});
it("rejects corrupted backup contents and out-of-storage backup references", async () => {
  const root = await fixture(), file = path.join(root, "code.txt"), backups = path.join(root, "edit-backups");
  await fs.mkdir(backups); await fs.writeFile(file, "after");
  const backup = path.join(backups, "00000000-0000-0000-0000-000000000000"); await fs.writeFile(backup, "corrupt");
  const store = new PendingChangesStore(); await store.initialize(root);
  store.recordBytes(file, Buffer.from("before"), Buffer.from("after"), undefined, backup);
  const restarted = new PendingChangesStore(); await restarted.initialize(root);
  await expect(restarted.reject(file)).rejects.toThrow("backup is corrupt"); expect(await fs.readFile(file, "utf8")).toBe("after");
  const journal = path.join(root, "pending-edits.json"), data = JSON.parse(await fs.readFile(journal, "utf8"));
  data.records[0].backupPath = file; await fs.writeFile(journal, JSON.stringify(data));
  await expect(new PendingChangesStore().initialize(root)).rejects.toThrow("backup path");
  expect(await fs.readFile(file, "utf8")).toBe("after");
});
it("serializes independent journal instances while recovering the same torn tail", async () => {
  const root = await fixture(), a = new RunJournal(root, "thread"), b = new RunJournal(root, "thread");
  await fs.writeFile(a.file, '{"type":');
  await Promise.all([a.append({ type: "one", at: 1 }), b.append({ type: "two", at: 2 })]);
  expect((await a.read()).map(row => row.type).sort()).toEqual(["one", "two"]);
  expect((await fs.readdir(root)).filter(name => name.includes(".torn-"))).toHaveLength(1);
});
