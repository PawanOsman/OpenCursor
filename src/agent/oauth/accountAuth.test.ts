/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountLogin, refreshProviderAccount } from "./accountAuth";
import type { OAuthAccount, OAuthKind } from "./types";
import * as crypto from "crypto";
import { withAuthSignal, authFetch } from "./auth/network.js";

const sessions: AccountLogin[] = [];
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
function setup(kind: OAuthKind, options = {}) {
  const hooks = { change: vi.fn(), complete: vi.fn(async (_account: OAuthAccount) => {}), error: vi.fn(), open: vi.fn(async (_url: string) => {}) };
  const session = new AccountLogin(kind, options, hooks);
  sessions.push(session);
  return { session, hooks };
}
afterEach(() => { for (const session of sessions.splice(0)) session.cancel(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("OpenCursor OAuth login adapters", () => {
  it("bounds authentication without imposing its 30-second lifetime on caller-owned generation streams", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetch = vi.fn().mockResolvedValue(json({})); vi.stubGlobal("fetch", fetch);
    const abort = new AbortController();
    try {
      await withAuthSignal(abort.signal, () => authFetch("https://auth.example.test"));
      expect(timeout).toHaveBeenCalledWith(30_000);
      timeout.mockClear();
      await withAuthSignal(abort.signal, () => authFetch("https://generation.example.test"), { timeoutMs: 0 });
      expect(timeout).not.toHaveBeenCalled();
      const signal = fetch.mock.calls[1][1].signal as AbortSignal;
      expect(signal.aborted).toBe(false);
      abort.abort();
      expect(signal.aborted).toBe(true);
    } finally { timeout.mockRestore(); }
  });
  it("imports only an explicitly supplied Cursor token and exposes no credentials in status", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const { session, hooks } = setup("cursor");
    await session.start();
    expect(session.state.loginMethod).toBe("import-token");
    expect(hooks.complete).not.toHaveBeenCalled();
    await session.complete("Bearer fixture-cursor-token-12345");
    expect(hooks.complete).toHaveBeenCalledWith(expect.objectContaining({ kind: "cursor", accessToken: "fixture-cursor-token-12345", providerSpecificData: expect.objectContaining({ authMethod: "imported", machineId: expect.any(String) }) }));
    expect(JSON.stringify(session.state)).not.toContain("fixture-cursor");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows device code fields, polls pending then completes GitHub's actual token exchange", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(json({ device_code: "private-device", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 1 }))
      .mockResolvedValueOnce(json({ error: "authorization_pending" }))
      .mockResolvedValueOnce(json({ access_token: "github-access", refresh_token: "github-refresh", expires_in: 3600 }))
      .mockResolvedValueOnce(json({ token: "copilot-token", expires_at: 9_999_999_999 }))
      .mockResolvedValueOnce(json({ login: "fixture", email: "fixture@example.test", id: 12 }));
    vi.stubGlobal("fetch", fetch);
    const { session, hooks } = setup("github");
    await session.start();
    expect(session.state).toMatchObject({ loginMethod: "device-code", userCode: "ABCD-1234", authorizationUrl: "https://github.com/login/device" });
    expect(JSON.stringify(session.state)).not.toContain("private-device");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(hooks.complete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(hooks.complete).toHaveBeenCalledWith(expect.objectContaining({ kind: "github", accessToken: "github-access", email: "fixture@example.test", providerSpecificData: expect.objectContaining({ copilotToken: "copilot-token" }) }));
    expect(hooks.error).not.toHaveBeenCalled();
    expect(String(fetch.mock.calls[1][1].body)).toContain("device_code=private-device");
  });

  it("cancels device polling and rejects late completion", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(json({ device_code: "device", user_code: "ABCD", verification_uri: "https://github.com/login/device", expires_in: 600, interval: 1 }));
    vi.stubGlobal("fetch", fetch);
    const { session, hooks } = setup("github");
    await session.start(); session.cancel();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetch).toHaveBeenCalledOnce();
    expect(hooks.complete).not.toHaveBeenCalled();
    expect(hooks.error).not.toHaveBeenCalled();
  });

  it.each(["qoder", "qoder-cn"] as const)("uses %s's generated PKCE verifier for its actual device poll", async kind => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(json({ token: "qoder-access", refresh_token: "qoder-refresh", expires_in: 86400, user_id: "fixture-user" }))
      .mockResolvedValueOnce(json({ email: "qoder@example.test", name: "Fixture" }));
    vi.stubGlobal("fetch", fetch);
    const { session, hooks } = setup(kind);
    await session.start();
    const auth = new URL(session.state.authorizationUrl!);
    await vi.advanceTimersByTimeAsync(2_000);
    const poll = new URL(fetch.mock.calls[0][0]);
    const verifier = poll.searchParams.get("verifier")!;
    expect(crypto.createHash("sha256").update(verifier).digest("base64url")).toBe(auth.searchParams.get("challenge"));
    expect(poll.searchParams.get("nonce")).toBe(auth.searchParams.get("nonce"));
    expect(hooks.complete).toHaveBeenCalledWith(expect.objectContaining({ kind, accessToken: "qoder-access", email: "qoder@example.test" }));
    expect(JSON.stringify(session.state)).not.toContain(verifier);
  });

  it("keeps Kiro client registration secrets private while mapping its region and profile", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(json({ clientId: "registered-client", clientSecret: "private-client-secret" }))
      .mockResolvedValueOnce(json({ deviceCode: "private-device", userCode: "ABCD", verificationUri: "https://device.sso.eu-west-1.amazonaws.com", expiresIn: 600, interval: 1 }))
      .mockResolvedValueOnce(json({ accessToken: "kiro-access", refreshToken: "kiro-refresh", expiresIn: 3600, profileArn: "arn:aws:codewhisperer:eu-west-1:123456789012:profile/fixture" }));
    vi.stubGlobal("fetch", fetch);
    const { session, hooks } = setup("kiro", { region: "eu-west-1" });
    await session.start(); await vi.advanceTimersByTimeAsync(1_000);
    expect(fetch.mock.calls.map(([url]) => new URL(url).hostname)).toEqual(Array(3).fill("oidc.eu-west-1.amazonaws.com"));
    expect(JSON.stringify(session.state)).not.toContain("private-client-secret");
    expect(hooks.complete).toHaveBeenCalledWith(expect.objectContaining({ kind: "kiro", accessToken: "kiro-access", providerSpecificData: expect.objectContaining({ clientId: "registered-client", clientSecret: "private-client-secret", region: "eu-west-1", profileArn: expect.stringContaining("arn:aws") }) }));
  });

  it("keeps GitLab endpoint/client configuration and verifies state before exchanging the code", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ access_token: "gitlab-token", refresh_token: "refresh", expires_in: 3600 }))
      .mockResolvedValueOnce(json({ username: "fixture", email: "fixture@example.test" }));
    vi.stubGlobal("fetch", fetch);
    const { session, hooks } = setup("gitlab", { clientId: "application-id", baseUrl: "https://gitlab.example.test" });
    await session.start();
    const auth = new URL(session.state.authorizationUrl!);
    expect(auth.origin).toBe("https://gitlab.example.test");
    expect(auth.searchParams.get("client_id")).toBe("application-id");
    const callback = new URL(auth.searchParams.get("redirect_uri")!);
    callback.searchParams.set("code", "fixture-code"); callback.searchParams.set("state", "wrong");
    await expect(session.complete(callback.href)).rejects.toThrow("state mismatch");
    expect(fetch).not.toHaveBeenCalled();
    callback.searchParams.set("state", auth.searchParams.get("state")!);
    await session.complete(callback.href);
    expect(fetch.mock.calls[0][0]).toBe("https://gitlab.example.test/oauth/token");
    expect(hooks.complete).toHaveBeenCalledWith(expect.objectContaining({ kind: "gitlab", providerSpecificData: expect.objectContaining({ baseUrl: "https://gitlab.example.test", clientId: "application-id" }) }));
  });

  it("validates imported Kimchi tokens at its provider endpoint", async () => {
    const fetch = vi.fn().mockResolvedValue(json({})); vi.stubGlobal("fetch", fetch);
    const { session, hooks } = setup("kimchi");
    await session.start();
    await session.complete("fixture-kimchi-token");
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer fixture-kimchi-token");
    expect(hooks.complete).toHaveBeenCalledWith(expect.objectContaining({ kind: "kimchi", accessToken: "fixture-kimchi-token" }));
  });

  it("preserves an expired Cline callback expiry so the account must refresh before use", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const { session, hooks } = setup("cline");
    await session.start();
    const auth = new URL(session.state.authorizationUrl!);
    const callback = new URL(auth.searchParams.get("callback_url")!);
    callback.searchParams.set("code", Buffer.from(JSON.stringify({ accessToken: "cline-access", refreshToken: "cline-refresh", expiresAt: new Date(Date.now() - 60_000).toISOString() })).toString("base64"));
    await session.complete(callback.href);
    expect(hooks.complete).toHaveBeenCalledWith(expect.objectContaining({ kind: "cline", accessToken: "cline-access", refreshToken: "cline-refresh" }));
    expect(hooks.complete.mock.calls[0][0].expiresAt).toBeLessThan(Date.now());
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts Zed's real root-path loopback callback and decrypts only this attempt's encrypted token", async () => {
    const realFetch = globalThis.fetch;
    const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => String(url).startsWith("http://127.0.0.1:") ? realFetch(url, init) : json({ id: "fixture-user", email: "zed@example.test" }));
    vi.stubGlobal("fetch", fetch);
    const { session, hooks } = setup("zed");
    await session.start();
    const auth = new URL(session.state.authorizationUrl!);
    const publicKey = crypto.createPublicKey({ key: Buffer.from(auth.searchParams.get("native_app_public_key")!, "base64url"), format: "der", type: "pkcs1" });
    const encrypted = crypto.publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from("fixture-zed-access")).toString("base64url");
    const callback = new URL(`http://127.0.0.1:${auth.searchParams.get("native_app_port")}/`);
    callback.searchParams.set("user_id", "fixture-user"); callback.searchParams.set("access_token", encrypted);
    const result = await realFetch(callback);
    expect(result.status).toBe(200);
    expect(await result.text()).toContain("Connected");
    expect(hooks.complete).toHaveBeenCalledWith(expect.objectContaining({ kind: "zed", accessToken: "fixture-zed-access", providerSpecificData: expect.objectContaining({ userId: "fixture-user", systemId: auth.searchParams.get("system_id") }) }));
    expect(JSON.stringify(session.state)).not.toContain("fixture-zed-access");
  });

  it("refreshes GitLab against its own persisted endpoint without switching provider", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ access_token: "new-token", refresh_token: "new-refresh", expires_in: 7200 })); vi.stubGlobal("fetch", fetch);
    const account: OAuthAccount = { id: "gitlab:fixture", kind: "gitlab", accessToken: "old", refreshToken: "refresh", expiresAt: 0, providerSpecificData: { baseUrl: "https://gitlab.example.test", clientId: "app" } };
    expect(await refreshProviderAccount(account, new AbortController().signal)).toMatchObject({ id: account.id, kind: "gitlab", accessToken: "new-token", refreshToken: "new-refresh" });
    expect(fetch.mock.calls[0][0]).toBe("https://gitlab.example.test/oauth/token");
    expect(String(fetch.mock.calls[0][1].body)).toContain("client_id=app");
  });

  it("decrypts Xiaomi's account callback for this attempt and refuses an unrelated credential endpoint", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const { session, hooks } = setup("xiaomi-mimo");
    await session.start();
    const auth = new URL(session.state.authorizationUrl!);
    const clientKey = crypto.createPublicKey({ key: Buffer.from(auth.searchParams.get("pk")!, "base64"), format: "der", type: "spki" });
    const encrypt = (endpoint: string) => {
      const ephemeral = crypto.generateKeyPairSync("x25519");
      const key = crypto.createHash("sha256").update(crypto.diffieHellman({ privateKey: ephemeral.privateKey, publicKey: clientKey })).digest();
      const nonce = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
      const content = Buffer.concat([cipher.update(JSON.stringify({ uid: "fixture-user", sk: "private-mimo-token", url: endpoint })), cipher.final()]);
      return Buffer.concat([nonce, ephemeral.publicKey.export({ type: "spki", format: "der" }).subarray(-32), content, cipher.getAuthTag()]).toString("base64");
    };
    const callback = new URL(auth.searchParams.get("redirect_uri")!);
    callback.searchParams.set("u", encrypt("https://unrelated.example.test"));
    await expect(session.complete(callback.href)).rejects.toThrow("unexpected endpoint");
    expect(hooks.complete).not.toHaveBeenCalled();
    callback.searchParams.set("u", encrypt("https://api.xiaomimimo.com"));
    const wrongAttempt = new URL(callback); wrongAttempt.pathname = "/callback/wrong-attempt";
    await expect(session.complete(wrongAttempt.href)).rejects.toThrow("does not match");
    await session.complete(callback.href);
    expect(hooks.complete).toHaveBeenCalledWith(expect.objectContaining({ kind: "xiaomi-mimo", accessToken: "private-mimo-token", providerSpecificData: { uid: "fixture-user", baseUrl: "https://api.xiaomimimo.com/" } }));
    expect(JSON.stringify(session.state)).not.toContain("private-mimo-token");
    expect(fetch).not.toHaveBeenCalled();
  });
});
