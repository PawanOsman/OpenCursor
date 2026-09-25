/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { ProviderEvent, ToolSchema } from "../types";
import type { StreamChatOpts } from "./types";

vi.mock("vscode", () => ({ EventEmitter: class { event = () => ({ dispose() {} }); fire() {} } }));
vi.mock("../../stores/featureStore", () => ({ MODEL_CATALOG: [] }));
import { ChatHTTPError, generateTitle, pickModel, streamChat } from "../provider";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const sse = (...events: unknown[]) => new Response(events.map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
const textOutput = (text: string) => ({ type: "message", id: "msg_fixture", role: "assistant", content: [{ type: "output_text", text }] });
const tools: ToolSchema[] = [{ type: "function", function: { name: "Read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" }, limit: { type: "number" } }, required: ["path"] } } }];
const opaqueReasoning = { type: "reasoning" as const, id: "rs_fixture", summary: [], encrypted_content: "opaque-fixture" };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

async function collect(patch: Partial<StreamChatOpts> = {}, events: ProviderEvent[] = []) {
  for await (const event of streamChat({
    apiBaseUrl: "https://api.openai.com/v1", apiKey: "fixture-key", model: "gpt-6-astra",
    messages: [{ role: "user", content: "Read file.ts" }], maxRetries: 3,
    signal: new AbortController().signal, ...patch,
  })) events.push(event);
  return events;
}

describe("public OpenAI Responses transport contracts", () => {
  it.each(["gpt-5.3-codex", "gpt-5.3-codex-2026-02-05"])("routes %s to Responses and replays its assistant phase without encrypted items", async (model) => {
    fetchMock.mockResolvedValueOnce(sse({ type: "response.completed", response: { status: "completed", output: [{ ...textOutput("Checking the file."), phase: "commentary" }] } }));
    const events = await collect({ model, tools });
    const metadata = events.find((event) => event.type === "responses-reasoning")!;
    expect(metadata.reasoning).toMatchObject({ provider: "openai", model, phase: "commentary", items: [] });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/responses");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream).toBe(true);
    fetchMock.mockResolvedValueOnce(sse({ type: "response.completed", response: { status: "completed", output: [textOutput("Done")] } }));
    await collect({ model, messages: [{ role: "assistant", content: "Checking the file.", responsesReasoning: metadata.reasoning }, { role: "user", content: "Continue" }] });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).input).toEqual([
      { role: "assistant", phase: "commentary", content: [{ type: "output_text", text: "Checking the file." }] },
      { role: "user", content: [{ type: "input_text", text: "Continue" }] },
    ]);
  });

  it("routes Astra tools through Responses and preserves call pairing, reasoning, and usage", async () => {
    const call = { type: "function_call", id: "fc_fixture", call_id: "call_fixture", name: "Read", arguments: '{"path":"file.ts"}' };
    fetchMock.mockResolvedValueOnce(sse(
      { type: "response.output_item.done", output_index: 0, item: opaqueReasoning },
      { type: "response.output_item.added", output_index: 1, item: { ...call, arguments: "" } },
      { type: "response.function_call_arguments.delta", item_id: "fc_fixture", delta: call.arguments },
      { type: "response.completed", response: { status: "completed", output: [opaqueReasoning, call], usage: { input_tokens: 100, output_tokens: 8, input_tokens_details: { cached_tokens: 40, cache_write_tokens: 20 } } } },
    ));
    const events = await collect({ tools, promptCacheKey: "session-fixture", maxTokens: 16000, modelParams: { reasoningEffort: "max" }, temperature: 0.5 });
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(request.body);
    expect(body).toMatchObject({ model: "gpt-6-astra", stream: true, store: false, prompt_cache_key: "session-fixture", max_output_tokens: 16000,
      include: ["reasoning.encrypted_content"], reasoning: { effort: "max" }, tools: [{ type: "function", name: "Read", strict: false }] });
    expect(body.messages).toBeUndefined();
    expect(body.temperature).toBeUndefined();
    expect(request.headers).toEqual({ authorization: "Bearer fixture-key", "content-type": "application/json", accept: "text/event-stream" });
    expect(events.filter((event) => event.type === "tool-call")).toEqual([{ type: "tool-call", call: { id: "call_fixture", name: "Read", arguments: call.arguments } }]);
    const reasoning = events.find((event) => event.type === "responses-reasoning");
    expect(reasoning).toEqual({ type: "responses-reasoning", reasoning: { model: "gpt-6-astra", provider: "openai", credential: createHash("sha256").update("fixture-key").digest("hex"), items: [opaqueReasoning] } });
    expect(events.find((event) => event.type === "usage")).toMatchObject({ model: "gpt-6-astra", requestId: expect.any(String), promptTokens: 100, completionTokens: 8, cachedReadTokens: 40, cachedWriteTokens: 20 });
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "tool_calls" });

    fetchMock.mockResolvedValueOnce(sse({ type: "response.completed", response: { status: "completed", output: [textOutput("Done")] } }));
    await collect({ tools, promptCacheKey: "session-fixture", messages: [
      { role: "assistant", content: null, responsesReasoning: reasoning!.reasoning, tool_calls: [{ id: "call_fixture", type: "function", function: { name: "Read", arguments: call.arguments } }] },
      { role: "tool", tool_call_id: "call_fixture", content: "file contents" },
    ] });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).input).toEqual([
      opaqueReasoning, { type: "function_call", call_id: "call_fixture", name: "Read", arguments: call.arguments },
      { type: "function_call_output", call_id: "call_fixture", output: "file contents" },
    ]);
  });

  it("selects a complete JSON response for Pro while retaining executable tools", async () => {
    fetchMock.mockResolvedValueOnce(json({ status: "completed", output: [opaqueReasoning, { type: "function_call", id: "fc_pro", call_id: "call_pro", name: "Read", arguments: "{}" }] }));
    const events = await collect({ model: "gpt-5.5-pro", tools, modelParams: { reasoningEffort: "low" } });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/responses");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ stream: false, reasoning: { effort: "medium" } });
    expect(fetchMock.mock.calls[0][1].headers.accept).toBe("application/json");
    expect(events).toContainEqual({ type: "tool-call", call: { id: "call_pro", name: "Read", arguments: "{}" } });
    expect(events).toContainEqual({ type: "responses-reasoning", reasoning: { provider: "openai", model: "gpt-5.5-pro", credential: createHash("sha256").update("fixture-key").digest("hex"), items: [opaqueReasoning] } });
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "tool_calls" });
  });

  it("maps an HTTP 400 into a non-retryable provider error", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { message: "Invalid tool schema" } }, 400));
    await expect(collect()).rejects.toMatchObject({ name: "ChatHTTPError", status: 400, message: expect.stringContaining("Invalid tool schema") });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("maps incomplete Responses into a non-retryable provider error with observed usage", async () => {
    fetchMock.mockResolvedValueOnce(sse({ type: "response.incomplete", response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, usage: { input_tokens: 40, output_tokens: 100 } } }));
    const seen: ProviderEvent[] = [];
    await expect(collect({}, seen)).rejects.toMatchObject({ name: "ChatHTTPError", status: 400, message: expect.stringContaining("max_output_tokens") });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(seen.find((event) => event.type === "usage")).toMatchObject({ promptTokens: 40, completionTokens: 100, requestId: expect.any(String) });
    expect(seen.some((event) => event.type === "done" || event.type === "responses-reasoning")).toBe(false);
  });

  it("never retries after text output or releases reasoning from a failed response", async () => {
    fetchMock.mockResolvedValueOnce(sse(
      { type: "response.output_text.delta", delta: "Partial answer" },
      { type: "response.output_item.done", item: opaqueReasoning },
      { type: "response.failed", response: { error: { message: "upstream failed" }, usage: { input_tokens: 40, output_tokens: 3 } } },
    ));
    const seen: ProviderEvent[] = [];
    await expect(collect({}, seen)).rejects.toBeInstanceOf(ChatHTTPError);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(seen).toContainEqual({ type: "text-delta", text: "Partial answer" });
    expect(seen.find((event) => event.type === "usage")).toMatchObject({ promptTokens: 40, completionTokens: 3 });
    expect(seen.some((event) => event.type === "done" || event.type === "responses-reasoning")).toBe(false);
  });

  it("uses Responses for title and model selection and accounts both requests", async () => {
    fetchMock.mockResolvedValueOnce(sse({ type: "response.completed", response: { status: "completed", output: [textOutput('{"title":"Fix context accounting"}')], usage: { input_tokens: 60, output_tokens: 6, input_tokens_details: { cached_tokens: 20 } } } }));
    fetchMock.mockResolvedValueOnce(json({ status: "completed", output: [textOutput("gpt-6-astra")], usage: { input_tokens: 50, output_tokens: 5 } }));
    const onUsage = vi.fn();
    const abort = new AbortController();
    expect(await generateTitle("https://api.openai.com/v1", "fixture-key", "gpt-6-astra", "Fix context", false, undefined, { signal: abort.signal, onUsage })).toBe("Fix context accounting");
    expect(await pickModel("https://api.openai.com/v1", "fixture-key", "gpt-5.5-pro", ["gpt-6-astra"], "Fix context", false, undefined, { signal: abort.signal, onUsage })).toBe("gpt-6-astra");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["https://api.openai.com/v1/responses", "https://api.openai.com/v1/responses"]);
    const bodies = fetchMock.mock.calls.map(([, request]) => JSON.parse(request.body));
    expect(bodies[0]).toMatchObject({ stream: true, max_output_tokens: 4096, reasoning: { effort: "low" } });
    expect(bodies[1]).toMatchObject({ stream: false, max_output_tokens: 4096, reasoning: { effort: "medium" } });
    expect(onUsage).toHaveBeenCalledTimes(2);
    expect(onUsage.mock.calls[0][0]).toMatchObject({ model: "gpt-6-astra", promptTokens: 60, completionTokens: 6, cachedReadTokens: 20, requestId: expect.any(String) });
    expect(onUsage.mock.calls[1][0]).toMatchObject({ model: "gpt-5.5-pro", promptTokens: 50, completionTokens: 5, requestId: expect.any(String) });
    expect(onUsage.mock.calls[0][0].requestId).not.toBe(onUsage.mock.calls[1][0].requestId);
    abort.abort();
    expect(fetchMock.mock.calls.every(([, request]) => request.signal.aborted)).toBe(true);
  });

  it("keeps custom compatible hosts on Chat Completions and strips opaque reasoning", async () => {
    fetchMock.mockResolvedValueOnce(sse({ choices: [{ delta: { content: "Done" }, finish_reason: "stop" }] }, "[DONE]"));
    const events = await collect({ apiBaseUrl: "https://compatible.example.invalid/v1", messages: [
      { role: "assistant", content: "Earlier answer", responsesReasoning: { provider: "openai", model: "gpt-6-astra", items: [opaqueReasoning] } },
      { role: "user", content: "Continue" },
    ] });
    expect(fetchMock.mock.calls[0][0]).toBe("https://compatible.example.invalid/v1/chat/completions");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages).toEqual([{ role: "assistant", content: "Earlier answer" }, { role: "user", content: "Continue" }]);
    expect(JSON.stringify(body)).not.toContain("opaque-fixture");
    expect(events).toContainEqual({ type: "text-delta", text: "Done" });
  });
});
