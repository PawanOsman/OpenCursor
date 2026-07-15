/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as vscode from "vscode";
import type { McpServerConfig } from "../integrations/mcpClient";
import type { Persona } from "../agent/personas";
import type { LlamacppModel, LlamacppServerConfig } from "../agent/llamacpp";
import { DEFAULT_APPROVAL, type ApprovalPolicy } from "../agent/approvalPolicy";
import type { DocSource } from "../agent/docsIndex";

export interface SubagentDef {
	id: string;
	name: string;
	description: string;
	prompt: string;
	readonly: boolean;
	/** Optional model override for this subagent (else uses subagentModel / chat model). */
	model?: string;
}

/** Unified hook events covering OpenCursor, Cursor and Claude Code trigger points. */
export type HookEvent =
	| "beforeSubmit"
	| "beforeShell"
	| "beforeMcp"
	| "beforeReadFile"
	| "afterEdit"
	| "afterRun"
	| "notification"
	| "subagentStop"
	| "preCompact"
	| "sessionStart"
	| "sessionEnd";

export interface HookDef {
	id: string;
	event: HookEvent;
	command: string;
	enabled: boolean;
}

export type ProviderKind = "openai" | "anthropic" | "google" | "openrouter" | "atlascloud" | "ollama" | "llamacpp";

/** Where a model can be served from: API provider kinds + OAuth account kinds. */
export type ModelKind = ProviderKind | "claude-code" | "codex" | "antigravity";

/** True when a model's kind (single or array) includes the given kind. */
export function kindMatches(kind: ModelKind | ModelKind[], k: string): boolean {
	return Array.isArray(kind) ? kind.includes(k as ModelKind) : kind === k;
}

/** A configurable option for a model (e.g. reasoning effort, thinking mode). */
export interface ModelOption {
	/** Stable key mapped to an API param by the provider layer. */
	key: string;
	/** Display label in the UI. */
	label: string;
	/** "select" → choose from values; "toggle" → on/off. */
	type: "select" | "toggle";
	/** Allowed values for "select" options. */
	values?: string[];
	/** Current value (string for select, "true"/"false" for toggle). */
	value: string;
}

/** A curated model with its provider kind and tunable options. */
export interface ModelDef {
	/** Picker id. May be a provider-scoped composite ("<providerId>::<modelId>") so the
	 *  same model offered by multiple providers shows as distinct entries. */
	id: string;
	/** Real model id sent to the API (composite-stripped). Defaults to `id`. */
	modelId?: string;
	/** Friendly display name. */
	name: string;
	/** Which provider kind(s) this model belongs to. Array = served by several kinds. */
	kind: ModelKind | ModelKind[];
	/** Tunable options. Omit for models with no knobs. */
	options?: ModelOption[];
	/** Whether the model is enabled (visible in the picker) by default. Undefined = true. */
	enabled?: boolean;
	/** "default" = curated catalog, "other" = fetched from provider. */
	group?: "default" | "other";
	/** Provider this model is served by (for multi-provider routing). */
	providerId?: string;
	/** Provider display name (for grouping in the picker). */
	providerName?: string;
}

/** Whether a provider participates in chat (defaults to true). */
export function providerEnabled(p: ProviderConfig): boolean {
	return p.enabled !== false;
}

const effort = (value = "medium", values = ["none", "low", "medium", "high"]): ModelOption => ({ key: "reasoning_effort", label: "Reasoning effort", type: "select", values, value });
const thinking = (value = "adaptive", values = ["disabled", "adaptive", "enabled"]): ModelOption => ({ key: "thinking", label: "Thinking", type: "select", values, value });
const ctx = (values: string[], value: string): ModelOption => ({ key: "max_context", label: "Context", type: "select", values, value });

/** Built-in catalog of popular coding models. Users can edit options per model. */
export const MODEL_CATALOG: ModelDef[] = [
	// OpenAI — gpt-5.5 is the current flagship; effort supports none/low/medium/high (xhigh on top tiers).
	{ id: "gpt-5.5", name: "GPT-5.5", kind: ["openai", "codex"], options: [effort("medium", ["none", "low", "medium", "high", "xhigh"]), ctx(["128k", "256k", "400k"], "400k")] },
	{ id: "gpt-5.5-pro", name: "GPT-5.5 Pro", kind: ["openai", "codex"], options: [effort("high", ["low", "medium", "high", "xhigh"]), ctx(["128k", "256k", "400k"], "400k")] },
	{ id: "gpt-5.4", name: "GPT-5.4", kind: ["openai", "codex"], options: [effort("medium", ["none", "low", "medium", "high", "xhigh"]), ctx(["128k", "256k", "400k"], "400k")] },
	{ id: "gpt-5.4-mini", name: "GPT-5.4 mini", kind: ["openai", "codex"], options: [effort("medium", ["none", "low", "medium", "high"]), ctx(["128k", "400k"], "400k")] },
	{ id: "gpt-5.3-codex", name: "GPT-5.3 Codex", kind: ["openai", "codex"], options: [effort("high", ["none", "low", "medium", "high", "xhigh"]), ctx(["128k", "256k", "400k"], "400k")] },
	// Anthropic — Opus 4.8 is the current flagship. effort → output_config.effort;
	// extended thinking + up to 1M (beta) context.
	// Fable 5 and Sonnet 5 are adaptive-only: manual budget_tokens returns 400.
	{ id: "claude-sonnet-5", name: "Sonnet 5", kind: ["anthropic", "claude-code"], options: [thinking("adaptive", ["disabled", "adaptive"]), effort("high", ["low", "medium", "high", "xhigh", "max"]), ctx(["200k", "1m"], "1m")] },
	// Fable 5: thinking always on, adaptive is the only mode (disabled unsupported).
	{ id: "claude-fable-5", name: "Fable 5", kind: ["anthropic", "claude-code"], options: [thinking("adaptive", ["adaptive"]), effort("high", ["low", "medium", "high", "xhigh", "max"]), ctx(["200k", "1m"], "1m")] },
	// Opus 4.8/4.7: adaptive is the ONLY thinking mode; enabled/budget → 400.
	{ id: "claude-opus-4-8", name: "Opus 4.8", kind: ["anthropic", "claude-code"], options: [thinking("adaptive", ["disabled", "adaptive"]), effort("high", ["low", "medium", "high", "xhigh", "max"]), ctx(["200k", "1m"], "1m")] },
	{ id: "claude-opus-4-7", name: "Opus 4.7", kind: ["anthropic", "claude-code"], options: [thinking("adaptive", ["disabled", "adaptive"]), effort("high", ["low", "medium", "high", "xhigh", "max"]), ctx(["200k", "1m"], "200k")] },
	// Opus/Sonnet 4.6: budget_tokens deprecated but still accepted; adaptive recommended.
	{ id: "claude-sonnet-4-6", name: "Sonnet 4.6", kind: ["anthropic", "claude-code"], options: [thinking("adaptive"), effort("high", ["low", "medium", "high", "xhigh", "max"]), ctx(["200k", "1m"], "1m")] },
	// Haiku 4.5 only supports manual extended thinking (no adaptive).
	{ id: "claude-haiku-4-5", name: "Haiku 4.5", kind: ["anthropic", "claude-code"], options: [thinking("disabled", ["disabled", "enabled"]), ctx(["200k"], "200k")] },
	// Google Gemini — Gemini 3 is current; served via OpenAI-compatible endpoint,
	// which maps reasoning_effort to the thinking budget. 1M context.
	{ id: "gemini-3-pro-preview", name: "Gemini 3 Pro", kind: "google", options: [effort("high", ["low", "medium", "high"]), ctx(["1m"], "1m")] },
	{ id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", kind: "google", options: [effort("medium", ["none", "low", "medium", "high"]), ctx(["1m"], "1m")] },
	{ id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", kind: "google", options: [effort("high", ["low", "medium", "high"]), ctx(["1m"], "1m")] },
	{ id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", kind: "google", options: [effort("high", ["low", "medium", "high"]), ctx(["1m"], "1m")] },
	{ id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", kind: "google", options: [effort("medium", ["none", "low", "medium", "high"]), ctx(["1m"], "1m")] },

	// Models exposed by Google Antigravity accounts.
	{ id: "gemini-3-flash-agent", name: "Gemini 3.5 Flash (High)	", kind: "antigravity", enabled: true },
	{ id: "gemini-3.5-flash-low", name: "Gemini 3.5 Flash (Medium)", kind: "antigravity", enabled: true },
	{ id: "gemini-3.5-flash-extra-low", name: "Gemini 3.5 Flash (Low)", kind: "antigravity", enabled: true },
	{ id: "gemini-pro-agent", name: "Gemini 3.1 Pro (High)", kind: "antigravity", enabled: true },
	{ id: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro (Low)", kind: "antigravity", enabled: true },
	{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)", kind: "antigravity", enabled: true },
	{ id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)", kind: "antigravity", enabled: true },
	{ id: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)", kind: "antigravity", enabled: true },
	{ id: "gemini-3-flash", name: "Gemini 3 Flash", kind: "antigravity", enabled: true },
	
	
	{ id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", kind: "antigravity", enabled: false },
	{ id: "gemini-3-pro-preview", name: "Gemini 3 Pro", kind: "antigravity", enabled: false},
	{ id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", kind: "antigravity", enabled: false },
	{ id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", kind: "antigravity", enabled: false },
	{ id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", kind: "antigravity", enabled: false },
	{ id: "gemini-2.5-flash-thinking", name: "Gemini 2.5 Flash Thinking", kind: "antigravity", enabled: false },
	{ id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite", kind: "antigravity", enabled: false },
	{ id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite", kind: "antigravity", enabled: false },
];

export interface ProviderConfig {
	id: string;
	name: string;
	kind: ProviderKind;
	baseUrl: string;
	/** Whether an API key has been stored in SecretStorage for this provider. */
	hasKey?: boolean;
	/** Optional curated/default model id for this provider. */
	model?: string;
	/** Whether this provider is active. Multiple may be enabled at once. Undefined = enabled. */
	enabled?: boolean;
}

export interface FeatureConfig {
	providers: ProviderConfig[];
	activeProviderId: string;
	/** Per-model option overrides keyed by model id (replaces catalog defaults). */
	modelOptions: Record<string, ModelOption[]>;
	/** Extra user-added models on top of the catalog. */
	customModels: ModelDef[];
	mcpServers: McpServerConfig[];
	subagents: SubagentDef[];
	/** Default model for subagents launched via the task tool ("" = inherit chat model). */
	subagentModel: string;
	/** Judge model used by Auto mode to pick a model for each task ("" = first enabled). */
	autoJudgeModel: string;
	/** Local embedding model id for the semantic codebase index. */
	embedModel: string;
	hooks: HookDef[];
	enabledModels: string[];
	/** Models explicitly disabled by the user (overrides catalog defaults). */
	disabledModels: string[];
	customPersonas: Persona[];
	activePersonaId: string;
	askPersonaOnNewChat: boolean;
	/** Local GGUF models managed via the llama.cpp tab. */
	/** Local models (llama.cpp/Ollama ids) explicitly hidden from the chat picker. */
	disabledLocalModels: string[];
	llamacppModels: LlamacppModel[];
	/** Global context length (tokens) applied to all llama.cpp model loads unless overridden. */
	llamacppContextLength: number;
	/** Global llama-server launch config (host, flash-attn, gpu layers, …). */
	llamacppConfig: LlamacppServerConfig;
	/** Show an OS notification when an agent run finishes while the window is unfocused. */
	notifyOnComplete: boolean;
	/** Auto-generate a short AI title for new chats. */
	autoGenerateTitles: boolean;
	/** Track per-model token usage locally (Usage & Quota page). */
	trackUsage: boolean;
	/** Conversation text size in the chat sidebar. */
	chatTextSize: "compact" | "default" | "large";
	/** When true, Ctrl+Enter submits chat and Enter inserts a newline. */
	submitWithCtrlEnter: boolean;
	/** Max chat tabs open at once (0 = unlimited). */
	maxTabCount: number;
	/** Max agent steps per run before pausing (0 = default 50). */
	maxAgentSteps: number;
	/** Automatically continue when the step limit is reached. */
	autoContinue: boolean;
	/** Play a sound when the agent finishes responding. */
	completionSound: boolean;
	/** Allow the agent to use the WebSearch tool. */
	webSearchEnabled: boolean;
	/** Allow the agent to use the WebFetch tool. */
	webFetchEnabled: boolean;
	/** Per-action-type approval policy (shell/edits/delete/mcp/web). */
	approvalPolicy: ApprovalPolicy;
	/** External documentation sources indexed for @Docs mentions. */
	docSources: DocSource[];
	/** Automatically index newly added workspace folders. */
	indexNewFolders: boolean;
	/** Index repositories to speed up grep searches (all data local). */
	indexForGrep: boolean;
}

const DEFAULTS: FeatureConfig = {
	// No default providers — OpenAI/Anthropic/etc. are connected from the Popular
	// Providers tab (created as `popular:<kind>` entries on connect).
	providers: [],
	activeProviderId: "",
	modelOptions: {},
	customModels: [],
	mcpServers: [],
	subagents: [],
	subagentModel: "",
	autoJudgeModel: "",
	embedModel: "minilm",
	hooks: [],
	enabledModels: MODEL_CATALOG.filter((m) => m.enabled !== false).map((m) => m.id),
	disabledModels: [],
	customPersonas: [],
	activePersonaId: "default",
	askPersonaOnNewChat: false,
	disabledLocalModels: [],
	llamacppModels: [],
	llamacppContextLength: 65536,
	llamacppConfig: { host: "127.0.0.1", ctxSize: 65536, jinja: true, flashAttn: "auto", nGpuLayers: "auto", parallel: 1 },
	notifyOnComplete: true,
	autoGenerateTitles: true,
	trackUsage: true,
	chatTextSize: "default",
	submitWithCtrlEnter: false,
	maxTabCount: 0,
	maxAgentSteps: 50,
	autoContinue: false,
	completionSound: false,
	webSearchEnabled: true,
	webFetchEnabled: true,
	approvalPolicy: DEFAULT_APPROVAL,
	docSources: [],
	indexNewFolders: true,
	indexForGrep: true,
};

/** Default base URLs + whether a key is required, per provider kind. */
export const PROVIDER_PRESETS: Record<ProviderKind, { label: string; baseUrl: string; needsKey: boolean }> = {
	openai: { label: "OpenAI-compatible", baseUrl: "https://api.openai.com/v1", needsKey: true },
	anthropic: { label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", needsKey: true },
	google: { label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", needsKey: true },
	openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", needsKey: true },
	atlascloud: { label: "Atlas Cloud", baseUrl: "https://api.atlascloud.ai/v1", needsKey: true },
	ollama: { label: "Ollama", baseUrl: "http://localhost:11434/v1", needsKey: false },
	llamacpp: { label: "llama.cpp", baseUrl: "http://localhost:8080/v1", needsKey: false },
};

const KEY = "ocursor.features";

export class FeatureStore {
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	/** Fires whenever features (or related config) change, so views can refresh live. */
	readonly onDidChange = this._onDidChange.event;

	constructor(private readonly context: vscode.ExtensionContext) {}

	get(): FeatureConfig {
		const stored = this.context.globalState.get<Partial<FeatureConfig>>(KEY) ?? {};
		return { ...DEFAULTS, ...stored };
	}

	async set(patch: Partial<FeatureConfig>): Promise<FeatureConfig> {
		const next = { ...this.get(), ...patch };
		await this.context.globalState.update(KEY, next);
		this._onDidChange.fire();
		return next;
	}

	/** Notify listeners of a config change that happened outside `set` (e.g. provider keys). */
	notifyChanged() {
		this._onDidChange.fire();
	}

	/** Catalog + user-added models. */
	allModels(): ModelDef[] {
		const cfg = this.get();
		return [...MODEL_CATALOG, ...cfg.customModels];
	}

	/** Catalog entry for a model, scoped to a provider kind when given. A def only
	 *  applies to the kinds it declares, so the same model id can have different
	 *  names/options per provider (google vs antigravity vs codex …). */
	defFor(modelId: string, kind?: string): ModelDef | undefined {
		const all = this.allModels().filter((m) => m.id === modelId);
		if (!kind) return all[0];
		// Strict: a def only applies to kinds it explicitly declares.
		return all.find((m) => kindMatches(m.kind, kind));
	}

	/** Resolved options for a model: stored overrides take precedence over defaults.
	 *  Overrides are kind-scoped ("<kind>:<id>") so the same model id can hold
	 *  different option state per provider (e.g. anthropic vs claude-code);
	 *  a plain-id record is the legacy/shared fallback. */
	optionsFor(modelId: string, kind?: string): ModelOption[] {
		const cfg = this.get();
		const def = this.defFor(modelId, kind);
		const saved = (kind ? cfg.modelOptions[`${kind}:${modelId}`] : undefined) ?? cfg.modelOptions[modelId];
		if (!saved) return def?.options ?? [];
		if (!def?.options) return saved;
		// Merge: option shape (label/type/values = model capabilities) always comes
		// from the current catalog; only the user's selected `value` is persisted.
		// This keeps stale saved options from hiding newly-added modes/values.
		const savedValue = new Map(saved.map((o) => [o.key, o.value]));
		return def.options.map((o) => {
			const v = savedValue.get(o.key);
			if (v == null) return o;
			// Drop a saved value that's no longer a valid choice for this option.
			if (o.values && !o.values.includes(v)) return o;
			return { ...o, value: v };
		});
	}

	/** Friendly catalog label for an id, or the id itself if not catalogued. */
	nameFor(modelId: string, kind?: string): string {
		return this.defFor(modelId, kind)?.name ?? modelId;
	}
}

/** Catalog display name for a model id (provider-agnostic), or undefined. */
export function catalogName(modelId: string): string | undefined {
	return MODEL_CATALOG.find((m) => m.id === modelId)?.name;
}

/** Translate a model's resolved options into provider request params. */
export function optionsToParams(options: ModelOption[]): { reasoningEffort?: string; thinking?: string; maxContext?: string } {
	const out: { reasoningEffort?: string; thinking?: string; maxContext?: string } = {};
	for (const o of options) {
		if (o.key === "reasoning_effort" && o.value) out.reasoningEffort = o.value;
		// thinking is a mode: "disabled" | "adaptive" | "enabled". Legacy "true"/"false"
		// toggles map to enabled/disabled for back-compat with saved settings.
		if (o.key === "thinking") out.thinking = o.value === "true" ? "enabled" : o.value === "false" ? "disabled" : o.value;
		if (o.key === "max_context" && o.value) out.maxContext = o.value;
	}
	return out;
}
