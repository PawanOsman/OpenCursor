/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listModels } from "../agent/provider";
import { listOAuthModels, isConnected, onOAuthStatus } from "../agent/oauth";
import { initModelRegistry, refreshAllModels, getAllModels, onAllModels } from "./modelRegistry";

vi.mock("../agent/provider", () => ({ listModels: vi.fn() }));
vi.mock("../agent/oauth", () => ({
  onOAuthStatus: vi.fn(), isConnected: vi.fn((kind: string) => kind === "codex"), listOAuthModels: vi.fn(),
  OAUTH_LABEL: { codex: "Codex", "claude-code": "Claude Code", antigravity: "Antigravity" },
}));
vi.mock("./featureStore", () => ({ providerEnabled: (provider: { enabled?: boolean }) => provider.enabled !== false }));
vi.mock("../agent/semanticIndex", () => ({ setEmbedModel: vi.fn(), setRemoteEmbedModel: vi.fn(), EMBED_MODELS: [{ id: "minilm" }] }));

afterEach(() => vi.useRealTimers());
beforeEach(() => { vi.clearAllMocks(); vi.mocked(isConnected).mockImplementation(kind => kind === "codex"); });

describe("production provider model registry", () => {
  it("retains colliding model IDs across API, custom API, and OAuth groups", async () => {
    vi.useFakeTimers();
    vi.mocked(listModels).mockResolvedValue([{ id: "shared-model" }, { id: "shared-model" }]);
    vi.mocked(listOAuthModels).mockResolvedValue(["shared-model", "shared-model"]);
    const optionsFor = vi.fn((_id: string, kind?: string) => [{ key: "reasoning_effort", label: "Effort", type: "select", value: kind }]);
    const featureStore = {
      get: () => ({ providers: [
        { id: "popular:openai", name: "OpenAI", kind: "openai", baseUrl: "https://api.example.test" },
        { id: "custom", name: "Custom", kind: "openai", baseUrl: "https://custom.example.test" },
        { id: "disabled", name: "Disabled", kind: "openai", baseUrl: "https://disabled.example.test", enabled: false },
      ], embedModel: "minilm" }),
      onDidChange: vi.fn(), nameFor: (id: string, kind: string) => `${kind}/${id}`, optionsFor,
    };
    initModelRegistry(featureStore as any, { getProviderKey: async () => "fixture-key" } as any);
    const result = await refreshAllModels();
    expect(result.modelList.map((model) => [model.providerId, model.id])).toEqual([
      ["popular:openai", "shared-model"], ["custom", "shared-model"], ["oauth:codex", "shared-model"],
    ]);
    expect(result.models).toEqual(["shared-model"]);
    expect(result.modelList.at(-1)).toMatchObject({ name: "codex/shared-model", options: [{ value: "codex" }] });
    expect(listModels).toHaveBeenCalledTimes(2);
    expect(listOAuthModels).toHaveBeenCalledOnce();
    expect(getAllModels()).toBe(result);
  });

  it("refetches changes received during discovery and publishes only the current provider snapshot", async () => {
    let finishOld!: (models: { id: string }[]) => void;
    vi.mocked(listModels).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
      .mockResolvedValue([{ id: "new-model" }]);
    vi.mocked(listOAuthModels).mockResolvedValue(["new-oauth-model"]);
    let connected = false;
    vi.mocked(isConnected).mockImplementation(kind => connected && kind === "codex");
    let providers = [{ id: "old", name: "Old", kind: "openai", baseUrl: "https://old.example.test" }];
    const featureStore = {
      get: () => ({ providers, embedModel: "minilm" }), onDidChange: vi.fn(),
      nameFor: (id: string) => id, optionsFor: () => [],
    };
    const published = vi.fn();
    const dispose = onAllModels(published);
    try {
      initModelRegistry(featureStore as any, { getProviderKey: async () => "fixture-key" } as any);
      const complete = refreshAllModels();
      providers = [{ id: "new", name: "New", kind: "openai", baseUrl: "https://new.example.test" }];
      featureStore.onDidChange.mock.calls[0][0]();
      connected = true;
      vi.mocked(onOAuthStatus).mock.calls[0][0]({} as any);
      // Repeated readers coalesce with the queued pass rather than fetching again.
      expect(refreshAllModels()).toBe(complete);
      finishOld([{ id: "old-model" }]);
      const result = await complete;
      expect(result.modelList.map(model => [model.providerId, model.id])).toEqual([
        ["new", "new-model"], ["oauth:codex", "new-oauth-model"],
      ]);
      expect(listModels).toHaveBeenCalledTimes(2);
      expect(listOAuthModels).toHaveBeenCalledOnce();
      expect(published).toHaveBeenCalledTimes(1);
      expect(published).toHaveBeenCalledWith(result);
      expect(getAllModels()).toBe(result);
    } finally { dispose(); }
  });
});
