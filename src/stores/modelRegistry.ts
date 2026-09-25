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
import { providerApiKeyPool } from "../agent/provider/apiKeyPool";
import { OAUTH_KINDS } from "../shared/oauthProviders";
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
let refreshQueued = false;
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
  const invalidate = () => {
    refreshQueued = true;
    void refreshAllModels();
  };
  featureStore.onDidChange(invalidate);
  oauth.onOAuthStatus(invalidate);
  invalidate();
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
  setRemoteEmbedModel({ id, baseUrl: provider.baseUrl, apiKey: "", apiKeyPool: providerApiKeyPool(provider, deps.featureStore, deps.settingsManager) });
}

/** Fetch models from every ENABLED provider, grouped by provider. Coalesced. */
export function refreshAllModels(): Promise<AllModels> {
  if (inflight) return inflight;
  inflight = (async () => {
    let result: AllModels;
    do {
      refreshQueued = false;
      result = await doFetch();
      // A configuration or account change during discovery needs another pass.
      // Do not publish the old snapshot while the new provider is still missing.
    } while (refreshQueued);
    cache = result;
    listeners.forEach(fn => fn(result));
    const em = deps?.featureStore.get().embedModel;
    if (em && !EMBED_MODELS.some(m => m.id === em)) void applyEmbedModel(em);
    return result;
  })().finally(() => {
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
  const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> => {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([p, new Promise<T>((_, rej) => { timer = setTimeout(() => rej(new Error("timeout")), ms); })])
      .finally(() => clearTimeout(timer));
  };

  const [providerBatches, ...oauthBatches] = await Promise.all([
    Promise.all(
      enabled.map(async (p) => {
        const anthropic = p.kind === "anthropic";
        try {
          const fetched = await listModels(p.baseUrl, "", anthropic, { apiKeyPool: providerApiKeyPool(p, featureStore, settingsManager), signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
          return fetched.map((m) => ({ id: m.id, p }));
        } catch {
          return [] as { id: string; p: typeof p }[];
        }
      }),
    ),
    ...OAUTH_KINDS.map(async (kind) => {
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
      // The same upstream model can belong to several independently configured
      // providers. Only collapse duplicates within one provider's response.
      const identity = `${p.id}::${id}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
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
    const k = kind;
    for (const id of ids) {
      const identity = `oauth:${kind}::${id}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
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

  // Legacy flat consumers need names, while grouped settings use providerId
  // together with id and must retain every available provider's entry.
  return { models: [...new Set(list.map((m) => m.id))], modelList: list };
}
