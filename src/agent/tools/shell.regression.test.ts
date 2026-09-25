/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import { once } from "events";
import type { ToolContext } from "./types";
import {
  bgShells, disposeShellSession, finishShellTranscript, flushShellTranscript,
  getOwnedShell, nextShellId, pruneShellJobs, pushShellOutput, readShellTranscript,
  registerShellJob, SHELL_OUTPUT_LIMITS, shellOutcome, type BgShell,
  waitForShell,
} from "./shared";
import { awaitShellTool, runTerminalTool } from "./shell";

vi.mock("vscode", () => ({ workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } }));

vi.mock("../../context/workspaceUtils", () => ({
  getWorkspaceRoot: () => process.cwd(),
  safePath: (value: string) => path.resolve(process.cwd(), value),
}));

function context(owner = "conversation-one", run = "run-one"): ToolContext {
  return { todos: [], shellOwnerKey: owner, shellSessionKey: run };
}

function command(source: string): string {
  const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
  return `${quote(process.execPath)} -e ${quote(source)}`;
}

async function closeJob(sh: BgShell): Promise<void> {
  if (sh.proc) {
    const closed = once(sh.proc, "close");
    sh.abort?.();
    await closed;
  }
  await finishShellTranscript(sh);
}

async function fixture(owner = "conversation-one"): Promise<BgShell> {
  const sh: BgShell = {
    id: nextShellId(), ownerKey: owner, sessionKey: "fixture-run", command: "fixture",
    output: "", outputChars: 0, done: false, exitCode: null, startedAt: Date.now(), status: "running",
  };
  await registerShellJob(sh);
  return sh;
}

afterEach(async () => {
  vi.useRealTimers();
  for (const sh of bgShells.values()) {
    await closeJob(sh);
    sh.done = true;
    sh.endedAt ??= Date.now();
    if (sh.sessionKey) await disposeShellSession(sh.sessionKey);
  }
  await pruneShellJobs(Date.now() + SHELL_OUTPUT_LIMITS.retentionMs + 1);
});

describe.skipIf(process.platform === "win32")("production terminal outcomes and ownership", () => {
  it("classifies by the real exit code and retains a failed job across follow-up runs", async () => {
    const result = await runTerminalTool.execute({
      command: command('process.stdout.write("build finished\\n"); process.stderr.write("diagnostic\\n"); process.exitCode=7'),
      block_until_ms: 2000,
    }, undefined, "call-first", context());
    expect(result.outcome).toMatchObject({ status: "failed", exitCode: 7 });
    expect(result.output).toContain("build finished");
    const id = result.outcome!.jobId!;
    expect(result.outcome!.outputRef).toMatchObject({ id, available: true, truncated: false });
    expect(getOwnedShell("conversation-one", id)?.proc).toBeUndefined();
    disposeShellSession("run-one");
    const observed = await awaitShellTool.execute({ shell_id: id, block_until_ms: 0 }, undefined, "call-follow-up", context("conversation-one", "run-two"));
    expect(observed.outcome).toMatchObject({ status: "failed", exitCode: 7, jobId: id });
    expect(await readShellTranscript("conversation-one", { id })).toContain("diagnostic");
  });

  it("does not classify command-authored error text as a failed command", async () => {
    const result = await runTerminalTool.execute({ command: command('console.log("error: an example string")'), block_until_ms: 2000 }, undefined, undefined, context());
    expect(result.outcome).toMatchObject({ status: "completed", exitCode: 0 });
  });

  it("rejects another conversation even when it knows the job and output IDs", async () => {
    const result = await runTerminalTool.execute({ command: command('console.log("owner-only-output")'), block_until_ms: 2000 }, undefined, undefined, context());
    const id = result.outcome!.jobId!;
    const observed = await awaitShellTool.execute({ shell_id: id, block_until_ms: 0 }, undefined, undefined, context("different-conversation"));
    expect(observed.outcome?.status).toBe("failed");
    expect(observed.output).not.toContain("owner-only-output");
    expect(await readShellTranscript("different-conversation", { id })).toMatch(/^error:/);
    expect(await readShellTranscript(undefined, { id })).toMatch(/^error:/);
  });

  it("returns running before exit, then a terminal outcome after AwaitShell", async () => {
    const result = await runTerminalTool.execute({ command: command('setTimeout(() => console.log("ready"), 100)'), block_until_ms: 0 }, undefined, undefined, context());
    expect(result.outcome?.status).toBe("running");
    expect(result.outcome?.exitCode).toBeUndefined();
    const observed = await awaitShellTool.execute({ shell_id: result.outcome!.jobId, block_until_ms: 2000 }, undefined, undefined, context());
    expect(observed.outcome).toMatchObject({ status: "completed", exitCode: 0 });
    expect(observed.output).toContain("ready");
  });

  it.each([false, true])("retains cancellation/timeout after the background process closes (timeout=%s)", async timeout => {
    const controller = new AbortController();
    const recorded = vi.fn();
    const ctx = { ...context(), recordToolOutcome: recorded };
    const result = await runTerminalTool.execute({ command: command('setInterval(() => {}, 1000)'), block_until_ms: 0 }, controller.signal, "background-call", ctx);
    const sh = getOwnedShell("conversation-one", result.outcome!.jobId!)!;
    expect(recorded).toHaveBeenCalledWith("background-call", expect.objectContaining({ status: "running", processStatus: "running", jobId: sh.id }));
    const closed = once(sh.proc!, "close");
    controller.abort(timeout ? new DOMException("deadline", "TimeoutError") : undefined);
    expect(shellOutcome(sh).status).toBe(timeout ? "timed_out" : "aborted");
    // This update must be synchronous: the outer deadline has not awaited execute.
    expect(recorded).toHaveBeenLastCalledWith("background-call", expect.objectContaining({ status: timeout ? "timed_out" : "aborted", processStatus: timeout ? "timed_out" : "aborted", jobId: sh.id, outputRef: expect.objectContaining({ id: sh.id }) }));
    await closed;
    expect(shellOutcome(sh).status).toBe(timeout ? "timed_out" : "aborted");
    expect(sh.proc).toBeUndefined();
    expect(sh.cleanup).toBeUndefined();
    expect(sh.abort).toBeUndefined();
  });

  it("run disposal kills active jobs while retaining their terminal metadata", async () => {
    const result = await runTerminalTool.execute({ command: command('setInterval(() => {}, 1000)'), block_until_ms: 0 }, undefined, undefined, context());
    const sh = getOwnedShell("conversation-one", result.outcome!.jobId!)!;
    const closed = once(sh.proc!, "close");
    disposeShellSession("run-one");
    await closed;
    expect(shellOutcome(sh).status).toBe("aborted");
    expect(getOwnedShell("conversation-one", sh.id)).toBe(sh);
  });

  it("distinguishes a cancelled wait from the still-running process it observed", async () => {
    const result = await runTerminalTool.execute({ command: command('setInterval(() => {}, 1000)'), block_until_ms: 0 }, undefined, undefined, context());
    const controller = new AbortController();
    const recorded = vi.fn();
    const wait = awaitShellTool.execute({ shell_id: result.outcome!.jobId, block_until_ms: 65000 }, controller.signal, "cancelled-wait", { ...context(), recordToolOutcome: recorded });
    expect(recorded).toHaveBeenLastCalledWith("cancelled-wait", expect.objectContaining({ status: "running", processStatus: "running" }));
    controller.abort();
    const observed = await wait;
    expect(observed.outcome).toMatchObject({ status: "aborted", processStatus: "running", jobId: result.outcome!.jobId });
    expect(observed.output).toContain("wait cancelled; job status follows");
    expect(recorded).toHaveBeenLastCalledWith("cancelled-wait", expect.objectContaining({ status: "aborted", processStatus: "running", jobId: result.outcome!.jobId }));
  });

  it("reports a failed spool explicitly and continues consuming the process output", async () => {
    const result = await runTerminalTool.execute({ command: command('setTimeout(() => console.log("after-storage-failure"), 100)'), block_until_ms: 0 }, undefined, undefined, context());
    const sh = getOwnedShell("conversation-one", result.outcome!.jobId!)!;
    const writer = sh.transcript!.writer!;
    const closed = new Promise<void>(resolve => writer.once("close", resolve));
    writer.destroy(new Error("simulated storage failure"));
    await closed;
    const observed = await awaitShellTool.execute({ shell_id: sh.id, block_until_ms: 2000 }, undefined, undefined, context());
    expect(observed.outcome).toMatchObject({ status: "completed", exitCode: 0, outputRef: { available: false, truncated: true } });
    expect(observed.output).toContain("after-storage-failure");
    expect(await readShellTranscript("conversation-one", { id: sh.id })).toContain("storage is unavailable");
  });

  it("spools output losslessly beyond the bounded preview, including split UTF-8 pipe writes", async () => {
    const text = Array.from({ length: 2500 }, (_, i) => `line ${i}: 😀 exact spaces  \n`).join("");
    const source = `const b=Buffer.from(${JSON.stringify(text)}); for(let i=0;i<b.length;i+=777) process.stdout.write(b.subarray(i,i+777))`;
    const result = await runTerminalTool.execute({ command: command(source), block_until_ms: 2000 }, undefined, undefined, context());
    const sh = getOwnedShell("conversation-one", result.outcome!.jobId!)!;
    await finishShellTranscript(sh);
    expect(sh.output.length).toBeLessThanOrEqual(SHELL_OUTPUT_LIMITS.memoryChars);
    expect(result.output.length).toBeLessThan(12000);
    expect(await fs.readFile(sh.transcript!.path!, "utf8")).toBe(text);
    const page = await readShellTranscript("conversation-one", { id: sh.id, pattern: "line 1234:", end_line: 1235 });
    expect(page).toContain("line 1234: 😀 exact spaces  \n");
    expect(page).toContain("transcript_truncated: false");
  });
});

describe("terminal transcript bounds and paging", () => {
  it("detects a regex across arriving chunks before the preview evicts that boundary", async () => {
    const sh = await fixture();
    pushShellOutput(sh, "ready-");
    let matched = false;
    const wait = waitForShell(sh, 1000, /ready-now/).then(() => { matched = true; });
    pushShellOutput(sh, "now" + "x".repeat(SHELL_OUTPUT_LIMITS.memoryChars));
    await Promise.resolve();
    expect(matched).toBe(true);
    await wait;
  });

  it("caps stored bytes and marks the transcript incomplete without unbounded memory", async () => {
    const sh = await fixture();
    const chunk = "z".repeat(64 * 1024);
    for (let i = 0; i < SHELL_OUTPUT_LIMITS.transcriptBytes / chunk.length + 3; i++) {
      pushShellOutput(sh, chunk);
      await flushShellTranscript(sh);
    }
    await finishShellTranscript(sh);
    expect(sh.output.length).toBe(SHELL_OUTPUT_LIMITS.memoryChars);
    expect(shellOutcome(sh).outputRef).toMatchObject({ bytes: SHELL_OUTPUT_LIMITS.transcriptBytes, truncated: true, available: true });
    expect((await fs.stat(sh.transcript!.path!)).size).toBe(SHELL_OUTPUT_LIMITS.transcriptBytes);
  });

  it("pages a long Unicode line without losing or duplicating characters", async () => {
    const sh = await fixture();
    const text = "header\n" + "a😀b".repeat(8000) + "\ntail\n";
    pushShellOutput(sh, text);
    sh.done = true; sh.status = "completed"; sh.exitCode = 0;
    await finishShellTranscript(sh);
    let line = 1, column = 1, restored = "";
    for (let page = 0; page < 20; page++) {
      const result = await readShellTranscript("conversation-one", { id: sh.id, start_line: line, start_column: column });
      restored += result.slice(result.indexOf("\n\n") + 2);
      const next = /next_line: (\d+); next_column: (\d+)/.exec(result);
      if (!next) break;
      line = Number(next[1]); column = Number(next[2]);
    }
    expect(restored).toBe(text);
  });

  it("matches literals across disk chunks and rejects oversized search inputs", async () => {
    const sh = await fixture();
    const text = "x".repeat(16380) + "cross-boundary-needle\nlast";
    pushShellOutput(sh, text);
    await flushShellTranscript(sh);
    const found = await readShellTranscript("conversation-one", { id: sh.id, pattern: "cross-boundary-needle" });
    expect(found).toContain("start_line: 1; start_column: 16381");
    expect(found).toContain("\n\ncross-boundary-needle\nlast");
    expect(await readShellTranscript("conversation-one", { id: sh.id, pattern: "x".repeat(4097) })).toMatch(/^error:/);
  });

  it("returns a continuation cursor at a live EOF without replaying earlier output", async () => {
    const sh = await fixture();
    pushShellOutput(sh, "first line\npartial");
    const first = await readShellTranscript("conversation-one", { id: sh.id });
    expect(first).toContain("next_line: 2; next_column: 8");
    pushShellOutput(sh, " completed\nnext line\n");
    const next = await readShellTranscript("conversation-one", { id: sh.id, start_line: 2, start_column: 8 });
    expect(next.slice(next.indexOf("\n\n") + 2)).toBe(" completed\nnext line\n");
    expect(next).toContain("next_line: 4; next_column: 1");
  });

  it("keeps multi-line literal matches within the page line limit and resumes losslessly", async () => {
    const sh = await fixture();
    const pattern = "line\n".repeat(150) + "needle";
    const text = "before\n" + pattern + "\nafter";
    pushShellOutput(sh, text);
    sh.done = true;
    await finishShellTranscript(sh);
    const first = await readShellTranscript("conversation-one", { id: sh.id, pattern });
    const body = first.slice(first.indexOf("\n\n") + 2);
    expect(body).toBe("line\n".repeat(SHELL_OUTPUT_LIMITS.readLines));
    const cursor = /next_line: (\d+); next_column: (\d+)/.exec(first)!;
    const next = await readShellTranscript("conversation-one", { id: sh.id, start_line: Number(cursor[1]), start_column: Number(cursor[2]) });
    expect(body + next.slice(next.indexOf("\n\n") + 2)).toBe(pattern + "\nafter");
  });

  it("enforces the registry cap without evicting active jobs and deletes expired disk files", async () => {
    const jobs: BgShell[] = [];
    for (let i = 0; i < SHELL_OUTPUT_LIMITS.jobs; i++) jobs.push(await fixture());
    await expect(fixture()).rejects.toThrow("active terminal jobs");
    expect(bgShells.size).toBe(SHELL_OUTPUT_LIMITS.jobs);
    const oldest = jobs[0];
    oldest.done = true; oldest.status = "completed"; oldest.endedAt = Date.now();
    await finishShellTranscript(oldest);
    const file = oldest.transcript!.path!;
    await fixture();
    expect(getOwnedShell("conversation-one", oldest.id)).toBeUndefined();
    await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
    const remaining = jobs[1];
    remaining.done = true; remaining.endedAt = Date.now() - SHELL_OUTPUT_LIMITS.retentionMs;
    expect(getOwnedShell("conversation-one", remaining.id)).toBeUndefined();
    await pruneShellJobs();
    await expect(fs.stat(remaining.transcript!.path!)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("AwaitShell advertised waits", () => {
  it("waits the requested 65 seconds and caps oversized requests at 120 seconds", async () => {
    vi.useFakeTimers();
    let finished = false;
    const wait = awaitShellTool.execute({ block_until_ms: 65000 }).then(value => { finished = true; return value; });
    await vi.advanceTimersByTimeAsync(64999);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await wait).outcome?.status).toBe("completed");
    const capped = awaitShellTool.execute({ block_until_ms: 999999 });
    await vi.advanceTimersByTimeAsync(120000);
    expect((await capped).output).toBe("Slept for 120000ms.");
  });

  it("cancels a long wait promptly and clears its timer", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const wait = awaitShellTool.execute({ block_until_ms: 65000 }, controller.signal);
    await vi.advanceTimersByTimeAsync(5);
    controller.abort();
    expect((await wait).outcome?.status).toBe("aborted");
    expect(vi.getTimerCount()).toBe(0);
  });
});
