/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it, vi } from "vitest";
import { ApiKeyPool, providerApiKeyPool, type ApiKeyPoolProvider } from "./apiKeyPool";
import { PROVIDER_PRESETS } from "../../shared/providerCatalog";

const endpoint = "https://provider.example.test/v1";
const options = () => ({ apiBaseUrl: endpoint, signal: new AbortController().signal });
const credentials = () => ["first", "second", "third"].map(id => ({ id, apiKey: `${id}-secret`, legacy: false }));
const httpError = (status: number, message = "request failed") => Object.assign(new Error(message), { status });

describe("API credential pool routing", () => {
  it.each(["round-robin", "first"] as const)("keeps %s selection across independent requests", async balance => {
    const pool = new ApiKeyPool("fixture", endpoint, async () => ({ balance, credentials: credentials() }));
    const selected = [];
    for (let i = 0; i < 4; i++) selected.push(await pool.request(async key => key.id, options()));
    expect(selected).toEqual(balance === "round-robin" ? ["first", "second", "third", "first"] : ["first", "first", "first", "first"]);
  });

  it.each([401, 403, 408, 429, 500, 502, 503])( "fails over and cools down HTTP %i credentials", async status => {
    let now = 1000;
    const pool = new ApiKeyPool("fixture", endpoint, async () => ({ balance: "first", credentials: credentials() }), () => now);
    const request = vi.fn(async key => { if (key.id === "first") throw httpError(status); return key.id; });
    expect(await pool.request(request, options())).toBe("second");
    expect(await pool.request(request, options())).toBe("second");
    expect(request.mock.calls.map(([key]) => key.id)).toEqual(["first", "second", "second"]);
    now += 300_001;
    expect(await pool.request(async key => key.id, options())).toBe("first");
  });

  it("never replays visible content, malformed requests or aborts", async () => {
    for (const mode of ["visible", "malformed", "abort"] as const) {
      const pool = new ApiKeyPool("fixture", endpoint, async () => ({ balance: "first", credentials: credentials() }));
      const seen: string[] = [], calls: string[] = [];
      const abort = new AbortController();
      const work = async () => {
        for await (const value of pool.stream(async function* (key) {
          calls.push(key.id);
          if (mode === "visible") yield "partial response";
          if (mode === "abort") abort.abort(new Error("cancelled"));
          throw httpError(mode === "malformed" ? 400 : 503);
        }, { ...options(), signal: abort.signal, visible: () => true })) seen.push(value);
      };
      await expect(work()).rejects.toThrow(mode === "abort" ? "cancelled" : "request failed");
      expect(calls).toEqual(["first"]);
      expect(seen).toEqual(mode === "visible" ? ["partial response"] : []);
    }
  });

  it("bounds attempts, rejects another endpoint and redacts failures", async () => {
    const keys = Array.from({ length: 8 }, (_, i) => ({ id: String(i), apiKey: `secret-${i}`, legacy: false }));
    const pool = new ApiKeyPool("fixture", endpoint, async () => ({ balance: "first", credentials: keys }));
    const failed = vi.fn(async key => { throw httpError(503, `error with ${key.apiKey}`); });
    await expect(pool.request(failed, { ...options(), maxAttempts: 999 })).rejects.toMatchObject({ retryable: false, message: "error with [redacted]" });
    expect(failed).toHaveBeenCalledTimes(5);
    await expect(pool.request(failed, { ...options(), apiBaseUrl: "https://other.test" })).rejects.toThrow("different provider endpoint");
    expect(failed).toHaveBeenCalledTimes(5);
  });

  it("makes a replaced credential available immediately without retaining its secret", async () => {
    const keys = credentials();
    const pool = new ApiKeyPool("fixture", endpoint, async () => ({ balance: "first", credentials: keys }));
    await pool.request(async key => { if (key.id === "first") throw httpError(401); return key.id; }, options());
    keys[0].apiKey = "replacement-secret";
    expect(await pool.request(async key => key.apiKey, options())).toBe("replacement-secret");
    expect(JSON.stringify(pool)).not.toContain("replacement-secret");
    expect(JSON.stringify(pool)).not.toContain("first-secret");
  });
});

describe("live provider credential resolution", () => {
  it("routes an explicitly connected no-auth preset without looking up a secret", async () => {
    const provider: ApiKeyPoolProvider = { id: "popular:opencode", kind: "opencode", baseUrl: PROVIDER_PRESETS.opencode.baseUrl, apiKeys: [] };
    const secrets = { getProviderKey: vi.fn(async () => undefined) };
    const pool = providerApiKeyPool(provider, { get: () => ({ providers: [provider] }) }, secrets);
    expect(await pool.request(async key => key.apiKey, { ...options(), apiBaseUrl: provider.baseUrl })).toBe("");
    expect(secrets.getProviderKey).not.toHaveBeenCalled();
  });
  it("reads only owned enabled secrets and rechecks settings between requests", async () => {
    const provider: ApiKeyPoolProvider = { id: "popular:openai", kind: "openai", baseUrl: endpoint, apiKeys: [
      { id: "foreign-provider", enabled: true }, { id: "popular:openai:key:disabled", enabled: false }, { id: "popular:openai:key:work", enabled: true },
    ] };
    const source = { get: () => ({ providers: [provider] }) };
    const secrets = { getProviderKey: vi.fn(async () => "work-secret") };
    const pool = providerApiKeyPool(provider, source, secrets);
    expect(providerApiKeyPool(provider, source, secrets)).toBe(pool);
    expect(await pool.request(async key => key.apiKey, options())).toBe("work-secret");
    expect(secrets.getProviderKey.mock.calls).toEqual([["popular:openai:key:work"]]);
    provider.apiKeys = [];
    await expect(pool.request(async key => key.apiKey, options())).rejects.toThrow("No enabled API key");
    provider.enabled = false;
    await expect(pool.request(async key => key.apiKey, options())).rejects.toThrow("disabled");
  });

  it("retains legacy anonymous custom connections but never resurrects explicitly removed keys", async () => {
    const provider: ApiKeyPoolProvider = { id: "custom", kind: "openai", baseUrl: endpoint };
    const source = { get: () => ({ providers: [provider] }) };
    const pool = providerApiKeyPool(provider, source, { getProviderKey: async () => undefined });
    expect(await pool.request(async key => key.apiKey, options())).toBe("");
    provider.apiKeys = [];
    await expect(pool.request(async key => key.apiKey, options())).rejects.toThrow("No enabled API key");
  });
});
