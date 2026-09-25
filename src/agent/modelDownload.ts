/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as fs from "fs/promises";
import { createReadStream } from "fs";
import { createHash } from "crypto";
import * as path from "path";

export interface DownloadOptions {
  signal?: AbortSignal;
  sha256?: string;
  expectedBytes?: number;
  onProgress?: (received: number, total: number) => void;
  timeoutMs?: number;
}
interface PartialMetadata { url: string; validator?: string; sha256?: string; total?: number }
const transfers = new Set<string>();

async function digest(file: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
  return hash.digest("hex");
}

export async function assertGguf(file: string): Promise<void> {
  const handle = await fs.open(file, "r");
  try {
    const magic = Buffer.alloc(4);
    const { bytesRead } = await handle.read(magic, 0, 4, 0);
    if (bytesRead !== 4 || magic.toString("ascii") !== "GGUF") throw new Error("The downloaded file is not a GGUF model (invalid header).");
  } finally { await handle.close(); }
}

/** Resume only a validated representation. Never publish a partial or corrupt model. */
export async function downloadModelFile(url: string, destination: string, options: DownloadOptions = {}): Promise<void> {
  if (transfers.has(destination)) throw new Error("This model is already downloading.");
  if (options.sha256 && !/^[a-f\d]{64}$/i.test(options.sha256)) throw new Error("Invalid SHA-256 checksum.");
  if (options.expectedBytes != null && (!Number.isSafeInteger(options.expectedBytes) || options.expectedBytes <= 0)) throw new Error("Invalid model size.");
  transfers.add(destination);
  const partial = destination + ".part", metadataPath = partial + ".json";
  const expectedHash = options.sha256?.toLowerCase();
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const resetDeadline = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new Error("Model download stalled; retry to resume.")), options.timeoutMs ?? 45_000);
  };
  let preserve = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    signal.throwIfAborted();
    await fs.mkdir(path.dirname(destination), { recursive: true });
    let metadata: PartialMetadata | undefined;
    let received = 0;
    try {
      metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
      if (metadata?.url === url && metadata.sha256 === expectedHash && (metadata.validator || expectedHash)) received = (await fs.stat(partial)).size;
      else metadata = undefined;
    } catch { /* first download or unusable partial */ }
    preserve = received > 0;
    resetDeadline();
    const headers: Record<string, string> = { "accept-encoding": "identity" };
    if (received) { headers.Range = `bytes=${received}-`; if (metadata?.validator) headers["If-Range"] = metadata.validator; }
    let response = await fetch(url, { headers, signal });
    if (response.status === 416 && received) {
      await response.body?.cancel(); received = 0; metadata = undefined;
      response = await fetch(url, { headers: { "accept-encoding": "identity" }, signal });
    }
    if (!response.ok || !response.body) throw new Error(`Model download failed (HTTP ${response.status}).${response.status === 401 || response.status === 403 ? " This repository may require access credentials; import an authorized local GGUF instead." : ""}`);
    const validator = response.headers.get("etag") || response.headers.get("last-modified") || undefined;
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") || "");
    if (response.status === 206) {
      if (!range || Number(range[1]) !== received || (metadata?.validator && validator !== metadata.validator)) {
        await response.body.cancel(); throw new Error("The server returned an inconsistent resume range; retry the download.");
      }
    } else received = 0; // Range ignored or representation changed: restart, never append.
    const length = response.headers.get("content-encoding") ? 0 : Number(response.headers.get("content-length") || 0);
    const total = range ? Number(range[3]) : length;
    if (options.expectedBytes && total && total !== options.expectedBytes) {
      await response.body.cancel(); throw new Error("Model size changed since the file list was loaded. Refresh it before downloading.");
    }
    if (total) {
      const disk = await fs.statfs(path.dirname(destination)).catch(() => undefined);
      if (disk && Number(disk.bavail) * Number(disk.bsize) < Math.max(0, total - received)) {
        await response.body.cancel(); throw new Error("There is not enough free disk space for this model.");
      }
    }
    preserve = Boolean(validator || expectedHash);
    await fs.writeFile(metadataPath, JSON.stringify({ url, validator, sha256: expectedHash, total } satisfies PartialMetadata), { mode: 0o600 });
    reader = response.body.getReader();
    const handle = await fs.open(partial, received ? "a" : "w", 0o600);
    try {
      for (;;) {
        signal.throwIfAborted(); resetDeadline();
        const chunk = await reader.read();
        if (chunk.done) break;
        await handle.writeFile(chunk.value);
        received += chunk.value.byteLength;
        options.onProgress?.(received, total || options.expectedBytes || 0);
      }
      await handle.sync();
    } finally { await handle.close(); }
    signal.throwIfAborted();
    if (!received || (total && received !== total) || (options.expectedBytes && received !== options.expectedBytes)) throw new Error(`incomplete GGUF download: received ${received} of ${total || options.expectedBytes || "unknown"} bytes`);
    clearTimeout(timer);
    await assertGguf(partial);
    if (expectedHash && await digest(partial, signal) !== expectedHash) {
      preserve = false; throw new Error("Model SHA-256 checksum mismatch. The corrupt download was discarded.");
    }
    signal.throwIfAborted();
    await fs.rename(partial, destination);
    await fs.rm(metadataPath, { force: true });
  } catch (error) {
    if (error instanceof Error && /invalid header|inconsistent resume|size changed/.test(error.message)) preserve = false;
    throw error;
  } finally {
    clearTimeout(timer);
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
    transfers.delete(destination);
    if (!preserve) await Promise.all([fs.rm(partial, { force: true }), fs.rm(metadataPath, { force: true })]);
  }
}
