/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { ProtocolRecord, ProtocolValue, ProtocolCredentials, ProtocolError } from "../wireTypes.js";
import type { ExecutorConfig, ExecutorRequest, ExecutorResult, ExecutorLogger, TokenRefreshResult } from "./types.js";
import { DefaultExecutor } from "./default.js";
import { getCachedKimchiModelMetadata } from "../services/kimchiModels.js";

const TOP_LEVEL_OPENAI_GATEWAY_DROPS = [
  "anthropic_version",
  "anthropic_beta",
  "client_metadata",
  "mcp_servers",
  "stop_sequences",
  "thinking",
  "top_k",
];

function systemToText(system: ProtocolValue) {
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system
      .map((part: ProtocolRecord) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function mergeTopLevelSystem(body: ProtocolRecord) {
  if (!body?.system || !Array.isArray(body.messages)) return;
  const text = systemToText(body.system).trim();
  if (!text) return;

  const existing = body.messages.find((msg: ProtocolValue) => msg?.role === "system");
  if (!existing) {
    body.messages.unshift({ role: "system", content: text });
    return;
  }

  if (typeof existing.content === "string") {
    existing.content = `${text}\n\n${existing.content}`;
  } else if (Array.isArray(existing.content)) {
    existing.content.unshift({ type: "text", text });
  }
}

function stripMessageArtifacts(body: ProtocolRecord) {
  if (!Array.isArray(body?.messages)) return;
  for (const msg of body.messages) {
    if (!msg || typeof msg !== "object") continue;
    delete msg.cache_control;
    if (!Array.isArray(msg.content)) continue;
    msg.content = msg.content.map((part: ProtocolRecord) => {
      if (!part || typeof part !== "object") return part;
      const { cache_control, signature, ...clean } = part;
      return clean;
    });
  }
}

function stripToolArtifacts(body: ProtocolRecord) {
  if (!Array.isArray(body?.tools)) return;
  body.tools = body.tools.map((tool: ProtocolRecord) => {
    if (!tool || typeof tool !== "object") return tool;
    const { cache_control, ...clean } = tool;
    return clean;
  });
}

// Strip `reasoning_content` echoed by clients on assistant messages — but
// only when it's a real thinking block. `DefaultExecutor.transformRequest`
// runs `injectReasoningContent` first and may inject a 1-char placeholder
// (" ") for upstream validation; the placeholder is small (no token cost
// worth stripping) and stripping it would re-trigger upstream to complain
// about missing reasoning on the next turn. Threshold matches the
// placeholder length with a safety margin.
const REASONING_PLACEHOLDER_MAX_LEN = 8;

export function stripReasoningContent(body: ProtocolRecord) {
  if (!Array.isArray(body?.messages)) return;
  for (const msg of body.messages) {
    if (msg && msg.role === "assistant" && typeof msg.reasoning_content === "string"
        && msg.reasoning_content.length > REASONING_PLACEHOLDER_MAX_LEN) {
      delete msg.reasoning_content;
    }
  }
}

function isAnthropicBackedKimchiModel(model: string) {
  const meta = getCachedKimchiModelMetadata(model);
  if (meta?.provider === "anthropic" || meta?.upstreamProvider === "anthropic") return true;
  return /(^|[-_/])(?:claude|anthropic)(?:[-_/]|$)/i.test(String(model || ""));
}

export class KimchiExecutor extends DefaultExecutor {
  constructor() {
    super("kimchi");
  }

  transformRequest(model: string, body: ProtocolRecord, stream: boolean, credentials: ProtocolCredentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    if (!transformed || typeof transformed !== "object") return transformed;

    mergeTopLevelSystem(transformed);
    for (const key of TOP_LEVEL_OPENAI_GATEWAY_DROPS) {
      if (transformed[key] !== undefined) delete transformed[key];
    }
    delete transformed.system;

    if (isAnthropicBackedKimchiModel(model)) {
      delete transformed.reasoning_effort;
      delete transformed.reasoning;
      delete transformed.thinking;
    }

    stripMessageArtifacts(transformed);
    stripToolArtifacts(transformed);
    stripReasoningContent(transformed);
    return transformed;
  }
}

export default KimchiExecutor;
