/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it, vi } from "vitest";
import type { ProviderEvent, ToolSchema, WireMessage } from "../types";
import {
  ANTIGRAVITY_CONFIG, AntigravityProtocolError, antigravityHeaders,
  antigravityModelChoices, parseAntigravityStream, resolveAntigravityProject, toAntigravityRequest,
} from "./antigravity";

const base = { projectId: "fixture-project", model: "gemini-3-flash", messages: [{ role: "user", content: "Fix the tests." }] as WireMessage[] };
const tool: ToolSchema = { type: "function", function: { name: "Read", description: "Read a file.", parameters: {
  type: "object", additionalProperties: false,
  properties: { path: { type: "string" }, title: { type: "string", default: "fixture", maxLength: 200 } }, required: ["path"],
} } };

function stream(frames: unknown[], fragmented = false) {
  const text = frames.map((frame) => `data: ${typeof frame === "string" ? frame : JSON.stringify(frame)}\r\n\r\n`).join("");
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({ start(controller) {
    if (fragmented) for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    else controller.enqueue(bytes);
    controller.close();
  } }).getReader();
}

async function collect(reader: ReadableStreamDefaultReader<Uint8Array>, options?: Parameters<typeof parseAntigravityStream>[1]) {
  const events: ProviderEvent[] = [];
  for await (const event of parseAntigravityStream(reader, options)) events.push(event);
  return events;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Antigravity OAuth protocol identity", () => {
  it("keeps the existing installed-app identity distinct from Gemini CLI and routes endpoint purposes", () => {
    expect(ANTIGRAVITY_CONFIG.clientId).toBe("1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com");
    expect(ANTIGRAVITY_CONFIG.scopes).toContain("https://www.googleapis.com/auth/cclog");
    expect(ANTIGRAVITY_CONFIG.scopes).toContain("https://www.googleapis.com/auth/experimentsandconfigs");
    expect(ANTIGRAVITY_CONFIG.apiBase).toBe("https://daily-cloudcode-pa.googleapis.com");
    expect(ANTIGRAVITY_CONFIG.quotaUrl).toBe("https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels");
    expect(ANTIGRAVITY_CONFIG.loadCodeAssistUrl).toBe("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist");
    expect(ANTIGRAVITY_CONFIG.onboardUserUrl).toBe("https://cloudcode-pa.googleapis.com/v1internal:onboardUser");
  });

  it("uses IDE 2.11.0 headers without router, SDK or invented machine identity headers", () => {
    expect(antigravityHeaders("fixture-token", { purpose: "generation", platform: "linux", arch: "x64" })).toEqual({
      authorization: "Bearer fixture-token", "content-type": "application/json",
      "user-agent": "antigravity/ide/2.11.0 linux/x64", accept: "text/event-stream",
    });
    expect(antigravityHeaders("fixture-token", { purpose: "catalog", platform: "darwin", arch: "arm64" })).toEqual({
      authorization: "Bearer fixture-token", "content-type": "application/json",
      "user-agent": "antigravity/ide/2.11.0 darwin/arm64",
      "x-client-name": "antigravity", "x-client-version": "2.11.0",
    });
    const project = antigravityHeaders("fixture-token", { purpose: "project" });
    expect(Object.keys(project).sort()).toEqual(["authorization", "content-type", "user-agent"]);
  });
});

describe("Antigravity request conversion", () => {
  it("preserves context, exact tool signatures, parallel calls, images, cache session and input objects", () => {
    const messages: WireMessage[] = [
      { role: "system", content: "You are OpenCursor. Keep the user's instructions." },
      { role: "user", content: [{ type: "text", text: "Compare these." }, { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } }] },
      { role: "assistant", content: "Reading both files.", tool_calls: [
        { id: "upstream-a", type: "function", function: { name: "Read", arguments: '{"path":"a.ts"}' }, thoughtSignature: "opaque-response-signature" },
        { id: "upstream-b", type: "function", function: { name: "Read", arguments: '{"path":"b.png"}' } },
      ] },
      { role: "tool", tool_call_id: "upstream-a", content: "42" },
      { role: "tool", tool_call_id: "upstream-b", content: [{ type: "text", text: "Image loaded." }, { type: "image_url", image_url: { url: "data:image/png;base64,BAUG" } }] },
    ];
    const before = structuredClone({ messages, tool });
    const body = toAntigravityRequest({ ...base, messages, tools: [tool], sessionId: "123456789", requestId: "fixture-request", maxTokens: 24000 });
    expect(body.request.systemInstruction).toEqual({ parts: [{ text: messages[0].content }] });
    expect(body.request.contents).toEqual([
      { role: "user", parts: [{ text: "Compare these." }, { inlineData: { mimeType: "image/png", data: "AQID" } }] },
      { role: "model", parts: [
        { text: "Reading both files." },
        { functionCall: { id: "upstream-a", name: "Read", args: { path: "a.ts" } }, thoughtSignature: "opaque-response-signature" },
        { functionCall: { id: "upstream-b", name: "Read", args: { path: "b.png" } } },
      ] },
      { role: "user", parts: [
        { functionResponse: { id: "upstream-a", name: "Read", response: { result: 42 } } },
        { functionResponse: { id: "upstream-b", name: "Read", response: { result: "Image loaded." } } },
        { inlineData: { mimeType: "image/png", data: "BAUG" } },
      ] },
    ]);
    expect(body.request.sessionId).toBe("123456789");
    expect(body.requestId).toBe("fixture-request");
    expect(body.request.toolConfig).toEqual({ functionCallingConfig: { mode: "VALIDATED" } });
    expect(body.request.tools![0].functionDeclarations[0]).toEqual({ name: "Read", description: "Read a file.", parameters: {
      type: "object", properties: { path: { type: "string" }, title: { type: "string" } }, required: ["path"],
    } });
    expect({ messages, tool }).toEqual(before);
    expect(body).not.toHaveProperty("safetySettings");
    expect(body).not.toHaveProperty("billing");
    expect(body).not.toHaveProperty("requestType");
  });

  it("preserves legacy unsigned Gemini 3 tool observations without a fabricated signature", () => {
    const messages: WireMessage[] = [
      { role: "assistant", content: null, tool_calls: [{ id: "old-call", type: "function", function: { name: "Read", arguments: '{"path":"a.ts"}' } }] },
      { role: "tool", tool_call_id: "old-call", content: "previous file contents" },
    ];
    const gemini = toAntigravityRequest({ ...base, messages });
    expect(JSON.stringify(gemini)).not.toContain("thoughtSignature");
    expect(gemini.request.contents[0].parts[0].text).toContain('Arguments: {"path":"a.ts"}');
    expect(gemini.request.contents[1].parts[0].text).toContain("previous file contents");
    const claude = toAntigravityRequest({ ...base, model: "claude-sonnet-4-6", messages });
    expect(claude.request.contents[0].parts[0].functionCall).toEqual({ id: "old-call", name: "Read", args: { path: "a.ts" } });
    expect(claude.request.contents[1].parts[0].functionResponse?.name).toBe("Read");
  });

  it("does not reuse a later parallel call's signature for an unsigned first call", () => {
    const messages: WireMessage[] = [
      { role: "assistant", content: null, tool_calls: [
        { id: "first", type: "function", function: { name: "Read", arguments: '{"path":"first.ts"}' } },
        { id: "second", type: "function", function: { name: "Read", arguments: '{"path":"second.ts"}' }, thoughtSignature: "second-call-only" },
      ] },
      { role: "tool", tool_call_id: "first", content: "First file contents." },
      { role: "tool", tool_call_id: "second", content: "Second file contents." },
    ];
    const contents = toAntigravityRequest({ ...base, messages }).request.contents;
    expect(contents.flatMap((content) => content.parts).every((part) => !part.functionCall && !part.functionResponse && !part.thoughtSignature)).toBe(true);
    expect(JSON.stringify(contents)).toContain("first.ts");
    expect(JSON.stringify(contents)).toContain("second.ts");
    expect(JSON.stringify(contents)).toContain("First file contents.");
    expect(JSON.stringify(contents)).toContain("Second file contents.");
    expect(messages[0].role === "assistant" && messages[0].tool_calls?.[1].thoughtSignature).toBe("second-call-only");
  });

  it("uses the reference remote image fileData shape and rejects unsupported attachment URLs", () => {
    const remote = toAntigravityRequest({ ...base, messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://fixture.invalid/image.png" } }] }] });
    expect(remote.request.contents[0].parts).toEqual([{ fileData: { fileUri: "https://fixture.invalid/image.png", mimeType: "image/*" } }]);
    expect(() => toAntigravityRequest({ ...base, messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "file:///private/image.png" } }] }] })).toThrow(/image must be/);
  });

  it("maps only explicit catalog aliases and forwards dynamic model ids unchanged", () => {
    expect(toAntigravityRequest({ ...base, model: "gemini-3.8-flash" }).model).toBe("gemini-3.8-flash-medium");
    expect(toAntigravityRequest({ ...base, model: "gemini-3.7-flash-high" }).model).toBe("gemini-3.7-flash-tiered");
    expect(toAntigravityRequest({ ...base, model: "gemini-3.8-flash-high(high)" }).model).toBe("gemini-3.8-flash-high");
    expect(toAntigravityRequest({ ...base, model: "account-specific-model" }).model).toBe("account-specific-model");
  });

  it.each([
    ["gemini-3.8-flash-high", "gemini-3.8-flash-high(high)"],
    ["gemini-3.8-flash-medium", "gemini-3.8-flash-medium(medium)"],
    ["gemini-3.8-flash-low", "gemini-3.8-flash-low(low)"],
    ["gemini-3.7-flash-high", "gemini-3.7-flash-tiered(high)"],
    ["gemini-3.7-flash-medium", "gemini-3.7-flash-tiered(medium)"],
    ["gemini-3.7-flash-low", "gemini-3.7-flash-tiered(low)"],
    ["gemini-3.6-flash-high", "gemini-3.6-flash-tiered(high)"],
    ["gemini-3.6-flash-medium", "gemini-3.6-flash-tiered(medium)"],
    ["gemini-3.6-flash-low", "gemini-3.6-flash-tiered(low)"],
  ])("separates the wire model and reasoning level for catalog choice %s", (model, upstream) => {
    const body = toAntigravityRequest({ ...base, model, projectId: " fixture-project " });
    const [, wireModel, level] = /^(.*)\((.*)\)$/.exec(upstream)!;
    expect(body.model).toBe(wireModel);
    expect(body.request.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingLevel: level });
    expect(body.project).toBe("fixture-project");
    expect(body).not.toHaveProperty("requestType");
  });

  it("keeps only aliases actually backed by a live project model", () => {
    const choices = antigravityModelChoices(["gemini-3.8-flash-medium", "gemini-3.8-flash-high", "gemini-3.7-flash-tiered"]);
    expect(choices).toContain("gemini-3.8-flash");
    expect(choices).toContain("gemini-3.7-flash-low");
    expect(choices).not.toContain("gemini-3.8-flash-low");
    expect(choices).not.toContain("gemini-3.6-flash-low");
    expect(antigravityModelChoices([])).toEqual([]);
  });

  it("prefers exact live IDs over historical aliases and honors explicit reasoning options", () => {
    const exact = toAntigravityRequest({ ...base, model: "gemini-3.7-flash-low", availableModels: ["gemini-3.7-flash-low"] });
    expect(exact.model).toBe("gemini-3.7-flash-low");
    expect(exact.request.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingLevel: "low" });
    const override = toAntigravityRequest({ ...base, model: "gemini-3.8-flash", modelParams: { reasoningEffort: "high" } });
    expect(override.model).toBe("gemini-3.8-flash-medium");
    expect(override.request.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingLevel: "high" });
    const disabled = toAntigravityRequest({ ...base, model: "gemini-3.8-flash-low", modelParams: { thinking: "disabled" } });
    expect(disabled.request.generationConfig.thinkingConfig).toEqual({ includeThoughts: false, thinkingLevel: "minimal" });
  });

  it("honors response limits, supported reasoning levels and sampling without adding OpenAI fields", () => {
    const body = toAntigravityRequest({ ...base, maxTokens: 150000, temperature: 0.3, modelParams: { reasoningEffort: "xhigh" },
      sampling: { topP: 0.7, topK: 20, stopSequences: ["END"], seed: 2, presencePenalty: 0.1 } });
    expect(body.request.generationConfig).toEqual({ maxOutputTokens: 64000, temperature: 0.3,
      thinkingConfig: { thinkingLevel: "high", includeThoughts: true }, topP: 0.7, topK: 20,
      stopSequences: ["END"], seed: 2, presencePenalty: 0.1 });
    const disabled = toAntigravityRequest({ ...base, modelParams: { thinking: "disabled" } });
    expect(disabled.request.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "minimal", includeThoughts: false });
    const budget = toAntigravityRequest({ ...base, model: "gemini-2.5-pro", maxTokens: 2000, modelParams: { reasoningEffort: "high" } });
    expect(budget.request.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 1999, includeThoughts: true });
    expect(toAntigravityRequest({ ...base, maxTokens: Number.NaN }).request.generationConfig.maxOutputTokens).toBe(8192);
  });

  it("resolves local schema references and nullable types without changing real argument names", () => {
    const params = { type: "object", $defs: { filename: { type: ["string", "null"] } }, properties: {
      default: { $ref: "#/$defs/filename" }, title: { anyOf: [{ type: "string" }, { type: "null" }] },
    } };
    const body = toAntigravityRequest({ ...base, tools: [{ ...tool, function: { ...tool.function, parameters: params } }] });
    expect(body.request.tools![0].functionDeclarations[0].parameters).toEqual({ type: "object", properties: {
      default: { type: "string", nullable: true }, title: { type: "string", nullable: true },
    } });
    expect(params.properties.default).toEqual({ $ref: "#/$defs/filename" });
  });

  it("declares no-argument tools without inventing a required argument", () => {
    const body = toAntigravityRequest({ ...base, tools: [{ ...tool, function: {
      name: "TodoRead", description: "Read the current todo list.", parameters: { type: "object", properties: {} },
    } }] });
    expect(body.request.tools![0].functionDeclarations[0]).toEqual({ name: "TodoRead", description: "Read the current todo list." });
  });

  it("resolves a local reference inside a nullable union rather than dropping its type", () => {
    const parameters = { type: "object", $defs: { Path: { type: "string", description: "Workspace path." } }, properties: {
      path: { anyOf: [{ $ref: "#/$defs/Path" }, { type: "null" }] },
    } };
    const body = toAntigravityRequest({ ...base, tools: [{ ...tool, function: { ...tool.function, parameters } }] });
    expect(body.request.tools![0].functionDeclarations[0].parameters).toEqual({ type: "object", properties: {
      path: { type: "string", description: "Workspace path.", nullable: true },
    } });
    expect(parameters.properties.path.anyOf[0]).toEqual({ $ref: "#/$defs/Path" });
  });

  it("rejects nonexistent projects, malformed native history, tool-name collisions and lossy schemas", () => {
    expect(() => toAntigravityRequest({ ...base, projectId: "" })).toThrow(/project is missing/);
    expect(() => toAntigravityRequest({ ...base, tools: [tool, tool] })).toThrow(/unique tool names/);
    expect(() => toAntigravityRequest({ ...base, tools: [{ ...tool, function: { ...tool.function, parameters: { anyOf: [{ type: "string" }, { type: "number" }] } } }] })).toThrow(/cannot represent anyOf/);
    expect(() => toAntigravityRequest({ ...base, messages: [{ role: "assistant", content: null, tool_calls: [
      { id: "call", type: "function", function: { name: "Read", arguments: "invalid" }, thoughtSignature: "fixture-signature" },
    ] }] })).toThrow(/Invalid saved arguments/);
  });
});

describe("Antigravity SSE contracts", () => {
  it("decodes split UTF-8, thoughts, parallel tool signatures and cumulative usage exactly once", async () => {
    const reader = stream([
      { response: { candidates: [{ content: { parts: [{ thought: true, text: "Inspecting…", thoughtSignature: "first-signature" }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 2, thoughtsTokenCount: 4, cachedContentTokenCount: 70 } } },
      { response: { candidates: [{ content: { parts: [
        { functionCall: { id: "native-call", name: "Read", args: { path: "a.ts" } } },
        { functionCall: { name: "Read", args: { path: "b.ts" } } },
      ] } }], usageMetadata: { candidatesTokenCount: 6 } } },
      { response: { candidates: [{ content: { parts: [{ text: "Ready ✅" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 6, thoughtsTokenCount: 5, cachedContentTokenCount: 70 } } },
      "[DONE]",
    ], true);
    const events = await collect(reader, { requestId: "request-fixture", model: base.model });
    expect(events.filter((event) => event.type === "thinking-delta")).toEqual([{ type: "thinking-delta", text: "Inspecting…" }]);
    expect(events.filter((event) => event.type === "text-delta")).toEqual([{ type: "text-delta", text: "Ready ✅" }]);
    const calls = events.filter((event) => event.type === "tool-call").map((event) => event.call);
    expect(calls[0]).toEqual({ id: "native-call", name: "Read", arguments: '{"path":"a.ts"}', thoughtSignature: "first-signature" });
    expect(calls[1]).toMatchObject({ name: "Read", arguments: '{"path":"b.ts"}' });
    expect(calls[1].thoughtSignature).toBeUndefined();
    expect(calls[1].id).toMatch(/^call_.+_1$/);
    const usage = events.filter((event) => event.type === "usage");
    expect(usage.reduce((sum, event) => sum + (event.promptTokens ?? 0), 0)).toBe(100);
    expect(usage.reduce((sum, event) => sum + (event.completionTokens ?? 0), 0)).toBe(11);
    expect(usage.reduce((sum, event) => sum + (event.cachedReadTokens ?? 0), 0)).toBe(70);
    expect(usage.every((event) => event.requestId === "request-fixture" && event.model === base.model)).toBe(true);
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "tool_calls" });
    expect(() => reader.releaseLock()).not.toThrow();
  });

  it("persists attached and standalone signatures with their next native call and replays them", async () => {
    const events = await collect(stream([{ candidates: [{ content: { parts: [
      { thoughtSignature: "standalone-signature" }, { functionCall: { id: "a", name: "Read", args: {} } },
      { thought_signature: "attached-signature", functionCall: { id: "b", name: "Read", args: {} } },
    ] }, finishReason: "STOP" }] }]));
    const calls = events.filter((event) => event.type === "tool-call").map((event) => event.call);
    expect(calls.map((call) => call.thoughtSignature)).toEqual(["standalone-signature", "attached-signature"]);
    const replay = toAntigravityRequest({ ...base, messages: [{ role: "assistant", content: null, tool_calls: calls.map((call) => ({
      id: call.id, type: "function", function: { name: call.name, arguments: call.arguments }, thoughtSignature: call.thoughtSignature,
    })) }] });
    expect(replay.request.contents[0].parts.map((part) => part.thoughtSignature)).toEqual(["standalone-signature", "attached-signature"]);
  });

  it("generates distinct call ids across requests when Google supplies none", async () => {
    const frame = { candidates: [{ content: { parts: [{ functionCall: { name: "Read", args: {} } }] }, finishReason: "STOP" }] };
    const a = (await collect(stream([frame]))).find((event) => event.type === "tool-call")!;
    const b = (await collect(stream([frame]))).find((event) => event.type === "tool-call")!;
    expect(a.call.id).not.toBe(b.call.id);
  });

  it("reads wrapper-level billing on a terminal frame", async () => {
    const events = await collect(stream([{ response: { candidates: [{ finishReason: "STOP" }] },
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 5, thoughtsTokenCount: 3, cachedContentTokenCount: 60 },
    }]));
    expect(events).toEqual([
      { type: "usage", promptTokens: 100, completionTokens: 8, promptTokensTotal: 100, completionTokensTotal: 8, cacheReadInputTokens: 100, cachedReadTokens: 60 },
      { type: "done", finishReason: "stop" },
    ]);
  });

  it.each(["nested", "wrapper"])("accounts for %s usage before throwing a co-located provider error", async (placement) => {
    const usageMetadata = { promptTokenCount: 100, candidatesTokenCount: 5, cachedContentTokenCount: 40 };
    const error = { code: 429, message: "Fixture quota exhausted" };
    const frame = placement === "nested" ? { response: { usageMetadata, error } } : { response: { error }, usageMetadata };
    const events: ProviderEvent[] = [];
    let caught: unknown;
    try { for await (const event of parseAntigravityStream(stream([frame]))) events.push(event); } catch (error) { caught = error; }
    expect(caught).toMatchObject({ status: 429, message: expect.stringContaining("Fixture quota exhausted") });
    expect(events).toEqual([{ type: "usage", promptTokens: 100, completionTokens: 5, promptTokensTotal: 100, completionTokensTotal: 5, cacheReadInputTokens: 100, cachedReadTokens: 40 }]);
  });

  it.each(["STOP", "MAX_TOKENS"])("finishes and cancels an open SSE connection on %s", async (finishReason) => {
    const cancelled = vi.fn();
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ response: {
          candidates: [{ content: { parts: [{ text: "Complete." }] }, finishReason }],
        }, usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 2 } })}\n\n`));
        // Deliberately keep the connection open after a complete response.
      },
      cancel: cancelled,
    });
    const events = await collect(readable.getReader());
    expect(events.at(-1)).toEqual({ type: "done", finishReason: finishReason.toLowerCase() });
    expect(events.filter((event) => event.type === "usage")).toEqual([
      { type: "usage", promptTokens: 12, completionTokens: 2, promptTokensTotal: 12, completionTokensTotal: 2 },
    ]);
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(readable.locked).toBe(false);
  }, 1000);

  it.each([
    [[{ error: { code: 429, message: "Quota exhausted" } }], 429, "Quota exhausted"],
    [[{ response: { promptFeedback: { blockReason: "SAFETY" } } }], 400, "blocked prompt"],
    [[{ candidates: [{ finishReason: "MALFORMED_FUNCTION_CALL" }] }], 400, "malformed_function_call"],
    [[{ candidates: [{ content: { parts: [{ text: "partial" }] } }] }], 502, "before completion"],
    [["{invalid-json"], 502, "malformed stream JSON"],
    [[{ response: "invalid" }], 502, "invalid wrapped stream frame"],
    [[{ candidates: [{ content: { parts: [{ functionCall: { name: "Read", args: "partial" } }] }, finishReason: "STOP" }] }], 502, "invalid function call"],
    [[{ candidates: [{ content: { parts: [{ functionCall: { name: "Read", args: "partial" } }] }, finishReason: "MAX_TOKENS" }] }], 502, "invalid function call"],
  ] as const)("surfaces error contracts without emitting executable calls: %j", async (frames, status, message) => {
    const events: ProviderEvent[] = [];
    let caught: unknown;
    try { for await (const event of parseAntigravityStream(stream([...frames]))) events.push(event); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(AntigravityProtocolError);
    expect(caught).toMatchObject({ status, message: expect.stringContaining(message) });
    expect(events.some((event) => event.type === "tool-call" || event.type === "done")).toBe(false);
  });

  it("cancels a pending read and releases the stream without a fake completion", async () => {
    const cancelled = vi.fn();
    const controller = new AbortController();
    const readable = new ReadableStream<Uint8Array>({ cancel: cancelled });
    const result = collect(readable.getReader(), { signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(readable.locked).toBe(false);
  });

  it("releases an already aborted reader without reading it", async () => {
    const controller = new AbortController();
    controller.abort();
    const readable = new ReadableStream<Uint8Array>();
    await expect(collect(readable.getReader(), { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(readable.locked).toBe(false);
  });
});

describe("Antigravity project onboarding", () => {
  it("keeps an existing account project without another lookup or onboarding", async () => {
    const fetch = vi.fn();
    expect(await resolveAntigravityProject("fixture-token", { projectId: "saved-project", fetch })).toEqual({ projectId: "saved-project" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refreshes a stale saved project once using the account's authoritative project lookup", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ cloudaicompanionProject: { id: " replacement-project " } }));
    const resolved = await resolveAntigravityProject("fixture-token", { projectId: "stale-project", forceRefresh: true, fetch });
    expect(resolved).toEqual({ projectId: "replacement-project", tierId: "legacy-tier" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]).toEqual([ANTIGRAVITY_CONFIG.loadCodeAssistUrl, expect.objectContaining({
      headers: antigravityHeaders("fixture-token", { purpose: "project" }),
    })]);
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ metadata: expect.objectContaining({ ideType: 9, pluginType: 2 }) });
  });

  it("surfaces authoritative project404 errors instead of retaining the stale project or inventing one", async () => {
    const fetch = vi.fn(async () => json({ error: { code: 404, message: "Requested entity was not found.", status: "NOT_FOUND" } }, 404));
    await expect(resolveAntigravityProject("fixture-token", { projectId: "stale-project", forceRefresh: true, fetch }))
      .rejects.toMatchObject({ status: 404, message: expect.stringContaining("Requested entity was not found.") });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(["loaded-project", { id: "loaded-project" }])("reads a provisioned project in either response shape: %j", async (project) => {
    const fetch = vi.fn(async () => json({ cloudaicompanionProject: project, allowedTiers: [{ id: "free-tier", isDefault: true }] }));
    expect(await resolveAntigravityProject("fixture-token", { fetch })).toEqual({ projectId: "loaded-project", tierId: "free-tier" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]).toEqual([ANTIGRAVITY_CONFIG.loadCodeAssistUrl, expect.objectContaining({
      method: "POST", headers: antigravityHeaders("fixture-token", { purpose: "project" }),
      body: JSON.stringify({ metadata: { ideType: 9, platform: process.platform === "linux" ? process.arch === "arm64" ? 4 : 3 : process.platform === "darwin" ? process.arch === "arm64" ? 2 : 1 : process.platform === "win32" ? 5 : 0, pluginType: 2 } }),
    })]);
  });

  it("onboards a missing project and waits for its actual provisioned id", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ allowedTiers: [{ id: "default-tier", isDefault: true }] }))
      .mockResolvedValueOnce(json({ done: false, name: "operations/fixture" }))
      .mockResolvedValueOnce(json({ done: true, response: { cloudaicompanionProject: { id: "new-project" } } }));
    expect(await resolveAntigravityProject("fixture-token", { fetch, pollDelayMs: 0 })).toEqual({ projectId: "new-project", tierId: "default-tier" });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([ANTIGRAVITY_CONFIG.loadCodeAssistUrl, ANTIGRAVITY_CONFIG.onboardUserUrl, ANTIGRAVITY_CONFIG.onboardUserUrl]);
    expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toMatchObject({ tierId: "default-tier", metadata: { ideType: 9, pluginType: 2 } });
  });

  it("loads the resulting project if onboarding completion omits it", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json({ done: true }))
      .mockResolvedValueOnce(json({ cloudaicompanionProject: "after-onboard" }));
    expect(await resolveAntigravityProject("fixture-token", { fetch })).toEqual({ projectId: "after-onboard", tierId: "legacy-tier" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("bounds provisioning attempts and surfaces permission errors instead of inventing a project", async () => {
    const fetch = vi.fn(async () => json({ done: false }));
    await expect(resolveAntigravityProject("fixture-token", { fetch, maxAttempts: 2, pollDelayMs: 0 })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("did not provision") });
    expect(fetch).toHaveBeenCalledTimes(3);
    const forbidden = vi.fn(async () => json({ error: { message: "Access denied" } }, 403));
    await expect(resolveAntigravityProject("fixture-token", { fetch: forbidden })).rejects.toMatchObject({ status: 403, message: expect.stringContaining("Access denied") });
    expect(forbidden).toHaveBeenCalledTimes(1);
  });

  it("cancels onboarding polling and forwards the signal to each HTTP request", async () => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({}))
      .mockImplementationOnce(async () => { controller.abort(); return json({ done: false }); });
    await expect(resolveAntigravityProject("fixture-token", { fetch, signal: controller.signal, pollDelayMs: 1000 })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every(([, options]) => options?.signal === controller.signal)).toBe(true);
  });
});
