/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { createHash } from "crypto";
import type { ProtocolRecord, ProtocolValue, ProtocolCredentials, ProtocolError } from "../wireTypes.js";
import type { ExecutorConfig, ExecutorRequest, ExecutorResult, ExecutorLogger, TokenRefreshResult } from "./types.js";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { getProviderModels } from "../config/providerModels.js";
import { parseVertexSaJson, refreshVertexToken, refreshGoogleToken } from "../services/tokenRefresh.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// Registry entry for a model, ignoring a "(level)" thinking suffix.
// Mirrors 9router config/providerModels.js getModelMeta.
function getModelMeta(provider: string, model: string): ProtocolRecord | null {
  const base = typeof model === "string" ? model.replace(/\([^()]+\)\s*$/, "").trim() : model;
  return getProviderModels(provider).find((m: ProtocolRecord) => m.id === model || m.id === base) || null;
}

// Cache project IDs resolved from raw API keys { apiKey → projectId }
const projectIdCache = new Map();

// ADC authorized_user access tokens { sha256(client_id + refresh_token) → token },
// so each request does not hit Google's token endpoint. Keyed by hash to keep
// the refresh token itself out of long-lived memory structures.
const adcTokenCache = new Map<string, { accessToken: string; expiresAt: number }>();
const ADC_EXPIRY_SKEW_MS = 60_000;

export async function authorizedUserToken(adcJson: { refresh_token: string; client_id: string; client_secret: string }, log?: ExecutorLogger, now = Date.now): Promise<string> {
  const key = createHash("sha256").update(`${adcJson.client_id}\0${adcJson.refresh_token}`).digest("hex");
  const cached = adcTokenCache.get(key);
  if (cached && now() < cached.expiresAt) return cached.accessToken;
  const result = await refreshGoogleToken(adcJson.refresh_token, adcJson.client_id, adcJson.client_secret, log);
  if (!result?.accessToken) {
    adcTokenCache.delete(key);
    throw new Error("Vertex: failed to refresh access token from ADC JSON (authorized_user)");
  }
  const seconds = Number(result.expiresIn);
  const lifetimeMs = (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000;
  if (lifetimeMs > ADC_EXPIRY_SKEW_MS) adcTokenCache.set(key, { accessToken: result.accessToken, expiresAt: now() + lifetimeMs - ADC_EXPIRY_SKEW_MS });
  if (adcTokenCache.size > 100) adcTokenCache.delete(adcTokenCache.keys().next().value!);
  return result.accessToken;
}

/**
 * Parse Google ADC user credential JSON from apiKey string.
 * This is the format produced by `gcloud auth application-default login`.
 */
function parseVertexAdcJson(apiKey: ProtocolValue) {
  if (typeof apiKey !== "string") return null;
  try {
    const parsed = JSON.parse(apiKey);
    if (
      parsed.type === "authorized_user" &&
      parsed.client_id &&
      parsed.client_secret &&
      parsed.refresh_token
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve GCP project ID from a raw Vertex API key.
 * Sends a dummy 404 request and parses "projects/{id}" from the error message.
 */
async function resolveProjectId(apiKey: ProtocolValue) {
  if (projectIdCache.has(apiKey)) return projectIdCache.get(apiKey);

  const res = await fetch(
    `https://aiplatform.googleapis.com/v1/publishers/google/models/__probe__:generateContent?key=${apiKey}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
  );
  const json = await res.json().catch(() => null) as ProtocolRecord | ProtocolRecord[] | null;
  const detail = Array.isArray(json) ? json[0] : json;
  const msg = String(detail?.error?.message || "");
  const match = msg.match(/projects\/([^/]+)\//);
  const projectId = match?.[1] || null;

  if (projectId) projectIdCache.set(apiKey, projectId);
  return projectId;
}

/**
 * VertexExecutor - Google Cloud Vertex AI
 *
 * "vertex"         → Gemini models via regional/global Vertex endpoint
 * "vertex-partner" → Partner models (Llama, Mistral, GLM, DeepSeek, Qwen)
 *                    via global OpenAI-compatible endpoint
 *
 * Auth: SA JSON (stored as apiKey) → JWT assertion → Bearer token (via jose)
 * Token is minted/cached in tokenRefresh.js, not here.
 */
export class VertexExecutor extends BaseExecutor {
  constructor(providerId = "vertex") {
    super(providerId, PROVIDERS[providerId] || {});
  }

  buildUrl(model: string, stream: boolean, urlIndex = 0, credentials: ProtocolCredentials | null = null) {
    const saJson = parseVertexSaJson(credentials?.apiKey);
    const adcJson = parseVertexAdcJson(credentials?.apiKey);
    const usesOAuth = !!saJson || !!adcJson || !!credentials?.accessToken;
    const rawKey = !usesOAuth ? credentials?.apiKey : null;
    const projectId =
      saJson?.project_id ||
      adcJson?.quota_project_id ||
      credentials?.providerSpecificData?.projectId;

    if (this.provider === "vertex-partner") {
      // Partner models require project_id in path regardless of auth method
      if (!projectId) throw new Error("Vertex partner models require a project_id. Add it in providerSpecificData or use Service Account JSON.");
      const url = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/endpoints/openapi/chat/completions`;
      return rawKey ? `${url}?key=${rawKey}` : url;
    }

    // Gemini on Vertex
    const action = stream ? "streamGenerateContent" : "generateContent";

    if (usesOAuth) {
      // SA JSON / ADC / pre-set accessToken: must use project-scoped path to avoid RESOURCE_PROJECT_INVALID
      if (!projectId) {
        throw new Error(
          "Vertex OAuth/ADC requires a project_id. " +
          "Add quota_project_id to your ADC JSON or set providerSpecificData.projectId."
        );
      }
      // Global-only models (registry defaultLocation, e.g. Argon) must not fall back to a regional location.
      const location = credentials?.providerSpecificData?.location
        || getModelMeta(this.provider, model)?.defaultLocation
        || "us-central1";
      let url = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:${action}`;
      if (stream) url += "?alt=sse";
      return url;
    }

    // Raw API keys with an explicit project must honor its location (e.g. Argon on global).
    // Keep the projectless endpoint for existing connections without a configured project.
    // ?alt=sse is required for proper SSE streaming (matches every other Gemini executor)
    const location = credentials?.providerSpecificData?.location || "global";
    let url = projectId
      ? `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:${action}`
      : `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:${action}`;
    if (stream) url += "?alt=sse";
    if (rawKey) url += stream ? `&key=${rawKey}` : `?key=${rawKey}`;
    return url;
  }

  buildHeaders(credentials: ProtocolCredentials, stream = true) {
    const headers: Record<string,string> = { "Content-Type": "application/json" };

    // Only set Bearer token if using SA JSON flow (raw key goes in URL ?key=)
    if (credentials.accessToken) {
      headers["Authorization"] = `Bearer ${credentials.accessToken}`;
    }

    if (stream) headers["Accept"] = "text/event-stream";

    return headers;
  }

  async refreshCredentials(credentials: ProtocolCredentials, log: ExecutorLogger | undefined) {
    const saJson = parseVertexSaJson(credentials?.apiKey);
    if (!saJson) return null;

    const result = await refreshVertexToken(saJson, log);
    if (!result) return null;

    return { accessToken: result.accessToken, expiresAt: result.expiresAt };
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }: ExecutorRequest) {
    const saJson = parseVertexSaJson(credentials?.apiKey);
    const adcJson = parseVertexAdcJson(credentials?.apiKey);

    // SA JSON flow: mint Bearer token via JWT assertion (cached)
    if (saJson) {
      const result = await refreshVertexToken(saJson, log);
      if (!result?.accessToken) throw new Error("Vertex: failed to mint access token from Service Account JSON");
      credentials.accessToken = result.accessToken;
    }

    // ADC user credential flow: refresh Bearer token via Google OAuth2 token endpoint
    if (adcJson) {
      credentials.accessToken = await authorizedUserToken(adcJson, log);
    }

    // vertex-partner with raw key: auto-resolve project_id if not provided
    if (this.provider === "vertex-partner" && !saJson && !adcJson && !credentials?.providerSpecificData?.projectId) {
      const projectId = await resolveProjectId(credentials.apiKey);
      if (!projectId) throw new Error("Vertex: could not resolve project_id from API key. Please add it manually in provider settings.");
      log?.debug?.("VERTEX", `Resolved project_id: ${projectId}`);
      credentials.providerSpecificData = { ...credentials.providerSpecificData, projectId };
    }

    const url = this.buildUrl(model, stream, 0, credentials);
    const headers = this.buildHeaders(credentials, stream);
    const transformedBody = this.transformRequest(model, body, stream, credentials);

    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(transformedBody),
      signal,
    }, proxyOptions);

    return { response, url, headers, transformedBody };
  }
}

export default VertexExecutor;
