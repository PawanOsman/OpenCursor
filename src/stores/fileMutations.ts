/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as fs from "fs/promises";
import { assertExecutionPath } from "../agent/execution";
import * as path from "path";
import * as os from "os";
import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { safePath } from "../context/workspaceUtils";
import { pendingChanges, fileDigest, type ChangeOwner } from "./pendingChanges";
import { syncDirectory } from "./durableFiles";

const locks = new Map<string, Promise<void>>();
let backupDirectory: Promise<string> | undefined;
export async function configureFileMutationStorage(directory: string): Promise<void> {
  const backups = path.join(directory, "edit-backups");
  await fs.mkdir(backups, { recursive: true, mode: 0o700 });
  backupDirectory = Promise.resolve(backups);
}
export function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) { const error = new Error("aborted: file mutation cancelled"); error.name = "AbortError"; throw error; }
}
async function awaitLock(previous: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return previous;
  assertNotAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      const error = new Error("aborted: file mutation cancelled while waiting for another edit");
      error.name = "AbortError"; reject(error);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    previous.then(() => { signal.removeEventListener("abort", onAbort); resolve(); }, (error) => {
      signal.removeEventListener("abort", onAbort); reject(error);
    });
  });
}
/** Resolve existing symlinks, including parent directories of a new file. */
export async function canonicalFilePath(input: string): Promise<string> {
  const original = safePath(input);
  let candidate = original;
  const suffix: string[] = [];
  for (;;) {
    try { return path.join(await fs.realpath(candidate), ...suffix); }
    catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(candidate);
      if (parent === candidate) throw error;
      suffix.unshift(path.basename(candidate)); candidate = parent;
    }
  }
}
export async function withPathLock<T>(input: string, signal: AbortSignal | undefined, work: (canonical: string) => Promise<T>): Promise<T> {
  assertNotAborted(signal);
  const canonical = await canonicalFilePath(input);
  assertExecutionPath(canonical);
  const key = process.platform === "win32" ? canonical.toLowerCase() : canonical;
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const slot = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.catch(() => {}).then(() => slot);
  locks.set(key, tail);
  void tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
  try {
    await awaitLock(previous.catch(() => {}), signal);
    assertNotAborted(signal);
    // A symlink changed while this operation waited: do not write a new target
    // under a lock or approval intended for the previous destination.
    if (await canonicalFilePath(input) !== canonical) throw new Error("File destination changed while waiting; retry after reviewing its current path.");
    return await work(canonical);
  } finally { release(); }
}
export interface FileSnapshot {
  path: string;
  data: Buffer | null;
  mode?: number;
  documents: { document: vscode.TextDocument; version: number }[];
}
export async function readSnapshot(file: string): Promise<FileSnapshot> {
  const documents: FileSnapshot["documents"] = [];
  for (const document of vscode.workspace.textDocuments ?? []) {
    if (document.uri.scheme !== "file") continue;
    let resolved: string;
    try { resolved = await canonicalFilePath(document.uri.fsPath); } catch { continue; }
    if (resolved !== file) continue;
    if (document.isDirty) throw new Error(`Cannot edit ${file}: it has unsaved editor changes. Save or reconcile them first.`);
    documents.push({ document, version: document.version });
  }
  try {
    const info = await fs.stat(file);
    if (!info.isFile()) throw new Error(`Cannot edit ${file}: expected a regular file.`);
    return { path: file, data: await fs.readFile(file), mode: info.mode, documents };
  } catch (error: any) {
    if (error?.code === "ENOENT") return { path: file, data: null, documents };
    throw error;
  }
}
export async function assertCurrentFile(snapshot: FileSnapshot): Promise<void> {
  for (const { document, version } of snapshot.documents) {
    if (document.isDirty || document.version !== version) throw new Error(`File changed in the editor during this operation: ${snapshot.path}. Retry against the current contents.`);
  }
  const current = await readSnapshot(snapshot.path);
  if (fileDigest(current.data) !== fileDigest(snapshot.data)) throw new Error(`File changed during this operation: ${snapshot.path}. Newer contents were preserved.`);
}
/** Atomic replacement prevents partial/truncated files on an interrupted write. */
export async function atomicReplace(file: string, data: Buffer | null, mode?: number, signal?: AbortSignal, beforeCommit?: () => Promise<void>): Promise<void> {
  assertNotAborted(signal);
  if (data === null) {
    await beforeCommit?.(); assertNotAborted(signal); await fs.unlink(file); await syncDirectory(path.dirname(file)); return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.ocursor-${randomUUID()}.tmp`);
  try {
    const handle = await fs.open(temporary, "wx", mode === undefined ? 0o666 : mode & 0o777);
    try { await handle.writeFile(data, { signal }); await handle.sync(); } finally { await handle.close(); }
    await beforeCommit?.(); assertNotAborted(signal);
    await fs.rename(temporary, file);
    await syncDirectory(path.dirname(file));
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}
export interface MutationOptions { signal?: AbortSignal; owner?: ChangeOwner }
export async function mutateFile<T>(input: string, options: MutationOptions, update: (snapshot: FileSnapshot) => Promise<{ data: Buffer | null; result: T }> | { data: Buffer | null; result: T }): Promise<T> {
  return withPathLock(input, options.signal, async (canonical) => {
    const snapshot = await readSnapshot(canonical);
    assertNotAborted(options.signal);
    const next = await update(snapshot);
    assertNotAborted(options.signal);
    if (fileDigest(snapshot.data) === fileDigest(next.data)) return next.result;
    if (next.data === null && (await fs.lstat(safePath(input))).isSymbolicLink()) {
      throw new Error("Delete cannot safely undo a symbolic link; remove the link explicitly with an approved shell command.");
    }
    let backupPath: string | undefined;
    try {
      // Persist original bytes before the destructive operation. Backup failure
      // aborts the edit; it must never become an unrecoverable 'empty' snapshot.
      if (snapshot.data !== null) {
        backupDirectory ??= fs.mkdtemp(path.join(os.tmpdir(), "ocursor-edit-backups-"));
        backupPath = path.join(await backupDirectory, randomUUID());
        const backup = await fs.open(backupPath, "wx", 0o600);
        try { await backup.writeFile(snapshot.data, { signal: options.signal }); await backup.sync(); } finally { await backup.close(); }
        await syncDirectory(path.dirname(backupPath));
      }
      // Write-ahead ownership: even a host crash between replacement and UI
      // delivery retains the original bytes and exact expected new digest.
      const prepared = pendingChanges.recordBytes(canonical, snapshot.data, next.data, options.owner, backupPath, snapshot.mode, true);
      try { await atomicReplace(canonical, next.data, snapshot.mode, options.signal, async () => {
        if (await canonicalFilePath(input) !== canonical) throw new Error("File destination changed before mutation; newer path was preserved.");
        assertExecutionPath(canonical);
        await assertCurrentFile(snapshot);
      }); } catch (error) {
        // A directory-sync error can arrive after replacement. Preserve the
        // write-ahead record and its backup whenever the new bytes are present.
        let committed = false;
        try { committed = fileDigest((await readSnapshot(canonical)).data) === fileDigest(next.data); } catch { committed = true; }
        if (committed) backupPath = undefined;
        else pendingChanges.cancelPrepared(prepared);
        throw error;
      }
      backupPath = undefined; // owned by pendingChanges until accept/reject
      pendingChanges.publishPrepared(prepared);
      return next.result;
    } finally { if (backupPath) await fs.rm(backupPath, { force: true }).catch(() => {}); }
  });
}
