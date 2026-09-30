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
  transport: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  oauth?: { clientId?: string; scopes?: string[] };
  enabled: boolean;
}

export interface SubagentDef {
  id: string;
  name: string;
  description: string;
  prompt: string;
  readonly: boolean;
  model?: string;
  builtin?: boolean;
}

/** A named group of subagents, selectable as a squad in Project mode. */
export interface TeamDef {
  id: string;
  name: string;
  description: string;
  subagentIds: string[];
  builtin?: boolean;
}

/** Unified hook events covering OpenCursor, Cursor and Claude Code trigger points. */
export type HookEvent =
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

/**
 * Unified event catalog: one label per trigger, with the equivalent native
 * event name for Cursor hooks.json and Claude Code settings.json (when supported).
 */
export const HOOK_EVENTS: { id: HookEvent; label: string; cursor?: string; claude?: string; claudeMatcher?: string }[] = [
  { id: "beforeSubmit", label: "Before prompt submit", cursor: "beforeSubmitPrompt", claude: "UserPromptSubmit" },
  { id: "beforeShell", label: "Before shell command", cursor: "beforeShellExecution", claude: "PreToolUse", claudeMatcher: "Bash" },
  { id: "beforeMcp", label: "Before MCP tool", cursor: "beforeMCPExecution", claude: "PreToolUse" },
  { id: "beforeReadFile", label: "Before file read", cursor: "beforeReadFile", claude: "PreToolUse", claudeMatcher: "Read" },
  { id: "beforeEdit", label: "Before file mutation", claude: "PreToolUse", claudeMatcher: "Write|Edit|NotebookEdit|Delete" },
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

import { PROVIDER_PRESETS, type ProviderKind } from "../../src/shared/providerCatalog";
import { OAUTH_PROVIDER_DEFINITIONS, type OAuthProviderKind } from "../../src/shared/oauthProviders";
export { PROVIDER_PRESETS, POPULAR_KINDS, FREE_KINDS } from "../../src/shared/providerCatalog";
export type { ProviderKind } from "../../src/shared/providerCatalog";

export interface ProviderApiKey {
  id: string;
  label: string;
  enabled?: boolean;
  hasKey?: boolean;
}

export interface ProviderConfig {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  hasKey?: boolean;
  apiKeys?: ProviderApiKey[];
  apiKeyBalance?: "first" | "round-robin";
  model?: string;
  /** Undefined = enabled. Multiple providers can be enabled at once. */
  enabled?: boolean;
}


/** Built-in "popular" providers shown as connect-by-key cards. */


export interface ModelOption {
  key: string;
  label: string;
  description?: string;
  type: "select" | "toggle";
  values?: string[];
  value: string;
}

export type ModelKind = ProviderKind | OAuthProviderKind;

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
  states?: Record<string, string>;
  endpoints?: Record<string, string>;
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
  sha256?: string;
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
  reachable?: boolean;
  endpoint?: string;
  version?: string;
  states?: Record<string, string>;
  progress?: Record<string, string>;
  capabilities?: Record<string, string[]>;
  loaded?: Record<string, { sizeBytes?: number; vramBytes?: number; contextLength?: number; expiresAt?: string }>;
  pulling: Record<string, number>;
  errors: Record<string, string>;
}

export interface OllamaLibraryModel {
  name: string;
  description?: string;
  pulls?: string;
}

export type OAuthKind = OAuthProviderKind;

export interface OAuthAccountInfo {
  id: string;
  kind: OAuthKind;
  email?: string;
  accountId?: string;
  disabled?: boolean;
}

export type OAuthBalanceStrategy = "first" | "round-robin" | "highest-limit" | "nearest-reset";

export const BALANCE_OPTIONS: { value: OAuthBalanceStrategy; label: string; desc: string }[] = [
  { value: "first", label: "First account", desc: "Prefer the first enabled account, then fail over" },
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
  /** Authorization URL for the current pending login; contains no tokens or verifier. */
  authorizationUrl?: string;
  loginMethod?: "browser" | "device-code" | "import-token";
  userCode?: string;
  verificationUri?: string;
  expiresAt?: number;
  errors: Partial<Record<OAuthKind, string>>;
  balanceStrategy?: OAuthBalanceStrategy;
  balanceStrategies?: Partial<Record<OAuthKind, OAuthBalanceStrategy>>;
}

export const OAUTH_LABEL = Object.fromEntries(OAUTH_PROVIDER_DEFINITIONS.map(provider => [provider.kind, provider.label])) as Record<OAuthKind, string>;

export const OAUTH_PROVIDERS: { kind: OAuthKind; label: string; sub: string }[] = OAUTH_PROVIDER_DEFINITIONS.map(provider => ({ ...provider }));

export interface FeatureConfig {
  providers: ProviderConfig[];
  activeProviderId: string;
  modelOptions: Record<string, ModelOption[]>;
  customModels: ModelDef[];
  mcpServers: McpServerConfig[];
  subagents: SubagentDef[];
  teams: TeamDef[];
  activeTeamIds: string[];
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
  motion: "full" | "system" | "reduced";
  submitWithCtrlEnter: boolean;
  maxTabCount: number;
  perTabDrafts: boolean;
  maxAgentSteps: number;
  /** Per-tool hard timeout overrides in seconds (empty = built-in defaults). */
  toolTimeoutsSec: Record<string, number>;
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
  cachedReadTokens?: number;
  cachedWriteTokens?: number;
  cacheReadInputTokens?: number;
  cacheWriteReported?: boolean;
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
  authState?: "none" | "required" | "authorizing" | "authenticated";
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
  pluginId?: string;
}

export const EMPTY_FEATURES: FeatureConfig = {
  providers: [],
  activeProviderId: "",
  modelOptions: {},
  customModels: [],
  mcpServers: [],
  subagents: [],
  teams: [],
  activeTeamIds: [],
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
  indexingEnabled: true,
  indexNewFolders: true,
  indexForGrep: true,
};

export function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
