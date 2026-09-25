/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

/** Deterministic repository outcome checks: real execution, scripted model decisions. */
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderEvent, AgentEvent, Step, ToolCall } from "./types";
import type { StreamChatOpts } from "./provider";
import type { RunAgentOptions } from "./loopTypes";

type Turn = ProviderEvent[] | ((request: StreamChatOpts) => ProviderEvent[] | Promise<ProviderEvent[]>);
const fixture = vi.hoisted(() => ({ root: "", turns: [] as Turn[], requests: [] as StreamChatOpts[], estimates: [] as { input: number; output: number }[] }));
vi.mock("./provider", () => ({ streamChat: async function* (request: StreamChatOpts) {
  fixture.requests.push(request);
  const scripted = fixture.turns.shift();
  if (!scripted) throw new Error("Evaluation exhausted scripted model decisions: unexpected continuation");
  const events = typeof scripted === "function" ? await scripted(request) : scripted;
  const input = Math.ceil(JSON.stringify({ messages: request.messages, tools: request.tools }).length / 4);
  const output = Math.ceil(JSON.stringify(events).length / 4);
  fixture.estimates.push({ input, output });
  for (const event of events) yield event;
  yield { type: "usage", promptTokens: input, completionTokens: output, cachedReadTokens: 0, cachedWriteTokens: 0, model: request.model };
} }));
vi.mock("vscode", () => ({ workspace: {
  get workspaceFolders() { return [{ uri: { fsPath: fixture.root } }]; }, textDocuments: [],
}, window: { tabGroups: { all: [] } }, languages: { getDiagnostics: () => [] }, DiagnosticSeverity: { Warning: 1, Error: 0 } }));
vi.mock("../context/cursorContext", () => ({ buildUserInfoBlock: async () => "", buildOpenFilesBlock: async () => "" }));
vi.mock("../logging", () => ({ logError: vi.fn(), logInfo: vi.fn() }));

import { runAgent } from "./loop";
import { setToolTimeoutOverrides } from "./tools/shared";
import { DEFAULT_APPROVAL, evaluateApproval, type ApprovalPolicy } from "./approvalPolicy";
import { pendingChanges } from "../stores/pendingChanges";
import { mcpManager } from "../integrations/mcpClient";

let root: string;
const metrics: Record<string, unknown>[] = [];
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "ocursor-eval-")); fixture.root = root;
  fixture.turns = []; fixture.requests = []; fixture.estimates = [];
  await fs.writeFile(path.join(root, "protected.txt"), "must remain unchanged\n");
});
afterEach(async () => { setToolTimeoutOverrides(undefined); vi.restoreAllMocks(); pendingChanges.acceptAll(); await fs.rm(root, { recursive: true, force: true }); });
afterAll(async () => {
  if (process.env.OPENCURSOR_EVAL_REPORT) await fs.writeFile(process.env.OPENCURSOR_EVAL_REPORT, JSON.stringify({
    measurement: "Deterministic execution fixtures, not a live-model benchmark. Token counts are character estimates; cache and billed cost are unmeasured.", cases: metrics,
  }, null, 2));
});
function call(name: string, input: unknown, id = `${name}-${Math.random()}`): ToolCall { return { name, arguments: JSON.stringify(input), id }; }
function tools(...calls: ToolCall[]): ProviderEvent[] { return [...calls.map((call): ProviderEvent => ({ type: "tool-call", call })), { type: "done", finishReason: "tool_calls" }]; }
function answer(text = "Completed and verified."): ProviderEvent[] { return [{ type: "text-delta", text }, { type: "done", finishReason: "stop" }]; }
function testShell(file = "verify.cjs") { return tools(call("Shell", { command: `node ${file}`, description: "Verify repository task outcome", block_until_ms: 2000 })); }
function policy(): ApprovalPolicy {
  const result = structuredClone(DEFAULT_APPROVAL);
  for (const rule of Object.values(result)) rule.mode = "allow";
  result.edits.denylist = ["protected.txt"]; result.delete.mode = "deny"; result.outside.mode = "deny";
  return result;
}
async function evaluate(name: string, turns: Turn[], options: Partial<RunAgentOptions> = {}) {
  fixture.turns = turns;
  const events: AgentEvent[] = [], decisions: { name: string; allowed: boolean }[] = [];
  const started = performance.now();
  const history: Step[] = options.history ?? [];
  await runAgent({ apiBaseUrl: "https://fixture.invalid", apiKey: "", model: "fixture-model", mode: "agent",
    prompt: name, history, maxTokens: 1024, maxSteps: 16, enableFileReading: true, enableTerminalSuggestions: true,
    enableWorkspaceContext: false, signal: new AbortController().signal,
    approve: async (name, input) => { const allowed = evaluateApproval(policy(), name, input, root) === "allow"; decisions.push({ name, allowed }); return allowed; },
    changeOwner: { conversationId: name, turnIndex: 0 }, emit: (event) => events.push(event), ...options,
  });
  const unauthorizedChanges = (await fs.readFile(path.join(root, "protected.txt"), "utf8")) === "must remain unchanged\n" ? 0 : 1;
  const terminal = events.filter((e) => e.type === "run-status").at(-1);
  const shellResults = events.filter((e) => e.type === "tool-call-completed" && e.name === "Shell");
  const fileState: Record<string, { bytes: number; sha256: string }> = {};
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const data = await fs.readFile(path.join(root, entry.name));
    fileState[entry.name] = { bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") };
  }
  metrics.push({ name, outcome: terminal?.type === "run-status" ? terminal.status : "missing", turns: fixture.requests.length,
    toolCalls: events.filter((e) => e.type === "tool-call-completed").length, elapsedMs: Math.round(performance.now() - started),
    estimatedInputTokens: fixture.estimates.reduce((n, v) => n + v.input, 0), estimatedOutputTokens: fixture.estimates.reduce((n, v) => n + v.output, 0),
    cachedReadTokens: null, cachedWriteTokens: null, billedUsd: null, unauthorizedChanges, fileState,
    verificationCommands: shellResults.map((e) => e.type === "tool-call-completed" ? e.result : ""),
    verificationOutcomes: shellResults.map((e) => e.type === "tool-call-completed" ? e.outcome ?? null : null),
    readResults: events.filter((e) => e.type === "tool-call-completed" && e.name === "Read").map((e) => e.type === "tool-call-completed" ? { startLine: e.startLine, endLine: e.endLine, characters: e.result.length } : null),
  });
  expect(unauthorizedChanges).toBe(0);
  expect(events.filter((e) => e.type === "error")).toEqual([]);
  return { events, history, decisions, requests: [...fixture.requests] };
}
function shellSucceeded(events: AgentEvent[]) {
  expect(events.some((e) => e.type === "tool-call-completed" && e.name === "Shell" && e.outcome?.status === "completed" && e.outcome.exitCode === 0)).toBe(true);
}

describe("repository outcomes through the production agent", () => {
  it("fixes a defect across two files and passes the repository verification", async () => {
    await fs.writeFile(path.join(root, "math.cjs"), "exports.add = (a,b) => a-b;\n");
    await fs.writeFile(path.join(root, "consumer.cjs"), "exports.result = require('./math.cjs').add(2,3) + 1;\n");
    await fs.writeFile(path.join(root, "verify.cjs"), "const assert=require('node:assert/strict');assert.equal(require('./math.cjs').add(2,3),5);assert.equal(require('./consumer.cjs').result,5);\n");
    const result = await evaluate("multi-file bug fix", [
      tools(call("Read", { path: "math.cjs" }), call("Read", { path: "consumer.cjs" })),
      tools(call("StrReplace", { path: "math.cjs", old_string: "a-b", new_string: "a+b" }), call("StrReplace", { path: "consumer.cjs", old_string: ") + 1", new_string: ")" })),
      testShell(), answer(),
    ]);
    shellSucceeded(result.events); expect(result.requests).toHaveLength(4);
    expect(await fs.readFile(path.join(root, "math.cjs"), "utf8")).toContain("a+b");
  });
  it("refactors implementation and caller while preserving behavior", async () => {
    await fs.writeFile(path.join(root, "greet.cjs"), "exports.greet = name => 'Hello '+name;\n");
    await fs.writeFile(path.join(root, "app.cjs"), "exports.message = require('./greet.cjs').greet('Ada');\n");
    await fs.writeFile(path.join(root, "verify.cjs"), "require('node:assert/strict').equal(require('./app.cjs').message,'Hello Ada');\n");
    const result = await evaluate("refactor with caller update", [
      tools(call("Read", { path: "greet.cjs" }), call("Read", { path: "app.cjs" })),
      tools(call("StrReplace", { path: "greet.cjs", old_string: "exports.greet", new_string: "exports.greeting" }), call("StrReplace", { path: "app.cjs", old_string: ".greet('Ada')", new_string: ".greeting('Ada')" })),
      testShell(), answer(),
    ]);
    shellSucceeded(result.events); expect(await fs.readFile(path.join(root, "app.cjs"), "utf8")).toContain(".greeting(");
  });
  it("receives the failing test evidence, fixes it, and reruns successfully", async () => {
    await fs.writeFile(path.join(root, "value.cjs"), "exports.value=41;\n");
    await fs.writeFile(path.join(root, "verify.cjs"), "require('node:assert/strict').equal(require('./value.cjs').value,42);\n");
    const result = await evaluate("test failure diagnosis", [testShell(), (request) => {
      expect(JSON.stringify(request.messages)).toContain("exit_code=1");
      return tools(call("Read", { path: "value.cjs" }));
    }, tools(call("StrReplace", { path: "value.cjs", old_string: "41", new_string: "42" })), testShell(), answer()]);
    shellSucceeded(result.events);
    expect(result.events.filter((e) => e.type === "tool-call-completed" && e.name === "Shell")).toHaveLength(2);
  });
  it("applies grouped anchored edits, preserves a manual comment, and adds tests without executing them when requested", async () => {
    const manual = "// USER_NOTE: keep this manual comment and its spacing.\n";
    await fs.writeFile(path.join(root, "model.cjs"), manual + "exports.normalize = value => value;\n");
    await fs.writeFile(path.join(root, "app.cjs"), "exports.result = require('./model.cjs').normalize(' value ');\n");
    const verification = "require('node:assert/strict').equal(require('./app.cjs').result,'VALUE');\n";
    const instruction = "Normalize whitespace and uppercase the displayed value. Preserve my manual comment. You may add tests, but do not execute tests or start the app. State exactly what was not run.";
    const result = await evaluate("grouped edits under an explicit no-test request", [
      tools(call("Read", { path: "model.cjs" }), call("Read", { path: "app.cjs" })),
      (request) => {
        expect(JSON.stringify(request.messages)).toContain("USER_NOTE: keep this manual comment");
        expect(JSON.stringify(request.messages)).toContain("do not execute tests or start the app");
        return tools(
          call("StrReplace", { path: "model.cjs", old_string: "value => value;", new_string: "value => value.trim();" }),
          call("StrReplace", { path: "app.cjs", old_string: ".normalize(' value ');", new_string: ".normalize(' value ').toUpperCase();" }),
          call("Write", { path: "verify.cjs", contents: verification }),
        );
      },
      answer("Updated both files and added verification tests. Tests and the app were not run, as requested."),
    ], { prompt: instruction });
    expect(await fs.readFile(path.join(root, "model.cjs"), "utf8")).toBe(manual + "exports.normalize = value => value.trim();\n");
    expect(await fs.readFile(path.join(root, "app.cjs"), "utf8")).toBe("exports.result = require('./model.cjs').normalize(' value ').toUpperCase();\n");
    expect(await fs.readFile(path.join(root, "verify.cjs"), "utf8")).toBe(verification);
    expect(result.events.filter((e) => e.type === "tool-call-completed" && ["Shell", "AwaitShell"].includes(e.name))).toHaveLength(0);
    expect(result.requests).toHaveLength(3);
    // This verifies the supplied scripted decisions and exact file outcome;
    // it does not establish that a live model will obey a natural-language ban.
  });
  it("recovers from a missing command, observes a failing check, then fixes and reruns it with exit-code evidence", async () => {
    await fs.writeFile(path.join(root, "value.cjs"), "exports.value=41;\n");
    await fs.writeFile(path.join(root, "verify.cjs"), "require('node:assert/strict').equal(require('./value.cjs').value,42);\n");
    const missingExit = process.platform === "win32" ? 1 : 127;
    const result = await evaluate("missing-command recovery followed by a verified fix", [
      tools(call("Shell", { command: "opencursor_eval_command_does_not_exist_9f73", description: "Exercise missing command diagnosis", block_until_ms: 2000 })),
      (request) => { expect(JSON.stringify(request.messages)).toContain(`exit_code=${missingExit}`); return testShell(); },
      (request) => { expect(JSON.stringify(request.messages)).toContain("exit_code=1"); return tools(call("Read", { path: "value.cjs" })); },
      tools(call("StrReplace", { path: "value.cjs", old_string: "41", new_string: "42" })),
      testShell(), answer("Recovered from the missing command, fixed the failing assertion, and reran the check successfully."),
    ]);
    const outcomes = result.events.filter((e) => e.type === "tool-call-completed" && e.name === "Shell").map((e) => e.type === "tool-call-completed" ? e.outcome : undefined);
    expect(outcomes.map((outcome) => outcome?.exitCode)).toEqual([missingExit, 1, 0]);
    expect(outcomes.map((outcome) => outcome?.status)).toEqual(["failed", "failed", "completed"]);
    expect(await fs.readFile(path.join(root, "value.cjs"), "utf8")).toBe("exports.value=42;\n");
    shellSucceeded(result.events);
  });
  it("retrieves a targeted 18-line range from a large generated fixture without consuming the surrounding file", async () => {
    const lines = Array.from({ length: 60003 }, (_, i) => `fixture row ${i + 1} ${"x".repeat(150)}`);
    lines[43911] = "TARGET_MARKER: preserve the confirmed value 49152";
    await fs.writeFile(path.join(root, "generated.txt"), lines.join("\n"));
    expect((await fs.stat(path.join(root, "generated.txt"))).size).toBeGreaterThan(8 * 1024 * 1024);
    const result = await evaluate("targeted large fixture retrieval", [
      tools(call("Read", { path: "generated.txt", offset: 43904, limit: 18 })),
      (request) => {
        const messages = JSON.stringify(request.messages);
        expect(messages).toContain("TARGET_MARKER: preserve the confirmed value 49152");
        expect(messages).toContain("total_lines=60003 start_line=43904 end_line=43921");
        expect(messages).not.toContain("fixture row 60003");
        return answer("The marker on line 43912 confirms 49152; the requested range was read.");
      },
    ], { mode: "ask" });
    const read = result.history.find((step) => step.kind === "tool-result" && step.name === "Read");
    expect(read?.kind === "tool-result" && read.output.split("\n").filter((line) => /^\d+\|/.test(line))).toEqual(lines.slice(43903, 43921).map((line, i) => `${43904 + i}|${line}`));
    expect(result.events.filter((e) => e.type === "tool-call-completed" && e.name === "Read")).toHaveLength(1);
    expect(pendingChanges.count()).toBe(0);
  });
  it("delivers a real image-read result to the next provider request", async () => {
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jz1sAAAAASUVORK5CYII=", "base64");
    await fs.writeFile(path.join(root, "pixel.png"), image);
    const result = await evaluate("image inspection context", [tools(call("Read", { path: "pixel.png" })), (request) => {
      expect(JSON.stringify(request.messages)).toContain(image.toString("base64")); return answer("The image was supplied for inspection.");
    }], { mode: "ask" });
    expect(result.history.some((s) => s.kind === "tool-result" && s.image?.base64 === image.toString("base64"))).toBe(true);
  });
  it("respects a blocked edit and ends with a blocker instead of unauthorized work", async () => {
    const result = await evaluate("blocked task", [tools(call("Write", { path: "protected.txt", contents: "unauthorized" })), answer("The policy blocks this edit; the file was preserved.")]);
    expect(result.decisions).toEqual([{ name: "Write", allowed: false }]);
    expect(result.requests).toHaveLength(2); expect(pendingChanges.count()).toBe(0);
  });
  it("recovers an archived fact after a long-context handoff", async () => {
    const text = "historical detail\n".repeat(8000) + "CRITICAL_DECISION: use port 49152\n" + "later detail\n".repeat(8000);
    const history: Step[] = [{ kind: "user", text: "Remember the confirmed port." }, { kind: "assistant", text: "", calls: [call("Read", { path: "decision.txt" }, "old-read")] },
      { kind: "tool-result", callId: "old-read", name: "Read", output: text, status: "completed" }];
    const result = await evaluate("long context recovery", [(request) => {
      const serialized = JSON.stringify(request.messages);
      expect(serialized.length).toBeLessThan(text.length / 3);
      const id = serialized.match(/ctx_[a-f0-9]{64}/)?.[0]; expect(id).toBeTruthy();
      return tools(call("ReadContext", { id, pattern: "CRITICAL_DECISION" }));
    }, (request) => { expect(JSON.stringify(request.messages)).toContain("CRITICAL_DECISION: use port 49152"); return answer("Use port 49152."); }], { history, contextTokens: 32000 });
    expect(result.history.some((s) => s.kind === "tool-result" && s.output === text)).toBe(true);
  });
  it("serializes concurrent child edits so both verified changes survive", async () => {
    await fs.writeFile(path.join(root, "shared.txt"), "alpha\nbeta\n");
    await fs.writeFile(path.join(root, "verify.cjs"), "require('node:assert/strict').equal(require('fs').readFileSync('shared.txt','utf8'),'ALPHA\\nBETA\\n');\n");
    // Foreground Task calls run concurrently. Each child receives one scripted
    // edit; decisions are independent and the real shared file lock is exercised.
    const result = await evaluate("conflicting child edits", [
      tools(call("Task", { prompt: "Change alpha to ALPHA", description: "Edit first line" }), call("Task", { prompt: "Change beta to BETA", description: "Edit second line" })),
      tools(call("StrReplace", { path: "shared.txt", old_string: "alpha", new_string: "ALPHA" })),
      tools(call("StrReplace", { path: "shared.txt", old_string: "beta", new_string: "BETA" })), answer("Child finished."), answer("Child finished."), testShell(), answer(),
    ]);
    shellSucceeded(result.events); expect(await fs.readFile(path.join(root, "shared.txt"), "utf8")).toBe("ALPHA\nBETA\n");
  });
  it("cancels an approval-time interruption without executing the queued write", async () => {
    const controller = new AbortController();
    const result = await evaluate("interrupted run", [tools(call("Write", { path: "interrupted.txt", contents: "must not appear" }))], {
      signal: controller.signal, approve: async () => { controller.abort(); return true; },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(fs.stat(path.join(root, "interrupted.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(result.events).toContainEqual({ type: "run-status", status: "cancelled" }); expect(pendingChanges.count()).toBe(0);
  });
  it("guards MCP resource downloads with every applicable policy and the hook before writing", async () => {
    const read = vi.spyOn(mcpManager, "readResourceContents").mockResolvedValue({ contents: [{ uri: "fixture://document", text: "resource content\n" }] });
    const original = Buffer.from([0, 255, 128, 72]);
    const file = path.join(root, "download.bin"); await fs.writeFile(file, original);
    for (const type of ["mcp", "edits", "outside"] as const) {
      const configured = policy(); configured[type].mode = "deny";
      const destination = type === "outside" ? path.join(root, "..", `${path.basename(root)}-outside.bin`) : file;
      const result = await evaluate(`MCP download denied by ${type}`, [tools(call("FetchMcpResource", { server: "fixture", uri: "fixture://document", downloadPath: destination })), answer("Download is blocked.")], {
        approve: async (name, input) => evaluateApproval(configured, name, input, root) === "allow",
      });
      expect(result.events.some((e) => e.type === "tool-call-completed" && e.status === "error")).toBe(true);
      expect(read).not.toHaveBeenCalled(); expect(await fs.readFile(file)).toEqual(original);
      if (type === "outside") await expect(fs.stat(destination)).rejects.toMatchObject({ code: "ENOENT" });
    }
    const hook = vi.fn(async (event: string) => event === "beforeMcp" ? "resource is blocked by the hook" : undefined);
    await evaluate("MCP download hook veto", [tools(call("FetchMcpResource", { server: "fixture", uri: "fixture://document", downloadPath: file })), answer("Hook blocked the download.")], { onHook: hook });
    expect(hook).toHaveBeenCalledWith("beforeMcp", expect.objectContaining({ server: "fixture" }), "FetchMcpResource", expect.any(AbortSignal));
    expect(read).not.toHaveBeenCalled();
    const editVeto = vi.fn(async (event: string, context: Record<string, string>) => {
      if (event !== "beforeEdit") return undefined;
      expect(JSON.parse(context.tool_input)).toEqual({ file_path: "download.bin", content: "resource content\n" });
      return "content was rejected";
    });
    await evaluate("MCP content edit hook veto", [tools(call("FetchMcpResource", { server: "fixture", uri: "fixture://document", downloadPath: file })), answer("Hook preserved the file.")], { onHook: editVeto });
    expect(read).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(file)).toEqual(original);
    read.mockClear();
    const afterEdit = vi.fn();
    const allowed = await evaluate("MCP download with undo", [tools(call("FetchMcpResource", { server: "fixture", uri: "fixture://document", downloadPath: file })), answer()], { onAfterEdit: afterEdit });
    expect(read).toHaveBeenCalledTimes(1); expect(afterEdit).toHaveBeenCalledWith("download.bin");
    expect(allowed.events.some((e) => e.type === "tool-call-completed" && !!e.diff)).toBe(true);
    expect(await fs.readFile(file, "utf8")).toBe("resource content\n");
    await pendingChanges.reject(file); expect(await fs.readFile(file)).toEqual(original);
  });
});


it("retains real terminal evidence when the loop's outer timeout wins the race", async () => {
  setToolTimeoutOverrides({ Shell: 1 });
  await fs.writeFile(path.join(root, "long.cjs"), "console.log('EVIDENCE_BEFORE_TIMEOUT');setInterval(()=>{},1000);\n");
  const result = await evaluate("terminal timeout evidence", [
    tools(call("Shell", { command: "node long.cjs", block_until_ms: 30000 }, "timeout-job")),
    request => {
      const result = request.messages.find(m => m.role === "tool" && m.tool_call_id === "timeout-job");
      const output = result?.role === "tool" ? String(result.content) : "";
      expect(output).toContain("error: timeout:");
      expect(output).toContain("Process status: timed_out");
      const id = output.match(/shell_[a-f0-9]{32}/)?.[0];
      expect(id).toBeTruthy();
      return tools(call("ReadContext", { id, pattern: "EVIDENCE_BEFORE_TIMEOUT" }, "recover-timed-output"));
    },
    request => { expect(JSON.stringify(request.messages)).toContain("EVIDENCE_BEFORE_TIMEOUT"); return answer("Command timed out; its earlier output was recovered."); },
  ], { promptCacheKey: "timeout-owner" });
  expect(result.events).toContainEqual(expect.objectContaining({ type: "tool-call-completed", callId: "timeout-job", status: "error",
    outcome: expect.objectContaining({ status: "timed_out", processStatus: "timed_out", jobId: expect.stringMatching(/^shell_/), outputRef: expect.objectContaining({ available: true }) }),
  }));
});

it("records a cancelled wait without claiming that its running process was killed", async () => {
  await fs.writeFile(path.join(root, "background.cjs"), "console.log('BACKGROUND_EVIDENCE');setInterval(()=>{},1000);\n");
  const result = await evaluate("cancelled terminal wait", [
    tools(call("Shell", { command: "node background.cjs", block_until_ms: 0 }, "background")),
    request => {
      const id = JSON.stringify(request.messages).match(/shell_[a-f0-9]{32}/)?.[0];
      expect(id).toBeTruthy();
      return tools(call("AwaitShell", { shell_id: id, block_until_ms: 65000 }, "cancel-wait"));
    },
    request => { expect(JSON.stringify(request.messages)).toContain("Process status: running"); return answer("The wait was cancelled; the job was still running at that point."); },
  ], { promptCacheKey: "cancel-wait-owner", registerSubagentAbort: (id, abort) => { if (id === "cancel-wait") setTimeout(abort, 100); } });
  expect(result.events).toContainEqual(expect.objectContaining({ type: "tool-call-completed", callId: "cancel-wait", status: "error",
    outcome: expect.objectContaining({ status: "aborted", processStatus: "running", jobId: expect.stringMatching(/^shell_/) }),
  }));
});
