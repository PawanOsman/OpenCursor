/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as React from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";
import { usePresence } from "./usePresence";

/** Minimal structural shape shared by sidebar ModelDef and settings ModelDef. */
export interface ModelSelectItem {
  id: string;
  name: string;
  kind?: string | string[];
  providerName?: string;
}

/** Custom entries pinned above the model list (e.g. "First enabled model", "(inherit chat model)"). */
export interface ModelSelectCustom {
  value: string;
  label: string;
  desc?: string;
}

const groupOf = (m: ModelSelectItem): string => {
  const k = Array.isArray(m.kind) ? m.kind[0] : m.kind;
  if (k === "llamacpp") return "Local · llama.cpp";
  if (k === "ollama") return "Local · Ollama";
  return m.providerName || "Other";
};

/**
 * Unified model selector: a trigger button that opens a modal dialog with
 * search, provider filter chips, and the enabled models grouped by provider.
 * `customItems` render pinned at the top (judge "first enabled", subagent
 * "inherit chat model", etc.).
 */
export function ModelSelect({
  models,
  value,
  onChange,
  customItems,
  style,
}: {
  models: ModelSelectItem[];
  value: string;
  onChange: (id: string) => void;
  customItems?: ModelSelectCustom[];
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = React.useState(false);
  const presence = usePresence(open);
  const [query, setQuery] = React.useState("");
  const [provider, setProvider] = React.useState<string | null>(null); // null = all
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const dialogId = React.useId();

  const groups = React.useMemo(() => {
    const map = new Map<string, ModelSelectItem[]>();
    for (const m of models) {
      const g = groupOf(m);
      (map.get(g) ?? map.set(g, []).get(g)!).push(m);
    }
    return [...map.entries()].sort((a, b) => Number(a[0].startsWith("Local ")) - Number(b[0].startsWith("Local ")));
  }, [models]);

  const q = query.trim().toLowerCase();
  const visibleGroups = groups
    .filter(([g]) => provider === null || g === provider)
    .map(([g, list]) => [g, q ? list.filter((m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)) : list] as const)
    .filter(([, list]) => list.length > 0);
  const visibleCustom = (customItems || []).filter(
    (c) => (provider === null) && (!q || c.label.toLowerCase().includes(q))
  );

  const current =
    customItems?.find((c) => c.value === value)?.label ??
    models.find((m) => m.id === value)?.name ??
    (value || customItems?.[0]?.label || "Select model");

  const close = () => {
    setOpen(false);
  };
  const show = () => {
    setQuery("");
    setProvider(null);
    setOpen(true);
  };
  const pick = (v: string) => {
    if (!open) return;
    onChange(v);
    close();
  };

  React.useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current!;
    const isTop = () => document.querySelectorAll('[data-modal-layer]').item(document.querySelectorAll('[data-modal-layer]').length - 1)?.contains(dialog);
    const controls = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')];
    searchRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (!isTop()) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key !== "Tab") return;
      const items = controls();
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus({ preventScroll: true }); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus({ preventScroll: true }); }
    };
    const onFocus = (event: FocusEvent) => {
      if (isTop() && !dialog.contains(event.target as Node)) searchRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocus);
      triggerRef.current?.focus({ preventScroll: true });
    };
  }, [open]);

  const navigateResults = (event: React.KeyboardEvent) => {
    const result = (event.target as HTMLElement).closest('[role="option"]');
    const fromSearch = event.target === searchRef.current;
    if (!result && !fromSearch) return;
    const options = [...dialogRef.current!.querySelectorAll<HTMLElement>('[role="option"]')];
    if (!options.length) return;
    const current = options.indexOf(result as HTMLElement);
    let index: number | undefined;
    if (event.key === "ArrowDown") index = (current + 1) % options.length;
    if (event.key === "ArrowUp") index = current <= 0 ? options.length - 1 : current - 1;
    if (!fromSearch && event.key === "Home") index = 0;
    if (!fromSearch && event.key === "End") index = options.length - 1;
    if (fromSearch && event.key === "Enter") { event.preventDefault(); options[0].click(); return; }
    if (index !== undefined) { event.preventDefault(); options[index].focus({ preventScroll: true }); options[index].scrollIntoView({ block: "nearest" }); }
  };

  return (
    <>
      <button ref={triggerRef} type="button" className="msel-trigger" style={style} onClick={show} title={value || current} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? dialogId : undefined}>
        <span className="msel-trigger-label">{current}</span>
        <Icon name="chevD" className="msel-trigger-chev" size={14} />
      </button>
      {presence.present && createPortal(
        <div className="msel-overlay" data-modal-layer={open ? "" : undefined} data-model-dialog data-state={presence.exiting ? "closing" : "open"}
          inert={presence.exiting || undefined} aria-hidden={presence.exiting || undefined} onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div ref={dialogRef} id={dialogId} className="msel-dialog" role="dialog" aria-modal="true" aria-label="Choose model" onKeyDown={navigateResults}>
            <div className="msel-head">
              <input
                ref={searchRef}
                className="msel-search"
                aria-label="Search models"
                placeholder="Search models…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button type="button" className="msel-close" onClick={close} aria-label="Close model picker"><Icon name="close" size={16} /></button>
            </div>
            <div className="msel-filters">
              <button type="button" className={"msel-chip" + (provider === null ? " active" : "")} aria-pressed={provider === null} onClick={() => setProvider(null)}>
                All
              </button>
              {groups.map(([g]) => (
                <button type="button" key={g} className={"msel-chip" + (provider === g ? " active" : "")} aria-pressed={provider === g} onClick={() => setProvider(provider === g ? null : g)}>
                  {g}
                </button>
              ))}
            </div>
            <div className="msel-body" role="listbox" aria-label="Models">
              {visibleCustom.map((c) => (
                <button type="button" role="option" aria-selected={value === c.value}
                  key={c.value || "__custom__"}
                  className={"msel-item custom" + (value === c.value ? " active" : "")}
                  onClick={() => pick(c.value)}
                >
                  <span className="msel-item-name">{c.label}</span>
                  {c.desc && <span className="msel-item-sub">{c.desc}</span>}
                  {value === c.value && <Icon name="check" className="msel-item-check" size={16} />}
                </button>
              ))}
              {visibleCustom.length > 0 && visibleGroups.length > 0 && <div className="msel-divider" />}
              {visibleGroups.length === 0 && visibleCustom.length === 0 && <div className="msel-empty">No matches</div>}
              {visibleGroups.map(([g, list]) => (
                <React.Fragment key={g}>
                  <div className="msel-group">{g}</div>
                  {list.map((m) => (
                    <button type="button" role="option" aria-selected={value === m.id} key={m.id} className={"msel-item" + (value === m.id ? " active" : "")} onClick={() => pick(m.id)}>
                      <span className="msel-item-name">{m.name}</span>
                      {m.id !== m.name && <span className="msel-item-sub">{m.id}</span>}
                      {value === m.id && <Icon name="check" className="msel-item-check" size={16} />}
                    </button>
                  ))}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>, document.body
      )}
    </>
  );
}
