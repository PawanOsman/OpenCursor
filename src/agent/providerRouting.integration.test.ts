/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderEvent } from "./types";
import type { StreamChatOpts } from "./provider/types";
import type { ProviderConfig } from "../stores/featureStore";

const bridge = vi.hoisted(() => ({ stream: vi.fn(), models: vi.fn() }));
vi.mock("vscode", () => ({}));
vi.mock("./oauth", () => ({ streamOAuthChat: vi.fn() }));
vi.mock("./oauth/providerTransport.js", () => ({ streamProviderAdapter: bridge.stream, listProviderAdapterModels: bridge.models, ProviderTransportError: class extends Error {} }));
import { generateTitle, listModels, pickModel, streamChat } from "./provider";
import { providerApiKeyPool } from "./provider/apiKeyPool";
import { POPULAR_KINDS, PROVIDER_PRESETS, type ProviderKind } from "../shared/providerCatalog";

function connected(kind: ProviderKind, secrets = ["fixture-first", "fixture-second"], id = `popular:${kind}`) {
  const provider: ProviderConfig = { id, kind, name: kind, baseUrl: PROVIDER_PRESETS[kind].baseUrl, apiKeyBalance: "round-robin",
    apiKeys: secrets.map((_, index) => ({ id: `${id}:key:${index}`, label: `Key ${index + 1}`, enabled: true })) };
  const getProviderKey = vi.fn(async (keyId: string) => secrets[provider.apiKeys!.findIndex(key => key.id === keyId)]);
  const pool = providerApiKeyPool(provider, { get: () => ({ providers: [provider] }) }, { getProviderKey });
  return { provider, pool, getProviderKey };
}
async function collect(fixture: ReturnType<typeof connected>, model = "fixture-model", extra: Partial<StreamChatOpts> = {}, output: ProviderEvent[] = []) {
  for await (const event of streamChat({ apiBaseUrl: fixture.provider.baseUrl, apiKey: "", apiKeyPool: fixture.pool, model,
    messages: [{ role: "user", content: "Implement the feature" }], signal: new AbortController().signal, ...extra })) output.push(event);
  return output;
}
const http = (status: number, message: string) => Object.assign(new Error(message), { status });
const sse = () => new Response('data: {"choices":[{"delta":{"content":"Direct response"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { status: 200 });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => sse()); vi.stubGlobal("fetch", fetchMock);
  bridge.stream.mockImplementation(async function* () { yield { type: "text-delta", text: "Bridge response" }; yield { type: "done", finishReason: "stop" }; });
  bridge.models.mockResolvedValue({ models: ["model-a"], verified: true });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("provider adapter routing through credential pools", () => {
  it.each(POPULAR_KINDS.filter(kind => PROVIDER_PRESETS[kind].protocol === "adapter"))("routes %s through its exact provider protocol and configured endpoint", async kind => {
    const fixture = connected(kind);
    await collect(fixture);
    expect(bridge.stream).toHaveBeenCalledOnce();
    expect(bridge.stream).toHaveBeenCalledWith(expect.objectContaining({ providerId: PROVIDER_PRESETS[kind].adapterId,
      baseUrl: fixture.provider.baseUrl, credentials: { apiKey: "fixture-first" }, model: "fixture-model" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("connects OpenCode Free without inventing or looking up a credential", async () => {
    const fixture = connected("opencode", []);
    const output = await collect(fixture, "union-alpha");
    expect(output.some(event => event.type === "text-delta")).toBe(true);
    expect(bridge.stream).toHaveBeenCalledWith(expect.objectContaining({ providerId: "opencode", credentials: { apiKey: "" }, model: "union-alpha" }));
    expect(fixture.getProviderKey).not.toHaveBeenCalled();
  });

  it("fails over a rejected API key before output and redacts the retry message", async () => {
    const fixture = connected("cohere");
    bridge.stream.mockImplementation(async function* (options) {
      if (options.credentials.apiKey === "fixture-first") throw http(401, "Invalid fixture-first credential");
      yield { type: "text-delta", text: "Only successful output" }; yield { type: "done", finishReason: "stop" };
    });
    const onRetry = vi.fn();
    const output = await collect(fixture, "command-a", { onRetry });
    expect(bridge.stream.mock.calls.map(([options]) => options.credentials.apiKey)).toEqual(["fixture-first", "fixture-second"]);
    expect(output.filter(event => event.type === "text-delta")).toEqual([{ type: "text-delta", text: "Only successful output" }]);
    expect(JSON.stringify(onRetry.mock.calls)).not.toContain("fixture-first");
    expect(JSON.stringify(onRetry.mock.calls)).toContain("[redacted]");
  });

  it("does not replay a partial provider stream on another key", async () => {
    const fixture = connected("cohere"); const output: ProviderEvent[] = [];
    bridge.stream.mockImplementation(async function* () { yield { type: "text-delta", text: "Partial" }; throw http(503, "Disconnected fixture-first"); });
    await expect(collect(fixture, "command-a", {}, output)).rejects.toMatchObject({ retryable: false, message: "Disconnected [redacted]" });
    expect(output).toEqual([{ type: "text-delta", text: "Partial" }]);
    expect(bridge.stream).toHaveBeenCalledOnce();
  });

  it.each([
    ["deepseek", "deepseek-v4-pro-max", "deepseek"],
    ["mimo", "mimo-v2.5-pro-claude", "xiaomi-tokenplan"],
  ] as const)("routes the %s model alias %s through protocol translation", async (kind, model, adapterId) => {
    await collect(connected(kind), model);
    expect(bridge.stream).toHaveBeenCalledWith(expect.objectContaining({ providerId: adapterId, model }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps ordinary existing models and custom endpoint configurations on their direct transport", async () => {
    await collect(connected("deepseek"), "deepseek-v4-pro");
    await collect(connected("cohere", ["custom-key"], "custom:cohere"), "command-a");
    expect(bridge.stream).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(String(fetchMock.mock.calls[1][0])).toBe(`${PROVIDER_PRESETS.cohere.baseUrl}/chat/completions`);
  });

  it("uses the same credential pool and reference adapter for titles and model selection", async () => {
    const fixture = connected("cohere");
    bridge.stream.mockImplementation(async function* (options) {
      const isTitle = options.messages[0].content.includes("title");
      yield { type: "text-delta", text: isTitle ? "Implement feature tests" : "candidate-b" }; yield { type: "done", finishReason: "stop" };
    });
    expect(await generateTitle(fixture.provider.baseUrl, "", "command-a", "Write tests", false, undefined, { apiKeyPool: fixture.pool })).toBe("Implement feature tests");
    expect(await pickModel(fixture.provider.baseUrl, "", "command-a", ["candidate-a", "candidate-b"], "Pick coding model", false, undefined, { apiKeyPool: fixture.pool })).toBe("candidate-b");
    expect(bridge.stream.mock.calls.map(([options]) => options.credentials.apiKey)).toEqual(["fixture-first", "fixture-second"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates discovery verification instead of treating a static catalog fallback as credential validation", async () => {
    const fixture = connected("cohere"); const onVerification = vi.fn();
    bridge.models.mockResolvedValue({ models: ["command-a"], verified: false });
    expect(await listModels(fixture.provider.baseUrl, "", false, { apiKeyPool: fixture.pool, onVerification })).toEqual([{ id: "command-a" }]);
    expect(onVerification).toHaveBeenCalledWith(false);
    expect(bridge.models).toHaveBeenCalledWith("cohere", { apiKey: "fixture-first" }, expect.objectContaining({ baseUrl: fixture.provider.baseUrl }));
  });

  it("rejects endpoint mismatches before any credential reaches the adapter", async () => {
    const fixture = connected("cohere");
    await expect(collect(fixture, "command-a", { apiBaseUrl: "https://other.example.test/v1" })).rejects.toThrow("different provider endpoint");
    expect(bridge.stream).not.toHaveBeenCalled();
    expect(fixture.getProviderKey).not.toHaveBeenCalled();
  });
});
