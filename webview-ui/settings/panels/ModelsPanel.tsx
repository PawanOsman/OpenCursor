/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as React from "react";
import { Icon } from "../../shared/icons";
import { vscode } from "../../shared/vscode";
import {
  FeatureConfig,
  FREE_KINDS,
  LlamacppStatus,
  ModelDef,
  ModelKind,
  OAUTH_PROVIDERS,
  OllamaModel,
  OAuthStatus,
  POPULAR_KINDS,
  PROVIDER_PRESETS,
  ProviderConfig,
  ProviderKind,
} from "../features";
import { Toggle } from "./Toggle";

// Default and custom models render as flat rows with an enable toggle only;
// their sampling options are configured in the chat model picker.
function ModelRow({ model, enabled, onToggle, onRemove, badge }: { model: ModelDef; enabled: boolean; onToggle: () => void; onRemove?: () => void; badge?: string }) {
  return (
    <div className="model-row">
      <div className="model-name">
        <Icon name="model" />
        <span>{model.name}</span>
        {model.id !== model.name && <span className="row-desc" style={{ marginLeft: 6, opacity: 0.6 }}>{model.id}</span>}
        {badge && <span className="badge-tag" style={{ marginLeft: 8 }}>{badge}</span>}
      </div>
      {onRemove && (
        <button className="icon-btn" onClick={onRemove} title="Remove model"><Icon name="trash" size={14} /></button>
      )}
      <Toggle label={`Enable ${model.name}`} checked={enabled} onChange={onToggle} />
    </div>
  );
}

/** Everything one collapsible provider section needs to render. */
interface ModelSectionSpec {
  key: string;
  title: string;
  /** Status line under the title (connected / not connected / hint). */
  subtitle: string;
  connected: boolean;
  models: ModelDef[];
  /** Enables the add-model-by-id input, tagging new customs to this provider. */
  addTarget?: { providerId: string; kind: ModelKind };
  /** Refresh this provider's model list (undefined = not refreshable). */
  onRefresh?: () => void;
  /** True while a refresh for this section is in flight. */
  refreshing?: boolean;
  /** Last refresh error for this section, if any. */
  refreshError?: string;
  /** Local (llama.cpp/Ollama) sections toggle via disabledLocalModels. */
  local?: boolean;
  /** Extra badge per model id (e.g. "running" for loaded llama.cpp servers). */
  badgeFor?: (id: string) => string | undefined;
}

function ModelSection({
  spec,
  forceOpen,
  enabledFor,
  onToggle,
  onEnableAll,
  isCustom,
  onRemove,
  onAdd,
}: {
  spec: ModelSectionSpec;
  /** Force-expanded (used while searching). */
  forceOpen: boolean;
  enabledFor: (id: string) => boolean;
  onToggle: (id: string) => void;
  onEnableAll: (ids: string[], enable: boolean) => void;
  isCustom: (id: string) => boolean;
  onRemove: (id: string) => void;
  onAdd?: (id: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const expanded = forceOpen || open;
  const enabledCount = spec.models.filter((m) => enabledFor(m.id)).length;
  const add = () => { if (draft.trim() && onAdd) { onAdd(draft.trim()); setDraft(""); } };
  return (
    <div className="feature-card">
      <div className="fc-head" style={{ cursor: "pointer" }} onClick={() => setOpen((v) => !v)}>
        <div className="fc-title-input" style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <Icon name={expanded ? "chevD" : "chevR"} size={14} />
          <span>{spec.title}</span>
          <span className={"badge-tag " + (spec.connected ? "always" : "")}>{spec.connected ? "connected" : "not connected"}</span>
          <span className="row-desc" style={{ whiteSpace: "nowrap" }}>{enabledCount}/{spec.models.length} enabled</span>
        </div>
        {spec.onRefresh && (
          <button
            className="icon-btn"
            title={spec.connected ? "Refresh models from this provider" : "Connect the provider first"}
            disabled={!spec.connected || spec.refreshing}
            onClick={(e) => { e.stopPropagation(); spec.onRefresh!(); }}
          >
            {spec.refreshing ? <span className="llama-spinner" /> : <Icon name="reset" size={14} />}
          </button>
        )}
      </div>
      {expanded && (
        <div className="fc-body">
          <div className="row-desc" style={{ marginBottom: 8 }}>{spec.subtitle}</div>
          {spec.refreshError && <div className="fc-error">{spec.refreshError}</div>}
          {spec.models.length === 0 ? (
            <div className="empty-card">No models{spec.connected ? "" : " — connect this provider in the Providers tab"}.</div>
          ) : (
            <>
              <div className="fc-inline-row" style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                <button className="btn-ghost sm" onClick={() => onEnableAll(spec.models.map((m) => m.id), true)}>Enable all</button>
                <button className="btn-ghost sm" onClick={() => onEnableAll(spec.models.map((m) => m.id), false)}>Disable all</button>
              </div>
              <div className="model-grid">
                {spec.models.map((m) => (
                  <ModelRow
                    key={m.id}
                    model={m}
                    enabled={enabledFor(m.id)}
                    onToggle={() => onToggle(m.id)}
                    onRemove={!spec.local && isCustom(m.id) ? () => onRemove(m.id) : undefined}
                    badge={isCustom(m.id) ? "custom" : spec.badgeFor?.(m.id)}
                  />
                ))}
              </div>
            </>
          )}
          {onAdd && (
            <div className="add-model-row" style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input
                type="text"
                value={draft}
                placeholder="Add model by id (e.g. gpt-6-sol)"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") add(); }}
                style={{ flex: 1 }}
              />
              <button className="btn-ghost" disabled={!draft.trim()} onClick={add}><Icon name="plus" /> Add model</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ModelsPanel({
  models: _models,
  modelList,
  features,
  setFeatures,
  fetchModels,
  catalog,
  llamacppStatus,
  ollamaModels,
  oauthStatus,
}: {
  models: string[];
  modelList: ModelDef[];
  features: FeatureConfig;
  setFeatures: (f: Partial<FeatureConfig>) => void;
  fetchModels: () => void;
  catalog: ModelDef[];
  llamacppStatus: LlamacppStatus;
  ollamaModels: OllamaModel[];
  oauthStatus: OAuthStatus;
}) {
  const [query, setQuery] = React.useState("");
  // Sections with an in-flight refresh (spinner) + last per-provider errors.
  const [refreshing, setRefreshing] = React.useState<Set<string>>(new Set());
  const [refreshErrors, setRefreshErrors] = React.useState<Record<string, string>>({});
  // Models fetched via a per-provider refresh (merged into that section's list).
  const [fetchedExtra, setFetchedExtra] = React.useState<Record<string, string[]>>({});
  const timeoutsRef = React.useRef<Map<string, number>>(new Map());

  const stopRefreshing = React.useCallback((key: string) => {
    setRefreshing((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    const t = timeoutsRef.current.get(key);
    if (t) { window.clearTimeout(t); timeoutsRef.current.delete(key); }
  }, []);

  const startRefreshing = React.useCallback((key: string) => {
    setRefreshing((prev) => new Set(prev).add(key));
    setRefreshErrors((prev) => { const { [key]: _drop, ...rest } = prev; return rest; });
    // Safety: never spin forever if no reply arrives.
    const t = window.setTimeout(() => stopRefreshing(key), 15000);
    timeoutsRef.current.set(key, t);
  }, [stopRefreshing]);

  React.useEffect(() => {
    fetchModels();
    vscode.postMessage({ type: "ollamaGet" });
    const handler = (e: MessageEvent) => {
      const m = e.data;
      if (m?.type === "modelsFetched") {
        if (m.providerId) {
          // Per-provider refresh reply.
          stopRefreshing(m.providerId);
          if (m.error) setRefreshErrors((prev) => ({ ...prev, [m.providerId]: String(m.error).slice(0, 200) }));
          else setFetchedExtra((prev) => ({ ...prev, [m.providerId]: m.models || [] }));
        } else {
          // Global registry push: clears any OAuth/global refreshes.
          setFetchedExtra((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => !key.startsWith("oauth:"))));
          setRefreshing((prev) => {
            const next = new Set([...prev].filter((k) => !k.startsWith("oauth:")));
            return next.size === prev.size ? prev : next;
          });
        }
      } else if (m?.type === "ollamaModels") {
        stopRefreshing("local:ollama");
      } else if (m?.type === "llamacppStatus") {
        stopRefreshing("local:llamacpp");
      }
    };
    window.addEventListener("message", handler);
    return () => {
      window.removeEventListener("message", handler);
      for (const t of timeoutsRef.current.values()) window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Effective enablement mirrors the chat picker: a model is ON when it's in
  // enabledModels OR is a catalog default — unless explicitly disabled.
  const enabled = new Set(features.enabledModels);
  const disabled = new Set(features.disabledModels || []);
  const defaultOn = React.useMemo(
    () => new Set(catalog.filter((m) => m.enabled !== false).map((m) => m.id)),
    [catalog]
  );
  const isModelEnabled = (id: string) => !disabled.has(id) && (enabled.has(id) || defaultOn.has(id));
  const setModelEnabled = (ids: string[], enable: boolean, en = new Set(enabled), dis = new Set(disabled)) => {
    for (const id of ids) {
      if (enable) { dis.delete(id); en.add(id); }
      else { en.delete(id); if (defaultOn.has(id)) dis.add(id); }
    }
    setFeatures({ enabledModels: [...en], disabledModels: [...dis] });
  };
  const toggleModel = (id: string) => setModelEnabled([id], !isModelEnabled(id));
  const enableAll = (ids: string[], enable: boolean) => setModelEnabled(ids, enable);

  // Local models (llama.cpp/Ollama) are shown unless explicitly disabled.
  const disabledLocal = new Set(features.disabledLocalModels || []);
  const localEnabled = (id: string) => !disabledLocal.has(id);
  const toggleLocal = (id: string) => {
    const next = new Set(disabledLocal);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setFeatures({ disabledLocalModels: [...next] });
  };
  const localEnableAll = (ids: string[], enable: boolean) => {
    const next = new Set(disabledLocal);
    for (const id of ids) { if (enable) next.delete(id); else next.add(id); }
    setFeatures({ disabledLocalModels: [...next] });
  };

  const addCustomModel = (id: string, providerId: string, kind: ModelKind) => {
    const name = id.trim();
    if (!name) return;
    if ((features.customModels || []).some((m) => m.id === name)) return;
    setFeatures({
      customModels: [...(features.customModels || []), { id: name, name, kind, options: [], providerId }],
      // New custom models are enabled immediately so they show in the picker.
      enabledModels: [...new Set([...features.enabledModels, name])],
    });
  };
  const removeCustomModel = (id: string) => {
    setFeatures({ customModels: (features.customModels || []).filter((m) => m.id !== id) });
  };
  const isCustom = (id: string) => (features.customModels || []).some((m) => m.id === id);

  const q = query.trim().toLowerCase();
  const match = (m: ModelDef) => !q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
  const localIds = new Set((features.llamacppModels || []).map((m) => m.id));
  const customs = (features.customModels || []).filter((m) => !localIds.has(m.id));

  /** Compose one provider's models: catalog for its kind (popular only) + fetched + customs + per-refresh extras. */
  const modelsFor = (providerId: string, kind: ProviderKind): ModelDef[] => {
    const seen = new Set<string>();
    const list: ModelDef[] = [];
    const push = (m: ModelDef) => { if (!seen.has(m.id)) { seen.add(m.id); list.push(m); } };
    // Custom providers are just "compatible" endpoints — their models come from
    // the endpoint itself (fetched), never from the built-in catalog.
    if (providerId.startsWith("popular:")) {
      for (const m of catalog) if (Array.isArray(m.kind) ? m.kind.includes(kind) : m.kind === kind) push(m);
    }
    for (const m of modelList) if (m.providerId === providerId) push(m);
    for (const m of customs) if (m.providerId === providerId) push(m);
    for (const id of fetchedExtra[providerId] || []) push({ id, name: id, kind });
    return list;
  };

  const refreshProvider = (p: ProviderConfig) => {
    startRefreshing(p.id);
    vscode.postMessage({ type: "fetchModels", apiBaseUrl: p.baseUrl, providerId: p.id, anthropic: p.kind === "anthropic" });
  };

  // Only configured, enabled connections belong on the model management page.
  const sections: ModelSectionSpec[] = [];
  const connectedProvider = (provider: ProviderConfig): boolean => {
    if (provider.enabled === false) return false;
    if (!PROVIDER_PRESETS[provider.kind].needsKey) return true;
    if (provider.apiKeys) return provider.apiKeys.some(key => key.enabled !== false && key.hasKey !== false);
    return !!provider.hasKey || (!provider.id.startsWith("popular:") && modelList.some(model => model.providerId === provider.id));
  };

  for (const kind of [...POPULAR_KINDS, ...FREE_KINDS]) {
    const id = `popular:${kind}`;
    const p = (features.providers || []).find((x) => x.id === id);
    if (!p || !connectedProvider(p)) continue;
    const preset = PROVIDER_PRESETS[kind];
    const connected = true;
    sections.push({
      key: id,
      title: kind === "openai" ? "OpenAI" : preset.label,
      subtitle: connected
        ? `${preset.baseUrl} · toggle models for the chat picker, or add one by id.`
        : "Not connected — add your API key in the Providers tab. Catalog models are shown for reference.",
      connected,
      models: modelsFor(id, kind),
      addTarget: { providerId: id, kind },
      onRefresh: p ? () => refreshProvider(p) : undefined,
      refreshing: refreshing.has(id),
      refreshError: refreshErrors[id],
    });
  }

  for (const p of (features.providers || []).filter((x) => !x.id.startsWith("popular:"))) {
    if (!connectedProvider(p)) continue;
    const preset = PROVIDER_PRESETS[p.kind];
    const connected = true;
    sections.push({
      key: p.id,
      title: p.name || "(unnamed provider)",
      subtitle: `${p.baseUrl} · ${preset.label}`,
      connected,
      models: modelsFor(p.id, p.kind),
      addTarget: { providerId: p.id, kind: p.kind },
      onRefresh: () => refreshProvider(p),
      refreshing: refreshing.has(p.id),
      refreshError: refreshErrors[p.id],
    });
  }

  for (const { kind, label } of OAUTH_PROVIDERS) {
    const id = `oauth:${kind}`;
    const connected = (oauthStatus.accounts || []).some((a) => a.kind === kind && !a.disabled);
    if (!connected) continue;
    const seen = new Set<string>();
    const list: ModelDef[] = [];
    const push = (m: ModelDef) => { if (!seen.has(m.id)) { seen.add(m.id); list.push(m); } };
    const discovered = modelList.filter((m) => m.providerId === id);
    // Antigravity exposes a project-specific model list. A catalog entry or
    // saved custom model must not imply access to an unadvertised model.
    const available = kind === "antigravity" ? new Set(fetchedExtra[id] ?? discovered.map((m) => m.id)) : undefined;
    for (const m of discovered) if (!available || available.has(m.id)) push(m);
    for (const m of catalog) {
      if ((Array.isArray(m.kind) ? m.kind.includes(kind) : m.kind === kind) && (!available || available.has(m.id))) push(m);
    }
    for (const m of customs) if (m.providerId === id && (!available || available.has(m.id))) push(m);
    if (available) for (const modelId of available) push({ id: modelId, name: modelId, kind, providerId: id });
    sections.push({
      key: id,
      title: label,
      subtitle: connected
        ? "Models from your signed-in account. Toggle to show them in the chat picker."
        : "Not connected — sign in from Providers → OAuth Accounts. Catalog models are shown for reference.",
      connected,
      models: list,
      addTarget: { providerId: id, kind },
      onRefresh: () => { startRefreshing(id); fetchModels(); },
      refreshing: refreshing.has(id),
      refreshError: refreshErrors[id],
    });
  }

  sections.push({
    key: "local:llamacpp",
    title: "Local · llama.cpp",
    subtitle: "GGUF models managed in the llama.cpp tab. Selecting one in chat auto-loads its server.",
    connected: llamacppStatus.installed && (features.llamacppModels || []).length > 0,
    models: (features.llamacppModels || []).map((m) => ({ id: m.id, name: m.name, kind: "llamacpp" as ProviderKind })),
    onRefresh: () => { startRefreshing("local:llamacpp"); vscode.postMessage({ type: "llamacppGet" }); },
    refreshing: refreshing.has("local:llamacpp"),
    local: true,
    badgeFor: (id) => (llamacppStatus.running[id] ? "running" : "loads on use"),
  });

  sections.push({
    key: "local:ollama",
    title: "Local · Ollama",
    subtitle: "Models pulled in the Ollama tab, served at localhost:11434.",
    connected: (ollamaModels || []).length > 0,
    models: (ollamaModels || []).map((m) => ({ id: m.name, name: m.name, kind: "ollama" as ProviderKind })),
    onRefresh: () => { startRefreshing("local:ollama"); vscode.postMessage({ type: "ollamaGet" }); },
    refreshing: refreshing.has("local:ollama"),
    local: true,
  });

  // Search filters models inside every section; sections with hits auto-expand.
  const visibleSections = sections
    .filter((s) => s.connected)
    .map((s) => ({ ...s, models: s.models.filter(match) }))
    .filter((s) => !q || s.models.length > 0);

  const refreshAll = () => {
    for (const s of sections) if (s.onRefresh && s.connected && !refreshing.has(s.key)) s.onRefresh();
  };
  const anyRefreshing = refreshing.size > 0;

  return (
    <>
      <h1 className="page-title">Models</h1>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          className="model-search"
          type="search"
          value={query}
          placeholder="Search models across all providers…"
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1 }}
        />
        <button className="btn-ghost" onClick={refreshAll} disabled={anyRefreshing} title="Refresh every connected provider">
          {anyRefreshing ? <span className="llama-spinner" /> : <Icon name="reset" size={14} />} Refresh all
        </button>
      </div>

      <p className="panel-hint">
        Only enabled, connected providers are listed below. Expand a provider to enable/disable its models in
        the chat picker, add custom models by id, or refresh its model list. Configure each model's supported
        reasoning, thinking and context options using Edit options in the chat model picker.
      </p>

      {q && visibleSections.length === 0 && <div className="empty-card">No models match "{query}".</div>}
      {!q && visibleSections.length === 0 && <div className="empty-card">Connect and enable a provider in Providers to manage its models.</div>}

      {visibleSections.map((s) => (
        <ModelSection
          key={s.key}
          spec={s}
          forceOpen={!!q}
          enabledFor={s.local ? localEnabled : isModelEnabled}
          onToggle={s.local ? toggleLocal : toggleModel}
          onEnableAll={s.local ? localEnableAll : enableAll}
          isCustom={isCustom}
          onRemove={removeCustomModel}
          onAdd={s.addTarget ? (id) => addCustomModel(id, s.addTarget!.providerId, s.addTarget!.kind) : undefined}
        />
      ))}
    </>
  );
}
