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
import { BUILTIN_TEAM_SUBAGENTS } from "../agent/teams";

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

describe("model speed preferences", () => {
  it("defaults supported models to standard without changing reasoning", () => {
    const store = storeWith();
    expect(optionsToParams(store.optionsFor("gpt-6-astra", "openai"))).toMatchObject({ speed: "standard", reasoningEffort: "medium" });
    expect(selected(store, "claude-opus-5-5", "speed")).toMatchObject({ value: "standard", values: ["standard", "fast"], description: expect.stringContaining("extra credits") });
  });
  it("persists qualified and account choices independently and resets to standard", async () => {
    const store = storeWith({ "openai:cx/gpt-6-astra": [oldOption("speed", "fast")], "claude-code:claude-opus-5-5": [oldOption("speed", "fast")] });
    expect(optionsToParams(store.optionsFor("cx/gpt-6-astra", "openai")).speed).toBe("fast");
    expect(optionsToParams(store.optionsFor("claude-opus-5-5", "claude-code")).speed).toBe("fast");
    expect(optionsToParams(store.optionsFor("claude-opus-5-5", "anthropic")).speed).toBe("standard");
    await store.set({ modelOptions: {} });
    expect(optionsToParams(store.optionsFor("cx/gpt-6-astra", "openai")).speed).toBe("standard");
  });
  it("ignores unsupported models, providers, and invalid stored speed values", () => {
    const store = storeWith({ "google:gpt-6-astra": [oldOption("speed", "fast")], "openai:gpt-6-astra": [oldOption("speed", "ultrafast")] });
    expect(optionsToParams(store.optionsFor("gpt-6-astra", "google")).speed).toBeUndefined();
    expect(optionsToParams(store.optionsFor("claude-opus-4-6", "anthropic")).speed).toBeUndefined();
    expect(optionsToParams(store.optionsFor("gpt-6-astra", "openai")).speed).toBe("standard");
    expect(optionsToParams([oldOption("speed", "ultrafast")]).speed).toBeUndefined();
  });
});

describe("provider-qualified model options", () => {
  it.each([["cc", "claude-code", "claude-opus-5-5"], ["cx", "codex", "gpt-6-astra"], ["gemini", "google", "gemini-3.8-flash"], ["ag", "antigravity", "gemini-3.8-flash-low"]])("resolves %s metadata without changing the request ID", (prefix, source, id) => {
    const store = storeWith();
    const qualified = `${prefix}/${id}`;
    expect(store.defFor(qualified, "openai")?.id).toBe(qualified);
    expect(store.optionsFor(qualified, "openai")).toEqual(store.optionsFor(id, source));
  });
  it("preserves alias-specific settings and rejects unknown prefixes", () => {
    const store = storeWith({ "openai:cx/gpt-6-astra": [oldOption("reasoning_effort", "low")] });
    expect(selected(store, "cx/gpt-6-astra", "reasoning_effort", "openai").value).toBe("low");
    expect(store.defFor("unknown/gpt-6-astra", "openai")).toBeUndefined();
    expect(store.defFor("cx/gpt-6-astra", "google")).toBeUndefined();
  });
});

describe("built-in subagent customization", () => {
  it("persists edits under the original identity and preserves team membership", async () => {
    const store = storeWith();
    const original = store.get();
    const preset = original.subagents[0];
    const edited = { ...preset, name: "My specialist", description: "My description", prompt: "My instructions", readonly: !preset.readonly, model: "local-model", builtin: false };
    await store.set({ subagents: original.subagents.map(sub => sub.id === preset.id ? edited : sub) });
    await store.set({ motion: "reduced" });
    const restored = store.get();
    expect(restored.subagents.find(sub => sub.id === preset.id)).toEqual({ ...edited, builtin: true });
    expect(restored.subagents).toHaveLength(original.subagents.length);
    expect(restored.teams).toEqual(original.teams);
  });

  it("stores only changed fields and resets all overrides to shipped defaults", async () => {
    const store = storeWith();
    const preset = BUILTIN_TEAM_SUBAGENTS[0];
    await store.set({ subagents: store.get().subagents.map(sub => sub.id === preset.id ? { ...sub, model: "local-model" } : sub) });
    expect(store.get().builtinSubagentOverrides).toEqual({ [preset.id]: { model: "local-model" } });
    await store.set({ subagents: store.get().subagents.map(sub => sub.id === preset.id ? { ...preset } : sub) });
    expect(store.get().builtinSubagentOverrides).toEqual({});
    expect(store.get().subagents.find(sub => sub.id === preset.id)).toEqual(preset);
  });

  it("restores omitted built-ins while allowing custom agents to be deleted", async () => {
    const store = storeWith();
    const preset = store.get().subagents[0];
    await store.set({ subagents: [...store.get().subagents, { ...preset, id: "my-custom", name: "Custom", builtin: false }] });
    await store.set({ subagents: store.get().subagents.filter(sub => sub.id !== preset.id && sub.id !== "my-custom") });
    expect(store.get().subagents.find(sub => sub.id === preset.id)).toEqual(preset);
    expect(store.get().subagents.find(sub => sub.id === "my-custom")).toBeUndefined();
  });
});

it("defaults animation to enabled and persists the selected motion policy", async () => {
  const store = storeWith();
  expect(store.get().motion).toBe("full");
  await store.set({ motion: "system" });
  expect(store.get().motion).toBe("system");
  await store.set({ motion: "reduced" });
  expect(store.get().motion).toBe("reduced");
});

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
    const model = "gemini-3.8-flash";
    const store = storeWith({
      [model]: [oldOption("reasoning_effort", "high"), oldOption("max_context", "128k")],
      [`google:${model}`]: [oldOption("reasoning_effort", "low"), oldOption("max_context", "256k")],
      [`antigravity:${model}`]: [oldOption("reasoning_effort", "none"), oldOption("max_context", "64k")],
    });
    expect(optionsToParams(store.optionsFor(model, "google"))).toEqual({ reasoningEffort: "low", maxContext: "256k" });
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

  it.each(["gpt-6-sol", "gpt-6-luna"])("retains a saved no-reasoning choice for %s while adding supported controls", (model) => {
    const store = storeWith({ [`openai:${model}`]: [oldOption("reasoning_effort", "none"), oldOption("max_context", "64k")] });
    expect(optionsToParams(store.optionsFor(model, "openai"))).toEqual({ reasoningEffort: "none", maxContext: "64k", speed: "standard" });
    expect(selected(store, model, "reasoning_effort", "openai").values).toEqual(["none", "low", "medium", "high", "xhigh", "max"]);
    expect(selected(store, model, "max_context", "openai").values).toContain("1.05m");
    expect(store.defFor(model, "codex")).toBeDefined();
  });

  it.each(["disabled", "false", "enabled"])("migrates Opus 5.5's stale %s thinking option without losing max effort", (value) => {
    const model = "claude-opus-5-5";
    const store = storeWith({ [`anthropic:${model}`]: [oldOption("thinking", value), oldOption("reasoning_effort", "max")] });
    expect(optionsToParams(store.optionsFor(model, "anthropic"))).toEqual({ thinking: "adaptive", reasoningEffort: "max", maxContext: "1m", speed: "standard" });
    expect(selected(store, model, "thinking").values).toEqual(["adaptive"]);
    expect(selected(storeWith(), model, "reasoning_effort").value).toBe("medium");
  });

  it.each([
    ["grok-4.7", "xai", "high", "500k"],
    ["deepseek-flash", "deepseek", "high", "1m"],
    ["deepseek-v4-pro", "deepseek", "high", "1m"],
    ["kimi-k3", "moonshot", "max", "1m"],
    ["glm-5.3", "z-ai", "max", "1m"],
    ["glm-5.3-flash", "z-ai", "max", "1m"],
    ["glm-5.3-flashx", "z-ai", "max", "1m"],
    ["qwen3.8-max", "qwen", "xhigh", "1m"],
  ])("scopes %s options to %s and replaces stale unsupported reasoning", (model, kind, effort, context) => {
    const store = storeWith({ [`${kind}:${model}`]: [oldOption("reasoning_effort", "ultra")] });
    expect(store.defFor(model, "openai")).toBeUndefined();
    expect(store.defFor(model, "ollama")).toBeUndefined();
    expect(optionsToParams(store.optionsFor(model, kind))).toMatchObject({ reasoningEffort: effort, maxContext: context });
  });

});
