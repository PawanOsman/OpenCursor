/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as vscode from "vscode";
import { PROVIDER_MODELS } from "../shared/providerModels";
import { MODEL_PROVIDER_ALIASES } from "../shared/modelAliases";
import { supportsFastMode, MODEL_SPEED_DESCRIPTION, type ModelSpeed } from "../shared/modelSpeed";
import type { McpServerConfig } from "../integrations/mcpClient";
import type { Persona } from "../agent/personas";
import type { LlamacppModel, LlamacppServerConfig } from "../agent/llamacpp";
import { DEFAULT_APPROVAL, type ApprovalPolicy } from "../agent/approvalPolicy";
import type { DocSource } from "../agent/docsIndex";
import { type TeamDef, type BuiltinSubagentOverrides, builtinSubagentOverrides, withBuiltinTeamSubagents, withBuiltinTeams, withoutBuiltinTeamSubagents, withoutBuiltinTeams } from "../agent/teams";

export type { TeamDef };

export interface SubagentDef {
	id: string;
	name: string;
	description: string;
	prompt: string;
	readonly: boolean;
	/** Optional model override for this subagent (else uses subagentModel / chat model). */
	model?: string;
	/** Built-in presets can be edited and reset, but cannot be deleted. */
	builtin?: boolean;
}

/** Unified hook events covering OpenCursor, Cursor and Claude Code trigger points. */
export type HookEvent =
	| "preToolUse" | "postToolUse" | "permissionRequest" | "postCompact" | "subagentStart" | "interrupt"
	| "beforeSubmit"
	| "beforeShell"
	| "beforeMcp"
	| "beforeReadFile"
	| "beforeEdit"
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

import { PROVIDER_PRESETS, type ProviderKind } from "../shared/providerCatalog";
import { OAUTH_KINDS, type OAuthProviderKind } from "../shared/oauthProviders";
export { PROVIDER_PRESETS, POPULAR_KINDS, FREE_KINDS } from "../shared/providerCatalog";
export type { ProviderKind } from "../shared/providerCatalog";

/** Where a model can be served from: API provider kinds + OAuth account kinds. */
export type ModelKind = ProviderKind | OAuthProviderKind;

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
	/** Optional explanation shown beside the control. */
	description?: string;
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
const ctx = (values: string[], value: string): ModelOption => ({ key: "max_context", label: "Context budget", type: "select", values, value });

/** Fallback context sizes for models with no catalog preset (custom / fetched). */
export const DEFAULT_CONTEXT_VALUES = ["32k", "64k", "128k", "200k", "256k", "512k", "1m"];
export const DEFAULT_CONTEXT_VALUE = "128k";
export const defaultContextOption = (): ModelOption =>
	ctx([...DEFAULT_CONTEXT_VALUES], DEFAULT_CONTEXT_VALUE);

/** Parse "200k" / "1m" / "128000" → token count. */
export function parseContextLabel(v?: string): number {
	if (!v) return 0;
	const s = String(v).trim().toLowerCase();
	const m = s.match(/^([\d.]+)\s*([kmb])?$/);
	if (!m) {
		const n = Number(s.replace(/[^\d.]/g, ""));
		return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
	}
	const n = parseFloat(m[1]);
	const u = m[2];
	if (u === "m") return Math.floor(n * 1_000_000);
	if (u === "b") return Math.floor(n * 1_000_000_000);
	if (u === "k") return Math.floor(n * 1_000);
	return Math.floor(n);
}

/**
 * Popular text/coding models, refreshed against provider docs on 2026-09-23.
 * Context choices are OpenCursor working-context budgets up to the documented
 * window; choosing a smaller budget does not change the provider's model.
 * https://developers.openai.com/api/docs/models
 * https://platform.claude.com/docs/en/models/overview
 * https://ai.google.dev/gemini-api/docs/models
 * Additional source links and provider-specific constraints: docs/model-catalog.md
 */
const CURATED_MODEL_CATALOG: ModelDef[] = [
	// OpenAI: Astra cannot disable reasoning. GPT-5.6's public API supports max,
	// while Codex-specific orchestration modes are not public API effort levels.
	{ id: "gpt-6-astra", name: "GPT-6 Astra", kind: ["openai", "codex"], options: [effort("medium", ["low", "medium", "high", "xhigh", "max"]), ctx(["128k", "256k", "400k", "1.05m"], "1.05m")] },
	{ id: "gpt-6-sol", name: "GPT-6 Sol", kind: ["openai", "codex"], options: [effort("medium", ["none", "low", "medium", "high", "xhigh", "max"]), ctx(["128k", "256k", "400k", "1.05m"], "1.05m")] },
	{ id: "gpt-6-luna", name: "GPT-6 Luna", kind: ["openai", "codex"], options: [effort("medium", ["none", "low", "medium", "high", "xhigh", "max"]), ctx(["128k", "256k", "400k", "1.05m"], "1.05m")] },
	{ id: "gpt-5.6-sol", name: "GPT-5.6 Sol", kind: ["openai", "codex"], options: [effort("high", ["none", "low", "medium", "high", "xhigh", "max"]), ctx(["128k", "256k", "400k", "1.05m"], "1.05m")] },
	{ id: "gpt-5.6-terra", name: "GPT-5.6 Terra", kind: ["openai", "codex"], options: [effort("medium", ["none", "low", "medium", "high", "xhigh", "max"]), ctx(["128k", "256k", "400k", "1.05m"], "1.05m")] },
	{ id: "gpt-5.6-luna", name: "GPT-5.6 Luna", kind: ["openai", "codex"], options: [effort("low", ["none", "low", "medium", "high", "xhigh", "max"]), ctx(["128k", "256k", "400k", "1.05m"], "1.05m")] },
	{ id: "gpt-5.6", name: "GPT-5.6 (Sol alias)", kind: ["openai", "codex"], options: [effort("high", ["none", "low", "medium", "high", "xhigh", "max"]), ctx(["128k", "256k", "400k", "1.05m"], "1.05m")] },
	{ id: "gpt-5.5", name: "GPT-5.5", kind: ["openai", "codex"], options: [effort("medium", ["none", "low", "medium", "high", "xhigh"]), ctx(["128k", "256k", "400k", "1.05m"], "1.05m")] },
	// The standalone Pro slug is a public Responses API model, not a Codex preset.
	{ id: "gpt-5.5-pro", name: "GPT-5.5 Pro", kind: "openai", options: [effort("high", ["medium", "high", "xhigh"]), ctx(["128k", "256k", "400k", "1.05m"], "1.05m")] },
	{ id: "gpt-5.4", name: "GPT-5.4", kind: ["openai", "codex"], options: [effort("none", ["none", "low", "medium", "high", "xhigh"]), ctx(["128k", "256k", "400k", "1.05m"], "1.05m")] },
	{ id: "gpt-5.4-mini", name: "GPT-5.4 mini", kind: ["openai", "codex"], options: [effort("none", ["none", "low", "medium", "high", "xhigh"]), ctx(["128k", "400k"], "400k")] },
	{ id: "gpt-5.3-codex-spark", name: "GPT-5.3 Codex Spark", kind: ["openai", "codex"], options: [effort("high", ["low", "medium", "high", "xhigh"]), ctx(["128k", "256k", "400k"], "400k")] },
	// Anthropic: Opus 5.5 and Fable always think. Opus 5 can disable thinking only through
	// high effort (optionsFor applies that dependent restriction).
	{ id: "claude-opus-5-5", name: "Claude Opus 5.5", kind: ["anthropic", "claude-code"], options: [thinking("adaptive", ["adaptive"]), effort("medium", ["low", "medium", "high", "xhigh", "max"]), ctx(["300k", "1m"], "1m")] },
	{ id: "claude-fable-5-1", name: "Claude Fable 5.1", kind: ["anthropic", "claude-code"], options: [thinking("adaptive", ["adaptive"]), effort("high", ["low", "medium", "high", "xhigh", "max"]), ctx(["300k", "1m"], "1m")] },
	{ id: "claude-opus-5", name: "Claude Opus 5", kind: ["anthropic", "claude-code"], options: [thinking("adaptive", ["disabled", "adaptive"]), effort("high", ["low", "medium", "high", "xhigh", "max"]), ctx(["300k", "1m"], "1m")] },
	{ id: "claude-sonnet-5", name: "Claude Sonnet 5", kind: ["anthropic", "claude-code"], options: [thinking("adaptive", ["disabled", "adaptive"]), effort("high", ["low", "medium", "high", "xhigh", "max"]), ctx(["300k", "1m"], "1m")] },
	{ id: "claude-haiku-4-5", name: "Claude Haiku 4.5", kind: ["anthropic", "claude-code"], options: [thinking("disabled", ["disabled", "enabled"]), ctx(["200k"], "200k")] },
	{ id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5 (2025-10-01)", kind: ["anthropic", "claude-code"], enabled: false, options: [thinking("disabled", ["disabled", "enabled"]), ctx(["200k"], "200k")] },
	// Still-supported previous releases retain explicit capability presets.
	{ id: "claude-fable-5", name: "Claude Fable 5", kind: ["anthropic", "claude-code"], options: [thinking("adaptive", ["adaptive"]), effort("high", ["low", "medium", "high", "xhigh", "max"]), ctx(["300k", "1m"], "1m")] },
	{ id: "claude-opus-4-8", name: "Claude Opus 4.8", kind: ["anthropic", "claude-code"], options: [thinking("adaptive", ["disabled", "adaptive"]), effort("high", ["low", "medium", "high", "xhigh", "max"]), ctx(["300k", "1m"], "1m")] },
	{ id: "claude-opus-4-7", name: "Claude Opus 4.7", kind: ["anthropic", "claude-code"], options: [thinking("adaptive", ["disabled", "adaptive"]), effort("high", ["low", "medium", "high", "xhigh", "max"]), ctx(["200k", "1m"], "200k")] },
	{ id: "claude-opus-4-6", name: "Claude Opus 4.6", kind: ["anthropic", "claude-code"], options: [thinking("adaptive"), effort("high", ["low", "medium", "high", "max"]), ctx(["200k", "1m"], "1m")] },
	{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", kind: ["anthropic", "claude-code"], options: [thinking("adaptive"), effort("high", ["low", "medium", "high", "max"]), ctx(["200k", "1m"], "1m")] },
	{ id: "claude-opus-4-5", name: "Claude Opus 4.5", kind: ["anthropic", "claude-code"], enabled: false, options: [thinking("disabled", ["disabled", "enabled"]), effort("high", ["low", "medium", "high"]), ctx(["200k"], "200k")] },
	// Google public API: 1,048,576 input tokens; 1m is a conservative local budget.
	// Gemini 3.7/3.8 and Pro do not support minimal or fully disabled reasoning.
	// Retired gemini-3-pro-preview is intentionally absent (shutdown 2026-03-09).
	{ id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", kind: "google", options: [effort("medium", ["low", "medium", "high"]), ctx(["128k", "256k", "1m"], "1m")] },
	{ id: "gemini-3.7-flash", name: "Gemini 3.7 Flash", kind: "google", options: [effort("medium", ["low", "medium", "high"]), ctx(["128k", "256k", "1m"], "1m")] },
	{ id: "gemini-3.6-flash", name: "Gemini 3.6 Flash", kind: "google", options: [effort("medium", ["minimal", "low", "medium", "high"]), ctx(["128k", "256k", "1m"], "1m")] },
	{ id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite", kind: "google", options: [effort("minimal", ["minimal", "low", "medium", "high"]), ctx(["128k", "256k", "1m"], "1m")] },
	{ id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro (Preview)", kind: "google", options: [effort("high", ["low", "medium", "high"]), ctx(["128k", "256k", "1m"], "1m")] },
	{ id: "gemini-3.1-pro-preview-customtools", name: "Gemini 3.1 Pro Custom Tools (Preview)", kind: "google", enabled: false, options: [effort("high", ["low", "medium", "high"]), ctx(["128k", "256k", "1m"], "1m")] },
	{ id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash-Lite", kind: "google", options: [effort("minimal", ["minimal", "low", "medium", "high"]), ctx(["128k", "256k", "1m"], "1m")] },
	{ id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", kind: "google", options: [effort("medium", ["minimal", "low", "medium", "high"]), ctx(["1m"], "1m")] },
	{ id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", kind: "google", options: [effort("high", ["low", "medium", "high"]), ctx(["1m"], "1m")] },
	{ id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", kind: "google", options: [effort("medium", ["none", "low", "medium", "high"]), ctx(["1m"], "1m")] },
	{ id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash-Lite", kind: "google", enabled: false, options: [effort("none", ["none", "low", "medium", "high"]), ctx(["1m"], "1m")] },
	// Xiaomi MIMO — OpenAI-compatible API. Reasoning models.
	{ id: "mimo-v2.5-pro", name: "MIMO V2.5 Pro", kind: "mimo" },
	{ id: "mimo-v2.5", name: "MIMO V2.5", kind: "mimo" },

	// Provider-specific presets: IDs and controls apply to their own endpoints,
	// never the official OpenAI API or unrelated compatible servers.
	{ id: "grok-4.7", name: "Grok 4.7", kind: "xai", options: [effort("high", ["low", "medium", "high", "xhigh"]), ctx(["128k", "256k", "500k"], "500k")] },
	{ id: "deepseek-flash", name: "DeepSeek V4.1 Flash", kind: "deepseek", options: [thinking("enabled", ["disabled", "enabled"]), effort("high", ["low", "high", "max"]), ctx(["128k", "256k", "1m"], "1m")] },
	{ id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", kind: "deepseek", options: [thinking("enabled", ["disabled", "enabled"]), effort("high", ["low", "high", "max"]), ctx(["128k", "256k", "1m"], "1m")] },
	{ id: "kimi-k3", name: "Kimi K3", kind: "moonshot", options: [effort("max", ["low", "high", "max"]), ctx(["128k", "256k", "1m"], "1m")] },
	{ id: "kimi-k2.7-code", name: "Kimi K2.7 Code", kind: "moonshot", options: [ctx(["128k", "256k"], "256k")] },
	{ id: "kimi-k2.7-code-highspeed", name: "Kimi K2.7 Code Highspeed", kind: "moonshot", options: [ctx(["128k", "256k"], "256k")] },
	{ id: "glm-5.3", name: "GLM-5.3", kind: "z-ai", options: [effort("max", ["low", "high", "max"]), ctx(["128k", "256k", "1m"], "1m")] },
	{ id: "glm-5.3-flash", name: "GLM-5.3 Flash", kind: "z-ai", options: [effort("max", ["low", "high", "max"]), ctx(["128k", "256k", "1m"], "1m")] },
	{ id: "glm-5.3-flashx", name: "GLM-5.3 FlashX", kind: "z-ai", options: [effort("max", ["low", "high", "max"]), ctx(["128k", "256k", "1m"], "1m")] },
	{ id: "MiniMax-M3", name: "MiniMax M3", kind: "minimax", options: [thinking("adaptive", ["disabled", "adaptive"]), ctx(["128k", "256k", "1m"], "1m")] },
	{ id: "MiniMax-M2.7", name: "MiniMax M2.7", kind: "minimax", options: [ctx(["128k", "200k"], "200k")] },
	{ id: "MiniMax-M2.7-highspeed", name: "MiniMax M2.7 Highspeed", kind: "minimax", options: [ctx(["128k", "200k"], "200k")] },
	{ id: "qwen3.8-max", name: "Qwen3.8 Max", kind: "qwen", options: [thinking("enabled", ["disabled", "enabled"]), effort("xhigh", ["low", "medium", "xhigh"]), ctx(["128k", "256k", "1m"], "1m")] },
	{ id: "qwen3.8-flash", name: "Qwen3.8 Flash", kind: "qwen", options: [thinking("enabled", ["disabled", "enabled"]), effort("xhigh", ["low", "medium", "xhigh"]), ctx(["128k", "256k", "1m"], "1m")] },

	// Models exposed by Google Antigravity accounts.
	{ id: "gemini-3-flash-agent", name: "Gemini 3.5 Flash (High)", kind: "antigravity", enabled: true },
	{ id: "gemini-3.5-flash-low", name: "Gemini 3.5 Flash (Medium)", kind: "antigravity", enabled: true },
	{ id: "gemini-3.5-flash-extra-low", name: "Gemini 3.5 Flash (Low)", kind: "antigravity", enabled: true },
	{ id: "gemini-pro-agent", name: "Gemini 3.1 Pro (High)", kind: "antigravity", enabled: true },
	{ id: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro (Low)", kind: "antigravity", enabled: true },
	{ id: "claude-sonnet-4-6", name: "Sonnet 4.6 (Thinking)", kind: "antigravity", enabled: true },
	{ id: "claude-opus-4-6-thinking", name: "Opus 4.6 (Thinking)", kind: "antigravity", enabled: true },
	{ id: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)", kind: "antigravity", enabled: true },
	{ id: "gemini-3-flash", name: "Gemini 3 Flash", kind: "antigravity", enabled: true },

	{ id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", kind: "antigravity", enabled: false },
	{ id: "gemini-3-pro-preview", name: "Gemini 3 Pro", kind: "antigravity", enabled: false },
	{ id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", kind: "antigravity", enabled: false },
	{ id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", kind: "antigravity", enabled: false },
	{ id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", kind: "antigravity", enabled: false },
	{ id: "gemini-2.5-flash-thinking", name: "Gemini 2.5 Flash Thinking", kind: "antigravity", enabled: false },
	{ id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite", kind: "antigravity", enabled: false },
	{ id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite", kind: "antigravity", enabled: false },
];

/** Merge reference providers without replacing curated model controls. */
export const MODEL_CATALOG: ModelDef[] = (() => {
	const antigravityIds = new Set(PROVIDER_MODELS.filter(model => model.kind === "antigravity").map(model => model.id));
	const catalog = CURATED_MODEL_CATALOG.flatMap(model => {
		const kinds = (Array.isArray(model.kind) ? model.kind : [model.kind]).filter(kind => kind !== "antigravity" || antigravityIds.has(model.id));
		return kinds.length ? [{ ...model, kind: kinds.length === 1 ? kinds[0] : kinds }] : [];
	});
	const knownKinds = new Set<string>([...Object.keys(PROVIDER_PRESETS), ...OAUTH_KINDS]);
	for (const model of PROVIDER_MODELS) {
		if (!knownKinds.has(model.kind) || catalog.some(existing => existing.id === model.id && kindMatches(existing.kind, model.kind))) continue;
		catalog.push({ id: model.id, name: model.name, kind: model.kind as ModelKind, ...(model.contextLength ? { options: [{ key: "max_context", label: "Context budget", type: "select" as const, values: [String(model.contextLength)], value: String(model.contextLength) }] } : {}) });
	}
	return catalog;
})();

export interface ProviderApiKey {
	id: string;
	label: string;
	enabled?: boolean;
	/** Computed for the webview; the secret itself is never persisted here. */
	hasKey?: boolean;
}

export interface ProviderConfig {
	id: string;
	name: string;
	kind: ProviderKind;
	baseUrl: string;
	/** Whether an API key has been stored in SecretStorage for this provider. */
	hasKey?: boolean;
	/** An absent list uses the original secret at this provider's id; [] means no keys. */
	apiKeys?: ProviderApiKey[];
	apiKeyBalance?: "first" | "round-robin";
	/** Optional curated/default model id for this provider. */
	model?: string;
	/** Whether this provider is active. Multiple may be enabled at once. Undefined = enabled. */
	enabled?: boolean;
}

/** Resolve safe credential metadata without reading or copying any secrets. */
export function getProviderApiKeys(provider: ProviderConfig): ProviderApiKey[] {
	if (!Array.isArray(provider.apiKeys)) return [{ id: provider.id, label: "Key 1", enabled: true }];
	const seen = new Set<string>();
	return provider.apiKeys.filter(key => key && typeof key.id === "string"
		&& (key.id === provider.id || key.id.startsWith(`${provider.id}:key:`))
		&& !seen.has(key.id) && !!seen.add(key.id)).map((key, index) => ({
		id: key.id, label: typeof key.label === "string" && key.label.trim() ? key.label.trim() : `Key ${index + 1}`,
		enabled: key.enabled !== false,
	}));
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
	/** Field overrides for shipped subagents, stored separately from custom agents. */
	builtinSubagentOverrides?: BuiltinSubagentOverrides;
	/** Named groups of subagents selectable in Project mode. */
	teams: TeamDef[];
	/** Teams selected for the current Project-mode run. */
	activeTeamIds: string[];
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
	/** Animation policy shared by the chat and settings webviews. */
	motion: "full" | "system" | "reduced";
	/** When true, Ctrl+Enter submits chat and Enter inserts a newline. */
	submitWithCtrlEnter: boolean;
	/** Max chat tabs open at once (0 = unlimited). */
	maxTabCount: number;
	/** Keep a separate composer draft per chat tab (off = one shared composer). */
	perTabDrafts: boolean;
	/** Max agent steps per run before pausing (0 = default 50). */
	maxAgentSteps: number;
	/** Per-tool hard timeout overrides in seconds (empty = built-in defaults). */
	toolTimeoutsSec: Record<string, number>;
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
	/** Master switch for semantic codebase indexing. */
	indexingEnabled: boolean;
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
	teams: [],
	activeTeamIds: ["team-full-stack"],
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
	motion: "full",
	submitWithCtrlEnter: false,
	maxTabCount: 0,
	perTabDrafts: false,
	maxAgentSteps: 50,
	toolTimeoutsSec: {},
	autoContinue: false,
	completionSound: false,
	webSearchEnabled: true,
	webFetchEnabled: true,
	approvalPolicy: DEFAULT_APPROVAL,
	docSources: [],
	indexingEnabled: true,
	indexNewFolders: true,
	indexForGrep: true,
};

/** Default base URLs + whether a key is required, per provider kind. */

const KEY = "ocursor.features";

export class FeatureStore {
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	/** Fires whenever features (or related config) change, so views can refresh live. */
	readonly onDidChange = this._onDidChange.event;

	constructor(private readonly context: vscode.ExtensionContext) {}

	get(): FeatureConfig {
		const stored = this.context.globalState.get<Partial<FeatureConfig>>(KEY) ?? {};
		const cfg = { ...DEFAULTS, ...stored };
		// Built-in team members/teams are always available, even for configs saved before they shipped.
		cfg.subagents = withBuiltinTeamSubagents(cfg.subagents ?? [], cfg.builtinSubagentOverrides);
		cfg.teams = withBuiltinTeams(cfg.teams ?? []);
		return cfg;
	}

	async set(patch: Partial<FeatureConfig>): Promise<FeatureConfig> {
		const next = { ...this.get(), ...patch };
		// Keep shipped defaults in source and persist only intentional differences.
		const toStore: FeatureConfig = {
			...next,
			subagents: withoutBuiltinTeamSubagents(next.subagents ?? []),
			builtinSubagentOverrides: builtinSubagentOverrides(next.subagents ?? []),
			teams: withoutBuiltinTeams(next.teams ?? []),
		};
		await this.context.globalState.update(KEY, toStore);
		this._onDidChange.fire();
		return this.get();
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
		const exact = kind ? all.find((m) => kindMatches(m.kind, kind)) : all[0];
		if (exact) return exact;
		// Resolve gateway prefixes for metadata only; requests retain the full ID.
		if (kind && kind !== "openai" && kind !== "anthropic") return undefined;
		const slash = modelId.indexOf("/");
		if (slash < 1) return undefined;
		const sourceKind = MODEL_PROVIDER_ALIASES[modelId.slice(0, slash)];
		if (!sourceKind) return undefined;
		const sourceId = modelId.slice(slash + 1);
		const source = this.allModels().find(m => m.id === sourceId && kindMatches(m.kind, sourceKind));
		return source ? { ...source, id: modelId, kind: (kind ?? source.kind) as ModelKind } : undefined;
	}

	/** Resolved options for a model: stored overrides take precedence over defaults.
	 *  Overrides are kind-scoped ("<kind>:<id>") so the same model id can hold
	 *  different option state per provider (e.g. anthropic vs claude-code);
	 *  a plain-id record is the legacy/shared fallback.
	 *  Models with no catalog context option get a default max_context selector. */
	optionsFor(modelId: string, kind?: string): ModelOption[] {
		const cfg = this.get();
		const def = this.defFor(modelId, kind);
		const saved = (kind ? cfg.modelOptions[`${kind}:${modelId}`] : undefined) ?? cfg.modelOptions[modelId];
		const base: ModelOption[] = (() => {
			if (!saved) return def?.options ? [...def.options] : [];
			if (!def?.options) return [...saved];
			// Merge: option shape (label/type/values = model capabilities) always comes
			// from the current catalog; only the user's selected `value` is persisted.
			const savedValue = new Map(saved.map((o) => [o.key, o.value]));
			return def.options.map((o) => {
				let v = savedValue.get(o.key);
				if (v == null) return o;
				if (o.key === "thinking") {
					if (v === "false") v = "disabled";
					if (v === "true") v = o.values?.includes("enabled") ? "enabled" : "adaptive";
				}
				// Updating presets must not enlarge a user's smaller working budget.
				if (o.key === "max_context" && o.values && /^[\d.]+\s*[km]?$/i.test(v.trim())) {
					const tokens = parseContextLabel(v);
					const ceiling = Math.max(...o.values.map(parseContextLabel));
					if (tokens > 0 && tokens <= ceiling) return { ...o, value: v, values: o.values.includes(v) ? o.values : [...o.values, v] };
				}
				if (o.values && !o.values.includes(v)) return o;
				return { ...o, value: v };
			});
		})().map((option) => ({ ...option, ...(option.values ? { values: [...option.values] } : {}) }));
		// Speed is a capability, not an arbitrary saved request field.
		for (let index = base.length - 1; index >= 0; index--) if (base[index].key === "speed") base.splice(index, 1);
		const speedKind = kind ?? (Array.isArray(def?.kind) ? def.kind[0] : def?.kind);
		if (supportsFastMode(modelId, speedKind)) {
			const speed = saved?.find(option => option.key === "speed")?.value;
			base.push({ key: "speed", label: "Speed", description: MODEL_SPEED_DESCRIPTION, type: "select", values: ["standard", "fast"], value: speed === "fast" ? "fast" : "standard" });
		}
		// Opus 5's two controls are dependent: higher effort cannot disable thinking.
		if (/^claude-opus-5(?:$|-)/.test(modelId.slice(modelId.lastIndexOf("/") + 1)) && base.some((o) => o.key === "thinking" && o.value === "disabled")) {
			const option = base.find((o) => o.key === "reasoning_effort");
			if (option) {
				option.values = ["low", "medium", "high"];
				if (!option.values.includes(option.value)) option.value = "high";
			}
		}
		// Ensure every model exposes a context window (catalog or fallback dropdown).
		if (!base.some((o) => o.key === "max_context")) {
			const savedCtx = saved?.find((o) => o.key === "max_context")?.value;
			const fallback = defaultContextOption();
			if (savedCtx && fallback.values?.includes(savedCtx)) fallback.value = savedCtx;
			else if (savedCtx) {
				// Keep a custom value the user typed/saved even if not in the list.
				fallback.values = [...(fallback.values || []), savedCtx];
				fallback.value = savedCtx;
			}
			base.push(fallback);
		}
		return base;
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
export function optionsToParams(options: ModelOption[]): { reasoningEffort?: string; thinking?: string; maxContext?: string; speed?: ModelSpeed } {
	const out: { reasoningEffort?: string; thinking?: string; maxContext?: string; speed?: ModelSpeed } = {};
	for (const o of options) {
		if (o.key === "reasoning_effort" && o.value) out.reasoningEffort = o.value;
		// thinking is a mode: "disabled" | "adaptive" | "enabled". Legacy "true"/"false"
		// toggles map to enabled/disabled for back-compat with saved settings.
		if (o.key === "thinking") out.thinking = o.value === "true" ? "enabled" : o.value === "false" ? "disabled" : o.value;
		if (o.key === "max_context" && o.value) out.maxContext = o.value;
		if (o.key === "speed" && (o.value === "standard" || o.value === "fast")) out.speed = o.value;
	}
	return out;
}
