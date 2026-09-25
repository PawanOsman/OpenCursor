/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("vscode", () => ({}));
import { ProviderKeyStore } from "./providerKeys";
import { getProviderApiKeys, type FeatureConfig, type ProviderConfig } from "./featureStore";

const providerId = "popular:deepseek";
const legacy = (): ProviderConfig => ({ id: providerId, kind: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", enabled: false });
let config: FeatureConfig;
let values: Map<string, string>;
let store: ProviderKeyStore;
const persist = vi.fn(async (patch: Partial<FeatureConfig>): Promise<FeatureConfig> => { config = { ...config, ...structuredClone(patch) }; return config; });
const write = vi.fn(async (id: string, value: string) => { if (value) values.set(id, value); else values.delete(id); });
beforeEach(() => {
  config = { providers: [] } as unknown as FeatureConfig;
  values = new Map();
  persist.mockClear(); write.mockClear();
  persist.mockImplementation(async patch => { config = { ...config, ...structuredClone(patch) }; return config; });
  write.mockImplementation(async (id, value) => { if (value) values.set(id, value); else values.delete(id); });
  store = new ProviderKeyStore({ get: () => config, set: persist }, { getProviderKey: async id => values.get(id), setProviderKey: write });
});
const add = (apiKey = "secret-a") => store.action({ action: "add", providerId, kind: "deepseek", apiKey });

describe("provider API key persistence", () => {
  it("creates a provider only after storing its first secret and exposes metadata only", async () => {
    const result = (await add())!;
    expect(result.apiKeys).toHaveLength(1);
    const key = result.apiKeys![0];
    expect(key).toMatchObject({ label: "Key 1", enabled: true, hasKey: true });
    expect(key.id).toMatch(/^popular:deepseek:key:/);
    expect(values.get(key.id)).toBe("secret-a");
    expect(result).toMatchObject({ hasKey: true, apiKeyBalance: "round-robin", enabled: true });
    expect(JSON.stringify(config)).not.toContain("secret-a");
    expect(JSON.stringify(result)).not.toContain("secret-a");
    expect(config.providers[0].apiKeys![0]).not.toHaveProperty("hasKey");
  });

  it("migrates legacy metadata without copying its secret or enabling a disabled provider", async () => {
    config.providers = [legacy()]; values.set(providerId, "old-secret");
    expect((await store.annotate(legacy())).apiKeys).toEqual([{ id: providerId, label: "Key 1", enabled: true, hasKey: true }]);
    const result = (await add())!;
    expect(result.apiKeys?.map(key => key.id)[0]).toBe(providerId);
    expect(result).toMatchObject({ enabled: false, apiKeyBalance: "first" });
    expect(values.get(providerId)).toBe("old-secret");
    expect(write.mock.calls).toHaveLength(1);
  });

  it("rejects duplicate secrets, including a disabled or legacy key", async () => {
    config.providers = [legacy()]; values.set(providerId, "secret-a");
    await expect(add()).rejects.toThrow("already added");
    expect(write).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("changes labels without changing saved credentials and can rotate just one key", async () => {
    await add(); const id = config.providers[0].apiKeys![0].id;
    await add("secret-b");
    await store.action({ action: "update", providerId, keyId: id, label: "Primary", apiKey: " " });
    expect(values.get(id)).toBe("secret-a");
    await store.action({ action: "update", providerId, keyId: id, apiKey: "secret-c" });
    expect(values.get(id)).toBe("secret-c");
    expect(config.providers[0].apiKeys![0].label).toBe("Primary");
    expect([...values.values()]).toEqual(["secret-c", "secret-b"]);
  });

  it("independently disables/removes keys while retaining the provider and remaining secret", async () => {
    await add(); await add("secret-b");
    const [first, second] = config.providers[0].apiKeys!;
    await store.action({ action: "toggle", providerId, keyId: first.id, enabled: false });
    expect(config.providers[0].apiKeys!.map(key => key.enabled)).toEqual([false, true]);
    const result = (await store.action({ action: "remove", providerId, keyId: first.id }))!;
    expect(result.apiKeys).toHaveLength(1);
    expect(values.has(first.id)).toBe(false);
    expect(values.get(second.id)).toBe("secret-b");
    expect(result.hasKey).toBe(true);
  });

  it("removes the popular provider with its last key, but keeps a keyless custom endpoint", async () => {
    await add();
    await store.action({ action: "remove", providerId, keyId: config.providers[0].apiKeys![0].id });
    expect(config.providers).toEqual([]);
    config.providers = [{ ...legacy(), id: "custom", apiKeys: [{ id: "custom", label: "Key 1" }] }]; values.set("custom", "custom-secret");
    await store.action({ action: "remove", providerId: "custom", keyId: "custom" });
    expect(config.providers[0].apiKeys).toEqual([]);
    expect(values.size).toBe(0);
  });

  it("deletes every provider secret including any remaining legacy slot", async () => {
    await add(); await add("secret-b"); values.set(providerId, "legacy-leftover");
    await store.action({ action: "removeProvider", providerId });
    expect(config.providers).toEqual([]);
    expect(values.size).toBe(0);
  });

  it("validates key ownership and provider creation metadata", async () => {
    await add();
    for (const action of ["update", "remove", "toggle"] as const) {
      await expect(store.action({ action, providerId, keyId: "another-provider:key:id", apiKey: "secret-z", enabled: false })).rejects.toThrow("not found");
    }
    await expect(store.action({ action: "add", providerId: "arbitrary", kind: "deepseek", apiKey: "secret-z" })).rejects.toThrow("not found");
    await expect(store.action({ action: "add", providerId: "popular:__proto__", kind: "__proto__" as any, apiKey: "secret-z" })).rejects.toThrow("not found");
    expect(values.size).toBe(1);
  });

  it("never creates a provider or exposes a raw-secret storage error if secret persistence fails", async () => {
    write.mockRejectedValueOnce(new Error("secret-a failed to store"));
    await expect(add()).rejects.toThrow("Could not save the API key changes");
    expect(persist).not.toHaveBeenCalled();
    expect(config.providers).toEqual([]);
    expect(values.size).toBe(0);
  });

  it("restores secrets when metadata persistence fails", async () => {
    await add(); const id = config.providers[0].apiKeys![0].id;
    persist.mockRejectedValueOnce(new Error("disk unavailable"));
    await expect(store.action({ action: "update", providerId, keyId: id, apiKey: "replacement" })).rejects.toThrow("Could not save");
    expect(values.get(id)).toBe("secret-a");
    persist.mockRejectedValueOnce(new Error("disk unavailable"));
    await expect(store.action({ action: "removeProvider", providerId })).rejects.toThrow("Could not save");
    expect(values.get(id)).toBe("secret-a");
    expect(config.providers).toHaveLength(1);
  });

  it("restores prior deletes if removing multiple secrets fails midway", async () => {
    await add(); await add("secret-b");
    write.mockImplementationOnce(async (id, value) => { values.delete(id); })
      .mockRejectedValueOnce(new Error("locked"));
    await expect(store.action({ action: "removeProvider", providerId })).rejects.toThrow("Could not save");
    expect([...values.values()].sort()).toEqual(["secret-a", "secret-b"]);
    expect(config.providers[0].apiKeys).toHaveLength(2);
  });

  it("serializes concurrent additions and keeps accepting actions after failure", async () => {
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    write.mockImplementationOnce(async (id, value) => { await blocked; values.set(id, value); });
    const first = add("secret-a");
    const second = add("secret-b");
    await Promise.resolve(); await Promise.resolve();
    expect(config.providers).toHaveLength(0);
    release();
    await Promise.all([first, second]);
    expect(config.providers[0].apiKeys).toHaveLength(2);
    await expect(add("secret-a")).rejects.toThrow("already added");
    await add("secret-c");
    expect(config.providers[0].apiKeys).toHaveLength(3);
  });

  it("persists the balancing strategy and ignores stale hasKey annotations", async () => {
    await add();
    await store.action({ action: "setBalance", providerId, strategy: "first" });
    expect(config.providers[0].apiKeyBalance).toBe("first");
    config.providers[0].apiKeys![0].hasKey = false;
    expect((await store.annotate(config.providers[0])).apiKeys![0].hasKey).toBe(true);
    await expect(store.action({ action: "setBalance", providerId, strategy: "bad" as any })).rejects.toThrow("supported");
  });

  it("prevents stale settings snapshots from removing added keys or reviving a removed provider", async () => {
    await add(); const stale = structuredClone(config.providers);
    await add("secret-b");
    await store.saveFeatures({ providers: stale });
    expect(config.providers[0].apiKeys).toHaveLength(2);
    await store.saveFeatures({ providers: [] });
    expect(config.providers).toHaveLength(1);
    await store.action({ action: "removeProvider", providerId });
    await store.saveFeatures({ providers: stale });
    expect(config.providers).toEqual([]);
  });

  it("filters foreign and duplicate metadata IDs, while [] disables the legacy fallback", async () => {
    expect(getProviderApiKeys(legacy())).toEqual([{ id: providerId, label: "Key 1", enabled: true }]);
    expect(getProviderApiKeys({ ...legacy(), apiKeys: [] })).toEqual([]);
    expect(getProviderApiKeys({ ...legacy(), apiKeys: [
      { id: "foreign", label: "bad" }, { id: providerId, label: "valid" }, { id: providerId, label: "duplicate" },
    ] })).toEqual([{ id: providerId, label: "valid", enabled: true }]);
  });

  it("keeps legacy custom-provider edits usable after its managed list became empty", async () => {
    config.providers = [{ ...legacy(), id: "custom", apiKeys: [] }];
    await store.saveLegacy("custom", "custom-key");
    expect(config.providers[0].apiKeys).toEqual([{ id: "custom", label: "Key 1", enabled: true }]);
    expect(values.get("custom")).toBe("custom-key");
    await store.saveLegacy("custom", "");
    expect(config.providers[0].apiKeys).toEqual([]);
    expect(values.has("custom")).toBe(false);
  });

  it("chooses an unused default key label after a key was removed", async () => {
    await add(); await add("secret-b");
    await store.action({ action: "remove", providerId, keyId: config.providers[0].apiKeys![0].id });
    await add("secret-c");
    expect(config.providers[0].apiKeys!.map(key => key.label)).toEqual(["Key 2", "Key 1"]);
  });

  it("connects a trusted no-auth provider without writing a secret or adding fake credentials", async () => {
    const provider = await store.action({ action: "connect", providerId: "popular:opencode", kind: "opencode" });
    expect(provider).toMatchObject({ id: "popular:opencode", apiKeys: [], hasKey: false, enabled: true });
    expect(write).not.toHaveBeenCalled();
    config.providers[0].enabled = false;
    await store.action({ action: "connect", providerId: "popular:opencode", kind: "opencode" });
    expect(config.providers[0].enabled).toBe(false);
  });

  it("rejects no-auth connect for keyed providers and arbitrary endpoint kinds", async () => {
    await expect(store.action({ action: "connect", providerId, kind: "deepseek" })).rejects.toThrow("not found");
    await expect(store.action({ action: "connect", providerId: "popular:ollama", kind: "ollama" })).rejects.toThrow("not found");
    await expect(store.action({ action: "connect", providerId: "popular:opencode", kind: "opencode", apiKey: "unneeded" })).rejects.toThrow("does not require");
    expect(config.providers).toEqual([]);
    expect(write).not.toHaveBeenCalled();
  });

  it("requires and validates tenant endpoints before storing an API key", async () => {
    for (const baseUrl of [undefined, "https://example.test/{accountId}/v1", "https://user:pass@example.test/v1", "https://example.test/v1?key=secret", "file:///tmp/local"]) {
      await expect(store.action({ action: "add", providerId: "popular:cloudflare-ai", kind: "cloudflare-ai", apiKey: "key", baseUrl })).rejects.toThrow("complete HTTP");
    }
    expect(write).not.toHaveBeenCalled();
    const baseUrl = "https://api.cloudflare.com/client/v4/accounts/account-fixture/ai/v1";
    await store.action({ action: "add", providerId: "popular:cloudflare-ai", kind: "cloudflare-ai", apiKey: "key", baseUrl });
    expect(config.providers[0].baseUrl).toBe(baseUrl);
    await store.action({ action: "add", providerId: "popular:cloudflare-ai", kind: "cloudflare-ai", apiKey: "key2", baseUrl: "https://different.test" });
    expect(config.providers[0].baseUrl).toBe(baseUrl);
  });

  it("ignores endpoint overrides for fixed-endpoint presets", async () => {
    await store.action({ action: "add", providerId, kind: "deepseek", apiKey: "secret", baseUrl: "https://different.test" });
    expect(config.providers[0].baseUrl).toBe("https://api.deepseek.com/v1");
  });

  it("stores valid Vertex service-account credentials only in secret storage", async () => {
    await expect(store.action({ action: "add", providerId: "popular:vertex", kind: "vertex", apiKey: "plain-key" })).rejects.toThrow("service-account JSON");
    const apiKey = JSON.stringify({ type: "service_account", client_email: "fixture@example.test", private_key: "private-fixture-material", project_id: "fixture-project" });
    await store.action({ action: "add", providerId: "popular:vertex", kind: "vertex", apiKey });
    expect([...values.values()]).toEqual([apiKey]);
    expect(JSON.stringify(config)).not.toContain("private-fixture-material");
    expect(JSON.stringify(config)).not.toContain("fixture@example.test");
  });
});
