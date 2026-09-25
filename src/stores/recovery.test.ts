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
