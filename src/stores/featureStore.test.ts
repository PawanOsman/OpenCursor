/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it, vi } from "vitest";
import { FeatureStore, MODEL_CATALOG, kindMatches, optionsToParams } from "./featureStore";
import type { FeatureConfig, ModelOption } from "./featureStore";

vi.mock("vscode", () => ({ EventEmitter: class { event = () => ({ dispose() {} }); fire() {} } }));

function storeWith(modelOptions: FeatureConfig["modelOptions"] = {}) {
  let saved: Partial<FeatureConfig> = { modelOptions };
  const context = { globalState: {
    get: (key: string) => key === "ocursor.features" ? saved : undefined,
    update: async (key: string, value: Partial<FeatureConfig>) => { if (key === "ocursor.features") saved = value; },
  } } as unknown as ConstructorParameters<typeof FeatureStore>[0];
  return new FeatureStore(context);
}

// These are persisted settings with the old option shape, not model definitions.
const oldOption = (key: string, value: string): ModelOption => ({ key, value, label: "Old label", type: key === "thinking" ? "toggle" : "select", values: [value] });
const selected = (store: FeatureStore, model: string, key: string, kind = "anthropic") => store.optionsFor(model, kind).find((option) => option.key === key)!;

describe("saved model option resolution", () => {
  it.each(["claude-haiku-4-5", "claude-opus-5", "claude-sonnet-4-6"])("preserves an old false thinking toggle as disabled for %s", (model) => {
    const store = storeWith({ [model]: [oldOption("thinking", "false")] });
    const option = selected(store, model, "thinking");
    expect(option.value).toBe("disabled");
    expect(option.type).toBe("select");
    expect(option.values).toContain("disabled");
    expect(optionsToParams(store.optionsFor(model, "anthropic")).thinking).toBe("disabled");
  });

  it.each([
    ["claude-haiku-4-5", "enabled"],
    ["claude-opus-5", "adaptive"],
    ["claude-fable-5-1", "adaptive"],
  ])("migrates an old true toggle for %s to its supported %s mode", (model, expected) => {
    const store = storeWith({ [`anthropic:${model}`]: [oldOption("thinking", "true")] });
    const option = selected(store, model, "thinking");
    expect(option.value).toBe(expected);
    expect(option.values).toContain(expected);
    expect(optionsToParams(store.optionsFor(model, "anthropic")).thinking).toBe(expected);
  });

  it.each(["false", "disabled"])("does not disable Fable 5.1 from a saved %s setting", (value) => {
    const store = storeWith({ "anthropic:claude-fable-5-1": [oldOption("thinking", value)] });
    expect(selected(store, "claude-fable-5-1", "thinking")).toMatchObject({ value: "adaptive", values: ["adaptive"] });
  });

  it.each([
    ["claude-sonnet-4-6", "anthropic", "xhigh", "high"],
    ["gpt-6-astra", "openai", "none", "medium"],
    ["gpt-5.5", "openai", "max", "medium"],
    ["gemini-3.8-flash", "google", "minimal", "medium"],
  ])("replaces unsupported saved effort on %s with the current catalog default", (model, kind, stale, expected) => {
    const store = storeWith({ [`${kind}:${model}`]: [oldOption("reasoning_effort", stale)] });
    const option = selected(store, model, "reasoning_effort", kind);
    expect(option.value).toBe(expected);
    expect(option.values).toContain(expected);
    expect(option.values).not.toContain(stale);
    expect(option.label).not.toBe("Old label");
  });

  it("limits Opus 5 effort when thinking is disabled without changing later adaptive options or the catalog", async () => {
    const catalogBefore = structuredClone(MODEL_CATALOG);
    const stored = [oldOption("thinking", "disabled"), oldOption("reasoning_effort", "max")];
    const storedBefore = structuredClone(stored);
    const store = storeWith({ "anthropic:claude-opus-5": stored });
    const disabled = store.optionsFor("claude-opus-5", "anthropic");
    expect(optionsToParams(disabled)).toMatchObject({ thinking: "disabled", reasoningEffort: "high" });
    expect(disabled.find((option) => option.key === "reasoning_effort")?.values).toEqual(["low", "medium", "high"]);
    expect(stored).toEqual(storedBefore);

    await store.set({ modelOptions: { "anthropic:claude-opus-5": [oldOption("thinking", "adaptive"), oldOption("reasoning_effort", "max")] } });
    const adaptive = store.optionsFor("claude-opus-5", "anthropic");
    expect(optionsToParams(adaptive)).toMatchObject({ thinking: "adaptive", reasoningEffort: "max" });
    expect(adaptive.find((option) => option.key === "reasoning_effort")?.values).toEqual(["low", "medium", "high", "xhigh", "max"]);
    // Editing a returned dropdown must not poison future resolutions either.
    adaptive.find((option) => option.key === "reasoning_effort")!.values!.push("fixture-only");
    expect(selected(store, "claude-opus-5", "reasoning_effort").values).not.toContain("fixture-only");
    expect(MODEL_CATALOG).toEqual(catalogBefore);
  });

  it("preserves a valid saved context selection while replacing stale effort capabilities", () => {
    const store = storeWith({ "openai:gpt-6-astra": [oldOption("reasoning_effort", "none"), oldOption("max_context", "256k")] });
    expect(optionsToParams(store.optionsFor("gpt-6-astra", "openai"))).toMatchObject({ reasoningEffort: "medium", maxContext: "256k" });
    expect(selected(store, "gpt-6-astra", "max_context", "openai").values).toContain("1.05m");
  });

  it("keeps a smaller custom context budget when the new dropdown omits that size", () => {
    const store = storeWith({ "anthropic:claude-sonnet-4-6": [oldOption("max_context", "300k")] });
    const option = selected(store, "claude-sonnet-4-6", "max_context");
    expect(option.value).toBe("300k");
    expect(option.values).toContain("300k");
    expect(option.values).toContain("1m");
    expect(optionsToParams(store.optionsFor("claude-sonnet-4-6", "anthropic")).maxContext).toBe("300k");
  });

  it.each(["2m", "0", "-32k", "banana300k"])("replaces invalid or oversized saved context %s with the current default", (value) => {
    const store = storeWith({ "anthropic:claude-sonnet-4-6": [oldOption("max_context", value)] });
    const option = selected(store, "claude-sonnet-4-6", "max_context");
    expect(option.value).toBe("1m");
    expect(option.values).not.toContain(value);
  });

  it("keeps public Google and Antigravity overrides separate and uses plain-id settings only as a fallback", () => {
    const model = "gemini-3.5-flash";
    const store = storeWith({
      [model]: [oldOption("reasoning_effort", "high"), oldOption("max_context", "128k")],
      [`google:${model}`]: [oldOption("reasoning_effort", "minimal"), oldOption("max_context", "256k")],
      [`antigravity:${model}`]: [oldOption("reasoning_effort", "none"), oldOption("max_context", "64k")],
    });
    expect(optionsToParams(store.optionsFor(model, "google"))).toEqual({ reasoningEffort: "minimal", maxContext: "256k" });
    expect(optionsToParams(store.optionsFor(model, "antigravity"))).toEqual({ reasoningEffort: "none", maxContext: "64k" });
    expect(optionsToParams(store.optionsFor(model))).toEqual({ reasoningEffort: "high", maxContext: "128k" });
    expect(store.defFor(model, "google")?.kind).toBe("google");
    expect(store.defFor(model, "antigravity")?.kind).toBe("antigravity");
    expect(store.defFor(model, "codex")).toBeUndefined();
  });
});

describe("current flagship catalog boundaries", () => {
  it.each([
    ["gpt-6-astra", "openai"], ["claude-fable-5-1", "anthropic"],
    ["gemini-3.8-flash", "google"], ["gemini-3.5-flash-lite", "google"],
  ])("includes the active %s flagship or economical tier for %s", (id, kind) => {
    expect(MODEL_CATALOG.some((model) => model.id === id && kindMatches(model.kind, kind) && model.enabled !== false)).toBe(true);
  });

  it("keeps standalone GPT Pro on the public API and excludes retired Google Pro from public presets", () => {
    const store = storeWith();
    expect(store.defFor("gpt-5.5-pro", "openai")).toBeDefined();
    expect(store.defFor("gpt-5.5-pro", "codex")).toBeUndefined();
    expect(store.defFor("gemini-3-pro-preview", "google")).toBeUndefined();
    expect(store.defFor("gemini-3.1-pro-preview", "google")).toBeDefined();
  });
});

describe("web search provider settings", () => {
  it("keeps existing installs on DuckDuckGo and persists an explicit Parallel choice", async () => {
    const store = storeWith({});
    expect(store.get().webSearchProvider).toBe("duckduckgo");
    await store.set({ webSearchProvider: "parallel" });
    expect(store.get().webSearchProvider).toBe("parallel");
    await store.set({ webSearchEnabled: false });
    expect(store.get().webSearchProvider).toBe("parallel");
    expect(store.get().webSearchEnabled).toBe(false);
  });
});
