/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// Backend-owned model registry: fetches the full provider-grouped model list
// once at activation (and on config/OAuth changes), so UIs like the settings
// panel are just views over already-loaded data — no per-page fetch/wait.
import { listModels } from "../agent/provider";
import * as oauth from "../agent/oauth";
import { FeatureStore, providerEnabled, type ModelDef } from "./featureStore";
import type { SettingsManager } from "./settingsManager";
import { setEmbedModel, setRemoteEmbedModel, EMBED_MODELS } from "../agent/semanticIndex";

export interface AllModels {
  models: string[];
  modelList: ModelDef[];
}

let cache: AllModels | null = null;
let deps: { featureStore: FeatureStore; settingsManager: SettingsManager } | null = null;
let inflight: Promise<AllModels> | null = null;
const listeners = new Set<(d: AllModels) => void>();

export function getAllModels(): AllModels | null {
  return cache;
}

export function onAllModels(cb: (d: AllModels) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Call once at activation. Prefetches and keeps the list fresh. */
export function initModelRegistry(featureStore: FeatureStore, settingsManager: SettingsManager) {
  deps = { featureStore, settingsManager };
  featureStore.onDidChange(() => void refreshAllModels());
  oauth.onOAuthStatus(() => void refreshAllModels());
  void refreshAllModels();
}

/**
 * Configure semanticIndex for the given embed model id: a built-in local model
 * id (e.g. "minilm") or a provider model id (e.g. "text-embedding-3-small"),
 * resolved to its provider baseUrl + key via the registry cache.
 */
export async function applyEmbedModel(id: string): Promise<void> {
  if (!id || EMBED_MODELS.some((m) => m.id === id)) {
    setEmbedModel(id || "minilm");
    return;
  }
  if (!deps) return;
  const def = (cache?.modelList ?? []).find((m) => m.id === id);
  const provider = def && deps.featureStore.get().providers.find((p) => p.id === def.providerId);
  if (!provider) {
    setEmbedModel("minilm"); // provider gone → fall back to local
    return;
  }
  const key = (await deps.settingsManager.getProviderKey(provider.id)) || "";
  setRemoteEmbedModel({ id, baseUrl: provider.baseUrl, apiKey: key });
}

/** Fetch models from every ENABLED provider, grouped by provider. Coalesced. */
export function refreshAllModels(): Promise<AllModels> {
  if (inflight) return inflight;
  inflight = doFetch().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function doFetch(): Promise<AllModels> {
  if (!deps) return { models: [], modelList: [] };
  const { featureStore, settingsManager } = deps;
  const features = featureStore.get();
  const enabled = features.providers.filter(providerEnabled);
  const list: ModelDef[] = [];
  const seen = new Set<string>();

  // All providers + OAuth in parallel (was sequential — multi-provider lag).
  // Per-provider timeout prevents a slow/unresponsive provider from blocking startup.
  const PROVIDER_TIMEOUT_MS = 8000;
  const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
    Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

  const [providerBatches, ...oauthBatches] = await Promise.all([
    Promise.all(
      enabled.map(async (p) => {
        const key = (await settingsManager.getProviderKey(p.id)) || "";
        const anthropic = p.kind === "anthropic";
        if (!key && anthropic) return [] as { id: string; p: typeof p }[];
        try {
          const fetched = await withTimeout(listModels(p.baseUrl, key, anthropic), PROVIDER_TIMEOUT_MS);
          return fetched.map((m) => ({ id: m.id, p }));
        } catch {
          return [] as { id: string; p: typeof p }[];
        }
      }),
    ),
    ...(["claude-code", "codex", "antigravity"] as oauth.OAuthKind[]).map(async (kind) => {
      if (!oauth.isConnected(kind)) return { kind, ids: [] as string[] };
      try {
        return { kind, ids: await withTimeout(oauth.listOAuthModels(kind), PROVIDER_TIMEOUT_MS) };
      } catch {
        return { kind, ids: [] as string[] };
      }
    }),
  ]);

  for (const batch of providerBatches) {
    for (const { id, p } of batch) {
      if (seen.has(id)) continue;
      seen.add(id);
      list.push({
        id,
        name: featureStore.nameFor(id, p.kind),
        kind: p.kind,
        options: featureStore.optionsFor(id, p.kind),
        providerId: p.id,
        providerName: p.name,
      });
    }
  }

  for (const { kind, ids } of oauthBatches) {
    if (!ids.length) continue;
    const label = oauth.OAUTH_LABEL[kind];
    const k = kind === "claude-code" ? "anthropic" : kind === "codex" ? "openai" : "google";
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      list.push({
        id,
        name: featureStore.nameFor(id, kind),
        kind: k as ModelDef["kind"],
        options: featureStore.optionsFor(id, kind),
        providerId: `oauth:${kind}`,
        providerName: label,
      });
    }
  }

  cache = { models: list.map((m) => m.id), modelList: list };
  listeners.forEach((fn) => fn(cache!));
  // Re-resolve a remote embedding model now that provider info is loaded.
  const em = features.embedModel;
  if (em && !EMBED_MODELS.some((m) => m.id === em)) void applyEmbedModel(em);
  return cache;
}
