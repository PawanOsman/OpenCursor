/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";
import { createReadStream, createWriteStream, type WriteStream } from "fs";
import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import type { SubagentRunner, QuestionAsker } from "./types";
import type { ToolOutcome } from "../toolOutcome";
import type { ContextReadInput } from "../contextArchive";
import { spawnExecutionCommand, cleanupExecutionProcess, currentExecutionProfile } from "../execution";

// Directories never walked/listed (tools + indexing).
export { IGNORE, BINARY_EXTS, NOISE_FILES, isNoisePath } from "./ignore";

// File discovery lives in fileScan.ts; re-exported here so existing tool
// imports keep working.
export {
  scanFiles,
  scanFilesCached,
  invalidateScanCache,
  compileGlob,
  globToRe,
  normalizeGlobPattern,
  scorePath,
  fuzzyScore,
  type ScannedFile,
  type ScanResult,
  type ScanOptions,
  type CompiledGlob,
} from "./fileScan";

// ---------------------------------------------------------------------------
// Per-tool hard timeouts (ms). Prevents a hung Grep/Glob/Shell/etc. from
// blocking the agent loop forever. Task/AskQuestion excluded (no outer budget).
// ---------------------------------------------------------------------------
export const TOOL_TIMEOUT_MS: Record<string, number> = {
  // Outer safety net: slightly above each tool's own cap so the tool can
  // clean up (kill process / mark done) before the loop aborts it.
  Shell: 120_000,
  AwaitShell: 300_000,
  Grep: 120_000,
  Rg: 120_000,
  Wait: 130_000,
  Glob: 120_000,
  FileSearch: 120_000,
  SemanticSearch: 300_000,
  SearchDocs: 300_000,
  ListDir: 60_000,
  Read: 300_000,
  ReadLints: 300_000,
  WebSearch: 300_000,
  WebFetch: 300_000,
  StrReplace: 300_000,
  Write: 300_000,
  Delete: 60_000,
  EditNotebook: 300_000,
  CallMcpTool: 180_000,
  FetchMcpResource: 120_000,
  ListMcpResources: 120_000,
  TodoWrite: 120_000,
  TodoRead: 120_000,
  WritePlan: 300_000,
  SwitchMode: 60_000,
};
/** Default when a tool has no explicit entry. */
export const DEFAULT_TOOL_TIMEOUT_MS = 120_000;
/** Tools that manage their own lifetime. Task has no outer budget — nested tools already time out. */
export const NO_TOOL_TIMEOUT = new Set(["AskQuestion", "Task"]);

/** Built-in defaults in seconds (for settings UI). */
export const DEFAULT_TOOL_TIMEOUTS_SEC: Record<string, number> = Object.fromEntries(
  Object.entries(TOOL_TIMEOUT_MS).map(([k, v]) => [k, Math.round(v / 1000)]),
);

/** User overrides from settings (tool name → seconds). Empty/missing = built-in default. */
let toolTimeoutOverridesSec: Record<string, number> = {};

/** Apply settings overrides (seconds). Call whenever feature config loads/changes. */
export function setToolTimeoutOverrides(sec: Record<string, number> | undefined): void {
  const next: Record<string, number> = {};
  if (sec) {
    for (const [k, v] of Object.entries(sec)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) next[k] = Math.floor(n);
    }
  }
  toolTimeoutOverridesSec = next;
}

/**
 * Race a tool promise against a hard timeout. On timeout rejects with an Error
 * whose message starts with "timeout:" so the loop can surface it cleanly.
 * Does not cancel the underlying work by itself — pass a linked AbortSignal
 * into the tool when possible (Shell/Grep honor it).
 * Always settles (never hangs) even if `p` never resolves.
 */
/**
 * Race a tool promise against a hard timeout.
 * On timeout: call `onTimeout` first (abort/kill), then reject immediately so
 * the loop can settle UI without waiting for the underlying work.
 * Late resolve/reject of `p` is ignored (no unhandled rejection).
 */
export function withToolTimeout<T>(
  p: Promise<T>, ms: number, label: string, onTimeout?: () => void, signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => finish(() => reject(new Error(`aborted: ${label}`)));
    // Observe the work even when already aborted, preventing a late unhandled rejection.
    Promise.resolve(p).then(
      value => finish(() => resolve(value)),
      error => finish(() => reject(error instanceof Error ? error : new Error(String(error)))),
    );
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener("abort", onAbort, { once: true });
    if (ms > 0) timer = setTimeout(() => finish(() => {
      try { onTimeout?.(); } catch { /* cleanup is best effort */ }
      reject(new Error(`timeout: ${label} exceeded ${Math.round(ms / 1000)}s`));
    }), ms);
  });
}

/** Resolve the hard timeout for a tool name (0 = none). Honors settings overrides. */
export function toolTimeoutMs(name: string): number {
  if (NO_TOOL_TIMEOUT.has(name)) return 0;
  const overrideSec = toolTimeoutOverridesSec[name];
  if (overrideSec != null && overrideSec > 0) return overrideSec * 1000;
  return TOOL_TIMEOUT_MS[name] ?? DEFAULT_TOOL_TIMEOUT_MS;
}

// Stopwords for the keyword-based SemanticSearch fallback.
export const STOP = new Set([
  "where", "what", "which", "does", "with", "this", "that", "have", "from",
  "into", "when", "how", "the", "and", "for", "are", "work", "works", "handle", "handled",
]);

// ---------------------------------------------------------------------------
// Diff helpers
// ---------------------------------------------------------------------------

export { makeDiff } from "../../shared/lineDiff";

/** 1-based line number of the first difference between two texts. */
export function firstDiffLine(before: string, after: string): number {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return i + 1;
  }
  return Math.min(a.length, b.length) + 1;
}

export { slugify } from "../../shared/planPath";

/**
 * Locate a usable ripgrep binary (cached).
 *
 * VS Code ships ripgrep inside its own installation, so prefer that over PATH:
 * on Windows (and most user machines) `rg` is usually NOT on PATH, which used
 * to silently downgrade Grep to the much slower node fallback.
 */
let rgPathCached: string | null | undefined;

function bundledRgCandidates(): string[] {
  const exe = process.platform === "win32" ? "rg.exe" : "rg";
  const appRoot = process.env.VSCODE_CWD || "";
  const roots: string[] = [];
  try {
    // process.execPath -> .../Code.exe ; ripgrep lives under resources/app.
    const base = path.dirname(process.execPath);
    roots.push(path.join(base, "resources", "app"));
    roots.push(base);
  } catch { /* ignore */ }
  if (appRoot) roots.push(path.join(appRoot, "resources", "app"));
  const out: string[] = [];
  for (const r of roots) {
    out.push(path.join(r, "node_modules", "@vscode", "ripgrep", "bin", exe));
    out.push(path.join(r, "node_modules.asar.unpacked", "@vscode", "ripgrep", "bin", exe));
    out.push(path.join(r, "node_modules", "vscode-ripgrep", "bin", exe));
  }
  return out;
}

function probeRg(cmd: string): Promise<boolean> {
  return new Promise((res) => {
    let settled = false;
    const finish = (v: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      res(v);
    };
    const timer = setTimeout(() => {
      try { c?.kill(); } catch { /* ignore */ }
      finish(false);
    }, 3_000);
    let c: ReturnType<typeof spawn> | undefined;
    try {
      c = spawn(cmd, ["--version"], { windowsHide: true });
    } catch {
      finish(false);
      return;
    }
    c.on("error", () => finish(false));
    c.on("close", (code) => finish(code === 0));
  });
}

/** Absolute path or bare command for ripgrep; null when unavailable. */
export async function rgCommand(): Promise<string | null> {
  if (rgPathCached !== undefined) return rgPathCached;
  for (const cand of bundledRgCandidates()) {
    try {
      await fs.access(cand);
    } catch {
      continue;
    }
    if (await probeRg(cand)) {
      rgPathCached = cand;
      return cand;
    }
  }
  rgPathCached = (await probeRg("rg")) ? "rg" : null;
  return rgPathCached;
}

/** Whether ripgrep is available (cached; 3s probe timeout). */
export async function rgAvailable(): Promise<boolean> {
  return (await rgCommand()) != null;
}

// ---------------------------------------------------------------------------
// Background shell registry (shared by Shell + AwaitShell)
// ---------------------------------------------------------------------------

/** A pattern the agent wants to be notified about when it appears in output. */
export interface ShellNotify {
  re: RegExp;
  reason: string;
  debounceMs: number;
  lastNotified: number;
  /** Set by the loop so a match can emit an agent event. */
  emit?: (text: string) => void;
}

/** Lifecycle state of a shell command (drives the footer the model/UI reads). */
export type ShellStatus = "running" | "completed" | "failed" | "aborted" | "timeout" | "backgrounded";

/** Limits apply per extension host. Active processes still have a ten-minute lifetime. */
export const SHELL_OUTPUT_LIMITS = Object.freeze({
  memoryChars: 64 * 1024,
  transcriptBytes: 8 * 1024 * 1024,
  jobs: 32,
  retentionMs: 24 * 60 * 60 * 1000,
  readChars: 5400,
  readLines: 120,
});

interface ShellTranscript {
  path?: string;
  writer?: WriteStream;
  bytes: number;
  flushedBytes: number;
  truncated: boolean;
  unavailable: boolean;
  pending: number;
  flushWaiters: Set<() => void>;
  finished?: Promise<void>;
}

export interface BgShell {
  id: string;
  /** Conversation ownership is distinct from the run that owns the process. */
  ownerKey?: string;
  sessionKey?: string;
  command: string;
  /** The child shell running this command (unset until spawned). */
  proc?: ChildProcess;
  tty?: boolean;
  output: string;
  outputChars?: number;
  transcript?: ShellTranscript;
  done: boolean;
  exitCode: number | null;
  startedAt: number;
  /** Wall-clock end (set once the command settles). */
  endedAt?: number;
  /** Directory the command ran in. */
  cwd?: string;
  status: ShellStatus;
  /** Signal that killed the underlying process, when known. */
  signal?: string;
  notify?: ShellNotify;
  /** Pull any new session output into this shell's buffer (for polling). */
  pump?: () => void;
  /** Live-output sink (streams the rendered card to the UI while running). */
  onChunk?: (chunk: string) => void;
  outputListeners?: Set<(chunk: string) => void>;
  /** Disposes process-lifetime listeners/timers; never persisted with the job metadata. */
  cleanup?: () => void;
  abort?: () => void;
}

export const bgShells = new Map<string, BgShell>();
export function nextShellId(): string {
  return `shell_${randomUUID().replace(/-/g, "")}`;
}

let transcriptDirectory: Promise<string> | undefined;
let retentionTimer: ReturnType<typeof setInterval> | undefined;

async function getTranscriptDirectory(): Promise<string> {
  if (!transcriptDirectory) transcriptDirectory = (async () => {
    // A private per-host directory prevents account/session collisions. The common
    // root is checked before following it; old host directories expire after 24h.
    const root = path.join(os.tmpdir(), `opencursor-terminal-${process.getuid?.() ?? "user"}`);
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) {
      throw new Error("Terminal transcript directory is not owned by this user");
    }
    await fs.chmod(root, 0o700);
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^host-[A-Za-z0-9]+$/.test(entry.name)) continue;
      const candidate = path.join(root, entry.name);
      const old = await fs.lstat(candidate).catch(() => undefined);
      if (old && !old.isSymbolicLink() && Date.now() - old.mtimeMs > SHELL_OUTPUT_LIMITS.retentionMs) {
        await fs.rm(candidate, { recursive: true, force: true }).catch(() => {});
      }
    }
    const directory = await fs.mkdtemp(path.join(root, "host-"));
    await fs.chmod(directory, 0o700);
    return directory;
  })().catch(error => { transcriptDirectory = undefined; throw error; });
  return transcriptDirectory;
}

function releaseTranscriptWaiters(log: ShellTranscript): void {
  if (log.pending && !log.unavailable) return;
  for (const resolve of log.flushWaiters) resolve();
  log.flushWaiters.clear();
}

export async function flushShellTranscript(sh: BgShell, signal?: AbortSignal): Promise<void> {
  const log = sh.transcript;
  if (log && log.pending && !log.unavailable) {
    await new Promise<void>(resolve => {
      const finish = () => {
        signal?.removeEventListener("abort", finish);
        log.flushWaiters.delete(finish);
        resolve();
      };
      if (signal?.aborted) { finish(); return; }
      log.flushWaiters.add(finish);
      signal?.addEventListener("abort", finish, { once: true });
    });
  }
}

/** Close the writer after queued output; calling this more than once is harmless. */
export async function finishShellTranscript(sh: BgShell): Promise<void> {
  const log = sh.transcript;
  if (!log?.writer) return;
  if (!log.finished) {
    const writer = log.writer;
    log.finished = new Promise<void>(resolve => {
      if (writer.closed) { resolve(); return; }
      writer.once("close", resolve);
      writer.end();
    }).finally(() => { log.writer = undefined; });
  }
  await log.finished;
}

/** Evict only finished jobs. References may expire earlier when the capacity is full. */
export async function pruneShellJobs(now = Date.now(), makeRoom = false): Promise<void> {
  const completed = [...bgShells.values()].filter(sh => sh.done && !sh.proc)
    .sort((a, b) => (a.endedAt ?? a.startedAt) - (b.endedAt ?? b.startedAt));
  for (const sh of completed) {
    if (now - (sh.endedAt ?? sh.startedAt) < SHELL_OUTPUT_LIMITS.retentionMs
      && (!makeRoom || bgShells.size < SHELL_OUTPUT_LIMITS.jobs)) continue;
    // Delete from the registry first, so concurrent readers cannot gain access
    // while cleanup is waiting for the last disk write.
    if (bgShells.get(sh.id) !== sh) continue;
    bgShells.delete(sh.id);
    await finishShellTranscript(sh);
    if (sh.transcript?.path) await fs.unlink(sh.transcript.path).catch(() => {});
    sh.onChunk = undefined;
    sh.notify = undefined;
    sh.output = "";
  }
  if (!bgShells.size && retentionTimer) {
    clearInterval(retentionTimer);
    retentionTimer = undefined;
  }
}

/** Reserve a bounded registry entry and create a private disk spool before spawning. */
export async function registerShellJob(sh: BgShell): Promise<void> {
  await pruneShellJobs(Date.now(), true);
  if (bgShells.size >= SHELL_OUTPUT_LIMITS.jobs) {
    throw new Error(`At most ${SHELL_OUTPUT_LIMITS.jobs} active terminal jobs can be retained; wait for an existing job to finish`);
  }
  bgShells.set(sh.id, sh);
  if (!retentionTimer) {
    retentionTimer = setInterval(() => { void pruneShellJobs().catch(() => {}); }, 60_000);
    retentionTimer.unref?.();
  }
  const log: ShellTranscript = {
    bytes: 0, flushedBytes: 0, truncated: false, unavailable: false, pending: 0, flushWaiters: new Set(),
  };
  sh.transcript = log;
  try {
    const directory = await getTranscriptDirectory();
    log.path = path.join(directory, `${sh.id}.log`);
    const writer = createWriteStream(log.path, { flags: "wx", mode: 0o600, highWaterMark: 64 * 1024 });
    log.writer = writer;
    writer.on("error", () => {
      log.unavailable = true;
      log.truncated = true;
      releaseTranscriptWaiters(log);
      // Logging must not leave the command paused forever if the disk fails.
      sh.proc?.stdout?.resume();
      sh.proc?.stderr?.resume();
    });
    writer.on("drain", () => { sh.proc?.stdout?.resume(); sh.proc?.stderr?.resume(); });
    await new Promise<void>((resolve, reject) => {
      writer.once("open", () => { writer.off("error", reject); resolve(); });
      writer.once("error", reject);
    });
  } catch {
    log.unavailable = true;
    log.truncated = true;
  }
}

export function getOwnedShell(ownerKey: string | undefined, id: string): BgShell | undefined {
  if (!ownerKey) return undefined;
  const sh = bgShells.get(id);
  if (!sh || sh.ownerKey !== ownerKey) return undefined;
  if (sh.done && Date.now() - (sh.endedAt ?? sh.startedAt) >= SHELL_OUTPUT_LIMITS.retentionMs) return undefined;
  return sh;
}

export function shellOutcome(sh: BgShell): ToolOutcome {
  const log = sh.transcript;
  const status = sh.status === "timeout" ? "timed_out" : sh.status === "backgrounded" ? "running" : sh.status;
  return {
    status,
    processStatus: status,
    ...(sh.exitCode === null ? {} : { exitCode: sh.exitCode }),
    jobId: sh.id,
    outputRef: {
      id: sh.id,
      available: !!log?.path && !log.unavailable,
      truncated: log?.truncated ?? true,
      bytes: log?.bytes ?? 0,
      expiresAt: (sh.endedAt ?? sh.startedAt) + SHELL_OUTPUT_LIMITS.retentionMs,
    },
  };
}

/**
 * Keep a bounded head/tail preview and stream the exact decoded output to disk.
 * Pause both pipes on disk backpressure, so queued writes cannot grow without bound.
 */
export function pushShellOutput(sh: BgShell, chunk: string): void {
  sh.outputChars = (sh.outputChars ?? sh.output.length) + chunk.length;
  const preview = sh.output + chunk;
  const head = Math.floor(SHELL_OUTPUT_LIMITS.memoryChars / 4);
  sh.output = preview.length <= SHELL_OUTPUT_LIMITS.memoryChars ? preview
    : preview.slice(0, head) + preview.slice(-(SHELL_OUTPUT_LIMITS.memoryChars - head));
  const log = sh.transcript;
  if (log?.writer && !log.unavailable && !log.truncated) {
    const bytes = Buffer.from(chunk, "utf8");
    let keep = Math.min(bytes.length, SHELL_OUTPUT_LIMITS.transcriptBytes - log.bytes);
    // Never retain half a UTF-8 code point at the disk limit.
    if (keep < bytes.length) {
      while (keep > 0 && (bytes[keep] & 0xc0) === 0x80) keep--;
      log.truncated = true;
    }
    if (keep > 0) {
      log.bytes += keep;
      log.pending++;
      const ready = log.writer.write(bytes.subarray(0, keep), error => {
        if (!error) log.flushedBytes += keep;
        log.pending--;
        releaseTranscriptWaiters(log);
      });
      if (!ready) { sh.proc?.stdout?.pause(); sh.proc?.stderr?.pause(); }
    }
  }
  try { sh.onChunk?.(chunk); } catch { /* ignore */ }
  for (const listener of sh.outputListeners ?? []) {
    try { listener(chunk); } catch { /* an observer must not interrupt the process */ }
  }
  const n = sh.notify;
  if (!n || !n.emit) return;
  if (!n.re.test(chunk)) return;
  const now = Date.now();
  if (now - n.lastNotified < Math.max(5000, n.debounceMs)) return;
  n.lastNotified = now;
  n.emit(`Monitored ${n.reason}: matched in shell ${sh.id}`);
}

/** Read an exact, bounded excerpt of a conversation-owned terminal transcript. */
export async function readShellTranscript(ownerKey: string | undefined, input: ContextReadInput, signal?: AbortSignal): Promise<string> {
  const sh = getOwnedShell(ownerKey, input?.id);
  if (!sh || !/^shell_[a-f0-9]{32}$/.test(input.id)) {
    return "error: terminal transcript is unavailable in this conversation (expired or unknown job)";
  }
  for (const key of ["start_line", "end_line", "start_column"] as const) {
    if (input[key] !== undefined && (!Number.isSafeInteger(input[key]) || input[key]! < 1)) {
      return `error: ${key} must be a positive integer`;
    }
  }
  const startLine = input.start_line ?? 1;
  const startColumn = input.start_column ?? 1;
  const endLine = input.end_line ?? Infinity;
  if (endLine < startLine) return "error: end_line must be at least start_line";
  if (input.pattern !== undefined && (typeof input.pattern !== "string" || !input.pattern.length || input.pattern.length > 4096)) {
    return "error: pattern must contain 1–4096 literal characters";
  }
  if (signal?.aborted) return "error: terminal transcript read aborted";
  await flushShellTranscript(sh, signal);
  if (signal?.aborted) return "error: terminal transcript read aborted";
  const log = sh.transcript;
  if (!log?.path || log.unavailable) return "error: terminal transcript storage is unavailable; only the terminal preview was retained";
  let line = 1, column = 1;
  let fromLine = startLine, fromColumn = startColumn;
  let body = "";
  // Linear-time streaming literal search, including matches spanning disk
  // chunks. A bounded position ring supplies exact line/column coordinates.
  const needle = input.pattern ? [...input.pattern] : [];
  const prefix = Array<number>(needle.length).fill(0);
  for (let i = 1, j = 0; i < needle.length; i++) {
    while (j && needle[i] !== needle[j]) j = prefix[j - 1];
    if (needle[i] === needle[j]) j++;
    prefix[i] = j;
  }
  const positions: Array<{ line: number; column: number }> = [];
  let searched = 0, matchedChars = 0;
  let selected = false, matched = !input.pattern, stopped = false;
  const snapshotBytes = log.flushedBytes;
  if (!snapshotBytes) return `id: ${sh.id}\nstatus: ${shellOutcome(sh).status}\n${sh.done ? "End of retained transcript." : "next_line: 1; next_column: 1"}\n\n(no output retained yet)`;
  try {
    // Snapshot the retained prefix so reading a live writer always finishes.
    const reader = createReadStream(log.path, { encoding: "utf8", highWaterMark: 16 * 1024, end: snapshotBytes - 1, signal });
    for await (const raw of reader) {
      for (const char of String(raw)) {
        if (line > endLine) { stopped = true; break; }
        if (line >= startLine && (line > startLine || column >= startColumn)) {
          if (!matched) {
            positions[searched % needle.length] = { line, column };
            searched++;
            while (matchedChars && char !== needle[matchedChars]) matchedChars = prefix[matchedChars - 1];
            if (char === needle[matchedChars]) matchedChars++;
            if (matchedChars === needle.length) {
              matched = true; selected = true;
              const from = positions[(searched - needle.length) % needle.length];
              fromLine = from.line; fromColumn = from.column; body = input.pattern!;
              // A multi-line search term may itself exceed the page's line
              // budget. Resume inside that match, rather than returning an
              // oversized first page or discarding its remaining characters.
              let lines = 0, units = 0, points = 0;
              for (const part of needle) {
                units += part.length; points++;
                if (part === "\n" && ++lines === SHELL_OUTPUT_LIMITS.readLines) break;
              }
              if (units < body.length) {
                body = body.slice(0, units);
                const resume = positions[(searched - needle.length + points) % needle.length];
                line = resume.line; column = resume.column;
                stopped = true;
                break;
              }
            }
          } else {
            if (!selected) { selected = true; fromLine = line; fromColumn = column; }
            if (body.length + char.length > SHELL_OUTPUT_LIMITS.readChars || line - fromLine >= SHELL_OUTPUT_LIMITS.readLines) {
              stopped = true; break;
            }
            body += char;
          }
        }
        if (char === "\n") { line++; column = 1; } else column += char.length;
      }
      if (stopped) break;
    }
  } catch {
    return signal?.aborted ? "error: terminal transcript read aborted" : "error: terminal transcript is no longer available";
  }
  const status = shellOutcome(sh).status;
  const header = `id: ${sh.id}\nstatus: ${status}; retained_bytes: ${snapshotBytes}; transcript_truncated: ${log.truncated}`;
  if (!matched) return `${header}\nNo literal match in the requested retained range.`;
  if (!selected && (startLine > line || startLine === line && startColumn > column)) return "error: requested position exceeds the retained transcript";
  const cursor = `next_line: ${line}; next_column: ${column}`;
  const next = stopped ? cursor : sh.done ? "End of retained transcript." : `${cursor}\nEnd of currently retained output; job is still running.`;
  return `${header}\nstart_line: ${fromLine}; start_column: ${fromColumn}\n${next}\n\n${body}`;
}

// ---------------------------------------------------------------------------
// Shell sessions (standalone cd persists across commands per run)
// ---------------------------------------------------------------------------

/**
 * A run's shell state. Each command runs in its own child shell (so it always
 * exits with a real exit code and never leaves the agent waiting on a live
 * REPL); only the working directory is carried across calls.
 */
export interface ShellSession {
  /** Directory the next command runs in (updated by `cd`). */
  cwd: string;
  /** Serializes command execution within a run. */
  queue: Promise<unknown>;
  /** Commands still running for this run (killed on dispose). */
  running: Set<ChildProcess>;
}

const IS_WIN = process.platform === "win32";
const shellSessions = new Map<string, ShellSession>();
const processClosures = new WeakMap<ChildProcess, Promise<void>>();
const processKills = new WeakMap<ChildProcess, Promise<boolean>>();

/** Get (or lazily create) the shell state for a run key. */
export function getShellSession(key: string, cwd: string): ShellSession {
  let s = shellSessions.get(key);
  if (!s) {
    s = { cwd, queue: Promise.resolve(), running: new Set() };
    shellSessions.set(key, s);
  }
  return s;
}

/**
 * Spawn one command in its own shell. The command is passed through verbatim —
 * no wrapper script, no marker protocol — so its own exit code is the process
 * exit code and the shell terminates the moment the command does.
 */
export function spawnShellCommand(command: string, cwd: string): ChildProcess {
  const proc = spawnExecutionCommand(command, cwd, () => IS_WIN
    ? spawn(
        "powershell.exe",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
        { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
      )
    : spawn("bash", ["--noprofile", "--norc", "-c", command], {
        cwd,
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, TERM: "dumb", PS1: "", PS2: "" },
      }));
  trackShellProcess(proc);
  // Nothing will ever type at this shell: close stdin so anything that prompts
  // reads EOF and exits instead of hanging forever.
  try {
    proc.stdin?.on("error", () => { /* ignore broken pipe */ });
    proc.stdin?.end();
  } catch { /* ignore */ }
  return proc;
}

/** Register a pipe or native PTY process before exposing its job handle. */
export function trackShellProcess(proc: ChildProcess): void {
  processClosures.set(proc, new Promise<void>(resolve => proc.once("close", () => resolve())));
  if (!IS_WIN && currentExecutionProfile().kind === "local") proc.once("exit", () => { void killShellProcess(proc); });
}

/** Kill a command and everything it spawned (npm/pnpm scripts spawn children). */
export function killShellProcess(proc: ChildProcess): Promise<boolean> {
  if (!proc) return Promise.resolve(true);
  const existing = processKills.get(proc);
  if (existing) return existing;
  const closed = processClosures.get(proc) ?? ((proc.exitCode != null || proc.signalCode)
    ? Promise.resolve() : new Promise<void>(resolve => proc.once("close", () => resolve())));
  let killerClosed = Promise.resolve();
  try {
    if (IS_WIN && proc.pid) {
      const killer = spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true });
      killerClosed = new Promise<void>(resolve => { killer.once("close", () => resolve()); killer.once("error", () => resolve()); });
      killer.on("error", () => { try { proc.kill(); } catch { /* ignore */ } });
    } else if (proc.pid) {
      // Negative pid targets the process group when detached; fall back to the pid.
      try { process.kill(-proc.pid, "SIGKILL"); } catch { proc.kill("SIGKILL"); }
    } else {
      proc.kill();
    }
  } catch { /* ignore */ }
  const result = new Promise<boolean>(resolve => {
    const timer = setTimeout(() => resolve(false), 10_000);
    void Promise.all([closed, killerClosed, cleanupExecutionProcess(proc)]).then(([, , cleaned]) => { clearTimeout(timer); resolve(cleaned); });
  });
  processKills.set(proc, result);
  return result;
}

/**
 * Carry `cd` across calls without keeping a live shell: a command that is only
 * a directory change updates the session cwd for subsequent commands.
 */
export function applyCwdSideEffect(session: ShellSession, command: string): void {
  const m = /^\s*cd\s+(?:\/d\s+)?("([^"]+)"|'([^']+)'|[^\s&|;]+)\s*$/i.exec(command);
  if (!m) return;
  const target = (m[2] ?? m[3] ?? m[1]).trim();
  if (!target || target === "-") return;
  const next = path.isAbsolute(target) ? target : path.resolve(session.cwd, target);
  session.cwd = next;
}

/** Tear down a run's shell state, killing anything still running. */
export async function disposeShellSession(key: string): Promise<void> {
  const s = shellSessions.get(key);
  if (!s) return;
  const processes = [...s.running];
  const jobs = [...bgShells.values()].filter(sh => sh.sessionKey === key);
  for (const sh of bgShells.values()) {
    if (sh.sessionKey === key && !sh.done) sh.abort?.();
  }
  const stopped = await Promise.all(processes.map(proc => killShellProcess(proc)));
  await Promise.all(jobs.filter(sh => sh.done).map(sh => finishShellTranscript(sh)));
  if (stopped.some(ok => !ok)) throw new Error("Owned shell processes did not close within 10 seconds; termination is unconfirmed.");
  s.running.clear();
  shellSessions.delete(key);
}

/**
 * Wait until the shell finishes, `pattern` matches its output, or `ms` elapses.
 * Always resolves (never rejects). `ms <= 0` = one immediate pump + return.
 */
export function waitForShell(sh: BgShell, ms: number, pattern?: RegExp, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (interval) clearInterval(interval);
      sh.outputListeners?.delete(onOutput);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => finish();
    let recent = sh.output?.slice(-Math.floor(SHELL_OUTPUT_LIMITS.memoryChars * 3 / 4)) ?? "";
    const onOutput = (chunk: string) => {
      if (!pattern) return;
      const arriving = recent + chunk;
      recent = arriving.slice(-SHELL_OUTPUT_LIMITS.memoryChars);
      if (pattern.test(arriving)) finish();
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    if (pattern) {
      sh.outputListeners ??= new Set();
      sh.outputListeners.add(onOutput);
    }

    const deadline = Date.now() + Math.max(0, ms);
    const check = () => {
      try { sh.pump?.(); } catch { /* ignore */ }
      if (sh.done) return finish();
      if (pattern) {
        try {
          const shortened = (sh.outputChars ?? sh.output.length) > sh.output.length;
          const head = Math.floor(SHELL_OUTPUT_LIMITS.memoryChars / 4);
          // Do not fabricate a match spanning the omitted middle of a preview.
          if (shortened
            ? pattern.test(sh.output.slice(0, head)) || pattern.test(sh.output.slice(head))
            : pattern.test(sh.output)) return finish();
        } catch { /* bad pattern mid-wait */ }
      }
      if (ms <= 0 || Date.now() >= deadline) return finish();
    };
    // Hard wall-clock: never tick forever even if setInterval stalls.
    timer = setTimeout(finish, Math.max(ms, 0) + 250);
    interval = setInterval(check, 50);
    check();
  });
}

/**
 * Render a shell's state. Header + footer carry metadata (pid, timings,
 * exit_code); AwaitShell's `pattern` deliberately matches only the body.
 */
/** Keep head + tail of long output; drop the middle (where most noise lives). */
function clampMiddle(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = Math.floor(max * 0.6);
  const tail = max - head;
  const dropped = s.length - max;
  return `${s.slice(0, head)}\n... [${dropped} chars truncated] ...\n${s.slice(s.length - tail)}`;
}

/** Collapse consecutive duplicate lines into "line ×N" (RTK-style log dedup). */
function collapseRepeats(s: string): string {
  const lines = s.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    let j = i + 1;
    while (j < lines.length && lines[j] === lines[i]) j++;
    const n = j - i;
    if (n >= 3 && lines[i].trim()) out.push(`${lines[i]}  [×${n}]`);
    else for (let k = i; k < j; k++) out.push(lines[k]);
    i = j;
  }
  return out.join("\n");
}

/** Human-readable label for a settled shell status. */
function statusLabel(sh: BgShell): string {
  switch (sh.status) {
    case "completed":
      return "success";
    case "failed":
      return "failed";
    case "aborted":
      return "aborted";
    case "timeout":
      return "timed out";
    case "backgrounded":
      return "backgrounded";
    default:
      return "running";
  }
}

export function renderShell(sh: BgShell): string {
  const elapsed = (sh.endedAt ?? Date.now()) - sh.startedAt;
  // Trim trailing blank lines the shell echoes; collapse >2 blank lines and
  // runs of identical lines (progress spinners, repeated warnings).
  const cleaned = collapseRepeats(
    sh.output.replace(/\r(?!\n)/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trimEnd(),
  );
  const body = clampMiddle(cleaned, 10000);
  const reference = shellOutcome(sh).outputRef!;
  const omitted = Math.max(0, (sh.outputChars ?? sh.output.length) - sh.output.length);
  const transcript = reference.available
    ? `Transcript: ReadContext {"id":"${sh.id}"} (retained_bytes=${reference.bytes}${reference.truncated ? "; truncated at storage limit or write failure" : ""}; up to 24h retention, capacity may evict earlier).`
    : "Transcript storage unavailable; only this bounded preview is retained.";
  const head = `[shell ${sh.id}]${sh.proc?.pid ? ` pid=${sh.proc.pid}` : ""} ${sh.done ? "elapsed_ms" : "running_for_ms"}=${elapsed}${sh.cwd ? ` cwd=${sh.cwd}` : ""}`;
  const note = omitted ? `\n[Preview omitted ${omitted} characters; use the transcript reference for retained output.]` : "";
  if (sh.done) {
    const code = sh.exitCode ?? "unknown";
    const sig = sh.signal ? ` signal=${sh.signal}` : "";
    // Footer keeps a machine-readable exit_code (the UI colors the card from it).
    return `${head}\n${body || "(no output)"}${note}\n(exit_code=${code}${sig} ${statusLabel(sh)} in ${elapsed}ms)\n${transcript}`;
  }
  // Still running: keep the poll hint + id so the model can await it.
  return `${head}\n${body}${note}\n(still running - poll with AwaitShell shell_id="${sh.id}")\n${transcript}`;
}

// ---------------------------------------------------------------------------
// Injected runners (set by the agent loop to avoid circular imports)
// ---------------------------------------------------------------------------

let SUBAGENT_RUNNER: SubagentRunner | undefined;
export function setSubagentRunner(runner: SubagentRunner | undefined): void {
  SUBAGENT_RUNNER = runner;
}
export function getSubagentRunner(): SubagentRunner | undefined {
  return SUBAGENT_RUNNER;
}

let QUESTION_ASKER: QuestionAsker | undefined;
export function setQuestionAsker(asker: QuestionAsker | undefined): void {
  QUESTION_ASKER = asker;
}
export function getQuestionAsker(): QuestionAsker | undefined {
  return QUESTION_ASKER;
}
