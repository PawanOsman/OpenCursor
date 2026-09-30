/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { syncDirectory } from "./durableFiles";

const writers = new Map<string, Promise<void>>();
function serialize(file: string, work: () => Promise<void>): Promise<void> {
  const previous = writers.get(file) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  writers.set(file, next);
  void next.finally(() => { if (writers.get(file) === next) writers.delete(file); }).catch(() => {});
  return next;
}

export interface RunJournalEvent { type: string; at: number; data?: unknown }
/** Append-only per-conversation evidence. A failed write prevents the next action. */
export class RunJournal {
  readonly file: string;
  private queue: Promise<void> = Promise.resolve();
  private prepared = false;
  constructor(private directory: string, conversationId: string) {
    this.file = path.join(directory, `${createHash("sha256").update(conversationId).digest("hex")}.jsonl`);
  }
  append(event: RunJournalEvent): Promise<void> {
    const next = this.queue.then(() => serialize(this.file, async () => {
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      if (!this.prepared) { await this.recoverTail(); this.prepared = true; }
      const file = await fs.open(this.file, "a", 0o600);
      try { await file.writeFile(JSON.stringify({ version: 1, ...event }) + "\n"); await file.sync(); }
      finally { await file.close(); }
      await syncDirectory(this.directory);
    }));
    // Preserve failure: unrecorded side effects must not continue in this journal.
    this.queue = next;
    return next;
  }
  private async recoverTail(): Promise<void> {
    let raw: Buffer;
    try { raw = await fs.readFile(this.file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    await this.read();
    if (!raw.length || raw[raw.length - 1] === 10) return;
    const boundary = raw.lastIndexOf(10) + 1;
    const tail = raw.subarray(boundary);
    let complete = false;
    try { JSON.parse(tail.toString("utf8")); complete = true; } catch { /* interrupted write */ }
    if (complete) {
      const journal = await fs.open(this.file, "a");
      try { await journal.writeFile("\n"); await journal.sync(); } finally { await journal.close(); }
      return;
    }
    // Preserve interrupted bytes before removing only the incomplete final record.
    const saved = await fs.open(`${this.file}.torn-${randomUUID()}`, "wx", 0o600);
    try { await saved.writeFile(tail); await saved.sync(); } finally { await saved.close(); }
    await syncDirectory(this.directory);
    const journal = await fs.open(this.file, "r+");
    try { await journal.truncate(boundary); await journal.sync(); } finally { await journal.close(); }
  }
  async read(): Promise<RunJournalEvent[]> {
    let raw: string;
    try { raw = await fs.readFile(this.file, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const rows = raw.split("\n");
    return rows.flatMap((line, index) => {
      if (!line.trim()) return [];
      let value: RunJournalEvent;
      try { value = JSON.parse(line); }
      catch { if (index === rows.length - 1) return []; throw new Error("Run journal contains a corrupt record; preserve it for recovery."); }
      if (!value || typeof value.type !== "string" || !Number.isFinite(value.at)) throw new Error("Run journal contains a corrupt record; preserve it for recovery.");
      return [value];
    });
  }
  flush(): Promise<void> { return this.queue; }
}
