/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { ProviderEvent, ResponsesReasoning, WireMessage } from "../types";
import type { StreamChatOpts } from "./types";
import { OpenAIResponsesError, createOpenAIResponsesRequest, parseOpenAIResponses, shouldUseOpenAIResponses } from "./openaiResponses";

const options = (patch: Partial<StreamChatOpts> = {}): StreamChatOpts => ({
  apiBaseUrl: "https://api.openai.com/v1", apiKey: "fixture-key", model: "gpt-6-astra",
  messages: [{ role: "user", content: "Fix the failing test" }], signal: new AbortController().signal, ...patch,
});
const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const sse = (...events: unknown[]) => new Response(events.map(frame).join(""), { headers: { "content-type": "text/event-stream" } });
async function collect(response: Response, signal?: AbortSignal): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  for await (const event of parseOpenAIResponses(response, signal)) events.push(event);
  return events;
}

afterEach(() => vi.unstubAllGlobals());

describe("official OpenAI Responses routing and request contract", () => {
  it.each([
    ["fast", "priority"], ["standard", "default"], [undefined, undefined],
  ] as const)("maps explicit speed %s to service tier %s without changing reasoning", (speed, tier) => {
    const body = JSON.parse(String(createOpenAIResponsesRequest(options({
      modelParams: { speed, reasoningEffort: "high" },
    })).init.body));
    expect(body.reasoning).toEqual({ effort: "high", summary: "auto" });
    if (tier) expect(body.service_tier).toBe(tier);
    else expect(body).not.toHaveProperty("service_tier");
  });

  it.each(["fast", "standard"] as const)("omits speed %s for unsupported Pro models", (speed) => {
    const body = JSON.parse(String(createOpenAIResponsesRequest(options({
      model: "gpt-5.5-pro", modelParams: { speed },
    })).init.body));
    expect(body.model).toBe("gpt-5.5-pro");
    expect(body).not.toHaveProperty("service_tier");
  });

  it.each([
    ["openai", "gpt-6-astra", true], ["codex", "gpt-6-astra", false], ["openai", "gpt-5.5-pro", false],
  ] as const)("scopes encrypted %s/%s replay to the original model and transport", (provider, model, included) => {
    const item: ResponsesReasoning["items"][number] = { type: "reasoning", id: "rs_fixture", summary: [], encrypted_content: "opaque-api-fixture" };
    const messages: WireMessage[] = [{ role: "assistant", content: "Earlier answer", responsesReasoning: { provider, model, credential: createHash("sha256").update("fixture-key").digest("hex"), items: [item] } }];
    const original = structuredClone(messages);
    const body = JSON.parse(String(createOpenAIResponsesRequest(options({ messages })).init.body));
    expect(body.input.filter((input: any) => input.type === "reasoning")).toEqual(included ? [item] : []);
    expect(body.input.at(-1)).toEqual({ role: "assistant", content: [{ type: "output_text", text: "Earlier answer" }] });
    expect(messages).toEqual(original);
  });

  it.each(["gpt-6-astra", "gpt-6-astra-2026-09-01", "gpt-6-sol", "gpt-6-luna", "gpt-5.5-pro", "gpt-5.5-pro-2026-04-23", "gpt-5.3-codex", "gpt-5.3-codex-2026-02-05"])("routes %s on the official API", (model) => {
    expect(shouldUseOpenAIResponses(options({ model }))).toBe(true);
    expect(shouldUseOpenAIResponses(options({ model, apiBaseUrl: "https://api.openai.com/v1/" }))).toBe(true);
    expect(shouldUseOpenAIResponses(options({ model, apiBaseUrl: "https://api.openai.com" }))).toBe(true);
  });

  it.each([
    { apiBaseUrl: "https://compatible.example/v1" }, { apiBaseUrl: "https://api.openai.com.proxy.example/v1" },
    { apiBaseUrl: "http://api.openai.com/v1" }, { apiBaseUrl: "https://api.openai.com/proxy/v1" },
    { model: "gpt-5.6" }, { model: "gpt-5.6-sol" }, { model: "gpt-5.5" }, { model: "gpt-5.3-codex-spark" },
    { oauthKind: "codex" as const }, { anthropic: true },
  ])("leaves other transports unchanged: %j", (patch) => {
    expect(shouldUseOpenAIResponses(options(patch))).toBe(false);
  });

  it.each(["gpt-6-sol", "gpt-6-luna"])("keeps %s's compatible endpoints and OAuth transport independent", (model) => {
    for (const patch of [
      { apiBaseUrl: "http://localhost:8080/v1" }, { apiBaseUrl: "https://openrouter.ai/api/v1" },
      { apiBaseUrl: "https://api.openai.com.proxy.example/v1" }, { apiBaseUrl: "https://api.openai.com/proxy/v1" },
      { apiBaseUrl: "https://api.openai.com/v1?route=custom" }, { apiBaseUrl: "https://api.openai.com/v1#custom" },
      { oauthKind: "codex" as const }, { anthropic: true },
    ]) expect(shouldUseOpenAIResponses(options({ model, ...patch }))).toBe(false);
    for (const alias of [`${model}-custom`, `${model}-pro`, `${model}-2026-09-22`]) {
      expect(shouldUseOpenAIResponses(options({ model: alias }))).toBe(false);
    }
  });

  describe.each(["gpt-6-sol", "gpt-6-luna"])("%s reasoning and sampling", (model) => {
    it.each(["none", "low", "medium", "high", "xhigh", "max"])("retains documented effort %s for streaming tool calls", (effort) => {
      const request = createOpenAIResponsesRequest(options({ model, modelParams: { reasoningEffort: effort },
        tools: [{ type: "function", function: { name: "Read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } }],
        temperature: 0, sampling: { topP: 0.5, topK: 20, frequencyPenalty: 1, presencePenalty: 1, seed: 42, stopSequences: ["STOP"] },
      }));
      const body = JSON.parse(String(request.init.body));
      expect(request.url).toBe("https://api.openai.com/v1/responses");
      expect(request.init.headers).toMatchObject({ accept: "text/event-stream" });
      expect(body).toMatchObject({ model, stream: true, store: false, reasoning: { effort }, tools: [{ type: "function", name: "Read", strict: false }], tool_choice: "auto" });
      expect(body.temperature).toBe(effort === "none" ? 0 : undefined);
      expect(body.top_p).toBe(effort === "none" ? 0.5 : undefined);
      for (const key of ["top_k", "frequency_penalty", "presence_penalty", "seed", "stop", "logprobs", "top_logprobs"]) expect(body).not.toHaveProperty(key);
    });

    it.each([undefined, "", "unknown", "   "])("uses the model default for unspecified/invalid effort %s without sampling", (effort) => {
      const body = JSON.parse(String(createOpenAIResponsesRequest(options({ model, modelParams: { reasoningEffort: effort }, temperature: 0.2, sampling: { topP: 0.4 } })).init.body));
      expect(body.reasoning).not.toHaveProperty("effort");
      expect(body).not.toHaveProperty("temperature");
      expect(body).not.toHaveProperty("top_p");
    });

    it("omits absent sampling settings at none", () => {
      const body = JSON.parse(String(createOpenAIResponsesRequest(options({ model, modelParams: { reasoningEffort: "none" }, sampling: { topP: null } })).init.body));
      expect(body.reasoning.effort).toBe("none");
      expect(body).not.toHaveProperty("temperature");
      expect(body).not.toHaveProperty("top_p");
    });
  });

  it("sends a stateless Responses request with optional tool fields and no OAuth identity", async () => {
    const fetchMock = vi.fn(async () => sse({ type: "response.completed", response: { status: "completed", output: [] } }));
    vi.stubGlobal("fetch", fetchMock);
    const opts = options({
      messages: [{ role: "system", content: "Project instructions" }, { role: "user", content: "Read the file" }],
      tools: [{ type: "function", function: { name: "Read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" }, limit: { type: "number" } }, required: ["path"] } } }],
      promptCacheKey: "conversation-one", modelParams: { reasoningEffort: "max" }, maxTokens: 12345,
      temperature: 0.2, sampling: { topP: 0.4, topK: 5, frequencyPenalty: 0.2, presencePenalty: 0.2, seed: 3, stopSequences: ["STOP"] },
    });
    const request = createOpenAIResponsesRequest(opts);
    const result = await collect(await fetch(request.url, request.init), opts.signal);
    expect(result).toEqual([{ type: "done", finishReason: "stop" }]);
    expect(request.url).toBe("https://api.openai.com/v1/responses");
    expect(request.init).toMatchObject({ method: "POST", signal: opts.signal });
    expect(request.init.headers).toEqual({ authorization: "Bearer fixture-key", "content-type": "application/json", accept: "text/event-stream" });
    expect(JSON.parse(String(request.init.body))).toEqual({
      model: "gpt-6-astra", instructions: "Project instructions", input: [{ role: "user", content: [{ type: "input_text", text: "Read the file" }] }],
      stream: true, store: false, include: ["reasoning.encrypted_content"], reasoning: { effort: "max", summary: "auto" }, prompt_cache_key: "conversation-one", max_output_tokens: 12345,
      tools: [{ type: "function", name: "Read", description: "Read a file", parameters: opts.tools![0].function.parameters, strict: false }], tool_choice: "auto",
    });
  });

  it("uses non-streaming Responses for GPT-5.5 Pro and keeps the model's documented efforts", () => {
    const request = createOpenAIResponsesRequest(options({ model: "gpt-5.5-pro", modelParams: { reasoningEffort: "high" } }));
    const body = JSON.parse(String(request.init.body));
    expect(body).toMatchObject({ model: "gpt-5.5-pro", stream: false, store: false, reasoning: { effort: "high" } });
    expect(request.init.headers).toMatchObject({ accept: "application/json" });
    expect(body.max_output_tokens).toBeUndefined();
    expect(body.prompt_cache_key).toBeUndefined();
  });

  it.each([
    ["gpt-6-astra", "none", "low"], ["gpt-6-astra", "minimal", "low"], ["gpt-6-astra", "ultra", "max"],
    ["gpt-6-sol", "minimal", "low"], ["gpt-6-sol", "ultra", "max"], ["gpt-6-sol", " NONE ", "none"],
    ["gpt-6-luna", "minimal", "low"], ["gpt-6-luna", "ultra", "max"], ["gpt-6-luna", " MAX ", "max"],
    ["gpt-5.5-pro", "none", "medium"], ["gpt-5.5-pro", "max", "xhigh"],
    ["gpt-5.3-codex", "none", "low"], ["gpt-5.3-codex", "max", "xhigh"],
  ])("normalizes inherited %s effort %s to %s", (model, supplied, expected) => {
    const body = JSON.parse(String(createOpenAIResponsesRequest(options({ model, modelParams: { reasoningEffort: supplied } })).init.body));
    expect(body.reasoning.effort).toBe(expected);
  });

  it("preserves parallel call IDs and all images when replaying tool history", () => {
    const messages: WireMessage[] = [
      { role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,USER" } }] },
      { role: "assistant", content: null, tool_calls: ["a", "b"].map((id) => ({ id: `call_${id}`, type: "function", function: { name: "Read", arguments: "{}" } })) },
      { role: "tool", tool_call_id: "call_a", content: [{ type: "text", text: "First" }, { type: "image_url", image_url: { url: "data:image/png;base64,A" } }] },
      { role: "tool", tool_call_id: "call_b", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,B" } }] },
    ];
    const original = structuredClone(messages);
    const body = JSON.parse(String(createOpenAIResponsesRequest(options({ messages })).init.body));
    expect(body.input.map((item: any) => item.type || item.role)).toEqual(["user", "function_call", "function_call", "function_call_output", "function_call_output", "user"]);
    expect(body.input.slice(1, 5).map((item: any) => item.call_id)).toEqual(["call_a", "call_b", "call_a", "call_b"]);
    expect(body.input[4].output).toBe("");
    expect(body.input.at(-1).content).toEqual([{ type: "input_image", image_url: "data:image/png;base64,A" }, { type: "input_image", image_url: "data:image/png;base64,B" }]);
    expect(messages).toEqual(original);
  });

  it("rejects a pre-aborted request without constructing transport work", () => {
    expect(() => createOpenAIResponsesRequest(options({ signal: AbortSignal.abort(new Error("stopped")) }))).toThrow("stopped");
  });
});

describe("OpenAI Responses decoding", () => {
  it.each(["gpt-6-sol", "gpt-6-luna"])("replays %s's completed loopback tool call with its original reasoning identity", async (model) => {
    const bodies: Record<string, any>[] = [];
    const opaque = { type: "reasoning", id: "rs_local", summary: [], encrypted_content: "opaque-local-fixture" };
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      bodies.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(frame({ type: "response.completed", response: { status: "completed", usage: { input_tokens: 20, output_tokens: 5 }, output: bodies.length === 1
        ? [opaque, { type: "function_call", id: "fc_local", call_id: "call_local", name: "Read", arguments: '{"path":"file.ts"}' }]
        : [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Verified the file." }] }],
      } }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/responses`;
      const opts = options({ model, modelParams: { reasoningEffort: "high" } });
      const first = createOpenAIResponsesRequest(opts);
      // Exercise real HTTP/stream decoding locally; never contact a paid API.
      const events: ProviderEvent[] = [];
      for await (const event of parseOpenAIResponses(await fetch(endpoint, first.init), opts.signal, model, opts.apiKey)) events.push(event);
      const reasoning = events.find(event => event.type === "responses-reasoning")!;
      expect(reasoning).toMatchObject({ reasoning: { provider: "openai", model, items: [opaque] } });
      expect(events).toContainEqual({ type: "tool-call", call: { id: "call_local", name: "Read", arguments: '{"path":"file.ts"}' } });
      expect(events.at(-1)).toEqual({ type: "done", finishReason: "tool_calls" });
      const followup = createOpenAIResponsesRequest(options({ ...opts, messages: [...opts.messages,
        { role: "assistant", content: null, responsesReasoning: reasoning.reasoning, tool_calls: [{ id: "call_local", type: "function", function: { name: "Read", arguments: '{"path":"file.ts"}' } }] },
        { role: "tool", tool_call_id: "call_local", content: "File contents" },
      ] }));
      expect(await collect(await fetch(endpoint, followup.init), opts.signal)).toContainEqual({ type: "text-delta", text: "Verified the file." });
      expect(bodies[0]).toMatchObject({ model, reasoning: { effort: "high" }, stream: true });
      expect(bodies[1].input).toContainEqual(opaque);
      expect(bodies[1].input).toContainEqual({ type: "function_call_output", call_id: "call_local", output: "File contents" });
      expect(reasoning.reasoning.credential).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(reasoning)).not.toContain(opts.apiKey);
      const rotated = createOpenAIResponsesRequest(options({ ...opts, apiKey: "another-account-key", messages: [
        { role: "assistant", content: "Prior answer", responsesReasoning: reasoning.reasoning, tool_calls: [{ id: "call_local", type: "function", function: { name: "Read", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "call_local", content: "File contents" },
      ] }));
      const rotatedInput = JSON.parse(String(rotated.init.body)).input;
      expect(rotatedInput.some((item: any) => item.type === "reasoning")).toBe(false);
      expect(rotatedInput).toContainEqual({ role: "assistant", content: [{ type: "output_text", text: "Prior answer" }] });
      expect(rotatedInput).toContainEqual({ type: "function_call", call_id: "call_local", name: "Read", arguments: "{}" });
      expect(rotatedInput).toContainEqual({ type: "function_call_output", call_id: "call_local", output: "File contents" });
      const legacy = JSON.parse(String(createOpenAIResponsesRequest(options({ ...opts, messages: [{ role: "assistant", content: "Legacy answer", responsesReasoning: { ...reasoning.reasoning, credential: undefined } }] })).init.body));
      expect(legacy.input.some((item: any) => item.type === "reasoning")).toBe(false);
      const otherModel = model === "gpt-6-sol" ? "gpt-6-luna" : "gpt-6-sol";
      const switched = JSON.parse(String(createOpenAIResponsesRequest(options({ model: otherModel, messages: [{ role: "assistant", content: "Prior answer", responsesReasoning: reasoning.reasoning }] })).init.body));
      expect(switched.input.some((item: any) => item.type === "reasoning")).toBe(false);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  it("decodes streaming calls and cumulative cached reads/writes without double billing", async () => {
    const usage = { input_tokens: 100, output_tokens: 5, input_tokens_details: { cached_tokens: 40, cache_write_tokens: 60 } };
    const events = await collect(sse(
      { type: "response.in_progress", response: { usage } },
      { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "fc_one", call_id: "call_one", name: "Read" } },
      { type: "response.function_call_arguments.delta", item_id: "fc_one", delta: '{"path":"file.ts"}' },
      { type: "response.completed", response: { status: "completed", usage: { ...usage, output_tokens: 8 }, output: [{ type: "function_call", id: "fc_one", call_id: "call_one", name: "Read", arguments: '{"path":"file.ts"}' }] } },
    ));
    expect(events.filter((event) => event.type === "tool-call")).toEqual([{ type: "tool-call", call: { id: "call_one", name: "Read", arguments: '{"path":"file.ts"}' } }]);
    expect(events.filter((event) => event.type === "usage")).toEqual([
      { type: "usage", promptTokens: 100, completionTokens: 5, promptTokensTotal: 100, completionTokensTotal: 5, cacheReadInputTokens: 100, cachedReadTokens: 40, cachedWriteTokens: 60 },
      { type: "usage", promptTokens: 0, completionTokens: 3, promptTokensTotal: 100, completionTokensTotal: 8 },
    ]);
  });

  it("decodes non-streaming Pro reasoning, text, tool calls, and observed usage", async () => {
    const events = await collect(json({ status: "completed", output: [
      { type: "reasoning", id: "rs_one", summary: [{ type: "summary_text", text: "Checked the file" }] },
      { type: "message", id: "msg_one", role: "assistant", content: [{ type: "output_text", text: "Ready." }] },
      { type: "function_call", id: "fc_one", call_id: "call_one", name: "Read", arguments: "{}" },
    ], usage: { input_tokens: 20, output_tokens: 10 } }));
    expect(events).toContainEqual({ type: "text-delta", text: "Ready." });
    expect(events).toContainEqual({ type: "thinking-delta", text: "Checked the file" });
    expect(events).toContainEqual({ type: "tool-call", call: { id: "call_one", name: "Read", arguments: "{}" } });
    expect(events.find((event) => event.type === "usage")).toMatchObject({ promptTokens: 20, completionTokens: 10 });
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "tool_calls" });
  });

  it.each(["failed", "incomplete"])("preserves observed usage but releases no tools on a %s JSON response", async (status) => {
    const response = json({ status, error: status === "failed" ? { message: "upstream failed" } : null,
      incomplete_details: { reason: "max_output_tokens" }, usage: { input_tokens: 10, output_tokens: 4 },
      output: [{ type: "function_call", call_id: "call_write", name: "Write", arguments: "{}" }],
    });
    const seen: ProviderEvent[] = [];
    await expect((async () => { for await (const event of parseOpenAIResponses(response)) seen.push(event); })()).rejects.toMatchObject({ name: "OpenAIResponsesError", message: expect.stringContaining("OpenAI Responses") });
    expect(seen.find((event) => event.type === "usage")).toMatchObject({ promptTokens: 10, completionTokens: 4 });
    expect(seen.some((event) => event.type === "tool-call" || event.type === "done")).toBe(false);
  });

  it("surfaces malformed JSON and missing terminal states explicitly", async () => {
    await expect(collect(new Response("invalid", { headers: { "content-type": "application/json" } }))).rejects.toBeInstanceOf(OpenAIResponsesError);
    await expect(collect(json({ output: [] }))).rejects.toThrow("completion status");
    await expect(collect(sse({ type: "response.output_text.delta", delta: "partial" }))).rejects.toThrow("ended before completion");
  });

  it("cancels a pending JSON response and releases its reader", async () => {
    const cancelled = vi.fn();
    const readable = new ReadableStream<Uint8Array>({ cancel: cancelled });
    const abort = new AbortController();
    const pending = collect(new Response(readable, { headers: { "content-type": "application/json" } }), abort.signal);
    abort.abort(new Error("Stop Pro request"));
    await expect(pending).rejects.toThrow("Stop Pro request");
    expect(cancelled).toHaveBeenCalledOnce();
    expect(readable.locked).toBe(false);
  });

  it("does not wait for an open SSE connection after successful completion", async () => {
    const cancelled = vi.fn();
    const readable = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(frame({ type: "response.completed", response: { status: "completed", output: [] } }))); },
      cancel: cancelled,
    });
    expect(await collect(new Response(readable, { headers: { "content-type": "text/event-stream" } }))).toEqual([{ type: "done", finishReason: "stop" }]);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(readable.locked).toBe(false);
  });
});
