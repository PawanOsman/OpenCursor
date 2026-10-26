/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as fs from "node:fs/promises";
import * as syncFs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

// Windows does not support opening directories for fsync. On POSIX this makes
// the rename/directory entry durable, in addition to the file contents.
export async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === "win32") return;
  const handle = await fs.open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}
export function syncDirectorySync(directory: string): void {
  if (process.platform === "win32") return;
  const handle = syncFs.openSync(directory, "r");
  try { syncFs.fsyncSync(handle); } finally { syncFs.closeSync(handle); }
}
export async function durableWrite(file: string, contents: string | Buffer): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, "wx", 0o600);
    try { await handle.writeFile(contents); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, file);
    await syncDirectory(path.dirname(file));
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}
/**
 * Atomic replace without fsync: readers never observe a torn file, but the
 * write may be lost on power failure. For frequently rewritten caches/snapshots
 * whose durability matches VS Code's own Memento storage.
 */
export async function atomicWrite(file: string, contents: string | Buffer): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, contents, { mode: 0o600, flag: "wx" });
    // Windows can briefly refuse a rename while a scanner/indexer holds the target.
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(temporary, file); break; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 4 || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) throw error;
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
      }
    }
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}
