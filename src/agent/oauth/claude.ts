/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { createHash, randomBytes, randomUUID } from "crypto";
import type { ToolSchema, WireMessage } from "../types";
import type { ModelParams } from "../provider/types";
import { toAnthropic } from "../provider/anthropicMessages";
import { applyAnthropicReasoning, needsContext1mBeta } from "../provider/anthropicReasoning";
import { applyAnthropicSpeed } from "../provider/anthropicSpeed";
import { defaultAnthropicMaxTokens } from "../providerLimits";
import { ANTHROPIC_API_VERSION, CLAUDE_CLI_VERSION, mergeAnthropicBeta, selectAnthropicBeta } from "./protocols/providers/shared.js";

/**
 * OpenCursor's Claude OAuth transport. The CLI version is a compatibility identifier, not
 * OpenCursor's version or a claim about the installed SDK/runtime.
 */
export const CLAUDE_OAUTH_CONFIG = {
  authUrl: "https://claude.ai/oauth/authorize",
  tokenUrl: "https://api.anthropic.com/v1/oauth/token",
  messagesUrl: "https://api.anthropic.com/v1/messages?beta=true",
  modelsUrl: "https://api.anthropic.com/v1/models?limit=1000",
  usageUrl: "https://api.anthropic.com/api/oauth/usage",
  clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  apiVersion: ANTHROPIC_API_VERSION,
  cliVersion: CLAUDE_CLI_VERSION,
  port: 54545,
  path: "/callback",
  scope: "org:create_api_key user:profile user:inference",
  models: [
    "claude-opus-5-5",
    "claude-sonnet-5-5",
    "claude-haiku-5-5",
    "claude-fable-5-1",
    "claude-fable-5",
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "claude-opus-4-5",
    "claude-haiku-4-5",
    "claude-haiku-4-5-20251001",
  ],
} as const;

const OAUTH_BETA = "oauth-2025-04-20";
const CLAUDE_SYSTEM_PREFIX = "You are Claude Code, Anthropic's official CLI for Claude.";
const CC_ENTRYPOINT = "sdk-cli";
const BILLING_PREFIX = "x-anthropic-billing-header:";

/** Claude Code CLI fingerprint sent with OAuth message requests (static, as in the reference registry). */
const CLAUDE_CLI_HEADERS: Record<string, string> = {
  "anthropic-dangerous-direct-browser-access": "true",
  "user-agent": `claude-cli/${CLAUDE_CLI_VERSION} (external, sdk-cli)`,
  "x-app": "cli",
  "x-stainless-helper-method": "stream",
  "x-stainless-retry-count": "0",
  "x-stainless-runtime-version": "v24.14.0",
  "x-stainless-package-version": "0.80.0",
  "x-stainless-runtime": "node",
  "x-stainless-lang": "js",
  "x-stainless-arch": "arm64",
  "x-stainless-os": "MacOS",
  "x-stainless-timeout": "600",
};

/** cc_version=<ver>.<build>; cc_entrypoint=sdk-cli; cch=<sha256(body)[0:5]> */
function billingHeader(body: unknown): string {
  const cch = createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 5);
  const build = randomBytes(2).toString("hex").slice(0, 3);
  return `${BILLING_PREFIX} cc_version=${CLAUDE_CLI_VERSION}.${build}; cc_entrypoint=${CC_ENTRYPOINT}; cch=${cch};`;
}

/** Deterministic UUID-v4-shaped string from a seed. */
export function claudeSeedUuid(seed: string): string {
  const h = createHash("sha256").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** metadata.user_id JSON: device/account derive from the token, session per conversation. */
function claudeUserId(accessToken: string, sessionId: string): string {
  const deviceId = createHash("sha256").update(`device:${accessToken}`).digest("hex");
  const accountUuid = claudeSeedUuid(`account:${accessToken}`);
  return `{"device_id":"${deviceId}","account_uuid":"${accountUuid}","session_id":"${sessionId}"}`;
}

export function buildClaudeAuthorizationUrl(options: {
  challenge: string;
  state: string;
  redirectUri: string;
}): string {
  const params = new URLSearchParams({
    code: "true",
    client_id: CLAUDE_OAUTH_CONFIG.clientId,
    response_type: "code",
    redirect_uri: options.redirectUri,
    scope: CLAUDE_OAUTH_CONFIG.scope,
    code_challenge: options.challenge,
    code_challenge_method: "S256",
    state: options.state,
  });
  return `${CLAUDE_OAUTH_CONFIG.authUrl}?${params}`;
}

/** Headers for OAuth account endpoints (usage, models); message headers are below. */
export function claudeOAuthHeaders(accessToken: string, options: {
  stream?: boolean;
  betas?: readonly string[];
} = {}): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    "anthropic-version": CLAUDE_OAUTH_CONFIG.apiVersion,
    "anthropic-beta": [...new Set([OAUTH_BETA, ...(options.betas ?? [])])].join(","),
    accept: options.stream ? "text/event-stream" : "application/json",
    "user-agent": `claude-cli/${CLAUDE_CLI_VERSION} (external, cli)`,
  };
}

export interface ClaudeMessagesOptions {
  model: string;
  messages: WireMessage[];
  tools?: ToolSchema[];
  maxTokens?: number;
  modelParams?: ModelParams;
  /** Claude Code session UUID; shared by metadata.user_id and x-claude-code-session-id. */
  sessionId?: string;
  signal: AbortSignal;
}

/** Build an OAuth request without rewriting tool names or caller history. */
export function buildClaudeMessagesRequest(accessToken: string, options: ClaudeMessagesOptions): {
  url: string;
  init: RequestInit;
} {
  const { system, messages } = toAnthropic(options.messages);
  if (system[0]?.text !== CLAUDE_SYSTEM_PREFIX) {
    system.unshift({ type: "text", text: CLAUDE_SYSTEM_PREFIX });
  }
  const maxTokens = options.maxTokens && options.maxTokens > 0
    ? options.maxTokens
    : defaultAnthropicMaxTokens(options.model, options.modelParams?.reasoningEffort);
  const body: Record<string, unknown> = {
    model: options.model,
    system,
    messages,
    stream: true,
    max_tokens: maxTokens,
  };
  const featureBetas = [
    ...applyAnthropicReasoning(body, options.model, maxTokens, options.modelParams),
    ...applyAnthropicSpeed(body, options.model, options.modelParams?.speed),
  ];
  if (options.modelParams?.maxContext === "1m" && needsContext1mBeta(options.model)) {
    featureBetas.push("context-1m-2025-08-07");
  }
  if (options.tools?.length) {
    body.tools = options.tools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters,
    }));
  }
  // Claude Code beta set for this model (drops redact-thinking when summaries
  // are requested), plus any feature flag this request needs.
  const beta = mergeAnthropicBeta(selectAnthropicBeta(options.model, body), featureBetas.join(","));
  const sessionId = options.sessionId || randomUUID();
  const oauthToken = accessToken.includes("sk-ant-oat");
  if (oauthToken) {
    // The billing block is system[0] and hashes the body as built so far; the
    // user id session matches x-claude-code-session-id.
    system.unshift({ type: "text", text: billingHeader(body) });
    body.metadata = { user_id: claudeUserId(accessToken, sessionId) };
  }
  return {
    url: CLAUDE_OAUTH_CONFIG.messagesUrl,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...CLAUDE_CLI_HEADERS,
        authorization: `Bearer ${accessToken}`,
        "anthropic-version": CLAUDE_OAUTH_CONFIG.apiVersion,
        "anthropic-beta": beta,
        ...(oauthToken ? { "x-claude-code-session-id": sessionId } : {}),
        accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal: options.signal,
    },
  };
}
