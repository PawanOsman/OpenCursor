/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OAuthAccount, OAuthKind } from "./oauth/types";

vi.mock("vscode", () => ({ EventEmitter: class { event = () => ({ dispose() {} }); fire() {} } }));
vi.mock("../stores/featureStore", () => ({ MODEL_CATALOG: [] }));
import { disconnect, getAccountLimits, initOAuth, isConnected, listAccounts, listOAuthModels, setAccountEnabled, streamOAuthChat } from "./oauth";
import { buildMessages } from "./messages";

const saved = new Map<string, string>();
const sse = (kind: OAuthKind) => new Response(`data: ${JSON.stringify(kind === "codex"
  ? { type: "response.completed", response: { status: "completed" } }
  : kind === "claude-code" ? { type: "message_stop" }
  : { response: { candidates: [{ content: { parts: [{ text: "Done" }] }, finishReason: "STOP" }] } })}\n\n`);
const jwt = (claims: object) => `fixture.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.fixture`;
const headers = (init?: RequestInit) => new Headers(init?.headers);
const body = (init?: RequestInit) => JSON.parse(String(init?.body));

async function seed(kind: OAuthKind = "codex", extra: Partial<OAuthAccount> = {}, additional: OAuthAccount[] = []) {
  const account: OAuthAccount = { id: `transport-${kind}`, kind, accessToken: "old-access", refreshToken: "old-refresh",
    expiresAt: Date.now() + 3_600_000, accountId: "workspace-one", projectId: "project-one", ...extra };
  const fixtures = [account, ...additional];
  for (const fixture of fixtures) saved.set(`ocursor.oauth.acct.${fixture.id}`, JSON.stringify(fixture));
  initOAuth({ globalState: { get: (_key: string, fallback: unknown) => Array.isArray(fallback) ? fixtures.map(fixture => fixture.id) : fallback, update: vi.fn() },
    secrets: { get: async (key: string) => saved.get(key), store: async (key: string, value: string) => { saved.set(key, value); },
      delete: async (key: string) => { saved.delete(key); } } } as unknown as Parameters<typeof initOAuth>[0]);
  await vi.waitFor(() => expect(isConnected(kind)).toBe(true));
  return account;
}

async function chat(kind: OAuthKind = "codex", signal = new AbortController().signal) {
  const events = [];
  for await (const event of streamOAuthChat(kind, { model: kind === "codex" ? "gpt-5.6-sol" : kind === "claude-code" ? "claude-sonnet-4-6" : "gemini-3-flash",
    messages: [{ role: "user", content: "Hello" }], promptCacheKey: "conversation", signal })) events.push(event);
  return events;
}

async function antigravityChat(model: string) {
  for await (const _event of streamOAuthChat("antigravity", { model, messages: [{ role: "user", content: "Hello" }], signal: new AbortController().signal })) { /* consume */ }
}

beforeEach(async () => {
  for (const account of listAccounts()) await disconnect(account.id);
  saved.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("OAuth account transport", () => {
  it("discovers real Antigravity models without quota fields, keeps only supported aliases, and sends clean IDs", async () => {
    await seed("antigravity");
    const sent: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("fetchAvailableModels")) return Response.json({ models: {
        "gemini-3.8-flash-high": {}, "gemini-3.8-flash-medium": { quotaInfo: {} },
        "gemini-3.8-flash-low": { isInternal: true },
      } });
      sent.push(body(init));
      return sse("antigravity");
    }));
    const models = await listOAuthModels("antigravity");
    expect(models).toEqual(["gemini-3.8-flash-high", "gemini-3.8-flash-medium", "gemini-3.8-flash"]);
    await antigravityChat("gemini-3.8-flash-high");
    await antigravityChat("gemini-3.8-flash");
    expect(sent.map(request => request.model)).toEqual(["gemini-3.8-flash-high", "gemini-3.8-flash-medium"]);
    expect(sent.map(request => request.request.generationConfig.thinkingConfig.thinkingLevel)).toEqual(["high", "medium"]);
  });

  it("keeps a valid empty Antigravity catalog empty, including a later temporary discovery failure", async () => {
    await seed("antigravity");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ models: {} })).mockResolvedValueOnce(new Response("unavailable", { status: 503 })));
    expect(await listOAuthModels("antigravity")).toEqual([]);
    expect(await listOAuthModels("antigravity")).toEqual([]);
  });

  it("binds advertised raw IDs to their account, never another account's alias cache", async () => {
    const second: OAuthAccount = { id: "antigravity-second", kind: "antigravity", accessToken: "second-access", refreshToken: "second-refresh", expiresAt: Date.now() + 3_600_000, projectId: "project-two" };
    const first = await seed("antigravity", {}, [second]);
    const sent: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("fetchAvailableModels")) return Response.json({ models: body(init).project === "project-one" ? { "gemini-3.7-flash-high": {} } : { "gemini-3.7-flash-tiered": {} } });
      sent.push(body(init));
      return sse("antigravity");
    }));
    expect(await listOAuthModels("antigravity")).toContain("gemini-3.7-flash-high");
    await setAccountEnabled(first.id, false);
    expect(await listOAuthModels("antigravity")).toContain("gemini-3.7-flash-low");
    await antigravityChat("gemini-3.7-flash-high");
    await setAccountEnabled(first.id, true);
    await setAccountEnabled(second.id, false);
    await antigravityChat("gemini-3.7-flash-high");
    expect(sent.map(request => [request.project, request.model])).toEqual([
      ["project-two", "gemini-3.7-flash-tiered"], ["project-one", "gemini-3.7-flash-high"],
    ]);
  });

  it("invalidates the old catalog when404 recovery changes the account project", async () => {
    await seed("antigravity");
    const sent: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("fetchAvailableModels")) return Response.json({ models: body(init).project === "project-one" ? { "gemini-3.7-flash-high": {} } : { "gemini-3.7-flash-tiered": {} } });
      if (url.includes("loadCodeAssist")) return Response.json({ cloudaicompanionProject: "project-two" });
      sent.push(body(init));
      return sent.length === 1 ? new Response("missing", { status: 404 }) : sse("antigravity");
    }));
    await listOAuthModels("antigravity");
    await antigravityChat("gemini-3.7-flash-high");
    expect(sent.map(request => [request.project, request.model])).toEqual([
      ["project-one", "gemini-3.7-flash-high"], ["project-two", "gemini-3.7-flash-tiered"],
    ]);
  });

  it("invalidates a credential's catalog after token rotation", async () => {
    await seed("antigravity");
    const sent: any[] = [];
    let catalogCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("fetchAvailableModels")) { catalogCalls++; return Response.json({ models: { "gemini-3.7-flash-high": {} } }); }
      if (url.includes("/token")) return Response.json({ access_token: "rotated-access", refresh_token: "rotated-refresh", expires_in: 3600 });
      sent.push(body(init));
      return sent.length === 1 ? new Response("expired", { status: 401 }) : sse("antigravity");
    }));
    await listOAuthModels("antigravity");
    await antigravityChat("gemini-3.7-flash-high");
    await antigravityChat("gemini-3.7-flash-high");
    expect(sent.map(request => request.model)).toEqual(["gemini-3.7-flash-high", "gemini-3.7-flash-high", "gemini-3.7-flash-high"]);
    expect(catalogCalls).toBe(2);
  });

  it("expires the catalog after five minutes and clears it on context reinitialization", async () => {
    await seed("antigravity");
    const sent: any[] = [];
    let catalogCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("fetchAvailableModels")) { catalogCalls++; return Response.json({ models: { "gemini-3.7-flash-high": {} } }); }
      sent.push(body(init));
      return sse("antigravity");
    }));
    await listOAuthModels("antigravity");
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5 * 60_000 + 1);
    try { await antigravityChat("gemini-3.7-flash-high"); } finally { clock.mockRestore(); }
    await listOAuthModels("antigravity");
    await seed("antigravity");
    await antigravityChat("gemini-3.7-flash-high");
    expect(sent.map(request => request.model)).toEqual(["gemini-3.7-flash-high", "gemini-3.7-flash-high"]);
    expect(catalogCalls).toBe(4);
  });

  it("binds discovery to the refreshed credential when its first catalog request returned401", async () => {
    await seed("antigravity");
    const sent: any[] = [];
    let catalogCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("fetchAvailableModels")) return ++catalogCalls === 1 ? new Response("expired", { status: 401 }) : Response.json({ models: { "gemini-3.7-flash-high": {} } });
      if (url.includes("/token")) return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 });
      sent.push(body(init));
      return sse("antigravity");
    }));
    expect(await listOAuthModels("antigravity")).toEqual(["gemini-3.7-flash-high"]);
    await antigravityChat("gemini-3.7-flash-high");
    expect(sent[0].model).toBe("gemini-3.7-flash-high");
    expect(catalogCalls).toBe(2);
  });

  it("falls back from failed ambiguous-alias discovery without an extra generation retry", async () => {
    await seed("antigravity");
    const sent: any[] = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("fetchAvailableModels")) return new Response("unavailable", { status: 503 });
      sent.push(body(init));
      return sse("antigravity");
    });
    vi.stubGlobal("fetch", fetch);
    await antigravityChat("gemini-3.7-flash-high");
    expect(sent[0].model).toBe("gemini-3.7-flash-tiered");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("refreshes the full404 catalog and identifies the selected unavailable model", async () => {
    await seed("antigravity");
    let generations = 0;
    const ids = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`available-${index}`, {}]));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("loadCodeAssist")) return Response.json({ cloudaicompanionProject: "project-one" });
      if (url.includes("fetchAvailableModels")) return Response.json({ models: { ...ids, "gemini-3.7-flash-high": {}, internal: { isInternal: true } } });
      return ++generations === 1 ? new Response("missing", { status: 404 }) : sse("antigravity");
    }));
    await expect(antigravityChat("selected-unavailable")).rejects.toMatchObject({ status: 404, message: expect.stringContaining('model "selected-unavailable"') });
    // The raw ID beyond the old 12-entry diagnostic truncation is cached too.
    const sent: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => { sent.push(body(init)); return sse("antigravity"); }));
    await antigravityChat("gemini-3.7-flash-high");
    expect(sent[0].model).toBe("gemini-3.7-flash-high");
  });

  it("refreshes a stale Antigravity project once after404 and retries only the newly resolved project", async () => {
    const account = await seed("antigravity");
    const projects: string[] = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("loadCodeAssist")) return Response.json({ cloudaicompanionProject: "current-project" });
      projects.push(body(init).project);
      return projects.length === 1 ? new Response("not found", { status: 404 }) : sse("antigravity");
    });
    vi.stubGlobal("fetch", fetch);
    await chat("antigravity");
    expect(projects).toEqual(["project-one", "current-project"]);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(JSON.parse(saved.get(`ocursor.oauth.acct.${account.id}`)!)).toMatchObject({ projectId: "current-project" });
  });

  it("does not retry an unavailable Antigravity model when the authoritative project is unchanged", async () => {
    await seed("antigravity");
    const fetch = vi.fn(async (url: string) => url.includes("loadCodeAssist") ? Response.json({ cloudaicompanionProject: "project-one" })
      : url.includes("fetchAvailableModels") ? Response.json({ models: { "actual-model": {} } }) : new Response("model missing", { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    await expect(chat("antigravity")).rejects.toMatchObject({ status: 404, message: expect.stringContaining("actual-model") });
    expect(fetch.mock.calls.filter(([url]) => url.includes("streamGenerateContent"))).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("preserves a real Gemini call signature through the agent history and next request", async () => {
    await seed("antigravity");
    const sent: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      sent.push(body(init));
      return sent.length === 1 ? new Response(`data: ${JSON.stringify({ response: { candidates: [{ content: { parts: [{
        thoughtSignature: "original-signature", functionCall: { name: "Read", args: { path: "file.ts" } },
      }] }, finishReason: "STOP" }] } })}\n\n`) : sse("antigravity");
    }));
    const first = await chat("antigravity");
    const call = first.find((event) => event.type === "tool-call");
    expect(call?.type).toBe("tool-call");
    if (call?.type !== "tool-call") throw new Error("Missing tool call");
    const messages = buildMessages("system", [{ kind: "user", text: "Read file.ts" },
      { kind: "assistant", text: "", calls: [call.call] },
      { kind: "tool-result", callId: call.call.id, name: "Read", output: "contents", status: "completed" }]);
    for await (const _event of streamOAuthChat("antigravity", { model: "gemini-3-flash", messages, signal: new AbortController().signal })) { /* consume */ }
    const replay = sent[1].request.contents.flatMap((message: any) => message.parts).find((part: any) => part.functionCall);
    expect(replay).toMatchObject({ thoughtSignature: "original-signature", functionCall: { id: call.call.id, name: "Read", args: { path: "file.ts" } } });
  });

  it("provisions and saves a missing Google project before generating", async () => {
    const account = await seed("antigravity", { projectId: undefined });
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(url);
      if (url.includes("loadCodeAssist")) return Response.json({ allowedTiers: [{ id: "free-tier", isDefault: true }] });
      if (url.includes("onboardUser")) return Response.json({ done: true, response: { cloudaicompanionProject: { id: "provisioned-project" } } });
      expect(body(init).project).toBe("provisioned-project");
      return sse("antigravity");
    }));
    await chat("antigravity");
    expect(urls.map((url) => url.split(":").at(-1))).toEqual(["loadCodeAssist", "onboardUser", "streamGenerateContent?alt=sse"]);
    expect(JSON.parse(saved.get(`ocursor.oauth.acct.${account.id}`)!)).toMatchObject({ projectId: "provisioned-project" });
  });

  it.each(["codex", "claude-code", "antigravity"] as const)("refreshes a rejected %s token once using its native encoding", async (kind) => {
    const account = await seed(kind);
    const sent: RequestInit[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/token")) {
        expect(headers(init).get("accept")).toBe("application/json");
        const data = kind === "antigravity" ? Object.fromEntries(new URLSearchParams(String(init?.body))) : body(init);
        expect(data).toMatchObject({ grant_type: "refresh_token", refresh_token: "old-refresh" });
        expect(headers(init).get("content-type")).toBe(kind === "antigravity" ? "application/x-www-form-urlencoded" : "application/json");
        return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 });
      }
      sent.push(init!);
      return sent.length === 1 ? new Response("expired", { status: 401 }) : sse(kind);
    });
    vi.stubGlobal("fetch", fetchMock);
    await chat(kind);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(headers(sent[0]).get("authorization")).toBe("Bearer old-access");
    expect(headers(sent[1]).get("authorization")).toBe("Bearer new-access");
    expect(sent[1].body).toBe(sent[0].body);
    expect(JSON.parse(saved.get(`ocursor.oauth.acct.${account.id}`)!)).toMatchObject({ accessToken: "new-access", refreshToken: "new-refresh" });
  });

  it("shares a rotated token across simultaneous rejected requests", async () => {
    await seed();
    let refreshes = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/token")) {
        refreshes++;
        await gate;
        return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 });
      }
      return headers(init).get("authorization") === "Bearer old-access" ? new Response("expired", { status: 401 }) : sse("codex");
    });
    vi.stubGlobal("fetch", fetchMock);
    const requests = [chat(), chat()];
    await vi.waitFor(() => expect(refreshes).toBe(1));
    release();
    await Promise.all(requests);
    expect(refreshes).toBe(1);
  });

  it.each([401, 403])("does not loop or bypass a final HTTP %s", async (status) => {
    await seed();
    const fetchMock = vi.fn(async (url: string) => url.includes("/token")
      ? Response.json({ access_token: "new-access", expires_in: 3600 }) : new Response("rejected", { status }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chat()).rejects.toMatchObject({ status });
    expect(fetchMock).toHaveBeenCalledTimes(status === 401 ? 3 : 1);
  });

  it("keeps existing credentials when a refresh response is malformed", async () => {
    const account = await seed("codex", { expiresAt: Date.now() - 1 });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ refresh_token: "do-not-save", expires_in: 3600 })));
    await expect(chat()).rejects.toThrow("access token");
    expect(JSON.parse(saved.get(`ocursor.oauth.acct.${account.id}`)!)).toMatchObject({ accessToken: "old-access", refreshToken: "old-refresh" });
  });

  it("refreshes workspace identity and uses it for chat and quota requests", async () => {
    await seed("codex", { expiresAt: Date.now() - 1 });
    const sent: RequestInit[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/token")) return Response.json({ access_token: "new-access", expires_in: 3600,
        id_token: jwt({ email: "fixture@example.invalid", "https://api.openai.com/auth": { chatgpt_account_id: "workspace-two" } }) });
      sent.push(init!);
      return url.includes("/usage") ? Response.json({}) : sse("codex");
    }));
    await chat();
    await getAccountLimits("transport-codex");
    expect(sent).toHaveLength(2);
    expect(sent.every((init) => headers(init).get("chatgpt-account-id") === "workspace-two")).toBe(true);
  });

  it("does not resurrect an account removed during refresh", async () => {
    const account = await seed("codex", { expiresAt: Date.now() - 1 });
    let release!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const request = chat();
    const rejected = expect(request).rejects.toThrow("no longer connected");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await disconnect(account.id);
    release(Response.json({ access_token: "new-access", expires_in: 3600 }));
    await rejected;
    expect(listAccounts()).toEqual([]);
    expect(saved.has(`ocursor.oauth.acct.${account.id}`)).toBe(false);
  });

  it("cancels a waiting chat while allowing a shared refresh to persist safely", async () => {
    const account = await seed("codex", { expiresAt: Date.now() - 1 });
    let release!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const request = chat("codex", controller.signal);
    const rejected = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await setAccountEnabled(account.id, false);
    controller.abort();
    await rejected;
    release(Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }));
    await vi.waitFor(() => expect(JSON.parse(saved.get(`ocursor.oauth.acct.${account.id}`)!)).toMatchObject({ accessToken: "new-access", disabled: true }));
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
