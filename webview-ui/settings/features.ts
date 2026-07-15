/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

export interface McpServerConfig {
  name: string;
  transport: "stdio" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  enabled: boolean;
}

export interface SubagentDef {
  id: string;
  name: string;
  description: string;
  prompt: string;
  readonly: boolean;
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

/**
 * Unified event catalog: one label per trigger, with the equivalent native
 * event name for Cursor hooks.json and Claude Code settings.json (when supported).
 */
export const HOOK_EVENTS: { id: HookEvent; label: string; cursor?: string; claude?: string; claudeMatcher?: string }[] = [
  { id: "beforeSubmit", label: "Before prompt submit", cursor: "beforeSubmitPrompt", claude: "UserPromptSubmit" },
  { id: "beforeShell", label: "Before shell command", cursor: "beforeShellExecution", claude: "PreToolUse", claudeMatcher: "Bash" },
  { id: "beforeMcp", label: "Before MCP tool", cursor: "beforeMCPExecution", claude: "PreToolUse" },
  { id: "beforeReadFile", label: "Before file read", cursor: "beforeReadFile", claude: "PreToolUse", claudeMatcher: "Read" },
  { id: "afterEdit", label: "After file edit", cursor: "afterFileEdit", claude: "PostToolUse", claudeMatcher: "Edit" },
  { id: "afterRun", label: "Agent finished (stop)", cursor: "stop", claude: "Stop" },
  { id: "notification", label: "Notification", claude: "Notification" },
  { id: "subagentStop", label: "Subagent finished", claude: "SubagentStop" },
  { id: "preCompact", label: "Before history compaction", claude: "PreCompact" },
  { id: "sessionStart", label: "Session start", claude: "SessionStart" },
  { id: "sessionEnd", label: "Session end", claude: "SessionEnd" },
];

export interface HookDef {
  id: string;
  event: HookEvent;
  command: string;
  enabled: boolean;
}

export interface Persona {
  id: string;
  name: string;
  description: string;
  prompt: string;
  builtin?: boolean;
}

export type ProviderKind = "openai" | "anthropic" | "google" | "openrouter" | "astraflow" | "astraflow-cn" | "ollama" | "llamacpp";

export interface ProviderConfig {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  hasKey?: boolean;
  model?: string;
  /** Undefined = enabled. Multiple providers can be enabled at once. */
  enabled?: boolean;
}

export const PROVIDER_PRESETS: Record<ProviderKind, { label: string; baseUrl: string; needsKey: boolean }> = {
  openai: { label: "OpenAI-compatible", baseUrl: "https://api.openai.com/v1", needsKey: true },
  anthropic: { label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", needsKey: true },
  google: { label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", needsKey: true },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", needsKey: true },
  astraflow: { label: "Astraflow (Global)", baseUrl: "https://api-us-ca.umodelverse.ai/v1", needsKey: true },
  "astraflow-cn": { label: "Astraflow (China)", baseUrl: "https://api.modelverse.cn/v1", needsKey: true },
  ollama: { label: "Ollama", baseUrl: "http://localhost:11434/v1", needsKey: false },
  llamacpp: { label: "llama.cpp", baseUrl: "http://localhost:8080/v1", needsKey: false },
};

/** Built-in "popular" providers shown as connect-by-key cards. */
export const POPULAR_KINDS: ProviderKind[] = ["anthropic", "openai", "google", "openrouter", "astraflow", "astraflow-cn"];

export interface ModelOption {
  key: string;
  label: string;
  type: "select" | "toggle";
  values?: string[];
  value: string;
}

export type ModelKind = ProviderKind | "claude-code" | "codex" | "antigravity";

export interface ModelDef {
  id: string;
  name: string;
  kind: ModelKind | ModelKind[];
  /** Enabled by default in the picker (undefined = true). */
  enabled?: boolean;
  options?: ModelOption[];
  group?: "default" | "other";
  providerId?: string;
  providerName?: string;
}

export interface LlamacppServerConfig {
  host?: string;
  port?: number;
  ctxSize?: number;
  jinja?: boolean;
  flashAttn?: "on" | "off" | "auto";
  nGpuLayers?: string;
  threads?: number;
  parallel?: number;
  batchSize?: number;
  ubatchSize?: number;
  cacheTypeK?: string;
  cacheTypeV?: string;
  mmprojPath?: string;
  draftModelPath?: string;
  specDraftNMax?: number;
  draftNGpuLayers?: string;
  noMmap?: boolean;
  mlock?: boolean;
  extraArgs?: string;
}

export interface LlamacppModel {
  id: string;
  name: string;
  filePath: string;
  repo?: string;
  file: string;
  sizeBytes?: number;
  port: number;
  autoLoad: boolean;
  useCustomConfig?: boolean;
  contextLength?: number;
  config?: LlamacppServerConfig;
}

export interface LlamacppStatus {
  installed: boolean;
  running: Record<string, boolean>;
  loading: Record<string, boolean>;
  errors: Record<string, string>;
  logs: Record<string, string[]>;
}

export interface HfGgufResult {
  repo: string;
  file: string;
  sizeBytes?: number;
  downloads?: number;
  likes?: number;
}

export interface OllamaModel {
  name: string;
  sizeBytes?: number;
  parameterSize?: string;
  quantization?: string;
  family?: string;
}

export interface OllamaStatus {
  installed: boolean;
  pulling: Record<string, number>;
  errors: Record<string, string>;
}

export interface OllamaLibraryModel {
  name: string;
  description?: string;
  pulls?: string;
}

export type OAuthKind = "claude-code" | "codex" | "antigravity";

export interface OAuthAccountInfo {
  id: string;
  kind: OAuthKind;
  email?: string;
  accountId?: string;
  disabled?: boolean;
}

export type OAuthBalanceStrategy = "first" | "round-robin" | "highest-limit" | "nearest-reset";

export const BALANCE_OPTIONS: { value: OAuthBalanceStrategy; label: string; desc: string }[] = [
  { value: "first", label: "First account", desc: "Always use the first enabled account" },
  { value: "round-robin", label: "Round robin", desc: "Rotate between enabled accounts per request" },
  { value: "highest-limit", label: "Highest remaining limit", desc: "Pick the account with the most quota left" },
  { value: "nearest-reset", label: "Nearest reset time", desc: "Pick the account whose quota resets soonest" },
];

export interface OAuthLimit {
  label: string;
  /** Percent of the quota still available (0–100). */
  remaining: number;
  limit: number;
  resetsAt?: number;
}

export interface OAuthStatus {
  accounts: OAuthAccountInfo[];
  pending?: OAuthKind;
  errors: Partial<Record<OAuthKind, string>>;
  balanceStrategy?: OAuthBalanceStrategy;
}

export const OAUTH_LABEL: Record<OAuthKind, string> = { "claude-code": "Claude Code", codex: "OpenAI Codex", antigravity: "Google Antigravity" };

export const OAUTH_PROVIDERS: { kind: OAuthKind; label: string; sub: string }[] = [
  { kind: "claude-code", label: "Claude Code", sub: "Sign in with your Claude (Anthropic) account" },
  { kind: "codex", label: "OpenAI Codex", sub: "Sign in with your ChatGPT account" },
  { kind: "antigravity", label: "Google Antigravity", sub: "Sign in with your Google account" },
];

export interface FeatureConfig {
  providers: ProviderConfig[];
  activeProviderId: string;
  modelOptions: Record<string, ModelOption[]>;
  customModels: ModelDef[];
  mcpServers: McpServerConfig[];
  subagents: SubagentDef[];
  subagentModel: string;
  autoJudgeModel: string;
  hooks: HookDef[];
  enabledModels: string[];
  disabledModels: string[];
  customPersonas: Persona[];
  activePersonaId: string;
  askPersonaOnNewChat: boolean;
  disabledLocalModels: string[];
  llamacppModels: LlamacppModel[];
  llamacppContextLength: number;
  llamacppConfig: LlamacppServerConfig;
  notifyOnComplete: boolean;
  autoGenerateTitles: boolean;
  trackUsage: boolean;
  chatTextSize: "compact" | "default" | "large";
  submitWithCtrlEnter: boolean;
  maxTabCount: number;
  maxAgentSteps: number;
  autoContinue: boolean;
  completionSound: boolean;
  webSearchEnabled: boolean;
  webFetchEnabled: boolean;
  approvalPolicy: ApprovalPolicy;
  indexingEnabled: boolean;
  indexNewFolders: boolean;
  indexForGrep: boolean;
}

// ---- Approval policy (mirror of src/agent/approvalPolicy.ts) ----
export type ApprovalMode = "allow" | "ask" | "review" | "deny";
export interface ApprovalRule {
  mode: ApprovalMode;
  allowlist: string[];
  denylist: string[];
}
export type ApprovalActionType = "shell" | "edits" | "delete" | "mcp" | "web" | "outside";
export type ApprovalPolicy = Record<ApprovalActionType, ApprovalRule>;

const approvalRule = (mode: ApprovalMode): ApprovalRule => ({ mode, allowlist: [], denylist: [] });
export const DEFAULT_APPROVAL: ApprovalPolicy = {
  shell: approvalRule("ask"),
  edits: approvalRule("ask"),
  delete: approvalRule("ask"),
  mcp: approvalRule("ask"),
  web: approvalRule("ask"),
  outside: approvalRule("ask"),
};

/** Cumulative token usage for one model (host: usageStore). */
export interface ModelUsage {
  promptTokens: number;
  completionTokens: number;
  requests: number;
  lastUsed: number;
}

export interface McpStatus {
  name: string;
  connected: boolean;
  toolCount: number;
  tools?: string[];
  error?: string;
}

export interface RuleInfo {
  file: string;
  path?: string;
  alwaysApply: boolean;
  globs: string;
  description: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
}

export const EMPTY_FEATURES: FeatureConfig = {
  providers: [],
  activeProviderId: "",
  modelOptions: {},
  customModels: [],
  mcpServers: [],
  subagents: [],
  subagentModel: "",
  autoJudgeModel: "",
  hooks: [],
  enabledModels: [],
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
  indexingEnabled: true,
  indexNewFolders: true,
  indexForGrep: true,
};

export function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
