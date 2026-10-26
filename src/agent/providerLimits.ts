/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { OAuthKind } from "./oauth/types";
import type { ModelParams } from "./provider/types";

/** Keep response defaults shared by Anthropic request construction and fitting. */
export function defaultAnthropicMaxTokens(model: string, effort?: string): number {
  const adaptive = /claude-(opus-4-[678]|opus-5|sonnet-4-6|sonnet-5|haiku-5|fable-5|mythos)/i;
  if (adaptive.test(model)) {
    return effort === "xhigh" || effort === "max" ? 65_536 : 32_768;
  }
  return 8192;
}

export interface ResponseReservationOptions {
  model: string;
  apiBaseUrl?: string;
  maxTokens?: number;
  anthropic?: boolean;
  oauthKind?: OAuthKind;
  modelParams?: ModelParams;
}

/**
 * Reserve the output budget actually configured by fixed-limit transports.
 * OpenAI-compatible and Codex automatic limits are decided by the server; the
 * 4096 fallback is planning headroom, not a claim about their maximum output.
 */
export function responseTokenReservation(options: ResponseReservationOptions): number {
  const explicit = options.maxTokens && options.maxTokens > 0 ? options.maxTokens : undefined;
  if (options.oauthKind === "antigravity") return Math.min(explicit ?? 8192, 64000);
  const anthropic = options.oauthKind
    ? options.oauthKind === "claude-code"
    : options.anthropic ?? /anthropic\.com/i.test(options.apiBaseUrl ?? "");
  if (anthropic) {
    return explicit ?? defaultAnthropicMaxTokens(options.model, options.modelParams?.reasoningEffort);
  }
  return explicit ?? 4096;
}
