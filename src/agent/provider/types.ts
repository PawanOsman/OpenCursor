/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { WireMessage, ToolSchema } from "../types";
import type { OAuthKind } from "../oauth/types";
import type { ApiKeyPool } from "./apiKeyPool";

export interface ModelInfo {
  id: string;
}

/** Per-model tunable params (reasoning effort, extended thinking). */
export interface ModelParams {
  reasoningEffort?: string;
  /** Explicit processing preference; availability is provider/model dependent. */
  speed?: "standard" | "fast";
  /** Thinking mode: "disabled" | "adaptive" | "enabled" (Anthropic). */
  thinking?: string;
  /** Local working-context budget (e.g. "200k", "1m"); does not change the model's window. */
  maxContext?: string;
}

/** Optional sampling / generation parameters. Null/empty values are omitted. */
export interface SamplingParams {
  topP?: number | null;
  topK?: number | null;
  frequencyPenalty?: number | null;
  presencePenalty?: number | null;
  seed?: number | null;
  stopSequences?: string[];
}

export interface StreamChatOpts {
  apiBaseUrl: string;
  apiKey: string;
  /** Fresh credentials and failover, restricted to this provider's endpoint. */
  apiKeyPool?: ApiKeyPool;
  /** Internal protocol adapter selected by the configured provider preset. */
  providerAdapterId?: string;
  model: string;
  messages: WireMessage[];
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
  sampling?: SamplingParams;
  modelParams?: ModelParams;
  anthropic?: boolean;
  /** OAuth account provider (Claude Code / Codex) — overrides apiBaseUrl/apiKey. */
  oauthKind?: OAuthKind;
  /** Stable conversation/run key for provider prompt-cache routing. */
  promptCacheKey?: string;
  signal: AbortSignal;
  /** Max total attempts per request (default 3). */
  maxRetries?: number;
  /** First-event and inter-event deadlines, including local model warm-up. */
  connectionTimeoutMs?: number;
  idleTimeoutMs?: number;
  /** Notified before each backoff sleep when a transient error is retried. */
  onRetry?: (attempt: number, max: number, delayMs: number, error: string) => void;
}
