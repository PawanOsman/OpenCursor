/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as os from "os";
import * as fs from "fs/promises";
import { execFile, type ChildProcess } from "child_process";

export type LocalModelState = "available" | "downloading" | "loading" | "ready" | "stopping" | "error";
export interface LocalHardware {
  sampledAt: string;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  logicalCpus: number;
  cpuModel: string;
  diskFreeBytes?: number;
  gpus: { name: string; totalBytes: number; freeBytes: number }[];
  gpuProbe: "nvidia-smi" | "unavailable";
}
export interface ModelFit {
  level: "comfortable" | "tight" | "insufficient" | "unknown";
  estimatedMemoryBytes?: number;
  recommendedContext: number;
  recommendedThreads: number;
  reason: string;
}

/** This is a point-in-time advisory, not an architecture-specific KV-cache estimate. */
export function estimateModelFit(sizeBytes: number | undefined, hardware: LocalHardware): ModelFit {
  const recommendedThreads = Math.max(1, Math.floor(hardware.logicalCpus / 2));
  if (!sizeBytes || !Number.isFinite(sizeBytes) || sizeBytes <= 0) return {
    level: "unknown", recommendedContext: 4096, recommendedThreads,
    reason: "Model size is unknown. Start with a small context and inspect actual runtime memory.",
  };
  const estimatedMemoryBytes = Math.ceil(sizeBytes * 1.2 + 2 * 1024 ** 3);
  // Do not add GPU and system memory: offload topology and shared memory vary.
  const usable = Math.max(hardware.freeMemoryBytes, ...hardware.gpus.map(g => g.freeBytes));
  const level = estimatedMemoryBytes > usable ? "insufficient" : estimatedMemoryBytes > usable * 0.7 ? "tight" : "comfortable";
  return { level, estimatedMemoryBytes, recommendedThreads, recommendedContext: level === "comfortable" ? 8192 : 4096,
    reason: `${level === "insufficient" ? "May exceed currently available memory" : level === "tight" ? "Limited memory headroom" : "Weights appear to fit with headroom"}. Estimate reserves 20% plus 2 GiB for runtime and context; actual KV cache and GPU offload depend on the model.`,
  };
}

export function normalizeLocalEndpoint(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Enter a complete http:// or https:// runtime endpoint."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Runtime endpoints must use HTTP(S) without credentials, a query, or a fragment.");
  }
  return url.toString().replace(/\/+$/, "").replace(/\/v1$/, "");
}

export async function localJson<T = any>(url: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<T> {
  const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal });
    const reader = response.body?.getReader();
    let body = "", bytes = 0;
    if (reader) {
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) { body += decoder.decode(); break; }
          bytes += chunk.value.byteLength;
          if (bytes > 2 * 1024 * 1024) throw new Error("Runtime response exceeded 2 MiB.");
          body += decoder.decode(chunk.value, { stream: true });
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
    let data: any;
    try { data = body ? JSON.parse(body) : {}; } catch { throw new Error(`Endpoint returned non-JSON data (HTTP ${response.status}); verify the runtime and port.`); }
    if (!response.ok || data?.error) throw new Error(`HTTP ${response.status}: ${String(data?.error || body || response.statusText).slice(0, 500)}`);
    return data as T;
  } catch (error) {
    if (init.signal?.aborted) throw init.signal.reason ?? error;
    if (signal.aborted) throw new Error(`Runtime request timed out after ${Math.round(timeoutMs / 1000)} seconds: ${url}`);
    throw new Error(`Cannot reach runtime at ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function readLocalHardware(directory?: string): Promise<LocalHardware> {
  const cpus = os.cpus();
  const hardware: LocalHardware = { sampledAt: new Date().toISOString(), totalMemoryBytes: os.totalmem(), freeMemoryBytes: os.freemem(),
    logicalCpus: cpus.length || 1, cpuModel: cpus[0]?.model || "Unknown CPU", gpus: [], gpuProbe: "unavailable" };
  await Promise.allSettled([
    directory ? fs.statfs(directory).then(stat => { hardware.diskFreeBytes = Number(stat.bavail) * Number(stat.bsize); }) : Promise.resolve(),
    new Promise<void>(resolve => {
      execFile("nvidia-smi", ["--query-gpu=name,memory.total,memory.free", "--format=csv,noheader,nounits"],
        { timeout: 3000, windowsHide: true, maxBuffer: 64 * 1024 }, (error, stdout) => {
          if (!error) {
            hardware.gpus = String(stdout).trim().split(/\r?\n/).flatMap(line => {
              const parts = line.split(","); const free = Number(parts.pop()); const total = Number(parts.pop());
              return Number.isFinite(free) && total > 0 ? [{ name: parts.join(",").trim(), totalBytes: total * 1024 ** 2, freeBytes: free * 1024 ** 2 }] : [];
            });
            if (hardware.gpus.length) hardware.gpuProbe = "nvidia-smi";
          }
          resolve();
        });
    }),
  ]);
  return hardware;
}

const processStops = new WeakMap<ChildProcess, Promise<void>>();

/** Resolve only after stdio closes; concurrent cancellation shares one teardown. */
export function stopLocalProcess(proc: ChildProcess, timeoutMs = 5000): Promise<void> {
  const previous = processStops.get(proc);
  if (previous) return previous;
  const stopping = stopProcess(proc, timeoutMs).catch(error => { processStops.delete(proc); throw error; });
  processStops.set(proc, stopping);
  return stopping;
}

async function stopProcess(proc: ChildProcess, timeoutMs: number): Promise<void> {
  if ((proc.exitCode != null || proc.signalCode) && (!proc.stdout || proc.stdout.destroyed) && (!proc.stderr || proc.stderr.destroyed)) return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return; settled = true; clearTimeout(timer);
      proc.removeListener("close", onClose);
      error ? reject(error) : resolve();
    };
    const onClose = () => finish();
    proc.once("close", onClose);
    const timer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* already exited */ } finish(new Error(`Runtime did not confirm process shutdown within ${timeoutMs / 1000} seconds.`)); }, timeoutMs);
    if (process.platform === "win32" && proc.pid) {
      execFile("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { timeout: timeoutMs, windowsHide: true }, error => {
        if (error && proc.exitCode == null && !proc.signalCode) { try { proc.kill(); } catch { /* close or deadline settles */ } }
      });
    } else { try { proc.kill(); } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); } }
  });
}
