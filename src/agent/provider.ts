/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { ChatReasoning, ProviderEvent, ToolCall, ToolSchema, WireMessage, WireContentPart } from "./types";
import { streamOAuthChat, type OAuthKind } from "./oauth";
import type { ModelInfo, ModelParams, SamplingParams, StreamChatOpts } from "./provider/types";
import { MODEL_CATALOG } from "../stores/featureStore";
import { defaultAnthropicMaxTokens } from "./providerLimits";
import { applyAnthropicReasoning, needsContext1mBeta } from "./provider/anthropicReasoning";
import { applyAnthropicSpeed } from "./provider/anthropicSpeed";
import { applyChatSpeed } from "../shared/modelSpeed";
import { AnthropicUsageTracker } from "./anthropicUsage";
import { toAnthropic } from "./provider/anthropicMessages";
import { sseData } from "./provider/sse";
import { withStreamDeadline, fetchWithConnectionTimeout } from "./provider/deadlines";
import { UsageTracker } from "./provider/usage";
import { applyGoogleOpenAIOptions, googleThoughtSignature, googleToolCall, isGoogleOpenAIEndpoint, prepareGoogleMessages } from "./provider/google";
import { createOpenAIResponsesRequest, OpenAIResponsesError, parseOpenAIResponses, shouldUseOpenAIResponses } from "./provider/openaiResponses";
import { applyOpenAIChatOptions } from "./provider/openaiChat";
import { applyCompatibleOptions, compatibleProviderFor } from "./provider/compatibleOptions";
import { randomUUID } from "crypto";
import type { ApiKeyPool } from "./provider/apiKeyPool";
import { PROVIDER_PRESETS, type ProviderKind } from "../shared/providerCatalog";
import { PROVIDER_MODELS } from "../shared/providerModels";

export type { ModelInfo, ModelParams, SamplingParams, StreamChatOpts } from "./provider/types";
export { defaultAnthropicMaxTokens } from "./providerLimits";

/** Strip trailing slashes from a base URL to avoid double-slash in constructed paths. */
function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function safeProviderDetail(text: string, apiKey: string, limit = 500): string {
  return (apiKey ? text.split(apiKey).join("[redacted]") : text).slice(0, limit);
}

function providerErrorStatus(error: { status?: unknown; code?: unknown; type?: unknown }): number {
  const status = Number(error.status ?? error.code);
  if (Number.isInteger(status) && status >= 400 && status <= 599) return status;
  const type = String(error.type ?? error.code ?? "").toLowerCase();
  if (/invalid_request|bad_request|invalid_argument|context_length|unsupported/.test(type)) return 400;
  if (/authentication|invalid_api_key|unauthorized/.test(type)) return 401;
  if (/permission|forbidden/.test(type)) return 403;
  if (/not_found|model_not_found/.test(type)) return 404;
  if (/rate_limit|quota|resource_exhausted/.test(type)) return 429;
  return 502;
}

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

export { applyAnthropicReasoning, needsContext1mBeta } from "./provider/anthropicReasoning";

/** Models that reject temperature / top_p / top_k with a 400. */
const ANTHROPIC_NO_SAMPLING = /claude-(opus-4-[678]|opus-5|sonnet-4-6|sonnet-5|fable-5|mythos)/i;
const ANTHROPIC_DEFAULT_THINKING = /claude-(opus-5|sonnet-5|fable-5|mythos)/i;

function applyAnthropicSampling(body: Record<string, unknown>, model: string, s?: SamplingParams) {
  if (!s || ANTHROPIC_NO_SAMPLING.test(model)) return;
  if (s.topP != null) body.top_p = s.topP;
  if (s.topK != null) body.top_k = s.topK;
  if (s.stopSequences && s.stopSequences.length) body.stop_sequences = s.stopSequences;
  // Anthropic has no frequency/presence penalty or seed.
}

function adapterForPool(pool?: ApiKeyPool, model?: string): string | undefined {
  if (!pool?.providerId.startsWith("popular:")) return undefined;
  const kind = pool.providerId.slice("popular:".length);
  const preset = Object.prototype.hasOwnProperty.call(PROVIDER_PRESETS, kind) ? PROVIDER_PRESETS[kind as ProviderKind] : undefined;
  const alias = model && PROVIDER_MODELS.find(item => item.kind === kind && item.id === model);
  return preset?.protocol === "adapter" || alias && (alias.upstreamModelId || alias.targetFormat)
    ? preset?.adapterId : undefined;
}

export async function listModels(apiBaseUrl: string, apiKey: string, anthropic?: boolean, options?: { apiKeyPool?: ApiKeyPool; signal?: AbortSignal; providerAdapterId?: string; onVerification?: (verified: boolean) => void }): Promise<ModelInfo[]> {
  if (options?.apiKeyPool) {
    const signal = options.signal ?? AbortSignal.timeout(30_000);
    return options.apiKeyPool.request(credential => listModels(apiBaseUrl, credential.apiKey, anthropic, { ...options, apiKeyPool: undefined,
      providerAdapterId: adapterForPool(options.apiKeyPool), signal }), { apiBaseUrl, signal });
  }
  if (options?.providerAdapterId) {
    const { listProviderAdapterModels } = await import("./oauth/providerTransport.js");
    const result = await listProviderAdapterModels(options.providerAdapterId, { apiKey }, { baseUrl: apiBaseUrl, signal: options.signal ?? AbortSignal.timeout(30_000) });
    options.onVerification?.(result.verified);
    return result.models.map(id => ({ id }));
  }
  const useAnthropic = anthropic ?? isAnthropic(apiBaseUrl);
  if (useAnthropic && !apiKey) {
    throw new Error("API Key not set");
  }
  const headers: Record<string, string> = useAnthropic
    ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
    : apiKey
    ? { authorization: `Bearer ${apiKey}` }
    : {};
  const r = await fetchWithConnectionTimeout(`${normalizeBaseUrl(apiBaseUrl)}/models`, { headers, signal: options?.signal });
  if (!r.ok) {
    // Anthropic's official API does not expose a /models endpoint (404 expected).
    // MIMO (xiaomimimo.com) may also 404 on /models depending on the plan/region.
    // Fall back to the hardcoded catalog so these providers still work.
    if ([404, 405].includes(r.status) && (useAnthropic || /xiaomimimo\.com/i.test(apiBaseUrl))) {
      options?.onVerification?.(false);
      const kind = useAnthropic ? "anthropic" : "mimo";
      return MODEL_CATALOG
        .filter((m) => {
          const kinds = Array.isArray(m.kind) ? m.kind : [m.kind];
          return kinds.includes(kind);
        })
        .map((m) => ({ id: m.id }))
        .sort((a, b) => a.id.localeCompare(b.id));
    }
    throw new ChatHTTPError(r.status, `models ${r.status}: ${safeProviderDetail(await r.text(), apiKey)}`, retryAfterMs(r));
  }
  const d = (await r.json()) as { data?: { id: string }[] };
  return (d.data ?? []).map((m) => ({ id: m.id })).sort((a, b) => a.id.localeCompare(b.id));
}

function isAnthropic(apiBaseUrl: string): boolean {
  return /anthropic\.com/i.test(apiBaseUrl);
}

/** Error carrying the HTTP status of a failed chat request (for retry decisions). */
export class ChatHTTPError extends Error {
  constructor(public status: number, message: string, public retryAfterMs?: number) {
    super(message);
    this.name = "ChatHTTPError";
  }
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) ? Math.max(0, Math.min(300_000, delay)) : undefined;
}

/** Transient if: no status (network/DNS/timeout), 408/425/429/499, or any 5xx. */
export function isRetryableError(e: unknown): boolean {
  if ((e as { retryable?: boolean } | undefined)?.retryable === false) return false;
  if (e instanceof DOMException && e.name === "AbortError") return false;
  if (e instanceof ChatHTTPError) {
    return e.status === 408 || e.status === 425 || e.status === 429 || e.status === 499 || e.status >= 500;
  }
  // fetch network failures (TypeError "Failed to fetch", ECONNRESET, etc.) are retryable.
  return true;
}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const done = () => { signal?.removeEventListener("abort", abort); resolve(); };
    const t = setTimeout(done, ms);
    const abort = () => {
      clearTimeout(t);
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });

/**
 * Run a streaming request with retry. Each attempt re-invokes `make()` to get a
 * fresh response; partial output from a failed attempt is discarded so the agent
 * only sees clean output. Retries on transient errors with exponential backoff.
 */
async function* streamWithRetry(
  make: () => AsyncGenerator<ProviderEvent>,
  signal: AbortSignal,
  onRetry?: (attempt: number, max: number, delayMs: number, error: string) => void,
  maxAttempts = 5,
  model?: string,
): AsyncGenerator<ProviderEvent> {
  for (let attempt = 1; ; attempt++) {
    const requestId = randomUUID();
    // Stream live. Retry is only safe before the first event is emitted — once we
    // start yielding deltas downstream, replaying a fresh attempt would duplicate
    // output, so a mid-stream failure is surfaced instead of retried.
    let emitted = false;
    try {
      for await (const ev of make()) {
        if (ev.type !== "usage") emitted = true;
        yield ev.type === "usage" ? { ...ev, requestId: ev.requestId ?? requestId, model: ev.model ?? model } : ev;
      }
      return;
    } catch (e) {
      if (signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
        throw e;
      }
      if (emitted || attempt >= maxAttempts || !isRetryableError(e)) {
        throw e;
      }
      const delay = Math.min(1000 * 2 ** (attempt - 1), 30000);
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

/** Scope preserved Chat reasoning to the documented endpoint and model.
 * https://api-docs.deepseek.com/guides/thinking_mode/
 * https://platform.kimi.ai/docs/api/models-overview
 * https://docs.z.ai/guides/capabilities/thinking-mode
 * https://docs.qwencloud.com/api-reference/chat/openai-chat */
function chatReasoningIdentity(apiBaseUrl: string, model: string): Omit<ChatReasoning, "content"> | undefined {
  const provider = compatibleProviderFor(apiBaseUrl, model);
  if (provider !== "deepseek" && provider !== "moonshot" && provider !== "z-ai" && provider !== "qwen") return undefined;
  // The provider helper only accepts documented official endpoint/model pairs.
  // Preserve the exact API path so reasoning never crosses regions or routes.
  return { endpoint: new URL(normalizeBaseUrl(apiBaseUrl)).href.replace(/\/+$/, ""), model };
}

function matchingChatReasoning(message: Extract<WireMessage, { role: "assistant" }>, identity?: Omit<ChatReasoning, "content">): boolean {
  return !!identity && message.chatReasoning?.endpoint === identity.endpoint && message.chatReasoning.model === identity.model
    && typeof message.chatReasoning.content === "string";
}

/** DeepSeek thinking+tools rejects assistant turns without original reasoning,
 * including ordinary answers. Keep older observations as labeled history, not
 * forged assistant reasoning or outstanding calls that could run again.
 * https://api-docs.deepseek.com/guides/thinking_mode/#tool-calls */
function prepareReasoningHistory(messages: WireMessage[], identity: Omit<ChatReasoning, "content">): WireMessage[] {
  const calls = new Map<string, { name: string; historical: boolean }>();
  return messages.map((message): WireMessage => {
    if (message.role === "assistant") {
      const historical = !matchingChatReasoning(message, identity);
      for (const call of message.tool_calls ?? []) calls.set(call.id, { name: call.function.name, historical });
      if (!historical) return message;
      const observations = (message.tool_calls ?? []).map(call =>
        `[Previously executed tool ${call.function.name}, call ${call.id}]\nArguments: ${call.function.arguments}`);
      return { role: "user", content: ["[Historical assistant message; context from an earlier turn]", message.content, ...observations].filter(Boolean).join("\n\n") };
    }
    if (message.role === "tool" && calls.get(message.tool_call_id)?.historical !== false) {
      const header = `[Previous tool result ${calls.get(message.tool_call_id)?.name ?? "unknown"}, call ${message.tool_call_id}]`;
      return { role: "user", content: typeof message.content === "string" ? `${header}\n${message.content}`
        : [{ type: "text", text: header }, ...message.content] };
    }
    return message;
  });
}

/** OpenAI chat shape: plain tool content, no cache metadata or empty blocks.
 * Tool images become a trailing user message. Provider state is opt-in only. */
function normalizeOpenAIMessages(messages: WireMessage[], googleModel?: string, identity?: Omit<ChatReasoning, "content">, requireReasoning = false): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let toolImages: WireContentPart[] = [];
  const flushImages = () => {
    if (toolImages.length) out.push({ role: "user", content: stripOpenAIParts(toolImages) });
    toolImages = [];
  };
  const prepared = googleModel ? prepareGoogleMessages(messages, googleModel)
    : requireReasoning && identity ? prepareReasoningHistory(messages, identity) : messages;
  for (const m of prepared) {
    if (m.role !== "tool") flushImages();
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
          toolImages.push(...images);
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
      if (m.tool_calls?.length) msg.tool_calls = googleModel ? m.tool_calls.map(googleToolCall)
        : m.tool_calls.map(({ id, type, function: fn }) => ({ id, type, function: fn }));
      if (matchingChatReasoning(m, identity)) {
        msg.reasoning_content = m.chatReasoning!.content;
      }
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
  flushImages();
  return out;
}

export interface AuxiliaryRequestOptions {
  signal?: AbortSignal;
  apiKeyPool?: ApiKeyPool;
  onUsage?: (event: Extract<ProviderEvent, { type: "usage" }>) => void;
}

function auxiliarySignal(options?: AuxiliaryRequestOptions): AbortSignal {
  const deadline = AbortSignal.timeout(30_000);
  return options?.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
}

/** Internal calls need answer room when the model cannot turn thinking off. */
function compatibleAuxiliaryLimit(apiBaseUrl: string, model: string, fallback: number): number {
  const provider = compatibleProviderFor(apiBaseUrl, model);
  const alwaysThinking = provider === "xai" || provider === "z-ai"
    || (provider === "moonshot" && model !== "kimi-k2.6")
    || (provider === "minimax" && model !== "MiniMax-M3");
  return alwaysThinking ? 4096 : fallback;
}

/** Account a completed or rejected HTTP response before interpreting its answer. */
async function auxiliaryResponse(r: Response, model: string, anthropic: boolean, label: string, options?: AuxiliaryRequestOptions, apiKey = ""): Promise<any> {
  const text = await r.text();
  let data: any;
  try { data = parseMaybeSSE(text); } catch { /* preserve the HTTP error when the body is not JSON */ }
  const usage = anthropic
    ? new AnthropicUsageTracker().update(data?.usage)
    : new UsageTracker().update(data?.usage?.prompt_tokens, data?.usage?.completion_tokens, data?.usage?.prompt_tokens_details?.cached_tokens);
  if (usage) options?.onUsage?.({ ...usage, model, requestId: randomUUID() });
  if (!r.ok) throw new ChatHTTPError(r.status, `${label} ${r.status}: ${safeProviderDetail(text, apiKey, 200)}`, retryAfterMs(r));
  if (data?.error) throw new ChatHTTPError(providerErrorStatus(data.error), `${label}: ${safeProviderDetail(data.error.message || "provider returned an error", apiKey)}`);
  if (!data) throw new Error(`${label}: invalid provider response`);
  return data;
}

/** Generate a short conversation title from the first user message using the model. */
export async function generateTitle(apiBaseUrl: string, apiKey: string, model: string, userText: string, anthropic?: boolean, oauthKind?: OAuthKind, options?: AuxiliaryRequestOptions): Promise<string> {
  const signal = auxiliarySignal(options);
  signal.throwIfAborted();
  const sys = "Generate a concise 3-6 word title for a chat that starts with the user's message. The title must summarize the topic, not repeat the message.";
  const prompt = userText.slice(0, 2000);
  const responses = shouldUseOpenAIResponses({ apiBaseUrl, model, anthropic, oauthKind });
  const claude = oauthKind === "claude-code" || (!oauthKind && (anthropic ?? isAnthropic(apiBaseUrl)) && ANTHROPIC_DEFAULT_THINKING.test(model));
  const google = !oauthKind && isGoogleOpenAIEndpoint(apiBaseUrl) && /^gemini-/i.test(model);
  const reference = adapterForPool(options?.apiKeyPool, model);
  if (options?.apiKeyPool && !oauthKind && !responses && !claude && !google && !reference) {
    return options.apiKeyPool.request(credential => generateTitle(apiBaseUrl, credential.apiKey, model, userText, anthropic, undefined, { ...options, signal, apiKeyPool: undefined }), { apiBaseUrl, signal });
  }
  if (oauthKind || responses || claude || google || reference) {
    // Use the provider's transport, with room for required reasoning tokens.
    // Fable's always-on thinking rejects forced tool calls, including set_title.
    let text = "";
    const gen = streamChat({
      apiBaseUrl, apiKey, apiKeyPool: options?.apiKeyPool, anthropic, oauthKind, maxRetries: options?.apiKeyPool ? 5 : 1,
      model,
      messages: [{ role: "system", content: sys }, { role: "user", content: prompt }],
      maxTokens: responses || claude || google || reference ? 4096 : 200,
      ...(responses || claude || google ? { modelParams: { reasoningEffort: google ? "none" : "low", ...(claude ? { thinking: "disabled" } : {}) } } : {}),
      signal,
    });
    for await (const ev of gen) {
      if (ev.type === "text-delta") text += ev.text;
      if (ev.type === "usage") options?.onUsage?.(ev);
    }
    return cleanTitle(parseTitle(text) || text);
  }
  if (anthropic ?? isAnthropic(apiBaseUrl)) {
    // Force a tool call so the model returns a structured { title } object.
    const r = await fetchWithConnectionTimeout(`${normalizeBaseUrl(apiBaseUrl)}/messages`, {
      method: "POST",
      signal,
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
    const d = await auxiliaryResponse(r, model, true, "title", options, apiKey);
    const use = (d?.content ?? []).find((b: any) => b?.type === "tool_use");
    return cleanTitle(use?.input?.title ?? "");
  }
  const msgs = [{ role: "system", content: sys }, { role: "user", content: prompt }];
  const call = async (body: Record<string, unknown>) => {
    body.max_tokens = compatibleAuxiliaryLimit(apiBaseUrl, model, 200);
    applyOpenAIChatOptions(body, apiBaseUrl, model, { auxiliary: true });
    applyCompatibleOptions(body, apiBaseUrl, model, undefined, { auxiliary: true });
    if (isGoogleOpenAIEndpoint(apiBaseUrl)) applyGoogleOpenAIOptions(body, model);
    const r = await fetchWithConnectionTimeout(`${normalizeBaseUrl(apiBaseUrl)}/chat/completions`, {
      method: "POST",
      signal,
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ ...body, stream: false }),
    });
    const d = await auxiliaryResponse(r, model, false, "title", options, apiKey);
    return d?.choices?.[0]?.message?.content ?? d?.choices?.[0]?.delta?.content ?? "";
  };
  // Retry plain output only when the optional structured format is unsupported.
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
    if (content.trim() && !/^[\[{]/.test(content.trim())) return cleanTitle(content);
  } catch (error) {
    signal.throwIfAborted();
    if (!(error instanceof ChatHTTPError) || ![400, 422].includes(error.status) || !/response_format|json_schema|structured|schema/i.test(error.message)) throw error;
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
  let usage: any;
  for (const line of trimmed.split("\n")) {
    const m = line.trim();
    if (!m.startsWith("data:")) continue;
    const payload = m.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const c = JSON.parse(payload);
      last = c;
      if (c.usage) usage = c.usage;
      const delta = c?.choices?.[0]?.delta?.content;
      if (delta) content += delta;
    } catch {
      /* skip */
    }
  }
  if (content) return { choices: [{ message: { content } }], ...(usage ? { usage } : {}), ...(last?.error ? { error: last.error } : {}) };
  if (last && usage) last.usage = usage;
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
export async function pickModel(apiBaseUrl: string, apiKey: string, judge: string, candidates: string[], task: string, anthropic?: boolean, oauthKind?: OAuthKind, options?: AuxiliaryRequestOptions): Promise<string> {
  const signal = auxiliarySignal(options);
  signal.throwIfAborted();
  const useAnthropic = anthropic ?? isAnthropic(apiBaseUrl);
  const sys = `You route a coding task to the best model. Available models: ${candidates.join(", ")}. Reply with EXACTLY one model id from the list, nothing else.`;
  const prompt = task.slice(0, 2000);
  const responses = shouldUseOpenAIResponses({ apiBaseUrl, model: judge, anthropic, oauthKind });
  const claude = oauthKind === "claude-code" || (!oauthKind && useAnthropic && ANTHROPIC_DEFAULT_THINKING.test(judge));
  const google = !oauthKind && isGoogleOpenAIEndpoint(apiBaseUrl) && /^gemini-/i.test(judge);
  const reference = adapterForPool(options?.apiKeyPool, judge);
  if (options?.apiKeyPool && !oauthKind && !responses && !claude && !google && !reference) {
    return options.apiKeyPool.request(credential => pickModel(apiBaseUrl, credential.apiKey, judge, candidates, task, anthropic, undefined, { ...options, signal, apiKeyPool: undefined }), { apiBaseUrl, signal });
  }
  if (oauthKind || responses || claude || google || reference) {
    // Use the provider's transport, with room for required reasoning tokens.
    let text = "";
    const gen = streamChat({
      apiBaseUrl, apiKey, apiKeyPool: options?.apiKeyPool, anthropic, oauthKind, maxRetries: options?.apiKeyPool ? 5 : 1,
      model: judge,
      messages: [{ role: "system", content: sys }, { role: "user", content: prompt }],
      maxTokens: responses || claude || google || reference ? 4096 : 64,
      ...(responses || claude || google ? { modelParams: { reasoningEffort: google ? "none" : "low", ...(claude ? { thinking: "disabled" } : {}) } } : {}),
      signal,
    });
    for await (const ev of gen) {
      if (ev.type === "text-delta") text += ev.text;
      if (ev.type === "usage") options?.onUsage?.(ev);
    }
    return cleanModelSelection(text);
  }
  if (useAnthropic) {
    const r = await fetchWithConnectionTimeout(`${normalizeBaseUrl(apiBaseUrl)}/messages`, {
      method: "POST",
      signal,
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: judge, system: sys, messages: [{ role: "user", content: prompt }], max_tokens: 24 }),
    });
    const d = await auxiliaryResponse(r, judge, true, "judge", options, apiKey);
    return (d?.content ?? []).filter((block: any) => block?.type === "text").map((block: any) => block.text ?? "").join("").trim();
  }
  const body: Record<string, unknown> = { model: judge, messages: [{ role: "system", content: sys }, { role: "user", content: prompt }], max_tokens: 24, temperature: 0 };
  body.max_tokens = compatibleAuxiliaryLimit(apiBaseUrl, judge, 24);
  applyOpenAIChatOptions(body, apiBaseUrl, judge, { auxiliary: true });
  applyCompatibleOptions(body, apiBaseUrl, judge, undefined, { auxiliary: true });
  if (isGoogleOpenAIEndpoint(apiBaseUrl)) applyGoogleOpenAIOptions(body, judge);
  const r = await fetchWithConnectionTimeout(`${normalizeBaseUrl(apiBaseUrl)}/chat/completions`, {
    method: "POST",
    signal,
    headers: { ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await auxiliaryResponse(r, judge, false, "judge", options, apiKey);
  return cleanModelSelection(String(d?.choices?.[0]?.message?.content ?? ""));
}

/** Native MiniMax chat keeps reasoning in content. Route from the actual final
 * answer, using the same cleanup for streaming and non-streaming judges. */
function cleanModelSelection(text: string): string {
  const answer = text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim();
  const lines = answer.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.at(-1) ?? "";
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
  return withStreamDeadline(signal => streamChatWithRetry({ ...opts, signal }), opts.signal, opts.connectionTimeoutMs, opts.idleTimeoutMs);
}

function streamChatWithRetry(opts: StreamChatOpts): AsyncGenerator<ProviderEvent> {
  if (opts.oauthKind) {
    const make = () => streamOAuthChat(opts.oauthKind!, { model: opts.model, messages: opts.messages, tools: opts.tools, maxTokens: opts.maxTokens, modelParams: opts.modelParams, sampling: opts.sampling, temperature: opts.temperature, promptCacheKey: opts.promptCacheKey, signal: opts.signal });
    return streamWithRetry(make, opts.signal, opts.onRetry, opts.maxRetries ?? 3, opts.model);
  }
  if (opts.apiKeyPool) {
    return opts.apiKeyPool.stream(credential => streamChatWithRetry({ ...opts, apiKeyPool: undefined, apiKey: credential.apiKey,
      providerAdapterId: adapterForPool(opts.apiKeyPool, opts.model),
      maxRetries: credential.legacy ? opts.maxRetries ?? 10 : 1,
      onRetry: (attempt, max, delay, error) => opts.onRetry?.(attempt, max, delay, credential.apiKey ? error.split(credential.apiKey).join("[redacted]") : error),
    }), { apiBaseUrl: opts.apiBaseUrl, signal: opts.signal, maxAttempts: opts.maxRetries ?? 5, onRetry: opts.onRetry, visible: event => event.type !== "usage" });
  }
  if (opts.providerAdapterId) {
    const make = async function* () {
      const { streamProviderAdapter, ProviderTransportError } = await import("./oauth/providerTransport.js");
      try {
        yield* streamProviderAdapter({ ...opts, providerId: opts.providerAdapterId!, baseUrl: opts.apiBaseUrl, credentials: { apiKey: opts.apiKey } });
      } catch (error) {
        if (error instanceof ProviderTransportError) {
          const mapped = new ChatHTTPError(error.status, safeProviderDetail(error.message, opts.apiKey), (error as { retryAfterMs?: number }).retryAfterMs);
          if ((error as { retryable?: boolean }).retryable === false) Object.assign(mapped, { retryable: false });
          throw mapped;
        }
        throw error;
      }
    };
    return streamWithRetry(make, opts.signal, opts.onRetry, opts.maxRetries ?? 3, opts.model);
  }
  const useAnthropic = opts.anthropic ?? isAnthropic(opts.apiBaseUrl);
  if (useAnthropic && !opts.apiKey) {
    throw new Error("API Key not set");
  }
  const make = () => (useAnthropic ? streamAnthropic(opts) : shouldUseOpenAIResponses(opts) ? streamResponses(opts) : streamOpenAI(opts));
  return streamWithRetry(make, opts.signal, opts.onRetry, opts.maxRetries ?? 10, opts.model);
}

async function* streamResponses(opts: StreamChatOpts): AsyncGenerator<ProviderEvent> {
  try {
    const { url, init } = createOpenAIResponsesRequest(opts);
    const response = await fetchWithConnectionTimeout(url, init);
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new ChatHTTPError(response.status, `OpenAI Responses ${response.status}: ${safeProviderDetail(detail, opts.apiKey)}`, retryAfterMs(response));
    }
    yield* parseOpenAIResponses(response, opts.signal, opts.model, opts.apiKey);
  } catch (error) {
    if (error instanceof OpenAIResponsesError) throw new ChatHTTPError(error.status, error.message);
    throw error;
  }
}

const withoutStreamUsage = new Set<string>();

async function* streamOpenAI(opts: StreamChatOpts): AsyncGenerator<ProviderEvent> {
  const baseUrl = normalizeBaseUrl(opts.apiBaseUrl);
  const google = isGoogleOpenAIEndpoint(baseUrl);
  const reasoningIdentity = chatReasoningIdentity(opts.apiBaseUrl, opts.model);
  const body: Record<string, unknown> = {
    model: opts.model,
    stream: true,
    ...(!withoutStreamUsage.has(baseUrl) ? { stream_options: { include_usage: true } } : {}),
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
  applyOpenAIChatOptions(body, opts.apiBaseUrl, opts.model);
  if (google) applyGoogleOpenAIOptions(body, opts.model, opts.modelParams);
  if (opts.tools?.length) {
    body.tools = opts.tools;
    body.tool_choice = "auto";
  }

  applyCompatibleOptions(body, opts.apiBaseUrl, opts.model, opts.modelParams);
  if (!google) applyChatSpeed(body, opts.model, opts.modelParams?.speed);
  const requireReasoning = compatibleProviderFor(opts.apiBaseUrl, opts.model) === "deepseek"
    && !!opts.tools?.length && (body.thinking as { type?: string } | undefined)?.type === "enabled";
  body.messages = normalizeOpenAIMessages(opts.messages, google ? opts.model : undefined, reasoningIdentity, requireReasoning);

  const request = () => fetchWithConnectionTimeout(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  let r = await request();
  if (body.stream_options && (r.status === 400 || r.status === 422)) {
    const detail = await r.clone().text();
    // Retry only a provider's explicit rejection of the optional usage field.
    // Do not replay requests rejected for model, credentials or context limits.
    if (/stream_options|include_usage/i.test(detail) && /unsupported|unknown|unrecognized|not (?:allowed|supported|permitted)|extra|unexpected/i.test(detail)) {
      await r.body?.cancel();
      delete body.stream_options;
      withoutStreamUsage.add(baseUrl);
      r = await request();
    }
  }
  if (!r.ok || !r.body) {
    const detail = await r.text().catch(() => "");
    // Strip HTML wrappers from providers (e.g. openresty) that embed errors in <html> tags.
    const clean = detail.replace(/<html[\s\S]*<\/html>/gi, "").trim() || detail;
    const hint = r.status === 404 && /xiaomimimo\.com/i.test(opts.apiBaseUrl)
      ? " (MIMO: verify your Base URL and API Key at https://platform.xiaomimimo.com)"
      : "";
    throw new ChatHTTPError(r.status, `chat ${r.status}${hint}: ${safeProviderDetail(clean, opts.apiKey)}`, retryAfterMs(r));
  }

  const toolAcc: Record<number, { id: string; name: string; args: string; thoughtSignature?: string }> = {};
  let finishReason = "stop";
  let finished = false;
  let reasoningContent: string | undefined;
  const usage = new UsageTracker();

  const reader = r.body.getReader();

  for await (const data of sseData(reader)) {
      if (data === "[DONE]") { finished = true; break; }
      let chunk: any;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }

      if (chunk.usage) {
        const event = usage.update(chunk.usage.prompt_tokens, chunk.usage.completion_tokens, chunk.usage.prompt_tokens_details?.cached_tokens);
        if (event) yield event;
      }
      if (chunk.error) throw new ChatHTTPError(providerErrorStatus(chunk.error), `chat stream error: ${safeProviderDetail(chunk.error.message ?? JSON.stringify(chunk.error), opts.apiKey)}`);
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};

      const reasoning = delta.reasoning_content ?? delta.reasoning;
      if (typeof reasoning === "string" && reasoning) yield { type: "thinking-delta", text: reasoning };
      // Capture only the documented wire field. Never synthesize replay state
      // from visible thoughts, plain text, or another provider's reasoning key.
      if (reasoningIdentity && typeof delta.reasoning_content === "string") {
        reasoningContent = (reasoningContent ?? "") + delta.reasoning_content;
      }

      if (delta.content) yield { type: "text-delta", text: delta.content };

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const acc = (toolAcc[idx] ??= { id: "", name: "", args: "" });
          const signature = google ? googleThoughtSignature(tc) : undefined;
          if (signature) acc.thoughtSignature = signature;
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
      if (choice.finish_reason) {
        finishReason = choice.finish_reason;
        finished = true;
        if (finishReason === "error" || finishReason === "content_filter") throw new ChatHTTPError(400, `chat stream ended with ${finishReason}`);
      }
  }

  if (!finished) throw new ChatHTTPError(502, "chat stream ended before completion");
  if (reasoningIdentity && reasoningContent !== undefined) {
    yield { type: "chat-reasoning", reasoning: { ...reasoningIdentity, content: reasoningContent } };
  }
  for (const idx of Object.keys(toolAcc).map(Number).sort((a, b) => a - b)) {
    const a = toolAcc[idx];
    if (!a.name) continue;
    // Some providers prefix tool names (e.g. "default_api:read_file" or "functions.read_file"); normalize.
    const normalizedName = a.name.split(/[:.]/).pop() || a.name;
    const call: ToolCall = { id: a.id || `call_${idx}`, name: normalizedName, arguments: a.args || "{}",
      ...(a.thoughtSignature ? { thoughtSignature: a.thoughtSignature } : {}) };
    yield { type: "tool-call", call };
  }
  yield { type: "done", finishReason };
}

// ---- Anthropic Messages API ----

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

  // Current 1M models use that window natively; the legacy beta is retired.
  const betas: string[] = [...reasoningBetas, ...applyAnthropicSpeed(body, opts.model, opts.modelParams?.speed)];
  if (opts.modelParams?.maxContext === "1m" && needsContext1mBeta(opts.model)) {
    betas.push("context-1m-2025-08-07");
  }
  const r = await fetchWithConnectionTimeout(`${normalizeBaseUrl(opts.apiBaseUrl)}/messages`, {
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
    throw new ChatHTTPError(r.status, `anthropic ${r.status}: ${safeProviderDetail(detail, opts.apiKey)}`, retryAfterMs(r));
  }

  const reader = r.body.getReader();
  let finishReason = "stop";
  let finished = false;
  const usageTracker = new AnthropicUsageTracker();

  const toolBlocks: Record<number, { id: string; name: string; args: string }> = {};

  for await (const data of sseData(reader)) {
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
        throw new ChatHTTPError(providerErrorStatus(e), `anthropic stream error: ${e.type ?? "error"} — ${safeProviderDetail(e.message ?? data, opts.apiKey)}`);
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
        if (chunk.delta?.stop_reason) { finishReason = chunk.delta.stop_reason; finished = true; }
        const usage = usageTracker.update(chunk.usage);
        if (usage) yield usage;
      } else if (chunk.type === "message_stop") {
        finished = true;
      } else if (chunk.type === "message_start" && chunk.message?.usage) {
        const usage = usageTracker.update(chunk.message.usage);
        if (usage) yield usage;
      }
  }

  if (!finished) throw new ChatHTTPError(502, "anthropic stream ended before completion");
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
