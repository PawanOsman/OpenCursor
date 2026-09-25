/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderEvent, ResponsesReasoning, WireMessage } from "../types";
import { CODEX_CONFIG, CodexProtocolError, codexHeaders, createCodexRequest, parseCodexStream } from "./codex";

const credentials = { id: "local-codex-account", accessToken: "fixture-token", accountId: "fixture-workspace" };
const user: WireMessage[] = [{ role: "user", content: "Fix the failing test" }];
const completed = { type: "response.completed", response: { status: "completed" } };
const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;

async function collect(events: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const result: ProviderEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

function stream(events: unknown[], close = true) {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(events.map(frame).join("")));
      if (close) controller.close();
    },
    cancel,
  });
  return { body, cancel };
}

afterEach(() => vi.unstubAllGlobals());

describe("OpenCursor Codex request contract", () => {
  it.each([
    ["fast", "priority"], ["standard", "default"], [undefined, undefined],
  ] as const)("maps explicit speed %s to service tier %s independently of reasoning", (speed, tier) => {
    const body = JSON.parse(String(createCodexRequest({
      model: "gpt-6-astra", messages: user, modelParams: { speed, reasoningEffort: "high" },
    }, credentials).init.body));
    expect(body.reasoning).toEqual({ effort: "high", summary: "auto" });
    if (tier) expect(body.service_tier).toBe(tier);
    else expect(body).not.toHaveProperty("service_tier");
  });

  it.each([
    ["unknown-model", "fast"], ["unknown-model", "standard"],
    ["gpt-5.3-codex-spark", "fast"], ["gpt-5.5-pro", "fast"],
  ] as const)("omits unsupported model %s speed %s", (model, speed) => {
    const body = JSON.parse(String(createCodexRequest({
      model, messages: user, modelParams: { speed },
    }, credentials).init.body));
    expect(body.model).toBe(model);
    expect(body).not.toHaveProperty("service_tier");
  });

  it("applies speed to the upstream model of a provider-scoped review alias", () => {
    const body = JSON.parse(String(createCodexRequest({
      model: "gpt-5.6-sol-review", messages: user, modelParams: { speed: "fast" },
    }, credentials).init.body));
    expect(body).toMatchObject({ model: "gpt-5.6-sol", service_tier: "priority" });
  });

  it("resolves a provider-scoped review alias without changing ordinary model IDs", () => {
    const review = JSON.parse(String(createCodexRequest({ model: "gpt-5.6-sol-review", messages: user }, credentials).init.body));
    expect(review.model).toBe("gpt-5.6-sol");
    const automatic = JSON.parse(String(createCodexRequest({ model: "codex-auto-review", messages: user }, credentials).init.body));
    expect(automatic.model).toBe("codex-auto-review");
  });
  it.each([
    ["codex", "gpt-6-astra", credentials.id, true], ["openai", "gpt-6-astra", credentials.id, false],
    ["codex", "gpt-5.6-sol", credentials.id, false], ["codex", "gpt-6-astra", "other-local-account", false],
    ["codex", "gpt-6-astra", undefined, false],
  ] as const)("replays encrypted %s/%s reasoning only for its original account %s", (provider, model, credential, included) => {
    const item: ResponsesReasoning["items"][number] = { type: "reasoning", id: "rs_replay", summary: [], encrypted_content: "opaque-codex-fixture" };
    const messages: WireMessage[] = [
      { role: "assistant", content: "Reading the file", responsesReasoning: { provider, model, credential, items: [item] }, tool_calls: [{ id: "call_read", type: "function", function: { name: "Read", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_read", content: "contents" },
    ];
    const original = structuredClone(messages);
    const request = createCodexRequest({ model: "gpt-6-astra", messages }, credentials);
    const body = JSON.parse(String(request.init.body));
    expect(body.input.filter((input: any) => input.type === "reasoning")).toEqual(included ? [item] : []);
    expect(body.input.slice(included ? 1 : 0)).toEqual([
      { role: "assistant", content: [{ type: "output_text", text: "Reading the file" }] },
      { type: "function_call", call_id: "call_read", name: "Read", arguments: "{}" },
      { type: "function_call_output", call_id: "call_read", output: "contents" },
    ]);
    expect(messages).toEqual(original);
  });

  it("uses the reference client identity, minimal OAuth scopes, and text model registry", () => {
    expect(CODEX_CONFIG).toMatchObject({
      authUrl: "https://auth.openai.com/oauth/authorize", tokenUrl: "https://auth.openai.com/oauth/token",
      clientId: "app_EMoamEEZ73f0CkXaXp7hrann", port: 1455, path: "/auth/callback",
      scope: "openid profile email offline_access", originator: "codex_cli_rs", cliVersion: "0.154.0",
    });
    expect(CODEX_CONFIG.fallbackModels).toContain("gpt-6-astra");
    expect(CODEX_CONFIG.fallbackModels).toContain("gpt-6-sol");
    expect(CODEX_CONFIG.fallbackModels).toContain("gpt-6-luna");
    expect(CODEX_CONFIG.fallbackModels).toContain("gpt-5.3-codex-spark");
    expect(CODEX_CONFIG.fallbackModels.some((model) => /-(image|review)$/.test(model))).toBe(false);
  });

  it("sends the accepted streaming body and account headers through mocked fetch", async () => {
    const fetchMock = vi.fn(async () => new Response(stream([completed]).body));
    vi.stubGlobal("fetch", fetchMock);
    const abort = new AbortController();
    const request = createCodexRequest({
      model: "gpt-5.6-sol", messages: [{ role: "system", content: "Project instructions" }, ...user],
      tools: [{ type: "function", function: { name: "Read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } } }],
      promptCacheKey: "conversation", signal: abort.signal,
    }, credentials);
    const response = await fetch(request.url, request.init);
    expect(await collect(parseCodexStream(response.body!.getReader(), abort.signal))).toEqual([{ type: "done", finishReason: "stop" }]);
    expect(fetchMock).toHaveBeenCalledWith("https://chatgpt.com/backend-api/codex/responses", expect.objectContaining({ method: "POST", signal: abort.signal }));
    expect(request.init.headers).toMatchObject({
      authorization: "Bearer fixture-token", "ChatGPT-Account-ID": "fixture-workspace",
      originator: "codex_cli_rs", "user-agent": "codex_cli_rs/0.154.0", accept: "text/event-stream",
    });
    const body = JSON.parse(String(request.init.body));
    expect(body).toMatchObject({
      model: "gpt-5.6-sol", instructions: "Project instructions", store: false, stream: true,
      reasoning: { effort: "low", summary: "auto" }, include: ["reasoning.encrypted_content"], prompt_cache_key: "conversation",
      tools: [{ type: "function", name: "Read", description: "Read a file" }],
    });
    expect(Object.keys(body).sort()).toEqual(["include", "input", "instructions", "model", "prompt_cache_key", "reasoning", "store", "stream", "tools"]);
    expect(body.tools[0].function).toBeUndefined();
  });

  it("keeps routing stable across account refreshes and isolates independent conversations", () => {
    const request = (key?: string, account = credentials) => createCodexRequest({ model: "gpt-5.6-sol", messages: user, promptCacheKey: key }, account);
    const initial = request("conversation");
    const refreshed = request("conversation", { ...credentials, accessToken: "rotated-fixture", accountId: "other-workspace" });
    const initialHeaders = initial.init.headers as Record<string, string>;
    expect(refreshed.init.body).toBe(initial.init.body);
    expect(refreshed.init.headers).toMatchObject({ session_id: initialHeaders.session_id, authorization: "Bearer rotated-fixture", "ChatGPT-Account-ID": "other-workspace" });
    expect(initialHeaders.session_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect((request("conversation/summary").init.headers as Record<string, string>).session_id).not.toBe(initialHeaders.session_id);
    expect(request().init.body).not.toBe(request().init.body);
    expect(codexHeaders({ accessToken: "fixture" })).not.toHaveProperty("ChatGPT-Account-ID");
    expect(codexHeaders(credentials)).toMatchObject({ accept: "application/json", originator: initialHeaders.originator, "user-agent": initialHeaders["user-agent"], "ChatGPT-Account-ID": "fixture-workspace" });
  });

  it("preserves all user and tool images, empty results, and paired call IDs", () => {
    const image = (data: string) => ({ type: "image_url" as const, image_url: { url: `data:image/png;base64,${data}` } });
    const messages: WireMessage[] = [
      { role: "system", content: [{ type: "text", text: "A", cache_control: { type: "ephemeral" } }, { type: "text", text: "B" }] },
      { role: "user", content: [{ type: "text", text: "Compare" }, image("USER")] },
      { role: "assistant", content: "Inspecting", tool_calls: ["one", "two"].map((id) => ({ id: `call_${id}`, type: "function", function: { name: "Read", arguments: `{"path":"${id}.png"}` } })) },
      { role: "tool", tool_call_id: "call_one", content: [image("ONE")] },
      { role: "tool", tool_call_id: "call_two", content: [{ type: "text", text: "Second" }, image("TWO")] },
      { role: "user", content: "Now compare" },
    ];
    const before = structuredClone(messages);
    const body = JSON.parse(String(createCodexRequest({ model: "gpt-5.6-sol", messages }, credentials).init.body));
    expect(messages).toEqual(before);
    expect(body.instructions).toBe("A\nB");
    expect(body.input).toEqual([
      { role: "user", content: [{ type: "input_text", text: "Compare" }, { type: "input_image", image_url: "data:image/png;base64,USER" }] },
      { role: "assistant", content: [{ type: "output_text", text: "Inspecting" }] },
      { type: "function_call", call_id: "call_one", name: "Read", arguments: '{"path":"one.png"}' },
      { type: "function_call", call_id: "call_two", name: "Read", arguments: '{"path":"two.png"}' },
      { type: "function_call_output", call_id: "call_one", output: "" },
      { type: "function_call_output", call_id: "call_two", output: "Second" },
      { role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64,ONE" }, { type: "input_image", image_url: "data:image/png;base64,TWO" }] },
      { role: "user", content: [{ type: "input_text", text: "Now compare" }] },
    ]);
  });

  it.each([
    ["gpt-5.6-sol", "ultra", "ultra"], ["gpt-5.6-terra", "max", "max"],
    ["gpt-5.6-luna", "ultra", "max"], ["gpt-6-astra", "ultra", "max"],
    ["gpt-5.5", "max", "xhigh"], ["gpt-5.4-mini", "high", "high"], ["gpt-5.6-sol", "none", "none"],
  ])("maps %s effort %s to %s using reference capabilities", (model, requested, expected) => {
    const body = JSON.parse(String(createCodexRequest({ model, messages: user, modelParams: { reasoningEffort: requested } }, credentials).init.body));
    expect(body.reasoning).toEqual({ effort: expected, summary: "auto" });
    expect(body.include).toEqual(expected === "none" ? undefined : ["reasoning.encrypted_content"]);
  });

  it("provides nonempty input without adopting the reference's unrelated CLI harness instructions", () => {
    const body = JSON.parse(String(createCodexRequest({ model: "gpt-5.6-sol", messages: [] }, credentials).init.body));
    expect(body.instructions).toContain("OpenCursor");
    expect(body.input).toHaveLength(1);
  });

  it("honors cancellation before constructing a request", () => {
    const signal = AbortSignal.abort(new Error("stopped"));
    expect(() => createCodexRequest({ model: "gpt-5.6-sol", messages: user, signal }, credentials)).toThrow("stopped");
  });
});

describe("Codex Responses stream contract", () => {
  it("preserves mixed assistant phases and omits ambiguous phases after text changes", async () => {
    const commentary = { type: "message", id: "msg_commentary", phase: "commentary", content: [{ type: "output_text", text: "Checking. " }] };
    const final = { type: "message", id: "msg_final", phase: "final_answer", content: [{ type: "output_text", text: "Done." }] };
    const fixture = stream([
      { type: "response.output_item.done", output_index: 0, item: commentary },
      { type: "response.completed", response: { status: "completed", output: [commentary, final] } },
    ]);
    const events = await collect(parseCodexStream(fixture.body.getReader(), undefined, { provider: "codex", model: "gpt-5.3-codex", credential: credentials.id }));
    const metadata = events.filter((event) => event.type === "responses-reasoning");
    expect(metadata).toEqual([{ type: "responses-reasoning", reasoning: {
      provider: "codex", model: "gpt-5.3-codex", credential: credentials.id, items: [],
      messages: [{ text: "Checking. ", phase: "commentary" }, { text: "Done.", phase: "final_answer" }],
    } }]);
    const build = (text: string, provider: "codex" | "openai" = "codex") => JSON.parse(String(createCodexRequest({
      model: "gpt-5.3-codex", messages: [{ role: "assistant", content: text, responsesReasoning: { ...metadata[0].reasoning, provider } }],
    }, credentials).init.body)).input;
    expect(build("Checking. Done.")).toEqual([
      { role: "assistant", phase: "commentary", content: [{ type: "output_text", text: "Checking. " }] },
      { role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: "Done." }] },
    ]);
    expect(build("Edited answer")).toEqual([{ role: "assistant", content: [{ type: "output_text", text: "Edited answer" }] }]);
    expect(build("Checking. Done.", "openai")).toEqual([{ role: "assistant", content: [{ type: "output_text", text: "Checking. Done." }] }]);
  });

  it.each([null, "commentary", "final_answer"] as const)("retains consistent phase %s even when assistant text has been shortened", async (phase) => {
    const fixture = stream([{ type: "response.completed", response: { status: "completed", output: [{ type: "message", id: "msg_one", phase, content: [{ type: "output_text", text: "Original answer" }] }] } }]);
    const events = await collect(parseCodexStream(fixture.body.getReader(), undefined, { provider: "codex", model: "gpt-5.3-codex", credential: credentials.id }));
    const metadata = events.find((event) => event.type === "responses-reasoning")!;
    expect(metadata.reasoning).toMatchObject({ phase, items: [], messages: [{ text: "Original answer", phase }] });
    const request = createCodexRequest({ model: "gpt-5.3-codex", messages: [{ role: "assistant", content: "Shortened", responsesReasoning: metadata.reasoning }] }, credentials);
    expect(JSON.parse(String(request.init.body)).input).toEqual([{ role: "assistant", phase, content: [{ type: "output_text", text: "Shortened" }] }]);
  });

  it("emits one complete opaque reasoning event after successful terminal validation", async () => {
    const first = { type: "reasoning", id: "rs_one", summary: [], encrypted_content: "opaque-one" };
    const second = { type: "reasoning", id: "rs_two", summary: [], encrypted_content: "opaque-two" };
    const fixture = stream([
      { type: "response.output_item.done", output_index: 0, item: first },
      { type: "response.output_item.done", output_index: 1, item: second },
      { type: "response.completed", response: { status: "completed", output: [first, second,
        { type: "reasoning", id: "rs_unsigned", summary: [] },
        { type: "function_call", id: "fc_read", call_id: "call_read", name: "Read", arguments: "{}" },
      ] } },
    ]);
    const events = await collect(parseCodexStream(fixture.body.getReader(), undefined, { provider: "codex", model: "gpt-6-astra", credential: credentials.id }));
    const metadata = events.filter((event) => event.type === "responses-reasoning");
    expect(metadata).toEqual([{ type: "responses-reasoning", reasoning: { provider: "codex", model: "gpt-6-astra", credential: credentials.id, items: [first, second] } }]);
    expect(events.indexOf(metadata[0])).toBeLessThan(events.findIndex((event) => event.type === "tool-call"));
  });

  it.each(["failed", "incomplete", "truncated"])("never emits encrypted reasoning for a %s response", async (status) => {
    const fixture = stream([
      { type: "response.output_item.done", item: { type: "reasoning", id: "rs_one", summary: [], encrypted_content: "opaque-failed" } },
      ...(status === "truncated" ? [] : [{ type: "response.done", response: { status } }]),
    ]);
    const seen: ProviderEvent[] = [];
    await expect((async () => {
      for await (const event of parseCodexStream(fixture.body.getReader(), undefined, { provider: "codex", model: "gpt-6-astra" })) seen.push(event);
    })()).rejects.toBeInstanceOf(CodexProtocolError);
    expect(seen.some((event) => event.type === "responses-reasoning" || event.type === "done")).toBe(false);
  });

  it("reconciles interleaved calls by item ID, preserves call_id, and accounts repeated usage once", async () => {
    const fixture = stream([
      { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "fc_first", call_id: "call_first", name: "Read" } },
      { type: "response.output_item.added", output_index: 1, item: { type: "function_call", id: "fc_second", call_id: "call_second", name: "Glob" } },
      { type: "response.function_call_arguments.delta", item_id: "fc_second", delta: '{"pattern":' },
      { type: "response.function_call_arguments.delta", item_id: "fc_first", delta: '{"path":"a.ts"}' },
      { type: "response.function_call_arguments.done", item_id: "fc_second", arguments: '{"pattern":"*.ts"}' },
      { type: "response.in_progress", response: { usage: { input_tokens: 100, output_tokens: 5, input_tokens_details: { cached_tokens: 80 } } } },
      { type: "response.output_item.done", output_index: 0, item: { type: "function_call", id: "fc_first", call_id: "call_first", name: "Read", arguments: '{"path":"a.ts"}' } },
      { type: "response.completed", response: { status: "completed", usage: { input_tokens: 100, output_tokens: 9, input_tokens_details: { cached_tokens: 80 } }, output: [
        { type: "function_call", id: "fc_first", call_id: "call_first", name: "Read", arguments: '{"path":"a.ts"}' },
        { type: "function_call", id: "fc_second", call_id: "call_second", name: "Glob", arguments: '{"pattern":"*.ts"}' },
      ] } },
    ]);
    const events = await collect(parseCodexStream(fixture.body.getReader()));
    expect(events.filter((event) => event.type === "tool-call")).toEqual([
      { type: "tool-call", call: { id: "call_first", name: "Read", arguments: '{"path":"a.ts"}' } },
      { type: "tool-call", call: { id: "call_second", name: "Glob", arguments: '{"pattern":"*.ts"}' } },
    ]);
    expect(events.filter((event) => event.type === "tool-call-start")).toHaveLength(2);
    expect(events.filter((event) => event.type === "usage")).toEqual([
      { type: "usage", promptTokens: 100, completionTokens: 5, promptTokensTotal: 100, completionTokensTotal: 5, cacheReadInputTokens: 100, cachedReadTokens: 80 },
      { type: "usage", promptTokens: 0, completionTokens: 4, promptTokensTotal: 100, completionTokensTotal: 9 },
    ]);
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "tool_calls" });
  });

  it("recovers final-only calls and text without repeating streamed text or thinking", async () => {
    const fixture = stream([
      { type: "response.reasoning_summary_text.delta", output_index: 0, item_id: "rs_one", delta: "Plan", summary_index: 0 },
      { type: "response.output_text.delta", output_index: 1, item_id: "msg_one", delta: "Done", content_index: 0 },
      { type: "response.output_item.done", output_index: 2, item: { type: "function_call", id: "fc_one", call_id: "call_one", name: "Read", arguments: '{"path":"a.ts"}' } },
      { type: "response.done", response: { status: "completed", output: [
        { id: "rs_one", type: "reasoning", summary: [{ type: "summary_text", text: "Plan carefully" }] },
        { id: "msg_one", type: "message", content: [{ type: "output_text", text: "Done." }, { type: "output_text", text: "Next" }] },
        { id: "fc_one", type: "function_call", call_id: "call_one", name: "Read", arguments: '{"path":"a.ts"}' },
        { id: "fc_two", type: "function_call", call_id: "call_two", name: "Glob", arguments: "{}" },
      ] } },
    ]);
    const events = await collect(parseCodexStream(fixture.body.getReader()));
    expect(events.filter((event) => event.type === "text-delta").map((event) => event.text).join("")).toBe("Done.Next");
    expect(events.filter((event) => event.type === "thinking-delta").map((event) => event.text).join("")).toBe("Plan carefully");
    expect(events.filter((event) => event.type === "tool-call").map((event) => event.call.id)).toEqual(["call_one", "call_two"]);
  });

  it("returns promptly at the terminal event and cancels a server stream that stays open", async () => {
    const fixture = stream([completed], false);
    const events = await collect(parseCodexStream(fixture.body.getReader()));
    expect(events).toEqual([{ type: "done", finishReason: "stop" }]);
    expect(fixture.cancel).toHaveBeenCalledOnce();
    expect(fixture.body.locked).toBe(false);
  });

  it("accepts reference usage aliases and fragmented SSE with a final unterminated record", async () => {
    const payload = frame({ type: "response.output_text.delta", delta: "Hello 🌍" }) +
      `data: ${JSON.stringify({ type: "response.done", response: { usage: { prompt_tokens: 40, completion_tokens: 4, cache_read_input_tokens: 20 } } })}`;
    const bytes = new TextEncoder().encode(payload);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < bytes.length; index += 3) controller.enqueue(bytes.subarray(index, index + 3));
        controller.close();
      },
    });
    const events = await collect(parseCodexStream(body.getReader()));
    expect(events).toEqual([
      { type: "text-delta", text: "Hello 🌍" },
      { type: "usage", promptTokens: 40, completionTokens: 4, promptTokensTotal: 40, completionTokensTotal: 4, cacheReadInputTokens: 40, cachedReadTokens: 20 },
      { type: "done", finishReason: "stop" },
    ]);
  });

  it.each([
    [{ type: "error", error: { message: "server overloaded" } }, "server overloaded", 502],
    [{ type: "error", code: "invalid_request_error", message: "invalid request" }, "invalid request", 400],
    [{ type: "error", error: { type: "invalid_request_error", code: "unsupported_value", message: "invalid option" } }, "invalid option", 400],
    [{ type: "error", error: { type: "invalid_request_error", code: "rate_limit_exceeded", message: "quota limit" } }, "quota limit", 429],
    [{ type: "error", error: { status: "403", message: "account access" } }, "account access", 403],
    [{ type: "error", status_code: 401, message: "expired token" }, "expired token", 401],
    [{ type: "response.failed", response: { error: { code: "invalid_prompt", message: "bad prompt" } } }, "bad prompt", 400],
    [{ type: "response.failed", response: { error: { code: "misalignment_policy_violation", message: "blocked" } } }, "blocked", 400],
    [{ type: "response.failed", response: { error: { code: "server_is_overloaded", message: "overloaded" } } }, "overloaded", 503],
    [{ type: "response.done", response: { status: "failed", error: { code: "context_length_exceeded", message: "context limit" } } }, "context limit", 400],
    [{ type: "response.completed", response: { error: { code: "rate_limit_exceeded", message: "rate limit" } } }, "rate limit", 429],
    [{ type: "response.failed", response: { error: { message: "model unavailable" } } }, "model unavailable", 500],
    [{ type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } }, "max_output_tokens", 400],
    [{ type: "response.done", response: { status: "failed", error: { message: "failed alias" } } }, "failed alias", 500],
    [{ type: "response.done", response: { status: "incomplete", incomplete_details: { reason: "interrupted" } } }, "interrupted", 400],
  ])("surfaces terminal errors before releasing calls: %j", async (terminal, message, status) => {
    const fixture = stream([
      { type: "response.output_item.added", item: { type: "function_call", id: "fc_one", call_id: "call_one", name: "Write", arguments: "{}" } },
      { ...terminal, response: { ...("response" in terminal ? terminal.response : {}), usage: { input_tokens: 30, output_tokens: 7 } } },
    ]);
    const seen: ProviderEvent[] = [];
    const consume = async () => { for await (const event of parseCodexStream(fixture.body.getReader())) seen.push(event); };
    await expect(consume()).rejects.toMatchObject({ message: expect.stringContaining(message), status });
    expect(seen.some((event) => event.type === "tool-call" || event.type === "done")).toBe(false);
    expect(seen.find((event) => event.type === "usage")).toMatchObject({ promptTokens: 30, completionTokens: 7 });
    expect(fixture.body.locked).toBe(false);
  });

  it("rejects EOF and DONE without a successful terminal event", async () => {
    for (const suffix of ["", "data: [DONE]\n\n"]) {
      const body = new Response(frame({ type: "response.output_item.added", item: { type: "function_call", id: "fc_one", call_id: "call_one", name: "Write" } }) + suffix).body!;
      const seen: ProviderEvent[] = [];
      await expect((async () => { for await (const event of parseCodexStream(body.getReader())) seen.push(event); })()).rejects.toBeInstanceOf(CodexProtocolError);
      expect(seen.some((event) => event.type === "tool-call" || event.type === "done")).toBe(false);
    }
  });

  it("cancels a pending reader and propagates the caller's abort reason", async () => {
    const fixture = stream([], false);
    const abort = new AbortController();
    const pending = collect(parseCodexStream(fixture.body.getReader(), abort.signal));
    abort.abort(new Error("User stopped generation"));
    await expect(pending).rejects.toThrow("User stopped generation");
    expect(fixture.cancel).toHaveBeenCalledOnce();
    expect(fixture.body.locked).toBe(false);
  });

  it("releases the reader when the signal was already aborted", async () => {
    const fixture = stream([], false);
    await expect(collect(parseCodexStream(fixture.body.getReader(), AbortSignal.abort(new Error("stopped"))))).rejects.toThrow("stopped");
    expect(fixture.body.locked).toBe(false);
  });
});
