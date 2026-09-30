/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { ModelParams } from "./types";

/** Supported settings verified against Anthropic's effort/thinking docs. */
const ANTHROPIC_EFFORT = /claude-(opus-4-[5678]|opus-5|sonnet-4-6|sonnet-5|fable-5|mythos)/i;
const ANTHROPIC_MAX_EFFORT = /claude-(opus-4-[678]|opus-5|sonnet-4-6|sonnet-5|fable-5|mythos)/i;
const ANTHROPIC_XHIGH_EFFORT = /claude-(opus-4-[78]|opus-5|sonnet-5|fable-5|mythos-5)/i;
const EFFORT_LEVELS = new Set(["low", "medium", "high", "xhigh", "max"]);
/** Models that support adaptive thinking (no budget_tokens). */
const ANTHROPIC_ADAPTIVE = /claude-(opus-4-[678]|opus-5|sonnet-4-6|sonnet-5|fable-5|mythos)/i;
/** Models that reject manual `thinking:{type:enabled,budget_tokens}` with a 400.
 * Per docs: Opus 5, Opus 4.8/4.7, Sonnet 5, Fable 5, Mythos 5 → adaptive only. */
const ANTHROPIC_NO_MANUAL = /claude-(opus-4-[78]|opus-5|sonnet-5|fable-5|mythos-5)/i;
/** Opus 5 rejects `thinking:{type:disabled}` when effort is xhigh/max (400). */
const ANTHROPIC_DISABLE_NEEDS_LOW_EFFORT = /claude-opus-5/i;
/** Opus 5.5 / Fable 5 / Mythos: thinking is always on; disabled returns 400.
 * https://platform.claude.com/docs/en/models/opus-5-5/whats-new-opus-5-5 */
const ANTHROPIC_NO_DISABLE = /claude-(opus-5-5|fable-5|mythos)/i;
/**
 * Kept for callers of the existing provider API. The legacy context beta was
 * retired on April 30, 2026; current 1M models use that window without a beta.
 * https://platform.claude.com/docs/en/release-notes/overview
 */
export function needsContext1mBeta(_model: string): boolean {
  return false;
}

function normalizeEffort(model: string, effort: string | undefined): string | undefined {
  if (!effort || !EFFORT_LEVELS.has(effort) || !ANTHROPIC_EFFORT.test(model)) return undefined;
  // Saved settings may predate the catalog's per-model restrictions. Avoid
  // replaying unsupported xhigh/max values, and do not increase token spending.
  if (effort === "xhigh" && !ANTHROPIC_XHIGH_EFFORT.test(model)) return "high";
  if (effort === "max" && !ANTHROPIC_MAX_EFFORT.test(model)) return "high";
  return effort;
}

/**
 * Apply Anthropic thinking + effort to a request body. The array return value
 * preserves the provider API, but top-level effort no longer needs a beta.
 * https://platform.claude.com/docs/en/build-with-claude/effort
 * https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting
 * Centralizes the per-model rules:
 *  - effort → `output_config.effort` (low/medium/high/xhigh/max)
 *  - 4.6+ → adaptive thinking (no budget); Opus 4.5 → manual budget
 */
export function applyAnthropicReasoning(
  body: Record<string, unknown>,
  model: string,
  maxTokens: number,
  params?: ModelParams,
): string[] {
  const betas: string[] = [];
  let mode = params?.thinking; // "disabled" | "adaptive" | "enabled" | undefined
  let effort = normalizeEffort(model, params?.reasoningEffort);

  // Opus 5.5/Fable/Mythos reject thinking:{disabled} — coerce to adaptive
  // before applying the older Opus 5 restriction so saved effort is preserved.
  if (mode === "disabled" && ANTHROPIC_NO_DISABLE.test(model)) {
    mode = "adaptive";
  }

  // Opus 5 rejects thinking:{disabled} above `high` effort. Clamp rather than
  // sending a request we know will 400.
  if (mode === "disabled" && effort && ANTHROPIC_DISABLE_NEEDS_LOW_EFFORT.test(model)
    && (effort === "xhigh" || effort === "max")) {
    effort = "high";
  }

  if (effort) {
    body.output_config = { effort };
  }

  // Both Opus 5 and Sonnet 5 default to thinking. Omitting the field when the
  // user selects disabled leaves their default thinking behavior enabled.
  if (mode === "disabled") {
    body.thinking = { type: "disabled" };
  }

  if (mode && mode !== "disabled") {
    const canAdaptive = ANTHROPIC_ADAPTIVE.test(model);
    const canManual = !ANTHROPIC_NO_MANUAL.test(model);
    // Manual mode only where the API still accepts it AND the user asked for it
    // (or the model can't do adaptive, e.g. Haiku 4.5 / older Claude 4).
    const useManual = canManual && (mode === "enabled" || !canAdaptive);
    if (useManual) {
      // Keep the user's output cap: a valid manual budget must be >=1024 and
      // leave room for the answer. Raising max_tokens here would also make the
      // loop's reserved output budget incorrect.
      // https://platform.claude.com/docs/en/build-with-claude/extended-thinking
      if (maxTokens <= 1024) {
        throw new Error("Extended thinking requires max response tokens above 1024. Increase the response limit or disable thinking.");
      }
      // `thinking.enabled` requires budget_tokens; scale it by effort.
      const frac = { low: 0.15, medium: 0.3, high: 0.5, xhigh: 0.7, max: 0.85 }[effort ?? "high"] ?? 0.5;
      body.thinking = { type: "enabled", budget_tokens: Math.max(1024, Math.floor(maxTokens * frac)) };
      body.temperature = 1; // required when manual thinking is enabled
    } else {
      // Adaptive-only models (Opus 5/4.8/4.7, Sonnet 5, Fable 5, Mythos): the model
      // decides when/how much to think; effort steers depth. No budget_tokens.
      // `display` defaults to "omitted" → thinking happens but blocks come back
      // empty; ask for "summarized" so summaries stream.
      body.thinking = { type: "adaptive", display: "summarized" };
    }
  }
  return betas;
}
