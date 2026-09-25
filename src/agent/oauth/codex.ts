/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { createHash, randomUUID } from "crypto";
import type { ProviderEvent, ResponsesReasoning, ToolSchema, WireMessage } from "../types";
import { sseData } from "../provider/sse";
import { UsageTracker } from "../provider/usage";
import { PROVIDER_MODELS } from "../../shared/providerModels";
import { supportsFastMode } from "../../shared/modelSpeed";
import type { ModelParams } from "../provider/types";

/** OpenCursor's Codex protocol compatibility identifiers. */
export const CODEX_CONFIG = {
  authUrl: "https://auth.openai.com/oauth/authorize",
  tokenUrl: "https://auth.openai.com/oauth/token",
  clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
  port: 1455,
  path: "/auth/callback",
  scope: "openid profile email offline_access",
  originator: "codex_cli_rs",
  cliVersion: "0.154.0",
  responsesUrl: "https://chatgpt.com/backend-api/codex/responses",
  modelsUrl: "https://chatgpt.com/backend-api/codex/models",
  fallbackModels: [
    "gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna",
    "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex-spark",
  ],
} as const;

export interface CodexCredentials { accessToken: string; accountId?: string }

/** Use the same account binding and client identity for models and responses. */
export function codexHeaders(account: CodexCredentials, opts: { sessionId?: string; accept?: string } = {}): Record<string, string> {
  return {
    authorization: `Bearer ${account.accessToken}`,
    "content-type": "application/json",
    accept: opts.accept ?? "application/json",
    originator: CODEX_CONFIG.originator,
    "user-agent": `${CODEX_CONFIG.originator}/${CODEX_CONFIG.cliVersion}`,
    ...(opts.sessionId ? { session_id: opts.sessionId } : {}),
    ...(account.accountId ? { "ChatGPT-Account-ID": account.accountId } : {}),
  };
}

/** Preserve the existing UUIDv5 mapping across upgrades and token refreshes. */
function codexSessionId(promptCacheKey: string): string {
  const namespace = Buffer.from("6ba7b8119dad11d180b400c04fd430c8", "hex");
  const bytes = createHash("sha1").update(namespace).update(`OpenCursor:${promptCacheKey}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type ImagePart = { type: "input_image"; image_url: string };
type TextPart = { type: "input_text" | "output_text"; text: string };
type InputItem =
  | { role: "user"; content: (ImagePart | TextPart)[] }
  | { role: "assistant"; content: TextPart[]; phase?: ResponsesReasoning["phase"] }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string }
  | ResponsesReasoning["items"][number];

type ResponsesIdentity = Pick<ResponsesReasoning, "model" | "provider" | "credential">;

export function toResponsesInput(messages: WireMessage[], identity?: ResponsesIdentity): { instructions: string; input: InputItem[] } {
  const instructions: string[] = [];
  const input: InputItem[] = [];
  let toolImages: ImagePart[] = [];
  const flushImages = () => {
    if (toolImages.length) input.push({ role: "user", content: toolImages });
    toolImages = [];
  };
  for (const message of messages) {
    if (message.role !== "tool") flushImages();
    if (message.role === "system") {
      instructions.push(typeof message.content === "string" ? message.content : message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n"));
    } else if (message.role === "user") {
      const content: (ImagePart | TextPart)[] = typeof message.content === "string"
        ? [{ type: "input_text", text: message.content }]
        : message.content.map((part) => part.type === "text" ? { type: "input_text", text: part.text } : { type: "input_image", image_url: part.image_url.url });
      input.push({ role: "user", content });
    } else if (message.role === "assistant") {
      const candidate = message.responsesReasoning;
      const reasoning = identity && candidate?.provider === identity.provider && candidate.model === identity.model
        && candidate.credential === identity.credential ? candidate : undefined;
      // Encrypted reasoning is bound to its transport, model, and credential.
      // Changed accounts and unscoped legacy history retain only portable text,
      // calls, and results when the current request has a credential identity.
      if (reasoning) {
        for (const item of reasoning.items) if (item.type === "reasoning" && item.id && item.encrypted_content) {
          input.push({ type: "reasoning", id: item.id, summary: item.summary, encrypted_content: item.encrypted_content });
        }
      }
      if (message.content) {
        // GPT-5.3 Codex requires each assistant item's original phase. Keep
        // boundaries when history text is intact; edited mixed-phase text is
        // replayed without assigning it a misleading phase.
        // https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.3-codex
        const segments = reasoning?.messages;
        if (segments?.length && segments.map((segment) => segment.text).join("") === message.content) {
          for (const segment of segments) if (segment.text) input.push({ role: "assistant", content: [{ type: "output_text", text: segment.text }], ...(segment.phase !== undefined ? { phase: segment.phase } : {}) });
        } else {
          input.push({ role: "assistant", content: [{ type: "output_text", text: message.content }], ...(reasoning?.phase !== undefined ? { phase: reasoning.phase } : {}) });
        }
      }
      for (const call of message.tool_calls ?? []) {
        // call_id joins tool results to calls. Never replay transient server item IDs.
        input.push({ type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments || "{}" });
      }
    } else {
      const output = typeof message.content === "string" ? message.content : message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
      input.push({ type: "function_call_output", call_id: message.tool_call_id, output });
      if (Array.isArray(message.content)) for (const part of message.content) {
        if (part.type === "image_url") toolImages.push({ type: "input_image", image_url: part.image_url.url });
      }
    }
  }
  // Images follow the entire consecutive result group, preserving parallel call pairing.
  flushImages();
  return { instructions: instructions.filter(Boolean).join("\n\n"), input };
}

export interface CodexRequestOptions {
  model: string;
  messages: WireMessage[];
  tools?: ToolSchema[];
  modelParams?: ModelParams;
  promptCacheKey?: string;
  signal?: AbortSignal;
}

/** Apply model-specific max/ultra normalization without rewriting model IDs. */
function reasoningEffort(model: string, requested = "low"): string {
  const effort = requested || "low";
  if (effort !== "max" && effort !== "ultra") return effort;
  if (/gpt-5\.6-(sol|terra)/.test(model)) return effort;
  if (/gpt-6|gpt-5\.6-luna/.test(model)) return "max";
  return "xhigh";
}

export function createCodexRequest(opts: CodexRequestOptions, account: CodexCredentials & { id: string }): { url: string; init: RequestInit } {
  opts.signal?.throwIfAborted();
  const { instructions, input } = toResponsesInput(opts.messages, { provider: "codex", model: opts.model, credential: account.id });
  const sessionId = opts.promptCacheKey ? codexSessionId(opts.promptCacheKey) : randomUUID();
  const upstreamModel = PROVIDER_MODELS.find(model => model.kind === "codex" && model.id === opts.model)?.upstreamModelId ?? opts.model;
  const effort = reasoningEffort(upstreamModel, opts.modelParams?.reasoningEffort);
  const speed = supportsFastMode(upstreamModel, "codex") ? opts.modelParams?.speed : undefined;
  // Build the accepted Responses shape directly. Codex rejects max_output_tokens,
  // stream_options, previous_response_id, and Chat Completions sampling parameters.
  const body = {
    model: upstreamModel,
    instructions: instructions || "You are OpenCursor, an AI coding assistant inside VS Code.",
    input: input.length ? input : [{ role: "user", content: [{ type: "input_text", text: "..." }] }],
    stream: true,
    store: false,
    ...(speed === "fast" ? { service_tier: "priority" } : speed === "standard" ? { service_tier: "default" } : {}),
    reasoning: { effort, summary: "auto" },
    ...(effort !== "none" ? { include: ["reasoning.encrypted_content"] } : {}),
    prompt_cache_key: opts.promptCacheKey || sessionId,
    ...(opts.tools?.length ? { tools: opts.tools.map((tool) => ({ type: "function", name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters })) } : {}),
  };
  return {
    url: CODEX_CONFIG.responsesUrl,
    init: { method: "POST", headers: codexHeaders(account, { sessionId, accept: "text/event-stream" }), body: JSON.stringify(body), signal: opts.signal },
  };
}

/** Kept independent of provider.ts to avoid an OAuth/provider import cycle. */
export class CodexProtocolError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "CodexProtocolError";
  }
}

/** Preserve request/account/server distinctions from Responses error frames.
 * https://developers.openai.com/api/docs/guides/error-codes
 * https://github.com/openai/openai-python/blob/main/src/openai/types/responses/response_error.py */
function streamErrorStatus(fallback: number, ...sources: unknown[]): number {
  const errors = sources.filter((value): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value));
  for (const error of errors) {
    for (const value of [error.status, error.status_code, error.code]) {
      const status = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
      if (Number.isInteger(status) && status >= 400 && status <= 599) return status;
    }
  }
  for (const error of errors) {
    // The specific code takes priority: a quota error can carry the broader
    // invalid_request_error type despite needing account-specific handling.
    for (const value of [error.code, error.type]) {
      if (typeof value !== "string") continue;
      const code = value.toLowerCase();
      if (["rate_limit_exceeded", "rate_limit_error", "slow_down", "insufficient_quota", "usage_limit_reached", "credit_balance_exhausted",
        "organization_spend_limit_exceeded", "project_spend_limit_exceeded", "organization_usage_limit_exceeded"].includes(code)) return 429;
      if (["authentication_error", "invalid_api_key", "invalid_token", "token_expired"].includes(code)) return 401;
      if (["permission_error", "permission_denied", "access_denied"].includes(code)) return 403;
      if (code === "model_not_found") return 404;
      if (["server_is_overloaded", "service_unavailable_error", "overloaded_error"].includes(code)) return 503;
      if (["server_error", "internal_server_error"].includes(code)) return 500;
      if (code.startsWith("invalid_") || code.startsWith("unsupported_") || ["context_length_exceeded", "data_residency_mismatch", "bio_policy",
        "misalignment_policy_violation", "image_content_policy_violation", "content_filter"].includes(code)) return 400;
    }
  }
  return fallback;
}

interface StreamItem {
  id?: string;
  type?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  content?: { type?: string; text?: string; refusal?: string }[];
  summary?: { type?: string; text?: string }[];
  encrypted_content?: string;
  phase?: ResponsesReasoning["phase"];
}

interface ItemState {
  text: Map<number, string>;
  thinking: Map<number, string>;
  tool?: { index: number; id: string; name: string; args: string };
}

/** Read Responses deltas, but release executable calls only after successful completion. */
export async function* parseCodexStream(reader: ReadableStreamDefaultReader<Uint8Array>, signal?: AbortSignal, identity?: ResponsesIdentity): AsyncGenerator<ProviderEvent> {
  const usage = new UsageTracker();
  const reasoning = new Map<string, ResponsesReasoning["items"][number]>();
  const phaseMessages = new Map<ItemState, { state: ItemState; index?: number; phase?: ResponsesReasoning["phase"] }>();
  const byId = new Map<string, ItemState>();
  const byIndex = new Map<number, ItemState>();
  const tools: NonNullable<ItemState["tool"]>[] = [];
  const stateFor = (id?: string, index?: number): ItemState => {
    let state = (id ? byId.get(id) : undefined) ?? (index !== undefined ? byIndex.get(index) : undefined);
    if (!state && !id && index === undefined) state = byIndex.get(0);
    state ??= { text: new Map(), thinking: new Map() };
    if (id) byId.set(id, state);
    if (index !== undefined || !id) byIndex.set(index ?? 0, state);
    return state;
  };
  function* updateTool(state: ItemState, item: StreamItem): Generator<ProviderEvent> {
    if (!state.tool) {
      state.tool = { index: tools.length, id: item.call_id || item.id || `call_${tools.length}`, name: item.name || "", args: item.arguments ?? "" };
      tools.push(state.tool);
      yield { type: "tool-call-start", index: state.tool.index, id: state.tool.id, name: state.tool.name };
    } else {
      if (item.call_id) state.tool.id = item.call_id;
      if (item.name) state.tool.name = item.name;
      if (typeof item.arguments === "string") state.tool.args = item.arguments;
    }
  }
  function* finalText(state: ItemState, index: number, value: unknown, thinking = false): Generator<ProviderEvent> {
    if (typeof value !== "string") return;
    const parts = thinking ? state.thinking : state.text;
    const before = parts.get(index) ?? "";
    // Final snapshots can repeat every delta or supply an omitted tail.
    if (value.startsWith(before)) {
      const remainder = value.slice(before.length);
      if (remainder) yield { type: thinking ? "thinking-delta" : "text-delta", text: remainder };
      parts.set(index, value);
    }
  }
  function* finalizeItem(item: StreamItem, index?: number): Generator<ProviderEvent> {
    const state = stateFor(item.id, index);
    if (identity && item.type === "message") {
      const record = phaseMessages.get(state) ?? { state, index };
      if (index !== undefined) record.index = index;
      if (item.phase === null || item.phase === "commentary" || item.phase === "final_answer") record.phase = item.phase;
      phaseMessages.set(state, record);
    }
    if (identity && item.type === "reasoning" && typeof item.id === "string" && item.id && typeof item.encrypted_content === "string" && item.encrypted_content) {
      reasoning.set(item.id, { type: "reasoning", id: item.id, summary: Array.isArray(item.summary) ? item.summary : [], encrypted_content: item.encrypted_content });
    }
    if (item.type === "function_call") yield* updateTool(state, item);
    if (Array.isArray(item.content)) for (const [partIndex, part] of item.content.entries()) {
      if (part.type === "output_text") yield* finalText(state, partIndex, part.text);
      else if (part.type === "refusal") yield* finalText(state, partIndex, part.refusal);
    }
    if (Array.isArray(item.summary)) for (const [partIndex, part] of item.summary.entries()) {
      yield* finalText(state, partIndex, part.text, true);
    }
  }
  const onAbort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener("abort", onAbort, { once: true });
  let finished = false;
  try {
    if (signal?.aborted) {
      await reader.cancel(signal.reason).catch(() => {});
      reader.releaseLock();
      signal.throwIfAborted();
    }
    for await (const data of sseData(reader)) {
      signal?.throwIfAborted();
      if (!data || data === "[DONE]") continue;
      let event: any;
      try { event = JSON.parse(data); } catch { continue; }
      if (!event || typeof event !== "object") continue;
      if (event.response?.usage) {
        const observed = event.response.usage;
        const delta = usage.update(
          observed.input_tokens ?? observed.prompt_tokens,
          observed.output_tokens ?? observed.completion_tokens,
          observed.input_tokens_details?.cached_tokens ?? observed.cache_read_input_tokens,
          observed.input_tokens_details?.cache_write_tokens,
        );
        if (delta) yield delta;
      }
      const state = stateFor(event.item_id ?? event.item?.id, event.output_index);
      switch (event.type) {
        case "response.output_text.delta":
        case "response.refusal.delta":
        case "response.reasoning_summary_text.delta": {
          if (typeof event.delta !== "string" || !event.delta) break;
          const thinking = event.type === "response.reasoning_summary_text.delta";
          const parts = thinking ? state.thinking : state.text;
          const index = (thinking ? event.summary_index : event.content_index) ?? 0;
          parts.set(index, (parts.get(index) ?? "") + event.delta);
          yield { type: thinking ? "thinking-delta" : "text-delta", text: event.delta };
          break;
        }
        case "response.output_text.done":
          yield* finalText(state, event.content_index ?? 0, event.text);
          break;
        case "response.refusal.done":
          yield* finalText(state, event.content_index ?? 0, event.refusal);
          break;
        case "response.reasoning_summary_text.done":
          yield* finalText(state, event.summary_index ?? 0, event.text, true);
          break;
        case "response.output_item.added":
          if (event.item?.type === "function_call") yield* updateTool(state, event.item);
          break;
        case "response.function_call_arguments.delta":
          if (state.tool && typeof event.delta === "string") {
            state.tool.args += event.delta;
            yield { type: "tool-call-args-delta", index: state.tool.index, delta: event.delta };
          }
          break;
        case "response.function_call_arguments.done":
          if (state.tool && typeof event.arguments === "string") state.tool.args = event.arguments;
          break;
        case "response.output_item.done":
          if (event.item) yield* finalizeItem(event.item, event.output_index);
          break;
        case "error":
          throw new CodexProtocolError(streamErrorStatus(502, event.error, event), `codex stream error: ${event.message || event.error?.message || "unknown error"}`);
        case "response.incomplete":
          throw new CodexProtocolError(400, `codex response incomplete: ${event.response?.incomplete_details?.reason || "interrupted generation"}`);
        case "response.failed":
          throw new CodexProtocolError(streamErrorStatus(500, event.response?.error, event.response, event), `codex: ${event.response?.error?.message || "response failed"}`);
        case "response.completed":
        case "response.done": {
          // Some compatible endpoints use response.done for all terminal states.
          const response = event.response;
          if (response?.status === "failed" || response?.error) throw new CodexProtocolError(streamErrorStatus(500, response?.error, response, event), `codex: ${response.error?.message || "response failed"}`);
          if (response?.status && response.status !== "completed") throw new CodexProtocolError(400, `codex response incomplete: ${response.incomplete_details?.reason || response.status}`);
          if (Array.isArray(response?.output)) for (const [index, item] of response.output.entries()) yield* finalizeItem(item, index);
          finished = true;
          break;
        }
      }
      // Do not wait for a server to close a keep-alive stream after its terminal event.
      if (finished) break;
    }
    signal?.throwIfAborted();
    if (!finished) throw new CodexProtocolError(502, "codex stream ended before completion");
    if (tools.some((tool) => !tool.name)) throw new CodexProtocolError(502, "codex completed a function call without a tool name");
    const messages = [...phaseMessages.values()].sort((a, b) => (a.index ?? Infinity) - (b.index ?? Infinity))
      .map(({ state, phase }) => ({ text: [...state.text.entries()].sort(([a], [b]) => a - b).map(([, text]) => text).join(""), ...(phase !== undefined ? { phase } : {}) }));
    const hasPhase = messages.some((message) => message.phase !== undefined);
    const phase = messages.length && messages.every((message) => message.phase === messages[0].phase) ? messages[0].phase : undefined;
    if (identity && (reasoning.size || hasPhase)) yield { type: "responses-reasoning", reasoning: { ...identity, items: [...reasoning.values()], ...(hasPhase ? { messages } : {}), ...(phase !== undefined ? { phase } : {}) } };
    for (const tool of tools) {
      signal?.throwIfAborted();
      yield { type: "tool-call", call: { id: tool.id, name: tool.name, arguments: tool.args || "{}" } };
    }
    yield { type: "done", finishReason: tools.length ? "tool_calls" : "stop" };
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}
