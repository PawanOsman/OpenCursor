/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextState } from "./contextState";
import type { RunAgentOptions } from "./loopTypes";
import type { AgentEvent, Step } from "./types";
import type { Tool } from "./tools/types";
import type { ToolSpec } from "./tools/schemas";

// Exercise the real loop, context restoration, message builder and HTTP provider.
// Replace only credentials, workspace state and tools with external effects.
const fixture = vi.hoisted(() => {
  const executions: { name: string; input: unknown }[] = [];
  const output = `${"Source before the defect\n".repeat(250)}RESUME_MIDDLE_SOURCE_EVIDENCE${"\nSource after the defect".repeat(250)}`;
  const tool = (spec: ToolSpec, mutating = false): Tool => ({
    mutating,
    schema: { type: "function", function: spec },
    execute: async (input) => {
      executions.push({ name: spec.name, input });
      return { output: spec.name === "Read" ? output : "Write completed" };
    },
  });
  return { executions, output, tool };
});

vi.mock("vscode", () => ({ EventEmitter: class { event = () => ({ dispose() {} }); fire() {} }, workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } }));
vi.mock("../stores/featureStore", () => ({ MODEL_CATALOG: [] }));
vi.mock("./tools/files", async () => {
  const { TOOL_SPECS: s } = await vi.importActual<typeof import("./tools/schemas")>("./tools/schemas");
  return {
    readFileTool: fixture.tool(s.Read), listDirTool: fixture.tool(s.ListDir),
    globTool: fixture.tool(s.Glob), fileSearchTool: fixture.tool(s.FileSearch),
    readLintsTool: fixture.tool(s.ReadLints), strReplaceTool: fixture.tool(s.StrReplace, true),
    writeTool: fixture.tool(s.Write, true), deleteFileTool: fixture.tool(s.Delete, true),
    editNotebookTool: fixture.tool(s.EditNotebook, true),
  };
});
vi.mock("./tools/search", async () => {
  const { TOOL_SPECS: s } = await vi.importActual<typeof import("./tools/schemas")>("./tools/schemas");
  return { grepTool: fixture.tool(s.Grep), rgTool: fixture.tool(s.Rg), semanticSearchTool: fixture.tool(s.SemanticSearch), searchDocsTool: fixture.tool(s.SearchDocs) };
});
vi.mock("./tools/shell", async () => {
  const { TOOL_SPECS: s } = await vi.importActual<typeof import("./tools/schemas")>("./tools/schemas");
  return { runTerminalTool: fixture.tool(s.Shell, true), awaitShellTool: fixture.tool(s.AwaitShell), writeStdinTool: fixture.tool(s.WriteStdin, true) };
});
vi.mock("./tools/web", async () => {
  const { TOOL_SPECS: s } = await vi.importActual<typeof import("./tools/schemas")>("./tools/schemas");
  return { webSearchTool: fixture.tool(s.WebSearch), webFetchTool: fixture.tool(s.WebFetch) };
});
vi.mock("./tools/mcp", async () => {
  const { TOOL_SPECS: s } = await vi.importActual<typeof import("./tools/schemas")>("./tools/schemas");
  return { callMcpToolTool: fixture.tool(s.CallMcpTool, true), fetchMcpResourceTool: fixture.tool(s.FetchMcpResource, true), listMcpResourcesTool: fixture.tool(s.ListMcpResources) };
});
vi.mock("./tools/shared", () => ({
  disposeShellSession: vi.fn(), toolTimeoutMs: () => 0,
  withToolTimeout: <T>(promise: Promise<T>) => promise,
  setSubagentRunner: vi.fn(), setQuestionAsker: vi.fn(), setToolTimeoutOverrides: vi.fn(),
  DEFAULT_TOOL_TIMEOUTS_SEC: {}, getSubagentRunner: vi.fn(), getQuestionAsker: vi.fn(),
  slugify: vi.fn(), makeDiff: vi.fn(), firstDiffLine: vi.fn(),
}));
vi.mock("../stores/fileMutations", () => ({ mutateFile: vi.fn() }));
vi.mock("../stores/pendingChanges", () => ({ pendingChanges: {} }));
vi.mock("../context/workspaceUtils", () => ({
  getWorkspaceRoot: () => "/workspace",
  withWorkspaceRoot: (_root: string, work: () => unknown) => work(),
  normalizeToolPaths: (_name: string, input: unknown) => input,
}));
vi.mock("../context/cursorContext", () => ({
  buildUserInfoBlock: async () => "Keep the existing APIs.", buildOpenFilesBlock: async () => "src/app.ts",
}));
vi.mock("./approvalPolicy", async () => ({ ...await vi.importActual<typeof import("./approvalPolicy")>("./approvalPolicy"), actionTypeForCall: () => undefined }));
vi.mock("./prompt", () => ({ systemPrompt: () => "You are a coding assistant." }));
vi.mock("../integrations/mcpClient", () => ({ mcpManager: { listTools: () => [] } }));
vi.mock("../logging", () => ({ logError: vi.fn() }));

import { runAgent } from "./loop";
import { TOOLS } from "./tools";
import { buildMessages } from "./messages";

type Message = { role: string; content?: unknown; tool_call_id?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] };
type RequestBody = { messages: Message[]; tools: unknown[] };
let requests: RequestBody[];
let responses: (() => Response)[];

const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const sse = (...values: unknown[]) => new Response(values.map(frame).join("") + "data: [DONE]\n\n");
const answer = () => sse({ choices: [{ delta: { content: "Resumed from the recorded evidence." }, finish_reason: "stop" }] });
const toolResponse = (name: string, args: string, id: string) => sse({ choices: [{ delta: {
  tool_calls: [{ index: 0, id, function: { name, arguments: args } }],
}, finish_reason: "tool_calls" }] });

function abortingResponse(abort: AbortController, initialFrame: unknown = { choices: [{ delta: {
  content: "The defect is in the branch already inspected. Next I will update it.",
  tool_calls: [{ index: 0, id: "unfinished-write", function: { name: "Write", arguments: '{"path":"unfinished' } }],
} }] }): Response {
  let sent = false;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(new TextEncoder().encode(frame(initialFrame)));
      } else {
        // The previous chunk has reached the production parser before Stop.
        abort.abort();
        controller.error(new DOMException("Stopped by user", "AbortError"));
      }
    },
  }, { highWaterMark: 0 }));
}

async function run(history: Step[], contextState: ContextState, options: Partial<RunAgentOptions> = {}) {
  const events: AgentEvent[] = [];
  await runAgent({
    apiBaseUrl: "https://resume.example.invalid/v1", apiKey: "fixture", model: "fixture",
    promptCacheKey: "same-conversation", mode: "agent", prompt: "Find and fix the defect", history, contextState,
    contextTokens: 200_000, maxTokens: 2_000, maxSteps: 8,
    enableFileReading: true, enableTerminalSuggestions: true, enableWorkspaceContext: true,
    approve: async () => true, signal: new AbortController().signal,
    emit: (event) => events.push(event), ...options,
  });
  return events;
}

beforeEach(() => {
  fixture.executions.length = 0;
  requests = [];
  responses = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    const respond = responses.shift();
    if (!respond) throw new Error("Unexpected HTTP request");
    return respond();
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("stopped conversation HTTP replay", () => {
  it("omits interrupted thinking-only assistants from the resumed Anthropic request", async () => {
    const abort = new AbortController();
    const history: Step[] = [];
    const state: ContextState = {};
    const thinking = "I will inspect the relevant branch.";
    responses.push(() => abortingResponse(abort, { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking } }));
    const stopped = await run(history, state, { anthropic: true, signal: abort.signal });
    expect(stopped).toContainEqual({ type: "run-status", status: "cancelled" });
    expect(history).toContainEqual(expect.objectContaining({ kind: "assistant", text: "", thinking, calls: [] }));
    const saved: { history: Step[]; state: ContextState } = JSON.parse(JSON.stringify({ history, state }));
    responses.push(() => sse(
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Resuming the investigation." } },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
    ));
    const resumed = await run(saved.history, saved.state, { anthropic: true, prompt: "Continue" });
    expect(resumed).toContainEqual({ type: "run-status", status: "finished" });
    expect(resumed.filter(event => event.type === "error")).toEqual([]);
    expect(requests).toHaveLength(2);
    expect(requests[1].messages.some(message => message.role === "assistant")).toBe(false);
    expect(JSON.stringify(requests[1])).not.toContain(thinking);
    expect(saved.history).toContainEqual(expect.objectContaining({ kind: "assistant", text: "", thinking, calls: [] }));
    // Anthropic rolls cache-marker positions as new user turns are appended;
    // the prior request content must remain identical.
    const contentOnly = (value: unknown) => JSON.stringify(value, (key, item) => key === "cache_control" ? undefined : item);
    expect(contentOnly(requests[1].messages.slice(0, requests[0].messages.length))).toBe(contentOnly(requests[0].messages));
  });

  it("keeps reasoning-only opaque Responses state when omitting display-only thinking", () => {
    const responsesReasoning = {
      model: "fixture", provider: "openai" as const,
      items: [{ type: "reasoning" as const, id: "reasoning-only", summary: [], encrypted_content: "opaque-state" }],
    };
    const history: Step[] = [{ kind: "assistant", text: "", thinking: "Display thinking", calls: [], responsesReasoning }];
    expect(buildMessages("System", history)).toContainEqual({ role: "assistant", content: null, responsesReasoning });
    expect(history[0]).toHaveProperty("thinking", "Display thinking");
  });

  it("sends complete saved tool bodies and unchanged request prefixes after a stream abort", async () => {
    const abort = new AbortController();
    const history: Step[] = [];
    const state: ContextState = {};
    const readArgs = JSON.stringify({ path: "src/app.ts" });
    const contents = `${"Prior edit\n".repeat(600)}RESUME_MIDDLE_EDIT_EVIDENCE${"\nRemaining edit".repeat(600)}`;
    const writeArgs = JSON.stringify({ path: "src/app.ts", contents });
    responses.push(
      () => toolResponse("Read", readArgs, "read-evidence"),
      () => toolResponse("Write", writeArgs, "write-evidence"),
      () => abortingResponse(abort),
    );
    const stoppedEvents = await run(history, state, { signal: abort.signal });
    expect(stoppedEvents).toContainEqual({ type: "run-status", status: "cancelled" });
    expect(stoppedEvents.filter(event => event.type === "error")).toEqual([]);
    expect(fixture.executions.map(entry => entry.name)).toEqual(["Read", "Write"]);
    expect(history).toContainEqual(expect.objectContaining({ kind: "assistant", text: expect.stringContaining("branch already inspected"), calls: [] }));
    expect(JSON.stringify(history)).not.toContain("unfinished-write");

    const saved = JSON.stringify({ history, state });
    const restored: { history: Step[]; state: ContextState } = JSON.parse(saved);
    const priorHistory = JSON.stringify(restored.history);
    const priorCount = restored.history.length;
    responses.push(answer);
    const resumedEvents = await run(restored.history, restored.state, { prompt: "Continue the interrupted fix" });
    expect(resumedEvents).toContainEqual({ type: "run-status", status: "finished" });
    expect(resumedEvents.filter(event => event.type === "error")).toEqual([]);
    expect(requests).toHaveLength(4);

    const resumed = requests[3];
    expect(resumed.messages).toContainEqual({ role: "tool", tool_call_id: "read-evidence", content: fixture.output });
    expect(resumed.messages.flatMap(message => message.tool_calls ?? [])).toContainEqual({
      id: "write-evidence", type: "function", function: { name: "Write", arguments: writeArgs },
    });
    expect(resumed.messages).toContainEqual(expect.objectContaining({ role: "assistant", content: expect.stringContaining("branch already inspected") }));
    expect(JSON.stringify(resumed)).not.toContain("unfinished-write");
    for (const previous of requests.slice(0, 3)) {
      expect(JSON.stringify(resumed.messages.slice(0, previous.messages.length))).toBe(JSON.stringify(previous.messages));
      expect(JSON.stringify(resumed.tools)).toBe(JSON.stringify(previous.tools));
    }
    expect(JSON.stringify(restored.history.slice(0, priorCount))).toBe(priorHistory);
    expect(fixture.executions.map(entry => entry.name)).toEqual(["Read", "Write"]);
  });

  it("replays a completed call with its cancellation outcome when Stop prevents execution", async () => {
    const abort = new AbortController();
    const history: Step[] = [];
    const state: ContextState = {};
    const args = JSON.stringify({ path: "never-written.ts", contents: "not executed" });
    responses.push(() => sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "cancelled-write", function: { name: "Write", arguments: args } }] }, finish_reason: "tool_calls" }] }));
    // Stop at the complete, parsed call boundary, not stream-reader cleanup:
    // cancellation while parsing an unvalidated response correctly discards it.
    await run(history, state, { signal: abort.signal, emit: event => {
      if (event.type === "tool-call-started" && event.callId === "cancelled-write" && (event.input as any)?.path) abort.abort();
    } });
    expect(fixture.executions).toEqual([]);
    expect(history).toContainEqual(expect.objectContaining({ kind: "tool-result", callId: "cancelled-write", status: "error", output: expect.stringContaining("cancelled") }));
    const saved: { history: Step[]; state: ContextState } = JSON.parse(JSON.stringify({ history, state }));
    responses.push(answer);
    await run(saved.history, saved.state, { prompt: "Continue" });
    const replay = requests[1].messages;
    expect(replay.flatMap(message => message.tool_calls ?? [])).toContainEqual({ id: "cancelled-write", type: "function", function: { name: "Write", arguments: args } });
    expect(replay).toContainEqual(expect.objectContaining({ role: "tool", tool_call_id: "cancelled-write", content: expect.stringContaining("cancelled") }));
    expect(fixture.executions).toEqual([]);
  });

  it("records a completed sibling before its completion event and retains it after Stop", async () => {
    const history: Step[] = [];
    const state: ContextState = {};
    const abort = new AbortController();
    let releaseSibling!: () => void;
    const sibling = new Promise<void>(resolve => { releaseSibling = resolve; });
    vi.spyOn(TOOLS.Read, "execute").mockImplementation(async input => {
      if (input.path === "slow.ts") await sibling;
      return { output: `Evidence from ${input.path}` };
    });
    responses.push(() => sse({ choices: [{ delta: {
      tool_calls: ["ready", "slow"].map((id, index) => ({ index, id, function: { name: "Read", arguments: JSON.stringify({ path: `${id}.ts` }) } })),
    }, finish_reason: "tool_calls" }] }));
    let completionSnapshot: Step[] | undefined;
    await run(history, state, {
      signal: abort.signal,
      emit: event => {
        if (event.type !== "tool-call-completed" || event.callId !== "ready") return;
        completionSnapshot = JSON.parse(JSON.stringify(history));
        abort.abort();
        releaseSibling();
      },
    });
    expect(completionSnapshot).toContainEqual(expect.objectContaining({ kind: "tool-result", callId: "ready", output: "Evidence from ready.ts", status: "completed" }));
    expect(completionSnapshot?.some(step => step.kind === "tool-result" && step.callId === "slow")).toBe(false);
    const saved: { history: Step[]; state: ContextState } = JSON.parse(JSON.stringify({ history, state }));
    responses.push(answer);
    await run(saved.history, saved.state, { prompt: "Continue" });
    expect(requests[1].messages).toContainEqual({ role: "tool", tool_call_id: "ready", content: "Evidence from ready.ts" });
    expect(requests[1].messages.filter(message => message.role === "tool").map(message => message.tool_call_id)).toEqual(["ready", "slow"]);
  });
});
