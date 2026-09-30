/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { ProtocolValue, ProtocolRecord, ProtocolError, ProtocolCredentials } from "../wireTypes.js";
import { createHash } from "crypto";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
export const KIMCHI_API = "https://llm.kimchi.dev";
export const KIMCHI_USER_AGENT = "kimchi/0.1.40";
const FETCH_TIMEOUT_MS = 20000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
/** @type {Map<string, { expiresAt: number, models: object[], rawModels: object[] }>} */
const catalogCache = new Map();
/** @type {Map<string, object>} */
const metadataByModelId = new Map();
function normalizeKimchiEndpoint(endpoint: ProtocolValue) {
    const raw = typeof endpoint === "string" ? endpoint.trim() : "";
    return (raw || KIMCHI_API).replace(/\/+$/, "");
}
export function buildKimchiModelsUrl(endpoint: ProtocolValue) {
    return `${normalizeKimchiEndpoint(endpoint)}/v1/models/metadata?include_in_cli=true`;
}
function readToken(credentials: ProtocolCredentials) {
    return (credentials?.accessToken
        || credentials?.apiKey
        || credentials?.providerSpecificData?.apiKey
        || null);
}
function cacheKey(credentials: ProtocolCredentials, endpoint: ProtocolValue) {
    const psd = credentials?.providerSpecificData || {};
    const seed = psd.userId || psd.username || credentials?.refreshToken || readToken(credentials) || "anonymous";
    return createHash("sha256")
        .update(`kimchi:${normalizeKimchiEndpoint(endpoint)}:${seed}`)
        .digest("hex");
}
function toModelKind(inputModalities: ProtocolValue) {
    return Array.isArray(inputModalities) && inputModalities.includes("image")
        ? "imageToText"
        : "llm";
}
export function normalizeKimchiModel(item: ProtocolValue) {
    if (!item || typeof item !== "object")
        return null;
    const id = item.slug || item.id || item.model || item.name;
    if (typeof id !== "string" || id.trim() === "")
        return null;
    const inputModalities = Array.isArray(item.input_modalities)
        ? item.input_modalities.filter((value: ProtocolValue) => value === "text" || value === "image")
        : [];
    const limits = item.limits && typeof item.limits === "object" ? item.limits : {};
    const contextLength = Number(limits.context_window || item.contextLength || item.context_length) || undefined;
    const maxOutputTokens = Number(limits.max_output_tokens || item.maxOutputTokens || item.max_output_tokens) || undefined;
    const upstreamProvider = typeof item.provider === "string" ? item.provider : "";
    const reasoning = item.reasoning === true;
    const kind = toModelKind(inputModalities);
    const model: ProtocolRecord = {
        ...item,
        id: id.trim(),
        name: String(item.display_name || item.displayName || item.name || id).trim(),
        provider: upstreamProvider,
        upstreamProvider,
        reasoning,
        inputModalities,
        kind,
        type: kind,
        capabilities: {
            vision: inputModalities.includes("image"),
            reasoning,
            ...(contextLength ? { contextWindow: contextLength } : {}),
            ...(maxOutputTokens ? { maxOutput: maxOutputTokens } : {}),
            ...(upstreamProvider ? { upstreamProvider } : {}),
        },
        ...(contextLength ? { contextLength } : {}),
        ...(maxOutputTokens ? { maxOutputTokens } : {}),
    };
    if (upstreamProvider === "anthropic") {
        model.compat = { supportsReasoningEffort: false, cacheControlFormat: "anthropic" };
    }
    return model;
}
function rememberModels(models: ProtocolValue) {
    for (const model of models || []) {
        if (!model?.id)
            continue;
        metadataByModelId.set(model.id, model);
        metadataByModelId.set(model.id.toLowerCase(), model);
    }
}
export function getCachedKimchiModelMetadata(modelId: string) {
    if (typeof modelId !== "string" || modelId.trim() === "")
        return null;
    const raw = modelId.includes("/") ? modelId.split("/").pop()! : modelId;
    return metadataByModelId.get(raw) || metadataByModelId.get(raw.toLowerCase()) || null;
}
async function fetchKimchiCatalogRaw(token: ProtocolValue, endpoint: ProtocolValue, options: ProtocolRecord = {}) {
    const url = buildKimchiModelsUrl(endpoint);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("Kimchi models fetch timeout")), FETCH_TIMEOUT_MS);
    const signal = options.signal
        ? AbortSignal.any([options.signal, controller.signal])
        : controller.signal;
    try {
        const response = await proxyAwareFetch(url, {
            method: "GET",
            headers: {
                "Accept": "application/json",
                "Authorization": `Bearer ${token}`,
                "User-Agent": KIMCHI_USER_AGENT,
            },
            cache: "no-store",
            signal,
        }, options.proxyOptions || null);
        if (!response.ok) {
            const error: ProtocolError = new Error(`Kimchi models ${response.status}: ${response.statusText}`);
            error.status = response.status;
            error.retryable = RETRYABLE_STATUSES.has(response.status);
            throw error;
        }
        const data: ProtocolValue = await response.json();
        return Array.isArray(data?.models) ? data.models : [];
    }
    finally {
        clearTimeout(timeout);
    }
}
export async function resolveKimchiModels(credentials: ProtocolCredentials, options: ProtocolRecord = {}) {
    const token = readToken(credentials);
    if (!token)
        return null;
    const endpoint = credentials?.providerSpecificData?.kimchiEndpoint || options.endpoint || KIMCHI_API;
    const key = cacheKey(credentials, endpoint);
    const now = Date.now();
    if (!options.forceRefresh) {
        const cached = catalogCache.get(key);
        if (cached && cached.expiresAt > now)
            return cached;
    }
    let rawModels: ProtocolValue;
    try {
        rawModels = await fetchKimchiCatalogRaw(token, endpoint, options);
    }
    catch (caughtError) {
        const error = caughtError as ProtocolError;
        options.log?.warn?.("KIMCHI_MODELS", error.message);
        return null;
    }
    const models = rawModels.map(normalizeKimchiModel).filter(Boolean);
    if (models.length === 0)
        return null;
    rememberModels(models);
    const entry: ProtocolRecord = {
        expiresAt: Date.now() + CACHE_TTL_MS,
        models,
        rawModels,
    };
    catalogCache.set(key, entry);
    return entry;
}
export function clearKimchiCatalog() {
    catalogCache.clear();
    metadataByModelId.clear();
}
