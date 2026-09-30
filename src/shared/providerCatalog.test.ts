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

  it("uses the exact supported Antigravity list and excludes media-only/free-retired models", () => {
    const actual = MODEL_CATALOG.filter(model => kindMatches(model.kind, "antigravity")).map(model => model.id).sort();
    const expected = PROVIDER_MODELS.filter(model => model.kind === "antigravity").map(model => model.id).sort();
    expect(actual).toEqual(expected);
    expect(PROVIDER_MODELS.some(model => model.kind === "mimo-free" || model.kind === "devin-cli" || /tts|voiceclone|voicedesign/.test(model.id))).toBe(false);
    expect(PROVIDER_MODELS.filter(model => model.kind === "opencode").map(model => model.id).sort()).toEqual(["muse-spark-1.2-contributor-free", "muse-spark-1.3-contributor-free", "union-alpha"]);
  });
});
