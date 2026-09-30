/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { randomUUID } from "node:crypto";
import { getProviderApiKeys, PROVIDER_PRESETS, type FeatureConfig, type FeatureStore, type ProviderConfig, type ProviderKind } from "./featureStore";
import type { SettingsManager } from "./settingsManager";

function nextKeyLabel(keys: { label: string }[]): string {
  const labels = new Set(keys.map(key => key.label));
  let suffix = 1;
  while (labels.has(`Key ${suffix}`)) suffix++;
  return `Key ${suffix}`;
}

export interface ProviderKeyAction {
  action: "add" | "update" | "remove" | "toggle" | "setBalance" | "removeProvider" | "connect";
  providerId: string;
  kind?: ProviderKind;
  keyId?: string;
  label?: string;
  apiKey?: string;
  enabled?: boolean;
  strategy?: "first" | "round-robin";
  baseUrl?: string;
}

class ValidationError extends Error {}
type SecretStore = Pick<SettingsManager, "getProviderKey" | "setProviderKey">;
type ConfigStore = Pick<FeatureStore, "get" | "set">;

/** One queue protects the read/modify/write metadata and SecretStorage transaction. */
export class ProviderKeyStore {
  private pending: Promise<unknown> = Promise.resolve();
  private readonly managed = new Set<string>();

  constructor(private readonly features: ConfigStore, private readonly secrets: SecretStore) {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.pending.then(operation);
    this.pending = next.catch(() => undefined);
    return next;
  }

  async annotate(provider: ProviderConfig): Promise<ProviderConfig> {
    const apiKeys = (await Promise.all(getProviderApiKeys(provider).map(async key => ({
      ...key, hasKey: !!(await this.secrets.getProviderKey(key.id)),
    })))).filter(key => Array.isArray(provider.apiKeys) || key.hasKey);
    return { ...provider, apiKeys, hasKey: apiKeys.some(key => key.hasKey) };
  }

  /** Preserve host-owned credential metadata when other settings save a stale full snapshot. */
  saveFeatures(patch: Partial<FeatureConfig>): Promise<FeatureConfig> {
    return this.serialize(async () => {
      if (!patch.providers) return this.features.set(patch);
      const current = this.features.get().providers;
      const byId = new Map(current.map(provider => [provider.id, provider]));
      const incoming = patch.providers.filter(provider => !this.managed.has(provider.id) || byId.has(provider.id));
      const providers = incoming.map(provider => {
        const stored = byId.get(provider.id);
        // Configuration forms can still change names, URLs and provider-level enablement.
        const { apiKeys: _keys, apiKeyBalance: _balance, hasKey: _hasKey, ...config } = provider;
        return stored ? { ...config, apiKeys: stored.apiKeys, apiKeyBalance: stored.apiKeyBalance } : config;
      });
      for (const provider of current) {
        if ((this.managed.has(provider.id) || provider.id.startsWith("popular:") && Array.isArray(provider.apiKeys))
          && !providers.some(item => item.id === provider.id)) providers.push(provider);
      }
      return this.features.set({ ...patch, providers });
    });
  }

  action(message: ProviderKeyAction): Promise<ProviderConfig | undefined> {
    return this.serialize(() => this.apply(message));
  }

  saveLegacy(providerId: string, apiKey: string): Promise<void> {
    return this.serialize(async () => {
      const previous = (await this.secrets.getProviderKey(providerId)) || "";
      try {
        await this.secrets.setProviderKey(providerId, apiKey);
        const config = this.features.get();
        const provider = config.providers.find(item => item.id === providerId);
        if (provider && Array.isArray(provider.apiKeys)) {
          let apiKeys = getProviderApiKeys(provider);
          if (!apiKey.trim()) apiKeys = apiKeys.filter(key => key.id !== providerId);
          else if (!apiKeys.some(key => key.id === providerId)) apiKeys.push({ id: providerId, label: nextKeyLabel(apiKeys), enabled: true });
          await this.features.set({ providers: config.providers.map(item => item.id === providerId ? { ...item, apiKeys } : item) });
        }
      } catch {
        try { await this.secrets.setProviderKey(providerId, previous); } catch { /* The caller receives a failure, never a false success. */ }
        throw new Error("Could not save the API key changes. Please try again.");
      }
    });
  }

  private async apply(message: ProviderKeyAction): Promise<ProviderConfig | undefined> {
    const mutations: { id: string; before: string; after: string }[] = [];
    const applied: typeof mutations = [];
    try {
      if (typeof message.providerId !== "string" || !message.providerId) throw new ValidationError("Choose a provider.");
      const config = this.features.get();
      const previous = config.providers.find(provider => provider.id === message.providerId);
      let provider: ProviderConfig;
      if (previous) provider = { ...previous };
      else {
        const preset = message.kind && Object.prototype.hasOwnProperty.call(PROVIDER_PRESETS, message.kind) ? PROVIDER_PRESETS[message.kind] : undefined;
        const permitted = message.action === "add" ? preset?.needsKey : message.action === "connect" && preset?.noAuth;
        if (!permitted || !preset || message.providerId !== `popular:${message.kind}`) throw new ValidationError("Provider not found.");
        let baseUrl = preset.baseUrl;
        if (preset.needsEndpoint) {
          try {
            const input = typeof message.baseUrl === "string" ? message.baseUrl.trim() : "";
            const url = new URL(input);
            if (!["https:", "http:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash || /[{}]/.test(input)) throw new Error();
            baseUrl = input.replace(/\/+$/, "");
          } catch { throw new ValidationError("Enter your provider's complete HTTP or HTTPS endpoint without credentials or placeholders."); }
        }
        provider = { id: message.providerId, kind: message.kind!, name: message.kind === "openai" ? "OpenAI" : preset.label,
          baseUrl, enabled: true, apiKeys: [] };
      }
      const keyValues = new Map<string, string>();
      let keys = getProviderApiKeys(provider);
      for (const key of keys) keyValues.set(key.id, (await this.secrets.getProviderKey(key.id)) || "");
      if (!Array.isArray(provider.apiKeys)) keys = keys.filter(key => !!keyValues.get(key.id));
      const index = keys.findIndex(key => key.id === message.keyId);
      const label = typeof message.label === "string" ? message.label.trim().slice(0, 100) : undefined;
      const raw = typeof message.apiKey === "string" ? message.apiKey.trim() : "";
      const change = (id: string, after: string) => mutations.push({ id, before: keyValues.get(id) || "", after });
      const checkDuplicate = (except?: string) => {
        if ([...keyValues].some(([id, value]) => id !== except && value && value === raw)) throw new ValidationError("This API key is already added to this provider.");
      };
      let removeProvider = false;
      if (raw && PROVIDER_PRESETS[provider.kind]?.authMode === "serviceAccount") {
        try {
          const value = JSON.parse(raw);
          const serviceAccount = value.type === "service_account" && value.private_key && value.client_email && value.project_id;
          const adc = value.type === "authorized_user" && value.client_id && value.client_secret && value.refresh_token && value.quota_project_id;
          if (!serviceAccount && !adc) throw new Error();
        } catch { throw new ValidationError("Paste valid Google service-account JSON with project_id, or ADC JSON with quota_project_id."); }
      }
      switch (message.action) {
        case "connect":
          if (!PROVIDER_PRESETS[provider.kind]?.noAuth) throw new ValidationError("This provider requires credentials.");
          if (raw) throw new ValidationError("This provider does not require an API key.");
          break;
        case "add": {
          if (!raw) throw new ValidationError("Enter an API key.");
          checkDuplicate();
          const id = `${provider.id}:key:${randomUUID()}`;
          change(id, raw);
          keys.push({ id, label: label || nextKeyLabel(keys), enabled: true });
          provider.apiKeyBalance ??= previous && keys.length > 1 ? "first" : "round-robin";
          break;
        }
        case "update":
          if (index < 0) throw new ValidationError("API key not found for this provider.");
          if (label) keys[index] = { ...keys[index], label };
          if (raw) { checkDuplicate(message.keyId); change(message.keyId!, raw); }
          break;
        case "toggle":
          if (index < 0) throw new ValidationError("API key not found for this provider.");
          if (typeof message.enabled !== "boolean") throw new ValidationError("Choose whether this key is enabled.");
          keys[index] = { ...keys[index], enabled: message.enabled };
          break;
        case "remove":
          if (index < 0) throw new ValidationError("API key not found for this provider.");
          change(message.keyId!, "");
          keys.splice(index, 1);
          removeProvider = !keys.length && provider.id.startsWith("popular:");
          break;
        case "setBalance":
          if (message.strategy !== "first" && message.strategy !== "round-robin") throw new ValidationError("Choose a supported key balancing strategy.");
          provider.apiKeyBalance = message.strategy;
          break;
        case "removeProvider":
          for (const key of keys) change(key.id, "");
          // Also clean up an old legacy secret if metadata no longer references it.
          if (!keys.some(key => key.id === provider.id)) {
            keyValues.set(provider.id, (await this.secrets.getProviderKey(provider.id)) || "");
            change(provider.id, "");
          }
          removeProvider = true;
          break;
        default: throw new ValidationError("Unsupported API key action.");
      }
      const { hasKey: _hasKey, ...metadata } = provider;
      provider = { ...metadata, apiKeys: keys };
      const providers = config.providers.filter(item => item.id !== provider.id);
      if (!removeProvider) {
        const originalIndex = config.providers.findIndex(item => item.id === provider.id);
        providers.splice(originalIndex < 0 ? providers.length : originalIndex, 0, provider);
      }
      for (const mutation of mutations) {
        // Record before writing: a storage implementation can reject after its write.
        applied.push(mutation);
        await this.secrets.setProviderKey(mutation.id, mutation.after);
      }
      await this.features.set({ providers });
      this.managed.add(provider.id);
      for (const mutation of mutations) keyValues.set(mutation.id, mutation.after);
      const annotated = keys.map(key => ({ ...key, hasKey: !!keyValues.get(key.id) }));
      return removeProvider ? undefined : { ...provider, apiKeys: annotated, hasKey: annotated.some(key => key.hasKey) };
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      let rollbackFailed = false;
      for (const mutation of applied.reverse()) {
        try { await this.secrets.setProviderKey(mutation.id, mutation.before); }
        catch { rollbackFailed = true; }
      }
      // Storage exceptions can contain the supplied secret. Never relay them to the webview.
      throw new Error(rollbackFailed
        ? "Could not finish saving the API key changes. Reload settings and check the affected keys."
        : "Could not save the API key changes. Please try again.");
    }
  }
}
