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
import { usePresence } from "../../shared/usePresence";
import { CODE_LANGUAGES, normalizeCodeLanguage } from "../../shared/codeLanguages";
import "./code-language-picker.css";

interface CodeLanguagePickerProps {
  value?: string;
  detectedLabel: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const choices = [{ id: "auto", label: "Auto detect", aliases: ["automatic"] }, ...CODE_LANGUAGES];

export function CodeLanguagePicker({ value = "auto", detectedLabel, onChange, disabled }: CodeLanguagePickerProps) {
  const id = React.useId();
  const listId = `${id}-languages`;
  const current = normalizeCodeLanguage(value);
  const [open, setOpen] = React.useState(false);
  const { present, exiting } = usePresence(open);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(current);
  const [side, setSide] = React.useState("top");
  const [position, setPosition] = React.useState<React.CSSProperties>({ visibility: "hidden" });
  const trigger = React.useRef<HTMLButtonElement>(null);
  const surface = React.useRef<HTMLDivElement>(null);
  const search = React.useRef<HTMLInputElement>(null);
  const list = React.useRef<HTMLDivElement>(null);
  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return choices.filter(choice => !needle || [choice.id, choice.label, ...choice.aliases ?? []].some(label => label.toLowerCase().includes(needle)));
  }, [query]);
  const activeId = filtered.some(choice => choice.id === active) ? active : filtered[0]?.id;

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  };
  const show = () => {
    if (disabled) return;
    setQuery(""); setActive(current); setOpen(true);
  };
  const choose = (next: string) => {
    if (!open || disabled) return;
    close(true);
    if (next !== current) onChange(next);
  };

  React.useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor) return;
      const padding = 8, gap = 5;
      const width = Math.min(232, Math.max(0, window.innerWidth - padding * 2));
      const above = Math.max(0, anchor.top - gap - padding);
      const below = Math.max(0, window.innerHeight - anchor.bottom - gap - padding);
      const upwards = above >= 200 || above > below;
      const height = Math.min(352, Math.max(0, window.innerHeight - padding * 2), upwards ? above : below);
      setSide(upwards ? "top" : "bottom");
      setPosition({
        left: Math.max(padding, Math.min(anchor.left, window.innerWidth - padding - width)),
        top: upwards ? Math.max(padding, anchor.top - gap - height) : Math.min(anchor.bottom + gap, window.innerHeight - padding - height),
        width, height, visibility: "visible",
      });
    };
    place();
    search.current?.focus({ preventScroll: true });
    window.addEventListener("resize", place);
    const onScroll = (event: Event) => { if (!surface.current?.contains(event.target as Node)) place(); };
    window.addEventListener("scroll", onScroll, true);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(place);
    if (trigger.current) observer?.observe(trigger.current);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", onScroll, true); observer?.disconnect(); };
  }, [open]);

  React.useLayoutEffect(() => {
    if (!open || !activeId) return;
    const viewport = list.current;
    const option = document.getElementById(`${listId}-${activeId}`);
    if (!viewport || !option) return;
    if (option.offsetTop < viewport.scrollTop) viewport.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > viewport.scrollTop + viewport.clientHeight)
      viewport.scrollTop = option.offsetTop + option.offsetHeight - viewport.clientHeight;
  }, [open, activeId, listId]);

  React.useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !surface.current?.contains(target)) close();
    };
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("focusin", dismiss);
    return () => { document.removeEventListener("pointerdown", dismiss, true); document.removeEventListener("focusin", dismiss); };
  }, [open]);
  React.useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    // Portal events still bubble through the editor's React tree.
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); close(true); }
    else if (event.key === "Tab") close(true);
    else if (event.key === "Enter") { event.preventDefault(); if (activeId) choose(activeId); }
    else if (["ArrowDown", "ArrowUp"].includes(event.key) || (event.ctrlKey || event.metaKey) && ["Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (!filtered.length) return;
      const index = filtered.findIndex(choice => choice.id === activeId);
      const next = event.key === "Home" ? 0 : event.key === "End" ? filtered.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + filtered.length) % filtered.length;
      setActive(filtered[next].id);
    }
  };

  const label = current === "auto" ? detectedLabel ? `Auto (${detectedLabel})` : "Auto detect" : choices.find(choice => choice.id === current)?.label;
  return <span className="code-language-picker" contentEditable={false}>
    <button type="button" ref={trigger} className="code-language-trigger" aria-label={`Code language: ${label}`}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} disabled={disabled}
      onClick={event => { event.stopPropagation(); if (open) close(); else show(); }}
      onKeyDown={event => {
        event.stopPropagation();
        if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); show(); }
        else if (event.key === "Escape" && open) { event.preventDefault(); close(true); }
      }}>
      <span>{label}</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 6.5 3 3 3-3" /></svg>
    </button>
    {present && createPortal(<div ref={surface} className="code-language-menu" style={{ ...position, pointerEvents: exiting ? "none" : undefined }}
      data-state={exiting ? "closing" : "open"} data-side={side} inert={exiting || undefined} aria-hidden={exiting || undefined}
      onKeyDown={onKeyDown} onClick={event => event.stopPropagation()}>
      <div className="code-language-search-wrap">
        <input ref={search} type="text" className="code-language-search" placeholder="Search languages" aria-label="Search languages"
          role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listId}
          aria-activedescendant={activeId ? `${listId}-${activeId}` : undefined} value={query} spellCheck={false}
          onChange={event => { setQuery(event.target.value); setActive(""); }} />
      </div>
      <div ref={list} id={listId} role="listbox" aria-label="Code languages" className="code-language-list">
        {filtered.map(choice => <div key={choice.id} id={`${listId}-${choice.id}`} role="option" aria-selected={current === choice.id}
          className="code-language-option" data-active={activeId === choice.id || undefined}
          onPointerMove={() => { if (open) setActive(choice.id); }} onMouseDown={event => event.preventDefault()}
          onClick={() => choose(choice.id)}>
          <span>{choice.label}</span>{current === choice.id && <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8 3 3 6-6" /></svg>}
        </div>)}
        {!filtered.length && <div className="code-language-empty" role="status">No languages found</div>}
      </div>
    </div>, document.body)}
  </span>;
}
