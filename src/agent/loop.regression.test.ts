/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamChatOpts } from "./provider";
import type { RunAgentOptions } from "./loopTypes";
import type { AgentEvent, ChatReasoning, ProviderEvent, ResponsesReasoning, Step, ToolCall, WireMessage } from "./types";
import type { Tool } from "./tools/types";
import type { ToolSpec } from "./tools/schemas";
import { OPTIONAL_BUILTIN_TOOLS } from "./deferredTools";
import { ApiKeyPool } from "./provider/apiKeyPool";

type ScriptedTurn = ProviderEvent[] | ((request: StreamChatOpts) => ProviderEvent[] | Promise<ProviderEvent[]>);

// Keep the production loop, mode registry, todo handlers, ledger, message builder,
// and budget fitting. Replace only the provider and tools with external effects.
const fixture = vi.hoisted(() => {
	const executions: { name: string; input: unknown }[] = [];
	const tool = (spec: ToolSpec, mutating = false): Tool => ({
		mutating,
		schema: { type: "function", function: spec },
		execute: async (input) => {
			executions.push({ name: spec.name, input });
			return { output: spec.name === "Read" ? "file contents" : "ok" };
		},
	});
	return {
		tool,
		executions,
		requests: [] as StreamChatOpts[],
		turns: [] as ScriptedTurn[],
		approve: vi.fn(async (_name: string, _input: unknown, _callId?: string) => true),
		callMcp: vi.fn(async (): Promise<import("../integrations/mcpClient").McpToolResult> => ({ content: [{ type: "text", text: "MCP completed" }] })),
	};
});

vi.mock("./provider", () => ({
	streamChat: async function* (options: StreamChatOpts) {
		const turn = fixture.turns[fixture.requests.length];
		fixture.requests.push(options);
		if (!turn) throw new Error("Unexpected model continuation after the scripted final answer");
		for (const event of typeof turn === "function" ? await turn(options) : turn) yield event;
	},
}));
vi.mock("vscode", () => ({ EventEmitter: class { event = () => ({ dispose() {} }); fire() {} }, workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } }));
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
	buildUserInfoBlock: async () => "", buildOpenFilesBlock: async () => "",
}));
vi.mock("./approvalPolicy", async () => ({
	...await vi.importActual<typeof import("./approvalPolicy")>("./approvalPolicy"),
	actionTypeForCall: (name: string) => ["Write", "Shell", "WritePlan"].includes(name) ? "edits" : undefined,
}));
vi.mock("./prompt", () => ({ systemPrompt: (mode: string) => `You are a coding assistant in ${mode} mode.` }));
vi.mock("../integrations/mcpClient", async () => ({
	formatMcpToolResult: (await vi.importActual<typeof import("../integrations/mcpClient")>("../integrations/mcpClient")).formatMcpToolResult,
	mcpManager: {
		listTools: () => [{ qualifiedName: "mcp__test__write", server: "test", tool: { name: "write", inputSchema: {} } }],
		callToolDetailed: fixture.callMcp,
	},
}));
vi.mock("../logging", () => ({ logError: vi.fn() }));

import { runAgent } from "./loop";
import { writePlanTool } from "./tools/agent";
import { TOOLS } from "./tools";
import * as cursorContext from "../context/cursorContext";
import { mcpManager } from "../integrations/mcpClient";

function call(name: string, input: unknown, id: string): ToolCall {
	return { name, arguments: JSON.stringify(input), id };
}

function toolTurn(...calls: ToolCall[]): ProviderEvent[] {
	return [...calls.map((call): ProviderEvent => ({ type: "tool-call", call })), { type: "done", finishReason: "tool_calls" }];
}

function answer(text: string, finishReason = "stop"): ProviderEvent[] {
	return [{ type: "text-delta", text }, { type: "done", finishReason }];
}

function olderReadHistory(request: string, marker: string): Step[] {
	const history: Step[] = [{ kind: "user", text: request }];
	for (let i = 0; i < 18; i++) {
		const toolCall = call("Read", { path: `history-${i}.ts` }, `history-${i}`);
		history.push(
			{ kind: "assistant", text: "", calls: [toolCall] },
			{ kind: "tool-result", callId: toolCall.id, name: "Read", status: "completed", output: `${"Prior source detail\n".repeat(150)}${i === 0 ? marker : "ordinary observation"}\n${"More source detail\n".repeat(150)}` },
		);
	}
	return history;
}

async function run(turns: ScriptedTurn[], options: Partial<RunAgentOptions> = {}) {
	fixture.turns.push(...turns);
	const history: Step[] = options.history ?? [];
	const events: AgentEvent[] = [];
	await runAgent({
		apiBaseUrl: "https://provider.invalid", apiKey: "", model: "test-model",
		mode: "agent", prompt: "Complete the requested task", history,
		maxSteps: 12, enableFileReading: true, enableTerminalSuggestions: true,
		enableWorkspaceContext: false, approve: fixture.approve,
		signal: new AbortController().signal, emit: (event) => events.push(event),
		...options,
	});
	return { history, events };
}

function expectFinished(events: AgentEvent[], text: string, requests: number) {
	expect(events.filter((event) => event.type === "error")).toEqual([]);
	expect(events).toContainEqual({ type: "run-status", status: "finished" });
	expect(events).toContainEqual(expect.objectContaining({ type: "run-result", text }));
	expect(fixture.requests).toHaveLength(requests);
}

function expectCompleteToolGroups(messages: WireMessage[]) {
	const pending = new Set<string>();
	for (const message of messages) {
		if (message.role === "tool") {
			expect(pending.has(message.tool_call_id), "tool result has a matching call").toBe(true);
			pending.delete(message.tool_call_id);
		} else {
			expect([...pending], "all tool results precede the next non-tool message").toEqual([]);
			if (message.role === "assistant") {
				for (const toolCall of message.tool_calls ?? []) pending.add(toolCall.id);
			}
		}
	}
	expect([...pending], "every tool call is answered").toEqual([]);
}

beforeEach(() => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
	fixture.requests.length = 0;
	fixture.turns.length = 0;
	fixture.executions.length = 0;
	vi.spyOn(writePlanTool, "execute").mockImplementation(async (input) => {
		fixture.executions.push({ name: "WritePlan", input });
		return { output: "Plan saved to .plans/test.md" };
	});
});

describe("Compatible Chat reasoning continuations", () => {
	const reasoning: ChatReasoning = { endpoint: "https://api.deepseek.com/v1", model: "deepseek-flash", content: "Exact provider reasoning" };
	it("persists provider state across tools and restored history without duplicating visible thoughts", async () => {
		const first = await run([
			[{ type: "thinking-delta", text: "Visible thought" }, { type: "chat-reasoning", reasoning },
				...toolTurn(call("Read", { path: "first.ts" }, "first"))],
			answer("Inspected the file."),
		], { model: reasoning.model, apiBaseUrl: reasoning.endpoint });
		const assistants = first.history.filter(step => step.kind === "assistant");
		expect(assistants[0].chatReasoning).toEqual(reasoning);
		expect(assistants[1].chatReasoning).toBeUndefined();
		expect(fixture.requests[1].messages).toContainEqual(expect.objectContaining({ role: "assistant", chatReasoning: reasoning }));
		expect(first.events.filter(event => event.type === "thinking-delta").map(event => event.text).join("")).toBe("Visible thought");
		expect(JSON.stringify(first.events)).not.toContain(reasoning.content);
		expect(JSON.stringify(first.events)).not.toContain("chat-reasoning");
		const restored: Step[] = JSON.parse(JSON.stringify(first.history));
		await run([answer("Follow-up complete.")], { model: reasoning.model, apiBaseUrl: reasoning.endpoint, history: restored, prompt: "Explain" });
		expect(fixture.requests[2].messages).toContainEqual(expect.objectContaining({ role: "assistant", chatReasoning: reasoning }));
		for (const request of fixture.requests) expectCompleteToolGroups(request.messages);
	});
});

describe("Responses reasoning continuations", () => {
	const reasoning: ResponsesReasoning = {
		model: "gpt-5.4", provider: "openai",
		items: [
			{ type: "reasoning", id: "rs_first", summary: [], encrypted_content: "opaque-first-response" },
			{ type: "reasoning", id: "rs_second", summary: [{ type: "summary_text", text: "Inspecting files" }], encrypted_content: "opaque-second-item" },
		],
	};

	it.each([false, true])("replays complete state through tool results with display thinking=%s", async (displayThinking) => {
		const firstTurn: ProviderEvent[] = [
			...(displayThinking ? [{ type: "thinking-delta" as const, text: "Visible reasoning summary" }] : []),
			{ type: "responses-reasoning", reasoning },
			...toolTurn(call("Read", { path: "first.ts" }, "first"), call("Read", { path: "second.ts" }, "second")),
		];
		const { history, events } = await run([
			firstTurn,
			toolTurn(call("Read", { path: "third.ts" }, "third")),
			answer("All three files inspected."),
		], { model: reasoning.model });
		const assistants = history.filter((step) => step.kind === "assistant");
		expect(assistants[0].responsesReasoning).toEqual(reasoning);
		expect(assistants[1].responsesReasoning).toBeUndefined();
		expect(assistants[2].responsesReasoning).toBeUndefined();
		const replay = fixture.requests[1].messages.find((message) => message.role === "assistant");
		expect(replay).toMatchObject({ role: "assistant", content: null, responsesReasoning: reasoning });
		expect(replay).not.toHaveProperty("thinking");
		for (const request of fixture.requests) expectCompleteToolGroups(request.messages);
		expect(JSON.stringify(events)).not.toContain("opaque-first-response");
		expect(JSON.stringify(events)).not.toContain("responses-reasoning");
		expectFinished(events, "All three files inspected.", 3);
	});

	it("restores a completed response's reasoning from serialized history on the next user run", async () => {
		const first = await run([
			[{ type: "responses-reasoning", reasoning }, ...answer("The initial answer.")],
		], { model: reasoning.model });
		const savedHistory: Step[] = JSON.parse(JSON.stringify(first.history));
		await run([answer("The follow-up answer.")], { model: reasoning.model, history: savedHistory, prompt: "Explain the answer" });
		expect(fixture.requests[1].messages).toContainEqual(expect.objectContaining({
			role: "assistant", content: "The initial answer.", responsesReasoning: reasoning,
		}));
		expect(savedHistory.filter((step) => step.kind === "assistant").at(-1)?.responsesReasoning).toBeUndefined();
	});
});

describe("runAgent PR 170 regressions", () => {
	it("allows reading a file again after editing it", async () => {
		const { history, events } = await run([
			toolTurn(call("Read", { path: "a.ts" }, "read-before")),
			toolTurn(call("Write", { path: "a.ts", contents: "fixed" }, "write")),
			toolTurn(call("Read", { path: "a.ts" }, "read-after")),
			answer("Fixed and verified."),
		]);
		expect(fixture.executions.map((item) => item.name)).toEqual(["Read", "Write", "Read"]);
		expect(history.filter((step) => step.kind === "tool-result").map((step) => step.callId)).toEqual(["read-before", "write", "read-after"]);
		expectFinished(events, "Fixed and verified.", 4);
	});

	it("executes todo updates whose serialized arguments differ after character 200", async () => {
		const first = { id: "first", content: "A completed task with a detailed description. ".repeat(8), status: "completed" };
		const pending = call("TodoWrite", { todos: [first, { id: "second", content: "Remaining work", status: "pending" }] }, "pending");
		const completed = call("TodoWrite", { todos: [first, { id: "second", content: "Remaining work", status: "completed" }] }, "completed");
		expect(pending.arguments.slice(0, 200)).toBe(completed.arguments.slice(0, 200));
		const { history, events } = await run([toolTurn(pending), toolTurn(completed), answer("Both tasks completed.")]);
		expect(history).toContainEqual(expect.objectContaining({ kind: "tool-result", callId: "completed", output: expect.stringContaining("[x] Remaining work") }));
		expectFinished(events, "Both tasks completed.", 3);
	});

	it.each([undefined, 100_000])("keeps empty TodoRead results adjacent without forcing a todo list (contextTokens=%s)", async (contextTokens) => {
		const { history, events } = await run([
			toolTurn(call("Read", { path: "a.ts" }, "read"), call("TodoRead", {}, "todos"), call("Grep", { pattern: "name" }, "grep")),
			answer("No tasks have been recorded."),
		], { contextTokens });
		const batchIndex = history.findIndex((step) => step.kind === "assistant" && step.calls.length === 3);
		expect(history.slice(batchIndex + 1, batchIndex + 4).map((step) => step.kind === "tool-result" ? step.callId : step.kind)).toEqual(["read", "todos", "grep"]);
		expect(history[batchIndex + 4]).toMatchObject({ kind: "assistant", text: "No tasks have been recorded." });
		expect(history.filter((step) => step.kind === "user" && step.synthetic)).toEqual([]);
		const nextMessages = fixture.requests[1].messages;
		expect(nextMessages.filter((message) => message.role === "tool").map((message) => message.tool_call_id)).toEqual(["read", "todos", "grep"]);
		expect(JSON.stringify(nextMessages)).not.toContain("MUST call TodoWrite");
		expect(nextMessages).toContainEqual(expect.objectContaining({ role: "tool", tool_call_id: "todos", content: "(no todos)" }));
		expectCompleteToolGroups(nextMessages);
		expectFinished(events, "No tasks have been recorded.", 2);
	});

	it.each(["Write", "Shell", "mcp__test__write"])("rejects %s in Plan even when approval would permit it", async (name) => {
		const { history, events } = await run([
			toolTurn(call(name, { path: "a.ts", contents: "unplanned", command: "touch a.ts" }, "forbidden")),
			toolTurn(call("WritePlan", { title: "Plan", content: "Inspect the implementation." }, "plan")),
			answer("The plan is saved."),
		], { mode: "plan" });
		expect(history).toContainEqual(expect.objectContaining({ kind: "tool-result", callId: "forbidden", status: "error", output: expect.stringContaining("not allowed in plan mode") }));
		expect(fixture.executions.some((item) => item.name === name)).toBe(false);
		expect(fixture.callMcp).not.toHaveBeenCalled();
		expect(fixture.approve.mock.calls.every(([toolName]) => toolName !== name)).toBe(true);
		expect(fixture.requests[0].tools?.map((tool) => tool.function.name)).not.toContain(name);
		expectFinished(events, "The plan is saved.", 3);
	});

	it("finishes an ordinary Ask response in one request", async () => {
		const { events } = await run([answer("The answer is forty two.")], { mode: "ask" });
		expectFinished(events, "The answer is forty two.", 1);
	});

	it("finishes an agent response once its todo list is complete", async () => {
		const { events } = await run([
			toolTurn(call("TodoWrite", { todos: [{ id: "done", content: "Implement the change", status: "completed" }] }, "complete")),
			answer("Implemented the requested change."),
		]);
		expectFinished(events, "Implemented the requested change.", 2);
	});

	it("finishes a small completed task without requiring a todo list", async () => {
		const { events } = await run([toolTurn(call("Write", { path: "a.ts", contents: "fixed" }, "write")), answer("The fix is applied.")]);
		expectFinished(events, "The fix is applied.", 2);
	});

	it("finishes three useful reads without inserting todo-creation reminders", async () => {
		const { history, events } = await run([
			toolTurn(call("Read", { path: "a.ts" }, "read-a")),
			toolTurn(call("Read", { path: "b.ts" }, "read-b")),
			toolTurn(call("Read", { path: "c.ts" }, "read-c")),
			answer("The three files use the same interface."),
		]);
		expect(history.filter((step) => step.kind === "user" && step.synthetic)).toEqual([]);
		expectFinished(events, "The three files use the same interface.", 4);
	});

	it("continues unfinished todos and then accepts the completed answer", async () => {
		const { events } = await run([
			toolTurn(call("TodoWrite", { todos: [{ id: "work", content: "Implement the change", status: "pending" }] }, "pending")),
			answer("I still have implementation work left."),
			toolTurn(call("TodoWrite", { merge: true, todos: [{ id: "work", status: "completed" }] }, "completed")),
			answer("The task is complete."),
		]);
		expect(JSON.stringify(fixture.requests[2].messages)).toContain("incomplete todo");
		expectFinished(events, "The task is complete.", 4);
	});

	it("nudges an incomplete todo only once before accepting a blocked final answer", async () => {
		const blocked = "The dependency service is unavailable. Restore it before I can finish.";
		const { history, events } = await run([
			toolTurn(call("TodoWrite", { todos: [{ id: "work", content: "Fetch required dependency", status: "pending" }] }, "pending")),
			answer("I could not fetch the dependency."),
			answer(blocked),
		]);
		const reminders = history.filter((step) => step.kind === "user" && step.synthetic && step.text.includes("incomplete todo"));
		expect(reminders).toHaveLength(1);
		expectFinished(events, blocked, 3);
	});

	it.each([undefined, 1024, 8192])("respects the configured Plan output limit (%s) on every request", async (maxTokens) => {
		const { events } = await run([
			toolTurn(call("WritePlan", { title: "Implementation", content: "Inspect, implement, verify." }, "plan")),
			answer("The implementation plan is saved."),
		], { mode: "plan", maxTokens });
		expect(fixture.requests.map((request) => request.maxTokens)).toEqual([maxTokens, maxTokens]);
		expectFinished(events, "The implementation plan is saved.", 2);
	});

	it.each(["length", "max_tokens", "max_output_tokens"])("continues a response truncated with %s", async (finishReason) => {
		const { events } = await run([answer("The explanation begins", finishReason), answer("and is now complete.")]);
		expect(JSON.stringify(fixture.requests[1].messages)).toContain("output-token limit");
		expectFinished(events, "and is now complete.", 2);
	});

	it("recovers a thinking-only turn", async () => {
		const { events } = await run([
			[{ type: "thinking-delta", text: "I need to finish the response." }, { type: "done", finishReason: "stop" }],
			answer("Here is the completed answer."),
		]);
		expect(JSON.stringify(fixture.requests[1].messages)).toContain("only internal reasoning");
		expectFinished(events, "Here is the completed answer.", 2);
	});

	it("recovers an empty response after a tool result", async () => {
		const { events } = await run([toolTurn(call("Read", { path: "a.ts" }, "read")), answer(""), answer("The file looks correct.")]);
		expect(JSON.stringify(fixture.requests[2].messages)).toContain("If you need to make more tool calls");
		expectFinished(events, "The file looks correct.", 3);
	});

	it("asks Plan to save its plan and accepts the final answer after WritePlan", async () => {
		const { events } = await run([
			answer("First inspect the code, then implement the change."),
			toolTurn(call("WritePlan", { title: "Implementation", content: "Inspect, implement, verify." }, "plan")),
			answer("The implementation plan is saved."),
		], { mode: "plan" });
		expect(JSON.stringify(fixture.requests[1].messages)).toContain("Call the WritePlan tool now");
		expect(fixture.executions.map((item) => item.name)).toEqual(["WritePlan"]);
		expectFinished(events, "The implementation plan is saved.", 3);
	});

	it("recovers repeated retrieval with append-only notes and an unchanged tool schema", async () => {
		const { history, events } = await run([
			...Array.from({ length: 4 }, (_, i) => toolTurn(call("Read", { path: "a.ts" }, `read-${i}`))),
			toolTurn(call("Write", { path: "a.ts", contents: "fixed" }, "write")),
			toolTurn(call("Read", { path: "a.ts" }, "verify")),
			answer("Fixed and verified using the existing findings."),
		]);
		expect(history).toContainEqual(expect.objectContaining({ kind: "user", synthetic: true, text: expect.stringContaining("without new evidence") }));
		for (let i = 1; i < fixture.requests.length; i++) {
			const previous = fixture.requests[i - 1];
			expect(fixture.requests[i].messages.slice(0, previous.messages.length)).toEqual(previous.messages);
			expect(fixture.requests[i].tools).toEqual(previous.tools);
			expectCompleteToolGroups(fixture.requests[i].messages);
		}
		expectFinished(events, "Fixed and verified using the existing findings.", 7);
	});

	it("bounds an unchanged search/read cycle even when auto-continue is enabled", async () => {
		const { history, events } = await run(
			Array.from({ length: 20 }, (_, i) => toolTurn(i % 2
				? call("Read", { path: "a.ts" }, `read-${i}`)
				: call("Grep", { pattern: "bug" }, `grep-${i}`))),
			{ autoContinue: true, maxSteps: 200 },
		);
		expect(fixture.executions).toHaveLength(10);
		expect(fixture.requests).toHaveLength(10);
		expect(history).toContainEqual(expect.objectContaining({ kind: "user", synthetic: true, text: expect.stringContaining("task remains incomplete") }));
		expect(history.at(-1)).toMatchObject({ kind: "assistant", text: expect.stringContaining("I paused") });
		expect(events).toContainEqual(expect.objectContaining({ type: "run-result", text: expect.stringContaining("still incomplete") }));
		expect(events.filter(event => event.type === "error" || event.type === "max-steps")).toEqual([]);
		for (const request of fixture.requests) expectCompleteToolGroups(request.messages);
	});

	it("accepts a concrete blocker after the retrieval wrap-up instead of nudging open todos again", async () => {
		const { events } = await run([
			toolTurn(call("TodoWrite", { todos: [{ id: "fix", content: "Fix the issue", status: "pending" }] }, "todo")),
			...Array.from({ length: 7 }, (_, i) => toolTurn(call("Read", { path: "a.ts" }, `read-${i}`))),
			answer("The reproduction input is missing; I need it to identify the failing case."),
		]);
		expect(JSON.stringify(fixture.requests.at(-1)?.messages)).toContain("exact blocker");
		expectFinished(events, "The reproduction input is missing; I need it to identify the failing case.", 9);
	});

	it("still pauses a repeated tool loop at the configured step limit", async () => {
		const { history, events } = await run(
			Array.from({ length: 4 }, (_, i) => toolTurn(call("Read", { path: "a.ts" }, `read-${i}`))),
			{ maxSteps: 4 },
		);
		expect(fixture.executions).toHaveLength(4);
		expect(fixture.requests).toHaveLength(4);
		expect(events).toContainEqual({ type: "max-steps", steps: 4 });
		expect(history.filter((step) => step.kind === "tool-result")).toHaveLength(4);
	});
});

describe("runAgent context consumption", () => {
	it.each([true, false])("loads only a discovered MCP schema and preserves approval (approved=%s)", async (approved) => {
		const connected = Array.from({ length: 12 }, (_, i) => ({
			qualifiedName: `mcp__records__operation_${i}`,
			server: "records",
			tool: {
				name: `operation_${i}`,
				description: `Record operation ${i}. ${"Field validation instructions. ".repeat(20)}`,
				inputSchema: { type: "object", properties: Object.fromEntries(Array.from({ length: 8 }, (_, field) => [`field_${field}`, { type: "string", description: "A field value with validation requirements. ".repeat(5) }])) },
			},
		}));
		vi.spyOn(mcpManager, "listTools").mockReturnValue(connected);
		fixture.approve.mockResolvedValueOnce(approved);
		const selected = connected[5];
		const input = { field_0: "record-42" };
		const activeMcpNames = (request: StreamChatOpts) => request.tools?.map((tool) => tool.function.name).filter((name) => name.startsWith("mcp__"));
		const final = approved ? "The record operation completed." : "The requested operation was denied.";
		const { events } = await run([
			(request) => {
				expect(activeMcpNames(request)).toEqual([]);
				expect(JSON.stringify(request.messages)).toContain("Connected MCP tool schemas are available on demand");
				return toolTurn(call("ReadContext", { id: "mcp", pattern: selected.qualifiedName }, "find-mcp"));
			},
			(request) => {
				expect(activeMcpNames(request)).toEqual([]);
				const result = request.messages.find((message) => message.role === "tool" && message.tool_call_id === "find-mcp");
				const catalog = result?.role === "tool" && typeof result.content === "string" ? result.content : "";
				const line = catalog.split("\n").find((entry) => entry.includes(selected.qualifiedName));
				const reference = line?.match(/ReadContext \{"id":"([^"]+)"\}/);
				expect(reference).toBeDefined();
				return toolTurn(call("ReadContext", { id: reference![1] }, "load-mcp-schema"));
			},
			(request) => {
				expect(activeMcpNames(request)).toEqual([selected.qualifiedName]);
				expect(request.tools?.find((tool) => tool.function.name === selected.qualifiedName)?.function.parameters).toEqual(selected.tool.inputSchema);
				return toolTurn(call(selected.qualifiedName, input, "selected-mcp"));
			},
			answer(final),
		]);
		expect(fixture.approve).toHaveBeenCalledWith(selected.qualifiedName, input, "selected-mcp");
		if (approved) expect(fixture.callMcp).toHaveBeenCalledWith(selected.qualifiedName, input, expect.any(AbortSignal));
		else expect(fixture.callMcp).not.toHaveBeenCalled();
		expect(fixture.requests[0].tools).toEqual(fixture.requests[1].tools);
		expect(fixture.requests[2].tools).toEqual(fixture.requests[3].tools);
		for (const request of fixture.requests) expectCompleteToolGroups(request.messages);
		expectFinished(events, final, 4);
	});

	it.each(["buildUserInfoBlock", "buildOpenFilesBlock"] as const)("counts %s before making an oversized provider request", async (source) => {
		vi.spyOn(cursorContext, source).mockResolvedValue("Workspace instructions and selected file context. ".repeat(3000));
		const { events } = await run([], { enableWorkspaceContext: true, contextTokens: 20_000, maxTokens: 1024 });
		expect(fixture.requests).toEqual([]);
		expect(events).toContainEqual({ type: "run-status", status: "error" });
		expect(events).toContainEqual({ type: "error", message: expect.stringContaining("context window is too small") });
	});

	it("rejects a response reservation that leaves no room for a request", async () => {
		const { events } = await run([], { contextTokens: 4096, maxTokens: 4096 });
		expect(fixture.requests).toEqual([]);
		expect(events).toContainEqual({ type: "run-status", status: "error" });
		expect(events).toContainEqual({ type: "error", message: expect.stringContaining("context window is too small") });
	});

	it.each([false, true])("preserves full large tool exchanges and cached prefixes across saved followups (stopped=%s)", async (stopped) => {
		const marker = "FINDING_IN_THE_MIDDLE_OF_THE_PRIOR_TOOL_EXCHANGE";
		const output = `${"Earlier source lines\n".repeat(1000)}${marker}\n${"Later source lines\n".repeat(1000)}`;
		const input = { path: "generated.ts", contents: `${"export const example = 1;\n".repeat(1000)}${marker}\n${"// generated content\n".repeat(1000)}` };
		const writeCall = call("Write", input, "full-write");
		vi.spyOn(TOOLS.Read, "execute").mockResolvedValueOnce({ output });
		const contextState: NonNullable<RunAgentOptions["contextState"]> = {};
		const abort = new AbortController();
		const first = await run([
			toolTurn(call("Read", { path: "source.ts" }, "full-read")),
			toolTurn(writeCall),
			(request) => {
				const result = request.messages.find((message) => message.role === "tool" && message.tool_call_id === "full-read");
				expect(result?.role === "tool" ? result.content : "").toBe(output);
				const sentCall = request.messages.flatMap((message) => message.role === "assistant" ? message.tool_calls ?? [] : [])
					.find((toolCall) => toolCall.id === writeCall.id);
				expect(sentCall?.function.arguments).toBe(writeCall.arguments);
				if (stopped) abort.abort();
				return answer("The source has been inspected and updated.");
			},
		], { contextTokens: 1_000_000, contextState, signal: abort.signal, promptCacheKey: "full-history" });
		if (stopped) expect(first.events).toContainEqual({ type: "run-status", status: "cancelled" });
		else expectFinished(first.events, "The source has been inspected and updated.", 3);
		expect(fixture.executions).toContainEqual({ name: "Write", input });
		expect(contextState.checkpoint).toBeUndefined();
		for (let i = 1; i < fixture.requests.length; i++) {
			const previous = fixture.requests[i - 1].messages;
			expect(fixture.requests[i].messages.slice(0, previous.length)).toEqual(previous);
		}

		let previous = JSON.parse(JSON.stringify(fixture.requests[2].messages)) as WireMessage[];
		let restored = JSON.parse(JSON.stringify({ history: first.history, contextState })) as { history: Step[]; contextState: NonNullable<RunAgentOptions["contextState"]> };
		for (const prompt of ["Continue the interrupted work.", "Explain the change using the earlier findings."]) {
			fixture.requests.length = 0;
			fixture.turns.length = 0;
			const next = await run([
				(request) => {
					expect(request.messages.slice(0, previous.length)).toEqual(previous);
					const result = request.messages.find((message) => message.role === "tool" && message.tool_call_id === "full-read");
					expect(result?.role === "tool" ? result.content : "").toBe(output);
					expect(request.promptCacheKey).toBe("full-history");
					return answer("The previous finding is available without reading the file again.");
				},
			], { prompt, ...restored, contextTokens: 1_000_000, promptCacheKey: "full-history" });
			expectFinished(next.events, "The previous finding is available without reading the file again.", 1);
			expectCompleteToolGroups(fixture.requests[0].messages);
			previous = JSON.parse(JSON.stringify(fixture.requests[0].messages)) as WireMessage[];
			restored = JSON.parse(JSON.stringify({ history: next.history, contextState: restored.contextState }));
		}
	});

	it("groups unlimited-context mode-switch batches without changing saved originals or prior message prefixes", async () => {
		const output = `${"Full source detail\n".repeat(1000)}UNABBREVIATED_MIDDLE_FINDING\n${"More source detail\n".repeat(1000)}`;
		vi.spyOn(TOOLS.Read, "execute").mockResolvedValue({ output });
		vi.spyOn(writePlanTool, "execute").mockResolvedValue({ output: "wrote plan" });
		const contextState: NonNullable<RunAgentOptions["contextState"]> = {};
		const first = await run([
			toolTurn(call("Read", { path: "before.ts" }, "before-switch")),
			toolTurn(call("SwitchMode", { target_mode_id: "plan" }, "grouped-switch"), call("Read", { path: "after.ts" }, "after-switch")),
			(request) => {
				expectCompleteToolGroups(request.messages);
				// Switching modes changes the system instructions; earlier conversation
				// messages must still retain their exact serialized cache prefix.
				const previous = fixture.requests[1].messages;
				expect(request.messages.slice(1, previous.length)).toEqual(previous.slice(1));
				const result = request.messages.find((message) => message.role === "tool" && message.tool_call_id === "after-switch");
				expect(result?.role === "tool" ? result.content : "").toBe(output);
				return toolTurn(call("WritePlan", { title: "Plan", content: "Apply the observed finding." }, "grouped-plan"));
			},
			(request) => {
				expectCompleteToolGroups(request.messages);
				const previous = fixture.requests[2].messages;
				expect(request.messages.slice(0, previous.length)).toEqual(previous);
				return answer("The plan is ready.");
			},
		], { contextState });
		expectFinished(first.events, "The plan is ready.", 4);
		expect(contextState.checkpoint).toBeDefined();
		const noteIndex = first.history.findIndex((step) => step.kind === "user" && step.synthetic && step.text.startsWith("Mode changed from agent to plan."));
		const resultIndex = first.history.findIndex((step) => step.kind === "tool-result" && step.callId === "grouped-switch");
		expect(noteIndex).toBeGreaterThan(-1);
		expect(noteIndex).toBeLessThan(resultIndex);
		expect(first.history).toContainEqual(expect.objectContaining({ kind: "tool-result", callId: "after-switch", output }));
		const previous = JSON.parse(JSON.stringify(fixture.requests[3].messages)) as WireMessage[];
		const originalHistory = JSON.parse(JSON.stringify(first.history)) as Step[];
		const restored = JSON.parse(JSON.stringify({ history: first.history, contextState })) as { history: Step[]; contextState: NonNullable<RunAgentOptions["contextState"]> };
		fixture.requests.length = 0;
		fixture.turns.length = 0;
		const second = await run([
			(request) => {
				expectCompleteToolGroups(request.messages);
				expect(request.messages.slice(0, previous.length)).toEqual(previous);
				return toolTurn(call("WritePlan", { title: "Plan", content: "Explain the observed finding." }, "restored-grouped-plan"));
			},
			(request) => {
				expectCompleteToolGroups(request.messages);
				expect(request.messages.slice(0, previous.length)).toEqual(previous);
				return answer("The saved plan and findings are available.");
			},
		], { mode: "plan", prompt: "Explain the saved plan.", ...restored });
		expectFinished(second.events, "The saved plan and findings are available.", 2);
		expect(restored.history.slice(0, originalHistory.length)).toEqual(originalHistory);
	});

	it("executes large edits verbatim and archives their arguments only under context pressure", async () => {
		const marker = "ORIGINAL_MIDDLE_OF_WRITTEN_FILE";
		const input = { path: "generated.ts", contents: `${"export const example = 1;\n".repeat(1000)}${marker}\n${"// generated content\n".repeat(1000)}` };
		const writeCall = call("Write", input, "large-write");
		const { history, events } = await run([
			toolTurn(writeCall),
			(request) => {
				const sentCall = request.messages.flatMap((message) => message.role === "assistant" ? message.tool_calls ?? [] : [])
					.find((toolCall) => toolCall.id === "large-write");
				expect(sentCall).toBeDefined();
				expect(sentCall!.function.arguments.length).toBeLessThan(writeCall.arguments.length / 4);
				const historical = JSON.parse(sentCall!.function.arguments);
				expect(historical.path).toBe(input.path);
				expect(historical.contents).not.toContain(marker);
				return toolTurn(call("ReadContext", { id: historical._context_archive.id, pattern: marker }, "recover-write"));
			},
			(request) => {
				const result = request.messages.find((message) => message.role === "tool" && message.tool_call_id === "recover-write");
				expect(result?.role === "tool" ? result.content : "").toContain(marker);
				return answer("The generated file is written.");
			},
		], { contextTokens: 12_000, maxTokens: 1024 });
		expect(fixture.executions).toContainEqual({ name: "Write", input });
		expect(history).toContainEqual(expect.objectContaining({ kind: "assistant", calls: [writeCall] }));
		for (const request of fixture.requests) expectCompleteToolGroups(request.messages);
		expectFinished(events, "The generated file is written.", 3);
	});

	it("archives large outputs under context pressure while retaining recoverable full results", async () => {
		const marker = "ARCHIVE_ONLY_DEPENDENCY_MISMATCH_42";
		const outputs = ["alpha", "beta", "gamma"].map((name) => Array.from({ length: 3000 }, (_, i) =>
			i === 1500 ? `${name}: ${marker}` : `${name}:${i + 1} export const setting_${i} = \"a realistic source value with implementation details\";`,
		).join("\n"));
		const outputByCall = new Map(outputs.map((output, i) => [`read-${i}`, output]));
		const read = vi.spyOn(TOOLS.Read, "execute");
		for (const output of outputs) read.mockResolvedValueOnce({ output });
		const { history, events } = await run([
			...outputs.map((_, i) => toolTurn(call("Read", { path: `file-${i}.ts` }, `read-${i}`))),
			(request) => {
				const result = request.messages.find((message) => message.role === "tool" && message.tool_call_id === "read-0");
				expect(result?.role).toBe("tool");
				const preview = result?.role === "tool" && typeof result.content === "string" ? result.content : "";
				expect(preview).not.toContain(marker);
				const reference = preview.match(/ReadContext \{"id":"([^"]+)"\}/);
				expect(reference, "large results advertise a retrievable context reference").not.toBeNull();
				return toolTurn(call("ReadContext", { id: reference![1], pattern: marker }, "recover-middle"));
			},
			(request) => {
				const result = request.messages.find((message) => message.role === "tool" && message.tool_call_id === "recover-middle");
				expect(result?.role === "tool" ? result.content : "").toContain(`alpha: ${marker}`);
				return answer("The archived source identifies the dependency mismatch.");
			},
		], { contextTokens: 40_000, maxTokens: 1024 });

		const measuredRequests = fixture.requests.slice(0, 4);
		const sentCharacters = measuredRequests.reduce((sum, request) => sum + JSON.stringify({ messages: request.messages, tools: request.tools }).length, 0);
		const fullOutputCharacters = measuredRequests.reduce((sum, request) => {
			const messages = request.messages.map((message) => message.role === "tool" && outputByCall.has(message.tool_call_id)
				? { ...message, content: outputByCall.get(message.tool_call_id) }
				: message);
			return sum + JSON.stringify({ messages, tools: request.tools }).length;
		}, 0);
		expect(sentCharacters).toBeLessThan(fullOutputCharacters * 0.35);
		for (const [callId, output] of outputByCall) {
			expect(history).toContainEqual(expect.objectContaining({ kind: "tool-result", callId, output }));
			expect(events).toContainEqual(expect.objectContaining({ type: "tool-call-completed", callId, result: output }));
		}
		for (const request of fixture.requests) expectCompleteToolGroups(request.messages);
		expectFinished(events, "The archived source identifies the dependency mismatch.", 5);
	});

	it("keeps a checkpointed archive prefix stable after saving and increasing the context window", async () => {
		const marker = "ARCHIVED_FINDING_AVAILABLE_AFTER_RELOAD";
		const output = `${"Earlier source lines\n".repeat(1000)}${marker}\n${"Later source lines\n".repeat(1000)}`;
		const contextState: NonNullable<RunAgentOptions["contextState"]> = {};
		vi.spyOn(TOOLS.Read, "execute").mockResolvedValueOnce({ output });
		const first = await run([
			toolTurn(call("Read", { path: "source.ts" }, "checkpoint-read")),
			answer("I have inspected the source."),
		], { contextTokens: 12_000, maxTokens: 1024, contextState });
		expectFinished(first.events, "I have inspected the source.", 2);
		expect(contextState.checkpoint).toBeDefined();
		const previous = JSON.parse(JSON.stringify(fixture.requests[1].messages)) as WireMessage[];
		const preview = previous.find((message) => message.role === "tool" && message.tool_call_id === "checkpoint-read");
		const reference = (preview?.role === "tool" && typeof preview.content === "string" ? preview.content : "").match(/ReadContext \{"id":"([^"]+)"\}/);
		expect(reference).not.toBeNull();
		const restored = JSON.parse(JSON.stringify({ history: first.history, contextState })) as { history: Step[]; contextState: NonNullable<RunAgentOptions["contextState"]> };
		fixture.requests.length = 0;
		fixture.turns.length = 0;
		const second = await run([
			(request) => {
				expect(request.messages.slice(0, previous.length)).toEqual(previous);
				return toolTurn(call("ReadContext", { id: reference![1], pattern: marker }, "checkpoint-detail"));
			},
			(request) => {
				expect(request.messages.slice(0, previous.length)).toEqual(previous);
				const result = request.messages.find((message) => message.role === "tool" && message.tool_call_id === "checkpoint-detail");
				expect(result?.role === "tool" ? result.content : "").toContain(marker);
				return answer("The earlier finding is recovered.");
			},
		], { prompt: "Recover the earlier finding.", ...restored, contextTokens: 1_000_000 });
		expectFinished(second.events, "The earlier finding is recovered.", 2);
		expect(second.history).toContainEqual(expect.objectContaining({ kind: "tool-result", callId: "checkpoint-read", output }));
		for (const request of fixture.requests) expectCompleteToolGroups(request.messages);
	});

	it("restores archived output references from saved chat history in a subsequent Ask run", async () => {
		const marker = "DETAIL_NEEDED_ON_FOLLOWUP";
		const output = `${"Earlier source lines\n".repeat(1000)}${marker}\n${"Later source lines\n".repeat(1000)}`;
		vi.spyOn(TOOLS.Read, "execute").mockResolvedValueOnce({ output });
		const first = await run([
			toolTurn(call("Read", { path: "source.ts" }, "saved-read")),
			answer("I have inspected the source."),
		], { contextTokens: 12_000, maxTokens: 1024 });
		const preview = fixture.requests[1].messages.find((message) => message.role === "tool" && message.tool_call_id === "saved-read");
		const reference = (preview?.role === "tool" && typeof preview.content === "string" ? preview.content : "").match(/ReadContext \{"id":"([^"]+)"\}/);
		expect(reference).not.toBeNull();
		expectFinished(first.events, "I have inspected the source.", 2);

		fixture.requests.length = 0;
		fixture.turns.length = 0;
		const second = await run([
			toolTurn(call("ReadContext", { id: reference![1], pattern: marker }, "followup-detail")),
			(request) => {
				const result = request.messages.find((message) => message.role === "tool" && message.tool_call_id === "followup-detail");
				expect(result?.role === "tool" ? result.content : "").toContain(marker);
				return answer("The earlier output includes the requested detail.");
			},
		], { mode: "ask", prompt: "What was the omitted detail?", history: first.history });
		expect(second.history).toContainEqual(expect.objectContaining({ kind: "tool-result", callId: "saved-read", output }));
		for (const request of fixture.requests) expectCompleteToolGroups(request.messages);
		expectFinished(second.events, "The earlier output includes the requested detail.", 2);
	});

	it.each([false, true])("retains the current request and archived history after compaction (summary failure=%s)", async (summaryFails) => {
		const apiKeyPool = new ApiKeyPool("provider", "https://example.test/v1", async () => ({ balance: "round-robin", credentials: [] }));
		const marker = "OLD_FINDING_RETRIEVED_AFTER_COMPACTION";
		const originalRequest = "Inspect the dependency initialization.";
		const followup = "Recover the earlier finding and explain it.";
		const history = olderReadHistory(originalRequest, marker);
		const contextState: NonNullable<RunAgentOptions["contextState"]> = {};
		const originalHistory = [...history];
		const summary = "Earlier files were inspected. The user now needs an earlier finding explained.";
		const { events } = await run([
			(request) => {
				expect(request.tools).toBeUndefined();
				expect(request.maxTokens).toBe(1536);
				expect(JSON.stringify(request.messages).length).toBeLessThan(100_000);
				if (summaryFails) throw new Error("Summary provider temporarily unavailable");
				return [...answer(summary), { type: "usage", promptTokens: 750, completionTokens: 60 }];
			},
			(request) => {
				const text = JSON.stringify(request.messages);
				expect(text).toContain(`<user_query>\\n${followup}\\n</user_query>`);
				expect(text).toContain(originalRequest);
				expect(text).not.toContain(marker);
				if (!summaryFails) expect(text.split(summary)).toHaveLength(2);
				return toolTurn(call("ReadContext", { id: "history", pattern: marker }, "recover-history"));
			},
			(request) => {
				const result = request.messages.find((message) => message.role === "tool" && message.tool_call_id === "recover-history");
				expect(result?.role === "tool" ? result.content : "").toContain(marker);
				return toolTurn(call("Read", { path: "verify.ts" }, "verify"));
			},
			toolTurn(call("Read", { path: "verify-other.ts" }, "verify-other")),
			answer("The earlier finding has been recovered and explained."),
		], { prompt: followup, history, contextState, contextTokens: 12_000, maxTokens: 1024, apiKeyPool });
		// Compaction and subsequent tool continuations share the live key pool.
		for (const request of fixture.requests) expect(request.apiKeyPool).toBe(apiKeyPool);
		expect(history.slice(0, originalHistory.length)).toEqual(originalHistory);
		expect(events.filter((event) => event.type === "compaction")).toEqual([
			{ type: "compaction", status: "running" },
			summaryFails ? { type: "compaction", status: "failed" } : { type: "compaction", status: "done", summary },
		]);
		if (!summaryFails) expect(events).toContainEqual(expect.objectContaining({ type: "usage", promptTokens: 750, completionTokens: 60 }));
		expect(fixture.requests.filter((request) => request.tools === undefined)).toHaveLength(1);
		for (const request of fixture.requests.slice(1)) expectCompleteToolGroups(request.messages);
		expectFinished(events, "The earlier finding has been recovered and explained.", 5);
		expect(contextState.checkpoint).toBeDefined();
		const previous = JSON.parse(JSON.stringify(fixture.requests[4].messages)) as WireMessage[];
		const restored = JSON.parse(JSON.stringify({ history, contextState })) as { history: Step[]; contextState: NonNullable<RunAgentOptions["contextState"]> };
		fixture.requests.length = 0;
		fixture.turns.length = 0;
		const next = await run([
			(request) => {
				expect(request.messages.slice(0, previous.length)).toEqual(previous);
				return answer("The context is still available.");
			},
		], { prompt: "Continue with the recovered finding.", ...restored, contextTokens: 1_000_000 });
		expectFinished(next.events, "The context is still available.", 1);
		expect(next.events.filter((event) => event.type === "compaction")).toEqual([]);
	});

	it("reuses a serialized summary and todo state on the next run without another paid summary", async () => {
		const history = olderReadHistory("Inspect dependency initialization.", "DETAIL_PRESERVED_IN_SAVED_TRANSCRIPT");
		const contextState: NonNullable<RunAgentOptions["contextState"]> = {};
		const summary = "Dependency initialization was inspected; verification remains blocked by service access.";
		const pending = { id: "verify", content: "Verify the dependency path", status: "pending" };
		const first = await run([
			(request) => {
				expect(request.tools).toBeUndefined();
				return answer(summary);
			},
			toolTurn(call("TodoWrite", { todos: [pending] }, "pending-verification")),
			answer("The dependency service is unavailable."),
			answer("I need access to the service before verification can continue."),
		], { prompt: "Verify the dependency path.", history, contextState, contextTokens: 12_000, maxTokens: 1024 });
		expectFinished(first.events, "I need access to the service before verification can continue.", 4);
		expect(contextState.checkpoint).toBeDefined();
		expect(contextState.todos).toEqual([pending]);

		// Simulate saving/reloading the conversation, rather than sharing object identity.
		const restored = JSON.parse(JSON.stringify({ history, contextState })) as { history: Step[]; contextState: NonNullable<RunAgentOptions["contextState"]> };
		fixture.requests.length = 0;
		fixture.turns.length = 0;
		const second = await run([
			(request) => {
				expect(request.tools).toBeDefined();
				expect(JSON.stringify(request.messages)).toContain(summary);
				return toolTurn(call("TodoRead", {}, "restored-todos"));
			},
			(request) => {
				const todos = request.messages.find((message) => message.role === "tool" && message.tool_call_id === "restored-todos");
				expect(todos?.role === "tool" ? todos.content : "").toContain("[pending] Verify the dependency path");
				return toolTurn(call("TodoWrite", { merge: true, todos: [{ id: "verify", status: "completed" }] }, "finished-verification"));
			},
			answer("Verification is complete."),
		], { prompt: "The service is available. Continue verification.", ...restored, contextTokens: 12_000, maxTokens: 1024 });
		expectFinished(second.events, "Verification is complete.", 3);
		expect(second.events.filter((event) => event.type === "compaction")).toEqual([]);
		expect(fixture.requests.every((request) => request.tools !== undefined)).toBe(true);
		expect(restored.contextState.todos).toEqual([{ ...pending, status: "completed" }]);
		expect(second.history).toContainEqual(expect.objectContaining({ kind: "tool-result", output: expect.stringContaining("DETAIL_PRESERVED_IN_SAVED_TRANSCRIPT") }));
		for (const request of fixture.requests) expectCompleteToolGroups(request.messages);
	});
});

describe("chat-only account transport capabilities", () => {
  it("runs Ask without tool or MCP schemas and refuses fabricated calls", async () => {
    const inventory = vi.spyOn(mcpManager, "listTools");
    for (const oauthKind of ["trae", "windsurf"] as const) {
      fixture.requests.length = 0;
      fixture.turns.length = 0;
      const result = await run([request => {
        expect(request.tools).toEqual([]);
        expect(JSON.stringify(request.messages)).toContain("No tools are available");
        expect(JSON.stringify(request.messages)).not.toContain("Connected MCP tool schemas are available on demand");
        return answer("Here is an explanation based on the supplied code.");
      }], { mode: "ask", oauthKind });
      expectFinished(result.events, "Here is an explanation based on the supplied code.", 1);

      for (const guessed of ["Read", "mcp__test__write", "SwitchMode"]) {
        fixture.requests.length = 0;
        fixture.turns.length = 0;
        const rejected = await run([toolTurn(call(guessed, { path: "file.ts", target_mode_id: "agent" }, "invented"))], { mode: "ask", oauthKind });
        expect(rejected.events).toContainEqual({ type: "error", message: "This chat-only provider returned an unsupported tool call. No action was executed." });
        expect(rejected.events).toContainEqual({ type: "run-status", status: "error" });
        expect(rejected.events.some(event => event.type === "tool-call-started" || event.type === "mode-changed")).toBe(false);
        expect(fixture.requests[0].tools).toEqual([]);
      }
    }
    expect(inventory).not.toHaveBeenCalled();
    expect(fixture.executions).toEqual([]);
    expect(fixture.callMcp).not.toHaveBeenCalled();
    expect(fixture.approve).not.toHaveBeenCalled();
  });

  it("rejects Agent and other tool modes before a chat-only account starts work", async () => {
    for (const oauthKind of ["trae", "windsurf"] as const) {
      for (const mode of ["agent", "plan", "debug", "multitask", "project"] as const) {
        const { history, events } = await run([], { oauthKind, mode });
        expect(events).toContainEqual({ type: "error", message: `${oauthKind === "trae" ? "Trae" : "Windsurf"} supports chat only. Switch to Ask mode to use this account, or select a provider with tool support.` });
        expect(events).toContainEqual({ type: "run-status", status: "error" });
        expect(history).toEqual([]);
      }
    }
    expect(fixture.requests).toEqual([]);
    expect(fixture.executions).toEqual([]);
    expect(fixture.callMcp).not.toHaveBeenCalled();
    expect(fixture.approve).not.toHaveBeenCalled();
  });
});

describe("immutable run permissions", () => {
  it("refuses Ask mode escalation before a subsequent write", async () => {
    const { history } = await run([
      toolTurn(call("SwitchMode", { target_mode_id: "agent" }, "switch")),
      toolTurn(call("Write", { path: "a", contents: "bad" }, "write")), answer("Cannot edit in Ask mode."),
    ], { mode: "ask" });
    expect(fixture.executions).toEqual([]);
    expect(history.filter(s => s.kind === "tool-result")).toEqual(expect.arrayContaining([
      expect.objectContaining({ callId: "switch", status: "error", output: expect.stringContaining("permissions") }),
      expect.objectContaining({ callId: "write", status: "error" }),
    ]));
  });
  it("keeps custom children read-only and inherits disabled web tools", async () => {
    await run([
      toolTurn(call("Task", { prompt: "edit", readonly: true, subagent_type: "custom" }, "task")),
      toolTurn(call("Write", { path: "a", contents: "bad" }, "child-write"), call("WebFetch", { url: "https://example.com" }, "child-web")),
      answer("Child done"), answer("Done"),
    ], { mode: "ask", enableWebFetch: false, customSubagents: [{ name: "custom", readonly: false, prompt: "Edit", description: "edit", id: "custom" }] });
    expect(fixture.executions).toEqual([]);
    expect(fixture.requests[1].tools?.some(t => ["Write", "WebFetch"].includes(t.function.name))).toBe(false);
  });
  it("runs generic MCP calls through approval and beforeMcp hooks", async () => {
    const hook = vi.fn(async (event: string) => event === "beforeMcp" ? "blocked fixture" : undefined);
    await run([toolTurn(call("CallMcpTool", { server: "test", toolName: "write", arguments: { value: 1 } }, "mcp")), answer("Blocked")], { onHook: hook });
    expect(fixture.approve).toHaveBeenCalledWith("mcp__test__write", { value: 1 }, "mcp");
    expect(hook).toHaveBeenCalledWith('beforeMcp', { tool: "mcp__test__write", tool_input: '{"value":1}' }, "mcp__test__write", expect.any(AbortSignal));
    expect(fixture.callMcp).not.toHaveBeenCalled();
  });
  it("validates wrapped MCP arguments against the actual tool schema before requesting approval", async () => {
    vi.spyOn(mcpManager, "listTools").mockReturnValue([{ qualifiedName: "mcp__test__write", server: "test", tool: { name: "write", inputSchema: { type: "object", properties: { value: { type: "integer" } }, required: ["value"], additionalProperties: false } } }]);
    const { history } = await run([toolTurn(call("CallMcpTool", { server: "test", toolName: "write", arguments: { value: "invalid" } }, "bad-mcp")), answer("Blocked invalid call")]);
    expect(fixture.approve).not.toHaveBeenCalled(); expect(fixture.callMcp).not.toHaveBeenCalled();
    expect(history).toContainEqual(expect.objectContaining({ callId: "bad-mcp", status: "error", output: expect.stringContaining("invalid MCP arguments") }));
  });
  it("forwards bounded MCP images and structured data while using explicit error status", async () => {
    const image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jz1sAAAAASUVORK5CYII=";
    fixture.callMcp.mockResolvedValueOnce({ content: [{ type: "text", text: "error: is quoted diagnostic text" }, { type: "image", mimeType: "image/png", data: image }], structuredContent: { checked: true } });
    const journal = vi.fn(async () => {});
    const { history } = await run([toolTurn(call("mcp__test__write", {}, "rich-mcp")), answer("Observed result")], { onRunEvent: journal });
    expect(history).toContainEqual(expect.objectContaining({ callId: "rich-mcp", status: "completed", image: { mime: "image/png", base64: image }, output: expect.stringContaining('"checked":true') }));
    expect(JSON.stringify(fixture.requests[1].messages)).toContain(image);
    expect(journal).toHaveBeenCalledWith(expect.objectContaining({ type: "approval", data: expect.objectContaining({ callId: "rich-mcp", approved: true }) }));
  });
  it("honors the MCP permission hook and journals a veto before executing", async () => {
    const journal = vi.fn(async () => {});
    const hook = vi.fn(async (event: string) => event === "permissionRequest" ? "permission veto" : undefined);
    const { history } = await run([toolTurn(call("mcp__test__write", {}, "veto-mcp")), answer("Blocked")], { onHook: hook, onRunEvent: journal });
    expect(fixture.approve).not.toHaveBeenCalled(); expect(fixture.callMcp).not.toHaveBeenCalled();
    expect(history).toContainEqual(expect.objectContaining({ callId: "veto-mcp", status: "error", output: expect.stringContaining("permission veto") }));
    expect(journal).toHaveBeenCalledWith(expect.objectContaining({ type: "approval", data: expect.objectContaining({ approved: false, reason: "permission-hook" }) }));
  });
  it("does not dispatch a tool if Stop arrives while approval resolves", async () => {
    const abort = new AbortController();
    const { events } = await run([toolTurn(call("Write", { path: "a", contents: "bad" }, "write"))], {
      signal: abort.signal, approve: async () => { abort.abort(); return true; },
    });
    expect(fixture.executions).toEqual([]);
    expect(events).toContainEqual(expect.objectContaining({ type: "tool-call-completed", status: "error", result: expect.stringContaining("cancelled") }));
  });
});

describe("native file-edit hooks", () => {
  it("vetoes a permitted Write before mutation with native input", async () => {
    const hook = vi.fn(async (event: string) => event === "beforeEdit" ? "protected by hook" : undefined);
    const { history } = await run([toolTurn(call("Write", { path: "a.ts", contents: "new" }, "edit")), answer("Hook blocked the edit")], { onHook: hook });
    expect(hook).toHaveBeenCalledWith("beforeEdit", { path: "a.ts", tool_input: JSON.stringify({ path: "a.ts", contents: "new", file_path: "a.ts", content: "new" }) }, "Write", expect.any(AbortSignal));
    expect(fixture.executions).toEqual([]);
    expect(history).toContainEqual(expect.objectContaining({ kind: "tool-result", status: "error", output: "blocked by hook: protected by hook" }));
  });
});


it("passes the child cancellation signal into its blocking hook", async () => {
  const parent = new AbortController();
  const aborts = new Map<string, () => void>();
  let childSignal: AbortSignal | undefined;
  await run([
    toolTurn(call("Task", { prompt: "Run a check", description: "Check" }, "child")),
    toolTurn(call("Shell", { command: "echo check" }, "shell")), answer("Child stopped."),
  ], {
    signal: parent.signal, registerSubagentAbort: (id, abort) => { aborts.set(id, abort); },
    onBeforeShell: async (_command, signal) => { childSignal = signal; aborts.get("child")!(); return "cancelled"; },
  });
  expect(childSignal).not.toBe(parent.signal);
  expect(childSignal?.aborted).toBe(true);
  expect(parent.signal.aborted).toBe(false);
  expect(fixture.executions).toEqual([]);
});


describe("cache-safe loop and background scheduling", () => {
  it("keeps earlier serialized requests byte-for-byte across followups and changed editors", async () => {
    vi.spyOn(cursorContext, "buildUserInfoBlock").mockResolvedValue("Workspace rules: stay on main.");
    const editors = vi.spyOn(cursorContext, "buildOpenFilesBlock").mockResolvedValue("Open files: a.ts");
    const first = await run([toolTurn(call("Read", { path: "a.ts" }, "read")), answer("First answer")], { enableWorkspaceContext: true, promptCacheKey: "conversation" });
    const previous = JSON.parse(JSON.stringify(fixture.requests[1].messages)) as WireMessage[];
    const restored = JSON.parse(JSON.stringify(first.history)) as Step[];
    fixture.requests.length = 0; fixture.turns.length = 0;
    editors.mockResolvedValue("Open files: b.ts");
    const second = await run([answer("Second answer")], { history: restored, prompt: "Continue without testing", enableWorkspaceContext: true, promptCacheKey: "conversation" });
    expect(fixture.requests[0].messages.slice(0, previous.length)).toEqual(previous);
    expect(JSON.stringify(fixture.requests[0].messages)).toContain("Open files: b.ts");
    expect(JSON.stringify(fixture.requests[0].messages).match(/Workspace rules: stay on main/g)).toHaveLength(1);
    expectFinished(second.events, "Second answer", 1);
  });

  it("appends mid-run editor updates while leaving every earlier request intact", async () => {
    vi.spyOn(cursorContext, "buildOpenFilesBlock").mockResolvedValueOnce("Open files: original.ts").mockResolvedValue("Open files: changed.ts");
    const script = Array.from({ length: 7 }, (_, i) => toolTurn(call("Read", { path: `file-${i}` }, `read-${i}`)));
    const { events } = await run([...script, answer("Done")], { enableWorkspaceContext: true });
    for (let i = 1; i < fixture.requests.length; i++) {
      const previous = fixture.requests[i - 1].messages;
      expect(fixture.requests[i].messages.slice(0, previous.length)).toEqual(previous);
    }
    expect(JSON.stringify(fixture.requests[6].messages)).toContain("Editor context updated");
    expect(JSON.stringify(fixture.requests[6].messages)).not.toContain("<task_state>");
    expectFinished(events, "Done", 8);
  });

  it("continues useful parent work while a child runs and deduplicates its relaunch", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let childDone = false;
    const task = { prompt: "Inspect worker.ts", description: "Worker review", run_in_background: true };
    const { events, history } = await run([
      toolTurn(call("Task", task, "worker")),
      async request => {
        expect(request.promptCacheKey).toBe("conv/task/worker");
        await gate; childDone = true; return answer("Worker found no issue");
      },
      () => { expect(childDone).toBe(false); return toolTurn(call("Read", { path: "parent.ts" }, "parent-read")); },
      () => { expect(childDone).toBe(false); return toolTurn(call("Task", task, "duplicate")); },
      request => {
        expect(JSON.stringify(request.messages)).toContain("already running");
        release(); return answer("Waiting for review");
      },
      request => { expect(JSON.stringify(request.messages)).toContain("Worker found no issue"); return answer("Review integrated"); },
    ], { promptCacheKey: "conv" });
    expect(history).toContainEqual(expect.objectContaining({ kind: "tool-result", callId: "parent-read" }));
    expect(fixture.requests.filter(r => r.promptCacheKey?.includes("/task/"))).toHaveLength(1);
    expectFinished(events, "Review integrated", 6);
  });

  it("waits for new child evidence when the parent repeats retrieval and then resets the guard", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let childDone = false;
    const { history, events } = await run([
      toolTurn(call("Task", { prompt: "Investigate worker.ts", description: "Investigate worker", run_in_background: true }, "worker")),
      async () => { await gate; childDone = true; return answer("The child found the missing case."); },
      ...Array.from({ length: 9 }, (_, i) => () => {
        expect(childDone).toBe(false);
        if (i === 8) setTimeout(release, 0);
        return toolTurn(call("Read", { path: "parent.ts" }, `read-${i}`));
      }),
      request => {
        expect(childDone).toBe(true);
        expect(JSON.stringify(request.messages)).toContain("The child found the missing case.");
        return toolTurn(call("Read", { path: "parent.ts" }, "read-after-child"));
      },
      toolTurn(call("Read", { path: "parent.ts" }, "read-after-child-2")),
      answer("The missing case is now explained."),
    ], { maxSteps: 20 });
    expect(events).toContainEqual(expect.objectContaining({ type: "shell-notify", message: expect.stringContaining("Waiting for a result") }));
    expect(history.some(step => step.kind === "assistant" && step.text.startsWith("I paused"))).toBe(false);
    expectFinished(events, "The missing case is now explained.", 14);
  });

  it("resolves child model options and preserves parent restrictions in delegation", async () => {
    const apiKeyPool = new ApiKeyPool("provider", "https://example.test/v1", async () => ({ balance: "round-robin", credentials: [] }));
    const resolveModelOptions = vi.fn(() => ({ contextTokens: 32_000, modelParams: { reasoningEffort: "low" } }));
    const { events } = await run([
      toolTurn(call("Task", { prompt: "Inspect only", description: "Inspect", model: "small-model", readonly: true }, "child")),
      request => {
        expect(request.model).toBe("small-model");
        expect(request.modelParams).toEqual({ reasoningEffort: "low" });
        expect(request.maxTokens).toBeUndefined();
        expect(JSON.stringify(request.messages)).toContain("Do not run tests.");
        return answer("Inspected");
      },
      answer("Done"),
    ], { prompt: "Do not run tests.", modelParams: { reasoningEffort: "xhigh" }, maxTokens: 8192, availableModels: ["test-model", "small-model"], resolveModelOptions, apiKeyPool });
    for (const request of fixture.requests) expect(request.apiKeyPool).toBe(apiKeyPool);
    expect(resolveModelOptions).toHaveBeenCalledWith("small-model");
    expectFinished(events, "Done", 3);
  });

  it("updates the system instructions when narrowing mode and blocks unavailable MCP calls", async () => {
    const { events } = await run([
      toolTurn(call("SwitchMode", { target_mode_id: "plan" }, "switch")),
      request => {
        expect(JSON.stringify(request.messages[0])).toContain("plan mode");
        return toolTurn(call("mcp__browser__open", {}, "missing"));
      },
      toolTurn(call("WritePlan", { title: "Plan", content: "Read the code" }, "plan")),
      answer("Plan saved"),
    ]);
    expect(fixture.callMcp).not.toHaveBeenCalled();
    expectFinished(events, "Plan saved", 4);
  });

  it("does not execute or request approval for absent MCP namespaces", async () => {
    const { history, events } = await run([
      toolTurn(call("mcp__browser__open", {}, "missing"), call("mcp__browser__navigate", {}, "missing-alias")),
      toolTurn(call("ReadContext", { id: "capabilities" }, "inventory")),
      answer("Browser unavailable"),
    ]);
    expect(fixture.callMcp).not.toHaveBeenCalled();
    expect(history).toContainEqual(expect.objectContaining({ callId: "missing-alias", output: expect.stringContaining("Unknown or unavailable tool") }));
    expect(fixture.approve).not.toHaveBeenCalled();
    expect(history).toContainEqual(expect.objectContaining({ callId: "missing", output: expect.stringContaining("Unknown or unavailable tool") }));
    expect(history).toContainEqual(expect.objectContaining({ callId: "inventory", output: expect.stringContaining("Connected MCP namespaces: test") }));
    expectFinished(events, "Browser unavailable", 3);
  });

  it("executes IDE-suffixed built-ins with canonical names and validates their arguments", async () => {
    const { history, events } = await run([
      request => {
        expect(request.tools?.some(tool => tool.function.name === "Read")).toBe(true);
        expect(request.tools?.some(tool => tool.function.name.endsWith("_ide"))).toBe(false);
        return [
          { type: "tool-call-start", index: 0, id: "read-alias", name: "Read_ide_ide" },
          ...toolTurn(call("Read_ide_ide", { path: "file.ts" }, "read-alias"), call("Read_ide", {}, "bad-alias")),
        ];
      },
      answer("Read complete"),
    ]);
    expect(fixture.executions.filter(tool => tool.name === "Read")).toEqual([{ name: "Read", input: { path: "file.ts" } }]);
    expect(history).toContainEqual(expect.objectContaining({ callId: "read-alias", name: "Read", status: "completed" }));
    expect(history).toContainEqual(expect.objectContaining({ callId: "bad-alias", status: "error", output: expect.stringContaining("path") }));
    const toolEvents = events.filter(event => event.type === "tool-call-started" || event.type === "tool-call-completed");
    expect(toolEvents.length).toBeGreaterThan(0);
    expect(toolEvents.every(event => "name" in event && event.name === "Read")).toBe(true);
    const assistant = history.find(step => step.kind === "assistant" && step.calls?.length);
    expect(assistant?.kind === "assistant" && assistant.calls?.every(call => call.name === "Read")).toBe(true);
    expectFinished(events, "Read complete", 2);
  });
});


describe("background task lifecycle and registry changes", () => {
  it("reports a child's internal provider failure to its parent", async () => {
    const { history, events } = await run([
      toolTurn(call("Task", { prompt: "Review the change", description: "Review" }, "failed-review")),
      () => { throw new Error("Review provider unavailable"); },
      request => {
        expect(JSON.stringify(request.messages)).toContain("subagent failed: Review provider unavailable");
        return answer("Review remains blocked");
      },
    ]);
    expect(history).toContainEqual(expect.objectContaining({ callId: "failed-review", output: expect.stringContaining("subagent failed") }));
    expectFinished(events, "Review remains blocked", 3);
  });

  it("cancels owned background children before returning a cancelled parent", async () => {
    const controller = new AbortController();
    let childSignal: AbortSignal | undefined;
    const { history, events } = await run([
      toolTurn(call("Task", { prompt: "Review", description: "Review", run_in_background: true }, "worker")),
      async request => {
        childSignal = request.signal;
        await new Promise<void>(resolve => request.signal.addEventListener("abort", () => resolve(), { once: true }));
        return answer("Cancelled child");
      },
      () => { controller.abort(); return answer("Stopping"); },
    ], { signal: controller.signal });
    expect(childSignal?.aborted).toBe(true);
    expect(events).toContainEqual({ type: "run-status", status: "cancelled" });
    expect(events.some(e => e.type === "run-result")).toBe(false);
    expect(history).toContainEqual(expect.objectContaining({ synthetic: true, text: expect.stringContaining("cancelled") }));
  });

  it("bounds active background launches without preventing useful parent work", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const child = async () => { await gate; return answer("Child result"); };
    const { history, events } = await run([
      toolTurn(...Array.from({ length: 5 }, (_, i) => call("Task", { prompt: `Review part ${i}`, description: `Part ${i}`, run_in_background: true }, `child-${i}`))),
      child, child, child, child,
      request => {
        expect(JSON.stringify(request.messages)).toContain("4 collaborators are already running");
        release(); return toolTurn(call("Read", { path: "integration.ts" }, "parent-read"));
      },
      ...Array.from({ length: 5 }, () => answer("All results integrated")),
    ]);
    expect(fixture.requests.filter(r => r.promptCacheKey?.includes("/task/"))).toHaveLength(4);
    expect(history).toContainEqual(expect.objectContaining({ callId: "parent-read", status: "completed" }));
    expect(events.filter(e => e.type === "error")).toEqual([]);
    expect(events).toContainEqual(expect.objectContaining({ type: "run-result", text: "All results integrated" }));
  });

  it("refreshes a previously absent namespace after the connection registry changes", async () => {
    const list = vi.spyOn(mcpManager, "listTools").mockReturnValue([]);
    const { history, events } = await run([
      toolTurn(call("mcp__browser__open", {}, "missing")),
      () => {
        list.mockReturnValue([{ qualifiedName: "mcp__browser__open", server: "browser", tool: { name: "open", inputSchema: {} } }] as ReturnType<typeof mcpManager.listTools>);
        return toolTurn(call("ReadContext", { id: "capabilities" }, "refresh"));
      },
      request => {
        expect(request.tools?.some(t => t.function.name === "mcp__browser__open")).toBe(true);
        expect(JSON.stringify(request.messages)).toContain("Connected MCP namespaces: browser");
        return toolTurn(call("mcp__browser__open", {}, "available"));
      },
      answer("Browser tool completed"),
    ]);
    expect(fixture.callMcp).toHaveBeenCalledOnce();
    expect(history).toContainEqual(expect.objectContaining({ callId: "missing", status: "error" }));
    expect(history).toContainEqual(expect.objectContaining({ callId: "available", status: "completed" }));
    expectFinished(events, "Browser tool completed", 4);
  });
});

describe("persistent collaborators, steering and goal evidence", () => {
  it("resumes a saved collaborator with its identity, history and read-only ceiling", async () => {
    const contextState: NonNullable<RunAgentOptions["contextState"]> = {};
    const first = await run([
      toolTurn(call("Task", { prompt: "Inspect the parser", description: "Parser review", readonly: true }, "reviewer")),
      answer("The original finding was an unchecked index."),
      answer("Review recorded."),
    ], { contextState, promptCacheKey: "persistent" });
    expect(contextState.agents).toHaveLength(1);
    expect(contextState.agents![0]).toMatchObject({ id: "reviewer", status: "completed", readonly: true });
    const saved = JSON.parse(JSON.stringify({ history: first.history, contextState }));
    const second = await run([
      toolTurn(call("Task", { prompt: "Check whether that finding remains", description: "Continue review", resume: "reviewer", readonly: false }, "resume-reviewer")),
      request => {
        expect(request.promptCacheKey).toBe("persistent/task/reviewer");
        expect(JSON.stringify(request.messages)).toContain("The original finding was an unchecked index.");
        expect(JSON.stringify(request.messages)).toContain("Check whether that finding remains");
        expect(request.tools?.map(tool => tool.function.name)).not.toContain("Write");
        return answer("The original finding is resolved.");
      },
      toolTurn(call("ListAgents", {}, "registry")),
      answer("Follow-up recorded."),
    ], { ...saved, prompt: "Continue the review", promptCacheKey: "persistent" });
    expect(saved.contextState.agents).toHaveLength(1);
    expect(saved.contextState.agents[0]).toMatchObject({ id: "reviewer", readonly: true, status: "completed", result: "The original finding is resolved." });
    expect(second.history).toContainEqual(expect.objectContaining({ callId: "registry", output: expect.stringContaining('"id":"reviewer"') }));
    expectFinished(second.events, "Follow-up recorded.", 7);
  });

  it("queues a message for an idle collaborator without silently starting another run", async () => {
    const contextState: NonNullable<RunAgentOptions["contextState"]> = { agents: [{ id: "saved-agent", title: "Review", model: "test-model", readonly: true,
      status: "running", history: [{ kind: "assistant", calls: [], text: "Previous evidence" }], mailbox: [], updatedAt: 1 }] };
    const { history, events } = await run([
      toolTurn(call("SendAgentMessage", { id: "saved-agent", message: "Check the changed assertion" }, "message")),
      toolTurn(call("ListAgents", {}, "list")),
      answer("Message queued for the interrupted collaborator."),
    ], { contextState });
    expect(contextState.agents![0]).toMatchObject({ status: "interrupted", mailbox: ["Check the changed assertion"] });
    expect(history).toContainEqual(expect.objectContaining({ callId: "list", output: expect.stringContaining('"queuedMessages":1') }));
    expect(fixture.requests.filter(request => request.promptCacheKey?.includes("/task/"))).toHaveLength(0);
    expectFinished(events, "Message queued for the interrupted collaborator.", 3);
  });

  it("delivers running collaborator messages at its next safe boundary without restarting it", async () => {
    let release!: () => void, observed!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const delivery = new Promise<void>(resolve => { observed = resolve; });
    const contextState: NonNullable<RunAgentOptions["contextState"]> = {};
    const { events } = await run([
      toolTurn(call("Task", { prompt: "Review worker.ts", description: "Worker", run_in_background: true }, "worker")),
      async () => { await gate; return toolTurn(call("Read", { path: "worker.ts" }, "child-read")); },
      toolTurn(call("SendAgentMessage", { id: "worker", message: "Also inspect the cancellation branch" }, "steer-child")),
      async () => { release(); await delivery; return toolTurn(call("WaitForAgent", { id: "worker", timeout_ms: 1000 }, "await-child")); },
      request => {
        try { expect(JSON.stringify(request.messages)).toContain("Parent agent message:\\nAlso inspect the cancellation branch"); }
        finally { observed(); }
        return answer("Cancellation branch inspected.");
      },
      answer("The review includes cancellation."),
    ], { contextState });
    expect(contextState.agents).toHaveLength(1);
    expect(contextState.agents![0]).toMatchObject({ status: "completed", mailbox: [], result: "Cancellation branch inspected." });
    expect(fixture.requests.filter(request => request.promptCacheKey?.includes("/task/"))).toHaveLength(2);
    expectFinished(events, "The review includes cancellation.", 6);
  });

  it("appends user steering before the next request while preserving prior evidence", async () => {
    const steering: string[] = [];
    const onRunEvent = vi.fn(async () => {});
    const { history, events } = await run([
      () => { steering.push("Keep the public API unchanged; inspect only."); return toolTurn(call("Read", { path: "api.ts" }, "read-api")); },
      request => {
        expect(JSON.stringify(request.messages)).toContain("Keep the public API unchanged; inspect only.");
        expect(request.messages).toContainEqual(expect.objectContaining({ role: "tool", tool_call_id: "read-api", content: "file contents" }));
        return answer("Inspected the API without changing it.");
      },
    ], { drainSteering: () => steering.splice(0), onRunEvent });
    expect(history.filter(step => step.kind === "user" && step.text === "Keep the public API unchanged; inspect only.")).toHaveLength(1);
    expect(onRunEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "steering", data: expect.objectContaining({ text: "Keep the public API unchanged; inspect only." }) }));
    expect(fixture.executions.map(item => item.name)).toEqual(["Read"]);
    expectFinished(events, "Inspected the API without changing it.", 2);
  });

  it("continues the same run when steering arrives during an otherwise final answer", async () => {
    const steering: string[] = [];
    const controller = new AbortController();
    const onRunEvent = vi.fn(async (_event: { type: string }) => {});
    const text = "Also explain the cancellation behavior.";
    const { history, events } = await run([
      request => {
        expect(request.signal).toBe(controller.signal);
        steering.push(text);
        return answer("The first explanation is complete.");
      },
      request => {
        expect(request.signal).toBe(controller.signal);
        expect(request.signal.aborted).toBe(false);
        expect(request.messages).toContainEqual(expect.objectContaining({ role: "assistant", content: "The first explanation is complete." }));
        expect(request.messages.at(-1)?.role).toBe("user");
        expect(JSON.stringify(request.messages.at(-1)?.content)).toContain(text);
        return answer("Cancellation preserves the completed work.");
      },
    ], { runId: "steered-run", signal: controller.signal, drainSteering: async () => { await Promise.resolve(); return steering.splice(0); }, onRunEvent });
    expect(history.filter(step => step.kind === "user" && step.text === text)).toHaveLength(1);
    expect(onRunEvent.mock.calls.filter(([event]) => event.type === "steering")).toHaveLength(1);
    expect(onRunEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "steering", data: { text, runId: "steered-run" } }));
    expect(events.filter(event => event.type === "run-status")).toEqual([
      { type: "run-status", status: "running" }, { type: "run-status", status: "finished" },
    ]);
    expect(history.some(step => step.kind === "user" && step.synthetic && step.text.includes("user stopped"))).toBe(false);
    expectFinished(events, "Cancellation preserves the completed work.", 2);
  });

  it("lets an active tool finish before applying steering exactly once", async () => {
    const steering: string[] = [];
    const text = "Use the result to explain the API; do not edit it.";
    vi.spyOn(TOOLS.Read, "execute").mockImplementationOnce(async (_input, signal) => {
      expect(signal?.aborted).toBe(false);
      steering.push(text);
      await Promise.resolve();
      expect(signal?.aborted).toBe(false);
      return { output: "complete API source" };
    });
    const { history, events } = await run([
      toolTurn(call("Read", { path: "api.ts" }, "active-read")),
      request => {
        expectCompleteToolGroups(request.messages);
        const resultIndex = request.messages.findIndex(message => message.role === "tool" && message.tool_call_id === "active-read");
        expect(request.messages[resultIndex]).toEqual(expect.objectContaining({ content: "complete API source" }));
        expect(request.messages[resultIndex + 1]?.role).toBe("user");
        expect(JSON.stringify(request.messages[resultIndex + 1]?.content)).toContain(text);
        return answer("The API is read-only for this task.");
      },
    ], { drainSteering: () => steering.splice(0) });
    expect(history.filter(step => step.kind === "user" && step.text === text)).toHaveLength(1);
    expect(events.filter(event => event.type === "run-status" && event.status === "cancelled")).toEqual([]);
    expectFinished(events, "The API is read-only for this task.", 2);
  });

  it("keeps late steering queued when the step ceiling prevents another request", async () => {
    const steering: string[] = [];
    const text = "Inspect the second file next.";
    const { history, events } = await run([
      () => { steering.push(text); return toolTurn(call("Read", { path: "first.ts" }, "limited-read")); },
    ], { maxSteps: 1, drainSteering: () => steering.splice(0) });
    expect(steering).toEqual([text]);
    expect(history.some(step => step.kind === "user" && step.text === text)).toBe(false);
    expect(events).toContainEqual({ type: "max-steps", steps: 1 });
    expect(fixture.requests).toHaveLength(1);
  });

  it("does not drain steering after cancellation or start a request during steering persistence", async () => {
    const steering = ["Keep this follow-up queued."];
    const controller = new AbortController();
    controller.abort();
    await run([], { signal: controller.signal, drainSteering: () => steering.splice(0) });
    expect(steering).toEqual(["Keep this follow-up queued."]);
    expect(fixture.requests).toHaveLength(0);

    const active = new AbortController();
    const pending = ["Apply this direction."];
    const { history, events } = await run([], {
      signal: active.signal, drainSteering: () => pending.splice(0),
      onRunEvent: async event => { if (event.type === "steering") active.abort(); },
    });
    expect(history.filter(step => step.kind === "user" && step.text === "Apply this direction.")).toHaveLength(1);
    expect(fixture.requests).toHaveLength(0);
    expect(events).toContainEqual({ type: "run-status", status: "cancelled" });
  });

  it.each(["cancellation", "budget"])("leaves durable steering pending when %s wins during mailbox flush", async reason => {
    const pending = ["Inspect this after saving the mailbox."];
    const controller = new AbortController();
    let exhausted = false;
    const onRunEvent = vi.fn(async (_event: { type: string }) => {});
    const { history } = await run([], {
      signal: controller.signal, budgetExhausted: () => exhausted, onRunEvent,
      drainSteering: async () => {
        await Promise.resolve();
        if (reason === "cancellation") controller.abort();
        else exhausted = true;
        return pending.slice();
      },
    });
    expect(history.some(step => step.kind === "user" && step.text === pending[0])).toBe(false);
    expect(onRunEvent.mock.calls.filter(([event]) => event.type === "steering")).toHaveLength(0);
    expect(fixture.requests).toHaveLength(0);
  });

  it("stops before another provider request when observed usage consumes the goal budget", async () => {
    const onGoalUsage = vi.fn(), onGoalStatus = vi.fn();
    const { history, events } = await run([
      [...toolTurn(call("Read", { path: "bounded.ts" }, "bounded-read")), { type: "usage", promptTokens: 8, completionTokens: 2 }],
    ], { goal: { objective: "Inspect bounded.ts", status: "active", tokenBudget: 100, tokensUsed: 95 }, onGoalUsage, onGoalStatus });
    expect(fixture.requests).toHaveLength(1);
    expect(onGoalUsage).toHaveBeenCalledWith(10);
    expect(onGoalStatus).toHaveBeenCalledWith("budgetLimited");
    expect(history).toContainEqual(expect.objectContaining({ callId: "bounded-read", status: "error", output: expect.stringContaining("budget exhausted") }));
    expect(fixture.executions).toHaveLength(0);
    expect(events).toContainEqual(expect.objectContaining({ type: "run-result", text: expect.stringContaining("105/100") }));
  });

  it("shares the observed token ceiling with a running child before it executes mutations", async () => {
    const onGoalStatus = vi.fn();
    const { history } = await run([
      toolTurn(call("Task", { prompt: "Implement the change", description: "Bounded child" }, "bounded-child")),
      [...toolTurn(call("Write", { path: "must-not-change.ts", contents: "unsafe after budget" }, "child-write")), { type: "usage", promptTokens: 8, completionTokens: 2 }],
    ], { goal: { objective: "Bounded collaboration", status: "active", tokenBudget: 100, tokensUsed: 95 }, onGoalStatus });
    expect(fixture.requests).toHaveLength(2);
    expect(fixture.executions.some(item => item.name === "Write")).toBe(false);
    expect(history).toContainEqual(expect.objectContaining({ callId: "bounded-child", output: expect.stringContaining("parent goal token budget") }));
    expect(onGoalStatus).toHaveBeenCalledWith("budgetLimited");
  });

  it("does not complete a goal while its observed verification check is failing", async () => {
    vi.spyOn(TOOLS.Shell, "execute").mockResolvedValueOnce({ output: "Assertion failed", outcome: { status: "failed", exitCode: 1 } });
    const onGoalStatus = vi.fn();
    const goal = { objective: "Fix the failing test", status: "active", tokensUsed: 0 };
    const { history, events } = await run([
      toolTurn(call("RunChecks", { command: "node fixture-check.cjs" }, "check")),
      toolTurn(call("GetVerificationEvidence", {}, "evidence"), call("UpdateGoal", { status: "complete" }, "premature-completion")),
      answer("The check still fails; the goal remains incomplete."),
    ], { goal, onGoalStatus });
    expect(goal.status).toBe("active"); expect(onGoalStatus).not.toHaveBeenCalled();
    expect(history).toContainEqual(expect.objectContaining({ callId: "evidence", output: expect.stringContaining('"status":"checks-failed"') }));
    expect(history).toContainEqual(expect.objectContaining({ callId: "premature-completion", status: "error", output: expect.stringContaining("verification checks are failing") }));
    expectFinished(events, "The check still fails; the goal remains incomplete.", 3);
  });

  it("reports a failed TodoWrite honestly and does not synthesize successful task state", async () => {
    vi.spyOn(TOOLS.TodoWrite, "execute").mockRejectedValueOnce(new Error("Todo storage failed"));
    const contextState: NonNullable<RunAgentOptions["contextState"]> = {};
    const { history, events } = await run([
      toolTurn(call("TodoWrite", { todos: [{ id: "work", content: "Fix the bug", status: "completed" }] }, "failed-todo")),
      answer("The task list could not be saved."),
    ], { contextState });
    expect(history).toContainEqual(expect.objectContaining({ callId: "failed-todo", status: "error", output: expect.stringContaining("Todo storage failed") }));
    expect(contextState.todos ?? []).toEqual([]);
    expectFinished(events, "The task list could not be saved.", 2);
  });
});

describe("optional built-in schema discovery", () => {
  function schemaReference(request: StreamChatOpts, callId: string, name: string): string {
    const result = request.messages.find(message => message.role === "tool" && message.tool_call_id === callId);
    const body = result?.role === "tool" ? String(result.content) : "";
    const line = body.split("\n").find(value => value.startsWith(`${name} —`));
    const id = line?.match(/ReadContext \{"id":"([^"]+)"\}/)?.[1];
    expect(id, `catalog reference for ${name}`).toBeDefined();
    return id!;
  }

  it("keeps optional schemas out of the baseline, activates one on read and restores a used schema", async () => {
    const names = (request: StreamChatOpts) => request.tools?.map(tool => tool.function.name) ?? [];
    const execute = vi.spyOn(TOOLS.GetGoal, "execute");
    const first = await run([
      request => {
        expect(names(request).filter(name => OPTIONAL_BUILTIN_TOOLS.has(name))).toEqual([]);
        expect(names(request)).toEqual(expect.arrayContaining(["Task", "Shell", "Read", "ReadContext"]));
        expect(JSON.stringify(request.messages)).toContain('id\\\":\\\"tools');
        return toolTurn(call("ReadContext", { id: "tools", pattern: "GetGoal" }, "find-goal"));
      },
      request => {
        expect(names(request)).not.toContain("GetGoal");
        return toolTurn(call("ReadContext", { id: schemaReference(request, "find-goal", "GetGoal") }, "load-goal"));
      },
      request => {
        expect(names(request).filter(name => OPTIONAL_BUILTIN_TOOLS.has(name))).toEqual(["GetGoal"]);
        expect(execute).not.toHaveBeenCalled();
        return toolTurn(call("GetGoal", {}, "read-goal"));
      },
      answer("No goal is configured."),
    ], { promptCacheKey: "deferred-builtins" });
    expectFinished(first.events, "No goal is configured.", 4);
    const second = await run([
      request => {
        expect(names(request).filter(name => OPTIONAL_BUILTIN_TOOLS.has(name))).toEqual(["GetGoal"]);
        return answer("The goal tool is available for this follow-up.");
      },
    ], { history: JSON.parse(JSON.stringify(first.history)), prompt: "Continue", promptCacheKey: "deferred-builtins" });
    expectFinished(second.events, "The goal tool is available for this follow-up.", 5);
  });

  it("loading an interactive tool schema cannot expand a narrowed mode's permissions", async () => {
    const { events, history } = await run([
      toolTurn(call("ReadContext", { id: "tools", pattern: "WriteStdin" }, "find-stdin")),
      request => toolTurn(call("ReadContext", { id: schemaReference(request, "find-stdin", "WriteStdin") }, "load-stdin")),
      toolTurn(call("SwitchMode", { target_mode_id: "plan" }, "narrow")),
      request => {
        expect(request.tools?.map(tool => tool.function.name)).not.toContain("WriteStdin");
        return toolTurn(call("WriteStdin", { shell_id: "other", chars: "echo unapproved\r" }, "blocked-stdin"));
      },
      toolTurn(call("WritePlan", { title: "Plan", content: "Inspect before executing." }, "save-plan")),
      answer("The plan remains read-only."),
    ]);
    expect(history).toContainEqual(expect.objectContaining({ callId: "blocked-stdin", status: "error", output: expect.stringContaining("not allowed in plan mode") }));
    expect(fixture.executions.some(item => item.name === "WriteStdin")).toBe(false);
    expect(fixture.approve.mock.calls.some(([name]) => name === "WriteStdin")).toBe(false);
    expectFinished(events, "The plan remains read-only.", 6);
  });

  it("does not advertise or activate disabled host tools even if an earlier run used them", async () => {
    const previous: Step[] = [{ kind: "user", text: "Previous request" },
      { kind: "assistant", text: "", calls: [call("WriteStdin", { shell_id: "old" }, "old-stdin")] },
      { kind: "tool-result", callId: "old-stdin", name: "WriteStdin", output: "Previous session completed", status: "completed" }];
    const { history, events } = await run([
      request => {
        expect(request.tools?.map(tool => tool.function.name)).not.toContain("WriteStdin");
        return toolTurn(call("ReadContext", { id: "tools", pattern: "WriteStdin" }, "find-disabled"));
      },
      answer("Interactive input is disabled for this run."),
    ], { history: previous, unavailableTools: ["WriteStdin"] });
    expect(history).toContainEqual(expect.objectContaining({ callId: "find-disabled", output: expect.stringContaining("No literal match") }));
    expectFinished(events, "Interactive input is disabled for this run.", 2);
  });
});
