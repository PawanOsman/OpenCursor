/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { createHash } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OAuthStatus } from "./oauth/types";

interface CallbackResponse {
  status?: number;
  body?: string;
  writeHead: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}
interface TestServer {
  handler: (request: { url: string }, response: CallbackResponse) => Promise<void>;
  close: ReturnType<typeof vi.fn>;
  listening: boolean;
}
const mocks = vi.hoisted(() => ({
  openExternal: vi.fn(), statuses: [] as OAuthStatus[], servers: [] as TestServer[],
  listenError: undefined as (Error & { code?: string }) | undefined,
  deferListen: false,
}));

vi.mock("vscode", () => ({
  env: { openExternal: mocks.openExternal },
  Uri: { parse: (value: string) => ({ toString: () => value }) },
  EventEmitter: class { event = () => ({ dispose() {} }); fire(status: OAuthStatus) { mocks.statuses.push(status); } },
}));
vi.mock("../stores/featureStore", () => ({ MODEL_CATALOG: [] }));
vi.mock("http", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    createServer: vi.fn((handler: TestServer["handler"]) => {
      class Server extends EventEmitter implements TestServer {
        handler = handler;
        listening = false;
        close = vi.fn((callback?: () => void) => {
          this.listening = false;
          queueMicrotask(() => { this.emit("close"); callback?.(); });
          return this;
        });
        listen(_port: number, _host: string, callback: () => void) {
          if (mocks.deferListen) return this;
          const error = mocks.listenError;
          queueMicrotask(() => {
            if (error) this.emit("error", error);
            else { this.listening = true; callback(); }
          });
          return this;
        }
        unref() { return this; }
      }
      const server = new Server();
      mocks.servers.push(server);
      return server;
    }),
  };
});
import { cancelLogin, completeManual, disconnect, getStatus, initOAuth, listAccounts, login, openLoginInBrowser } from "./oauth";

const saved = new Map<string, string>();
let fetchMock: ReturnType<typeof vi.fn>;
const tokenResponse = () => Response.json({ access_token: "login-access-fixture", refresh_token: "login-refresh-fixture", expires_in: 3600 });
const authURL = () => new URL(getStatus().authorizationUrl!);
const callbackURL = (state = authURL().searchParams.get("state")!, path = "/auth/callback") => `${path}?code=authorization-code-fixture&state=${encodeURIComponent(state)}`;
function response(): CallbackResponse {
  const result: CallbackResponse = { writeHead: vi.fn(), end: vi.fn() };
  result.writeHead.mockImplementation((status: number) => { result.status = status; return result; });
  result.end.mockImplementation((body?: string) => { result.body = body; return result; });
  return result;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(async () => {
  for (const kind of ["codex", "claude-code", "antigravity"] as const) cancelLogin(kind);
  for (const account of listAccounts()) await disconnect(account.id);
  saved.clear();
  mocks.servers.length = 0;
  mocks.statuses.length = 0;
  mocks.listenError = undefined;
  mocks.deferListen = false;
  mocks.openExternal.mockReset().mockResolvedValue(true);
  fetchMock = vi.fn(async () => tokenResponse());
  vi.stubGlobal("fetch", fetchMock);
  initOAuth({
    globalState: { get: (_key: string, fallback: unknown) => fallback, update: vi.fn() },
    secrets: { get: async (key: string) => saved.get(key), store: async (key: string, value: string) => { saved.set(key, value); }, delete: async (key: string) => { saved.delete(key); } },
  } as unknown as Parameters<typeof initOAuth>[0]);
  await Promise.resolve();
});
afterEach(() => {
  for (const kind of ["codex", "claude-code", "antigravity"] as const) cancelLogin(kind);
  vi.unstubAllGlobals();
});

describe("OAuth browser login fallback", () => {
  it("settles cancelled listener startup without opening a stale browser link", async () => {
    mocks.deferListen = true;
    const starting = login("codex");
    expect(getStatus().pending).toBe("codex");
    cancelLogin("codex");
    await starting;
    expect(mocks.openExternal).not.toHaveBeenCalled();
    expect(getStatus().pending).toBeUndefined();
    expect(getStatus().authorizationUrl).toBeUndefined();
    expect(mocks.servers[0].close).toHaveBeenCalled();
  });

  it("retains the authorization URL and opens the browser when the callback port is occupied", async () => {
    mocks.listenError = Object.assign(new Error("address already in use"), { code: "EADDRINUSE" });
    await login("codex");
    expect(getStatus()).toMatchObject({ pending: "codex", authorizationUrl: expect.stringContaining("https://auth.openai.com/oauth/authorize") });
    expect(getStatus().errors.codex).toMatch(/1455|port|callback/i);
    expect(mocks.openExternal).toHaveBeenCalledOnce();
    expect(mocks.openExternal.mock.calls[0][0].toString()).toBe(getStatus().authorizationUrl);
    expect(fetchMock).not.toHaveBeenCalled();
    await completeManual("codex", `http://localhost:1455${callbackURL()}`);
    expect(listAccounts()).toHaveLength(1);
    expect(getStatus().pending).toBeUndefined();
    expect(getStatus().authorizationUrl).toBeUndefined();
  });

  it.each(["false", "rejection"])("keeps browser %s failures actionable and retries the same authorization attempt", async (failure) => {
    if (failure === "false") mocks.openExternal.mockResolvedValueOnce(false);
    else mocks.openExternal.mockRejectedValueOnce(new Error("Browser launcher unavailable"));
    await login("codex");
    const originalURL = getStatus().authorizationUrl;
    expect(getStatus().pending).toBe("codex");
    expect(getStatus().errors.codex).toMatch(/browser|open|manually/i);
    await openLoginInBrowser("codex");
    expect(getStatus().authorizationUrl).toBe(originalURL);
    expect(mocks.openExternal.mock.calls.map(([uri]) => uri.toString())).toEqual([originalURL, originalURL]);
    expect(mocks.servers).toHaveLength(1);
    expect(getStatus().errors.codex).toBeUndefined();
  });

  it("clears the pending URL and errors when cancelled", async () => {
    mocks.openExternal.mockResolvedValueOnce(false);
    await login("codex");
    cancelLogin("codex");
    expect(getStatus().pending).toBeUndefined();
    expect(getStatus().authorizationUrl).toBeUndefined();
    expect(getStatus().errors.codex).toBeUndefined();
    expect(mocks.servers[0].close).toHaveBeenCalled();
    await expect(openLoginInBrowser("codex")).rejects.toThrow(/login|account|progress/i);
    expect(mocks.openExternal).toHaveBeenCalledOnce();
  });

  it("retains the saved link when a later browser retry fails", async () => {
    await login("codex");
    const originalURL = getStatus().authorizationUrl;
    mocks.openExternal.mockResolvedValueOnce(false);
    await openLoginInBrowser("codex");
    expect(getStatus()).toMatchObject({ pending: "codex", authorizationUrl: originalURL });
    expect(getStatus().errors.codex).toMatch(/browser|open|manually/i);
    mocks.openExternal.mockRejectedValueOnce(new Error("Browser launcher unavailable"));
    await openLoginInBrowser("codex");
    expect(getStatus()).toMatchObject({ pending: "codex", authorizationUrl: originalURL });
    expect(getStatus().errors.codex).toMatch(/browser|open|manually/i);
    expect(mocks.servers).toHaveLength(1);
  });

  it("does not expose account tokens or the PKCE verifier in status events", async () => {
    await login("codex");
    const url = authURL();
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("state")).toBeTruthy();
    const reply = response();
    await mocks.servers[0].handler({ url: callbackURL() }, reply);
    expect(reply.status).toBe(200);
    const form = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    const verifier = form.get("code_verifier")!;
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(url.searchParams.get("code_challenge"));
    const statuses = JSON.stringify(mocks.statuses);
    expect(statuses).not.toContain(verifier);
    expect(statuses).not.toContain("login-access-fixture");
    expect(statuses).not.toContain("login-refresh-fixture");
    expect(statuses).not.toContain("code_verifier");
    expect(saved.size).toBe(1);
  });
});

describe("OAuth callback validation and lifecycle", () => {
  it("ignores a callback from an attempt that was replaced before token exchange", async () => {
    await login("codex");
    const firstCallback = callbackURL();
    const oldServer = mocks.servers[0];
    await login("codex");
    const replacementURL = getStatus().authorizationUrl;
    const reply = response();
    await oldServer.handler({ url: firstCallback }, reply);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getStatus()).toMatchObject({ pending: "codex", authorizationUrl: replacementURL });
    expect(getStatus().errors.codex).toBeUndefined();
    expect(reply.body ?? "").not.toMatch(/login successful/i);
    expect(saved.size).toBe(0);
  });

  it.each(["wrong-path", "wrong-state", "missing-state"])("rejects %s without consuming the active login", async (invalid) => {
    await login("codex");
    const originalURL = getStatus().authorizationUrl;
    const uri = invalid === "wrong-path" ? callbackURL(undefined, "/auth/callback/unrelated")
      : invalid === "wrong-state" ? callbackURL("wrong-state") : "/auth/callback?code=authorization-code-fixture";
    const reply = response();
    await mocks.servers[0].handler({ url: uri }, reply);
    expect(reply.status).toBeGreaterThanOrEqual(400);
    expect(reply.body ?? "").not.toMatch(/login successful/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getStatus()).toMatchObject({ pending: "codex", authorizationUrl: originalURL });
    expect(mocks.servers[0].listening).toBe(true);
    await mocks.servers[0].handler({ url: callbackURL() }, response());
    expect(listAccounts()).toHaveLength(1);
  });

  it("does not announce successful login before the token exchange completes", async () => {
    const upstream = deferred<Response>();
    fetchMock.mockReturnValueOnce(upstream.promise);
    await login("codex");
    const reply = response();
    const completion = mocks.servers[0].handler({ url: callbackURL() }, reply);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(reply.end).not.toHaveBeenCalled();
    expect(listAccounts()).toHaveLength(0);
    upstream.resolve(tokenResponse());
    await completion;
    expect(reply.status).toBe(200);
    expect(reply.body).toMatch(/success/i);
    expect(listAccounts()).toHaveLength(1);
    expect(getStatus().authorizationUrl).toBeUndefined();
  });

  it("returns an error page and requires a fresh login when token exchange fails", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "authorization code rejected" }, { status: 400 }));
    await login("codex");
    const reply = response();
    await mocks.servers[0].handler({ url: callbackURL() }, reply);
    expect(reply.status).toBeGreaterThanOrEqual(400);
    expect(reply.body ?? "").not.toMatch(/login successful/i);
    expect(getStatus().pending).toBeUndefined();
    expect(getStatus().authorizationUrl).toBeUndefined();
    expect(getStatus().errors.codex).toBeTruthy();
    expect(saved.size).toBe(0);
  });

  it.each(["wrong-state", "missing-state"])("rejects manual callback URLs with %s without losing the pending attempt", async (invalid) => {
    await login("codex");
    const originalURL = getStatus().authorizationUrl;
    const suffix = invalid === "wrong-state" ? "&state=incorrect" : "";
    await expect(completeManual("codex", `http://localhost:1455/auth/callback?code=fixture${suffix}`)).rejects.toThrow(/state/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getStatus()).toMatchObject({ pending: "codex", authorizationUrl: originalURL });
  });

  it.each(["cancel", "restart"])("does not persist a stale exchange after %s", async (action) => {
    const upstream = deferred<Response>();
    fetchMock.mockReturnValueOnce(upstream.promise);
    await login("codex");
    const previousURL = getStatus().authorizationUrl;
    const reply = response();
    const completion = mocks.servers[0].handler({ url: callbackURL() }, reply);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    if (action === "cancel") cancelLogin("codex");
    else await login("codex");
    const replacement = getStatus().authorizationUrl;
    upstream.resolve(tokenResponse());
    await completion;
    expect(listAccounts()).toHaveLength(0);
    expect(saved.size).toBe(0);
    expect(reply.body ?? "").not.toMatch(/login successful/i);
    expect(getStatus().authorizationUrl).toBe(replacement);
    if (action === "restart") {
      expect(replacement).not.toBe(previousURL);
      expect(getStatus().pending).toBe("codex");
    } else expect(getStatus().pending).toBeUndefined();
  });
});

describe("OAuth login hardening", () => {
  it("binds Antigravity codes to a PKCE verifier and requires state for pasted callbacks", async () => {
    fetchMock.mockImplementation(async (url: string) => String(url).includes("loadCodeAssist")
      ? Response.json({ cloudaicompanionProject: "fixture-project" })
      : String(url).includes("userinfo") ? Response.json({ email: "user@example.test" }) : tokenResponse());
    await login("antigravity");
    const url = authURL();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const challenge = url.searchParams.get("code_challenge")!;
    expect(challenge).toMatch(/^[\w-]{43}$/);
    await expect(completeManual("antigravity", "authorization-code-fixture")).rejects.toThrow(/state/);
    expect(fetchMock).not.toHaveBeenCalled();
    await completeManual("antigravity", `http://localhost:8723${callbackURL(url.searchParams.get("state")!, "/callback")}`);
    const [, init] = fetchMock.mock.calls.find(([target]) => !String(target).includes("loadCodeAssist") && !String(target).includes("userinfo"))!;
    const verifier = new URLSearchParams(String(init.body)).get("code_verifier")!;
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(challenge);
    expect(listAccounts()).toHaveLength(1);
  });

  it("closes an abandoned loopback sign-in after ten minutes", async () => {
    vi.useFakeTimers();
    try {
      await login("codex");
      expect(getStatus().pending).toBe("codex");
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(getStatus().pending).toBeUndefined();
      expect(getStatus().authorizationUrl).toBeUndefined();
      expect(getStatus().errors.codex).toMatch(/timed out/);
      expect(mocks.servers[0].close).toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("does not echo upstream token-exchange bodies into login errors", async () => {
    fetchMock.mockImplementation(async () => new Response("invalid_grant code=authorization-code-fixture secret", { status: 400 }));
    await login("codex");
    await expect(completeManual("codex", `http://localhost:1455${callbackURL()}`)).rejects.toThrow("Codex token exchange failed (HTTP 400)");
    expect(getStatus().errors.codex).toBe("Codex token exchange failed (HTTP 400)");
  });
});
