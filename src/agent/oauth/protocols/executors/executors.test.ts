/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const refreshGoogleToken = vi.hoisted(() => vi.fn());
vi.mock("../services/tokenRefresh.js", async (importOriginal) => ({ ...(await importOriginal<object>()), refreshGoogleToken }));

import { BaseExecutor, abortableSleep } from "./base.js";
import { authorizedUserToken } from "./vertex.js";

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("Vertex authorized_user tokens", () => {
  it("reuses a token until 60 seconds before expiry, keyed by refresh token", async () => {
    let now = 1_000_000;
    refreshGoogleToken.mockImplementation(async (refresh: string) => ({ accessToken: `access-for-${refresh}-${now}`, expiresIn: 3600 }));
    const adc = { refresh_token: "refresh-a", client_id: "client", client_secret: "secret" };
    const first = await authorizedUserToken(adc, undefined, () => now);
    now += 3_500_000;
    expect(await authorizedUserToken(adc, undefined, () => now)).toBe(first);
    expect(await authorizedUserToken({ ...adc, refresh_token: "refresh-b" }, undefined, () => now)).not.toBe(first);
    now += 60_000; // past expires_in - 60s
    expect(await authorizedUserToken(adc, undefined, () => now)).not.toBe(first);
    expect(refreshGoogleToken).toHaveBeenCalledTimes(3);
  });
});

describe("base executor retries", () => {
  it("cancels a 429 body before trying the next base URL", async () => {
    const cancelled = vi.fn();
    const limited = new Response(new ReadableStream({ cancel: cancelled }), { status: 429 });
    const fetch = vi.fn().mockResolvedValueOnce(limited).mockResolvedValueOnce(new Response("ok"));
    vi.stubGlobal("fetch", fetch);
    const executor = new BaseExecutor("fixture", { baseUrls: ["https://one.invalid", "https://two.invalid"], retry: { 429: 0 } });
    const result = await executor.execute({ model: "m", body: {}, stream: true, credentials: {} } as any);
    expect(result.url).toBe("https://two.invalid");
    expect(cancelled).toHaveBeenCalled();
  });

  it("stops a retry wait as soon as the caller aborts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("busy", { status: 503 })));
    const executor = new BaseExecutor("fixture", { baseUrls: ["https://one.invalid"], retry: { 503: { attempts: 3, delayMs: 60_000 } } });
    const abort = new AbortController();
    const started = Date.now();
    const pending = executor.execute({ model: "m", body: {}, stream: true, credentials: {}, signal: abort.signal } as any);
    setTimeout(() => abort.abort(), 20);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(Date.now() - started).toBeLessThan(5_000);
    await expect(abortableSleep(10, AbortSignal.abort())).rejects.toBeDefined();
  });
});

describe("OpenCode v2 free lane (9router parity)", async () => {
  const { OpenCodeExecutor, OPENCODE_SESSION_RE, generateSessionId, translateSessionId } = await import("./opencode.js");
  const executor = new OpenCodeExecutor();

  it("routes every model family to /inference/v1", () => {
    expect(executor.buildUrl("muse-spark-1.3-contributor-free")).toBe("https://opencode.ai/inference/v1/responses");
    expect(executor.buildUrl("union-alpha")).toBe("https://opencode.ai/inference/v1/messages");
    expect(executor.buildUrl("some-chat-model")).toBe("https://opencode.ai/inference/v1/chat/completions");
  });

  it("sends the v2 CLI identity and mirrors the session across all session headers", () => {
    const headers = executor.buildHeaders({ rawHeaders: { "user-agent": "opencode/1.18.31" } }, true, "https://opencode.ai/inference/v1/messages");
    expect(headers["User-Agent"]).toBe("opencode/latest/2.0.26/cli");
    expect(headers["x-opencode-client"]).toBe("cli");
    expect(headers["x-opencode-session"]).toMatch(OPENCODE_SESSION_RE);
    for (const name of ["x-opencode-session-id", "x-session-affinity", "x-session-id"]) expect(headers[name]).toBe(headers["x-opencode-session"]);
    expect(headers).not.toHaveProperty("x-opencode-request");
    expect(headers["anthropic-version"]).toBeDefined();
    expect(executor.buildHeaders({ rawHeaders: { "User-Agent": "opencode/latest/2.1.0/desktop" } })["User-Agent"]).toBe("opencode/latest/2.1.0/desktop");
  });

  it("mints current-time session ids and memoizes translated ones per conversation", () => {
    const now = Date.now();
    const id = generateSessionId(now);
    const prefix = BigInt(`0x${id.slice(4, 16)}`);
    expect(((~prefix) & ((1n << 48n) - 1n)) >> 12n).toBe(BigInt(now) & ((1n << 36n) - 1n));
    const a = translateSessionId("conv-1", "claude");
    expect(a).toMatch(OPENCODE_SESSION_RE);
    expect(translateSessionId("conv-1", "claude")).toBe(a);
    expect(translateSessionId("conv-2", "claude")).not.toBe(a);
  });

  it("drops adaptive reasoning_effort on the chat lane", () => {
    const body = executor.transformRequest("some-chat-model", { messages: [], reasoning_effort: "auto" }) as Record<string, unknown>;
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body.stream).toBe(true);
  });
});

describe("OpenCode Zen free-tier identity", async () => {
  const { OpenCodeZenExecutor } = await import("./opencode-zen.js");
  it("switches -free models to Bearer public with a request id", () => {
    const executor = new OpenCodeZenExecutor();
    const free = executor.buildHeaders({ apiKey: "oc_sk_x" }, true, "", "mimo-v2.6-flash-free");
    expect(free.Authorization).toBe("Bearer public");
    expect(free["x-opencode-request"]).toMatch(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    expect(free["x-opencode-project"]).toBe("global");
    const paid = executor.buildHeaders({ apiKey: "oc_sk_x" }, true, "", "big-pickle");
    expect(paid.Authorization).toBe("Bearer oc_sk_x");
    expect(paid).not.toHaveProperty("x-opencode-request");
  });
});

describe("Vertex raw API key URLs", () => {
  it("uses the project-scoped path when a project is configured", async () => {
    const { VertexExecutor } = await import("./vertex.js");
    const executor = new VertexExecutor();
    expect(executor.buildUrl("gemini-x", false, 0, { apiKey: "k", providerSpecificData: { projectId: "p" } }))
      .toBe("https://aiplatform.googleapis.com/v1/projects/p/locations/global/publishers/google/models/gemini-x:generateContent?key=k");
    expect(executor.buildUrl("gemini-x", true, 0, { apiKey: "k" }))
      .toBe("https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-x:streamGenerateContent?alt=sse&key=k");
  });
});

describe("CodeBuddy 6004 quota errors", () => {
  it("maps the frequency limit to 429 with its reset time", async () => {
    const { CodeBuddyExecutor } = await import("./codebuddy-cn.js");
    const parsed = new CodeBuddyExecutor().parseError(new Response("", { status: 400 }), JSON.stringify({ code: 6004, msg: "超出频率限制, 2026-10-27 08:00:00 UTC+8" })) as { status: number; resetsAtMs?: number | null };
    expect(parsed.status).toBe(429);
    expect(parsed.resetsAtMs).toBe(Date.parse("2026-10-27T00:00:00Z"));
  });
});
