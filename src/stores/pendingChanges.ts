/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as fs from "fs/promises";
import * as syncFs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { syncDirectorySync } from "./durableFiles";
import { safePath } from "../context/workspaceUtils";
import { computeHunks, type Hunk } from "../shared/lineDiff";
import { withPathLock, assertCurrentFile, readSnapshot, atomicReplace } from "./fileMutations";
export { computeHunks, type Hunk } from "../shared/lineDiff";

export interface ChangeOwner { conversationId: string; runId?: string; turnIndex?: number }
export interface ChangeScope { conversationId: string; fromTurnIndex?: number; runId?: string }
export interface PendingChange {
  path: string;
  before: string;
  after: string;
  existedBefore: boolean;
  binary?: boolean;
  previewOnly?: boolean;
  owner?: ChangeOwner;
}
interface EditRecord extends PendingChange {
  beforeBytes?: Buffer | null;
  backupPath?: string;
  afterDigest: string | null;
  originalMode?: number;
  beforeDigest?: string | null;
  prepared?: boolean;
}
export const fileDigest = (bytes: Buffer | null): string | null => bytes === null ? null : createHash("sha256").update(bytes).digest("hex");
const TEXT_PREVIEW = 256_000;
function textView(data: Buffer | null): { text: string; binary: boolean; previewOnly: boolean } {
  if (data === null) return { text: "", binary: false, previewOnly: false };
  const sample = data.subarray(0, TEXT_PREVIEW);
  const text = sample.toString("utf8");
  const binary = sample.includes(0) || (data.length <= TEXT_PREVIEW && !Buffer.from(text, "utf8").equals(sample));
  return { text: binary ? `[Binary file: ${data.length} bytes]` : text.slice(0, TEXT_PREVIEW), binary, previewOnly: data.length > TEXT_PREVIEW || binary };
}
function matches(record: EditRecord, scope?: ChangeScope): boolean {
  if (!scope) return true;
  return record.owner?.conversationId === scope.conversationId &&
    (!scope.runId || record.owner?.runId === scope.runId) &&
    (scope.fromTurnIndex === undefined || (record.owner?.turnIndex ?? -1) >= scope.fromTurnIndex);
}

/** Ordered immutable edit snapshots, scoped to their originating chat and turn. */
export class PendingChangesStore {
  private changes = new Map<string, EditRecord[]>();
  private storageFile?: string;
  private garbage: string[] = [];
  async initialize(directory: string): Promise<void> {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, "pending-edits.json");
    try {
      const saved = JSON.parse(await fs.readFile(file, "utf8"));
      if (saved.version !== 1 || !Array.isArray(saved.records)) throw new Error("Unsupported pending edit journal");
      const recovered = new Map<string, EditRecord[]>();
      for (const row of saved.records) {
        if (typeof row.path !== "string" || !path.isAbsolute(row.path) || !(row.afterDigest === null || /^[a-f0-9]{64}$/.test(row.afterDigest))) throw new Error("Invalid pending edit journal; existing file preserved");
        if (row.backupPath !== undefined) {
          const relative = typeof row.backupPath === "string" ? path.relative(path.join(directory, "edit-backups"), row.backupPath) : "..";
          if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !/^[0-9a-f-]{36}$/.test(relative)) throw new Error("Invalid pending edit backup path; existing file preserved");
        }
        const record = { ...row, beforeBytes: row.beforeBytes === null ? null : typeof row.beforeBytes === "string" ? Buffer.from(row.beforeBytes, "base64") : undefined } as EditRecord;
        if (record.prepared && record.beforeDigest !== undefined) {
          let current: Buffer | null;
          try { current = await fs.readFile(record.path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; current = null; }
          // A write-ahead entry may have been saved before replacement happened.
          // Do not present an unapplied edit as something the user must undo.
          if (fileDigest(current) === record.beforeDigest) { if (record.backupPath) this.garbage.push(record.backupPath); continue; }
          if (fileDigest(current) === record.afterDigest) record.prepared = false;
        }
        const key = this.key(record.path);
        recovered.set(key, [...recovered.get(key) ?? [], record]);
      }
      this.changes = recovered;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    this.storageFile = file;
    this.emit();
  }
  private persist(): void {
    if (!this.storageFile) return;
    const records = [...this.changes.values()].flat().map(row => ({ ...row, beforeBytes: row.beforeBytes === null ? null : row.beforeBytes?.toString("base64") }));
    const temporary = `${this.storageFile}.${randomUUID()}.tmp`;
    const handle = syncFs.openSync(temporary, "wx", 0o600);
    try { syncFs.writeFileSync(handle, JSON.stringify({ version: 1, records })); syncFs.fsyncSync(handle); }
    finally { syncFs.closeSync(handle); }
    try { syncFs.renameSync(temporary, this.storageFile); syncDirectorySync(path.dirname(this.storageFile)); }
    finally { try { syncFs.rmSync(temporary, { force: true }); } catch { /* retain primary error */ } }
  }
  async flush(): Promise<void> { this.persist(); }
  private listeners = new Set<() => void>();
  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() {
    this.persist();
    for (const backup of this.garbage.splice(0)) void fs.rm(backup, { force: true }).catch(() => {});
    for (const listener of this.listeners) { try { listener(); } catch { /* observers cannot break a committed edit */ } }
  }
  private commitState(change: () => void): void {
    const previous = new Map([...this.changes].map(([key, rows]) => [key, [...rows]]));
    const garbage = [...this.garbage];
    try { change(); this.emit(); } catch (error) { this.changes = previous; this.garbage = garbage; throw error; }
  }
  private key(file: string) { const abs = safePath(file); return process.platform === "win32" ? abs.toLowerCase() : abs; }
  /** Compatibility surface for small text edits; mutation tools use recordBytes. */
  record(file: string, before: string, after: string, existedBefore: boolean, owner?: ChangeOwner) {
    this.recordBytes(file, existedBefore ? Buffer.from(before) : null, Buffer.from(after), owner);
  }
  /** A deletion's backup must already exist before the file is removed. */
  recordBytes(file: string, before: Buffer | null, after: Buffer | null, owner?: ChangeOwner, backupPath?: string, originalMode?: number, prepareOnly = false) {
    const previous = textView(before), next = textView(after);
    const record: EditRecord = {
      path: file, before: previous.text, after: next.text, existedBefore: before !== null,
      binary: previous.binary || next.binary, previewOnly: previous.previewOnly || next.previewOnly,
      owner: owner ? { ...owner } : undefined,
      beforeBytes: backupPath ? undefined : before === null ? null : Buffer.from(before),
      backupPath, beforeDigest: fileDigest(before), afterDigest: fileDigest(after), originalMode, prepared: prepareOnly,
    };
    const key = this.key(file);
    const records = this.changes.get(key) ?? [];
    records.push(record); this.changes.set(key, records);
    try { if (prepareOnly) this.persist(); else this.emit(); } catch (error) { records.pop(); if (!records.length) this.changes.delete(key); throw error; }
    return record;
  }
  cancelPrepared(record: EditRecord): void { this.commitState(() => this.discard(this.key(record.path), record)); }
  publishPrepared(record: EditRecord): void { record.prepared = false; this.emit(); }
  list(scope?: ChangeScope): PendingChange[] {
    const out: PendingChange[] = [];
    for (const records of this.changes.values()) {
      const selected = records.filter((record) => matches(record, scope));
      if (!selected.length) continue;
      const first = selected[0], last = selected[selected.length - 1];
      out.push({ path: last.path, before: first.before, after: last.after, existedBefore: first.existedBefore,
        binary: selected.some((r) => r.binary), previewOnly: selected.some((r) => r.previewOnly), owner: last.owner });
    }
    return out;
  }
  get(file: string, scope?: ChangeScope): PendingChange | undefined { return this.list(scope).find((c) => this.key(c.path) === this.key(file)); }
  /** Individual edit evidence, without folding intervening edits from other owners. */
  snapshots(file: string, scope?: ChangeScope): PendingChange[] {
    return (this.changes.get(this.key(file)) ?? []).filter(record => matches(record, scope)).map(record => ({
      path: record.path, before: record.before, after: record.after, existedBefore: record.existedBefore,
      binary: record.binary, previewOnly: record.previewOnly, owner: record.owner ? { ...record.owner } : undefined,
    }));
  }
  has(file: string): boolean { return this.changes.has(this.key(file)); }
  count(): number { return this.changes.size; }
  hunks(file: string): Hunk[] { const c = this.get(file); return c && !c.previewOnly ? computeHunks(c.before, c.after) : []; }
  private discard(key: string, record: EditRecord) {
    const records = this.changes.get(key)?.filter((item) => item !== record) ?? [];
    if (records.length) this.changes.set(key, records); else this.changes.delete(key);
    if (record.backupPath) this.garbage.push(record.backupPath);
  }
  accept(file: string, scope?: ChangeScope) {
    const key = this.key(file);
    this.commitState(() => { for (const record of [...this.changes.get(key) ?? []]) if (matches(record, scope)) this.discard(key, record); });
  }
  acceptAll(scope?: ChangeScope) { for (const c of this.list(scope)) this.accept(c.path, scope); }
  private async original(record: EditRecord): Promise<Buffer | null> {
    if (!record.existedBefore) return null;
    const bytes = record.backupPath ? await fs.readFile(record.backupPath) : record.beforeBytes ? Buffer.from(record.beforeBytes) : undefined;
    if (bytes) {
      if (record.beforeDigest !== undefined && fileDigest(bytes) !== record.beforeDigest) throw new Error(`Cannot undo ${record.path}: its backup is corrupt. Current file was preserved.`);
      return bytes;
    }
    throw new Error(`Cannot undo ${record.path}: the original backup is unavailable. Current file was preserved.`);
  }
  async reject(file: string, scope?: ChangeScope): Promise<void> {
    await withPathLock(file, undefined, async (canonical) => {
      const key = this.key(canonical);
      if (key !== this.key(file) && this.changes.has(this.key(file))) throw new Error(`Cannot undo ${file}: its destination changed. Current file was preserved.`);
      const records = [...this.changes.get(key) ?? []];
      for (const record of records.reverse()) {
        if (!matches(record, scope)) continue;
        const snapshot = await readSnapshot(canonical);
        if (record.beforeDigest !== undefined && fileDigest(snapshot.data) === record.beforeDigest) {
          // Recovery after the file was restored but the journal save failed.
          this.commitState(() => this.discard(this.key(record.path), record)); continue;
        }
        if (fileDigest(snapshot.data) !== record.afterDigest) {
          throw new Error(`Cannot undo ${file}: it changed after this agent edit. Save or reconcile the newer changes first; no conflicting content was overwritten.`);
        }
        const original = await this.original(record);
        await atomicReplace(canonical, original, record.originalMode ?? snapshot.mode, undefined, async () => {
          await assertCurrentFile(snapshot);
          if (!this.changes.get(key)?.includes(record)) throw new Error(`Cannot undo ${file}: the change was already accepted or replaced.`);
        });
        this.commitState(() => this.discard(this.key(record.path), record));
      }
    });
  }
  async rejectAll(scope?: ChangeScope): Promise<void> {
    const errors: string[] = [];
    for (const c of this.list(scope)) {
      try { await this.reject(c.path, scope); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    }
    if (errors.length) throw new Error(errors.join("\n"));
  }
  async acceptHunk(file: string, hunkIndex: number, scope?: ChangeScope): Promise<void> {
    await this.changeHunk(file, hunkIndex, false, scope);
  }
  async rejectHunk(file: string, hunkIndex: number, scope?: ChangeScope): Promise<void> {
    await this.changeHunk(file, hunkIndex, true, scope);
  }
  private async changeHunk(file: string, index: number, reject: boolean, scope?: ChangeScope) {
    await withPathLock(file, undefined, async (canonical) => {
      const key = this.key(canonical);
      const records = this.changes.get(key) ?? [];
      const selected = records.filter((r) => matches(r, scope));
      if (!selected.length) return;
      if (selected.length !== records.length) throw new Error("This file contains changes from another conversation. Review the whole change before undoing individual hunks.");
      const first = selected[0], last = selected[selected.length - 1];
      if (new Set(selected.map((record) => JSON.stringify(record.owner))).size > 1) {
        throw new Error("Partial review spans multiple conversations or turns. Review the whole file to preserve change ownership.");
      }
      if (selected.some((r) => r.previewOnly)) throw new Error("Partial undo is unavailable for binary or large files; review and undo the whole file.");
      const snapshot = await readSnapshot(canonical);
      if (fileDigest(snapshot.data) !== last.afterDigest) throw new Error(`Cannot update hunk in ${file}: the file has newer changes. Current content was preserved.`);
      const h = computeHunks(first.before, last.after)[index];
      if (!h) return;
      const beforeLines = first.before.length ? first.before.split("\n") : [];
      const afterLines = last.after.length ? last.after.split("\n") : [];
      if (reject) afterLines.splice(h.startLine, h.afterLines.length, ...h.beforeLines);
      else beforeLines.splice(h.beforeStart, h.beforeLines.length, ...h.afterLines);
      const before = Buffer.from(beforeLines.join("\n"));
      const after = Buffer.from(afterLines.join("\n"));
      await assertCurrentFile(snapshot);
      if (reject) await atomicReplace(canonical, after, snapshot.mode, undefined, () => assertCurrentFile(snapshot));
      for (const record of records) this.discard(key, record);
      if (!before.equals(after)) this.recordBytes(canonical, first.existedBefore ? before : null, after, first.owner);
      this.emit();
    });
  }
}
export const pendingChanges = new PendingChangesStore();
