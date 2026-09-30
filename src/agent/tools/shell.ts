/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { safePath, getWorkspaceRoot } from "../../context/workspaceUtils";
import { defineTool, type ToolContext, type ToolResult } from "./types";
import type { ToolOutcome } from "../toolOutcome";
import { spawnPtyCommand, getInteractiveTerminal, terminalDimensions } from "../ptyRuntime";
import {
  nextShellId, registerShellJob, getOwnedShell, shellOutcome,
  finishShellTranscript, waitForShell, renderShell, pushShellOutput,
  getShellSession, spawnShellCommand, trackShellProcess, killShellProcess, applyCwdSideEffect,
  type BgShell, type ShellNotify,
} from "./shared";

const DEFAULT_BLOCK_MS = 30_000;
const MAX_BLOCK_MS = 30_000;
export const MAX_AWAIT_MS = 120_000;
const BACKGROUND_LIFETIME_MS = 600_000;

function failure(message: string): ToolResult {
  return { output: `error: ${message}`, outcome: { status: "failed" } };
}

function recordOutcome(ctx: ToolContext | undefined, callId: string | undefined, outcome: ToolOutcome): void {
  if (!callId) return;
  try { ctx?.recordToolOutcome?.(callId, outcome); } catch { /* bookkeeping must not interrupt the process */ }
}

function cancellation(signal?: AbortSignal): "aborted" | "timed_out" {
  const reason = signal?.reason;
  return reason?.name === "TimeoutError" || /^timeout:/i.test(String(reason?.message ?? "")) ? "timed_out" : "aborted";
}

/** Build a notify_on_output config from the tool input, if present. */
function buildNotify(input: any, ctx?: ToolContext): ShellNotify | undefined {
  const cfg = input?.notify_on_output;
  if (!cfg?.pattern) return undefined;
  let re: RegExp;
  try { re = new RegExp(String(cfg.pattern)); } catch { return undefined; }
  return {
    re, reason: String(cfg.reason ?? "output"),
    debounceMs: Math.max(5000, Number(cfg.debounce_ms) || 0),
    lastNotified: 0, emit: ctx?.emitShellNotify,
  };
}

/** A live UI subscription lasts for this invocation, not the retained job. */
function makeLiveStream(sh: BgShell, callId: string | undefined, ctx?: ToolContext) {
  const emit = ctx?.emitToolProgress;
  let last = 0;
  let timer: NodeJS.Timeout | undefined;
  let disposed = false;
  const send = () => {
    timer = undefined;
    if (disposed || !emit || !callId) return;
    last = Date.now();
    try { emit(callId, renderShell(sh)); } catch { /* UI failure must not kill the job */ }
  };
  return {
    update() {
      if (disposed || timer || !emit || !callId) return;
      timer = setTimeout(send, Math.max(0, 120 - (Date.now() - last)));
      timer.unref?.();
    },
    dispose() {
      if (timer) clearTimeout(timer);
      send();
      disposed = true;
    },
  };
}

/** Wait for a queue slot without releasing later commands past an earlier one. */
async function waitForQueue(previous: Promise<unknown>, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>(resolve => {
    const finish = () => { signal?.removeEventListener("abort", finish); resolve(); };
    signal?.addEventListener("abort", finish, { once: true });
    void previous.then(finish, finish);
  });
}

export const runTerminalTool = defineTool("Shell", true, async (input, abortSignal, callId, ctx) => {
  const command = String(input?.command ?? "").trim();
  if (!command) return failure("command is required");
  const requested = Number(input?.block_until_ms);
  const blockMs = Math.min(MAX_BLOCK_MS, Math.max(0, Number.isFinite(requested) ? requested : DEFAULT_BLOCK_MS));
  const root = getWorkspaceRoot();
  const sessionKey = ctx?.shellSessionKey ?? "default";
  // Production runs supply a stable conversation owner. A caller without one
  // may execute a command but cannot read another invocation's transcript.
  const ownerKey = ctx?.shellOwnerKey ?? ctx?.shellSessionKey;
  const session = getShellSession(sessionKey, root);
  let releaseQueue!: () => void;
  const previous = session.queue.catch(() => {});
  const slot = new Promise<void>(resolve => { releaseQueue = resolve; });
  session.queue = previous.then(() => slot);
  await waitForQueue(previous, abortSignal);
  if (abortSignal?.aborted) {
    releaseQueue();
    return { output: "error: cancelled before shell execution", outcome: { status: cancellation(abortSignal) } };
  }
  let cwd = session.cwd || root;
  if (input?.working_directory) {
    try { cwd = safePath(String(input.working_directory)); }
    catch (error) {
      releaseQueue();
      return failure(`invalid working_directory: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const sh: BgShell = {
    id: nextShellId(), ownerKey, sessionKey, command,
    output: "", outputChars: 0, done: false, exitCode: null,
    startedAt: Date.now(), status: "running", cwd, notify: buildNotify(input, ctx), tty: input.tty === true,
  };
  try { await registerShellJob(sh); }
  catch (error) {
    releaseQueue();
    return failure(error instanceof Error ? error.message : String(error));
  }
  recordOutcome(ctx, callId, shellOutcome(sh));
  const live = makeLiveStream(sh, callId, ctx);
  sh.onChunk = live.update;
  const result = (): ToolResult => {
    const outcome = shellOutcome(sh);
    recordOutcome(ctx, callId, outcome);
    return { output: renderShell(sh), outcome };
  };
  const settle = (status: BgShell["status"], code: number | null, note?: string) => {
    if (sh.done) return;
    if (note) pushShellOutput(sh, `\n${note}\n`);
    sh.exitCode = code;
    sh.status = status;
    sh.done = true;
    sh.endedAt = Date.now();
    recordOutcome(ctx, callId, shellOutcome(sh));
    live.update();
  };

  let proc: ReturnType<typeof spawnShellCommand>;
  try {
    abortSignal?.throwIfAborted();
    proc = input.tty === true ? await spawnPtyCommand(command, cwd, input.cols, input.rows, abortSignal) : spawnShellCommand(command, cwd);
    if (input.tty === true) trackShellProcess(proc);
  } catch (error) {
    const status = abortSignal?.aborted ? cancellation(abortSignal) : "failed";
    settle(status === "timed_out" ? "timeout" : status, null,
      `(failed to start command: ${error instanceof Error ? error.message : String(error)})`);
    await finishShellTranscript(sh);
    live.dispose(); sh.onChunk = undefined; sh.notify = undefined;
    releaseQueue();
    return result();
  }
  sh.proc = proc;
  session.running.add(proc);
  const stop = (timeout = false) => {
    if (sh.done) return;
    settle(timeout ? "timeout" : "aborted", null,
      timeout ? "(terminal deadline reached; command killed)" : "(command aborted)");
    killShellProcess(proc);
  };
  const onAbort = () => stop(cancellation(abortSignal) === "timed_out");
  sh.abort = () => stop();
  abortSignal?.addEventListener("abort", onAbort, { once: true });
  const lifetime = setTimeout(() => stop(true), BACKGROUND_LIFETIME_MS);
  lifetime.unref?.();
  sh.cleanup = () => {
    clearTimeout(lifetime);
    abortSignal?.removeEventListener("abort", onAbort);
    sh.abort = undefined;
    sh.notify = undefined;
  };
  // setEncoding retains incomplete UTF-8 sequences between pipe chunks.
  proc.stdout?.setEncoding("utf8");
  proc.stderr?.setEncoding("utf8");
  const onData = (data: string) => pushShellOutput(sh, data);
  proc.stdout?.on("data", onData);
  proc.stderr?.on("data", onData);
  proc.once("error", error => settle("failed", null, `(failed to run command: ${error.message})`));
  // close follows drained stdout/stderr; exit alone may miss the final output.
  proc.once("close", (code, signal) => {
    session.running.delete(proc);
    if (signal) sh.signal = String(signal);
    if (!sh.done) {
      settle(code === 0 && !signal ? "completed" : "failed", code);
      if (sh.status === "completed") applyCwdSideEffect(session, command);
    } else if (code !== null) sh.exitCode = code;
    recordOutcome(ctx, callId, shellOutcome(sh));
    sh.cleanup?.(); sh.cleanup = undefined;
    sh.proc = undefined;
    proc.stdout?.off("data", onData); proc.stderr?.off("data", onData);
    void finishShellTranscript(sh);
  });
  if (abortSignal?.aborted) onAbort();
  try {
    await waitForShell(sh, blockMs, undefined, abortSignal);
    if (abortSignal?.aborted) onAbort();
    if (!sh.done) sh.status = "backgrounded";
    if (sh.done && !sh.proc) await finishShellTranscript(sh);
    return result();
  } catch (error) {
    settle("failed", null, `(error: ${error instanceof Error ? error.message : String(error)})`);
    killShellProcess(proc);
    return result();
  } finally {
    live.dispose();
    if (sh.onChunk === live.update) sh.onChunk = undefined;
    releaseQueue();
    // The abort subscription belongs to the process and is removed on close.
  }
});

export const awaitShellTool = defineTool("AwaitShell", false, async (input, abortSignal, callId, ctx) => {
  const requested = Number(input?.block_until_ms);
  const blockMs = Math.min(MAX_AWAIT_MS, Math.max(0, Number.isFinite(requested) ? requested : DEFAULT_BLOCK_MS));
  const id = input?.shell_id ? String(input.shell_id) : "";
  if (!id) {
    if (blockMs <= 0) return failure("shell_id is required when block_until_ms is 0");
    const startedAt = Date.now();
    await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); abortSignal?.removeEventListener("abort", finish); resolve(); };
      const timer = setTimeout(finish, blockMs);
      if (abortSignal?.aborted) finish();
      else abortSignal?.addEventListener("abort", finish, { once: true });
    });
    return abortSignal?.aborted
      ? { output: `Sleep aborted after ${Date.now() - startedAt}ms.`, outcome: { status: cancellation(abortSignal) } }
      : { output: `Slept for ${blockMs}ms.`, outcome: { status: "completed" } };
  }
  const sh = getOwnedShell(ctx?.shellOwnerKey ?? ctx?.shellSessionKey, id);
  if (!sh) {
    if (/^toolu_|^call_/i.test(id)) return failure(`"${id}" looks like a Task call id; subagents are not terminal jobs`);
    return failure("terminal job is unavailable in this conversation (expired or unknown job)");
  }
  recordOutcome(ctx, callId, shellOutcome(sh));
  let pattern: RegExp | undefined;
  if (input?.pattern) {
    try { pattern = new RegExp(String(input.pattern), "m"); }
    catch (error) { return failure(`invalid pattern: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const live = makeLiveStream(sh, callId, ctx);
  const listener = () => live.update();
  sh.outputListeners ??= new Set();
  sh.outputListeners.add(listener);
  try {
    await waitForShell(sh, blockMs, pattern, abortSignal);
    if (sh.done && !sh.proc) await finishShellTranscript(sh);
    const processOutcome = shellOutcome(sh);
    const outcome = abortSignal?.aborted ? { ...processOutcome, status: cancellation(abortSignal) } : processOutcome;
    recordOutcome(ctx, callId, outcome);
    return {
      output: `${abortSignal?.aborted ? "(wait cancelled; job status follows)\n" : ""}${renderShell(sh)}`,
      outcome,
    };
  } finally {
    live.dispose();
    sh.outputListeners.delete(listener);
  }
});

/** Write/resize an owned native terminal; cancelling observation does not undo sent input. */
export const writeStdinTool = defineTool("WriteStdin", true, async (input, signal, callId, ctx) => {
  const sh = getOwnedShell(ctx?.shellOwnerKey ?? ctx?.shellSessionKey, String(input?.shell_id || ""));
  if (!sh || sh.sessionKey !== ctx?.shellSessionKey) return failure("Interactive terminal is unavailable in this run or belongs to another conversation.");
  if (!sh.tty || !sh.proc || sh.done) return failure("This job is not an active interactive terminal. Start Shell with tty=true.");
  const terminal = getInteractiveTerminal(sh.proc);
  if (!terminal) return failure("The native terminal has already closed.");
  if (input.chars != null && (typeof input.chars !== "string" || input.chars.length > 64 * 1024)) return failure("Terminal input must be a string no larger than 64 KiB.");
  try {
    signal?.throwIfAborted();
    if (input.cols != null || input.rows != null) {
      const size = terminalDimensions(input.cols ?? terminal.cols, input.rows ?? terminal.rows);
      terminal.resize(size.cols, size.rows);
    }
    if (input.terminate === true) {
      const proc = sh.proc;
      sh.abort?.();
      const stopped = await killShellProcess(proc);
      if (!stopped) return failure("Terminal termination requested, but process closure is unconfirmed.");
    } else if (input.chars) terminal.write(input.chars);
    return await awaitShellTool.execute({ shell_id: sh.id, block_until_ms: Math.min(30_000, Math.max(0, Number(input.block_until_ms) || 0)) }, signal, callId, ctx);
  } catch (error) { return failure(error instanceof Error ? error.message : String(error)); }
});
