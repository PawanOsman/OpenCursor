/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { ToolOutcome } from "./toolOutcome";

export type Mode = "agent" | "ask" | "plan" | "multitask" | "project" | "debug";

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  /** Opaque Gemini signature returned with this exact tool call. */
  thoughtSignature?: string;
}

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  data: string;
  kind: "image" | "text";
}

/** An image produced by a tool (e.g. Read on a PNG), carried to the model. */
export interface ToolImage {
  mime: string;
  base64: string;
}

/** Opaque Responses state, replayed only to the model, provider, and credential that issued it. */
export interface ResponsesReasoning {
  model: string;
  provider: "openai" | "codex";
  /** Stable account ID or key fingerprint, never an access token or API key. */
  credential?: string;
  /** Phase is safe as a fallback only when all original assistant items agree. */
  phase?: "commentary" | "final_answer" | null;
  /** Preserve item boundaries when a response contains different output phases. */
  messages?: Array<{ text: string; phase?: "commentary" | "final_answer" | null }>;
  items: Array<{
    type: "reasoning";
    id: string;
    summary: unknown[];
    encrypted_content: string;
  }>;
}

/** Exact Chat Completions reasoning returned by a supported compatible API.
 * Kept separate from display thinking; replay is scoped to its endpoint/model. */
export interface ChatReasoning {
  endpoint: string;
  model: string;
  content: string;
}

/** Context captured once when a user turn is created; never refreshed in place. */
export interface UserContextSnapshot {
  readonly version: 1;
  readonly userInfo: string;
  readonly openFiles: string;
  readonly timestamp: string;
  readonly reminder?: string;
  /** Full values remain saved for recovery; unchanged blocks need not repeat. */
  readonly omitUserInfo?: boolean;
  readonly omitOpenFiles?: boolean;
}

export type Step =
  /** `synthetic` marks loop-injected system messages (nudges, subagent reports,
   *  compaction summaries) — they are not the user's request and must never be
   *  treated as one when placing context blocks or bounding the live turn. */
  | { kind: "user"; text: string; attachments?: Attachment[]; synthetic?: boolean; context?: UserContextSnapshot }
  | { kind: "assistant"; text: string; thinking?: string; calls: ToolCall[]; responsesReasoning?: ResponsesReasoning; chatReasoning?: ChatReasoning }
  | { kind: "tool-result"; callId: string; name: string; output: string; status: "completed" | "error"; image?: ToolImage; outcome?: ToolOutcome };

export interface ToolSchema {
  type: "function";
  function: { name: string; description: string; parameters: object };
}

export interface CacheControl {
  type: "ephemeral";
}

export type WireContentPart =
  | { type: "text"; text: string; cache_control?: CacheControl }
  | { type: "image_url"; image_url: { url: string }; cache_control?: CacheControl };

export type WireMessage =
  | { role: "system"; content: string | WireContentPart[] }
  | { role: "user"; content: string | WireContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: WireToolCall[]; responsesReasoning?: ResponsesReasoning; chatReasoning?: ChatReasoning }
  | { role: "tool"; tool_call_id: string; content: string | WireContentPart[] };

export interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  /** Internal replay metadata, serialized only by the Google clients. */
  thoughtSignature?: string;
}

export type ProviderEvent =
  | { type: "text-delta"; text: string }
  | { type: "thinking-delta"; text: string }
  /** Complete, validated reasoning state for one response; never a UI event. */
  | { type: "responses-reasoning"; reasoning: ResponsesReasoning }
  /** Complete reasoning_content received from a compatible API; never a UI event. */
  | { type: "chat-reasoning"; reasoning: ChatReasoning }
  // Streaming tool-call progress: fires when a call first appears (name known)
  | { type: "tool-call-start"; index: number; id: string; name: string }
  // ...and as its JSON arguments arrive in chunks.
  | { type: "tool-call-args-delta"; index: number; delta: string }
  | { type: "tool-call"; call: ToolCall }
  | {
    type: "usage";
    promptTokens?: number;
    completionTokens?: number;
    /** Cumulative request totals when streamed usage fields are billing deltas. */
    promptTokensTotal?: number;
    completionTokensTotal?: number;
    /** Cache counters are billing deltas; cached reads are included in promptTokens. */
    cachedReadTokens?: number;
    cachedWriteTokens?: number;
    /** Newly classified input whose cached-read count was actually reported. */
    cacheReadInputTokens?: number;
    /** One identity per HTTP attempt, including attempts that later fail. */
    requestId?: string;
    model?: string;
  }
  | { type: "done"; finishReason: string };

export type AgentEvent =
  | { type: "user-steering"; text: string; requestId?: string }
  | { type: "verification"; summary: import("./verification").VerificationSnapshot }
  | { type: "text-delta"; text: string }
  | { type: "thinking-delta"; text: string }
  | { type: "tool-call-started"; callId: string; name: string; input: unknown; timeoutMs?: number; startedAt?: number }
  // Live JSON-arg streaming for a started call (UI parses partial input).
  | { type: "tool-call-args"; callId: string; argsText: string }
  // Partial output of a still-running tool (live shell output).
  | { type: "tool-call-progress"; callId: string; text: string }
  | { type: "tool-call-completed"; callId: string; name: string; status: "completed" | "error"; result: string; diff?: string; startLine?: number; endLine?: number; outcome?: ToolOutcome }
  | { type: "run-status"; status: "running" | "finished" | "error" | "cancelled" }
  | { type: "usage"; promptTokens: number; completionTokens: number; totalTokens: number; model?: string; requestId?: string; source?: "parent" | "summary" | "subagent"; cachedReadTokens?: number; cachedWriteTokens?: number; cacheReadInputTokens?: number }
  | { type: "run-result"; text: string; durationMs: number }
  | { type: "subagent-event"; callId: string; event: AgentEvent }
  | { type: "mode-changed"; mode: Mode }
  | { type: "shell-notify"; message: string }
  | { type: "retry"; attempt: number; max: number; delayMs: number; error: string }
  | { type: "compaction"; status: "running" | "done" | "failed"; summary?: string }
  | { type: "max-steps"; steps: number }
  | { type: "error"; message: string };
