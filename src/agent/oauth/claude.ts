/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { ToolSchema, WireMessage } from "../types";
import type { ModelParams } from "../provider/types";
import { toAnthropic } from "../provider/anthropicMessages";
import { applyAnthropicReasoning, needsContext1mBeta } from "../provider/anthropicReasoning";
import { applyAnthropicSpeed } from "../provider/anthropicSpeed";
import { defaultAnthropicMaxTokens } from "../providerLimits";

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
  apiVersion: "2023-06-01",
  cliVersion: "2.1.280",
  port: 54545,
  path: "/callback",
  scope: "org:create_api_key user:profile user:inference",
  models: [
    "claude-opus-5-5",
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
// Keep the existing compatibility prefix used by the reference translator.
// Do not inject its separate billing/cloaking prompts or fabricated identity.
const CLAUDE_SYSTEM_PREFIX = "You are Claude Code, Anthropic's official CLI for Claude.";

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

/** Shared headers for OAuth endpoints; message-only compatibility is below. */
export function claudeOAuthHeaders(accessToken: string, options: {
  stream?: boolean;
  betas?: readonly string[];
} = {}): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    "anthropic-version": CLAUDE_OAUTH_CONFIG.apiVersion,
    "anthropic-beta": [...new Set([OAUTH_BETA, ...(options.betas ?? [])])].join(","),
    accept: options.stream ? "text/event-stream" : "application/json",
  };
}

export interface ClaudeMessagesOptions {
  model: string;
  messages: WireMessage[];
  tools?: ToolSchema[];
  maxTokens?: number;
  modelParams?: ModelParams;
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
  const betas = [
    "claude-code-20250219",
    "interleaved-thinking-2025-05-14",
    ...applyAnthropicReasoning(body, options.model, maxTokens, options.modelParams),
    ...applyAnthropicSpeed(body, options.model, options.modelParams?.speed),
  ];
  // Extra beta flags must correspond to fields/features we actually send;
  // Upstream context management, server tools and cloaking fields
  // are not part of this request contract.
  if (options.modelParams?.maxContext === "1m" && needsContext1mBeta(options.model)) {
    betas.push("context-1m-2025-08-07");
  }
  if (options.tools?.length) {
    body.tools = options.tools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters,
    }));
  }
  return {
    url: CLAUDE_OAUTH_CONFIG.messagesUrl,
    init: {
      method: "POST",
      headers: {
        ...claudeOAuthHeaders(accessToken, { stream: true, betas }),
        "content-type": "application/json",
        "anthropic-dangerous-direct-browser-access": "true",
        "user-agent": `claude-cli/${CLAUDE_OAUTH_CONFIG.cliVersion} (external, sdk-cli)`,
        "x-app": "cli",
      },
      body: JSON.stringify(body),
      signal: options.signal,
    },
  };
}
