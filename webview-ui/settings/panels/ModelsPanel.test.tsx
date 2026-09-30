/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as React from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MODEL_CATALOG, PROVIDER_PRESETS, kindMatches } from "../../../src/stores/featureStore";
import { EMPTY_FEATURES, PROVIDER_PRESETS as UI_PROVIDER_PRESETS, POPULAR_KINDS, type FeatureConfig, type ModelDef, type OAuthStatus, type ProviderConfig } from "../features";
import { ModelsPanel } from "./ModelsPanel";

vi.mock("vscode", () => ({ EventEmitter: class { event = () => ({ dispose() {} }); fire() {} } }));
vi.mock("../../shared/vscode", () => ({ vscode: { postMessage: vi.fn() } }));

let root: Root;
let container: HTMLDivElement;
let createRoot: typeof import("react-dom/client").createRoot;
let closeDOM: () => void;
const saved = vi.fn<(patch: Partial<FeatureConfig>) => void>();
const fetchModels = vi.fn();

const connected = ["openai", "anthropic", "xai", "deepseek", "moonshot", "z-ai", "minimax", "qwen"].map(kind => ({
  id: `popular:${kind}`, kind, name: kind, baseUrl: UI_PROVIDER_PRESETS[kind as keyof typeof UI_PROVIDER_PRESETS].baseUrl, hasKey: true,
})) as ProviderConfig[];
const signedIn: OAuthStatus = { accounts: [{ id: "codex-one", kind: "codex" }, { id: "claude-one", kind: "claude-code" }], errors: {} };
function Harness({ providers = connected, oauthStatus = signedIn, modelList = [], customModels = [] }: {
  providers?: ProviderConfig[]; oauthStatus?: OAuthStatus; modelList?: ModelDef[]; customModels?: ModelDef[];
}) {
  const [features, setFeatures] = React.useState<FeatureConfig>(() => ({
    ...structuredClone(EMPTY_FEATURES),
    // A saved list from before these models shipped is not an exclusive allowlist.
    enabledModels: ["gpt-5.4"],
    disabledModels: ["gpt-6-luna", "claude-opus-5-5"],
    providers,
    customModels,
  }));
  return <ModelsPanel models={[]} modelList={modelList} catalog={MODEL_CATALOG} features={features}
    setFeatures={patch => { saved(patch); setFeatures(previous => ({ ...previous, ...patch })); }}
    fetchModels={fetchModels} llamacppStatus={{ installed: false, running: {}, loading: {}, errors: {}, logs: {} }}
    ollamaModels={[]} oauthStatus={oauthStatus} />;
}

function search(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function cards(): HTMLElement[] { return [...container.querySelectorAll<HTMLElement>(".feature-card")]; }
function title(card: HTMLElement) { return card.querySelector(".fc-title-input > span")?.textContent; }
function cardFor(provider: string): HTMLElement {
  const card = cards().find(element => title(element) === provider);
  if (!card) throw new Error(`Provider section not found: ${provider}`);
  return card;
}
function rowFor(provider: string, model: string): HTMLElement {
  const row = [...cardFor(provider).querySelectorAll<HTMLElement>(".model-row")].find(element =>
    [...element.querySelectorAll(".model-name > span")].some(span => span.textContent === model));
  if (!row) throw new Error(`Model ${model} not found under ${provider}`);
  return row;
}
function toggle(provider: string, model: string): HTMLInputElement {
  return rowFor(provider, model).querySelector<HTMLInputElement>('input[type="checkbox"]')!;
}

// Keep the node loader for the real host catalog's mocked vscode dependency.
// Install a DOM before loading React DOM so input events use its browser path.
beforeAll(async () => {
  const moduleName = "jsdom";
  const { JSDOM } = await import(moduleName);
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Event", "MouseEvent", "Node", "getComputedStyle"]) {
    vi.stubGlobal(key, key === "window" ? dom.window : dom.window[key]);
  }
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  ({ createRoot } = await import("react-dom/client"));
  closeDOM = () => dom.window.close();
});
afterAll(() => { closeDOM(); vi.unstubAllGlobals(); });
beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<Harness />));
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe("current catalog in the actual Models panel", () => {
  it("keeps connection presets identical in host and settings", () => {
    expect(UI_PROVIDER_PRESETS).toEqual(PROVIDER_PRESETS);
    for (const kind of ["xai", "deepseek", "moonshot", "z-ai", "minimax", "qwen"]) {
      expect(POPULAR_KINDS).toContain(kind);
      expect(MODEL_CATALOG.some(model => kindMatches(model.kind, kind))).toBe(true);
    }
  });

  it("hides unconnected providers and unavailable local runtimes", () => {
    act(() => root.render(<Harness key="empty" providers={[]} oauthStatus={{ accounts: [], errors: {} }} />));
    expect(cards()).toHaveLength(0);
    expect(container.textContent).toContain("Connect and enable a provider");
    expect(saved).not.toHaveBeenCalled();
  });

  it("hides disabled providers, disabled accounts and key pools without a usable key", () => {
    const providers = connected.map(provider => ({ ...provider, enabled: false }));
    providers[0] = { ...providers[0], enabled: true, apiKeys: [{ id: "off", label: "Disabled", hasKey: true, enabled: false }] };
    providers[1] = { ...providers[1], enabled: true, apiKeys: [{ id: "missing", label: "Missing", hasKey: false }] };
    providers[3] = { ...providers[3], enabled: true, hasKey: false, apiKeys: [{ id: "ready", label: "Work", hasKey: true }] };
    act(() => root.render(<Harness key="disabled" providers={providers} oauthStatus={{ accounts: signedIn.accounts.map(account => ({ ...account, disabled: true })), errors: {} }} />));
    expect(cards().map(title)).toEqual(["DeepSeek"]);
    expect(cardFor("DeepSeek").textContent).toContain("connected");
  });

  it.each([
    ["GPT-6 Sol", "gpt-6-sol", "GPT-6 Sol", ["OpenAI", "OpenAI Codex"]],
    ["gpt-6-luna", "gpt-6-luna", "GPT-6 Luna", ["OpenAI", "OpenAI Codex"]],
    ["Opus 5.5", "claude-opus-5-5", "Claude Opus 5.5", ["Anthropic", "Claude Code"]],
    ["grok-4.7", "grok-4.7", "Grok 4.7", ["xAI"]],
    ["DeepSeek V4.1", "deepseek-flash", "DeepSeek V4.1 Flash", ["DeepSeek"]],
    ["kimi-k3", "kimi-k3", "Kimi K3", ["Moonshot / Kimi"]],
    ["glm-5.3-flashx", "glm-5.3-flashx", "GLM-5.3 FlashX", ["Z.ai"]],
    ["MiniMax M3", "MiniMax-M3", "MiniMax M3", ["MiniMax"]],
    ["qwen3.8-max", "qwen3.8-max", "Qwen3.8 Max", ["Qwen"]],
  ])("finds %s by name or ID only under its serving providers", (query, id, name, providers) => {
    search(query as string);
    expect(cards().map(title).sort()).toEqual([...(providers as string[])].sort());
    for (const provider of providers as string[]) {
      const row = rowFor(provider, id as string);
      expect(row.textContent).toContain(name);
      expect(row.querySelector('input[type="checkbox"]')).not.toBeNull();
    }
    expect(saved).not.toHaveBeenCalled();
  });

  it("enables newly shipped defaults despite an older saved list and retains explicit disables", () => {
    search("gpt-6-");
    for (const provider of ["OpenAI", "OpenAI Codex"]) {
      expect(toggle(provider, "gpt-6-sol").checked).toBe(true);
      expect(toggle(provider, "gpt-6-luna").checked).toBe(false);
    }
    act(() => toggle("OpenAI", "gpt-6-sol").click());
    expect(saved).toHaveBeenLastCalledWith({ enabledModels: ["gpt-5.4"], disabledModels: ["gpt-6-luna", "claude-opus-5-5", "gpt-6-sol"] });
    expect(toggle("OpenAI Codex", "gpt-6-sol").checked).toBe(false);
    search("grok-4.7");
    expect(toggle("xAI", "grok-4.7").checked).toBe(true);
    search("claude-opus-5-5");
    expect(toggle("Anthropic", "claude-opus-5-5").checked).toBe(false);
  });

  it("restores one explicitly disabled new model without dropping unrelated saved choices", () => {
    search("gpt-6-luna");
    act(() => toggle("OpenAI Codex", "gpt-6-luna").click());
    expect(saved).toHaveBeenLastCalledWith({ enabledModels: ["gpt-5.4", "gpt-6-luna"], disabledModels: ["claude-opus-5-5"] });
    expect(toggle("OpenAI", "gpt-6-luna").checked).toBe(true);
    search("no-model-matches-this-query");
    expect(container.textContent).toContain('No models match "no-model-matches-this-query".');
    expect(cards()).toHaveLength(0);
    expect(saved).toHaveBeenCalledOnce();
  });

  it("shows only discovered Antigravity variants while retaining the refresh action before discovery", () => {
    const oauthStatus: OAuthStatus = { accounts: [{ id: "google", kind: "antigravity" }], errors: {} };
    act(() => root.render(<Harness key="antigravity" providers={[]} oauthStatus={oauthStatus} />));
    const card = cards()[0];
    expect(card.textContent).toContain("0/0 enabled");
    const refresh = card.querySelector<HTMLButtonElement>('button[title="Refresh models from this provider"]')!;
    expect(refresh.disabled).toBe(false);
    act(() => refresh.click());
    expect(fetchModels).toHaveBeenCalled();
    const modelList: ModelDef[] = ["high", "medium"].map((variant) => ({
      id: `gemini-3.8-flash-${variant}`, name: `Gemini 3.8 Flash (${variant})`, kind: "antigravity", providerId: "oauth:antigravity",
    }));
    act(() => root.render(<Harness key="antigravity" providers={[]} oauthStatus={oauthStatus} modelList={modelList} />));
    search("gemini-3.8-flash");
    expect(cards()).toHaveLength(1);
    expect(container.textContent).toContain("gemini-3.8-flash-high");
    expect(container.textContent).toContain("gemini-3.8-flash-medium");
    expect(container.textContent).not.toContain("gemini-3.8-flash-low");
    expect(container.querySelectorAll(".model-row")).toHaveLength(2);
  });

  it("keeps Antigravity custom entries advertised and scoped to the account provider", () => {
    const oauthStatus: OAuthStatus = { accounts: [{ id: "google", kind: "antigravity" }], errors: {} };
    const customModels: ModelDef[] = [
      { id: "project-model", name: "Available custom", kind: "antigravity", providerId: "oauth:antigravity" },
      { id: "missing-model", name: "Unavailable custom", kind: "antigravity", providerId: "oauth:antigravity" },
      { id: "foreign-model", name: "API custom", kind: "antigravity", providerId: "custom-api" },
    ];
    const modelList: ModelDef[] = [
      { id: "project-model", name: "project-model", kind: "antigravity", providerId: "oauth:antigravity" },
      { id: "foreign-model", name: "API custom", kind: "antigravity", providerId: "custom-api" },
    ];
    act(() => root.render(<Harness key="antigravity-custom" providers={[]} oauthStatus={oauthStatus} modelList={modelList} customModels={customModels} />));
    search("model");
    expect(cards()).toHaveLength(1);
    expect(container.querySelectorAll(".model-row")).toHaveLength(1);
    expect(container.textContent).toContain("project-model");
    expect(container.textContent).not.toContain("missing-model");
    expect(container.textContent).not.toContain("foreign-model");
  });

  it("treats an empty Antigravity refresh as authoritative and replaces stale refresh IDs on a global update", () => {
    const oauthStatus: OAuthStatus = { accounts: [{ id: "google", kind: "antigravity" }], errors: {} };
    const modelList: ModelDef[] = [{ id: "gemini-3.8-flash-high", name: "Flash high", kind: "antigravity", providerId: "oauth:antigravity" }];
    act(() => root.render(<Harness key="antigravity-refresh" providers={[]} oauthStatus={oauthStatus} modelList={modelList} />));
    search("gemini-3.8-flash");
    expect(container.querySelectorAll(".model-row")).toHaveLength(1);
    act(() => window.dispatchEvent(new window.MessageEvent("message", { data: { type: "modelsFetched", providerId: "oauth:antigravity", models: [] } })));
    expect(cards()).toHaveLength(0);
    act(() => window.dispatchEvent(new window.MessageEvent("message", { data: { type: "modelsFetched", providerId: "oauth:antigravity", models: ["gemini-3.8-flash-medium"] } })));
    expect(container.textContent).toContain("gemini-3.8-flash-medium");
    expect(container.textContent).not.toContain("gemini-3.8-flash-high");
    act(() => window.dispatchEvent(new window.MessageEvent("message", { data: { type: "modelsFetched", modelList } })));
    expect(container.textContent).toContain("gemini-3.8-flash-high");
    expect(container.textContent).not.toContain("gemini-3.8-flash-medium");
  });
});
