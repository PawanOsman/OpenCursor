/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderEvent, ToolSchema, WireMessage } from "../types";
import { listProviderAdapterModels, streamAccountAdapter, streamProviderAdapter, type ProviderChatOptions } from "./providerTransport";

const tool: ToolSchema = { type: "function", function: { name: "Read", description: "Read file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } };
const base = (): ProviderChatOptions => ({ providerId: "deepseek", model: "deepseek-v4-pro-max", credentials: { apiKey: "fixture-key" }, messages: [{ role: "user", content: "Read file" }], tools: [tool], signal: new AbortController().signal });
const sse = (frames: unknown[]) => new Response(frames.map(frame => `data: ${typeof frame === "string" ? frame : JSON.stringify(frame)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
const finish = { choices: [{ delta: {}, finish_reason: "stop" }] };
const completed = () => sse([finish, "[DONE]"]);
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
async function collect(options = base(), events: ProviderEvent[] = []) { for await (const event of streamProviderAdapter(options)) events.push(event); return events; }
function mockFetch(response: () => Response = completed) { const spy = vi.fn(async () => response()); vi.stubGlobal("fetch", spy); return spy; }
const posted = (spy: ReturnType<typeof mockFetch>, index = 0): any => JSON.parse((spy.mock.calls[index] as unknown as [string, RequestInit])[1].body as string);
function crc32(bytes: Uint8Array) { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; }
function awsFrame(type: string, payload: unknown): Buffer {
  const name = Buffer.from(":event-type"); const value = Buffer.from(type);
  const headers = Buffer.concat([Buffer.from([name.length]), name, Buffer.from([7, value.length >>> 8, value.length & 255]), value]);
  const data = Buffer.from(JSON.stringify(payload)); const frame = Buffer.alloc(16 + headers.length + data.length);
  frame.writeUInt32BE(frame.length, 0); frame.writeUInt32BE(headers.length, 4); frame.writeUInt32BE(crc32(frame.subarray(0, 8)), 8);
  headers.copy(frame, 12); data.copy(frame, 12 + headers.length); frame.writeUInt32BE(crc32(frame.subarray(0, -4)), frame.length - 4); return frame;
}
function proto(field: number, value: string | Buffer) { const bytes = Buffer.from(value); return Buffer.concat([Buffer.from([(field << 3) | 2, bytes.length]), bytes]); }
function connectFrame(payload: Buffer) { const prefix = Buffer.alloc(5); prefix.writeUInt32BE(payload.length, 1); return Buffer.concat([prefix, payload]); }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("real provider protocol requests", () => {
  it.each([['deepseek-v4-pro-max', 'enabled', 'max'], ['deepseek-v4-pro-none', 'disabled', undefined]])("preserves DeepSeek alias intent: %s", async (model, thinking, effort) => {
    const fetch = mockFetch(); await collect({ ...base(), model: model! });
    expect(posted(fetch)).toMatchObject({ model: "deepseek-v4-pro", thinking: { type: thinking } });
    expect(posted(fetch).reasoning_effort).toBe(effort);
    expect(posted(fetch).extra_body).toBeUndefined();
  });
  it("normalizes Azure v1 configuration to its deployment endpoint and api-key auth", async () => {
    const fetch = mockFetch(); await collect({ ...base(), providerId: "azure", model: "gpt-6-sol", baseUrl: "https://tenant.openai.azure.com/openai/v1" });
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe("https://tenant.openai.azure.com/openai/deployments/gpt-6-sol/chat/completions?api-version=2024-10-01-preview");
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ "api-key": "fixture-key" });
  });
  it("routes Ollama cloud to its native NDJSON /api/chat protocol", async () => {
    const fetch = mockFetch(() => new Response([JSON.stringify({ message: { content: "Hello" }, done: false }), JSON.stringify({ done: true, done_reason: "stop", prompt_eval_count: 3, eval_count: 2 })].join("\n"), { headers: { "content-type": "application/x-ndjson" } }));
    const events = await collect({ ...base(), providerId: "ollama", model: "qwen3-coder:480b-cloud", baseUrl: "https://ollama.com" });
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe("https://ollama.com/api/chat");
    expect(events).toContainEqual({ type: "text-delta", text: "Hello" });
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });
  it("uses OpenAI transport for GLM standard models", async () => {
    const fetch = mockFetch(); await collect({ ...base(), providerId: "glm", model: "glm-5.3", baseUrl: "https://api.z.ai/api/coding/paas/v4" });
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe("https://api.z.ai/api/coding/paas/v4/chat/completions");
  });
  it("retains explicit Claude transport endpoint for MiniMax native model", async () => {
    const fetch = mockFetch(() => sse([{ type: "message_start", message: { id: "m", model: "MiniMax-M3", usage: { input_tokens: 3 } } }, { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } }, { type: "message_stop" }]));
    await collect({ ...base(), providerId: "minimax", model: "MiniMax-M3", baseUrl: "https://api.minimax.io/v1" });
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toContain("/anthropic/v1/messages");
  });
  it("preserves requested Grok CLI effort alias before executor normalization", async () => {
    const fetch = mockFetch(() => sse([{ type: "response.completed", response: { id: "r", status: "completed", output: [] } }]));
    await collect({ ...base(), providerId: "grok-cli", model: "grok-4.5-low", credentials: { accessToken: "fixture" }, tools: [] });
    expect(posted(fetch)).toMatchObject({ model: "grok-4.5", reasoning: { effort: "low" } });
  });
  it("converts CommandCode NDJSON including executable tool completion", async () => {
    const fetch = mockFetch(() => new Response([{ type: "tool-call", toolCallId: "call", toolName: "Read", input: { path: "x" } }, { type: "finish-step", finishReason: "tool-calls" }, { type: "finish", finishReason: "tool-calls" }].map(value => JSON.stringify(value)).join("\n")));
    const events = await collect({ ...base(), providerId: "commandcode", model: "command-code" });
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe("https://api.commandcode.ai/alpha/generate");
    expect(events).toContainEqual({ type: "tool-call", call: { id: "call", name: "Read", arguments: '{"path":"x"}' } });
  });
  it("preserves Kiro synthetic thinking/agentic intent and decodes CRC-checked AWS EventStream", async () => {
    const fetch = mockFetch(() => new Response(Buffer.concat([awsFrame("assistantResponseEvent", { content: "The fixture completed successfully." }), awsFrame("messageStopEvent", { stopReason: "end_turn" })]), { headers: { "content-type": "application/vnd.amazon.eventstream" } }));
    const events = await collect({ ...base(), providerId: "kiro", model: "gpt-5.6-sol-thinking-agentic", credentials: { id: "kiro-fixture", accessToken: "fixture", providerSpecificData: { authMethod: "api_key" } } });
    const request = posted(fetch);
    expect(request.conversationState.currentMessage.userInputMessage.modelId).toBe("gpt-5.6-sol");
    expect(request.conversationState.currentMessage.userInputMessage.content).toContain("<thinking_mode>enabled</thinking_mode>");
    expect(request.conversationState.currentMessage.userInputMessage.content.length).toBeGreaterThan(100);
    expect(events).toContainEqual({ type: "text-delta", text: "The fixture completed successfully." });
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });
  it("preserves genuine Gemini CLI tool signatures in its project envelope", async () => {
    const fetch = mockFetch(() => sse([{ response: { candidates: [{ content: { parts: [{ text: "Done" }] }, finishReason: "STOP" }] } }]));
    const messages: WireMessage[] = [{ role: "assistant", content: "", tool_calls: [{ id: "call", type: "function", function: { name: "Read", arguments: '{"path":"x"}' }, thoughtSignature: "original-google-signature" }] }, { role: "tool", tool_call_id: "call", content: "Contents" }];
    const events = await collect({ ...base(), providerId: "gemini-cli", model: "gemini-3-flash-preview", messages, credentials: { accessToken: "fixture", projectId: "own-project" } });
    expect(posted(fetch)).toMatchObject({ project: "own-project", model: "gemini-3-flash-preview" });
    expect(JSON.stringify(posted(fetch).request)).toContain("original-google-signature");
    expect(events).toContainEqual({ type: "text-delta", text: "Done" });
  });
  it("emits Claude thinking separately without visible think-tag markup", async () => {
    mockFetch(() => sse([{ type: "message_start", message: { id: "m", model: "MiniMax-M3", usage: {} } }, { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }, { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Plan" } }, { type: "content_block_stop", index: 0 }, { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: {} }, { type: "message_stop" }]));
    const events = await collect({ ...base(), providerId: "minimax", model: "MiniMax-M3" });
    expect(events).toContainEqual({ type: "thinking-delta", text: "Plan" });
    expect(events.filter(event => event.type === "text-delta")).toEqual([]);
  });
  it("sends only caller-declared tools through OpenCode Zen free models", async () => {
    const fetch = mockFetch(); await collect({ ...base(), providerId: "opencode-zen", model: "big-pickle" });
    expect(posted(fetch).tools.map((entry: any) => entry.function.name)).toEqual(["Read"]);
  });
  it("keeps self-hosted GitLab credentials on their saved instance", async () => {
    const fetch = mockFetch(); for await (const _event of streamAccountAdapter(base(), { id: "gl", kind: "gitlab", accessToken: "self-hosted-secret", providerSpecificData: { baseUrl: "https://git.example.test/" } })) { /* consume */ }
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe("https://git.example.test/api/v4/chat/completions");
  });
  it.each([true, false])("decodes Cursor AgentService binary frames and rejects premature EOF: terminal %s", async terminal => {
    const modulePath = "./protocols/executors/cursor.js";
    const { CursorExecutor } = await import(modulePath);
    const frames = [connectFrame(proto(1, proto(1, proto(1, "Cursor answer"))))];
    if (terminal) frames.push(connectFrame(proto(1, proto(14, Buffer.alloc(0)))));
    const write = vi.fn(); const close = vi.fn();
    vi.spyOn(CursorExecutor.prototype, "openAgentHttp2Stream").mockImplementation(() => ({ responseHeaders: Promise.resolve({ ":status": 200 }), write, end: vi.fn(), close, read: async () => frames.length ? { done: false, value: frames.shift() } : { done: true } }));
    const fetch = mockFetch(); const options = { ...base(), providerId: "cursor", model: "claude-4.6-sonnet", credentials: { id: "cursor", accessToken: "fixture", providerSpecificData: { machineId: "fixture-machine" } } };
    const events: ProviderEvent[] = [];
    if (terminal) { await collect(options, events); expect(events.at(-1)).toMatchObject({ type: "done" }); }
    else await expect(collect(options, events)).rejects.toMatchObject({ retryable: false });
    expect(events).toContainEqual({ type: "text-delta", text: "Cursor answer" });
    expect(write).toHaveBeenCalled(); expect(close).toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    expect(Buffer.from(write.mock.calls[0][0]).includes(Buffer.from("Read"))).toBe(true);
  });
});

describe("buffered Cursor response completion", () => {
  it.each(["transformProtobufToJSON", "transformProtobufToSSE"] as const)("withholds incomplete calls in %s", async method => {
    const { CursorExecutor } = await import("./protocols/executors/cursor.js");
    const decoder = await import("./protocols/utils/cursorProtobuf.js");
    vi.spyOn(decoder, "extractTextFromResponse").mockReturnValue({
      text: null, error: null, thinking: null,
      toolCall: { id: "call", type: "function", function: { name: "Read", arguments: '{"path":"x"}' }, isLast: false },
    });
    expect(() => new CursorExecutor()[method](connectFrame(Buffer.from([0])), "fixture", {})).toThrow("incomplete tool call");
  });
});

describe("provider stream and credential boundaries", () => {
  it("only emits executable calls after complete validated tool JSON", async () => {
    mockFetch(() => sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "call", function: { name: "Read", arguments: '{"path":' } }] } }] }, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] }, finish_reason: "tool_calls" }] }, "[DONE]"]));
    const events = await collect(); expect(events.at(-2)).toEqual({ type: "tool-call", call: { id: "call", name: "Read", arguments: '{"path":"x"}' } });
  });
  it.each([false, true])("rejects truncated or invalid calls without executable event: malformed %s", async malformed => {
    mockFetch(() => sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "call", function: { name: "Read", arguments: '{"path":' } }] }, ...(malformed ? { finish_reason: "tool_calls" } : {}) }] }, "[DONE]"]));
    const events: ProviderEvent[] = []; await expect(collect(base(), events)).rejects.toMatchObject({ status: 502, retryable: false });
    expect(events.some(event => event.type === "tool-call")).toBe(false);
  });
  it("strips foreign Google/Responses state and downgrades missing strict reasoning into observations", async () => {
    const fetch = mockFetch(); const messages: WireMessage[] = [{ role: "assistant", content: "Earlier", tool_calls: [{ id: "call", type: "function", function: { name: "Read", arguments: '{"path":"x"}' }, thoughtSignature: "foreign-google" }], chatReasoning: { endpoint: "foreign", model: "deepseek-v4-pro", content: "foreign-reasoning" } }, { role: "tool", tool_call_id: "call", content: "File contents" }, { role: "user", content: "Continue" }];
    await collect({ ...base(), messages }); const wire = posted(fetch).messages;
    expect(wire.every((message: any) => message.role === "user")).toBe(true);
    expect(JSON.stringify(wire)).toContain("File contents"); expect(JSON.stringify(wire)).not.toMatch(/foreign-google|foreign-reasoning|reasoning_content|tool_calls/);
  });
  it("replays actual same-key reasoning and strips it for a different key", async () => {
    let response = () => sse([{ choices: [{ delta: { reasoning_content: "original private reasoning", content: "Hello" }, finish_reason: "stop" }] }]);
    const fetch = mockFetch(() => response()); const events = await collect();
    const reasoning = events.find(event => event.type === "chat-reasoning"); expect(reasoning?.type).toBe("chat-reasoning");
    const messages: WireMessage[] = [{ role: "assistant", content: "Hello", chatReasoning: reasoning?.type === "chat-reasoning" ? reasoning.reasoning : undefined }, { role: "user", content: "Continue" }];
    response = completed; await collect({ ...base(), messages }); expect(posted(fetch, 1).messages[0].reasoning_content).toBe("original private reasoning");
    await collect({ ...base(), messages, credentials: { apiKey: "different-key" } }); expect(JSON.stringify(posted(fetch, 2))).not.toContain("original private reasoning");
  });
  it("redacts nested credential values and individual service-account private keys", async () => {
    mockFetch(() => new Response('upstream bearer session-token and KEY\\nLINE', { status: 401 }));
    await expect(collect({ ...base(), credentials: { apiKey: JSON.stringify({ private_key: "KEY\nLINE" }), providerSpecificData: { session: { accessToken: "session-token" } } } })).rejects.toMatchObject({ status: 401, message: expect.not.stringMatching(/session-token|KEY/) });
  });
  it("refreshes Copilot session token using original GitHub credential and persists only the session patch", async () => {
    const save = vi.fn(); const fetch = vi.fn(async (url: string) => url.includes("copilot_internal") ? json({ token: "fresh-copilot", expires_at: Math.floor(Date.now() / 1000) + 3600 }) : completed()); vi.stubGlobal("fetch", fetch);
    await collect({ ...base(), providerId: "github", model: "gpt-4o", credentials: { id: "account", accessToken: "original-github", providerSpecificData: { copilotToken: "old", copilotTokenExpiresAt: 1 } }, onCredentialsRefresh: save });
    expect(save).toHaveBeenCalledWith({ providerSpecificData: { copilotToken: "fresh-copilot", copilotTokenExpiresAt: expect.any(Number) } });
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ Authorization: "token original-github" });
    expect((fetch.mock.calls[1] as unknown as [string, RequestInit])[1].headers).toMatchObject({ Authorization: "Bearer fresh-copilot" });
  });
  it("does not claim static catalogs verify credentials", async () => {
    const fetch = mockFetch(); const result = await listProviderAdapterModels("kiro", { accessToken: "x" }); expect(result.verified).toBe(false); expect(result.models.length).toBeGreaterThan(0); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["trae", "windsurf"])("rejects undeclared coding capabilities for chat-only %s", async providerId => {
    const fetch = mockFetch(); await expect(collect({ ...base(), providerId })).rejects.toMatchObject({ status: 400 }); expect(fetch).not.toHaveBeenCalled();
  });
});
