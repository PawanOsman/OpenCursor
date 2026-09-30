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
import type { ConversationSummary } from "../types";

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  return d + "d ago";
}

export function History({
  list,
  activeId,
  onSelect,
  onDelete,
  onClose,
  onArchive,
  onFork,
  onSearch,
  results,
}: {
  list: ConversationSummary[];
  activeId?: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onArchive?: (id: string, archived: boolean) => void;
  onFork?: (id: string) => void;
  onSearch?: (query: string, archived: boolean, requestId: number) => void;
  results?: { requestId: number; list: ConversationSummary[] };
}) {
  const [query, setQuery] = React.useState("");
  const [archived, setArchived] = React.useState(false);
  const [requestId, setRequestId] = React.useState(0);
  const searchRef = React.useRef(onSearch);
  searchRef.current = onSearch;
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const id = Date.now() + Math.random();
    setRequestId(id);
    const timer = setTimeout(() => searchRef.current?.(query, archived, id), 120);
    return () => clearTimeout(timer);
  }, [query, archived, list]);

  React.useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    inputRef.current?.focus({ preventScroll: true });
    return () => { if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); };
  }, []);

  const filtered = results?.requestId === requestId ? results.list : archived ? [] : query
    ? list.filter((c) => c.title.toLowerCase().includes(query.toLowerCase()))
    : list;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const groups = [
    { label: "Today", items: filtered.filter((c) => c.updatedAt >= today.getTime()) },
    { label: "Yesterday", items: filtered.filter((c) => c.updatedAt >= yesterday.getTime() && c.updatedAt < today.getTime()) },
    { label: "Earlier", items: filtered.filter((c) => c.updatedAt < yesterday.getTime()) },
  ];

  return (
    <div className="history-overlay" onClick={onClose}>
      <div className="history-popup" role="dialog" aria-modal="true" aria-label="Threads" onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.stopPropagation(); onClose(); }
          if (e.key !== "Tab") return;
          const controls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("button, input"));
          const first = controls[0], last = controls[controls.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
          if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }}>
        <div className="history-heading">
          <span>Threads</span>
          <button className="btn-ghost" aria-pressed={archived} onClick={() => setArchived((value) => !value)}>{archived ? "Show active" : "Archived"}</button>
          <button className="history-close" aria-label="Close threads" onClick={onClose}><Icon name="close" size={16} /></button>
        </div>
        {/* Search */}
        <div className="history-search">
          <Icon name="search" size={14} />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search titles and messages"
            aria-label="Search threads"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
          />
        </div>
        {/* List */}
        <div className="history-list">
          {filtered.length === 0 ? (
            <div className="history-empty">
              {list.length === 0 ? "No conversations yet." : "No results."}
            </div>
          ) : (
            groups.filter((group) => group.items.length > 0).map((group) => (
              <React.Fragment key={group.label}>
                <div className="history-group-label">{group.label}</div>
                {group.items.map((c) => (
                  <div key={c.id} className={"history-item" + (c.id === activeId ? " active" : "")}>
                    <button className="hi-text" aria-current={c.id === activeId ? "true" : undefined} onClick={() => { onSelect(c.id); onClose(); }}>
                      <span className="hi-title">{c.title}</span>
                      <span className="hi-time">{timeAgo(c.updatedAt)}</span>
                      {c.excerpt && <span className="hi-excerpt">{c.excerpt}</span>}
                    </button>
                    {onFork && <button className="hi-del" title="Fork conversation" aria-label="Fork conversation" onClick={() => onFork(c.id)}><Icon name="fork" size={14} /></button>}
                    {onArchive && <button className="hi-del" title={archived ? "Restore conversation" : "Archive conversation"} aria-label={archived ? "Restore conversation" : "Archive conversation"} onClick={() => onArchive(c.id, !archived)}>{archived ? <Icon name="reset" size={14} /> : <Icon name="archive" size={14} />}</button>}
                    <button
                      className="hi-del"
                      title="Delete conversation"
                      aria-label="Delete conversation"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(c.id);
                      }}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                ))}
              </React.Fragment>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
