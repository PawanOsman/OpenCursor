/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { Step } from "./types";

/**
 * Context helpers for the agent loop.
 *
 * Thinking is UI-only and stripped before the model wire. Tool archives and
 * summarization reduce the working context; budget fitting remains the final
 * safety pass. The full transcript is kept separately from these model copies.
 */

/** A rendered image costs far more than its base64 length suggests. */
const IMAGE_TOKENS = 1300;

/** Rough token estimate (~4 chars/token) for one step, images priced realistically. */
export function stepTokens(s: Step): number {
  let chars = 0;
  if (s.kind === "user") {
    chars += s.text.length;
    if (s.context && !s.synthetic) {
      chars += (s.context.omitUserInfo ? 0 : s.context.userInfo.length) +
        (s.context.omitOpenFiles ? 0 : s.context.openFiles.length) +
        s.context.timestamp.length + (s.context.reminder?.length || 0) + 66;
    }
    for (const a of s.attachments || []) {
      if (a.kind === "text") chars += (a.data?.length || 0) + a.name.length + 42;
    }
    if (s.synthetic) chars += 38;
    const imgs = (s.attachments || []).filter((a) => a.kind === "image").length;
    return Math.ceil(chars / 4) + imgs * IMAGE_TOKENS + 4;
  }
  if (s.kind === "assistant") {
    // thinking is UI-only — never sent on the wire (see buildMessages).
    chars += s.text?.length || 0;
    // Provider replay content is not display thinking and occupies context.
    // Count it once even when the UI shows the same reasoning separately.
    chars += s.chatReasoning?.content.length || 0;
    for (const c of s.calls || []) {
      chars += (c.arguments?.length || 0) + (c.thoughtSignature?.length || 0) + c.name.length + c.id.length + 48;
    }
    return Math.ceil(chars / 4) + 4;
  }
  chars += (s.output?.length || 0) + s.callId.length;
  return Math.ceil(chars / 4) + (s.image ? IMAGE_TOKENS : 0) + 4;
}

/** Total rough token estimate for a step list. */
export function stepsTokens(steps: Step[]): number {
  return steps.reduce((n, s) => n + stepTokens(s), 0);
}

function lastUserIndex(steps: Step[]): number {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].kind === "user") return i;
  }
  return -1;
}

/** Index of the last real (non-synthetic) user message — the actual request. */
export function lastRealUserIndex(steps: Step[]): number {
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s.kind === "user" && !s.synthetic) return i;
  }
  return lastUserIndex(steps);
}

/** The user's current request text, used to anchor the durable state block. */
export function currentRequestText(steps: Step[]): string {
  const i = lastRealUserIndex(steps);
  const s = steps[i];
  return s && s.kind === "user" ? s.text : "";
}

/**
 * Start of a recent-token window (newest-first). Callers retaining tool history
 * must also respect whole call/result groups.
 */
export function recentWindowStart(steps: Step[], keepTokens: number): number {
  let used = 0;
  for (let i = steps.length - 1; i >= 0; i--) {
    used += stepTokens(steps[i]);
    if (used > keepTokens) return i + 1;
  }
  return 0;
}

/** Strip UI-only thinking from the model wire copy. Never mutates tool bodies or args. */
function stripThinking(steps: Step[]): void {
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.kind === "assistant" && s.thinking) {
      steps[i] = { ...s, thinking: undefined };
    }
  }
}

/**
 * Strip UI-only reasoning. Payload reduction belongs to the tool archive,
 * where an omitted body has a recoverable location, rather than blind pruning.
 */
export function economizeHistory(steps: Step[], _opts?: { keepRecentTokens?: number }): { prunedResults: number; slimmedCalls: number } {
  stripThinking(steps);
  return { prunedResults: 0, slimmedCalls: 0 };
}

/**
 * Budget-fit prep. Actual content fitting happens in fitStepsToBudget.
 */
export function economizeHistoryHard(steps: Step[], _opts?: { keepRecentTokens?: number }): void {
  stripThinking(steps);
}

/** Hard safety trigger. Normal compaction waits for a semantic boundary. */
export const COMPACT_AT_FILL = 0.92;

/** Soft boundary trigger — wait until the window is nearly full. */
export const COMPACT_SOFT_FILL = 0.85;

/**
 * Target fraction of budget retained as recent context after summarization.
 * The loop additionally caps this target at 24k tokens for large windows.
 */
export const COMPACT_KEEP_FRAC = 0.35;

/** Skip compaction unless the summarized prefix frees at least this much budget. */
export const COMPACT_MIN_GAIN_FRAC = 0.15;

/** Minimum steps between two compactions, so a run can't summarize in a loop. */
export const COMPACT_COOLDOWN_STEPS = 8;

/** Safe boundary: the model just completed a subtask instead of being mid-tool loop. */
export function isCompactionBoundary(steps: Step[]): boolean {
  const last = steps[steps.length - 1];
  if (!last) return false;
  if (last.kind === "assistant" && !!last.text.trim() && !last.calls.length) return true;
  // Loop-injected messages (subagent reports, nudges) land between turns, which
  // is exactly a safe place to compact.
  if (last.kind === "user") return last.synthetic === true;
  return false;
}
