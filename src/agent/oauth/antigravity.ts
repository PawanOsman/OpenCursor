/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { randomUUID } from "crypto";
import type { ModelParams, SamplingParams } from "../provider/types";
import type { ProviderEvent, ToolCall, ToolSchema, WireContentPart, WireMessage } from "../types";
import { sseData } from "../provider/sse";
import { UsageTracker } from "../provider/usage";

// OpenCursor's installed-app protocol for Google Antigravity.
// Gemini CLI is a separate OAuth client, scope set and transport. Existing
// Antigravity accounts must continue to use their original installed-app client.
const MODEL_ALIASES: Record<string, string> = {
  "gemini-3.8-flash": "gemini-3.8-flash-medium(medium)",
  ...Object.fromEntries(["high", "medium", "low"].flatMap((level) => [
    [`gemini-3.8-flash-${level}`, `gemini-3.8-flash-${level}(${level})`],
    [`gemini-3.7-flash-${level}`, `gemini-3.7-flash-tiered(${level})`],
    [`gemini-3.6-flash-${level}`, `gemini-3.6-flash-tiered(${level})`],
  ])),
};

/** Catalog suffixes select reasoning; they are never part of Google's model ID. */
export function resolveAntigravityModel(model: string, availableModels?: readonly string[]): { model: string; reasoningEffort?: string } {
  const split = (value: string) => {
    const match = /^(.*)\((minimal|low|medium|high|xhigh|max|auto|none|off)\)$/i.exec(value);
    return match ? { model: match[1], reasoningEffort: match[2].toLowerCase() } : { model: value };
  };
  const requested = split(model);
  const alias = split(MODEL_ALIASES[model] ?? model);
  // A project's real ID takes precedence over an older catalog alias with the
  // same name (for example, a dedicated low model replacing a tiered model).
  if (availableModels?.includes(requested.model)) {
    return { ...requested, reasoningEffort: requested.reasoningEffort ?? alias.reasoningEffort };
  }
  return alias;
}

/** Keep live IDs and add only aliases backed by this account's advertised IDs. */
export function antigravityModelChoices(availableModels: readonly string[]): string[] {
  const available = new Set(availableModels.filter(id => typeof id === "string" && id.trim()).map(id => id.trim()));
  const choices = new Set(available);
  for (const alias of Object.keys(MODEL_ALIASES)) {
    if (available.has(resolveAntigravityModel(alias).model)) choices.add(alias);
  }
  return [...choices];
}

export const ANTIGRAVITY_CONFIG = {
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  userInfoUrl: "https://www.googleapis.com/oauth2/v1/userinfo",
  clientId: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
  // Public installed-app OAuth configuration; never replace saved account tokens.
  clientSecret: "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",
  port: 8723,
  path: "/callback",
  scopes: [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/cclog",
    "https://www.googleapis.com/auth/experimentsandconfigs",
  ],
  ideVersion: "2.11.0",
  apiBase: "https://daily-cloudcode-pa.googleapis.com",
  quotaUrl: "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
  loadCodeAssistUrl: "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
  onboardUserUrl: "https://cloudcode-pa.googleapis.com/v1internal:onboardUser",
  models: [
    ...Object.keys(MODEL_ALIASES), "gemini-3.5-flash-high", "gemini-3-flash-agent",
    "gemini-3.5-flash-low", "gemini-3.5-flash-extra-low", "gemini-pro-agent",
    "gemini-3.1-pro-low", "claude-sonnet-4-6", "claude-opus-4-6-thinking",
    "gpt-oss-120b-medium", "gemini-3-flash",
  ],
} as const;

export class AntigravityProtocolError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "AntigravityProtocolError";
  }
}

export function antigravityHeaders(token: string, options: {
  purpose?: "generation" | "catalog" | "project";
  platform?: string;
  arch?: string;
} = {}): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "user-agent": `antigravity/ide/${ANTIGRAVITY_CONFIG.ideVersion} ${options.platform ?? process.platform}/${options.arch ?? process.arch}`,
    ...(options.purpose === "generation" ? { accept: "text/event-stream" } : {}),
    ...(options.purpose === "catalog" ? {
      "x-client-name": "antigravity", "x-client-version": ANTIGRAVITY_CONFIG.ideVersion,
    } : {}),
  };
}

interface GeminiPart {
  text?: string;
  thoughtSignature?: string;
  functionCall?: { id: string; name: string; args: Record<string, unknown> };
  functionResponse?: { id: string; name: string; response: Record<string, unknown> };
  inlineData?: { mimeType: string; data: string };
  fileData?: { fileUri: string; mimeType: string };
}
interface GeminiContent { role: "user" | "model"; parts: GeminiPart[] }
export interface AntigravityRequest {
  project: string;
  model: string;
  userAgent: "antigravity";
  requestId: string;
  request: {
    contents: GeminiContent[];
    systemInstruction?: { parts: GeminiPart[] };
    generationConfig: Record<string, unknown>;
    sessionId?: string;
    tools?: { functionDeclarations: { name: string; description: string; parameters?: object }[] }[];
    toolConfig?: { functionCallingConfig: { mode: "VALIDATED" } };
  };
}

const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const requiresSignature = (model: string) => /^gemini-(?:[3-9](?:[.-]|$)|pro-agent$)/i.test(model);

function contentParts(content: string | WireContentPart[]): GeminiPart[] {
  if (typeof content === "string") return [{ text: content }];
  return content.map((part) => {
    if (part.type === "text") return { text: part.text };
    const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(part.image_url.url);
    if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
    if (/^https?:\/\//.test(part.image_url.url)) {
      return { fileData: { fileUri: part.image_url.url, mimeType: "image/*" } };
    }
    throw new AntigravityProtocolError(400, "Antigravity image must be a base64 data URL or an HTTP(S) URL.");
  });
}

function geminiMessages(messages: WireMessage[], model: string) {
  const contents: GeminiContent[] = [];
  const system: GeminiPart[] = [];
  const calls = new Map<string, { name: string; historical: boolean }>();
  const append = (role: "user" | "model", parts: GeminiPart[]) => {
    if (!parts.length) return;
    const last = contents.at(-1);
    if (last?.role === role) last.parts.push(...parts);
    else contents.push({ role, parts });
  };
  for (const message of messages) {
    if (message.role === "system") {
      system.push(...contentParts(message.content));
    } else if (message.role === "user") {
      append("user", contentParts(message.content));
    } else if (message.role === "assistant") {
      const parts: GeminiPart[] = message.content ? [{ text: message.content }] : [];
      // Gemini 3 requires the original signature on the first parallel call.
      // Old saved chats lack it. Preserve those observations as history instead
      // of reusing a static signature for a different model response.
      const historical = requiresSignature(model) && !!message.tool_calls?.length
        && !message.tool_calls[0].thoughtSignature;
      for (const call of message.tool_calls ?? []) {
        calls.set(call.id, { name: call.function.name, historical });
        if (historical) {
          parts.push({ text: `[Previously executed tool ${call.function.name}, call ${call.id}]\nArguments: ${call.function.arguments}` });
          continue;
        }
        let args: unknown;
        try { args = JSON.parse(call.function.arguments || "{}"); }
        catch { throw new AntigravityProtocolError(400, `Invalid saved arguments for tool ${call.function.name}.`); }
        if (!object(args)) throw new AntigravityProtocolError(400, `Tool ${call.function.name} arguments must be a JSON object.`);
        parts.push({ functionCall: { id: call.id, name: call.function.name, args },
          ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}) });
      }
      append("model", parts);
    } else {
      const meta = calls.get(message.tool_call_id);
      const parts = contentParts(message.content);
      const text = parts.filter((part) => part.text !== undefined).map((part) => part.text).join("\n");
      if (!meta || meta.historical) {
        append("user", [{ text: `[Previous tool result ${meta?.name ?? "unknown"}, call ${message.tool_call_id}]\n${text}` },
          ...parts.filter((part) => part.text === undefined)]);
      } else {
        let parsed: unknown;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        append("user", [{ functionResponse: { id: message.tool_call_id, name: meta.name,
          response: object(parsed) ? parsed : { result: parsed } } }, ...parts.filter((part) => part.text === undefined)]);
      }
    }
  }
  return { contents, ...(system.length ? { systemInstruction: { parts: system } } : {}) };
}

// These schema fields are accepted by the Cloud Code protocol used in this
// Antigravity converter. Walk schema nodes, not arbitrary objects: a property
// named "title" or "default" is still a real tool argument.
function toolParameters(schema: object, root: object = schema, depth = 0): object {
  if (depth > 32) throw new AntigravityProtocolError(400, "Antigravity tool schema is recursive or too deeply nested.");
  if (!object(schema)) return { type: "object" };
  let source = schema;
  if (typeof source.$ref === "string") {
    if (!source.$ref.startsWith("#/")) throw new AntigravityProtocolError(400, "Antigravity tool schemas require local references.");
    let referenced: unknown = root;
    for (const key of source.$ref.slice(2).split("/").map((key: string) => key.replace(/~1/g, "/").replace(/~0/g, "~"))) {
      referenced = object(referenced) && Object.hasOwn(referenced, key) ? referenced[key] : undefined;
    }
    if (!object(referenced)) throw new AntigravityProtocolError(400, "Antigravity tool schema contains an unresolved reference.");
    return toolParameters({ ...referenced, ...Object.fromEntries(Object.entries(source).filter(([key]) => key !== "$ref")) }, root, depth + 1);
  }
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(source[key])) {
      const variants = source[key].filter(object);
      const nonNull = variants.filter((variant: Record<string, unknown>) => variant.type !== "null");
      // Nullable unions have an exact Gemini representation. Other unions must
      // remain explicit to the caller, rather than silently dropping branches.
      if (key !== "allOf" && nonNull.length === 1) {
        // A union branch can itself be a local $ref or another nullable union.
        // Re-enter the resolver after removing this union instead of discarding
        // the branch's unresolved type while selecting supported fields.
        const parent = Object.fromEntries(Object.entries(source).filter(([field]) => field !== key));
        return toolParameters({ ...parent, ...nonNull[0], nullable: source.nullable === true || variants.length !== nonNull.length }, root, depth + 1);
      } else {
        throw new AntigravityProtocolError(400, `Antigravity tool schema cannot represent ${key}; simplify this tool's parameter schema.`);
      }
    }
  }
  const result: Record<string, unknown> = {};
  for (const key of ["type", "description", "nullable", "enum", "minimum", "maximum"]) {
    if (source[key] !== undefined) result[key] = structuredClone(source[key]);
  }
  if (Array.isArray(result.type)) {
    const types = result.type.filter((type) => type !== "null");
    if (types.length !== 1) throw new AntigravityProtocolError(400, "Antigravity tool schema requires a single parameter type.");
    result.type = types[0];
    result.nullable = source.type.includes("null");
  }
  if (source.const !== undefined) result.enum = [structuredClone(source.const)];
  if (object(source.properties)) {
    result.type ??= "object";
    result.properties = Object.fromEntries(Object.entries(source.properties).map(([key, value]) => [key, toolParameters(value as object, root, depth + 1)]));
    if (Array.isArray(source.required)) result.required = source.required.filter((key) => typeof key === "string" && Object.hasOwn(source.properties, key));
  }
  if (object(source.items)) result.items = toolParameters(source.items, root, depth + 1);
  if (result.type === "array" && !result.items) result.items = { type: "string" };
  return result;
}

export function toAntigravityRequest(options: {
  projectId: string;
  model: string;
  messages: WireMessage[];
  tools?: ToolSchema[];
  maxTokens?: number;
  temperature?: number;
  modelParams?: ModelParams;
  sampling?: SamplingParams;
  sessionId?: string;
  requestId?: string;
  availableModels?: readonly string[];
}): AntigravityRequest {
  if (!options.projectId.trim()) throw new AntigravityProtocolError(400, "Antigravity project is missing. Reconnect this Google account to provision Code Assist access.");
  const resolved = resolveAntigravityModel(options.model, options.availableModels);
  const model = resolved.model;
  const maxOutputTokens = Math.min(Number.isFinite(options.maxTokens) && options.maxTokens! > 0 ? Math.floor(options.maxTokens!) : 8192, 64000);
  const generationConfig: Record<string, unknown> = { maxOutputTokens, temperature: options.temperature ?? 1 };
  const effort = options.modelParams?.thinking === "disabled" ? "none" : options.modelParams?.reasoningEffort?.toLowerCase() ?? resolved.reasoningEffort;
  const thinkingConfig: Record<string, unknown> = { includeThoughts: true };
  if (effort && /^gemini-/i.test(model)) {
    if (requiresSignature(model)) {
      const level = ["none", "off"].includes(effort) ? "minimal" : ["xhigh", "max", "auto"].includes(effort) ? "high" : effort;
      if (["minimal", "low", "medium", "high"].includes(level)) {
        thinkingConfig.thinkingLevel = level;
        thinkingConfig.includeThoughts = level !== "minimal";
      }
    } else if (/^gemini-2\.5/i.test(model)) {
      const budgets: Record<string, number> = { none: 0, off: 0, minimal: 512, low: 1024, medium: 8192, high: 24576, xhigh: 24576, max: 24576, auto: -1 };
      if (effort in budgets) {
        thinkingConfig.thinkingBudget = budgets[effort] < 0 ? -1 : Math.min(budgets[effort], Math.max(0, maxOutputTokens - 1));
        thinkingConfig.includeThoughts = thinkingConfig.thinkingBudget !== 0;
      }
    }
  }
  generationConfig.thinkingConfig = thinkingConfig;
  for (const key of ["topP", "topK", "frequencyPenalty", "presencePenalty", "seed"] as const) {
    if (options.sampling?.[key] != null) generationConfig[key] = options.sampling[key];
  }
  if (options.sampling?.stopSequences?.length) generationConfig.stopSequences = [...options.sampling.stopSequences];
  const request: AntigravityRequest["request"] = { ...geminiMessages(options.messages, model), generationConfig };
  if (options.sessionId) request.sessionId = options.sessionId;
  if (options.tools?.length) {
    const names = new Set<string>();
    request.tools = [{ functionDeclarations: options.tools.map(({ function: tool }) => {
      if (!/^[a-zA-Z_][a-zA-Z0-9_.:-]{0,63}$/.test(tool.name) || names.has(tool.name)) {
        throw new AntigravityProtocolError(400, `Antigravity requires unique tool names of at most 64 supported characters: ${tool.name}.`);
      }
      names.add(tool.name);
      const parameters = toolParameters(tool.parameters) as Record<string, unknown>;
      // No-argument tools need no schema. Do not manufacture a required "reason"
      // argument: external tools may correctly reject additional arguments.
      const noArguments = parameters.type === "object" && (!object(parameters.properties) || !Object.keys(parameters.properties).length);
      return { name: tool.name, description: tool.description, ...(!noArguments ? { parameters } : {}) };
    }) }];
    request.toolConfig = { functionCallingConfig: { mode: "VALIDATED" } };
  }
  // The current IDE chat envelope omits requestType. In the upstream API,
  // `agent` is explicitly removed because it selects an incorrect quota bucket.
  return { project: options.projectId.trim(), model, userAgent: "antigravity",
    requestId: options.requestId ?? `agent/${randomUUID()}/${Date.now()}/${randomUUID()}/0`, request };
}

function aborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

export async function* parseAntigravityStream(reader: ReadableStreamDefaultReader<Uint8Array>, options: {
  signal?: AbortSignal; requestId?: string; model?: string;
} = {}): AsyncGenerator<ProviderEvent> {
  const usage = new UsageTracker();
  const calls: ToolCall[] = [];
  const ids = new Set<string>();
  const prefix = randomUUID();
  let pendingSignature: string | undefined;
  let finishReason: string | undefined;
  let promptCount: unknown;
  let candidateCount = 0;
  let thoughtCount = 0;
  let cachedCount: unknown;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  options.signal?.addEventListener("abort", cancel, { once: true });
  try {
    aborted(options.signal);
    for await (const data of sseData(reader)) {
      aborted(options.signal);
      if (!data || data === "[DONE]") continue;
      let chunk: any;
      try { chunk = JSON.parse(data); }
      catch { throw new AntigravityProtocolError(502, "Antigravity returned malformed stream JSON."); }
      if (!object(chunk)) throw new AntigravityProtocolError(502, "Antigravity returned an invalid stream frame.");
      const response = chunk.response ?? chunk;
      if (!object(response)) throw new AntigravityProtocolError(502, "Antigravity returned an invalid wrapped stream frame.");
      // Cloud Code can report billing on the wrapper, including a frame which
      // also reports an error. Account for that attempt before surfacing it.
      const u = response.usageMetadata ?? chunk.usageMetadata;
      if (u) {
        if (typeof u.promptTokenCount === "number") promptCount = u.promptTokenCount;
        if (typeof u.candidatesTokenCount === "number" && Number.isFinite(u.candidatesTokenCount)) candidateCount = Math.max(candidateCount, u.candidatesTokenCount);
        if (typeof u.thoughtsTokenCount === "number" && Number.isFinite(u.thoughtsTokenCount)) thoughtCount = Math.max(thoughtCount, u.thoughtsTokenCount);
        if (typeof u.cachedContentTokenCount === "number") cachedCount = u.cachedContentTokenCount;
        const event = usage.update(promptCount, candidateCount + thoughtCount, cachedCount);
        if (event) yield { ...event, ...(options.requestId ? { requestId: options.requestId } : {}), ...(options.model ? { model: options.model } : {}) };
      }
      const error = chunk.error ?? response.error;
      if (error) throw new AntigravityProtocolError(Number(error.code) || 502, `Antigravity stream error: ${error.message || "unknown error"}`);
      if (response.promptFeedback?.blockReason) throw new AntigravityProtocolError(400, `Antigravity blocked prompt: ${response.promptFeedback.blockReason}`);
      const candidate = response.candidates?.[0];
      for (const part of candidate?.content?.parts ?? []) {
        const signature = part.thoughtSignature ?? part.thought_signature;
        if (typeof signature === "string" && signature) pendingSignature = signature;
        if (typeof part.text === "string" && part.text) yield { type: part.thought ? "thinking-delta" : "text-delta", text: part.text };
        if (part.functionCall) {
          const fc = part.functionCall;
          if (typeof fc.name !== "string" || !fc.name || (fc.args != null && !object(fc.args))) {
            throw new AntigravityProtocolError(502, "Antigravity returned an invalid function call.");
          }
          const index = calls.length;
          const id = typeof fc.id === "string" && fc.id ? fc.id : `call_${prefix}_${index}`;
          if (ids.has(id)) throw new AntigravityProtocolError(502, `Antigravity repeated function call ID ${id}.`);
          ids.add(id);
          const call: ToolCall = { id, name: fc.name, arguments: JSON.stringify(fc.args ?? {}),
            ...(pendingSignature ? { thoughtSignature: pendingSignature } : {}) };
          pendingSignature = undefined;
          calls.push(call);
          yield { type: "tool-call-start", index, id, name: call.name };
          yield { type: "tool-call-args-delta", index, delta: call.arguments };
        }
      }
      if (candidate?.finishReason) {
        finishReason = String(candidate.finishReason).toLowerCase();
        if (!["stop", "max_tokens"].includes(finishReason)) throw new AntigravityProtocolError(400, `Antigravity ended generation: ${finishReason}`);
        // The terminal candidate is sufficient: some SSE connections stay open.
        // Its nested/wrapper usage has already been consumed above. Closing the
        // iterator now also cancels the reader instead of waiting for TCP EOF.
        break;
      }
    }
    aborted(options.signal);
    if (!finishReason) throw new AntigravityProtocolError(502, "Antigravity stream ended before completion.");
    for (const call of calls) yield { type: "tool-call", call };
    yield { type: "done", finishReason: finishReason === "stop" && calls.length ? "tool_calls" : finishReason };
  } finally {
    options.signal?.removeEventListener("abort", cancel);
    // sseData normally owns cleanup. Also release a reader aborted before the
    // generator began, when its finally block never ran.
    await reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}

function platformMetadata() {
  const platform = process.platform === "darwin" ? process.arch === "arm64" ? 2 : 1
    : process.platform === "linux" ? process.arch === "arm64" ? 4 : 3
      : process.platform === "win32" ? 5 : 0;
  return { ideType: 9, platform, pluginType: 2 };
}

export async function resolveAntigravityProject(token: string, options: {
  projectId?: string;
  /** Revalidate a stored project after an upstream not-found response. */
  forceRefresh?: boolean;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  pollDelayMs?: number;
  maxAttempts?: number;
} = {}): Promise<{ projectId: string; tierId?: string }> {
  aborted(options.signal);
  // A saved project belongs to this account; resolving it must not substitute
  // another account's project or generate a fictitious Google Cloud project.
  if (!options.forceRefresh && options.projectId?.trim()) return { projectId: options.projectId.trim() };
  const doFetch = options.fetch ?? fetch;
  const metadata = platformMetadata();
  const post = async (url: string, body: object) => {
    aborted(options.signal);
    const response = await doFetch(url, { method: "POST", headers: antigravityHeaders(token, { purpose: "project" }),
      body: JSON.stringify(body), signal: options.signal });
    if (!response.ok) throw new AntigravityProtocolError(response.status, `Antigravity project setup ${response.status}: ${(await response.text()).slice(0, 500)}`);
    let data: any;
    try { data = await response.json(); } catch { throw new AntigravityProtocolError(502, "Antigravity project setup returned invalid JSON."); }
    aborted(options.signal);
    if (!object(data)) throw new AntigravityProtocolError(502, "Antigravity project setup returned an invalid response.");
    if (data.error) throw new AntigravityProtocolError(Number(data.error.code) || 502, `Antigravity project setup: ${data.error.message || "unknown error"}`);
    return data;
  };
  const project = (data: any): string | undefined => {
    const value = data?.cloudaicompanionProject;
    const id = typeof value === "string" ? value : value?.id;
    return typeof id === "string" && id.trim() ? id.trim() : undefined;
  };
  const loaded = await post(ANTIGRAVITY_CONFIG.loadCodeAssistUrl, { metadata });
  const tiers = Array.isArray(loaded.allowedTiers) ? loaded.allowedTiers : [];
  const tierId = tiers.find((tier: any) => tier?.isDefault)?.id ?? "legacy-tier";
  const loadedProject = project(loaded);
  if (loadedProject) return { projectId: loadedProject, tierId };
  const attempts = Math.max(1, Math.min(10, Math.floor(options.maxAttempts ?? 5)));
  for (let attempt = 0; attempt < attempts; attempt++) {
    const onboard = await post(ANTIGRAVITY_CONFIG.onboardUserUrl, { tierId, metadata });
    const provisioned = project(onboard.response) ?? project(onboard);
    if (provisioned) return { projectId: provisioned, tierId };
    if (onboard.done) {
      const resolved = project(await post(ANTIGRAVITY_CONFIG.loadCodeAssistUrl, { metadata }));
      if (resolved) return { projectId: resolved, tierId };
      break;
    }
    if (attempt + 1 < attempts) await new Promise<void>((resolve, reject) => {
      const cleanup = () => options.signal?.removeEventListener("abort", onAbort);
      const timer = setTimeout(() => { cleanup(); resolve(); }, Math.max(0, options.pollDelayMs ?? 1000));
      const onAbort = () => { clearTimeout(timer); cleanup(); reject(options.signal?.reason ?? new DOMException("Aborted", "AbortError")); };
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (options.signal?.aborted) onAbort();
    });
  }
  throw new AntigravityProtocolError(400, "Antigravity did not provision a Code Assist project. Reconnect this Google account after completing Code Assist setup.");
}
