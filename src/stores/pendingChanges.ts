/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as fs from "fs/promises";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { durableWrite } from "./durableFiles";
import { safePath } from "../context/workspaceUtils";
import { computeHunks, type Hunk } from "../shared/lineDiff";
import { withPathLock, assertCurrentFile, readSnapshot, atomicReplace, canonicalFilePathSync } from "./fileMutations";
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

/** Journal writes still in flight, so a restarted store reads the latest snapshot. */
const inflightWrites = new Map<string, Promise<void>>();
function trackWrite(file: string, write: Promise<void>): void {
  const settled = write.catch(() => {});
  inflightWrites.set(file, settled);
  void settled.then(() => { if (inflightWrites.get(file) === settled) inflightWrites.delete(file); });
}
export interface PendingChangesInitResult { quarantined?: string; error?: string }

/** Ordered immutable edit snapshots, scoped to their originating chat and turn. */
export class PendingChangesStore {
  private changes = new Map<string, EditRecord[]>();
  private storageFile?: string;
  private garbage: string[] = [];
  /** Incremented on every in-memory commit; a failed save only rolls back the latest. */
  private version = 0;
  private scheduled?: Promise<void>;
  private chain: Promise<void> = Promise.resolve();
  /** A corrupt journal is quarantined rather than blocking extension activation. */
  async initialize(directory: string): Promise<PendingChangesInitResult> {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, "pending-edits.json");
    await inflightWrites.get(file);
    let result: PendingChangesInitResult = {};
    try {
      this.changes = await this.load(directory, file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.changes = new Map();
        this.garbage = [];
        const quarantined = `${file}.corrupt-${Date.now()}`;
        const message = error instanceof Error ? error.message : String(error);
        try { await fs.rename(file, quarantined); result = { quarantined, error: message }; }
        catch (renameError) { result = { error: `${message}; the journal could not be preserved: ${renameError instanceof Error ? renameError.message : String(renameError)}` }; }
      }
    }
    this.storageFile = file;
    // Settle recovery (migrated backups, dropped preparations) before callers proceed.
    await this.emit().catch(() => { /* retried on the next change; surfaced by flush() */ });
    return result;
  }
  private async load(directory: string, file: string): Promise<Map<string, EditRecord[]>> {
    const saved = JSON.parse(await fs.readFile(file, "utf8"));
    if (saved.version !== 1 || !Array.isArray(saved.records)) throw new Error("Unsupported pending edit journal");
    const recovered = new Map<string, EditRecord[]>();
    for (const row of saved.records) {
      if (typeof row.path !== "string" || !path.isAbsolute(row.path) || !(row.afterDigest === null || /^[a-f0-9]{64}$/.test(row.afterDigest))) throw new Error("Invalid pending edit journal; existing file preserved");
      if (row.backupPath !== undefined) {
        const relative = typeof row.backupPath === "string" ? path.relative(path.join(directory, "edit-backups"), row.backupPath) : "..";
        if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !/^[0-9a-f-]{36}$/.test(relative)) throw new Error("Invalid pending edit backup path; existing file preserved");
      }
      // Older journals stored original bytes inline (base64); the next save moves them to backup files.
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
    return recovered;
  }
  /** Coalesce journal saves: at most one queued write behind the one in progress. */
  private schedulePersist(): Promise<void> {
    if (!this.storageFile) return Promise.resolve();
    if (this.scheduled) return this.scheduled;
    const run = this.chain.catch(() => {}).then(() => { this.scheduled = undefined; return this.writeJournal(); });
    this.scheduled = run;
    this.chain = run;
    trackWrite(this.storageFile, run);
    return run;
  }
  /** Metadata-only journal written atomically; original bytes live in durable backup files. */
  private async writeJournal(): Promise<void> {
    const file = this.storageFile!;
    const garbage = this.garbage.splice(0);
    try {
      const backups = path.join(path.dirname(file), "edit-backups");
      for (const row of [...this.changes.values()].flat()) {
        if (row.backupPath || !row.beforeBytes) continue;
        const bytes = row.beforeBytes;
        await fs.mkdir(backups, { recursive: true, mode: 0o700 });
        const target = path.join(backups, randomUUID());
        await durableWrite(target, bytes);
        const live = this.changes.get(this.key(row.path))?.includes(row);
        if (live && row.beforeBytes === bytes && !row.backupPath) { row.backupPath = target; row.beforeBytes = undefined; }
        else garbage.push(target);
      }
      // Rows added while backups were written keep their bytes until the next save.
      const records = [...this.changes.values()].flat().filter(row => row.backupPath || !row.beforeBytes)
        .map(({ beforeBytes, ...row }) => beforeBytes === null ? { ...row, beforeBytes: null } : row);
      await durableWrite(file, JSON.stringify({ version: 1, records }));
      if ([...this.changes.values()].flat().some(row => !row.backupPath && row.beforeBytes)) void this.schedulePersist().catch(() => {});
    } catch (error) {
      // The journal on disk still references these backups.
      this.garbage.unshift(...garbage);
      throw error;
    }
    for (const backup of garbage) void fs.rm(backup, { force: true }).catch(() => {});
  }
  /** Resolves once every change made so far is durable; rejects if the latest save failed. */
  async flush(): Promise<void> { await this.chain; if (this.scheduled) await this.scheduled; }
  private listeners = new Set<() => void>();
  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private notify() {
    for (const listener of this.listeners) { try { listener(); } catch { /* observers cannot break a committed edit */ } }
  }
  /** Notify observers now and save in the background; failures surface through the returned promise and flush(). */
  private emit(): Promise<void> {
    this.version++;
    this.notify();
    const saved = this.schedulePersist();
    void saved.catch(() => {});
    return saved;
  }
  /** Apply a state change, save it, and roll it back if that save fails and nothing newer superseded it. */
  private commitState(change: () => void): Promise<void> {
    const previous = new Map([...this.changes].map(([key, rows]) => [key, [...rows]]));
    const garbage = [...this.garbage];
    try { change(); } catch (error) { this.changes = previous; this.garbage = garbage; throw error; }
    const saved = this.emit();
    const version = this.version;
    const committed = saved.catch((error) => {
      if (this.version === version) { this.changes = previous; this.garbage = garbage; this.version++; this.notify(); }
      throw error;
    });
    void committed.catch(() => {});
    return committed;
  }
  private key(file: string) { const abs = safePath(file); return process.platform === "win32" ? abs.toLowerCase() : abs; }
  private lookupKey(file: string): string {
    const key = this.key(file);
    // Stored paths identify the destination when the edit was captured. Keep
    // that identity even if a stored path is later replaced with a symlink.
    return this.changes.has(key) ? key : this.key(canonicalFilePathSync(file));
  }
  /** Compatibility surface for small text edits; mutation tools record their captured canonical path. */
  record(file: string, before: string, after: string, existedBefore: boolean, owner?: ChangeOwner) {
    this.recordBytes(file, existedBefore ? Buffer.from(before) : null, Buffer.from(after), owner);
  }
  /** A deletion's backup must already exist before the file is removed. */
  recordBytes(file: string, before: Buffer | null, after: Buffer | null, owner?: ChangeOwner, backupPath?: string, originalMode?: number, prepareOnly = false) {
    return this.recordCanonicalBytes(canonicalFilePathSync(file), before, after, owner, backupPath, originalMode, prepareOnly);
  }
  /** Record the destination captured under a path lock, without following a later symlink retarget. */
  recordCanonicalBytes(file: string, before: Buffer | null, after: Buffer | null, owner?: ChangeOwner, backupPath?: string, originalMode?: number, prepareOnly = false) {
    const record = this.addRecord(file, before, after, owner, backupPath, originalMode, prepareOnly);
    if (prepareOnly) { const saved = this.schedulePersist(); void saved.catch(() => {}); }
    else this.emit();
    return record;
  }
  /**
   * Write-ahead ownership: resolves only once the prepared record (and its
   * original bytes) is durable, so the caller may then replace the file.
   */
  async prepareCanonicalBytes(file: string, before: Buffer | null, after: Buffer | null, owner?: ChangeOwner, backupPath?: string, originalMode?: number): Promise<EditRecord> {
    const record = this.addRecord(file, before, after, owner, backupPath, originalMode, true);
    try { await this.schedulePersist(); }
    catch (error) {
      const key = this.key(file);
      const rows = this.changes.get(key)?.filter(item => item !== record) ?? [];
      if (rows.length) this.changes.set(key, rows); else this.changes.delete(key);
      throw error;
    }
    return record;
  }
  private addRecord(file: string, before: Buffer | null, after: Buffer | null, owner?: ChangeOwner, backupPath?: string, originalMode?: number, prepareOnly = false): EditRecord {
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
    return record;
  }
  cancelPrepared(record: EditRecord): Promise<void> { return this.commitState(() => this.discard(this.key(record.path), record)); }
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
  get(file: string, scope?: ChangeScope): PendingChange | undefined {
    const key = this.lookupKey(file);
    return this.list(scope).find((c) => this.key(c.path) === key);
  }
  /** Individual edit evidence, without folding intervening edits from other owners. */
  snapshots(file: string, scope?: ChangeScope): PendingChange[] {
    return (this.changes.get(this.lookupKey(file)) ?? []).filter(record => matches(record, scope)).map(record => ({
      path: record.path, before: record.before, after: record.after, existedBefore: record.existedBefore,
      binary: record.binary, previewOnly: record.previewOnly, owner: record.owner ? { ...record.owner } : undefined,
    }));
  }
  has(file: string): boolean { return this.changes.has(this.lookupKey(file)); }
  count(): number { return this.changes.size; }
  hunks(file: string): Hunk[] { const c = this.get(file); return c && !c.previewOnly ? computeHunks(c.before, c.after) : []; }
  private discard(key: string, record: EditRecord) {
    const records = this.changes.get(key)?.filter((item) => item !== record) ?? [];
    if (records.length) this.changes.set(key, records); else this.changes.delete(key);
    if (record.backupPath) this.garbage.push(record.backupPath);
  }
  accept(file: string, scope?: ChangeScope): Promise<void> {
    const key = this.lookupKey(file);
    return this.commitState(() => { for (const record of [...this.changes.get(key) ?? []]) if (matches(record, scope)) this.discard(key, record); });
  }
  async acceptAll(scope?: ChangeScope): Promise<void> { await Promise.all(this.list(scope).map(c => this.accept(c.path, scope))); }
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
          await this.commitState(() => this.discard(this.key(record.path), record)); continue;
        }
        if (fileDigest(snapshot.data) !== record.afterDigest) {
          throw new Error(`Cannot undo ${file}: it changed after this agent edit. Save or reconcile the newer changes first; no conflicting content was overwritten.`);
        }
        const original = await this.original(record);
        await atomicReplace(canonical, original, record.originalMode ?? snapshot.mode, undefined, async () => {
          await assertCurrentFile(snapshot);
          if (!this.changes.get(key)?.includes(record)) throw new Error(`Cannot undo ${file}: the change was already accepted or replaced.`);
        });
        await this.commitState(() => this.discard(this.key(record.path), record));
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
      if (key !== this.key(file) && this.changes.has(this.key(file))) throw new Error(`Cannot update hunk in ${file}: its destination changed. Current file was preserved.`);
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
      await this.commitState(() => {
        for (const record of [...records]) this.discard(key, record);
        if (!before.equals(after)) this.addRecord(canonical, first.existedBefore ? before : null, after, first.owner);
      });
    });
  }
}
export const pendingChanges = new PendingChangesStore();
