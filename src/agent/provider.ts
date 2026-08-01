/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { ProviderEvent, ToolCall, ToolSchema, WireMessage, WireContentPart } from "./types";
import { streamOAuthChat, type OAuthKind } from "./oauth";
import type { ModelInfo, ModelParams, SamplingParams, StreamChatOpts } from "./provider/types";

export type { ModelInfo, ModelParams, SamplingParams, StreamChatOpts } from "./provider/types";

function applyOpenAISampling(body: Record<string, unknown>, s?: SamplingParams) {
  if (!s) return;
  if (s.topP != null) body.top_p = s.topP;
  if (s.frequencyPenalty != null) body.frequency_penalty = s.frequencyPenalty;
  if (s.presencePenalty != null) body.presence_penalty = s.presencePenalty;
  if (s.seed != null) body.seed = s.seed;
  if (s.stopSequences && s.stopSequences.length) body.stop = s.stopSequences;
  // top_k is non-standard for OpenAI; many compatible servers accept it.
  if (s.topK != null) body.top_k = s.topK;
}

/** Models that take the `effort` param as a stable feature (no beta header). */
const ANTHROPIC_EFFORT_STABLE = /claude-(opus-4-[678]|opus-5|sonnet-4-6|sonnet-5|fable-5|mythos)/i;
/** Opus 4.5 needs the effort beta header + manual thinking budget. */
const ANTHROPIC_EFFORT_BETA = /claude-opus-4-5/i;
/** Models that support adaptive thinking (no budget_tokens). */
const ANTHROPIC_ADAPTIVE = /claude-(opus-4-[678]|opus-5|sonnet-4-6|sonnet-5|fable-5|mythos)/i;
/** Models that reject manual `thinking:{type:enabled,budget_tokens}` with a 400.
 * Per docs: Opus 5, Opus 4.8/4.7, Sonnet 5, Fable 5, Mythos 5 → adaptive only. */
const ANTHROPIC_NO_MANUAL = /claude-(opus-4-[78]|opus-5|sonnet-5|fable-5|mythos)/i;
/** Opus 5 rejects `thinking:{type:disabled}` when effort is xhigh/max (400). */
const ANTHROPIC_DISABLE_NEEDS_LOW_EFFORT = /claude-opus-5/i;
/** Fable 5 / Mythos 5: thinking is always on — `disabled` returns 400 at any effort. */
const ANTHROPIC_NO_DISABLE = /claude-(fable-5|mythos)/i;
/** Models that reject temperature / top_p / top_k with a 400. */
const ANTHROPIC_NO_SAMPLING = /claude-(opus-4-[678]|opus-5|sonnet-4-6|sonnet-5|fable-5|mythos)/i;
/** Models where 1M context is the default (no context-1m beta header needed). */
const ANTHROPIC_NATIVE_1M = /claude-(opus-4-[678]|opus-5|sonnet-4-6|sonnet-5|fable-5|mythos)/i;

/** Default max_tokens when the user left response length at "auto" (0).
 * Adaptive / always-on thinking models burn this budget before text, so leave
 * headroom — docs recommend ≥64k at xhigh/max. */
export function defaultAnthropicMaxTokens(model: string, effort?: string): number {
  if (ANTHROPIC_ADAPTIVE.test(model) || ANTHROPIC_NO_DISABLE.test(model)) {
    if (effort === "xhigh" || effort === "max") return 65_536;
    return 32_768;
  }
  return 8192;
}

/** Whether the retired context-1m beta header is still useful for this model. */
export function needsContext1mBeta(model: string): boolean {
  return !ANTHROPIC_NATIVE_1M.test(model);
}

/**
 * Apply Anthropic thinking + effort to a request body, returning any beta flags
 * to add to the `anthropic-beta` header. Centralizes the per-model rules:
 *  - effort → `output_config.effort` (low/medium/high/xhigh/max)
 *  - 4.6+ → adaptive thinking (no budget); Opus 4.5 → manual budget + beta header
 */
export function applyAnthropicReasoning(
  body: Record<string, unknown>,
  model: string,
  maxTokens: number,
  params?: ModelParams,
): string[] {
  const betas: string[] = [];
  let mode = params?.thinking; // "disabled" | "adaptive" | "enabled" | undefined
  let effort = params?.reasoningEffort;

  // Fable/Mythos reject thinking:{disabled} entirely — coerce to adaptive.
  if (mode === "disabled" && ANTHROPIC_NO_DISABLE.test(model)) {
    mode = "adaptive";
  }

  // Opus 5 rejects thinking:{disabled} above `high` effort. Clamp rather than
  // sending a request we know will 400.
  if (mode === "disabled" && effort && ANTHROPIC_DISABLE_NEEDS_LOW_EFFORT.test(model)
    && (effort === "xhigh" || effort === "max")) {
    effort = "high";
  }

  if (effort && (ANTHROPIC_EFFORT_STABLE.test(model) || ANTHROPIC_EFFORT_BETA.test(model))) {
    body.output_config = { effort };
    if (ANTHROPIC_EFFORT_BETA.test(model)) betas.push("effort-2025-11-24");
  }

  // Thinking is on by default from Opus 5 onward, so opting out has to be explicit.
  if (mode === "disabled" && ANTHROPIC_DISABLE_NEEDS_LOW_EFFORT.test(model)) {
    body.thinking = { type: "disabled" };
  }

  if (mode && mode !== "disabled") {
    const canAdaptive = ANTHROPIC_ADAPTIVE.test(model);
    const canManual = !ANTHROPIC_NO_MANUAL.test(model);
    // Manual mode only where the API still accepts it AND the user asked for it
    // (or the model can't do adaptive, e.g. Haiku 4.5 / older Claude 4).
    const useManual = canManual && (mode === "enabled" || !canAdaptive);
    if (useManual) {
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

function applyAnthropicSampling(body: Record<string, unknown>, model: string, s?: SamplingParams) {
  if (!s || ANTHROPIC_NO_SAMPLING.test(model)) return;
  if (s.topP != null) body.top_p = s.topP;
  if (s.topK != null) body.top_k = s.topK;
  if (s.stopSequences && s.stopSequences.length) body.stop_sequences = s.stopSequences;
  // Anthropic has no frequency/presence penalty or seed.
}

export async function listModels(apiBaseUrl: string, apiKey: string, anthropic?: boolean): Promise<ModelInfo[]> {
  const useAnthropic = anthropic ?? isAnthropic(apiBaseUrl);
  if (useAnthropic && !apiKey) {
    throw new Error("API Key not set");
  }
  const headers: Record<string, string> = useAnthropic
    ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
    : apiKey
    ? { authorization: `Bearer ${apiKey}` }
    : {};
  const r = await fetch(`${apiBaseUrl}/models`, { headers });
  if (!r.ok) {
    throw new Error(`models ${r.status}: ${await r.text()}`);
  }
  const d = (await r.json()) as { data?: { id: string }[] };
  return (d.data ?? []).map((m) => ({ id: m.id })).sort((a, b) => a.id.localeCompare(b.id));
}

function isAnthropic(apiBaseUrl: string): boolean {
  return /anthropic\.com/i.test(apiBaseUrl);
}

/** Error carrying the HTTP status of a failed chat request (for retry decisions). */
export class ChatHTTPError extends Error {
  /** If set, the number of ms to wait before retrying (from X-RateLimit-Reset or Retry-After). */
  retryAfterMs?: number;
  constructor(public status: number, message: string, retryAfterMs?: number) {
    super(message);
    this.name = "ChatHTTPError";
    this.retryAfterMs = retryAfterMs;
  }
}

/** Transient if: no status (network/DNS/timeout), 408/425/429, or any 5xx. */
export function isRetryableError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") return false;
  if (e instanceof ChatHTTPError) {
    return e.status === 408 || e.status === 425 || e.status === 429 || e.status >= 500;
  }
  // fetch network failures (TypeError "Failed to fetch", ECONNRESET, etc.) are retryable.
  return true;
}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });

/**
 * Run a streaming request with retry. Each attempt re-invokes `make()` to get a
 * fresh response; partial output from a failed attempt is discarded so the agent
 * only sees clean output. Retries on transient errors with exponential backoff.
 * For 429 rate-limit errors, honours the retryAfterMs hint from the response.
 */
async function* streamWithRetry(
  make: () => AsyncGenerator<ProviderEvent>,
  signal: AbortSignal,
  onRetry?: (attempt: number, max: number, delayMs: number, error: string) => void,
  maxAttempts = 8,
): AsyncGenerator<ProviderEvent> {
  for (let attempt = 1; ; attempt++) {
    // Stream live. Retry is only safe before the first event is emitted — once we
    // start yielding deltas downstream, replaying a fresh attempt would duplicate
    // output, so a mid-stream failure is surfaced instead of retried.
    let emitted = false;
    try {
      for await (const ev of make()) {
        emitted = true;
        yield ev;
      }
      return;
    } catch (e) {
      if (signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
        throw e;
      }
      if (emitted || attempt >= maxAttempts || !isRetryableError(e)) {
        throw e;
      }
      // For 429, use the server-supplied reset window; otherwise exponential backoff.
      let delay: number;
      if (e instanceof ChatHTTPError && e.status === 429 && e.retryAfterMs && e.retryAfterMs > 0) {
        delay = Math.min(e.retryAfterMs + 500, 65000); // respect reset window + 500ms buffer
      } else {
        delay = Math.min(1000 * 2 ** (attempt - 1), 16000);
      }
      onRetry?.(attempt, maxAttempts, delay, e instanceof Error ? e.message : String(e));
      await sleep(delay, signal);
    }
  }
}

/** Drop Anthropic-only `cache_control` and empty text parts (xAI/Grok 400: Empty content block). */
function stripOpenAIParts(parts: WireContentPart[]): WireContentPart[] {
  const out: WireContentPart[] = [];
  for (const p of parts) {
    if (p.type === "text") {
      if (!p.text) continue;
      out.push({ type: "text", text: p.text });
    } else {
      out.push({ type: "image_url", image_url: p.image_url });
    }
  }
  return out;
}

function openAIContent(content: string | WireContentPart[] | null | undefined): string | WireContentPart[] {
  if (content == null) return "";
  if (typeof content === "string") return content;
  const parts = stripOpenAIParts(content);
  if (!parts.length) return "";
  if (parts.length === 1 && parts[0].type === "text") return parts[0].text;
  return parts;
}

/**
 * OpenAI chat shape: string tool content, no Anthropic cache_control, no null/empty
 * content blocks. xAI/Grok rejects those with `Empty content block`.
 * Tool images → tool text + trailing user image message.
 * Returns plain objects (not only WireMessage) so tool-only assistant can omit `content`.
 */
function normalizeOpenAIMessages(messages: WireMessage[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      if (Array.isArray(m.content)) {
        const texts = m.content.filter((p): p is Extract<WireContentPart, { type: "text" }> => p.type === "text");
        const images = m.content.filter((p): p is Extract<WireContentPart, { type: "image_url" }> => p.type === "image_url");
        out.push({
          role: "tool",
          tool_call_id: m.tool_call_id,
          content: texts.map((t) => t.text).join("\n") || (images.length ? "(image)" : "(empty)"),
        });
        if (images.length) {
          out.push({ role: "user", content: stripOpenAIParts(images) });
        }
      } else {
        out.push({ role: "tool", tool_call_id: m.tool_call_id, content: m.content || "(empty)" });
      }
      continue;
    }
    if (m.role === "assistant") {
      const text = (typeof m.content === "string" ? m.content : "") || "";
      const msg: Record<string, unknown> = { role: "assistant" };
      // Never send null/empty content — Grok 400 "Empty content block".
      if (text) msg.content = text;
      else if (!m.tool_calls?.length) msg.content = "(empty)";
      if (m.tool_calls?.length) msg.tool_calls = m.tool_calls;
      out.push(msg);
      continue;
    }
    const content = openAIContent(m.content);
    if (content === "" || (Array.isArray(content) && content.length === 0)) {
      if (m.role === "system") continue;
      out.push({ role: "user", content: "(empty)" });
      continue;
    }
    out.push({ role: m.role, content });
  }
  return out;
}

/** Generate a short conversation title from the first user message using the model. */
export async function generateTitle(apiBaseUrl: string, apiKey: string, model: string, userText: string, anthropic?: boolean, oauthKind?: OAuthKind): Promise<string> {
  const sys = "Generate a concise 3-6 word title for a chat that starts with the user's message. The title must summarize the topic, not repeat the message.";
  const prompt = userText.slice(0, 2000);
  if (oauthKind) {
    // OAuth providers have no raw HTTP endpoint here; stream a tiny completion.
    let text = "";
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const gen = streamOAuthChat(oauthKind, {
        model,
        messages: [{ role: "system", content: sys }, { role: "user", content: prompt }],
        maxTokens: 200,
        signal: ctrl.signal,
      });
      for await (const ev of gen) {
        if (ev.type === "text-delta") text += ev.text;
      }
    } finally {
      clearTimeout(timer);
    }
    return cleanTitle(parseTitle(text) || text);
  }
  if (anthropic ?? isAnthropic(apiBaseUrl)) {
    // Force a tool call so the model returns a structured { title } object.
    const r = await fetch(`${apiBaseUrl}/messages`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        system: sys,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
        stream: false,
        tools: [{ name: "set_title", description: "Set the chat title.", input_schema: { type: "object", properties: { title: { type: "string", description: "3-6 word title" } }, required: ["title"] } }],
        tool_choice: { type: "tool", name: "set_title" },
      }),
    });
    if (!r.ok) throw new Error(`title ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
    const d: any = parseMaybeSSE(await r.text());
    const use = (d?.content ?? []).find((b: any) => b?.type === "tool_use");
    return cleanTitle(use?.input?.title ?? "");
  }
  const msgs = [{ role: "system", content: sys }, { role: "user", content: prompt }];
  const call = async (body: Record<string, unknown>) => {
    const r = await fetch(`${apiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ ...body, stream: false }),
    });
    if (!r.ok) throw new Error(`title ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
    const raw = await r.text();
    const d = parseMaybeSSE(raw);
    return d?.choices?.[0]?.message?.content ?? d?.choices?.[0]?.delta?.content ?? "";
  };
  // Prefer structured output; many OpenAI-compatible/local servers reject
  // `response_format`, so fall back to a plain text request on any failure.
  try {
    const content = await call({
      model,
      messages: msgs,
      max_tokens: 200,
      temperature: 0.3,
      response_format: {
        type: "json_schema",
        json_schema: { name: "chat_title", strict: true, schema: { type: "object", properties: { title: { type: "string", description: "3-6 word title" } }, required: ["title"], additionalProperties: false } },
      },
    });
    const t = parseTitle(content);
    if (t) return cleanTitle(t);
  } catch {
    // fall through to plain text
  }
  const content = await call({ model, messages: msgs, max_tokens: 200, temperature: 0.3 });
  return cleanTitle(parseTitle(content) || content);
}

/** Parse a response body that is either plain JSON or an SSE stream of `data:` chunks. */
function parseMaybeSSE(raw: string): any {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("data:")) {
    return JSON.parse(trimmed);
  }
  // SSE: concatenate delta content from each chunk, or use the last full message.
  let content = "";
  let last: any;
  for (const line of trimmed.split("\n")) {
    const m = line.trim();
    if (!m.startsWith("data:")) continue;
    const payload = m.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const c = JSON.parse(payload);
      last = c;
      const delta = c?.choices?.[0]?.delta?.content;
      if (delta) content += delta;
    } catch {
      /* skip */
    }
  }
  if (content) return { choices: [{ message: { content } }] };
  return last ?? {};
}

/** Extract a title from a model response that may be JSON, fenced JSON, or plain text. */
function parseTitle(content: string): string {
  const s = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const json = s.replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    const v = JSON.parse(json)?.title;
    if (typeof v === "string" && v.trim()) return v;
  } catch {
    /* not JSON */
  }
  return "";
}

/** Auto mode judge: pick the best-suited model id from candidates for a task. */
export async function pickModel(apiBaseUrl: string, apiKey: string, judge: string, candidates: string[], task: string, anthropic?: boolean, oauthKind?: OAuthKind): Promise<string> {
  const useAnthropic = anthropic ?? isAnthropic(apiBaseUrl);
  const sys = `You route a coding task to the best model. Available models: ${candidates.join(", ")}. Reply with EXACTLY one model id from the list, nothing else.`;
  const prompt = task.slice(0, 2000);
  if (oauthKind) {
    // OAuth judges (Claude Code / Codex) have no raw HTTP endpoint; stream a tiny completion.
    let text = "";
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const gen = streamOAuthChat(oauthKind, {
        model: judge,
        messages: [{ role: "system", content: sys }, { role: "user", content: prompt }],
        maxTokens: 64,
        signal: ctrl.signal,
      });
      for await (const ev of gen) {
        if (ev.type === "text-delta") text += ev.text;
      }
    } finally {
      clearTimeout(timer);
    }
    // Reasoning models may emit <think> blocks; last non-empty line is the answer.
    const lines = text.replace(/<think>[\s\S]*?<\/think>/gi, "").split("\n").map((l) => l.trim()).filter(Boolean);
    return lines.length ? lines[lines.length - 1] : text.trim();
  }
  if (useAnthropic) {
    const r = await fetch(`${apiBaseUrl}/messages`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: judge, system: sys, messages: [{ role: "user", content: prompt }], max_tokens: 24 }),
    });
    if (!r.ok) throw new Error(`judge ${r.status}`);
    const d: any = await r.json();
    return String(d?.content?.[0]?.text ?? "").trim();
  }
  const r = await fetch(`${apiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: { ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}), "content-type": "application/json" },
    body: JSON.stringify({ model: judge, messages: [{ role: "system", content: sys }, { role: "user", content: prompt }], max_tokens: 24, temperature: 0 }),
  });
  if (!r.ok) throw new Error(`judge ${r.status}`);
  const d: any = await r.json();
  return String(d?.choices?.[0]?.message?.content ?? "").trim();
}

function cleanTitle(s: string): string {
  // Reasoning models emit <think>…</think> before the answer; drop it.
  const stripped = s.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<\/?think>/gi, "");
  // Take the last non-empty line (the title), in case of leftover preamble.
  const lines = stripped.split("\n").map((l) => l.trim()).filter(Boolean);
  const last = lines.length ? lines[lines.length - 1] : stripped;
  const t = last.trim().replace(/^["'#\s-]+|["'\s]+$/g, "").replace(/\s+/g, " ");
  return t.length > 50 ? t.slice(0, 50) + "…" : t;
}

/** Public entry: streams a chat completion with transient-error retry. */
export function streamChat(opts: StreamChatOpts): AsyncGenerator<ProviderEvent> {
  if (opts.oauthKind) {
    const make = () => streamOAuthChat(opts.oauthKind!, { model: opts.model, messages: opts.messages, tools: opts.tools, maxTokens: opts.maxTokens, modelParams: opts.modelParams, signal: opts.signal });
    return streamWithRetry(make, opts.signal, opts.onRetry, opts.maxRetries ?? 8);
  }
  const useAnthropic = opts.anthropic ?? isAnthropic(opts.apiBaseUrl);
  if (useAnthropic && !opts.apiKey) {
    throw new Error("API Key not set");
  }
  const make = () => (useAnthropic ? streamAnthropic(opts) : streamOpenAI(opts));
  return streamWithRetry(make, opts.signal, opts.onRetry, opts.maxRetries ?? 8);
}

async function* streamOpenAI(opts: StreamChatOpts): AsyncGenerator<ProviderEvent> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: normalizeOpenAIMessages(opts.messages),
    stream: true,
  };
  // Only send temperature when explicitly requested (title gen etc.);
  // otherwise let the provider use its own default.
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.maxTokens && opts.maxTokens > 0) {
    body.max_tokens = opts.maxTokens;
  }
  // Reasoning models: pass reasoning_effort (ignored by non-reasoning models/servers).
  if (opts.modelParams?.reasoningEffort) {
    body.reasoning_effort = opts.modelParams.reasoningEffort;
  }
  applyOpenAISampling(body, opts.sampling);
  if (opts.tools?.length) {
    body.tools = opts.tools;
    body.tool_choice = "auto";
  }

  const r = await fetch(`${opts.apiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!r.ok || !r.body) {
    const detail = await r.text().catch(() => "");
    // Parse OpenRouter / standard rate-limit reset time so the retry can wait exactly right.
    let retryAfterMs: number | undefined;
    if (r.status === 429) {
      const resetHeader = r.headers.get("X-RateLimit-Reset") || r.headers.get("x-ratelimit-reset");
      if (resetHeader) {
        const resetTs = Number(resetHeader);
        if (!isNaN(resetTs)) {
          // If it looks like an epoch ms value (> 1e12) use it directly, else treat as seconds.
          const resetEpochMs = resetTs > 1e12 ? resetTs : resetTs * 1000;
          retryAfterMs = Math.max(0, resetEpochMs - Date.now());
        }
      }
      if (!retryAfterMs) {
        // Fallback: parse from JSON body (OpenRouter embeds it)
        try {
          const parsed = JSON.parse(detail);
          const resetTs = Number(parsed?.error?.metadata?.headers?.["X-RateLimit-Reset"]);
          if (!isNaN(resetTs) && resetTs > 0) {
            const resetEpochMs = resetTs > 1e12 ? resetTs : resetTs * 1000;
            retryAfterMs = Math.max(0, resetEpochMs - Date.now());
          }
        } catch { /* not JSON */ }
      }
      if (!retryAfterMs) retryAfterMs = 61000; // safe default: wait ~1 min for free-tier reset
    }
    throw new ChatHTTPError(r.status, `chat ${r.status}: ${detail.slice(0, 500)}`, retryAfterMs);
  }

  const toolAcc: Record<number, { id: string; name: string; args: string }> = {};
  let finishReason = "stop";

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const data = t.slice(5).trim();
      if (data === "[DONE]") continue;
      let chunk: any;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }

      if (chunk.usage) {
        yield { type: "usage", promptTokens: chunk.usage.prompt_tokens, completionTokens: chunk.usage.completion_tokens };
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};

      const reasoning = delta.reasoning_content ?? delta.reasoning;
      if (reasoning) yield { type: "thinking-delta", text: reasoning };

      if (delta.content) yield { type: "text-delta", text: delta.content };

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const acc = (toolAcc[idx] ??= { id: "", name: "", args: "" });
          if (tc.id) acc.id = tc.id;
          const hadName = !!acc.name;
          if (tc.function?.name) acc.name = tc.function.name;
          // Announce the call as soon as its name is known so the UI can render
          // its card immediately instead of waiting for the full stream.
          if (!hadName && acc.name) yield { type: "tool-call-start", index: idx, id: acc.id || `call_${idx}`, name: acc.name };
          if (tc.function?.arguments) {
            acc.args += tc.function.arguments;
            yield { type: "tool-call-args-delta", index: idx, delta: tc.function.arguments };
          }
        }
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
  }

  for (const idx of Object.keys(toolAcc).map(Number).sort((a, b) => a - b)) {
    const a = toolAcc[idx];
    if (!a.name) continue;
    // Some providers prefix tool names (e.g. "default_api:read_file" or "functions.read_file"); normalize.
    const normalizedName = a.name.split(/[:.]/).pop() || a.name;
    const call: ToolCall = { id: a.id || `call_${idx}`, name: normalizedName, arguments: a.args || "{}" };
    yield { type: "tool-call", call };
  }
  yield { type: "done", finishReason };
}

// ---- Anthropic Messages API ----

interface AnthropicBlock {
  type: "text" | "tool_use" | "tool_result" | "image";
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | AnthropicBlock[];
  source?: { type: "base64"; media_type: string; data: string };
  cache_control?: { type: "ephemeral" };
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicBlock[];
}

function systemToBlocks(content: string | WireContentPart[]): AnthropicBlock[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return content
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => ({ type: "text", text: p.text, ...(p.cache_control ? { cache_control: p.cache_control } : {}) }));
}

function toAnthropic(messages: WireMessage[]): { system: AnthropicBlock[]; messages: AnthropicMessage[] } {
  const system: AnthropicBlock[] = [];
  const out: AnthropicMessage[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      system.push(...systemToBlocks(m.content));
    } else if (m.role === "user") {
      if (typeof m.content === "string") {
        out.push({ role: "user", content: m.content });
      } else {
        const blocks: AnthropicBlock[] = [];
        for (const part of m.content) {
          if (part.type === "text") {
            blocks.push({ type: "text", text: part.text, ...(part.cache_control ? { cache_control: part.cache_control } : {}) });
          } else if (part.type === "image_url") {
            const url = part.image_url.url;
            const match = url.match(/^data:([^;]+);base64,(.*)$/);
            if (match) {
              blocks.push({ type: "image", source: { type: "base64", media_type: match[1], data: match[2] } });
            }
          }
        }
        out.push({ role: "user", content: blocks });
      }
    } else if (m.role === "assistant") {
      const blocks: AnthropicBlock[] = [];
      if (m.content) {
        blocks.push({ type: "text", text: m.content });
      }
      if (m.tool_calls) {
        for (const tc of m.tool_calls) {
          let input: unknown = {};
          try {
            input = JSON.parse(tc.function.arguments || "{}");
          } catch {
            // leave as empty object
          }
          blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
        }
      }
      out.push({ role: "assistant", content: blocks.length ? blocks : "" });
    } else if (m.role === "tool") {
      // tool result -> a user message with a tool_result block; merge consecutive.
      // Array content (text + image) becomes a tool_result with nested blocks.
      let content: string | AnthropicBlock[];
      if (Array.isArray(m.content)) {
        const nested: AnthropicBlock[] = [];
        for (const part of m.content) {
          if (part.type === "text") {
            nested.push({ type: "text", text: part.text });
          } else if (part.type === "image_url") {
            const match = part.image_url.url.match(/^data:([^;]+);base64,(.*)$/);
            if (match) nested.push({ type: "image", source: { type: "base64", media_type: match[1], data: match[2] } });
          }
        }
        content = nested;
      } else {
        content = m.content;
      }
      const block: AnthropicBlock = { type: "tool_result", tool_use_id: m.tool_call_id, content };
      const last = out[out.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
    }
  }
  return { system, messages: out };
}

async function* streamAnthropic(opts: {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  messages: WireMessage[];
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
  sampling?: SamplingParams;
  modelParams?: ModelParams;
  signal: AbortSignal;
}): AsyncGenerator<ProviderEvent> {
  const { system, messages } = toAnthropic(opts.messages);

  const maxTokens = opts.maxTokens && opts.maxTokens > 0
    ? opts.maxTokens
    : defaultAnthropicMaxTokens(opts.model, opts.modelParams?.reasoningEffort);
  const body: Record<string, unknown> = {
    model: opts.model,
    system,
    messages,
    stream: true,
    max_tokens: maxTokens,
  };
  // `temperature` is deprecated/rejected by some newer Claude models (opus-4.x),
  // so we don't send it for Anthropic — it applies its own default. Thinking is
  // the one case that needs an explicit temperature (=1).
  const reasoningBetas = applyAnthropicReasoning(body, opts.model, maxTokens, opts.modelParams);
  applyAnthropicSampling(body, opts.model, opts.sampling);
  if (opts.tools?.length) {
    body.tools = opts.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
  }

  // 1M context is native on Opus 5 / Fable 5 / Sonnet 5 / 4.6+; beta is only
  // needed for older models that still gate long context behind it.
  const betas: string[] = [...reasoningBetas];
  if (opts.modelParams?.maxContext === "1m" && needsContext1mBeta(opts.model)) {
    betas.push("context-1m-2025-08-07");
  }
  const r = await fetch(`${opts.apiBaseUrl}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      ...(betas.length ? { "anthropic-beta": betas.join(",") } : {}),
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!r.ok || !r.body) {
    const detail = await r.text().catch(() => "");
    throw new ChatHTTPError(r.status, `anthropic ${r.status}: ${detail.slice(0, 500)}`);
  }

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let finishReason = "stop";

  const toolBlocks: Record<number, { id: string; name: string; args: string }> = {};

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const data = t.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let chunk: any;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }

      // In-band error frames arrive on a 200 response (overloaded, invalid
      // model, mid-stream rejection). Surface them instead of ending empty.
      if (chunk.type === "error") {
        const e = chunk.error ?? {};
        throw new ChatHTTPError(502, `anthropic stream error: ${e.type ?? "error"} — ${e.message ?? data.slice(0, 300)}`);
      }
      if (chunk.type === "content_block_start") {
        const cb = chunk.content_block;
        if (cb?.type === "tool_use") {
          toolBlocks[chunk.index] = { id: cb.id, name: cb.name, args: "" };
          yield { type: "tool-call-start", index: chunk.index, id: cb.id || `call_${chunk.index}`, name: cb.name };
        }
      } else if (chunk.type === "content_block_delta") {
        const d = chunk.delta;
        if (d?.type === "text_delta") {
          yield { type: "text-delta", text: d.text };
        } else if (d?.type === "thinking_delta") {
          yield { type: "thinking-delta", text: d.thinking ?? d.text ?? "" };
        } else if (d?.type === "input_json_delta") {
          const tb = toolBlocks[chunk.index];
          if (tb) {
            tb.args += d.partial_json ?? "";
            yield { type: "tool-call-args-delta", index: chunk.index, delta: d.partial_json ?? "" };
          }
        }
      } else if (chunk.type === "message_delta") {
        if (chunk.delta?.stop_reason) finishReason = chunk.delta.stop_reason;
        if (chunk.usage) {
          yield { type: "usage", promptTokens: chunk.usage.input_tokens, completionTokens: chunk.usage.output_tokens };
        }
      } else if (chunk.type === "message_start" && chunk.message?.usage) {
        yield { type: "usage", promptTokens: chunk.message.usage.input_tokens, completionTokens: chunk.message.usage.output_tokens };
      }
    }
  }

  for (const idx of Object.keys(toolBlocks).map(Number).sort((a, b) => a - b)) {
    const a = toolBlocks[idx];
    if (!a.name) continue;
    yield { type: "tool-call", call: { id: a.id || `call_${idx}`, name: a.name, arguments: a.args || "{}" } };
  }
  if (finishReason === "refusal") {
    throw new ChatHTTPError(400, "Model refused the request (safety classifier). Try Opus 5 or another model, or rephrase.");
  }
  yield { type: "done", finishReason };
}
