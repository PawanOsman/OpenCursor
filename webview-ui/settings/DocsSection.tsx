/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as React from "react";
import { AnimatedDisclosure } from "../shared/AnimatedDisclosure";
import { Icon } from "../shared/icons";
import { Select } from "../shared/Select";
import { vscode } from "../shared/vscode";
import { Toggle } from "./panels/Toggle";

export interface DocSourceInfo {
  id: string;
  name: string;
  url: string;
  pages?: number;
  chunks?: number;
  indexedAt?: number;
  maxPages?: number;
  scope?: "section" | "page";
  scopePath?: string;
  focus?: string;
  useAi?: boolean;
  excludePaths?: string[];
  resolvedScope?: string;
  selected?: number;
  stopReason?: string;
  error?: string;
}
export interface DocsStatus {
  indexing?: string;
  sourceId?: string;
  phase?: "discovering" | "planning" | "indexing" | "saving" | "complete" | "cancelled" | "error";
  done: number;
  total: number;
  fetched?: number;
  indexed?: number;
  skipped?: number;
  scope?: string;
  stopReason?: string;
  error?: string;
}

function validUrl(value: string) {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}

function DocForm({ source, busy, onClose }: { source?: DocSourceInfo; busy: boolean; onClose: () => void }) {
  const id = React.useId();
  const [name, setName] = React.useState(source?.name ?? "");
  const [url, setUrl] = React.useState(source?.url ?? "");
  const [scope, setScope] = React.useState(source?.scope ?? "section");
  const [focus, setFocus] = React.useState(source?.focus ?? "");
  const [useAi, setUseAi] = React.useState(source?.useAi !== false);
  const [scopePath, setScopePath] = React.useState(source?.scopePath ?? "");
  const [excludes, setExcludes] = React.useState((source?.excludePaths ?? []).join("\n"));
  const [maxPages, setMaxPages] = React.useState(String(Math.min(1000, source?.maxPages ?? 200)));
  const [advanced, setAdvanced] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");
  const request = React.useRef<string | undefined>(undefined);
  const valid = name.trim() && validUrl(url.trim()) && Number.isInteger(Number(maxPages)) && Number(maxPages) >= 1 && Number(maxPages) <= 1000;
  React.useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.data?.type !== "docActionResult" || !request.current || event.data.requestId !== request.current) return;
      request.current = undefined;
      setPending(false);
      if (event.data.ok) onClose();
      else setError(event.data.error || "Could not save the documentation source.");
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [onClose]);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || busy || pending) return;
    const requestId = `docs-${id}-${Date.now()}`;
    request.current = requestId;
    setPending(true);
    setError("");
    vscode.postMessage({ type: source ? "editDoc" : "addDoc", id: source?.id, requestId, name: name.trim(), url: url.trim(), scope,
      focus: focus.trim(), useAi, scopePath: scope === "section" ? scopePath.trim() : "", maxPages: Number(maxPages),
      excludePaths: excludes.split(/\r?\n/).map(line => line.trim()).filter(Boolean) });
  };
  return <form className="doc-form" onSubmit={submit} aria-label={source ? "Edit documentation source" : "Add documentation source"}>
    <fieldset disabled={pending || busy}>
      <div className="doc-form-grid">
        <label className="doc-field" htmlFor={`${id}-name`}>Name<input id={`${id}-name`} autoFocus value={name} maxLength={160} onChange={event => setName(event.target.value)} placeholder="React reference" required /></label>
        <label className="doc-field" htmlFor={`${id}-url`}>Documentation URL<input id={`${id}-url`} type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://react.dev/reference" required /></label>
        <label className="doc-field" htmlFor={`${id}-scope`}>Index scope<Select id={`${id}-scope`} value={scope} onChange={event => setScope(event.target.value as "section" | "page")}>
          <option value="section">Documentation section</option><option value="page">This page only</option>
        </Select></label>
        <label className="doc-field" htmlFor={`${id}-focus`}>Topics to prioritize <span className="doc-optional">Optional</span><input id={`${id}-focus`} value={focus} maxLength={2000} onChange={event => setFocus(event.target.value)} placeholder="Authentication, streaming, tool calling" /></label>
      </div>
      <div className="doc-option-row"><div><div className="doc-field-title">AI-assisted page selection</div><p className="row-desc">Uses your configured chat model to choose relevant pages from a bounded discovery list. Falls back to local selection when unavailable.</p></div><Toggle label="AI-assisted page selection" checked={useAi} onChange={setUseAi} /></div>
      <button type="button" className="doc-advanced-toggle" aria-expanded={advanced} onClick={() => setAdvanced(value => !value)}><Icon name="chevR" size={12} /> Advanced limits</button>
      <AnimatedDisclosure open={advanced}>
        <div className="doc-form-grid doc-advanced-fields">
          {scope === "section" && <label className="doc-field" htmlFor={`${id}-path`}>Section path <span className="doc-optional">Optional</span><input id={`${id}-path`} value={scopePath} onChange={event => setScopePath(event.target.value)} placeholder="Automatic from documentation URL" /><span className="doc-field-hint">Use a URL path such as /docs/api to narrow the source section.</span></label>}
          <label className="doc-field" htmlFor={`${id}-max`}>Page budget<input id={`${id}-max`} type="number" min={1} max={1000} step={1} value={maxPages} onChange={event => setMaxPages(event.target.value)} required /><span className="doc-field-hint">1–1,000 pages. A limit, not a target; only selected pages are indexed.</span></label>
          <label className="doc-field doc-field-wide" htmlFor={`${id}-exclude`}>Excluded paths <span className="doc-optional">Optional</span><textarea id={`${id}-exclude`} rows={3} value={excludes} onChange={event => setExcludes(event.target.value)} placeholder={"/docs/archive\n/docs/translations"} /><span className="doc-field-hint">One URL path prefix per line. Exclusions apply during discovery and indexing.</span></label>
        </div>
      </AnimatedDisclosure>
    </fieldset>
    {error && <p className="doc-error" role="alert">{error}</p>}
    <div className="doc-form-actions"><button className="btn-secondary" type="button" disabled={pending} onClick={onClose}>Cancel</button><button className="btn-primary" type="submit" disabled={!valid || pending || busy}>{pending ? "Saving…" : source ? "Save changes" : "Add and index"}</button></div>
  </form>;
}

const PHASE_LABELS = { discovering: "Discovering pages", planning: "Selecting relevant pages", indexing: "Indexing selected pages", saving: "Saving index", complete: "Index ready", cancelled: "Indexing cancelled", error: "Indexing failed" };

function DocRow({ source, status }: { source: DocSourceInfo; status: DocsStatus }) {
  const [editing, setEditing] = React.useState(false);
  const [showLogs, setShowLogs] = React.useState(false);
  const [logs, setLogs] = React.useState<string[]>([]);
  const [cancelling, setCancelling] = React.useState(false);
  const logViewport = React.useRef<HTMLDivElement>(null);
  const followLogs = React.useRef(true);
  const busy = status.indexing === source.id;
  const latest = status.sourceId === source.id || busy;
  React.useEffect(() => { if (!busy) setCancelling(false); }, [busy]);
  React.useEffect(() => {
    if (!showLogs) return;
    const fetchLogs = () => vscode.postMessage({ type: "getDocLogs", id: source.id });
    const receive = (event: MessageEvent) => { if (event.data?.type === "docLogs" && event.data.id === source.id) setLogs(event.data.lines ?? []); };
    window.addEventListener("message", receive);
    fetchLogs();
    const timer = busy ? window.setInterval(fetchLogs, 1000) : undefined;
    return () => { window.removeEventListener("message", receive); if (timer) window.clearInterval(timer); };
  }, [showLogs, busy, source.id]);
  React.useLayoutEffect(() => {
    if (showLogs && followLogs.current && logViewport.current) logViewport.current.scrollTop = logViewport.current.scrollHeight;
  }, [showLogs, logs]);
  const phase = latest && status.phase ? PHASE_LABELS[status.phase] : undefined;
  const resolvedScope = latest ? status.scope ?? source.resolvedScope : source.resolvedScope;
  const stopReason = busy ? status.stopReason : latest ? status.stopReason ?? source.stopReason : source.stopReason;
  const cancelled = latest && status.phase === "cancelled";
  const failure = !busy && !cancelled ? (latest && status.phase === "error" ? status.error || status.stopReason || source.error : source.error) : undefined;
  if (editing) return <DocForm source={source} busy={!!status.indexing} onClose={() => setEditing(false)} />;
  return <div className="doc-entry">
    <div className="doc-row">
      <span className={`doc-dot${busy ? " busy" : failure ? " error" : source.indexedAt ? " ok" : ""}`} aria-hidden="true" />
      <div className="doc-info"><div className="doc-name">{source.name}</div><div className="doc-sub doc-url" title={source.url}>{source.url}</div>
        <div className={`doc-sub${failure ? " error" : ""}`} role={busy ? "status" : undefined}>
          {busy ? phase ?? "Indexing documentation" : cancelled ? `Cancelled — ${source.indexedAt ? "previous index kept" : "no index saved"}` : failure ? `Indexing failed${source.indexedAt ? " — previous index kept" : ""}` : source.indexedAt ? `${source.pages ?? 0} pages · ${source.chunks ?? 0} chunks · Updated ${new Date(source.indexedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}` : "Not indexed"}
        </div>
      </div>
      <div className="doc-actions">
        {busy && <button className="btn-secondary" disabled={cancelling || status.phase === "saving"} onClick={() => { setCancelling(true); vscode.postMessage({ type: "cancelDocIndex", id: source.id }); }}>{cancelling ? "Cancelling…" : "Cancel"}</button>}
        <button className={`icon-btn${showLogs ? " active" : ""}`} title="Indexing logs" aria-label={`Indexing logs for ${source.name}`} aria-expanded={showLogs} onClick={() => { followLogs.current = true; setShowLogs(value => !value); }}><Icon name="terminal" /></button>
        <button className="icon-btn" title="Edit source" aria-label={`Edit ${source.name}`} disabled={!!status.indexing} onClick={() => setEditing(true)}><Icon name="edit" /></button>
        <button className="icon-btn" title="Re-index" aria-label={`Re-index ${source.name}`} disabled={!!status.indexing} onClick={() => vscode.postMessage({ type: "reindexDoc", id: source.id })}><Icon name="reset" /></button>
        <button className="icon-btn" title="Open documentation" aria-label={`Open ${source.name}`} onClick={() => vscode.postMessage({ type: "openExternal", url: source.url })}><Icon name="book" /></button>
        <button className="icon-btn" title="Remove source" aria-label={`Remove ${source.name}`} disabled={!!status.indexing} onClick={() => vscode.postMessage({ type: "removeDoc", id: source.id })}><Icon name="trash" /></button>
      </div>
    </div>
    {busy && <div className="doc-progress">
      <div className="doc-progress-track" role="progressbar" aria-label="Documentation indexing progress" aria-valuemin={0} aria-valuemax={Math.max(1, status.total)} aria-valuenow={Math.min(status.done, Math.max(1, status.total))}><span style={{ width: `${status.total ? Math.min(100, status.done / status.total * 100) : 0}%` }} /></div>
      <div className="doc-sub">{status.done} / {status.total} selected pages processed · {status.fetched ?? 0} fetched · {status.indexed ?? 0} indexed · {status.skipped ?? 0} skipped</div>
    </div>}
    {(resolvedScope || stopReason || failure) && <div className="doc-result">{resolvedScope && <span>Scope: <code>{resolvedScope}</code></span>}{failure ? <span className="doc-error" role="alert">{failure}</span> : stopReason && <span>{stopReason}</span>}</div>}
    <AnimatedDisclosure open={showLogs}><div className="doc-logs" ref={logViewport} role="log" aria-label={`Indexing logs for ${source.name}`} aria-live="off" onScroll={event => {
      const viewport = event.currentTarget;
      followLogs.current = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 24;
    }}>{logs.length ? logs.map((line, index) => <div key={index} className={`doc-log-line${/\b(SKIP|FAIL|FAILED)\b/.test(line) ? " err" : ""}`}>{line}</div>) : <div className="doc-logs-empty">Logs appear when indexing starts and remain until the next run.</div>}</div></AnimatedDisclosure>
  </div>;
}

export function DocsSection({ docs, status }: { docs: DocSourceInfo[]; status: DocsStatus }) {
  const [adding, setAdding] = React.useState(false);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    const receive = (event: MessageEvent) => { if (event.data?.type === "docActionResult" && !event.data.requestId) setError(event.data.ok ? "" : event.data.error || "Documentation action failed."); };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  return <>
    <div className="docs-head"><div><div className="section-label">Documentation</div><div className="row-desc">Discover a finite page plan, select relevant documentation, then index that plan. Fetched pages do not expand it.</div></div><button className="btn-secondary" disabled={!!status.indexing || adding} onClick={() => setAdding(true)}><Icon name="plus" /> Add Doc</button></div>
    {error && <p className="doc-error" role="alert">{error}</p>}
    <div className="index-card docs-card"><AnimatedDisclosure open={adding}>{adding && <DocForm busy={!!status.indexing} onClose={() => setAdding(false)} />}</AnimatedDisclosure>
      {docs.length === 0 && !adding ? <p className="docs-empty">Add a documentation URL to create a focused, searchable reference for the agent.</p> : docs.map(source => <DocRow key={source.id} source={source} status={status} />)}
    </div>
  </>;
}
