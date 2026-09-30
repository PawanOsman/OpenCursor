/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { createHash, randomUUID } from "node:crypto";
import type { ModelParams, SamplingParams } from "../provider/types";
import type { ProviderEvent, ToolCall, ToolSchema, WireMessage } from "../types";
import { sseData } from "../provider/sse";
import { UsageTracker } from "../provider/usage";
import { parseCodexStream, toResponsesInput } from "./codex";
import { parseAntigravityStream, toAntigravityRequest } from "./antigravity";
import { PROVIDER_MODEL_IDS } from "./providerModels";

export interface ProviderCredentials {
  id?: string;
  accessToken?: string;
  apiKey?: string;
  refreshToken?: string;
  expiresAt?: number;
  email?: string;
  accountId?: string;
  projectId?: string;
  providerSpecificData?: Record<string, unknown>;
}
export interface AccountCredentials extends ProviderCredentials { id: string; kind: string; accessToken: string; }
export interface AccountChatOptions {
  model: string;
  messages: WireMessage[];
  tools?: ToolSchema[];
  signal: AbortSignal;
  maxTokens?: number;
  temperature?: number;
  modelParams?: ModelParams;
  sampling?: SamplingParams;
  promptCacheKey?: string;
  onCredentialsRefresh?: (patch: Partial<ProviderCredentials>) => Promise<void> | void;
}
export interface ProviderChatOptions extends AccountChatOptions {
  providerId: string;
  credentials: ProviderCredentials;
  baseUrl?: string;
}
export class ProviderTransportError extends Error {
  retryable?: boolean;
  constructor(public status: number, message: string, public retryAfterMs?: number) { super(message); this.name = "ProviderTransportError"; }
}

const nativeOAuth = new Set(["codex", "claude", "claude-code", "antigravity"]);
export const supportsProviderAdapter = (kind: string): boolean => Object.hasOwn(PROVIDER_MODEL_IDS, kind);
export const supportsAccountAdapter = (kind: string): boolean => supportsProviderAdapter(kind) && !nativeOAuth.has(kind);
export const providerModelCatalog = (kind: string): string[] => [...(PROVIDER_MODEL_IDS[kind] ?? [])];
export const accountModels = providerModelCatalog;
const protocolAdapter = () => import("./protocols/transport.js");

function safeDetail(value: unknown, credentials: ProviderCredentials): string {
  let result = value instanceof Error ? value.message : String(value);
  const secrets = new Set<string>();
  const collect = (value: unknown, sensitive = false, depth = 0) => {
    if (depth > 8 || value == null) return;
    if (typeof value === "string") {
      if (sensitive && value) secrets.add(value);
      if (value.startsWith("{")) { try { collect(JSON.parse(value), false, depth + 1); } catch { /* not credential JSON */ } }
    } else if (typeof value === "object") {
      for (const [key, nested] of Object.entries(value)) collect(nested, sensitive || /token|key|secret|cookie|password|authorization|credential|jwt|ticket/i.test(key), depth + 1);
    }
  };
  collect(credentials);
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    result = result.split(secret).join("[redacted]");
    result = result.split(JSON.stringify(secret).slice(1, -1)).join("[redacted]");
  }
  return result.slice(0, 800);
}
function statusOf(error: any): number {
  const numeric = Number(error?.status ?? error?.status_code ?? error?.code);
  if (Number.isInteger(numeric) && numeric >= 400 && numeric <= 599) return numeric;
  const type = String(error?.type ?? error?.code ?? "");
  if (/rate_limit|quota|resource_exhausted/i.test(type)) return 429;
  if (/auth|invalid_token|invalid_api_key/i.test(type)) return 401;
  if (/permission|access_denied/i.test(type)) return 403;
  if (/not_found/i.test(type)) return 404;
  if (/invalid|unsupported|context_length|malformed/i.test(type)) return 400;
  return 502;
}
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);

function reasoningHistory(messages: WireMessage[], identity: string, model: string, requireAll: boolean): WireMessage[] {
  const historical = new Map<string, string>();
  return messages.map(message => {
    if (message.role === "assistant" && (requireAll || message.chatReasoning?.endpoint !== identity || message.chatReasoning.model !== model)) {
      for (const call of message.tool_calls ?? []) historical.set(call.id, call.function.name);
      return { role: "user", content: ["[Historical assistant message; context from an earlier turn]", message.content,
        ...(message.tool_calls ?? []).map(call => `[Previously executed tool ${call.function.name}, call ${call.id}]\nArguments: ${call.function.arguments}`)].filter(Boolean).join("\n\n") };
    }
    if (message.role === "tool" && historical.has(message.tool_call_id)) {
      const header = `[Previous tool result ${historical.get(message.tool_call_id)}, call ${message.tool_call_id}]`;
      return { role: "user", content: typeof message.content === "string" ? `${header}\n${message.content}` : [{ type: "text", text: header }, ...message.content] };
    }
    return message;
  });
}

function portableMessages(messages: WireMessage[], identity: string, model: string): Record<string, unknown>[] {
  return messages.map(message => {
    if (message.role === "assistant") {
      const { responsesReasoning: _responses, chatReasoning, tool_calls, ...portable } = message;
      return { ...portable, ...(tool_calls ? { tool_calls: tool_calls.map(call => ({ id: call.id, type: call.type, function: { ...call.function } })) } : {}),
        ...(chatReasoning?.endpoint === identity && chatReasoning.model === model ? { reasoning_content: chatReasoning.content } : {}) };
    }
    if (message.role === "tool") {
      const { content, ...rest } = message;
      // Keep image parts for translators that support multimodal tool results.
      return { ...rest, content };
    }
    return { ...message };
  });
}

async function* responseFrames(response: Response, format: string, signal: AbortSignal): AsyncGenerator<any> {
  signal.throwIfAborted();
  if (!response.body) throw new ProviderTransportError(502, "Provider returned an empty response.");
  if (/application\/json/i.test(response.headers.get("content-type") ?? "") && format !== "ollama") {
    yield await response.json();
    return;
  }
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (format !== "ollama") {
      for await (const text of sseData(reader)) {
        signal.throwIfAborted();
        if (text === "[DONE]") return;
        if (!text) continue;
        try { yield JSON.parse(text); }
        catch (error) { if (error instanceof SyntaxError) throw new ProviderTransportError(502, "Provider returned malformed stream JSON."); throw error; }
      }
    } else {
      const decoder = new TextDecoder();
      let pending = "";
      for (;;) {
        const { value, done } = await reader.read();
        signal.throwIfAborted();
        pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
        if (pending.length > 4 * 1024 * 1024) throw new ProviderTransportError(502, "Provider stream frame exceeds the limit.");
        if (done && pending.trim()) pending += "\n";
        let end: number;
        while ((end = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, end).trim(); pending = pending.slice(end + 1);
          if (line) { try { yield JSON.parse(line); } catch (error) { if (error instanceof SyntaxError) throw new ProviderTransportError(502, "Provider returned malformed stream JSON."); throw error; } }
        }
        if (done) break;
      }
    }
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener("abort", cancel);
    if (response.body.locked) { await reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch { /* released by SSE decoder */ } }
  }
}

async function* decodeProviderResponse(response: Response, format: string, options: ProviderChatOptions, identity: string, actualModel: string, toolNameMap?: Map<string, string>): AsyncGenerator<ProviderEvent> {
  const bridge = await protocolAdapter();
  const state = bridge.makeResponseState(actualModel, identity);
  const usage = new UsageTracker();
  const calls = new Map<number, { id: string; name: string; arguments: string; started: boolean }>();
  let finish: string | undefined;
  let reasoning = "";
  for await (const frame of responseFrames(response, format, options.signal)) {
    if (!object(frame)) throw new ProviderTransportError(502, "Provider returned an invalid stream frame.");
    if (frame.error || frame.type === "error") {
      const error = frame.error ?? frame;
      throw new ProviderTransportError(statusOf(error), safeDetail(error.message ?? error, options.credentials));
    }
    for (const chunk of bridge.convertResponse(format, frame, state, toolNameMap)) {
      if (chunk?.error) throw new ProviderTransportError(statusOf(chunk.error), safeDetail(chunk.error.message ?? chunk.error, options.credentials));
      const billed = chunk?.usage;
      if (billed) {
        const event = usage.update(billed.prompt_tokens ?? billed.input_tokens, billed.completion_tokens ?? billed.output_tokens,
          billed.prompt_tokens_details?.cached_tokens ?? billed.cache_read_input_tokens, billed.cache_creation_input_tokens);
        if (event) yield event;
      }
      const choice = chunk?.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? choice.message ?? {};
      if (typeof delta.content === "string" && delta.content) yield { type: "text-delta", text: delta.content };
      if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
        reasoning += delta.reasoning_content;
        yield { type: "thinking-delta", text: delta.reasoning_content };
      }
      for (const [position, tool] of (delta.tool_calls ?? []).entries()) {
        const index = Number.isInteger(tool.index) ? tool.index : position;
        const call = calls.get(index) ?? { id: "", name: "", arguments: "", started: false };
        if (tool.id) call.id = tool.id;
        if (tool.function?.name) call.name = tool.function.name;
        if (typeof tool.function?.arguments === "string") call.arguments += tool.function.arguments;
        else if (object(tool.function?.arguments)) call.arguments = JSON.stringify(tool.function.arguments);
        calls.set(index, call);
        if (call.name && !call.started) { call.started = true; yield { type: "tool-call-start", index, id: call.id || `pending_${index}`, name: call.name }; }
        if (typeof tool.function?.arguments === "string" && tool.function.arguments) yield { type: "tool-call-args-delta", index, delta: tool.function.arguments };
      }
      if (choice.finish_reason != null) finish = String(choice.finish_reason);
    }
  }
  options.signal.throwIfAborted();
  if (!finish) throw new ProviderTransportError(502, "Provider stream ended before successful completion.");
  if (["error", "content_filter", "refusal", "malformed_function_call"].includes(finish)) throw new ProviderTransportError(400, `Provider stopped with ${finish}.`);
  const validated: ToolCall[] = [];
  for (const call of calls.values()) {
    if (finish === "length" || !call.id || !call.name) throw new ProviderTransportError(502, "Provider returned an incomplete tool call.");
    let args: unknown;
    try { args = JSON.parse(call.arguments || "{}"); } catch { throw new ProviderTransportError(502, "Provider returned malformed tool arguments."); }
    if (!object(args)) throw new ProviderTransportError(502, "Provider tool arguments must be a JSON object.");
    validated.push({ id: call.id, name: call.name, arguments: call.arguments || "{}" });
  }
  if (reasoning) yield { type: "chat-reasoning", reasoning: { endpoint: identity, model: actualModel, content: reasoning } };
  for (const call of validated) yield { type: "tool-call", call };
  yield { type: "done", finishReason: finish };
}

export async function* streamProviderAdapter(options: ProviderChatOptions): AsyncGenerator<ProviderEvent> {
  options.signal.throwIfAborted();
  if (options.tools?.length && ["trae", "windsurf"].includes(options.providerId)) throw new ProviderTransportError(400, `${options.providerId} currently supports chat only; its provider protocol does not support tool calls.`);
  let progressed = false;
  try {
    const bridge = await protocolAdapter();
    const info = bridge.describeProvider(options.providerId, options.model);
    const credential = createHash("sha256").update(options.providerId).update("\0").update(options.baseUrl ?? String(info.config.baseUrl ?? "")).update("\0").update(options.credentials.id ?? options.credentials.apiKey ?? options.credentials.accessToken ?? "anonymous").digest("hex");
    const identity = `provider:${options.providerId}:${credential}`;
    const credentials = { ...options.credentials, connectionId: options.credentials.id ?? credential,
      _clientSessionId: `${credential}:${options.promptCacheKey ?? randomUUID()}` };
    const body: Record<string, unknown> = { model: info.model, messages: portableMessages(options.messages, identity, info.model), stream: true,
      ...(options.tools?.length ? { tools: structuredClone(options.tools) } : {}),
      ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}), ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.modelParams?.reasoningEffort ? { reasoning_effort: options.modelParams.reasoningEffort } : {}),
      ...(options.modelParams?.thinking ? { thinking: { type: options.modelParams.thinking } } : {}),
      ...(options.sampling?.topP != null ? { top_p: options.sampling.topP } : {}),
      ...(options.sampling?.topK != null ? { top_k: options.sampling.topK } : {}),
      ...(options.sampling?.frequencyPenalty != null ? { frequency_penalty: options.sampling.frequencyPenalty } : {}),
      ...(options.sampling?.presencePenalty != null ? { presence_penalty: options.sampling.presencePenalty } : {}),
      ...(options.sampling?.seed != null ? { seed: options.sampling.seed } : {}),
      ...(options.sampling?.stopSequences?.length ? { stop: options.sampling.stopSequences } : {}),
    };
    const thinking = options.modelParams?.thinking !== "disabled" && options.modelParams?.reasoningEffort !== "none" && !options.model.endsWith("-none");
    if (options.tools?.length && thinking && (["deepseek", "glm", "z-ai", "moonshot", "kimi"].includes(options.providerId) || info.format === "claude")) {
      // Strict thinking APIs require original state around tool turns. Treat older
      // or foreign-credential observations as context instead of forged reasoning.
      body.messages = portableMessages(reasoningHistory(options.messages, identity, info.model, info.format === "claude"), identity, info.model);
    }
    let nativeBody: Record<string, unknown> | undefined;
    if (["gemini", "gemini-cli", "vertex"].includes(info.format)) {
      const projectId = options.credentials.projectId ?? String(options.credentials.providerSpecificData?.projectId ?? "");
      if (info.format === "gemini-cli" && !projectId) throw new ProviderTransportError(400, "Gemini CLI needs the project provisioned during account sign-in.");
      const wrapped = toAntigravityRequest({ ...options, model: info.model, projectId: projectId || "api", sessionId: credentials._clientSessionId });
      nativeBody = info.format === "gemini-cli" ? { project: projectId, model: info.model, request: wrapped.request } : { ...wrapped.request };
    } else if (info.format === "openai-responses") {
      const converted = toResponsesInput(options.messages, { provider: "openai", model: info.model, credential });
      nativeBody = { model: info.model, input: converted.input, ...(converted.instructions ? { instructions: converted.instructions } : {}), stream: true, store: false,
        ...(options.maxTokens ? { max_output_tokens: options.maxTokens } : {}),
        ...(options.tools?.length ? { tools: options.tools.map(tool => ({ type: "function", ...tool.function })) } : {}),
        ...(options.modelParams?.reasoningEffort ? { reasoning: { effort: options.modelParams.reasoningEffort } } : {}),
      };
    }
    const result = await bridge.performProviderRequest({ providerId: options.providerId, model: options.model, body, nativeBody, credentials, signal: options.signal, baseUrl: options.baseUrl, onCredentialsRefresh: options.onCredentialsRefresh });
    if (!result.response.ok) {
      const header = result.response.headers.get("retry-after");
      const delay = header ? /^\d+(\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now() : undefined;
      throw new ProviderTransportError(result.response.status, `${options.providerId} ${result.response.status}: ${safeDetail(await result.response.text(), options.credentials)}`, Number.isFinite(delay) && delay! > 0 ? delay : undefined);
    }
    if (!result.response.body) throw new ProviderTransportError(502, "Provider returned no response body.");
    const events = ["gemini", "gemini-cli", "vertex"].includes(result.format)
      ? parseAntigravityStream(result.response.body.getReader(), { signal: options.signal })
      : result.format === "openai-responses" ? parseCodexStream(result.response.body.getReader(), options.signal, { provider: "openai", model: info.model, credential })
        : decodeProviderResponse(result.response, result.format, options, identity, info.model, result.toolNameMap);
    const allowedTools = new Set(options.tools?.map(tool => tool.function.name));
    for await (const event of events) {
      if (event.type === "tool-call" && !allowedTools.has(event.call.name)) throw new ProviderTransportError(502, `Provider returned an undeclared tool: ${event.call.name}.`);
      if (event.type !== "usage") progressed = true;
      yield event;
    }
  } catch (error) {
    options.signal.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") throw error;
    const wrapped = error instanceof ProviderTransportError ? error : new ProviderTransportError(statusOf(error), safeDetail(error, options.credentials));
    if (progressed) wrapped.retryable = false;
    throw wrapped;
  }
}

export async function* streamAccountAdapter(options: AccountChatOptions, account: AccountCredentials): AsyncGenerator<ProviderEvent> {
  const savedBase = account.kind === "gitlab" && typeof account.providerSpecificData?.baseUrl === "string" ? account.providerSpecificData.baseUrl.replace(/\/+$/, "") : undefined;
  const baseUrl = savedBase ? `${savedBase.replace(/\/api\/v4$/, "")}/api/v4` : undefined;
  yield* streamProviderAdapter({ ...options, providerId: account.kind, credentials: account, baseUrl });
}

/** Static catalogs never imply an authenticated connection. Only known model-list
 * protocols perform read-only verification; custom/binary transports stay explicit. */
export async function listProviderAdapterModels(providerId: string, credentials: ProviderCredentials, options: { baseUrl?: string; signal?: AbortSignal } = {}): Promise<{ models: string[]; verified: boolean }> {
  options.signal?.throwIfAborted();
  const staticModels = providerModelCatalog(providerId);
  const knownOpenAI = new Set(["openai", "openrouter", "deepseek", "groq", "mistral", "cerebras", "nvidia", "together", "fireworks", "chutes", "featherless", "nebius", "hyperbolic", "siliconflow", "venice", "perplexity", "perplexity-agent", "xai", "kilocode", "cline", "clinepass", "kilo-gateway", "vercel-ai-gateway"]);
  if (!knownOpenAI.has(providerId) || !options.baseUrl) return { models: staticModels, verified: false };
  const base = options.baseUrl.replace(/\/+$/, "").replace(/\/(?:chat\/completions|responses|messages)$/, "");
  const token = credentials.apiKey ?? credentials.accessToken;
  const response = await fetch(`${base}/models`, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal: options.signal ?? AbortSignal.timeout(30_000) });
  if ([404, 405].includes(response.status)) return { models: staticModels, verified: false };
  if (!response.ok) throw new ProviderTransportError(response.status, `${providerId} models ${response.status}: ${safeDetail(await response.text(), credentials)}`);
  const body = await response.json() as { data?: { id?: string }[] };
  if (!Array.isArray(body.data)) throw new ProviderTransportError(502, "Provider returned an invalid model catalog.");
  return { models: body.data.flatMap(model => typeof model.id === "string" ? [model.id] : []), verified: true };
}
