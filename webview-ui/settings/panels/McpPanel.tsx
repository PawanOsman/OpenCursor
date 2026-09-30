/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as React from "react";
import { SettingsDialog } from "./SettingsDialog";
import { Select } from "../../shared/Select";
import { Icon } from "../../shared/icons";
import { FeatureConfig, McpServerConfig, McpStatus } from "../features";
import { Toggle } from "./Toggle";
import { vscode } from "../../shared/vscode";

export function McpPanel({
  features,
  setFeatures,
  status,
  onSync,
}: {
  features: FeatureConfig;
  setFeatures: (f: Partial<FeatureConfig>) => void;
  status: McpStatus[];
  onSync: () => void;
}) {
  // null = closed; { index: -1 } = adding a new server; otherwise editing that index.
  const [editing, setEditing] = React.useState<{ index: number; draft: McpServerConfig } | null>(null);
  const [authError, setAuthError] = React.useState("");
  React.useEffect(() => {
    const listener = (event: MessageEvent) => { if (event.data?.type === "mcpAuthError") setAuthError(event.data.error || "Authentication failed."); };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);

  const remove = (i: number) => {
    setFeatures({ mcpServers: features.mcpServers.filter((_, idx) => idx !== i) });
    setTimeout(onSync, 0);
  };
  const toggle = (i: number, enabled: boolean) => {
    setFeatures({ mcpServers: features.mcpServers.map((s, idx) => (idx === i ? { ...s, enabled } : s)) });
    setTimeout(onSync, 0);
  };

  const openAdd = () => setEditing({ index: -1, draft: { name: "", transport: "stdio", command: "", args: [], enabled: true } });
  const openEdit = (i: number) => setEditing({ index: i, draft: { ...features.mcpServers[i] } });

  const save = (cfg: McpServerConfig) => {
    const next = editing && editing.index >= 0
      ? features.mcpServers.map((s, idx) => (idx === editing.index ? cfg : s))
      : [...features.mcpServers, cfg];
    setFeatures({ mcpServers: next });
    setEditing(null);
    setTimeout(onSync, 0);
  };

  const statusFor = (name: string) => status.find((s) => s.name === name);

  return (
    <>
      <h1 className="page-title">Tools &amp; MCPs</h1>

      <div className="section-label">MCP Servers</div>
      <p className="panel-hint">Connected Model Context Protocol servers and the tools they expose.</p>
      {authError && <div className="fc-error" role="alert">{authError}</div>}
      {features.mcpServers.length === 0 && (
        <div className="empty-card">No MCP servers yet. Add one to get started.</div>
      )}
      {features.mcpServers.map((srv, i) => {
        const st = statusFor(srv.name);
        const tools = st?.tools ?? [];
        return (
          <div className="feature-card" key={i}>
            <div className="fc-head">
              <div className="fc-title-input" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="link" size={14} />
                <span>{srv.name || "(unnamed)"}</span>
                <span className={"mcp-status " + (st?.connected ? "ok" : st?.error ? "err" : "idle")}>
                  {st?.connected ? `${st.toolCount} tools` : st?.error ? "error" : "idle"}
                </span>
              </div>
              <Toggle label={`Enable ${srv.name}`} checked={srv.enabled} onChange={(v) => toggle(i, v)} />
              {srv.transport !== "stdio" && srv.oauth && <button className="btn-ghost sm" disabled={st?.authState === "authorizing"} onClick={() => {
                setAuthError(""); vscode.postMessage({ type: st?.authState === "authenticated" ? "mcpLogout" : "mcpLogin", name: srv.name });
              }}>{st?.authState === "authorizing" ? "Signing in…" : st?.authState === "authenticated" ? "Sign out" : "Sign in"}</button>}
              <button className="btn-ghost sm" onClick={() => openEdit(i)}>
                <Icon name="settings" size={13} /> Edit
              </button>
              <button className="icon-btn" onClick={() => remove(i)} title="Remove">
                <Icon name="trash" size={14} />
              </button>
            </div>
            <div className="fc-body">
              <div className="row-desc">{srv.transport === "stdio" ? `Local command: ${srv.command || ""}` : `${srv.transport === "http" ? "Streamable HTTP" : "SSE"}: ${srv.url || ""}`}{st?.authState && st.authState !== "none" ? ` · ${st.authState}` : ""}</div>
              {st?.error ? (
                <div className="fc-error">{st.error}</div>
              ) : tools.length === 0 ? (
                <div className="row-desc">{st?.connected ? "No tools exposed." : "Not connected — enable and Reconnect."}</div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {tools.map((t) => (
                    <span className="badge-tag glob" key={t}>{t}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
      <div className="panel-actions">
        <button className="btn-ghost" onClick={openAdd}>
          <Icon name="plus" size={14} /> Add MCP Server
        </button>
        <button className="btn-ghost" onClick={onSync}>
          Reconnect
        </button>
      </div>

      {editing && (
        <McpModal
          server={editing.draft}
          isNew={editing.index < 0}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </>
  );
}

function McpModal({ server, isNew, onClose, onSave }: { server: McpServerConfig; isNew: boolean; onClose: () => void; onSave: (s: McpServerConfig) => void }) {
  const [draft, setDraft] = React.useState<McpServerConfig>(server);
  const [headers, setHeaders] = React.useState(JSON.stringify(server.headers || {}, null, 2));
  const [args, setArgs] = React.useState(JSON.stringify(server.args || []));
  const [error, setError] = React.useState("");
  const set = (patch: Partial<McpServerConfig>) => setDraft((d) => ({ ...d, ...patch }));
  const save = () => {
    try {
      if (draft.transport === "stdio") {
        const values = JSON.parse(args);
        if (!Array.isArray(values) || values.some(value => typeof value !== "string")) throw new Error("Arguments must be a JSON array of strings.");
        onSave({ ...draft, name: draft.name.trim(), args: values });
      } else {
        const url = new URL(draft.url || "");
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Use an HTTP(S) server URL without embedded credentials.");
        const values = JSON.parse(headers);
        if (!values || Array.isArray(values) || typeof values !== "object" || Object.values(values).some(value => typeof value !== "string")) throw new Error("Headers must be a JSON object with string values.");
        onSave({ ...draft, name: draft.name.trim(), url: url.toString(), headers: values });
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <SettingsDialog title={isNew ? "Add MCP Server" : "Edit MCP Server"} onClose={onClose}>
        <div className="modal-body">
          <label className="fc-field">
            <span>Name</span>
            <input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="my-server" />
          </label>
          <label className="fc-field">
            <span>Transport</span>
            <Select value={draft.transport} onChange={event => set({ transport: event.target.value as McpServerConfig["transport"] })}>
              <option value="stdio">Local process (stdio)</option><option value="http">Streamable HTTP</option><option value="sse">SSE (legacy)</option>
            </Select>
          </label>
          {draft.transport === "stdio" ? <><label className="fc-field">
            <span>Command</span>
            <input value={draft.command ?? ""} onChange={(e) => set({ command: e.target.value })} placeholder="npx" />
          </label>
          <label className="fc-field">
            <span>Arguments (JSON array)</span>
            <input
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder={'["-y", "@modelcontextprotocol/server-filesystem", "."]'}
            />
          </label></> : <>
            <label className="fc-field"><span>Server URL</span><input value={draft.url || ""} onChange={event => set({ url: event.target.value })} placeholder="https://example.com/mcp" /></label>
            <label className="fc-field"><span>Additional headers (JSON object)</span><textarea value={headers} onChange={event => setHeaders(event.target.value)} rows={3} spellCheck={false} /></label>
            <label className="fc-inline"><input type="checkbox" checked={Boolean(draft.oauth)} onChange={event => set({ oauth: event.target.checked ? {} : undefined })} /> OAuth sign-in</label>
            {draft.oauth && <>
              <label className="fc-field"><span>Client ID (optional)</span><input value={draft.oauth.clientId || ""} onChange={event => set({ oauth: { ...draft.oauth, clientId: event.target.value || undefined } })} placeholder="Use server registration when supported" /></label>
              <label className="fc-field"><span>Scopes (space-separated)</span><input value={(draft.oauth.scopes || []).join(" ")} onChange={event => set({ oauth: { ...draft.oauth, scopes: event.target.value.split(/\s+/).filter(Boolean) } })} /></label>
              <p className="panel-hint">Save the server, then select Sign in to authorize it in your browser.</p>
            </>}
          </>}
          {error && <div className="fc-error" role="alert">{error}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!draft.name.trim() || (draft.transport === "stdio" ? !draft.command?.trim() : !draft.url?.trim())} onClick={save}>Save</button>
        </div>
    </SettingsDialog>
  );
}
