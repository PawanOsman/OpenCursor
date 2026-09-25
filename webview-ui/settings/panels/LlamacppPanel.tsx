/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as React from "react";
import { Select } from "../../shared/Select";
import { Icon } from "../../shared/icons";
import { vscode } from "../../shared/vscode";
import { FeatureConfig, HfGgufResult, LlamacppServerConfig, LlamacppStatus } from "../features";
import { fmtSize } from "./localShared";
import { HardwareSummary, useLocalHardware } from "./LocalHardware";

/** Editor for a llama-server launch config (global defaults or a per-model override). */
function ServerConfigForm({ config, onChange }: { config: LlamacppServerConfig; onChange: (next: LlamacppServerConfig) => void }) {
  const c = config || {};
  const set = (patch: Partial<LlamacppServerConfig>) => onChange({ ...c, ...patch });
  // Empty input clears the override (undefined), any other value is numeric.
  const num = (v: string) => (v.trim() === "" ? undefined : Number(v));
  return (
    <div className="lc-config-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
      <label className="fc-field">
        <span>Host</span>
        <input value={c.host ?? ""} placeholder="127.0.0.1" onChange={(e) => set({ host: e.target.value || undefined })} />
      </label>
      <label className="fc-field">
        <span>Port (0 = auto)</span>
        <input type="number" min={0} value={c.port ?? ""} placeholder="auto" onChange={(e) => set({ port: num(e.target.value) })} />
      </label>
      <label className="fc-field">
        <span>Context size (tokens)</span>
        <input type="number" min={0} step={1024} value={c.ctxSize ?? ""} placeholder="65536" onChange={(e) => set({ ctxSize: num(e.target.value) })} />
      </label>
      <label className="fc-field">
        <span>Flash attention</span>
        <Select value={c.flashAttn ?? "auto"} onChange={(e) => set({ flashAttn: e.target.value as LlamacppServerConfig["flashAttn"] })}>
          <option value="auto">auto</option>
          <option value="on">on</option>
          <option value="off">off</option>
        </Select>
      </label>
      <label className="fc-field">
        <span>GPU layers (-ngl)</span>
        <input value={c.nGpuLayers ?? ""} placeholder="auto / all / 99" onChange={(e) => set({ nGpuLayers: e.target.value || undefined })} />
      </label>
      <label className="fc-field">
        <span>Parallel slots</span>
        <input type="number" min={1} value={c.parallel ?? ""} placeholder="1" onChange={(e) => set({ parallel: num(e.target.value) })} />
      </label>
      <label className="fc-field">
        <span>Threads</span>
        <input type="number" min={1} value={c.threads ?? ""} placeholder="auto" onChange={(e) => set({ threads: num(e.target.value) })} />
      </label>
      <label className="fc-field">
        <span>Batch / ubatch</span>
        <span style={{ display: "flex", gap: 6 }}>
          <input type="number" min={1} value={c.batchSize ?? ""} placeholder="batch" onChange={(e) => set({ batchSize: num(e.target.value) })} />
          <input type="number" min={1} value={c.ubatchSize ?? ""} placeholder="ubatch" onChange={(e) => set({ ubatchSize: num(e.target.value) })} />
        </span>
      </label>
      <label className="fc-field">
        <span>KV cache K / V type</span>
        <span style={{ display: "flex", gap: 6 }}>
          <input value={c.cacheTypeK ?? ""} placeholder="f16" onChange={(e) => set({ cacheTypeK: e.target.value || undefined })} />
          <input value={c.cacheTypeV ?? ""} placeholder="f16" onChange={(e) => set({ cacheTypeV: e.target.value || undefined })} />
        </span>
      </label>
      <label className="fc-field">
        <span>Multimodal projector (--mmproj)</span>
        <input value={c.mmprojPath ?? ""} placeholder="path to mmproj .gguf" onChange={(e) => set({ mmprojPath: e.target.value || undefined })} />
      </label>
      <label className="fc-field" style={{ gridColumn: "1 / -1" }}>
        <span>Draft model for speculative / MTP (-md)</span>
        <input value={c.draftModelPath ?? ""} placeholder="path to draft .gguf" onChange={(e) => set({ draftModelPath: e.target.value || undefined })} />
      </label>
      <label className="fc-field">
        <span>Draft tokens (--spec-draft-n-max)</span>
        <input type="number" min={1} value={c.specDraftNMax ?? ""} placeholder="3" onChange={(e) => set({ specDraftNMax: num(e.target.value) })} />
      </label>
      <label className="fc-field">
        <span>Draft GPU layers (-ngld)</span>
        <input value={c.draftNGpuLayers ?? ""} placeholder="auto" onChange={(e) => set({ draftNGpuLayers: e.target.value || undefined })} />
      </label>
      <label className="fc-inline">
        <input type="checkbox" checked={c.jinja !== false} onChange={(e) => set({ jinja: e.target.checked })} /> Jinja templates
      </label>
      <label className="fc-inline">
        <input type="checkbox" checked={!!c.noMmap} onChange={(e) => set({ noMmap: e.target.checked })} /> No mmap
      </label>
      <label className="fc-inline">
        <input type="checkbox" checked={!!c.mlock} onChange={(e) => set({ mlock: e.target.checked })} /> mlock (lock in RAM)
      </label>
      <label className="fc-field" style={{ gridColumn: "1 / -1" }}>
        <span>Extra args (advanced, space-separated)</span>
        <input value={c.extraArgs ?? ""} placeholder="--metrics --alias my-model" onChange={(e) => set({ extraArgs: e.target.value || undefined })} />
      </label>
    </div>
  );
}

export function LlamacppPanel({
  features,
  status,
}: {
  features: FeatureConfig;
  status: LlamacppStatus;
}) {
  const { hardware, fits } = useLocalHardware();
  const [operationError, setOperationError] = React.useState("");
  const [tab, setTab] = React.useState<"models" | "search" | "config">("models");
  const [query, setQuery] = React.useState("");
  const [searching, setSearching] = React.useState(false);
  const [results, setResults] = React.useState<HfGgufResult[]>([]);
  const [searchErr, setSearchErr] = React.useState("");
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [repoFiles, setRepoFiles] = React.useState<Record<string, HfGgufResult[]>>({});
  const [downloading, setDownloading] = React.useState<Record<string, number>>({});

  React.useEffect(() => {
    vscode.postMessage({ type: "llamacppGet" });
    const handler = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === "llamacppSearchResults") {
        setSearching(false);
        setResults(m.results || []);
        setSearchErr(m.error || "");
      } else if (m.type === "llamacppRepoFiles") {
        setRepoFiles((prev) => ({ ...prev, [m.repo]: m.files || [] }));
        if (m.error) setSearchErr(m.error);
      } else if (m.type === "llamacppDownloadProgress") {
        setDownloading((prev) => ({ ...prev, [m.id]: m.total ? Math.round((m.received / m.total) * 100) : 0 }));
      } else if (m.type === "localModelError") {
        setOperationError(m.error || "Model operation failed.");
      } else if (m.type === "llamacppDownloadDone") {
        if (m.error) setOperationError(m.error);
        else vscode.postMessage({ type: "localHardwareGet" });
        setDownloading((prev) => {
          const next = { ...prev };
          delete next[m.id];
          return next;
        });
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const search = () => {
    if (!query.trim()) return;
    setSearching(true);
    setSearchErr("");
    vscode.postMessage({ type: "llamacppSearch", query: query.trim() });
  };

  const toggleRepo = (repo: string) => {
    if (expanded === repo) {
      setExpanded(null);
      return;
    }
    setExpanded(repo);
    if (!repoFiles[repo]) vscode.postMessage({ type: "llamacppRepoFiles", repo });
  };

  const download = (repo: string, file: string) => {
    setDownloading((prev) => ({ ...prev, [`${repo}/${file}`]: 0 }));
    setOperationError("");
    const metadata = repoFiles[repo]?.find(item => item.file === file);
    vscode.postMessage({ type: "llamacppDownload", repo, file, sha256: metadata?.sha256, sizeBytes: metadata?.sizeBytes });
  };

  const models = features.llamacppModels || [];

  return (
    <>
      <h1 className="page-title">llama.cpp</h1>

      <div className="section-label">Runtime</div>
      <div className="row">
        <div className="row-text">
          <div className="row-title">llama.cpp {status.installed ? "installed" : "not found"}</div>
          <div className="row-desc">
            Requires <code>llama-server</code> on your PATH. Windows: <code>irm https://llama.app/install.ps1 | iex</code> · Linux/Mac: <code>curl -LsSf https://llama.app/install.sh | sh</code>.
          </div>
        </div>
        <div className="row-control" style={{ display: "flex", gap: 8 }}>
          {!status.installed && (
            <button className="btn-primary" onClick={() => vscode.postMessage({ type: "llamacppInstall" })}>
              Install
            </button>
          )}
          <button className="btn-ghost" onClick={() => vscode.postMessage({ type: "llamacppGet" })}>
            <Icon name="reset" size={13} /> Re-check
          </button>
        </div>
      </div>

      <HardwareSummary hardware={hardware} />
      {operationError && <div className="fc-error" role="alert">{operationError}</div>}
      <div className="sub-tabs" style={{ marginTop: 20 }}>
        <button className={"sub-tab" + (tab === "models" ? " active" : "")} onClick={() => setTab("models")}>Models</button>
        <button className={"sub-tab" + (tab === "search" ? " active" : "")} onClick={() => setTab("search")}>Search &amp; Download</button>
        <button className={"sub-tab" + (tab === "config" ? " active" : "")} onClick={() => setTab("config")}>Config</button>
      </div>

      {tab === "config" && (<>
      <div className="section-label" style={{ marginTop: 0 }}>Default Server Config</div>
      <p className="panel-hint">Default <code>llama-server</code> launch flags applied to every model load unless a model overrides them below. Changes take effect on next load. Chat history auto-trims to the context size.</p>
      <ServerConfigForm
        config={features.llamacppConfig || {}}
        onChange={(next) => vscode.postMessage({ type: "llamacppSetConfig", config: next })}
      />
      </>)}

      {tab === "models" && (<>
      <div className="section-label" style={{ marginTop: 0 }}>Your Models</div>
      <p className="panel-hint">Load a model to serve it via an OpenAI-compatible endpoint. Auto-load starts it when the extension activates. Changing a model's context length takes effect on next load.</p>
      {models.length === 0 ? (
        <div className="empty-card">No GGUF models yet. Search or import one below.</div>
      ) : (
        models.map((m) => {
          const isRunning = !!status.running[m.id];
          const isLoading = !!status.loading[m.id];
          const isStopping = status.states?.[m.id] === "stopping";
          const fit = fits[m.id];
          const err = status.errors[m.id];
          const log = status.logs[m.id] ?? [];
          return (
            <div className="feature-card" key={m.id}>
              <div className="fc-head">
                <div className="fc-title-input" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Icon name="model" size={14} />
                  <span>{m.name}</span>
                  {isLoading && <span className="badge-tag loading"><span className="llama-spinner" /> loading…</span>}
                  {isRunning && !isLoading && <span className="badge-tag always">running</span>}
                </div>
                <label className="fc-inline" title="Load this model automatically on startup">
                  <input
                    type="checkbox"
                    checked={m.autoLoad}
                    onChange={(e) => vscode.postMessage({ type: "llamacppSetAutoLoad", id: m.id, autoLoad: e.target.checked })}
                  /> auto-load
                </label>
                {isStopping ? <span className="badge-tag loading">stopping…</span> : isRunning || isLoading ? (
                  <button className="btn-ghost sm" onClick={() => vscode.postMessage({ type: "llamacppUnload", id: m.id })}>{isLoading ? "Cancel" : "Unload"}</button>
                ) : (
                  <button className="btn-ghost sm" disabled={!status.installed} onClick={() => vscode.postMessage({ type: "llamacppLoad", id: m.id })}>Load</button>
                )}
                <button className="icon-btn" title="Remove" disabled={isLoading || isStopping} onClick={() => vscode.postMessage({ type: "llamacppRemove", id: m.id })}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
              <div className="fc-body">
                <div className="row-desc">
                  {m.file}{m.sizeBytes ? ` · ${fmtSize(m.sizeBytes)}` : ""}{m.repo ? ` · ${m.repo}` : " · imported"}
                </div>
                {status.endpoints?.[m.id] && <div className="row-desc">Endpoint: <code>{status.endpoints[m.id]}</code></div>}
                {fit && <div className="row-desc" style={{ marginTop: 8 }}>
                  <strong>Memory fit: {fit.level}</strong>{fit.estimatedMemoryBytes ? ` · estimated ${fmtSize(fit.estimatedMemoryBytes)}` : ""}
                  <p>{fit.reason}</p>
                  <button className="btn-ghost sm" onClick={() => vscode.postMessage({ type: "llamacppSetModelConfig", id: m.id, useCustomConfig: true,
                    config: { ...(m.config || features.llamacppConfig), ctxSize: fit.recommendedContext, threads: fit.recommendedThreads, parallel: 1 } })}>Use suggested context and threads</button>
                </div>}
                <label className="fc-inline" style={{ marginTop: 8 }} title="Override the global server config for this model only">
                  <input
                    type="checkbox"
                    checked={!!m.useCustomConfig}
                    onChange={(e) => vscode.postMessage({ type: "llamacppSetModelConfig", id: m.id, useCustomConfig: e.target.checked, config: m.config ?? { ...features.llamacppConfig } })}
                  /> custom config
                </label>
                {m.useCustomConfig && (
                  <ServerConfigForm
                    config={m.config ?? { ...features.llamacppConfig }}
                    onChange={(next) => vscode.postMessage({ type: "llamacppSetModelConfig", id: m.id, config: next })}
                  />
                )}
                {err && <div className="fc-error">{err}</div>}
                {log.length > 0 && (
                  <details className="llama-log" open={isLoading || !!err}>
                    <summary>Server log ({log.length})</summary>
                    <pre className="llama-log-pre" ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>{log.join("\n")}</pre>
                  </details>
                )}
              </div>
            </div>
          );
        })
      )}
      <div className="panel-actions">
        <button className="btn-ghost" onClick={() => vscode.postMessage({ type: "llamacppImport" })}>
          <Icon name="plus" size={14} /> Import local .gguf
        </button>
        <button className="btn-ghost" onClick={() => setTab("search")}>
          <Icon name="database" size={14} /> Search &amp; download from Hugging Face
        </button>
      </div>
      </>)}

      {tab === "search" && (<>
      <div className="section-label" style={{ marginTop: 0 }}>Search Hugging Face (GGUF)</div>
      <p className="panel-hint">Interrupted downloads resume when the server supports validated ranges. GGUF headers and published SHA-256 checksums are checked before adding the model.</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          type="search"
          value={query}
          placeholder="e.g. llama 3.1 8b instruct"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") search(); }}
          style={{ flex: 1 }}
        />
        <button className="btn-primary" onClick={search} disabled={searching}>
          {searching ? "Searching…" : "Search"}
        </button>
      </div>
      {searchErr && <div className="fc-error">{searchErr}</div>}
      {results.map((r) => {
        const files = repoFiles[r.repo];
        const open = expanded === r.repo;
        return (
          <div className="feature-card" key={r.repo}>
            <div className="fc-head" style={{ cursor: "pointer" }} onClick={() => toggleRepo(r.repo)}>
              <div className="fc-title-input" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name={open ? "chevD" : "chevR"} size={14} />
                <span>{r.repo}</span>
              </div>
              <span className="row-desc">{r.downloads != null ? `${r.downloads.toLocaleString()} ↓` : ""} {r.likes != null ? `· ${r.likes} ♥` : ""}</span>
            </div>
            {open && (
              <div className="fc-body">
                {!files ? (
                  <div className="row-desc">Loading files…</div>
                ) : files.length === 0 ? (
                  <div className="row-desc">No .gguf files found.</div>
                ) : (
                  files.map((f) => {
                    const id = `${r.repo}/${f.file}`;
                    const have = models.some((m) => m.id === id);
                    const pct = downloading[id];
                    return (
                      <div className="model-row" key={f.file}>
                        <div className="model-name">
                          <Icon name="model" />
                          <span>{f.file}{f.sizeBytes ? ` · ${fmtSize(f.sizeBytes)}` : ""}</span>
                        </div>
                        {have ? (
                          <span className="badge-tag glob">added</span>
                        ) : pct != null ? (
                          <span style={{ display: "flex", gap: 8, alignItems: "center" }}><span className="row-desc">{pct}%</span>
                            <button className="btn-ghost sm" onClick={() => vscode.postMessage({ type: "llamacppCancelDownload", id })}>Cancel</button></span>
                        ) : (
                          <button className="btn-ghost sm" onClick={() => download(r.repo, f.file)}>
                            <Icon name="database" size={13} /> Download
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        );
      })}
      </>)}
    </>
  );
}
