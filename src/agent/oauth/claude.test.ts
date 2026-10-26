/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolSchema, WireMessage } from "../types";
import {
  CLAUDE_OAUTH_CONFIG,
  buildClaudeAuthorizationUrl,
  buildClaudeMessagesRequest,
  claudeOAuthHeaders,
} from "./claude";

vi.mock("vscode", () => ({ EventEmitter: class { event = () => ({ dispose() {} }); fire() {} } }));
vi.mock("../../stores/featureStore", () => ({ MODEL_CATALOG: [] }));
import { initOAuth, isConnected, streamOAuthChat } from "../oauth";

afterEach(() => vi.unstubAllGlobals());

const tools: ToolSchema[] = [{
  type: "function",
  function: { name: "Read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } },
}];

function makeRequest(options: Partial<Parameters<typeof buildClaudeMessagesRequest>[1]> = {}) {
  return buildClaudeMessagesRequest("fixture-access", {
    model: "claude-sonnet-4-6",
    messages: [{ role: "user", content: "Inspect the project" }],
    signal: new AbortController().signal,
    ...options,
  });
}

describe("Claude OAuth request protocol", () => {
  it("builds a PKCE authorization URL with correctly encoded scope and callback state", () => {
    const redirectUri = "http://localhost:54545/callback";
    const state = "state&with=special+characters";
    const url = new URL(buildClaudeAuthorizationUrl({ challenge: "challenge_-", state, redirectUri }));
    expect(url.origin + url.pathname).toBe("https://claude.ai/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      code: "true", client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e", response_type: "code",
      redirect_uri: redirectUri, scope: "org:create_api_key user:profile user:inference",
      code_challenge: "challenge_-", code_challenge_method: "S256", state,
    });
  });

  it("uses only the current account's Bearer token and the CLI identity on account endpoints", () => {
    const first = claudeOAuthHeaders("first-account");
    const second = claudeOAuthHeaders("second-account", { betas: ["oauth-2025-04-20"] });
    expect(first).toEqual({
      authorization: "Bearer first-account", "anthropic-version": "2023-06-01",
      "anthropic-beta": "oauth-2025-04-20", accept: "application/json",
      "user-agent": "claude-cli/2.1.280 (external, cli)",
    });
    expect(second).toEqual({ ...first, authorization: "Bearer second-account" });
    expect(second["x-api-key"]).toBeUndefined();
  });

  it("constructs the official streaming endpoint with the reference compatibility version", () => {
    const signal = new AbortController().signal;
    const { url, init } = makeRequest({ signal });
    const request = new Request(url, init);
    expect(request.url).toBe("https://api.anthropic.com/v1/messages?beta=true");
    expect(request.method).toBe("POST");
    expect(init.signal).toBe(signal);
    expect(request.headers.get("authorization")).toBe("Bearer fixture-access");
    expect(request.headers.get("accept")).toBe("text/event-stream");
    expect(request.headers.get("content-type")).toBe("application/json");
    expect(request.headers.get("anthropic-version")).toBe("2023-06-01");
    expect(request.headers.get("user-agent")).toBe("claude-cli/2.1.280 (external, sdk-cli)");
    expect(request.headers.get("x-app")).toBe("cli");
    expect(request.headers.get("anthropic-dangerous-direct-browser-access")).toBe("true");
    expect(request.headers.get("x-stainless-package-version")).toBe("0.80.0");
    expect(request.headers.get("x-stainless-runtime-version")).toBe("v24.14.0");
    expect(request.headers.get("x-stainless-os")).toBe("MacOS");
    expect(request.headers.get("x-stainless-arch")).toBe("arm64");
    expect(request.headers.get("x-stainless-timeout")).toBe("600");
    expect(request.headers.has("x-api-key")).toBe(false);
    expect(CLAUDE_OAUTH_CONFIG.models).toContain("claude-fable-5-1");
    expect(CLAUDE_OAUTH_CONFIG.models).toContain("claude-haiku-4-5-20251001");
  });

  it("retains four cache boundaries without mutating history; API-key tokens get no billing identity", () => {
    const messages: WireMessage[] = [
      { role: "system", content: Array.from({ length: 3 }, (_, i) => ({ type: "text", text: `system ${i}`, cache_control: { type: "ephemeral" } })) },
      { role: "user", content: Array.from({ length: 3 }, (_, i) => ({ type: "text", text: `user ${i}`, cache_control: { type: "ephemeral" } })) },
    ];
    const original = JSON.stringify(messages);
    const body = JSON.parse(String(makeRequest({ messages }).init.body));
    expect(JSON.stringify(messages)).toBe(original);
    expect(JSON.stringify(body).match(/cache_control/g)).toHaveLength(4);
    expect(body.system.map((block: { text: string }) => block.text)).toEqual([
      "You are Claude Code, Anthropic's official CLI for Claude.", "system 0", "system 1", "system 2",
    ]);
    expect(body.messages[0].content.map((block: { text: string }) => block.text)).toEqual(["user 0", "user 1", "user 2"]);
    expect(body.metadata).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("x-anthropic-billing-header");
  });

  it("does not duplicate an existing compatibility prefix", () => {
    const prefix = "You are Claude Code, Anthropic's official CLI for Claude.";
    const messages: WireMessage[] = [{ role: "system", content: prefix }, { role: "user", content: "hello" }];
    const body = JSON.parse(String(makeRequest({ messages }).init.body));
    expect(body.system).toEqual([{ type: "text", text: prefix, cache_control: { type: "ephemeral" } }]);
  });

  it("keeps actual tool declarations, IDs and image results paired without decoy tools", () => {
    const messages: WireMessage[] = [
      { role: "user", content: "Read the images" },
      { role: "assistant", content: null, tool_calls: ["one", "two"].map((id) => ({ id, type: "function", function: { name: "Read", arguments: JSON.stringify({ path: `${id}.png` }) } })) },
      ...["one", "two"].map((id): WireMessage => ({
        role: "tool", tool_call_id: id,
        content: [{ type: "text", text: `${id}.png` }, { type: "image_url", image_url: { url: `data:image/png;base64,IMAGE_${id}` } }],
      })),
    ];
    const original = JSON.stringify({ messages, tools });
    const body = JSON.parse(String(makeRequest({ messages, tools }).init.body));
    expect(JSON.stringify({ messages, tools })).toBe(original);
    expect(body.tools).toEqual([{ name: "Read", description: "Read a file", input_schema: tools[0].function.parameters }]);
    expect(body.messages[1].content).toEqual(["one", "two"].map((id) => ({ type: "tool_use", id, name: "Read", input: { path: `${id}.png` } })));
    expect(body.messages[2].content).toEqual(["one", "two"].map((id) => ({
      type: "tool_result", tool_use_id: id,
      ...(id === "two" ? { cache_control: { type: "ephemeral" } } : {}),
      content: [{ type: "text", text: `${id}.png` }, { type: "image", source: { type: "base64", media_type: "image/png", data: `IMAGE_${id}` } }],
    })));
  });

  it("adds the billing block, Claude Code user id and matching session header for OAuth tokens", () => {
    const token = "sk-ant-oat01-fixture";
    const request = buildClaudeMessagesRequest(token, {
      model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }], sessionId: "session-fixture",
      signal: new AbortController().signal,
    });
    const body = JSON.parse(String(request.init.body));
    expect(body.system[0].text).toMatch(/^x-anthropic-billing-header: cc_version=2\.1\.280\.[0-9a-f]{3}; cc_entrypoint=sdk-cli; cch=[0-9a-f]{5};$/);
    expect(body.system[1].text).toBe("You are Claude Code, Anthropic's official CLI for Claude.");
    const userId = JSON.parse(body.metadata.user_id);
    expect(Object.keys(userId)).toEqual(["device_id", "account_uuid", "session_id"]);
    expect(userId.device_id).toMatch(/^[0-9a-f]{64}$/);
    expect(userId.account_uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(userId.session_id).toBe("session-fixture");
    expect(new Headers(request.init.headers).get("x-claude-code-session-id")).toBe("session-fixture");
    const again = JSON.parse(JSON.parse(String(buildClaudeMessagesRequest(token, {
      model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }], sessionId: "session-fixture",
      signal: new AbortController().signal,
    }).init.body)).metadata.user_id);
    expect(again).toEqual(userId);
  });

  it.each([
    ["claude-opus-5", true], ["claude-sonnet-5", true], ["claude-fable-5-1", false], ["claude-haiku-4-5-20251001", false],
  ] as const)("sends the Claude Code beta set for %s", (model, heavy) => {
    const request = makeRequest({ model });
    const betas = new Headers(request.init.headers).get("anthropic-beta")!.split(",");
    expect(betas).toEqual([
      "claude-code-20250219", "oauth-2025-04-20", "interleaved-thinking-2025-05-14", "context-management-2025-06-27",
      "prompt-caching-scope-2026-01-05", "structured-outputs-2025-12-15", "fast-mode-2026-02-01",
      "redact-thinking-2026-02-12", "token-efficient-tools-2026-03-28",
      ...(heavy ? ["advanced-tool-use-2025-11-20", "effort-2025-11-24"] : []),
    ]);
    const body = JSON.parse(String(request.init.body));
    expect(body.context_management).toBeUndefined();
    expect(body.output_config).toBeUndefined();
    expect(body.speed).toBeUndefined();
  });

  it.each(["claude-opus-5-5", "claude-opus-5", "claude-opus-4-8"])("merges fast mode with OAuth betas and reasoning for %s", (model) => {
    const request = makeRequest({ model, modelParams: { speed: "fast", thinking: "adaptive", reasoningEffort: "max" } });
    expect(JSON.parse(String(request.init.body))).toMatchObject({
      speed: "fast", thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: "max" },
    });
    // Summaries requested: redact-thinking is dropped so thinking text streams.
    const betas = new Headers(request.init.headers).get("anthropic-beta")!.split(",");
    expect(betas).toContain("fast-mode-2026-02-01");
    expect(betas).not.toContain("redact-thinking-2026-02-12");
  });

  it.each([
    ["claude-opus-5-5", "standard"],
    ["claude-opus-4-7", "fast"],
    ["claude-opus-4-6", "fast"],
    ["claude-sonnet-5", "fast"],
  ] as const)("keeps %s at standard speed when %s is selected", (model, speed) => {
    const request = makeRequest({ model, modelParams: { speed } });
    expect(JSON.parse(String(request.init.body))).not.toHaveProperty("speed");
  });

  it("preserves modern and manual reasoning and gates the 1M context beta", () => {
    const modern = makeRequest({ model: "claude-opus-5", modelParams: { thinking: "enabled", reasoningEffort: "high", maxContext: "1m" } });
    const modernBody = JSON.parse(String(modern.init.body));
    expect(modernBody.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(modernBody.output_config).toEqual({ effort: "high" });
    expect(new Headers(modern.init.headers).get("anthropic-beta")).not.toContain("context-1m");

    const legacy = makeRequest({ model: "claude-opus-4-5", maxTokens: 8192, modelParams: { thinking: "enabled", reasoningEffort: "high", maxContext: "1m" } });
    expect(JSON.parse(String(legacy.init.body)).thinking).toEqual({ type: "enabled", budget_tokens: 4096 });
    expect(new Headers(legacy.init.headers).get("anthropic-beta")).not.toContain("context-1m-2025-08-07");
  });

  it("preserves explicit output limits and shared model defaults", () => {
    expect(JSON.parse(String(makeRequest({ maxTokens: 5000 }).init.body)).max_tokens).toBe(5000);
    expect(JSON.parse(String(makeRequest({ maxTokens: 0, model: "claude-opus-5", modelParams: { reasoningEffort: "max" } }).init.body)).max_tokens).toBe(65_536);
    expect(JSON.parse(String(makeRequest({ model: "claude-haiku-4-5" }).init.body)).max_tokens).toBe(8192);
  });
});

describe("Claude OAuth streaming contract", () => {
  it.each([undefined, "fast"] as const)("sends %s speed through the real account router and preserves tool/usage streaming", async (speed) => {
    const model = speed === "fast" ? "claude-opus-5-5" : "claude-sonnet-4-6";
    initOAuth({
      globalState: { get: (key: string, fallback: unknown) => key === "ocursor.oauth.accountIds" ? ["claude-contract"] : fallback },
      secrets: { get: async () => JSON.stringify({
        id: "claude-contract", kind: "claude-code", accessToken: "contract-access", refreshToken: "contract-refresh",
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      }) },
    } as unknown as Parameters<typeof initOAuth>[0]);
    await vi.waitFor(() => expect(isConnected("claude-code")).toBe(true));
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(CLAUDE_OAUTH_CONFIG.messagesUrl);
      const headers = new Headers(init.headers);
      expect(headers.get("authorization")).toBe("Bearer contract-access");
      expect(headers.get("user-agent")).toBe("claude-cli/2.1.280 (external, sdk-cli)");
      const body = JSON.parse(String(init.body));
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0].name).toBe("Read");
      expect(body.speed).toBe(speed);
      expect(headers.get("anthropic-beta")).toContain("fast-mode-2026-02-01");
      return new Response([
        { type: "message_start", message: { id: "request-fixture", model, usage: { input_tokens: 12, cache_read_input_tokens: 4 } } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call-fixture", name: "Read" } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"path":"README.md"}' } },
        { type: "content_block_stop", index: 0 },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Done" } },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } },
        { type: "message_stop" },
      ].map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(""), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const events = [];
    for await (const event of streamOAuthChat("claude-code", {
      model, messages: [{ role: "user", content: "Read the README" }], tools, modelParams: { speed },
      signal: new AbortController().signal,
    })) events.push(event);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({ type: "text-delta", text: "Done" });
    expect(events).toContainEqual({ type: "tool-call", call: { id: "call-fixture", name: "Read", arguments: '{"path":"README.md"}' } });
    const usage = events.filter((event) => event.type === "usage");
    expect(usage.reduce((total, event) => total + (event.promptTokens ?? 0), 0)).toBe(16);
    expect(usage.reduce((total, event) => total + (event.completionTokens ?? 0), 0)).toBe(3);
  });
});
