/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it, vi } from "vitest";
vi.mock("vscode", () => ({}));
import { FREE_KINDS, POPULAR_KINDS, PROVIDER_PRESETS } from "./providerCatalog";
import { PROVIDER_MODELS } from "./providerModels";
import { MODEL_CATALOG, kindMatches } from "../stores/featureStore";

describe("shared provider catalog", () => {
  it("separates anonymous providers from keyed and local connections", () => {
    expect(FREE_KINDS).toEqual(["opencode"]);
    expect(POPULAR_KINDS.every(kind => PROVIDER_PRESETS[kind].needsKey && !PROVIDER_PRESETS[kind].noAuth)).toBe(true);
    expect(POPULAR_KINDS).not.toContain("ollama");
    expect(POPULAR_KINDS).toContain("ollama-cloud");
    expect(PROVIDER_PRESETS["ollama-cloud"].adapterId).toBe("ollama");
    expect(PROVIDER_PRESETS.ollama.adapterId).toBe("ollama-local");
  });

  it("requires tenant configuration and the correct Vertex credential mode", () => {
    expect(PROVIDER_PRESETS.azure.needsEndpoint).toBe(true);
    expect(PROVIDER_PRESETS["cloudflare-ai"].needsEndpoint).toBe(true);
    expect(PROVIDER_PRESETS.vertex.authMode).toBe("serviceAccount");
    expect(PROVIDER_PRESETS["vertex-partner"].authMode).toBe("serviceAccount");
    expect(PROVIDER_PRESETS.opencode.protocol).toBe("adapter");
  });

  it("keeps every usable provider model provider-scoped without duplicating existing curated definitions", () => {
    for (const model of PROVIDER_MODELS) {
      const matches = MODEL_CATALOG.filter(item => item.id === model.id && kindMatches(item.kind, model.kind));
      expect(matches, `${model.kind}/${model.id}`).toHaveLength(1);
    }
    expect(MODEL_CATALOG.find(model => model.id === "gpt-6-astra" && kindMatches(model.kind, "openai"))?.options?.some(option => option.key === "reasoning_effort")).toBe(true);
  });

  it("lists the October 2026 frontier models on every provider that serves them", () => {
    const has = (kind: string, id: string) => MODEL_CATALOG.some(model => model.id === id && kindMatches(model.kind, kind));
    for (const [kind, id] of [
      ["anthropic", "claude-sonnet-5-5"], ["claude-code", "claude-sonnet-5-5"], ["anthropic", "claude-haiku-5-5"], ["claude-code", "claude-haiku-5-5"],
      ["openai", "gpt-6.1-sol"], ["codex", "gpt-6.1-sol"], ["openai", "gpt-6.1-terra"], ["google", "gemini-4-argon"],
      ["github", "claude-sonnet-5.5"], ["github", "claude-haiku-5.5"], ["github", "gpt-6.1-sol"], ["kiro", "claude-opus-5.5"],
      ["antigravity", "gemini-4-argon-high"], ["antigravity", "claude-sonnet-5-5"], ["opencode-go", "claude-haiku-5-5"],
      ["xai", "grok-4.7"], ["moonshot", "kimi-k3.1-pro"],
    ] as const) expect(has(kind, id), `${kind}/${id}`).toBe(true);
    const effortOf = (id: string, kind: string) => MODEL_CATALOG.find(model => model.id === id && kindMatches(model.kind, kind))?.options?.find(option => option.key === "reasoning_effort")?.values;
    expect(effortOf("gpt-6.1-sol", "openai")).not.toContain("none");
    expect(effortOf("gpt-6.1-terra", "openai")).toContain("none");
    expect(effortOf("gemini-4-argon", "google")).toEqual(["low", "medium", "high"]);
    expect(MODEL_CATALOG.find(model => model.id === "claude-sonnet-5-5")?.options?.find(option => option.key === "thinking")?.values).toEqual(["adaptive"]);
  });

  it("uses the exact supported Antigravity list and excludes media-only/free-retired models", () => {
    const actual = MODEL_CATALOG.filter(model => kindMatches(model.kind, "antigravity")).map(model => model.id).sort();
    const expected = PROVIDER_MODELS.filter(model => model.kind === "antigravity").map(model => model.id).sort();
    expect(actual).toEqual(expected);
    expect(PROVIDER_MODELS.some(model => model.kind === "mimo-free" || model.kind === "devin-cli" || /tts|voiceclone|voicedesign/.test(model.id))).toBe(false);
    expect(PROVIDER_MODELS.filter(model => model.kind === "opencode").map(model => model.id).sort()).toEqual(["muse-spark-1.2-contributor-free", "muse-spark-1.3-contributor-free", "union-alpha"]);
  });
});
