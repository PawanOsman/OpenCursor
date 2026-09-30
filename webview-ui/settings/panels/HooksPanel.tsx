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
import { FeatureConfig, HOOK_EVENTS, HookDef, HookEvent, uid } from "../features";
import { Toggle } from "./Toggle";

/** Unified label for a native (Cursor/Claude) event name; falls back to the raw name. */
function unifiedLabel(nativeEvent: string, matcher?: string): string {
  const hit = HOOK_EVENTS.find(
    (e) => (e.cursor === nativeEvent || e.claude === nativeEvent) && (!e.claudeMatcher || !matcher || e.claudeMatcher === matcher)
  );
  return hit ? hit.label : nativeEvent;
}

// External hooks (Cursor hooks.json / Claude Code settings.json), CRUD via backend.
interface ExternalHook {
  source: "cursor-user" | "cursor-project" | "claude-user" | "claude-project";
  event: string;
  command: string;
  matcher?: string;
  ref: string;
}

const EXT_SOURCES: { id: ExternalHook["source"]; label: string; claude: boolean }[] = [
  { id: "cursor-user", label: "Cursor — User (~/.cursor/hooks.json)", claude: false },
  { id: "cursor-project", label: "Cursor — Project (.cursor/hooks.json)", claude: false },
  { id: "claude-user", label: "Claude Code — User (~/.claude/settings.json)", claude: true },
  { id: "claude-project", label: "Claude Code — Project (.claude/settings.json)", claude: true },
];

function ExternalHookEditor({
  source,
  initial,
  onClose,
}: {
  source: (typeof EXT_SOURCES)[number];
  initial?: ExternalHook;
  onClose: () => void;
}) {
  // Unified events this source supports (Cursor or Claude has a native name for it).
  const events = HOOK_EVENTS.filter((e) => (source.claude ? e.claude : e.cursor));
  const initialUnified = initial
    ? events.find((e) => (source.claude ? e.claude === initial.event : e.cursor === initial.event) && (!e.claudeMatcher || !initial.matcher || e.claudeMatcher === initial.matcher))?.id
    : undefined;
  const [event, setEvent] = React.useState<HookEvent>(initialUnified || events[0].id);
  const [command, setCommand] = React.useState(initial?.command || "");
  // Keep any custom Claude matcher the user had (unless it was just the unified default).
  const [matcher, setMatcher] = React.useState(initial?.matcher || "");
  const save = () => {
    if (!command.trim()) return;
    const spec = HOOK_EVENTS.find((e) => e.id === event)!;
    const nativeEvent = source.claude ? spec.claude! : spec.cursor!;
    const nativeMatcher = source.claude ? (matcher.trim() || spec.claudeMatcher) : undefined;
    vscode.postMessage({
      type: "saveExternalHook",
      source: source.id,
      hook: { ref: initial?.ref, event: nativeEvent, command: command.trim(), matcher: nativeMatcher },
    });
    onClose();
  };
  return (
    <div className="feature-card">
      <div className="fc-body">
        <label className="fc-field">
          <span>Event</span>
          <Select value={event} onChange={(e) => setEvent(e.target.value as HookEvent)}>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>{ev.label}</option>
            ))}
          </Select>
        </label>
        {source.claude && (
          <label className="fc-field">
            <span>Matcher (optional, e.g. Bash or Edit|Write)</span>
            <input value={matcher} onChange={(e) => setMatcher(e.target.value)} placeholder={HOOK_EVENTS.find((e) => e.id === event)?.claudeMatcher || "*"} />
          </label>
        )}
        <label className="fc-field">
          <span>Command</span>
          <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="node hook.js" autoFocus />
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-secondary" onClick={save} disabled={!command.trim()}>Save</button>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function ExternalHooksSection({ hooks, error }: { hooks: ExternalHook[]; error?: string }) {
  // editing: source id → editing existing hook or adding ("new")
  const [editing, setEditing] = React.useState<{ source: ExternalHook["source"]; hook?: ExternalHook } | null>(null);
  return (
    <>
      {error && <p className="panel-hint" style={{ color: "var(--vscode-errorForeground)" }}>{error}</p>}
      {EXT_SOURCES.map((src) => {
        const list = hooks.filter((h) => h.source === src.id);
        return (
          <div key={src.id} style={{ marginBottom: 16 }}>
            <div className="section-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1 }}>{src.label}</span>
              <button className="icon-btn" title="Add hook" onClick={() => setEditing({ source: src.id })}>
                <Icon name="plus" size={14} />
              </button>
            </div>
            {list.length === 0 && !(editing && editing.source === src.id && !editing.hook) && (
              <p className="panel-hint">No hooks configured.</p>
            )}
            {list.map((h) =>
              editing && editing.hook?.ref === h.ref && editing.source === src.id ? (
                <ExternalHookEditor key={h.ref} source={src} initial={h} onClose={() => setEditing(null)} />
              ) : (
                <div className="feature-card" key={h.ref}>
                  <div className="fc-head">
                    <span className="badge">{unifiedLabel(h.event, h.matcher)}</span>
                    {h.matcher && <span className="badge">{h.matcher}</span>}
                    <code style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.command}</code>
                    <button className="icon-btn" title="Edit" onClick={() => setEditing({ source: src.id, hook: h })}>
                      <Icon name="edit" size={14} />
                    </button>
                    <button
                      className="icon-btn"
                      title="Delete"
                      onClick={() => vscode.postMessage({ type: "deleteExternalHook", source: src.id, ref: h.ref })}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </div>
              )
            )}
            {editing && editing.source === src.id && !editing.hook && (
              <ExternalHookEditor source={src} onClose={() => setEditing(null)} />
            )}
          </div>
        );
      })}
    </>
  );
}

export function HooksPanel({ features, setFeatures }: { features: FeatureConfig; setFeatures: (f: Partial<FeatureConfig>) => void }) {
  const [external, setExternal] = React.useState<ExternalHook[]>([]);
  const [extError, setExtError] = React.useState<string | undefined>();

  React.useEffect(() => {
    const handler = (e: MessageEvent) => {
      const m = e.data;
      if (m?.type === "externalHooks") {
        setExternal(m.hooks || []);
        setExtError(m.error);
      }
    };
    window.addEventListener("message", handler);
    vscode.postMessage({ type: "getExternalHooks" });
    return () => window.removeEventListener("message", handler);
  }, []);

  const update = (i: number, patch: Partial<HookDef>) => {
    const next = features.hooks.map((h, idx) => (idx === i ? { ...h, ...patch } : h));
    setFeatures({ hooks: next });
  };
  const remove = (i: number) => setFeatures({ hooks: features.hooks.filter((_, idx) => idx !== i) });
  const add = () => setFeatures({ hooks: [...features.hooks, { id: uid("hook"), event: "afterRun", command: "", enabled: true }] });

  return (
    <>
      <h1 className="page-title">Hooks</h1>
      <div className="section-label">Lifecycle Hooks</div>
      <p className="panel-hint">Run shell commands on agent lifecycle events. Context is passed via OPENCURSOR_* env vars.</p>
      {features.hooks.map((h, i) => (
        <div className="feature-card" key={h.id}>
          <div className="fc-head">
            <Select aria-label="Hook event" value={h.event} onChange={(e) => update(i, { event: e.target.value as HookDef["event"] })}>
              {HOOK_EVENTS.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.label}
                </option>
              ))}
            </Select>
            <Toggle label={`Enable ${HOOK_EVENTS.find(event => event.id === h.event)?.label ?? h.event} hook`} checked={h.enabled} onChange={(v) => update(i, { enabled: v })} />
            <button className="icon-btn" onClick={() => remove(i)} title="Remove">
              <Icon name="trash" size={14} />
            </button>
          </div>
          <div className="fc-body">
            <label className="fc-field">
              <span>Command</span>
              <input value={h.command} onChange={(e) => update(i, { command: e.target.value })} placeholder="pnpm lint" />
            </label>
          </div>
        </div>
      ))}
      <div className="panel-actions">
        <button className="btn-ghost" onClick={add}>
          <Icon name="plus" size={14} /> Add Hook
        </button>
      </div>

      <div className="section-label" style={{ marginTop: 24 }}>External Hooks</div>
      <p className="panel-hint">Hooks from Cursor (<code>hooks.json</code>) and Claude Code (<code>settings.json</code>), user and project level. Changes write directly to those files.</p>
      <ExternalHooksSection hooks={external} error={extError} />
    </>
  );
}
