/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OAuthAccount, OAuthBalanceStrategy, OAuthKind } from "./oauth/types";
import type { ProviderEvent, WireMessage } from "./types";

vi.mock("vscode", () => ({ EventEmitter: class { event = () => ({ dispose() {} }); fire() {} } }));
vi.mock("../stores/featureStore", () => ({ MODEL_CATALOG: [] }));
import { disconnect, initOAuth, listAccounts, setAccountEnabled, streamOAuthChat, getBalanceStrategy, setBalanceStrategy, getStatus } from "./oauth";
import { streamChat } from "./provider";

const secrets = new Map<string, string>();
const state = new Map<string, unknown>();
const frames = (...events: unknown[]) => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""));
const success = (kind: OAuthKind) => kind === "codex"
  ? frames({ type: "response.output_text.delta", delta: "Done" }, { type: "response.completed", response: { status: "completed" } })
  : kind === "claude-code" ? frames({ type: "content_block_delta", delta: { type: "text_delta", text: "Done" } }, { type: "message_stop" })
  : frames({ response: { candidates: [{ content: { parts: [{ text: "Done" }] }, finishReason: "STOP" }] } });
const token = (init?: RequestInit) => new Headers(init?.headers).get("authorization")?.replace("Bearer ", "");

async function seed(kind: OAuthKind, options: { strategy?: OAuthBalanceStrategy; accounts?: Partial<OAuthAccount>[] } = {}) {
  const entries: OAuthAccount[] = (options.accounts ?? [{}, {}]).map((extra, i) => ({
    id: `pool-${kind}-${i}`, kind, accessToken: `token-${i}`, refreshToken: "", expiresAt: Date.now() + 3_600_000,
    accountId: `workspace-${i}`, projectId: `project-${i}`, ...extra,
  }));
  for (const account of entries) secrets.set(`ocursor.oauth.acct.${account.id}`, JSON.stringify(account));
  state.set("ocursor.oauth.accountIds", entries.map(account => account.id));
  state.set("ocursor.oauth.balanceStrategy", options.strategy ?? "first");
  initOAuth({ globalState: { get: (key: string, fallback: unknown) => state.get(key) ?? fallback, update: async (key: string, value: unknown) => { state.set(key, value); } },
    secrets: { get: async (key: string) => secrets.get(key), store: async (key: string, value: string) => { secrets.set(key, value); }, delete: async (key: string) => { secrets.delete(key); } },
  } as unknown as Parameters<typeof initOAuth>[0]);
  await vi.waitFor(() => expect(listAccounts()).toHaveLength(entries.length));
  return entries;
}

function options(kind: OAuthKind, signal = new AbortController().signal) {
  return { model: kind === "codex" ? "gpt-6-sol" : kind === "claude-code" ? "claude-opus-5-5" : "gemini-3-flash",
    messages: [{ role: "user" as const, content: "Inspect the file" }], signal };
}

async function chat(kind: OAuthKind, events: ProviderEvent[] = [], signal?: AbortSignal) {
  for await (const event of streamOAuthChat(kind, options(kind, signal))) events.push(event);
  return events;
}

beforeEach(async () => {
  for (const account of listAccounts()) await disconnect(account.id);
  secrets.clear(); state.clear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("OAuth account failover", () => {
  it("persists independent per-kind strategies and leaves unrelated account pools on their own setting", async () => {
    await seed("codex");
    await Promise.all([setBalanceStrategy("round-robin", "codex"), setBalanceStrategy("first", "claude-code")]);
    expect(getBalanceStrategy("codex")).toBe("round-robin");
    expect(getBalanceStrategy("claude-code")).toBe("first");
    expect(getStatus().balanceStrategies).toMatchObject({ codex: "round-robin", "claude-code": "first" });
    expect(state.get("ocursor.oauth.balanceStrategy.byKind")).toEqual({ codex: "round-robin", "claude-code": "first" });
    const fetch = vi.fn(async () => success("codex")); vi.stubGlobal("fetch", fetch);
    await chat("codex"); await chat("codex");
    expect(fetch.mock.calls.map((call: unknown[]) => token(call[1] as RequestInit))).toEqual(["token-0", "token-1"]);
    await expect(setBalanceStrategy("first", "unknown" as OAuthKind)).rejects.toThrow("Unsupported");
  });

  it("does not advertise quota-based balancing for providers without live quota support", async () => {
    await seed("codex", { strategy: "highest-limit" });
    expect(getBalanceStrategy("codex")).toBe("highest-limit");
    expect(getBalanceStrategy("github")).toBe("first");
    state.set("ocursor.oauth.balanceStrategy.byKind", { github: "nearest-reset" });
    expect(getStatus().balanceStrategies?.github).toBe("first");
    await expect(setBalanceStrategy("highest-limit", "github")).rejects.toThrow("does not report account quota");
    await setBalanceStrategy("round-robin", "github");
    expect(getBalanceStrategy("github")).toBe("round-robin");
  });
  it("scopes encrypted Codex history to the actual account across round-robin tool turns", async () => {
    // A shared upstream workspace must not make distinct local credentials equivalent.
    const accounts = await seed("codex", { strategy: "round-robin", accounts: [{ accountId: "shared-workspace" }, { accountId: "shared-workspace" }] });
    const item = { type: "reasoning", id: "rs_account", summary: [], encrypted_content: "opaque-account-state" };
    const sent: { token: string; input: unknown[] }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      sent.push({ token: token(init)!, input: JSON.parse(String(init?.body)).input });
      return sent.length === 1 ? frames({ type: "response.completed", response: { status: "completed", output: [item,
        { type: "message", id: "msg_read", content: [{ type: "output_text", text: "Reading" }] },
        { type: "function_call", id: "fc_read", call_id: "call_read", name: "Read", arguments: "{}" },
      ] } }) : success("codex");
    }));
    const first = await chat("codex");
    const metadata = first.find(event => event.type === "responses-reasoning");
    expect(metadata).toEqual({ type: "responses-reasoning", reasoning: {
      provider: "codex", model: "gpt-6-sol", credential: accounts[0].id, items: [item],
    } });
    if (metadata?.type !== "responses-reasoning") throw new Error("Missing reasoning metadata");
    const messages: WireMessage[] = [
      { role: "assistant", content: "Reading", responsesReasoning: metadata.reasoning, tool_calls: [{ id: "call_read", type: "function", function: { name: "Read", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_read", content: "File contents" },
    ];
    const original = structuredClone(messages);
    for (let i = 0; i < 2; i++) for await (const _event of streamOAuthChat("codex", { ...options("codex"), messages })) { /* consume */ }
    const portable = [
      { role: "assistant", content: [{ type: "output_text", text: "Reading" }] },
      { type: "function_call", call_id: "call_read", name: "Read", arguments: "{}" },
      { type: "function_call_output", call_id: "call_read", output: "File contents" },
    ];
    expect(sent.map(request => request.token)).toEqual(["token-0", "token-1", "token-0"]);
    expect(sent[1].input).toEqual(portable);
    expect(sent[2].input).toEqual([item, ...portable]);
    expect(messages).toEqual(original);
    expect(JSON.stringify(metadata)).not.toContain("token-0");
  });

  it.each(["codex", "claude-code", "antigravity"] as const)("fails over account-specific HTTP errors and network failures for %s", async kind => {
    for (const status of [401, 403, 429, 503, "network"] as const) {
      for (const account of listAccounts()) await disconnect(account.id);
      await seed(kind);
      const seen: string[] = [];
      vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
        seen.push(token(init)!);
        if (token(init) === "token-0") {
          if (status === "network") throw new TypeError("fetch failed");
          return new Response("account unavailable", { status });
        }
        return success(kind);
      }));
      const events = await chat(kind);
      expect(seen).toEqual(["token-0", "token-1"]);
      expect(events.filter(event => event.type === "text-delta").map(event => event.text).join("")).toBe("Done");
    }
  });

  it.each([false, true])("moves past a failed refresh, initially expired=%s", async expired => {
    await seed("codex", { accounts: [{ refreshToken: "invalid-refresh", ...(expired ? { expiresAt: Date.now() - 1 } : {}) }, {}] });
    const seen: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/token")) { seen.push("refresh"); return new Response("invalid_grant", { status: 400 }); }
      seen.push(token(init)!);
      return token(init) === "token-0" ? new Response("expired", { status: 401 }) : success("codex");
    });
    vi.stubGlobal("fetch", fetchMock);
    await chat("codex");
    expect(seen).toEqual(expired ? ["refresh", "token-1"] : ["token-0", "refresh", "token-1"]);
  });

  it("skips disabled accounts and different provider kinds", async () => {
    await seed("codex", { accounts: [{ disabled: true }, { kind: "claude-code" }, {}, {}] });
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      seen.push(token(init)!);
      return token(init) === "token-2" ? new Response("busy", { status: 503 }) : success("codex");
    }));
    await chat("codex");
    expect(seen).toEqual(["token-2", "token-3"]);
  });

  it("exhausts each account once and prevents the outer retry loop from restarting the pool", async () => {
    await seed("codex");
    const fetchMock = vi.fn(async () => new Response("still overloaded", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const onRetry = vi.fn();
    const run = async () => { for await (const _event of streamChat({ ...options("codex"), oauthKind: "codex", apiBaseUrl: "", apiKey: "", maxRetries: 5, onRetry })) { /* consume */ } };
    await expect(run()).rejects.toMatchObject({ status: 503, retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onRetry).not.toHaveBeenCalled();
    await expect(chat("codex")).rejects.toMatchObject({ status: 429, retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([400, 404, 422])("never switches accounts for request HTTP %s", async status => {
    await seed("codex");
    const fetchMock = vi.fn(async () => new Response("invalid model/options", { status }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chat("codex")).rejects.toMatchObject({ status, retryable: false });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    { type: "content_block_delta", delta: { type: "text_delta", text: "Started" } },
    { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "Thinking" } },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "write", name: "Write" } },
  ])("never replays after response progress: %j", async progress => {
    await seed("claude-code");
    const fetchMock = vi.fn(async () => frames(progress, { type: "error", error: { type: "overloaded_error", message: "interrupted" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chat("claude-code")).rejects.toMatchObject({ status: 529, retryable: false });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not fail over a streamed invalid request and preserves its actual status", async () => {
    await seed("claude-code");
    const fetchMock = vi.fn(async () => frames({ type: "error", error: { type: "invalid_request_error", message: "unsupported thinking" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chat("claude-code")).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    { type: "error", code: "invalid_request_error", message: "invalid option" },
    { type: "response.failed", response: { error: { code: "invalid_prompt", message: "bad prompt" } } },
    { type: "response.done", response: { status: "failed", error: { code: "context_length_exceeded", message: "context limit" } } },
  ])("does not fail over malformed Codex requests reported inside a200stream: %j", async terminal => {
    await seed("codex");
    const fetchMock = vi.fn(async () => frames(terminal));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chat("codex")).rejects.toMatchObject({ status: 400, retryable: false });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("accounts usage-only failures separately before switching", async () => {
    await seed("claude-code");
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => token(init) === "token-0"
      ? frames({ type: "message_start", message: { usage: { input_tokens: 10 } } }, { type: "error", error: { type: "overloaded_error" } })
      : frames({ type: "message_start", message: { usage: { input_tokens: 20 } } }, { type: "content_block_delta", delta: { type: "text_delta", text: "Done" } }, { type: "message_stop" })));
    const events: ProviderEvent[] = [];
    for await (const event of streamChat({ ...options("claude-code"), oauthKind: "claude-code", apiBaseUrl: "", apiKey: "" })) events.push(event);
    const usage = events.filter(event => event.type === "usage");
    expect(usage.reduce((sum, event) => sum + (event.promptTokens ?? 0), 0)).toBe(30);
    expect(new Set(usage.map(event => event.requestId)).size).toBe(2);
  });

  it("stops immediately on cancellation instead of moving to another account", async () => {
    await seed("codex");
    const abort = new AbortController();
    const fetchMock = vi.fn(async () => { abort.abort(); throw abort.signal.reason; });
    vi.stubGlobal("fetch", fetchMock);
    await expect(chat("codex", [], abort.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("honors Retry-After cooldown and makes the first account eligible after it expires", async () => {
    await seed("codex");
    vi.useFakeTimers({ toFake: ["Date"] });
    const started = Date.now();
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      seen.push(token(init)!);
      return seen.length === 1 ? new Response("limit", { status: 429, headers: { "retry-after": "120" } }) : success("codex");
    }));
    await chat("codex");
    vi.setSystemTime(started + 60_000); await chat("codex");
    vi.setSystemTime(started + 121_000); await chat("codex");
    expect(seen).toEqual(["token-0", "token-1", "token-1", "token-0"]);
  });

  it("preserves Retry-After across the reference transport and OAuth account pool", async () => {
    await seed("kilocode");
    vi.useFakeTimers({ toFake: ["Date"] });
    const started = Date.now();
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      seen.push(token(init)!);
      return seen.length === 1 ? new Response("limit", { status: 429, headers: { "retry-after": "120" } })
        : frames({ choices: [{ index: 0, delta: { content: "Done" }, finish_reason: "stop" }] });
    }));
    await chat("kilocode");
    vi.setSystemTime(started + 60_000); await chat("kilocode");
    vi.setSystemTime(started + 121_000); await chat("kilocode");
    expect(seen).toEqual(["token-0", "token-1", "token-1", "token-0"]);
  });

  it("rechecks enabled state after refresh before sending generation", async () => {
    const [first] = await seed("codex", { accounts: [{ expiresAt: Date.now() - 1, refreshToken: "refresh" }, {}] });
    let release!: (response: Response) => void;
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/token")) return new Promise<Response>(resolve => { release = resolve; });
      seen.push(token(init)!); return Promise.resolve(success("codex"));
    }));
    const running = chat("codex");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await setAccountEnabled(first.id, false);
    release(Response.json({ access_token: "rotated", expires_in: 3600 }));
    await running;
    expect(seen).toEqual(["token-1"]);
    expect(listAccounts().find(account => account.id === first.id)?.disabled).toBe(true);
  });

  it("rotates initial choices fairly without changing fallback order", async () => {
    await seed("codex", { strategy: "round-robin", accounts: [{}, {}, {}] });
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => { seen.push(token(init)!); return success("codex"); }));
    for (let i = 0; i < 4; i++) await chat("codex");
    expect(seen).toEqual(["token-0", "token-1", "token-2", "token-0"]);
  });

  it.each(["highest-limit", "nearest-reset"] as const)("retains %s ranking with same-kind failover", async strategy => {
    await seed("codex", { strategy });
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const first = token(init) === "token-0";
      if (url.includes("/usage")) return Response.json({ rate_limit: { primary_window: { used_percent: first ? 70 : 10, reset_at: Math.floor(Date.now() / 1000) + (first ? 1000 : 100) } } });
      seen.push(token(init)!);
      return first ? success("codex") : new Response("busy", { status: 503 });
    }));
    await chat("codex");
    expect(seen).toEqual(["token-1", "token-0"]);
  });
});
