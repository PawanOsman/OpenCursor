/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "./sidebarProvider";
import { ConversationStore } from "../stores/conversationStore";
import { runAgent } from "../agent/loop";
import { generateTitle } from "../agent/provider";
import * as oauth from "../agent/oauth";
import { PROVIDER_PRESETS } from "../shared/providerCatalog";
import { recordUsage } from "../stores/usageStore";
import { DEFAULT_APPROVAL, type ApprovalPolicy } from "../agent/approvalPolicy";
import { MODEL_CATALOG, type ModelDef } from "../stores/featureStore";
import * as vscode from "vscode";
import { pendingChanges } from "../stores/pendingChanges";

vi.mock("vscode", () => ({ window: { showWarningMessage: vi.fn(), showErrorMessage: vi.fn(), state: { focused: true } }, commands: { executeCommand: vi.fn() } }));
vi.mock("../agent/loop", () => ({ runAgent: vi.fn() }));
vi.mock("../agent/provider", () => ({ generateTitle: vi.fn(), listModels: vi.fn() }));
vi.mock("../stores/featureStore", () => ({ MODEL_CATALOG: [], optionsToParams: () => ({}), kindMatches: (a: string, b: string) => a === b, providerEnabled: (p: any) => p.enabled !== false }));
vi.mock("../agent/llamacpp", () => ({ ensureLoaded: vi.fn(), serverUrlFor: () => "http://local" }));
vi.mock("../agent/ollama", () => ({ ollamaOpenAIBase: () => "http://ollama" }));
vi.mock("../agent/oauth", () => ({ isConnected: vi.fn(() => true), OAUTH_LABEL: { codex: "Codex" } }));
vi.mock("../stores/usageStore", () => ({ recordUsage: vi.fn() }));
vi.mock("../integrations/hooksRunner", () => ({ runHooks: vi.fn(), runBlockingHooks: vi.fn(async () => undefined) }));
vi.mock("../context/workspaceUtils", () => ({ getWorkspaceRoot: () => "/workspace", safePath: (p: string) => p, withWorkspaceRoot: (_root: string | undefined, work: () => unknown) => work() }));
vi.mock("../agent/personas", () => ({}));
vi.mock("../stores/pendingChanges", () => ({ pendingChanges: { rejectAll: vi.fn(), list: vi.fn(() => []), get: vi.fn() } }));
vi.mock("./fileIcons", () => ({}));
vi.mock("../context/mentions", () => ({ resolveMentions: vi.fn() }));
vi.mock("../logging", () => ({ getLog: () => ({ appendLine: vi.fn() }), logError: vi.fn() }));

function memento() {
  const values = new Map<string, any>();
  return {
    get: (key: string, fallback?: any) => values.has(key) ? structuredClone(values.get(key)) : fallback,
    update: async (key: string, value: any) => {
      if (value === undefined) values.delete(key);
      else values.set(key, structuredClone(value));
    },
  };
}
async function fixture(approvalPolicy: ApprovalPolicy = structuredClone(DEFAULT_APPROVAL)) {
  const context = { globalState: memento(), workspaceState: memento() };
  const store = new ConversationStore(context as any);
  const a = await store.create(), b = await store.create();
  const features = { providers: [{ id: "api", kind: "anthropic", enabled: true, baseUrl: "https://api.example.test" }], llamacppModels: [], autoGenerateTitles: false, hooks: [], subagents: [], approvalPolicy, maxAgentSteps: 10 };
  const host = new SidebarProvider(context as any, { getSettings: () => ({ model: "api::model", maxResponseLength: 0 }), getProviderKey: async () => "test-key" } as any, { get: () => features, allModels: () => [], optionsFor: () => [] } as any) as any;
  host._activeId = b.id;
  host._view = { webview: { postMessage: vi.fn() } };
  host._sendConversations = vi.fn();
  host._personaPromptFor = () => "test prompt";
  host._contextTokensFor = () => 8000;
  host._modelsForProvider = () => [];
  host.featureStore.optionsFor = () => [];
  return { host, store, a, b, features };
}
function session() {
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => { resolveDone = resolve; });
  return { abort: new AbortController(), pendingApprovals: new Map(), pendingQuestions: new Map(), subagentAborts: new Map(), turns: [], history: [], contextState: {}, done, resolveDone };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(oauth.isConnected).mockReturnValue(true);
  MODEL_CATALOG.length = 0;
});

describe("composer approval presets", () => {
  it("updates only known modes, preserves pattern rules and ignores malformed presets", async () => {
    const saved = structuredClone(DEFAULT_APPROVAL);
    saved.shell.denylist = ["git push"];
    saved.outside.allowlist = ["/approved/**"];
    const { host } = await fixture(saved);
    host.featureStore.set = vi.fn();
    for (const invalid of ["deny", "custom", "constructor", undefined, {}, ["allow"]]) await host._setApprovalPreset(invalid);
    expect(host.featureStore.set).not.toHaveBeenCalled();
    for (const preset of ["allow", "review", "ask"]) {
      await host._setApprovalPreset(preset);
      const next = host.featureStore.set.mock.calls.at(-1)[0].approvalPolicy as ApprovalPolicy;
      expect(Object.values(next).every((rule) => rule.mode === preset)).toBe(true);
      expect(next.shell.denylist).toEqual(["git push"]);
      expect(next.outside.allowlist).toEqual(["/approved/**"]);
    }
    expect(saved.shell.mode).toBe("ask");
  });

  it("uses the normal feature-change path to resolve outstanding approvals", async () => {
    const { host, a, features } = await fixture();
    const s = session(); host._sessions.set(a.id, s);
    host.featureStore.set = vi.fn(async (update) => {
      Object.assign(features, update);
      host._reevaluatePendingApprovals();
    });
    const pending = host._approveTool(a.id, s, "Shell", { command: "npm test" }, "composer-preset");
    expect(s.pendingApprovals.size).toBe(1);
    await host._setApprovalPreset("allow");
    expect(await pending).toBe(true);
    expect(s.pendingApprovals.size).toBe(0);
  });
});

describe("production sidebar saved Allow policy", () => {
  const variableCommand = [
    "cd /project &&",
    'FILE="src/example.ts"; sed -n 1,10p "$FILE"; echo ---; sed -n 20,30p "$FILE"',
  ].join("\n");

  function savedAllowPolicy(): ApprovalPolicy {
    const policy = structuredClone(DEFAULT_APPROVAL);
    for (const rule of Object.values(policy)) rule.mode = "allow";
    policy.shell.denylist = ["git push", "git reset --hard", "npm publish", "rm -rf"];
    return policy;
  }

  it("runs variable-based shell commands without a card when Allow and unrelated deny rules were saved before the run", async () => {
    const { host, a } = await fixture(savedAllowPolicy());
    const s = session();
    host._sessions.set(a.id, s);
    const approval = host._approveTool(a.id, s, "Shell", { command: variableCommand }, "shell-allow");
    try {
      expect(s.pendingApprovals.size).toBe(0);
      expect(host._view.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "approvalRequest" }));
      expect(await approval).toBe(true);
    } finally {
      s.abort.abort();
    }
  });

  it("still blocks an explicitly denied chained command under the saved Allow policy", async () => {
    const { host, a } = await fixture(savedAllowPolicy());
    const s = session();
    host._sessions.set(a.id, s);
    expect(await host._approveTool(a.id, s, "Shell", { command: `${variableCommand}; git push origin main` }, "shell-deny")).toEqual({
      approved: false,
      blockedSubject: "git push origin main",
    });
    expect(s.pendingApprovals.size).toBe(0);
    expect(host._view.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "approvalRequest" }));
  });
});

describe("production sidebar session lifecycle", () => {
  it("saves live tool history and waits for Stop cleanup before sending a follow-up", async () => {
    const { host, a, store } = await fixture();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void;
    const cleanup = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(runAgent).mockImplementationOnce(async (opts) => {
      opts.history.push(
        { kind: "user", text: opts.prompt },
        { kind: "assistant", text: "Found the failing branch", calls: [{ id: "read", name: "Read", arguments: '{"path":"src/issue.ts"}' }] },
        { kind: "tool-result", callId: "read", name: "Read", status: "completed", output: "The exact source already inspected" },
      );
      opts.contextState!.todos = [{ id: "fix", content: "Fix the failing branch", status: "in_progress" }];
      opts.emit({ type: "tool-call-completed", callId: "read", name: "Read", status: "completed", result: "The exact source already inspected" });
      host._persistTurnsNow(a.id, host._sessions.get(a.id));
      entered();
      await new Promise<void>((resolve) => opts.signal.addEventListener("abort", () => resolve(), { once: true }));
      await cleanup;
      opts.history.push({ kind: "assistant", text: "Interrupted while preparing the fix", calls: [] });
    });
    const running = host._handleMessage("Fix this issue", undefined, { convId: a.id });
    await started;
    // A persisted snapshot must contain model history before runAgent returns.
    expect(store.get(a.id)?.steps.at(-1)).toMatchObject({ kind: "tool-result", output: "The exact source already inspected" });
    expect(store.get(a.id)?.contextState?.todos?.[0].id).toBe("fix");
    host._cancelSession(a.id);
    const followup = host._handleMessage("Continue", undefined, { convId: a.id });
    expect(vi.mocked(runAgent)).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([running, followup]);
    const resumed = vi.mocked(runAgent).mock.calls[1][0];
    expect(resumed.history).toEqual(store.get(a.id)?.steps);
    expect(resumed.history).toContainEqual(expect.objectContaining({ kind: "tool-result", output: "The exact source already inspected" }));
    expect(resumed.history.at(-1)).toMatchObject({ text: "Interrupted while preparing the fix" });
    expect(resumed.contextState?.todos?.[0].id).toBe("fix");
  });

  it("Stop resolves pending approval and remains idempotent", async () => {
    const { host, a } = await fixture();
    const s = session();
    host._sessions.set(a.id, s);
    const pending = host._approveTool(a.id, s, "Shell", { command: "npm test" }, "shell-1");
    expect(s.pendingApprovals.size).toBe(1);
    host._cancelSession(a.id);
    host._cancelSession(a.id);
    expect(await pending).toBe(false);
    expect(s.pendingApprovals.size).toBe(0);
    expect(s.abort.signal.aborted).toBe(true);
  });

  it("settles an approval requested after the signal was already aborted", async () => {
    const { host, a } = await fixture();
    const s = session();
    s.abort.abort();
    expect(await host._approveTool(a.id, s, "Shell", { command: "npm test" }, "shell-1")).toBe(false);
  });

  it("routes explicit background sends with their original mode/model", async () => {
    const { host, a, b, store } = await fixture();
    host._resolveProviderForModel = vi.fn(async (id: string) => ({ baseUrl: "https://api.example.test", apiKey: "test", model: id, anthropic: false }));
    await host._handleMessage("queued for A", undefined, { convId: a.id, model: "queued-model", mode: "ask" });
    const opts = vi.mocked(runAgent).mock.calls[0][0];
    expect(opts).toMatchObject({ prompt: "queued for A", model: "queued-model", mode: "ask", promptCacheKey: a.id });
    expect(store.get(a.id)?.turns[0]).toMatchObject({ text: "queued for A", model: "queued-model", mode: "ask" });
    expect(store.get(b.id)?.turns).toEqual([]);
    expect(host._activeId).toBe(b.id);
  });

  it("deleting a live conversation waits for cancellation and final cleanup", async () => {
    const { host, a, store } = await fixture();
    let release!: () => void;
    const cleanup = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    vi.mocked(runAgent).mockImplementationOnce(async (opts) => {
      entered();
      await new Promise<void>((resolve) => opts.signal.addEventListener("abort", () => resolve(), { once: true }));
      await cleanup;
    });
    const running = host._handleMessage("work", undefined, { convId: a.id });
    await started;
    const deleting = host._deleteConversation(a.id);
    expect(host._sessions.get(a.id).abort.signal.aborted).toBe(true);
    expect(store.get(a.id)).toBeDefined();
    release();
    await Promise.all([running, deleting]);
    expect(store.get(a.id)).toBeUndefined();
    expect(host._sessions.has(a.id)).toBe(false);
  });

  it("records title usage and cancels a pending title when its completed chat is deleted", async () => {
    const { host, a, features } = await fixture();
    features.autoGenerateTitles = true;
    let titleSignal!: AbortSignal;
    vi.mocked(generateTitle).mockImplementationOnce(async (...args: any[]) => {
      const options = args[6];
      titleSignal = options.signal;
      options.onUsage({ type: "usage", promptTokens: 11, completionTokens: 3, requestId: "title-request", model: "title-model" });
      await new Promise<void>((resolve) => titleSignal.addEventListener("abort", () => resolve(), { once: true }));
      return "Fixture title";
    });
    await host._handleMessage("work", undefined, { convId: a.id });
    expect(vi.mocked(recordUsage)).toHaveBeenCalledWith("title-model", 11, 3, expect.objectContaining({ requestId: "title-request" }));
    expect(host._sessions.has(a.id)).toBe(false);
    expect(titleSignal.aborted).toBe(false);
    await host._deleteConversation(a.id);
    expect(titleSignal.aborted).toBe(true);
  });

  it("stores nested question answers in the authoritative snapshot", async () => {
    const { host, a, store } = await fixture();
    const s = session() as any;
    s.turns = [{ role: "assistant", blocks: [{ kind: "tool", callId: "task", name: "Task", status: "running", input: {}, subBlocks: [{ kind: "tool", callId: "q", name: "AskQuestion", status: "running", input: {} }] }] }];
    const answer = host._askUser(s, "q", s.abort.signal);
    host._sessions.set(a.id, s);
    host._answerQuestion("q", { "0": ["Keep main"] });
    expect(await answer).toEqual({ "0": ["Keep main"] });
    expect((store.get(a.id)!.turns[0] as any).blocks[0].subBlocks[0].answers).toEqual({ "0": ["Keep main"] });
  });
});

describe("production scoped provider routing", () => {
  it("explicit API scope wins over OAuth and local model collisions", async () => {
    const { host, features } = await fixture();
    host._oauthModelKind.set("claude", "claude-code");
    host._ollamaModelIds.add("claude");
    features.llamacppModels.push({ id: "claude" } as never);
    expect(await host._resolveProviderForModel("api::claude")).toMatchObject({ providerId: "api", apiKey: "test-key", baseUrl: "https://api.example.test", model: "claude" });
    expect((await host._resolveProviderForModel("claude")).oauthKind).toBe("claude-code");
  });
  it("keeps the explicit API endpoint through run startup despite a local model collision", async () => {
    const { host, features, a } = await fixture();
    features.llamacppModels.push({ id: "model" } as never);
    await host._handleMessage("use API", undefined, { convId: a.id, model: "api::model" });
    expect(vi.mocked(runAgent).mock.calls[0][0]).toMatchObject({ apiBaseUrl: "https://api.example.test", apiKey: "test-key", model: "model" });
  });
  it("does not silently substitute another provider when the chosen one is disabled", async () => {
    const { host, features } = await fixture();
    features.providers[0].enabled = false;
    await expect(host._resolveProviderForModel("api::claude")).rejects.toThrow("unavailable or disabled");
  });

  it("keeps synthetic Ollama options local in the picker, parent run and child model resolution", async () => {
    const { host, features, a } = await fixture();
    Object.assign(features, { enabledModels: [], disabledModels: [], disabledLocalModels: [] });
    const model = "gpt-6-sol";
    host._ollamaModelIds.add(model);
    const localOptions = [{ key: "max_context", label: "Context budget", type: "select", values: ["32k"], value: "32k" }];
    host.featureStore.optionsFor = vi.fn((_id: string, kind?: string) => kind === "ollama" ? localOptions : [
      ...localOptions, { key: "speed", label: "Speed", type: "select", values: ["standard", "fast"], value: "fast" },
    ]);
    const models = host._buildModelList([{ providerId: "__ollama__", ids: [model] }]);
    expect(models[0]).toMatchObject({ id: `ollama::${model}`, options: localOptions });
    expect(host.featureStore.optionsFor).toHaveBeenLastCalledWith(model, "ollama");
    host.featureStore.optionsFor.mockClear();
    await host._handleMessage("use local model", undefined, { convId: a.id, model: `ollama::${model}` });
    const run = vi.mocked(runAgent).mock.calls[0][0];
    expect(run).toMatchObject({ apiBaseUrl: "http://ollama", model });
    expect(host.featureStore.optionsFor).toHaveBeenLastCalledWith(model, "ollama");
    run.resolveModelOptions!("gpt-6-luna");
    expect(host.featureStore.optionsFor).toHaveBeenLastCalledWith("gpt-6-luna", "ollama");
  });
});

describe("production catalog update visibility", () => {
  async function modelsFixture(disabledModels: string[] = []) {
    const { host, features } = await fixture();
    const catalog: ModelDef[] = [
      { id: "old-model", name: "Old model", kind: "anthropic" },
      { id: "new-model", name: "New model", kind: "anthropic" },
      { id: "optional-model", name: "Optional model", kind: "anthropic", enabled: false },
    ];
    MODEL_CATALOG.push(...catalog);
    Object.assign(features, {
      providers: [{ id: "popular:anthropic", name: "Anthropic", kind: "anthropic", enabled: true, baseUrl: "https://api.example.test" }],
      enabledModels: ["old-model"], disabledModels, disabledLocalModels: [],
    });
    host.featureStore.allModels = () => catalog;
    host.featureStore.nameFor = (id: string) => id;
    return host;
  }

  it("shows newly shipped catalog defaults with an old saved allowlist before provider discovery", async () => {
    const host = await modelsFixture();
    expect(host._buildModelList([]).map((model: ModelDef) => model.id)).toEqual([
      "popular:anthropic::old-model", "popular:anthropic::new-model",
    ]);
  });

  it("preserves explicit user opt-outs even when the model is a new default or fetched", async () => {
    const host = await modelsFixture(["new-model"]);
    expect(host._buildModelList([{ providerId: "popular:anthropic", ids: ["old-model", "new-model", "uncurated-model"] }]).map((model: ModelDef) => model.id)).toEqual([
      "popular:anthropic::old-model",
    ]);
  });

  it.each(["openrouter", "ollama", "llamacpp"])("does not present cloud catalog IDs as installed or available through %s", async (kind) => {
    const host = await modelsFixture();
    host.featureStore.get().providers.splice(0, 1, { id: `popular:${kind}`, name: kind, kind, enabled: true, baseUrl: "http://fixture.local/v1" });
    expect(host._buildModelList([])).toEqual([]);
    await expect(host._resolveProviderForModel("new-model")).rejects.toThrow("No enabled provider serves");
  });

  it("routes a catalog ID to a custom endpoint only after it advertises that exact ID", async () => {
    const host = await modelsFixture();
    host.featureStore.get().providers.splice(0, 1, { id: "my-proxy", name: "Proxy", kind: "openai", enabled: true, baseUrl: "https://proxy.example/v1" });
    host._modelProvider.set("new-model", "my-proxy");
    expect(await host._resolveProviderForModel("new-model")).toMatchObject({ providerId: "my-proxy", model: "new-model", baseUrl: "https://proxy.example/v1" });
    expect(host._buildModelList([{ providerId: "my-proxy", ids: ["new-model"] }]).map((model: ModelDef) => model.id)).toEqual(["my-proxy::new-model"]);
  });
});

describe("live model availability in the sidebar", () => {
  async function availabilityFixture() {
    const { host, features } = await fixture();
    Object.assign(features, { enabledModels: [], disabledModels: [], disabledLocalModels: [] });
    const model: ModelDef = { id: "chat-model", name: "Chat model", kind: "openai" };
    MODEL_CATALOG.push(model);
    host.featureStore.allModels = () => [model];
    host.featureStore.nameFor = (id: string) => id;
    return { host, features };
  }

  it.each([
    { label: "empty", apiKeys: [] },
    { label: "disabled", apiKeys: [{ id: "popular:openai:key:one", enabled: false }] },
    { label: "missing", apiKeys: [{ id: "popular:openai:key:one", hasKey: false }] },
    { label: "foreign", apiKeys: [{ id: "another-provider:key:one", enabled: true }] },
  ])("hides a $label API key pool and rejects its saved selection", async ({ apiKeys }) => {
    const { host, features } = await availabilityFixture();
    features.providers = [{ id: "popular:openai", name: "OpenAI", kind: "openai", enabled: true,
      baseUrl: PROVIDER_PRESETS.openai.baseUrl, apiKeys }] as any;
    expect(host._buildModelList([{ providerId: "popular:openai", ids: ["chat-model"] }])).toEqual([]);
    await expect(host._resolveProviderForModel("popular:openai::chat-model")).rejects.toThrow("unavailable or disabled");
  });

  it("preserves legacy secrets, custom anonymous endpoints, local providers and connected no-auth presets", async () => {
    const { host, features } = await availabilityFixture();
    features.providers = [
      { id: "popular:openai", kind: "openai", baseUrl: PROVIDER_PRESETS.openai.baseUrl },
      { id: "custom", kind: "openai", baseUrl: "http://localhost:9000/v1", hasKey: false },
      { id: "local", kind: "ollama", baseUrl: "http://localhost:11434/v1" },
      { id: "popular:opencode", kind: "opencode", baseUrl: PROVIDER_PRESETS.opencode.baseUrl, apiKeys: [] },
      { id: "popular:opencode-fake", kind: "opencode", baseUrl: "https://other.example", apiKeys: [] },
      { id: "popular:anthropic", kind: "anthropic", baseUrl: PROVIDER_PRESETS.anthropic.baseUrl, apiKeys: [{ id: "popular:anthropic:key:one", enabled: true }] },
    ] as any;
    expect(host._enabledProviders().map((provider: { id: string }) => provider.id)).toEqual([
      "popular:openai", "custom", "local", "popular:opencode", "popular:anthropic",
    ]);
  });

  it("drops cached OAuth models immediately after accounts are disabled or disconnected", async () => {
    const { host, features } = await availabilityFixture();
    features.providers = [];
    host.featureStore.allModels = () => [{ id: "chat-model", name: "Chat model", kind: "codex" }];
    const fetched = [{ providerId: "__oauth__:codex", ids: ["chat-model"] }];
    expect(host._buildModelList(fetched).map((model: ModelDef) => model.id)).toEqual(["__oauth__:codex::chat-model"]);
    vi.mocked(oauth.isConnected).mockReturnValue(false);
    expect(host._buildModelList(fetched)).toEqual([]);
    await expect(host._resolveProviderForModel("__oauth__:codex::chat-model")).rejects.toThrow("unavailable or disabled");
  });

  it("shows only advertised Antigravity variants even when unavailable variants were saved as enabled", async () => {
    const { host, features } = await availabilityFixture();
    features.providers = [];
    const models: ModelDef[] = ["high", "medium", "low"].map((variant) => ({
      id: `gemini-3.8-flash-${variant}`, name: `Flash ${variant}`, kind: "antigravity",
    }));
    MODEL_CATALOG.push(...models);
    Object.assign(features, { enabledModels: models.map((m) => m.id) });
    host.featureStore.allModels = () => models;
    const fetched = [{ providerId: "__oauth__:antigravity", ids: ["gemini-3.8-flash-high", "gemini-3.8-flash-medium"] }];
    expect(host._buildModelList(fetched).map((model: ModelDef) => model.id)).toEqual([
      "__oauth__:antigravity::gemini-3.8-flash-high", "__oauth__:antigravity::gemini-3.8-flash-medium",
    ]);
    expect(host._buildModelList([{ providerId: "__oauth__:antigravity", ids: [] }])).toEqual([]);
    expect(host._buildModelList([])).toEqual([]);
  });

  it("keeps Antigravity custom models within their advertised provider scope", async () => {
    const { host, features } = await availabilityFixture();
    features.providers = [];
    const models: ModelDef[] = [
      { id: "project-model", name: "Available custom", kind: "antigravity", providerId: "oauth:antigravity" },
      { id: "missing-model", name: "Unavailable custom", kind: "antigravity", providerId: "oauth:antigravity" },
      { id: "foreign-model", name: "API custom", kind: "antigravity", providerId: "custom-api" },
    ];
    host.featureStore.allModels = () => models;
    expect(host._buildModelList([{ providerId: "__oauth__:antigravity", ids: ["project-model"] }]).map((model: ModelDef) => ({ id: model.id, name: model.name }))).toEqual([
      { id: "__oauth__:antigravity::project-model", name: "Available custom" },
    ]);
  });

  it("continues supplementing other OAuth providers with their enabled catalogs", async () => {
    const { host, features } = await availabilityFixture();
    features.providers = [];
    host.featureStore.allModels = () => [{ id: "chat-model", name: "Chat model", kind: "codex" }];
    expect(host._buildModelList([{ providerId: "__oauth__:codex", ids: [] }]).map((model: ModelDef) => model.id)).toEqual([
      "__oauth__:codex::chat-model",
    ]);
  });

  it("keeps OAuth-only connections in automatic model selection", async () => {
    const { host, features } = await availabilityFixture();
    features.providers = [];
    host.featureStore.allModels = () => [{ id: "chat-model", name: "Chat model", kind: "codex" }];
    host._fetchedCache = [{ providerId: "__oauth__:codex", ids: ["chat-model"] }];
    expect(await host._resolveAutoModel("Write tests")).toBe("__oauth__:codex::chat-model");
  });

  it("does not move a disabled custom provider's model onto another endpoint of the same kind", async () => {
    const { host, features } = await availabilityFixture();
    features.providers = [
      { id: "custom", kind: "openai", baseUrl: "https://custom.example/v1", enabled: false },
      { id: "popular:openai", kind: "openai", baseUrl: PROVIDER_PRESETS.openai.baseUrl },
    ] as any;
    host.featureStore.allModels = () => [{ id: "chat-model", name: "Custom model", kind: "openai", providerId: "custom" }];
    expect(host._buildModelList([])).toEqual([]);
    await expect(host._resolveProviderForModel("chat-model")).rejects.toThrow("unavailable or disabled");
  });

  it("does not expose API-tagged custom models under an OAuth account of the same kind", async () => {
    const { host, features } = await availabilityFixture();
    features.providers = [];
    host.featureStore.allModels = () => [{ id: "chat-model", name: "Custom model", kind: "xai", providerId: "custom-xai" }];
    expect(host._buildModelList([{ providerId: "__oauth__:xai", ids: [] }])).toEqual([]);
  });

  it("refreshes again when a connection changes while model discovery is in flight", async () => {
    const { host } = await availabilityFixture();
    let finish!: () => void;
    host._publishFetched = vi.fn();
    host._networkFetchModels = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; })).mockResolvedValue(undefined);
    const first = host._handleFetchModels();
    const changed = host._handleFetchModels();
    expect(host._networkFetchModels).toHaveBeenCalledOnce();
    finish();
    await Promise.all([first, changed]);
    expect(host._networkFetchModels).toHaveBeenCalledTimes(2);
  });
});

describe("durable host-owned follow-up queue", () => {
  it("passes the selected conversation scope into native diff review", async () => {
    const { host, b } = await fixture();
    vi.mocked(pendingChanges.get).mockReturnValueOnce({ path: "file.ts", before: "before", after: "after", existedBefore: true });
    await host._showDiff("file.ts");
    expect(pendingChanges.get).toHaveBeenCalledWith("file.ts", { conversationId: b.id });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith("ocursor.viewDiff", "file.ts", { conversationId: b.id });
  });

  it("persists interrupted request edits as drafts before removing them from the queue", async () => {
    const { host, store, a } = await fixture();
    await store.update(a.id, { queue: [{ id: "edit-me", text: "Apply migration", status: "interrupted", createdAt: 1 }] });
    await host._queueAction(a.id, "edit-me", "edit");
    await store.flush();
    expect(store.get(a.id)?.queue).toEqual([]);
    const drafts = Object.values(store.getWorkspaceState().drafts) as Array<{ text: string }>;
    expect(drafts).toHaveLength(1);
    expect(drafts[0].text).toContain("Apply migration");
    expect(drafts[0].text).toContain("Reconcile any already completed work");
  });

  it("keeps an edited queued request until its replacement draft is durably saved", async () => {
    const { host, store, a } = await fixture();
    await store.update(a.id, { queue: [{ id: "edit-me", text: "Preserve the request", status: "queued", createdAt: 1 }] });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const saveDraft = store.setWorkspaceState.bind(store);
    const save = vi.spyOn(store, "setWorkspaceState").mockImplementation(async patch => { await gate; await saveDraft(patch); });
    // The host uses another store instance sharing the same workspace state.
    host._store = store;
    const editing = host._queueAction(a.id, "edit-me", "edit");
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(store.getMetadata(a.id)?.queue?.[0].id).toBe("edit-me");
    release(); await editing;
    expect(store.getMetadata(a.id)?.queue).toEqual([]);
    expect(Object.values(store.getWorkspaceState().drafts)[0].text).toBe("Preserve the request");
  });

  it("executes FIFO with the original model and mode after the webview disappears", async () => {
    const { host, store, a } = await fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    host._handleMessage = vi.fn().mockImplementationOnce(async () => { await gate; return "finished"; }).mockResolvedValue("finished");
    await host._submitMessage({ convId: a.id, text: "First", requestId: "first", model: "model-a", mode: "ask" });
    await host._submitMessage({ convId: a.id, text: "Second", requestId: "second", model: "model-b", mode: "agent" });
    expect(store.get(a.id)?.queue?.map((item) => item.status)).toEqual(["running", "queued"]);
    expect(host._handleMessage).toHaveBeenCalledTimes(1);
    host._view = undefined;
    const worker = host._queueWorkers.get(a.id);
    release();
    await worker;
    expect(host._handleMessage.mock.calls.map((args: any[]) => [args[0], args[2].model, args[2].mode])).toEqual([["First", "model-a", "ask"], ["Second", "model-b", "agent"]]);
    expect(store.get(a.id)?.queue).toEqual([]);
    await host._submitMessage({ convId: a.id, text: "Second", requestId: "second" });
    await host._queueWorkers.get(a.id);
    expect(host._handleMessage).toHaveBeenCalledTimes(2);
  });

  it("publishes an idle submission as sending immediately without a transient queued row", async () => {
    const { host, a } = await fixture();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    host._handleMessage = vi.fn(async () => { await gate; return "finished"; });
    await host._submitMessage({ convId: a.id, text: "First", requestId: "direct" });
    await host._submitMessage({ convId: a.id, text: "Second", requestId: "waiting" });
    const states = host._view.webview.postMessage.mock.calls.map(([message]: any[]) => message).filter((message: any) => message.type === "workflowState");
    expect(states.every((message: any) => !(message.queues[a.id] ?? []).some((item: any) => item.id === "direct" && item.status === "queued"))).toBe(true);
    expect(states.some((message: any) => message.queues[a.id]?.some((item: any) => item.id === "waiting" && item.status === "queued"))).toBe(true);
    release();
    await host._queueWorkers.get(a.id);
  });

  it("does not flash the next request while a finished run is still cleaning up", async () => {
    const { host, a } = await fixture();
    let release!: () => void;
    const cleanup = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(runAgent).mockImplementationOnce(async opts => {
      opts.emit({ type: "run-status", status: "finished" });
      await cleanup;
    });
    await host._submitMessage({ convId: a.id, text: "First", requestId: "finished" });
    await vi.waitFor(() => expect(host._sessions.get(a.id)?.settled).toBe(true));
    await host._submitMessage({ convId: a.id, text: "Next", requestId: "direct-next" });
    const states = host._view.webview.postMessage.mock.calls.map(([message]: any[]) => message).filter((message: any) => message.type === "workflowState");
    expect(states.every((message: any) => !message.queues[a.id]?.some((item: any) => item.id === "direct-next" && item.status === "queued"))).toBe(true);
    release();
    await host._queueWorkers.get(a.id);
  });

  it("publishes the working start immediately and persists the final reply after the finished status", async () => {
    const { host, store, a } = await fixture();
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    try {
      vi.mocked(runAgent).mockImplementationOnce(async opts => {
        const started = host._view.webview.postMessage.mock.calls.map(([message]: any[]) => message).find((message: any) => message.type === "runStarted");
        expect(started.turns.at(-1)).toEqual({ role: "assistant", blocks: [], startedAt: 1000 });
        opts.emit({ type: "run-status", status: "running" });
        opts.emit({ type: "text-delta", text: "Checking. Complete." });
        now.mockReturnValue(5000);
        opts.emit({ type: "run-status", status: "finished" });
        opts.emit({ type: "run-result", text: "Complete.", durationMs: 4000 });
      });
      await host._submitMessage({ convId: a.id, text: "Inspect", requestId: "timing" });
      await host._queueWorkers.get(a.id);
      expect(store.get(a.id)?.turns.at(-1)).toMatchObject({
        role: "assistant", startedAt: 1000, endedAt: 5000, durationMs: 4000, finalText: "Complete.",
        blocks: [{ kind: "text", text: "Checking. Complete." }],
      });
    } finally {
      now.mockRestore();
    }
  });

  it("does not execute a request whose running claim cannot be persisted", async () => {
    const { host, a } = await fixture();
    host._handleMessage = vi.fn().mockResolvedValue("finished");
    vi.spyOn(host._store, "updateQueue").mockRejectedValueOnce(new Error("disk unavailable"));
    await host._submitMessage({ convId: a.id, text: "Change a file", requestId: "persist-failure" });
    await host._queueWorkers.get(a.id);
    expect(host._handleMessage).not.toHaveBeenCalled();
    expect(host._queuePaused.has(a.id)).toBe(true);
  });

  it("requires explicit reconciliation of interrupted work and preserves queued follow-ups", async () => {
    const { host, store, a } = await fixture();
    host._handleMessage = vi.fn().mockResolvedValue("finished");
    await store.update(a.id, { queue: [
      { id: "interrupted", text: "Apply migration", status: "interrupted", createdAt: 1 },
      { id: "later", text: "Inspect result", status: "queued", createdAt: 2 },
    ] });
    await host._drainQueue(a.id);
    expect(host._handleMessage).not.toHaveBeenCalled();
    await host._queueAction(a.id, "interrupted", "run");
    await host._queueWorkers.get(a.id);
    expect(host._handleMessage.mock.calls[0][0]).toContain("Do not blindly repeat commands or external side effects");
    expect(host._handleMessage.mock.calls[1][0]).toBe("Inspect result");
    expect(store.get(a.id)?.queue).toEqual([]);
  });

  it("halts the queue after a cancelled request instead of starting later tasks", async () => {
    const { host, store, a } = await fixture();
    await store.update(a.id, { queue: [
      { id: "cancel", text: "Long task", status: "queued", createdAt: 1 },
      { id: "later", text: "Next task", status: "queued", createdAt: 2 },
    ] });
    host._handleMessage = vi.fn().mockResolvedValue("cancelled");
    await host._drainQueue(a.id);
    expect(host._handleMessage).toHaveBeenCalledTimes(1);
    expect(store.get(a.id)?.queue?.map((item) => item.status)).toEqual(["interrupted", "queued"]);
  });

  it("manual Stop retires the active request, preserves unsent messages and survives restart without recovery", async () => {
    const { host, store, a, b } = await fixture();
    let release!: () => void;
    const cleanup = new Promise<void>(resolve => { release = resolve; });
    let activeSignal!: AbortSignal;
    vi.mocked(runAgent).mockImplementationOnce(async opts => {
      activeSignal = opts.signal;
      opts.emit({ type: "text-delta", text: "Completed part of the work." });
      await new Promise<void>(resolve => opts.signal.addEventListener("abort", () => resolve(), { once: true }));
      await cleanup;
      opts.emit({ type: "run-status", status: "cancelled" });
    });
    await store.update(b.id, { queue: [{ id: "unexpected", text: "Other task", status: "interrupted", createdAt: 1 }] });
    await host._submitMessage({ convId: a.id, text: "Original request", requestId: "manual" });
    await vi.waitFor(() => expect(activeSignal).toBeDefined());
    await host._submitMessage({ convId: a.id, text: "Next task", requestId: "next" });
    const stopping = host._stopRun(a.id);
    await vi.waitFor(() => expect(activeSignal.aborted).toBe(true));
    await host._submitMessage({ convId: a.id, text: "Later task", requestId: "later" });
    expect(store.get(a.id)?.queue?.map(item => [item.id, item.status])).toEqual([["next", "queued"], ["later", "queued"]]);
    release();
    await stopping;
    await host._stopRun(a.id);
    await host._submitMessage({ convId: a.id, text: "Original request", requestId: "manual" });
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(host._queuePaused.has(a.id)).toBe(true);
    expect(store.get(a.id)?.turns).toContainEqual(expect.objectContaining({ role: "assistant" }));
    expect(store.get(a.id)?.runEvents).toContainEqual(expect.objectContaining({ runId: "manual", type: "queue.cancelled" }));
    await store.flush();
    const saved = host.context.workspaceState;
    const reopened = new ConversationStore({ ...host.context, workspaceState: { get: saved.get.bind(saved), update: saved.update.bind(saved) } } as any);
    await reopened.recoverInterruptedRuns();
    expect(reopened.get(a.id)?.queue?.map(item => [item.id, item.status])).toEqual([["next", "queued"], ["later", "queued"]]);
    expect(reopened.get(b.id)?.queue?.[0].status).toBe("interrupted");
    expect(await reopened.enqueue(a.id, { id: "manual", text: "Original request", status: "queued", createdAt: 1 })).toBe(false);
  });

  it("manual Stop during a running claim prevents execution without manufacturing recovery", async () => {
    const { host, store, a } = await fixture();
    let release!: () => void;
    const claim = new Promise<void>(resolve => { release = resolve; });
    const update = host._store.updateQueue.bind(host._store);
    vi.spyOn(host._store, "updateQueue").mockImplementationOnce(async (id, transform) => {
      await update(id, transform);
      await claim;
    });
    host._handleMessage = vi.fn();
    await host._submitMessage({ convId: a.id, text: "Starting task", requestId: "claim" });
    await vi.waitFor(() => expect(store.get(a.id)?.queue?.[0].status).toBe("running"));
    const stopping = host._stopRun(a.id);
    await vi.waitFor(() => expect(store.get(a.id)?.queue).toEqual([]));
    release();
    await stopping;
    expect(host._handleMessage).not.toHaveBeenCalled();
    expect(store.get(a.id)?.queue).toEqual([]);
  });

  it("Send now retires the interrupted request and preserves follow-ups submitted during cleanup", async () => {
    const { host, store, a } = await fixture();
    let release!: () => void;
    const cleanup = new Promise<void>(resolve => { release = resolve; });
    let activeSignal!: AbortSignal;
    vi.mocked(runAgent).mockImplementationOnce(async opts => {
      activeSignal = opts.signal;
      opts.emit({ type: "text-delta", text: "Completed part of the original work." });
      await new Promise<void>(resolve => opts.signal.addEventListener("abort", () => resolve(), { once: true }));
      await cleanup;
      opts.emit({ type: "run-status", status: "cancelled" });
    });
    await host._submitMessage({ convId: a.id, text: "Original request", requestId: "original" });
    await vi.waitFor(() => expect(activeSignal).toBeDefined());
    await host._submitMessage({ convId: a.id, text: "Earlier follow-up", requestId: "earlier" });
    await host._submitMessage({ convId: a.id, text: "Replacement request", requestId: "replacement" });
    const handoff = host._queueAction(a.id, "replacement", "run");
    await vi.waitFor(() => expect(activeSignal.aborted).toBe(true));
    await host._submitMessage({ convId: a.id, text: "Later follow-up", requestId: "later" });
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(store.get(a.id)?.queue?.some(item => item.id === "original")).toBe(false);
    expect(store.get(a.id)?.queue?.map(item => item.id)).toEqual(["replacement", "earlier", "later"]);
    release();
    await handoff;
    await host._queueWorkers.get(a.id);
    expect(vi.mocked(runAgent).mock.calls.map(([opts]) => opts.prompt)).toEqual(["Original request", "Replacement request", "Earlier follow-up", "Later follow-up"]);
    expect(store.get(a.id)?.queue).toEqual([]);
    expect(store.get(a.id)?.turns).toContainEqual(expect.objectContaining({ role: "assistant", blocks: expect.arrayContaining([expect.objectContaining({ text: "Completed part of the original work." })]) }));
    expect(store.get(a.id)?.runEvents).toContainEqual(expect.objectContaining({ runId: "original", type: "queue.superseded" }));
    await host._submitMessage({ convId: a.id, text: "Original request", requestId: "original" });
    await host._queueWorkers.get(a.id);
    expect(runAgent).toHaveBeenCalledTimes(4);
  });

  it("Send now during provider startup prevents the old request from starting and ignores duplicate clicks", async () => {
    const { host, store, a } = await fixture();
    let release!: () => void;
    const startup = new Promise<void>(resolve => { release = resolve; });
    const resolveProvider = host._resolveProviderForModel.bind(host);
    host._resolveProviderForModel = vi.fn().mockImplementationOnce(async (...args) => { await startup; return resolveProvider(...args); }).mockImplementation(resolveProvider);
    await host._submitMessage({ convId: a.id, text: "Still starting", requestId: "starting" });
    await vi.waitFor(() => expect(host._resolveProviderForModel).toHaveBeenCalledOnce());
    expect(host._sessions.has(a.id)).toBe(false);
    await host._submitMessage({ convId: a.id, text: "Do this instead", requestId: "instead" });
    const first = host._queueAction(a.id, "instead", "run");
    const duplicate = host._queueAction(a.id, "instead", "run");
    await vi.waitFor(() => expect(store.get(a.id)?.queue?.some(item => item.id === "starting")).toBe(false));
    release();
    await Promise.all([first, duplicate]);
    await host._queueWorkers.get(a.id);
    expect(vi.mocked(runAgent).mock.calls.map(([opts]) => opts.prompt)).toEqual(["Do this instead"]);
    expect(store.get(a.id)?.queue).toEqual([]);
  });

  it("steers the exact queued text without cancelling and atomically persists its history on consumption", async () => {
    const { host, store, a } = await fixture();
    let running!: Parameters<typeof runAgent>[0];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(runAgent).mockImplementationOnce(async opts => { running = opts; await gate; });
    await host._submitMessage({ convId: a.id, text: "Build it", requestId: "main" });
    await vi.waitFor(() => expect(running).toBeDefined());
    await host._submitMessage({ convId: a.id, text: "Keep the API unchanged", requestId: "guidance", model: "api::saved-model", mode: "ask" });
    await host._queueAction(a.id, "guidance", "steer");
    await host._queueAction(a.id, "guidance", "steer");
    expect(running.signal.aborted).toBe(false);
    expect(store.get(a.id)?.queue?.map(item => item.id)).toEqual(["main"]);
    expect(store.get(a.id)?.steeringQueue).toEqual([expect.objectContaining({ id: "guidance", text: "Keep the API unchanged", model: "api::saved-model", mode: "ask" })]);
    const visible = host._view.webview.postMessage.mock.calls.map(([message]: any[]) => message).filter((message: any) => message.type === "workflowState").at(-1);
    expect(visible.steeringQueues[a.id]).toContainEqual(expect.objectContaining({ id: "guidance" }));
    expect(await running.drainSteering?.()).toEqual(["Keep the API unchanged"]);
    expect(store.get(a.id)?.steeringQueue).toHaveLength(1);
    await running.onRunEvent?.({ type: "steering", at: 1, data: { runId: "child-run", text: "Child guidance" } });
    expect(store.get(a.id)?.steeringQueue).toHaveLength(1);
    running.history.push({ kind: "user", text: "Keep the API unchanged" });
    await running.onRunEvent?.({ type: "steering", at: 2, data: { runId: running.runId, text: "Keep the API unchanged" } });
    expect(store.get(a.id)?.steeringQueue).toEqual([]);
    const delivered = host._view.webview.postMessage.mock.calls.map(([message]: any[]) => message).filter((message: any) => message.type === "workflowState").at(-1);
    expect(delivered.steeringQueues[a.id]).toEqual([]);
    expect(store.get(a.id)?.steps).toContainEqual({ kind: "user", text: "Keep the API unchanged" });
    expect(store.get(a.id)?.turns).toContainEqual({ role: "user", text: "Keep the API unchanged", steering: true });
    expect(host._view.webview.postMessage).toHaveBeenCalledWith({ type: "agentEvent", convId: a.id, event: { type: "user-steering", text: "Keep the API unchanged", requestId: "guidance" } });
    expect(await running.drainSteering?.()).toEqual([]);
    release();
    await host._queueWorkers.get(a.id);
    expect(runAgent).toHaveBeenCalledOnce();
    await host._submitMessage({ convId: a.id, text: "Keep the API unchanged", requestId: "guidance" });
    await host._queueWorkers.get(a.id);
    expect(runAgent).toHaveBeenCalledOnce();
  });

  it("persists consumed steering with its history before awaiting journal I/O", async () => {
    const { host, store, a } = await fixture();
    let running!: Parameters<typeof runAgent>[0];
    let finishRun!: () => void;
    const runGate = new Promise<void>(resolve => { finishRun = resolve; });
    let finishJournal!: () => void;
    const journalGate = new Promise<void>(resolve => { finishJournal = resolve; });
    const append = vi.fn(async () => { await journalGate; });
    host.context.storageUri = { fsPath: "/mock-storage" };
    host._journals.set(a.id, { append });
    vi.mocked(runAgent).mockImplementationOnce(async opts => { running = opts; await runGate; });
    let consumed: Promise<void> | undefined;
    try {
      await host._submitMessage({ convId: a.id, text: "Build it", requestId: "main" });
      await vi.waitFor(() => expect(running).toBeDefined());
      await host._submitMessage({ convId: a.id, text: "Preserve the public API", requestId: "guidance" });
      await host._queueAction(a.id, "guidance", "steer");
      expect(await running.drainSteering?.()).toEqual(["Preserve the public API"]);
      running.history.push({ kind: "user", text: "Preserve the public API" });
      consumed = running.onRunEvent?.({ type: "steering", at: 1, data: { runId: running.runId, text: "Preserve the public API" } });
      await vi.waitFor(() => expect(append).toHaveBeenCalledOnce());

      // Model history is already mutable here. A timer or Stop can persist it
      // while the journal is blocked, so consumption must be in that snapshot.
      host._persistTurnsNow(a.id, host._sessions.get(a.id));
      await store.flush();
      const persisted = host.context.workspaceState.get("ocursor.conversations").find((conversation: { id: string }) => conversation.id === a.id);
      expect(persisted.steeringQueue).toEqual([]);
      expect(persisted.steps).toContainEqual({ kind: "user", text: "Preserve the public API" });
      expect(persisted.turns).toContainEqual({ role: "user", text: "Preserve the public API", steering: true });
      expect(persisted.queue.map((item: { id: string }) => item.id)).toEqual(["main"]);
    } finally {
      finishJournal();
      await consumed;
      finishRun();
      await host._queueWorkers.get(a.id);
    }
    expect(runAgent).toHaveBeenCalledOnce();
    expect(store.get(a.id)?.queue).toEqual([]);
  });

  it("keeps undelivered steering queued when a run stops, and refuses to lose attachments", async () => {
    const { host, store, a } = await fixture();
    let running!: Parameters<typeof runAgent>[0];
    vi.mocked(runAgent).mockImplementationOnce(async opts => {
      running = opts;
      await new Promise<void>(resolve => opts.signal.addEventListener("abort", () => resolve(), { once: true }));
    });
    await host._submitMessage({ convId: a.id, text: "Original", requestId: "main" });
    await vi.waitFor(() => expect(running).toBeDefined());
    const attachments = [{ id: "file", name: "notes.txt", mime: "text/plain", data: "Keep this", kind: "text" as const }];
    await host._submitMessage({ convId: a.id, text: "Attached", requestId: "attached", attachments });
    await expect(host._queueAction(a.id, "attached", "steer")).rejects.toThrow("attached files");
    expect(store.get(a.id)?.queue?.find(item => item.id === "attached")?.attachments).toEqual(attachments);
    await host._submitMessage({ convId: a.id, text: "Pending guidance", requestId: "pending" });
    await host._queueAction(a.id, "pending", "steer");
    host._queuePaused.add(a.id);
    host._cancelSession(a.id);
    await host._queueWorkers.get(a.id);
    expect(store.get(a.id)?.steeringQueue).toEqual([]);
    expect(store.get(a.id)?.queue?.map(item => [item.id, item.status])).toEqual([["main", "interrupted"], ["attached", "queued"], ["pending", "queued"]]);
    expect(runAgent).toHaveBeenCalledOnce();
  });
});
