/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { createHash } from "node:crypto";
import type { ProviderEvent } from "../types";
import type { StreamChatOpts } from "./types";
import { CodexProtocolError, parseCodexStream, toResponsesInput } from "../oauth/codex";
import { supportsFastMode } from "../../shared/modelSpeed";

const ASTRA = /^gpt-6-astra(?:-\d{4}-\d{2}-\d{2})?$/;
const SOL_LUNA = /^gpt-6-(?:sol|luna)$/;
const PRO = /^gpt-5\.5-pro(?:-\d{4}-\d{2}-\d{2})?$/;
const CODEX = /^gpt-5\.3-codex(?:-\d{4}-\d{2}-\d{2})?$/;

/** GPT-6 reasoning with tools and GPT-5.3 Codex require Responses; Pro uses JSON Responses.
 * Do not impose the official API's endpoint contract on compatible servers.
 * https://developers.openai.com/api/docs/guides/latest-model
 * https://developers.openai.com/api/docs/models/gpt-6-sol
 * https://developers.openai.com/api/docs/models/gpt-6-luna
 * https://developers.openai.com/api/docs/models/gpt-5.5-pro
 * https://developers.openai.com/api/docs/models/gpt-5.3-codex
 */
export function shouldUseOpenAIResponses(opts: Pick<StreamChatOpts, "apiBaseUrl" | "model" | "oauthKind" | "anthropic">): boolean {
  if (opts.oauthKind || opts.anthropic || (!ASTRA.test(opts.model) && !SOL_LUNA.test(opts.model) && !PRO.test(opts.model) && !CODEX.test(opts.model))) return false;
  try {
    const url = new URL(opts.apiBaseUrl);
    return url.origin === "https://api.openai.com" && /^\/(?:v1\/?)?$/.test(url.pathname) && !url.search && !url.hash;
  } catch { return false; }
}

export class OpenAIResponsesError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "OpenAIResponsesError";
  }
}

function validEffort(model: string, value?: string): string | undefined {
  if (!value) return undefined;
  const effort = value.trim().toLowerCase();
  if (SOL_LUNA.test(model)) {
    if (effort === "minimal") return "low";
    if (effort === "ultra") return "max";
    return ["none", "low", "medium", "high", "xhigh", "max"].includes(effort) ? effort : undefined;
  }
  if (ASTRA.test(model)) {
    if (["none", "minimal"].includes(effort)) return "low";
    if (effort === "ultra") return "max";
    return ["low", "medium", "high", "xhigh", "max"].includes(effort) ? effort : undefined;
  }
  if (PRO.test(model)) {
    if (["none", "minimal", "low"].includes(effort)) return "medium";
    if (["max", "ultra"].includes(effort)) return "xhigh";
    return ["medium", "high", "xhigh"].includes(effort) ? effort : undefined;
  }
  if (CODEX.test(model)) {
    if (["none", "minimal"].includes(effort)) return "low";
    if (["max", "ultra"].includes(effort)) return "xhigh";
    return ["low", "medium", "high", "xhigh"].includes(effort) ? effort : undefined;
  }
  return effort;
}

export function createOpenAIResponsesRequest(opts: StreamChatOpts): { url: string; init: RequestInit } {
  opts.signal.throwIfAborted();
  if (!shouldUseOpenAIResponses(opts)) throw new OpenAIResponsesError(400, "This model/provider is not configured for the OpenAI Responses transport.");
  const { instructions, input } = toResponsesInput(opts.messages, {
    provider: "openai", model: opts.model, credential: createHash("sha256").update(opts.apiKey).digest("hex"),
  });
  const stream = !PRO.test(opts.model);
  const effort = validEffort(opts.model, opts.modelParams?.reasoningEffort);
  const samplingAllowed = SOL_LUNA.test(opts.model) && effort === "none";
  const speed = supportsFastMode(opts.model, "openai") ? opts.modelParams?.speed : undefined;
  const body = {
    model: opts.model,
    input,
    ...(instructions ? { instructions } : {}),
    stream,
    // History remains local and is replayed explicitly on every model request.
    store: false,
    ...(speed === "fast" ? { service_tier: "priority" } : speed === "standard" ? { service_tier: "default" } : {}),
    include: ["reasoning.encrypted_content"],
    reasoning: { ...(effort ? { effort } : {}), summary: "auto" },
    ...(samplingAllowed && opts.temperature != null ? { temperature: opts.temperature } : {}),
    ...(samplingAllowed && opts.sampling?.topP != null ? { top_p: opts.sampling.topP } : {}),
    ...(opts.promptCacheKey ? { prompt_cache_key: opts.promptCacheKey } : {}),
    ...(Number.isFinite(opts.maxTokens) && opts.maxTokens! > 0 ? { max_output_tokens: Math.max(1, Math.floor(opts.maxTokens!)) } : {}),
    ...(opts.tools?.length ? {
      tools: opts.tools.map(({ function: tool }) => ({
        type: "function", name: tool.name, description: tool.description, parameters: tool.parameters,
        // Our tools use optional fields; Responses must retain that contract.
        // https://developers.openai.com/api/docs/guides/function-calling#strict-mode
        strict: false,
      })),
      tool_choice: "auto",
    } : {}),
  };
  // GPT-6 accepts temperature/top_p only with explicit none (Sol/Luna).
  // Other Chat Completions sampling knobs are not forwarded to Responses.
  return {
    url: "https://api.openai.com/v1/responses",
    init: {
      method: "POST",
      headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json", accept: stream ? "text/event-stream" : "application/json" },
      body: JSON.stringify(body),
      signal: opts.signal,
    },
  };
}

async function readJSON(response: Response, signal?: AbortSignal): Promise<Record<string, unknown>> {
  if (!response.body) throw new OpenAIResponsesError(502, "OpenAI Responses returned an empty body.");
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  const decoder = new TextDecoder();
  let text = "";
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    signal?.throwIfAborted();
    for (;;) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      text += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (done) break;
    }
    let data: unknown;
    try { data = JSON.parse(text); } catch { throw new OpenAIResponsesError(502, "OpenAI Responses returned malformed JSON."); }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new OpenAIResponsesError(502, "OpenAI Responses returned an invalid response.");
    return data as Record<string, unknown>;
  } finally {
    signal?.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Shared Responses item parsing preserves call IDs, usage, and terminal errors.
 * GPT-5.5 Pro returns a complete JSON response instead of incremental SSE.
 */
export async function* parseOpenAIResponses(response: Response, signal?: AbortSignal, model?: string, apiKey?: string): AsyncGenerator<ProviderEvent> {
  try {
    // Opaque reasoning belongs to the credential that produced it. A key pool
    // may select another account on the next turn; never replay across accounts.
    const identity = model ? { model, provider: "openai" as const,
      ...(apiKey !== undefined ? { credential: createHash("sha256").update(apiKey).digest("hex") } : {}),
    } : undefined;
    if (!response.body) throw new OpenAIResponsesError(502, "OpenAI Responses returned an empty body.");
    if (/text\/event-stream/i.test(response.headers.get("content-type") ?? "")) {
      yield* parseCodexStream(response.body.getReader(), signal, identity);
    } else {
      const data = await readJSON(response, signal);
      if (typeof data.status !== "string" && !data.error) throw new OpenAIResponsesError(502, "OpenAI Responses omitted its completion status.");
      // Feed the same terminal snapshot through the shared reconciliation code,
      // so JSON and streamed calls follow identical success/usage/error rules.
      const terminal = { type: data.error ? "response.failed" : "response.completed", response: data };
      const snapshot = new Response(`data: ${JSON.stringify(terminal)}\n\n`);
      yield* parseCodexStream(snapshot.body!.getReader(), signal, identity);
    }
  } catch (error) {
    if (error instanceof CodexProtocolError) throw new OpenAIResponsesError(error.status, error.message.replace(/^codex\b/i, "OpenAI Responses"));
    throw error;
  }
}
