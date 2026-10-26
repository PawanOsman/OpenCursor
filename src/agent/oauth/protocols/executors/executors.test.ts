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
