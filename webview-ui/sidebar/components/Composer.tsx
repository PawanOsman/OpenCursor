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
import { Icon, IconName, iconMarkup } from "../../shared/icons";
import { vscode } from "../../shared/vscode";
import { usePresence } from "../../shared/usePresence";
import { AnimatedTooltip } from "../../shared/AnimatedTooltip";
import { ImagePreview } from "../../shared/ImagePreview";
import { TextSwap } from "../../shared/TextTransitions";
import { AttachmentMenu } from "./AttachmentMenu";
import { ApprovalPicker } from "./ApprovalPicker";
import "./composer-motion.css";
import "./composer-editor.css";
import { ComposerEditor, type ComposerCodeBlock } from "./ComposerEditor";
import { CodeLanguagePicker } from "./CodeLanguagePicker";
import { getCodeLanguage } from "../../shared/codeLanguages";
import type { ApprovalPolicy, Attachment, FileIconInfo, MentionCategory, MentionItem, Mode, ModelDef, ModelOption, OutMessage, PersonaInfo, TeamInfo } from "../types";

/** Top-level @ menu categories. */
const MENTION_CATEGORIES: { id: MentionCategory; label: string; icon: IconName; leaf?: boolean }[] = [
  { id: "files", label: "Files & Folders", icon: "file" },
  { id: "docs", label: "Docs", icon: "book" },
  { id: "terminals", label: "Terminals", icon: "terminal" },
  { id: "chats", label: "Past Chats", icon: "chat" },
];

const KIND_ICON: Record<string, IconName> = {
  file: "file",
  folder: "folder",
  code: "code",
  doc: "book",
  git: "gitCommit",
  composer: "chat",
  terminal: "terminal",
  rule: "ruler",
  branch_diff: "gitBranch",
  link: "link",
};

function post(msg: OutMessage) {
  vscode.postMessage(msg);
}

function activateFromKeyboard(event: React.KeyboardEvent<HTMLElement>, activate: () => void) {
  if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
  event.preventDefault();
  event.stopPropagation();
  activate();
}

// ---- Mention pill icons (raw SVG: pills are plain DOM nodes, not React) ----
export const KIND_SVG: Record<string, string> = Object.fromEntries(Object.entries(KIND_ICON).map(([kind, icon]) => [kind, iconMarkup(icon)]));
const X_SVG = iconMarkup("close");

// Cache of IDE file-icon lookups shared by all pills (host resolves them from
// the active icon theme; same protocol as Tool.tsx).
const pillIconCache = new Map<string, FileIconInfo | null>();
const pillIconWaiters = new Map<string, ((i: FileIconInfo | null) => void)[]>();
const pillLoadedFonts = new Set<string>();
window.addEventListener("message", (e: MessageEvent) => {
  const m = e.data;
  if (m?.type !== "fileIcon") return;
  const icon: FileIconInfo | null = m.icon || null;
  pillIconCache.set(m.filename, icon);
  if (icon?.kind === "font" && !pillLoadedFonts.has(icon.fontFamily)) {
    pillLoadedFonts.add(icon.fontFamily);
    const style = document.createElement("style");
    style.textContent = `@font-face { font-family: "${icon.fontFamily}"; src: url("${icon.src}") format("${icon.format}"); }`;
    document.head.appendChild(style);
  }
  (pillIconWaiters.get(m.filename) || []).forEach((fn) => fn(icon));
  pillIconWaiters.delete(m.filename);
});

function decodePillFontChar(ch: string): string {
  const m = ch.match(/^\\+([0-9a-fA-F]{4,6})$/);
  return m ? String.fromCodePoint(parseInt(m[1], 16)) : ch;
}

/** Fill `el` with the IDE's exact file icon once resolved (async). */
export function applyFileIconTo(el: HTMLElement, path: string) {
  const filename = (path.split(/[\\/]/).pop() || path).replace(/:\d+(-\d+)?$/, "").toLowerCase();
  const render = (icon: FileIconInfo | null) => {
    if (!icon) return; // keep the generic SVG fallback
    if (icon.kind === "img") {
      el.innerHTML = "";
      const img = document.createElement("img");
      img.className = "file-icon-img";
      img.src = icon.src;
      img.alt = "";
      el.appendChild(img);
    } else {
      el.innerHTML = "";
      const span = document.createElement("span");
      span.className = "file-icon-font";
      span.style.fontFamily = icon.fontFamily;
      if (icon.color) span.style.color = icon.color;
      if (icon.size) span.style.fontSize = icon.size;
      span.textContent = decodePillFontChar(icon.char);
      el.appendChild(span);
    }
  };
  if (pillIconCache.has(filename)) {
    render(pillIconCache.get(filename) ?? null);
    return;
  }
  pillIconWaiters.set(filename, [...(pillIconWaiters.get(filename) || []), render]);
  post({ type: "getFileIcon", filename });
}

let mentionReqId = 0;

function uriToPath(uri: string): string {
  let p = uri.trim();
  try {
    // file:///c:/foo -> c:/foo ; file:///home/x -> /home/x
    p = decodeURIComponent(p.replace(/^file:\/\/\/?/i, (m) => (/^[a-z]:/i.test(p.replace(m, "")) ? "" : "/")));
  } catch {}
  return p.replace(/^\/([a-z]:)/i, "$1");
}

/** Parse the various clipboard/drag payloads VS Code emits into file paths. */
function parseDroppedPaths(raws: string[]): string[] {
  // Payloads all describe the SAME dropped file(s) in different formats, so
  // return the first one that parses — never merge them (dupes/[object Object]).
  const uriString = (item: unknown): string => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      for (const k of ["resource", "uri", "external"]) {
        const v = o[k];
        if (typeof v === "string") return v;
        if (v && typeof v === "object") {
          const vo = v as Record<string, unknown>;
          if (typeof vo.fsPath === "string") return vo.fsPath;
          if (typeof vo.path === "string") return vo.path;
          if (typeof vo.external === "string") return vo.external;
        }
      }
      if (typeof o.fsPath === "string") return o.fsPath;
      if (typeof o.path === "string") return o.path;
    }
    return "";
  };
  for (const raw of raws) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (p: string) => {
      const v = p.trim();
      const key = v.replace(/\\/g, "/").toLowerCase();
      if (v && !seen.has(key)) {
        seen.add(key);
        out.push(v);
      }
    };
    // JSON array payloads (codeeditors / resourceurls).
    if (trimmed.startsWith("[")) {
      try {
        const arr = JSON.parse(trimmed);
        if (Array.isArray(arr)) {
          for (const item of arr) {
            const u = uriString(item);
            if (u) push(uriToPath(u));
          }
        }
      } catch {}
    } else {
      for (const line of trimmed.split(/\r?\n/)) {
        const l = line.trim();
        if (!l || l.startsWith("#")) continue;
        push(/^file:/i.test(l) ? uriToPath(l) : l);
      }
    }
    if (out.length) return out;
  }
  return [];
}

let attachCounter = 0;
function newAttachId() {
  return `a_${Date.now()}_${attachCounter++}`;
}

const TEXT_EXT = /\.(txt|md|json|ya?ml|toml|csv|log|js|jsx|ts|tsx|py|java|c|cpp|h|hpp|cs|go|rs|rb|php|html|css|scss|sh|xml|sql)$/i;

function fileToAttachment(file: File): Promise<Attachment | null> {
  return new Promise((resolve) => {
    const isImage = file.type.startsWith("image/");
    const isText = !isImage && (file.type.startsWith("text/") || TEXT_EXT.test(file.name));
    if (!isImage && !isText) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        id: newAttachId(),
        name: file.name || (isImage ? "pasted-image.png" : "file.txt"),
        mime: file.type || (isImage ? "image/png" : "text/plain"),
        data: String(reader.result || ""),
        kind: isImage ? "image" : "text",
      });
    };
    reader.onerror = () => resolve(null);
    if (isImage) {
      reader.readAsDataURL(file);
    } else {
      reader.readAsText(file);
    }
  });
}

const MODES: { id: Mode; label: string; icon: IconName }[] = [
  { id: "agent", label: "Agent", icon: "agent" },
  { id: "plan", label: "Plan", icon: "list" },
  { id: "multitask", label: "Multitask", icon: "task" },
  { id: "project", label: "Project", icon: "users" },
  { id: "ask", label: "Ask", icon: "chat" },
];

/** Parse a context-size label ("200k", "1m", "128k") to a token count. */
function parseContextSize(v: string | undefined): number {
  if (!v) return 0;
  const m = /^([\d.]+)\s*([km])?$/i.exec(v.trim());
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = (m[2] || "").toLowerCase();
  return Math.round(n * (unit === "m" ? 1_000_000 : unit === "k" ? 1_000 : 1));
}

/** Context usage indicator at the trailing edge of the composer. */
function ContextRing({ used, total }: { used: number; total: number }) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const tooltipRef = React.useRef<HTMLDivElement>(null);
  const tooltipId = React.useId();
  const { style } = useAnchoredMenu(open, triggerRef, tooltipRef, [], "center");
  const pct = Math.max(0, Math.min(1, used / total));
  const percent = Math.round(pct * 100);
  const tokens = (value: number) => value >= 1_000_000 ? `${+(value / 1_000_000).toFixed(1)}m` : `${+(value / 1000).toFixed(1)}k`;
  const r = 5.5;
  const c = 2 * Math.PI * r;
  const label = `Context window: ${percent}% used (${100 - percent}% left), ${tokens(used)} / ${tokens(total)} tokens used`;
  return (
    <button ref={triggerRef} type="button" className="ctx-ring" aria-label={label} aria-describedby={open ? tooltipId : undefined}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => { if (document.activeElement !== triggerRef.current) setOpen(false); }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
      onClick={() => setOpen(true)} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } }}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
        <circle
          cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeWidth="2"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} strokeLinecap="round"
          transform="rotate(-90 8 8)"
        />
      </svg>
      <AnimatedTooltip open={open} elementRef={tooltipRef} id={tooltipId} style={style}>
        <span>Context window:</span>
        <span>{percent}% used ({100 - percent}% left)</span>
        <span>{tokens(used)} / {tokens(total)} tokens used</span>
      </AnimatedTooltip>
    </button>
  );
}

function useOutsideClose(open: boolean, close: () => void) {
  React.useEffect(() => {
    if (!open) return;
    const h = () => close();
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [open, close]);
}

/**
 * Anchor a position:fixed dropdown to its trigger, adapting to viewport space:
 * opens above when there's room, flips below otherwise; clamps horizontally.
 * Returns inline styles (left/top or left/bottom) + max height for the menu.
 */
function useAnchoredMenu(open: boolean, triggerRef: React.RefObject<HTMLElement | null>, menuRef: React.RefObject<HTMLElement | null>, deps: unknown[] = [], align: "start" | "center" = "start") {
  // Portals mount after #root. Give them an in-viewport position immediately,
  // before layout measurement or focus can scroll an embedded webview.
  const [style, setStyle] = React.useState<React.CSSProperties>({ left: 8, top: 8 });
  const [maxH, setMaxH] = React.useState(340);
  React.useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const t = triggerRef.current?.getBoundingClientRect();
      const m = menuRef.current;
      if (!t || !m) return;
      const margin = 8;
      const w = m.offsetWidth;
      let left = align === "center" ? t.left + (t.width - w) / 2 : t.left;
      if (left + w > window.innerWidth - margin) left = window.innerWidth - margin - w;
      if (left < margin) left = margin;
      const spaceAbove = t.top - margin * 2;
      const spaceBelow = window.innerHeight - t.bottom - margin * 2;
      const needed = Math.min(340, m.scrollHeight || 340);
      if (spaceAbove >= needed || spaceAbove >= spaceBelow) {
        setStyle({ left, bottom: window.innerHeight - t.top + 6, top: "auto" });
        setMaxH(Math.min(340, spaceAbove));
      } else {
        setStyle({ left, top: t.bottom + 6, bottom: "auto" });
        setMaxH(Math.min(340, spaceBelow));
      }
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, align, ...deps]);
  const side = style.bottom !== undefined && style.bottom !== "auto" ? "top" : "bottom";
  return { style, maxH, side };
}

function usePickerNavigation(open: boolean, setOpen: React.Dispatch<React.SetStateAction<boolean>>,
  triggerRef: React.RefObject<HTMLElement | null>, menuRef: React.RefObject<HTMLDivElement | null>,
  selectedIndex: number, count: number, maxHeight: number) {
  const [focused, setFocused] = React.useState(0);
  const search = React.useRef({ text: "", at: 0 });
  const close = (restoreFocus = false) => {
    setOpen(false);
    search.current = { text: "", at: 0 };
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  };
  const show = (index = selectedIndex) => {
    setFocused(Math.max(0, Math.min(index, count - 1)));
    setOpen(true);
  };
  React.useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const items = menu?.querySelectorAll<HTMLElement>('[role^="menuitem"]');
    const index = Math.max(0, Math.min(focused, (items?.length ?? 0) - 1));
    const item = items?.[index];
    if (index !== focused) setFocused(index);
    if (!menu || !item) { triggerRef.current?.focus({ preventScroll: true }); return; }
    item.focus({ preventScroll: true });
    if (item.offsetTop < menu.scrollTop) menu.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > menu.scrollTop + menu.clientHeight)
      menu.scrollTop = item.offsetTop + item.offsetHeight - menu.clientHeight;
  }, [open, focused, count, maxHeight, menuRef, triggerRef]);
  const triggerKey = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (["Enter", " ", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (open && (event.key === "Enter" || event.key === " ")) close();
      else show(event.key === "Home" ? 0 : event.key === "End" ? count - 1 : selectedIndex);
    } else if (event.key === "Escape" && open) {
      event.preventDefault(); event.stopPropagation(); close(true);
    } else if (event.key === "Tab" && open) close();
  };
  const menuKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === "Tab") { close(true); return; }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (!count) return;
      setFocused(event.key === "Home" ? 0 : event.key === "End" ? count - 1 : (focused + (event.key === "ArrowDown" ? 1 : -1) + count) % count);
    } else if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      const text = (now - search.current.at < 700 ? search.current.text : "") + event.key.toLocaleLowerCase();
      search.current = { text, at: now };
      const query = [...text].every(character => character === text[0]) ? text[0] : text;
      const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
      const start = query.length === 1 ? focused + 1 : focused;
      const match = items.map((_, index) => (index + start) % items.length)
        .find(index => items[index].textContent?.trim().toLocaleLowerCase().startsWith(query));
      if (match !== undefined) { event.preventDefault(); event.stopPropagation(); setFocused(match); }
    }
  };
  return { focused, setFocused, close, show, triggerKey, menuKey };
}

function ModePicker({ mode, onMode }: { mode: Mode; onMode: (m: Mode) => void }) {
  const [open, setOpen] = React.useState(false);
  const { present, exiting } = usePresence(open);
  useOutsideClose(open, () => setOpen(false));
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const menuId = React.useId();
  const { style, maxH, side } = useAnchoredMenu(open, triggerRef, menuRef);
  const nav = usePickerNavigation(open, setOpen, triggerRef, menuRef, MODES.findIndex(item => item.id === mode), MODES.length, maxH);
  const meta = MODES.find((m) => m.id === mode) || MODES[0];
  const pick = (next: Mode) => { if (!open) return; onMode(next); nav.close(true); };
  return (
    <button
      type="button"
      ref={triggerRef}
      className="pill mode-pill"
      aria-label="Choose mode"
      aria-expanded={open}
      aria-haspopup="menu"
      aria-controls={open ? menuId : undefined}
      onKeyDown={nav.triggerKey}
      onClick={(e) => {
        e.stopPropagation();
        if (open) nav.close(); else nav.show();
      }}
    >
      <Icon name={meta.icon} />
      <span>{meta.label}</span>
      <Icon name="chevD" className="cd" />
      {present && createPortal(
        <div ref={menuRef} id={menuId} role="menu" aria-label="Chat mode" className="mode-dropdown"
          data-state={exiting ? "closing" : "open"} data-side={side} inert={exiting || undefined} aria-hidden={exiting || undefined}
          style={{ ...style, maxHeight: maxH, overflowY: "auto", pointerEvents: exiting ? "none" : undefined }} onKeyDown={nav.menuKey} onClick={event => event.stopPropagation()}>
          {MODES.map((o, index) => (
            <div
              key={o.id}
              className={"mode-item" + (o.id === mode ? " active" : "")}
              role="menuitemradio"
              aria-checked={o.id === mode}
              tabIndex={index === nav.focused ? 0 : -1}
              onFocus={() => nav.setFocused(index)}
              onKeyDown={(e) => {
                activateFromKeyboard(e, () => pick(o.id));
              }}
              onClick={(e) => {
                e.stopPropagation();
                pick(o.id);
              }}
            >
              <span className="mi-icon">
                <Icon name={o.icon} />
              </span>
              <span className="mi-label">{o.label}</span>
              {o.id === mode && (
                <span className="mi-check">
                  <Icon name="check" />
                </span>
              )}
            </div>
          ))}
        </div>,
        document.body
      )}
    </button>
  );
}

/** Project-mode team selector: pick one or more teams of subagents for the task. */
function TeamPicker({ teams, selected, onChange }: { teams: TeamInfo[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = React.useState(false);
  const { present, exiting } = usePresence(open);
  useOutsideClose(open, () => setOpen(false));
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const menuId = React.useId();
  const { style, maxH, side } = useAnchoredMenu(open, triggerRef, menuRef, [teams.length]);
  const nav = usePickerNavigation(open, setOpen, triggerRef, menuRef, teams.findIndex(team => selected.includes(team.id)), teams.length, maxH);
  const picked = teams.filter((t) => selected.includes(t.id));
  const label = picked.length === 0 ? "No team" : picked.length === 1 ? picked[0].name : `${picked.length} teams`;
  const toggle = (id: string) => {
    if (!open) return;
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };
  return (
    <button
      type="button"
      ref={triggerRef}
      className="pill mode-pill"
      aria-label="Choose teams"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      onKeyDown={nav.triggerKey}
      title={picked.length ? picked.map((t) => `${t.name}: ${t.members.join(", ")}`).join("\n") : "Select the team(s) that will work on this task"}
      onClick={(e) => {
        e.stopPropagation();
        if (open) nav.close(); else nav.show();
      }}
    >
      <Icon name="users" />
      <span>{label}</span>
      <Icon name="chevD" className="cd" />
      {present && createPortal(
        <div ref={menuRef} id={menuId} role="menu" aria-label="Teams" className="mode-dropdown team-dropdown"
          data-state={exiting ? "closing" : "open"} data-side={side} inert={exiting || undefined} aria-hidden={exiting || undefined}
          style={{ ...style, maxHeight: maxH, overflowY: "auto", pointerEvents: exiting ? "none" : undefined }} onKeyDown={nav.menuKey} onClick={event => event.stopPropagation()}>
          {teams.length === 0 && <div className="mode-item" role="presentation">No teams configured</div>}
          {teams.map((t, index) => (
            <div
              key={t.id}
              className={"mode-item" + (selected.includes(t.id) ? " active" : "")}
              role="menuitemcheckbox"
              aria-checked={selected.includes(t.id)}
              tabIndex={index === nav.focused ? 0 : -1}
              onFocus={() => nav.setFocused(index)}
              onKeyDown={event => activateFromKeyboard(event, () => toggle(t.id))}
              onClick={(e) => {
                e.stopPropagation();
                toggle(t.id);
              }}
            >
              <span className="mi-icon">
                <Icon name="users" />
              </span>
              <span className="mi-label">
                {t.name}
                <span className="mi-sub">{t.members.join(", ") || "no members"}</span>
              </span>
              {selected.includes(t.id) && (
                <span className="mi-check">
                  <Icon name="check" />
                </span>
              )}
            </div>
          ))}
        </div>,
        document.body
      )}
    </button>
  );
}

/** Short summary of a model's options, e.g. "Low · Thinking". */
function optionSummary(opts: ModelOption[]): string {
  const parts: string[] = [];
  for (const o of opts) {
    if (o.key === "thinking") {
      // Adaptive-only models: "adaptive" IS thinking, so label it "Thinking".
      const adaptiveOnly = !(o.values || []).includes("enabled");
      if (o.value && o.value !== "disabled") parts.push(o.value === "adaptive" && !adaptiveOnly ? "Adaptive" : "Thinking");
    } else if (o.key === "speed") {
      if (o.value === "fast") parts.push("Fast");
    } else if (o.type === "toggle") {
      if (o.value === "true") parts.push(o.label);
    } else if (o.value) {
      parts.push(VALUE_LABELS[o.value] ?? o.value);
    }
  }
  return parts.join(" · ");
}

/**
 * Thinking control: an on/off switch, with a nested "Adaptive" switch shown only
 * when the model supports BOTH adaptive and enabled. The available modes come
 * from the option's `values`:
 *  - [disabled, adaptive, enabled] → toggle + adaptive sub-switch.
 *  - [disabled, adaptive]          → toggle; on = always adaptive (no sub-switch).
 *  - [disabled, enabled]           → toggle; on = manual enabled (no sub-switch).
 */
function ThinkingControl({ value, values, onChange }: { value: string; values: string[]; onChange: (v: string) => void }) {
  const hasAdaptive = values.includes("adaptive");
  const hasEnabled = values.includes("enabled");
  const canChooseAdaptive = hasAdaptive && hasEnabled;
  const onValue = hasAdaptive ? "adaptive" : "enabled"; // what "on" turns into
  const on = value !== "disabled" && value !== "" && value != null;
  const adaptive = value === "adaptive";
  return (
    <div className="mo-thinking">
      <div className="mo-toggle" role="switch" tabIndex={0} aria-checked={on} aria-label="Thinking" onKeyDown={(event) => activateFromKeyboard(event, () => onChange(on ? "disabled" : onValue))} onClick={() => onChange(on ? "disabled" : onValue)}>
        <span className="mo-label">Thinking</span>
        <span className={"mo-switch" + (on ? " on" : "")}><span className="mo-knob" /></span>
      </div>
      {on && canChooseAdaptive && (
        <div className="mo-toggle sub" role="switch" tabIndex={0} aria-checked={adaptive} aria-label="Adaptive thinking" onKeyDown={(event) => activateFromKeyboard(event, () => onChange(adaptive ? "enabled" : "adaptive"))} onClick={() => onChange(adaptive ? "enabled" : "adaptive")}>
          <span className="mo-label">Adaptive</span>
          <span className={"mo-switch" + (adaptive ? " on" : "")}><span className="mo-knob" /></span>
        </div>
      )}
    </div>
  );
}

/** Friendly labels for option values (reasoning effort tiers etc.). */
const VALUE_LABELS: Record<string, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
  standard: "Standard",
  fast: "Fast",
};

/** Editable option groups for one model (left column of the picker). */
function ModelOptions({ model, onChange }: { model: ModelDef; onChange: (opts: ModelOption[]) => void }) {
  const descriptionId = React.useId();
  const setOpt = (i: number, value: string) => onChange(model.options.map((o, idx) => (idx === i ? { ...o, value } : o)));
  if (model.options.length === 0) {
    return <div className="mo-empty">No options for this model.</div>;
  }
  return (
    <div className="model-options">
      {model.options.map((o, i) =>
        o.key === "thinking" ? (
          <ThinkingControl key={i} value={o.value} values={o.values || ["disabled", "adaptive", "enabled"]} onChange={(v) => setOpt(i, v)} />
        ) : o.type === "toggle" ? (
          <div
            key={i}
            className="mo-toggle"
            role="switch"
            tabIndex={0}
            aria-label={o.label}
            aria-checked={o.value === "true"}
            onKeyDown={(event) => activateFromKeyboard(event, () => setOpt(i, o.value === "true" ? "false" : "true"))}
            onClick={() => setOpt(i, o.value === "true" ? "false" : "true")}
          >
            <span className="mo-label">{o.label}</span>
            <span className={"mo-switch" + (o.value === "true" ? " on" : "")}>
              <span className="mo-knob" />
            </span>
          </div>
        ) : (
          <div key={i} className="mo-group">
            <div className="mo-group-label">{o.label}</div>
            {o.description && <p id={`${descriptionId}-${i}`} className="mo-description">{o.description}</p>}
            {(o.values || []).map((v) => (
              <div key={v} className={"mo-item" + (v === o.value ? " active" : "")} role="button" tabIndex={0} aria-label={`${o.label}: ${VALUE_LABELS[v] ?? v}`} aria-describedby={o.description ? `${descriptionId}-${i}` : undefined} aria-pressed={v === o.value} onKeyDown={(event) => activateFromKeyboard(event, () => setOpt(i, v))} onClick={() => setOpt(i, v)}>
                <span>{VALUE_LABELS[v] ?? v}</span>
                {v === o.value && <Icon name="check" className="mo-check" />}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

function ModelRow({
  m,
  selected,
  editingId,
  onSelect,
  onEdit,
  onReset,
}: {
  m: ModelDef;
  selected: string;
  editingId: string | null;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onReset: (id: string) => void;
}) {
  const editable = m.options.length > 0;
  const [reset, setReset] = React.useState(false);
  const doReset = () => {
    onReset(m.id);
    setReset(true);
    setTimeout(() => setReset(false), 1000);
  };
  return (
    <div
      className={"model-item" + (m.id === selected ? " active" : "") + (m.id === editingId ? " editing" : "")}
      role="button"
      tabIndex={0}
      aria-label={`Select ${m.name}`}
      aria-pressed={m.id === selected}
      onKeyDown={(event) => activateFromKeyboard(event, () => onSelect(m.id))}
      onClick={() => onSelect(m.id)}
    >
      <span className="model-item-name">{m.name}</span>
      {optionSummary(m.options) && <span className="model-item-sum">{optionSummary(m.options)}</span>}
      {editable && (
        <span className="model-item-actions" onClick={(e) => e.stopPropagation()}>
          <button className={"mia-btn" + (reset ? " ok" : "")} title="Reset options" onClick={doReset}>
            <Icon name={reset ? "check" : "reset"} />
          </button>
          <button className="mia-btn" title="Edit options" onClick={() => onEdit(m.id)}>
            <Icon name="edit" />
          </button>
        </span>
      )}
      {m.id === selected && <Icon name="check" className="model-item-check" />}
    </div>
  );
}

function HeadReset({ onReset }: { onReset: () => void }) {
  const [ok, setOk] = React.useState(false);
  return (
    <button
      className={"mp-reset" + (ok ? " ok" : "")}
      title="Reset to defaults"
      onClick={() => {
        onReset();
        setOk(true);
        setTimeout(() => setOk(false), 1000);
      }}
    >
      <Icon name={ok ? "check" : "reset"} />
    </button>
  );
}

function ModelPicker({
  models,
  modelList,
  selected,
  onSelect,
  onSaveOptions,
  onResetOptions,
}: {
  models: string[];
  modelList: ModelDef[];
  selected: string;
  onSelect: (m: string) => void;
  onSaveOptions: (modelId: string, options: ModelOption[]) => void;
  onResetOptions: (modelId: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const { present, exiting } = usePresence(open);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  useOutsideClose(open, () => {
    setOpen(false);
  });
  React.useEffect(() => {
    if (present) return;
    setEditingId(null);
    setQuery("");
  }, [present]);

  // modelList is already the server-filtered set (enabled + default). Fall back to
  // raw ids only if the extension hasn't sent a modelList yet.
  const list: ModelDef[] = React.useMemo(() => {
    if (modelList.length) return modelList;
    return models.map((id) => ({ id, name: id, kind: "openai" as const, options: [] }));
  }, [modelList, models]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
  }, [list, query]);
  const isLocal = (m: ModelDef) => m.kind === "llamacpp" || m.kind === "ollama";
  const llamacppLocal = filtered.filter((m) => m.kind === "llamacpp");
  const ollamaLocal = filtered.filter((m) => m.kind === "ollama");
  // Non-local models grouped by the provider that serves them.
  const byProvider = React.useMemo(() => {
    const groups = new Map<string, ModelDef[]>();
    for (const m of filtered) {
      if (isLocal(m)) continue;
      const key = m.providerName || "Other";
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(m);
    }
    return [...groups.entries()];
  }, [filtered]);

  const editing = editingId ? list.find((m) => m.id === editingId) || null : null;
  const selectedModel = list.find((m) => m.id === selected);
  const selLabel = selected === "auto" ? "Auto" : selectedModel?.name || selected || "no model";
  const summary = selectedModel ? optionSummary(selectedModel.options.filter(option => ["reasoning_effort", "effort", "thinking", "speed"].includes(option.key))) : "";

  const triggerRef = React.useRef<HTMLSpanElement>(null);
  const pickerRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  // Anchor the fixed picker to the trigger; flips below when no room above.
  const { style: pickerStyle, maxH, side } = useAnchoredMenu(open, triggerRef, pickerRef, [list.length, !!editing]);
  React.useLayoutEffect(() => {
    // React autoFocus runs before the portal's first position is applied.
    // Focus explicitly without moving the document or the surrounding frame.
    if (open && !editing) searchRef.current?.focus({ preventScroll: true });
  }, [open, !!editing]);

  const pick = (id: string) => {
    if (!open) return;
    onSelect(id);
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  return (
    <span
      ref={triggerRef}
      className="model-select"
      role="button"
      tabIndex={0}
      aria-label="Choose model"
      aria-expanded={open}
      title={[selLabel, summary].filter(Boolean).join(" · ")}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => !o); }
        if (e.key === "Escape") setOpen(false);
      }}
      onClick={(e) => {
        e.stopPropagation();
        setOpen((o) => !o);
      }}
    >
      <TextSwap className="label" text={selLabel} />
      {summary && <span className="model-summary">{summary}</span>}
      <Icon name="chevD" className="cd" />
      {present && createPortal(
        <div ref={pickerRef} className="model-picker" data-state={exiting ? "closing" : "open"} data-side={side} inert={exiting || undefined} aria-hidden={exiting || undefined}
          style={{ ...pickerStyle, "--mp-max-h": `${maxH}px`, pointerEvents: exiting ? "none" : undefined } as React.CSSProperties}
          onClickCapture={event => { if (!open) { event.preventDefault(); event.stopPropagation(); } }}
          onKeyDownCapture={event => { if (!open) { event.preventDefault(); event.stopPropagation(); } }}
          onClick={(e) => e.stopPropagation()} onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault(); event.stopPropagation(); setOpen(false); triggerRef.current?.focus({ preventScroll: true });
        }}>
          {editing ? (
            <div className="model-picker-view">
              <div className="mp-head">
                <button className="mp-back" title="Back" onClick={() => setEditingId(null)}>
                  <Icon name="chevR" className="mp-back-icon" /> Back
                </button>
                <span className="mp-head-title">{editing.name}</span>
                <HeadReset onReset={() => onResetOptions(editing.id)} />
              </div>
              <div className="mp-body">
                <ModelOptions model={editing} onChange={(opts) => onSaveOptions(editing.id, opts)} />
              </div>
            </div>
          ) : (
            <div className="model-picker-view">
              <div className="mp-search">
                <Icon name="search" className="mp-search-icon" />
                <input
                  ref={searchRef}
                  value={query}
                  placeholder="Search models"
                  onChange={(e) => setQuery(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
              <div className="mp-body">
                {/* Auto (judge-picked model) hidden for now — bring back later.
                <div className={"model-item auto" + (selected === "auto" ? " active" : "")} onClick={() => pick("auto")}>
                  <Icon name="infinity" className="model-item-ico" />
                  <span className="model-item-name">Auto</span>
                  <span className="model-item-sum">picks a model for you</span>
                  {selected === "auto" && <Icon name="check" className="model-item-check" />}
                </div>
                */}
                {filtered.length === 0 && <div className="model-item dim">No matches</div>}
                {byProvider.map(([provName, list]) => (
                  <React.Fragment key={provName}>
                    <div className="mp-group-label">{provName}</div>
                    {list.map((m) => (
                      <ModelRow key={m.id} m={m} selected={selected} editingId={editingId} onSelect={pick} onEdit={setEditingId} onReset={onResetOptions} />
                    ))}
                  </React.Fragment>
                ))}
                {llamacppLocal.length > 0 && <div className="mp-group-label">Local · llama.cpp</div>}
                {llamacppLocal.map((m) => (
                  <ModelRow key={m.id} m={m} selected={selected} editingId={editingId} onSelect={pick} onEdit={setEditingId} onReset={onResetOptions} />
                ))}
                {ollamaLocal.length > 0 && <div className="mp-group-label">Local · Ollama</div>}
                {ollamaLocal.map((m) => (
                  <ModelRow key={m.id} m={m} selected={selected} editingId={editingId} onSelect={pick} onEdit={setEditingId} onReset={onResetOptions} />
                ))}
                <div
                  className="model-item add-models"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => activateFromKeyboard(event, () => { post({ type: "openSettings", section: "models" }); setOpen(false); })}
                  onClick={() => {
                    post({ type: "openSettings", section: "models" });
                    setOpen(false);
                  }}
                >
                  <Icon name="plus" className="model-item-ico" />
                  <span className="model-item-name">Add models</span>
                </div>
              </div>
            </div>
          )}
        </div>,
        document.body
      )}
    </span>
  );
}

export type ComposerDraft = { text: string; attachments: Attachment[] };

export function Composer({
  mode,
  onMode,
  models,
  modelList,
  selectedModel,
  onSelectModel,
  onSaveModelOptions,
  onResetModelOptions,
  isRunning,
  isFirst,
  focusKey,
  onSubmit,
  onCancel,
  initialText,
  initialAttachments,
  editing,
  onCancelEdit,
  submitWithCtrlEnter,
  draft,
  tabDraft,
  onTabDraft,
  usedTokens,
  queuedCount,
  onRunNextQueued,
  teams,
  activeTeamIds,
  onTeams,
  approvalPolicy,
  persona,
}: {
  mode: Mode;
  onMode: (m: Mode) => void;
  /** Subagent teams available for Project mode. */
  teams?: TeamInfo[];
  activeTeamIds?: string[];
  onTeams?: (ids: string[]) => void;
  approvalPolicy?: ApprovalPolicy;
  persona?: PersonaInfo;
  models: string[];
  modelList: ModelDef[];
  selectedModel: string;
  onSelectModel: (m: string) => void;
  onSaveModelOptions: (modelId: string, options: ModelOption[]) => void;
  onResetModelOptions: (modelId: string) => void;
  isRunning: boolean;
  isFirst?: boolean;
  focusKey?: string;
  onSubmit: (text: string, attachments: Attachment[]) => void;
  onCancel: () => void;
  /** Edit mode: seed the editor with an existing message + attachments. */
  initialText?: string;
  initialAttachments?: Attachment[];
  /** When true, renders as an inline edit composer (Save/Cancel affordances). */
  editing?: boolean;
  onCancelEdit?: () => void;
  /** When true, Ctrl+Enter submits and plain Enter inserts a newline. */
  submitWithCtrlEnter?: boolean;
  /** Restored (unsent) message: replaces the editor content when set. */
  draft?: { text: string; attachments?: Attachment[]; mentions?: MentionItem[] } | null;
  /** Saved draft restored on startup, host updates, and chat switches. */
  tabDraft?: ComposerDraft | null;
  /** Fired whenever the composer content changes (tab switch / typing). */
  onTabDraft?: (d: ComposerDraft) => void;
  /** Tokens consumed by the conversation so far (drives the context ring). */
  usedTokens?: number;
  /** Queued messages count; Enter on an empty editor fires the next one now. */
  queuedCount?: number;
  onRunNextQueued?: () => void;
}) {
  const [attachments, setAttachments] = React.useState<Attachment[]>(initialAttachments ?? []);
  const [previewImageId, setPreviewImageId] = React.useState<string | null>(null);
  const previewImages = React.useMemo(() => attachments.filter(attachment => attachment.kind === "image"), [attachments]);
  React.useEffect(() => { setPreviewImageId(null); }, [focusKey]);
  const [dragOver, setDragOver] = React.useState(false);
  const [empty, setEmpty] = React.useState(true); // whether there is text to send
  const [showPlaceholder, setShowPlaceholder] = React.useState(true);
  const edRef = React.useRef<HTMLDivElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const richEditor = React.useRef<ComposerEditor | null>(null);
  const [codeBlocks, setCodeBlocks] = React.useState<ComposerCodeBlock[]>([]);
  const codeLabels = React.useMemo(() => new Map(codeBlocks.map(block => [block.id,
    block.code.trim() ? getCodeLanguage(block.code, block.language).label : "",
  ])), [codeBlocks]);
  const submitWithCtrlEnterRef = React.useRef(submitWithCtrlEnter);
  const submitRef = React.useRef<() => void>(() => {});
  submitWithCtrlEnterRef.current = submitWithCtrlEnter;

  // @-mention popup state
  const [mentionOpen, setMentionOpen] = React.useState(false);
  const mentionOpenRef = React.useRef(false);
  mentionOpenRef.current = mentionOpen;
  const [mentionItems, setMentionItems] = React.useState<MentionItem[]>([]);
  const [mentionIndex, setMentionIndex] = React.useState(0);
  // null = top-level category menu; set = drilled into one category.
  const [mentionCat, setMentionCat] = React.useState<MentionCategory | null>(null);
  const mentionCatRef = React.useRef<MentionCategory | null>(null);
  const [mentionQuery, setMentionQuery] = React.useState("");
  const mentionQueryRef = React.useRef("");
  const mentionIndexRef = React.useRef(0);
  const reqRef = React.useRef(0);
  // Saved Range marking the typed "@query" (so we can replace it on pick).
  const queryRangeRef = React.useRef<Range | null>(null);
  // True while a Ctrl+Shift+V paste is in flight (paste as plain text, no link pills).
  const plainPasteRef = React.useRef(false);
  // Paste held back while the host checks if it matches project code.
  const pastePendingRef = React.useRef<{ id: number; text: string } | null>(null);
  // Set after detectMention is defined (insert fns are declared before it).
  const detectMentionRef = React.useRef<(() => void) | null>(null);

  const undoEdit = () => richEditor.current?.undo();
  const redoEdit = () => richEditor.current?.redo();

  React.useLayoutEffect(() => {
    const element = edRef.current;
    if (!element) return;
    const editor = new ComposerEditor(element, {
      createMention: makeMentionEl,
      onChange: () => { refreshEmpty(); detectMentionRef.current?.(); emitDraft(); },
      onCodeBlocks: setCodeBlocks,
      submitWithCtrlEnter: () => !!submitWithCtrlEnterRef.current,
      onSubmit: () => submitRef.current(),
      shouldHandleKeys: () => !mentionOpenRef.current,
    });
    richEditor.current = editor;
    return () => { editor.destroy(); richEditor.current = null; };
  }, []);

  const setCat = (c: MentionCategory | null) => {
    mentionCatRef.current = c;
    setMentionCat(c);
  };

  const setIndex = (i: number) => {
    mentionIndexRef.current = i;
    setMentionIndex(i);
  };

  const refreshEmpty = React.useCallback(() => {
    const ed = edRef.current;
    setEmpty(richEditor.current ? richEditor.current.isEmpty() : !ed || (ed.textContent || "").trim() === "" && ed.querySelectorAll(".mention").length === 0);
    setShowPlaceholder(richEditor.current ? richEditor.current.isEmptyParagraph() : !ed?.hasChildNodes());
  }, []);

  const onTabDraftRef = React.useRef(onTabDraft);
  React.useEffect(() => { onTabDraftRef.current = onTabDraft; }, [onTabDraft]);
  const attachmentsRef = React.useRef(attachments);
  React.useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  const restoredDraftRef = React.useRef<{ focusKey?: string; draft?: ComposerDraft | null } | null>(null);
  // Serialize is defined below; snapshot via ref so tab-switch effect can call it.
  const serializeRef = React.useRef<() => string>(() => "");

  const emitDraft = React.useCallback(() => {
    if (editing) return;
    onTabDraftRef.current?.({ text: serializeRef.current(), attachments: attachmentsRef.current });
  }, [editing]);

  // Startup can deliver a saved draft after this composer already mounted for
  // the same chat. Restore that snapshot too; local draft echoes keep history.
  React.useEffect(() => {
    if (editing) return;
    const previous = restoredDraftRef.current;
    const switched = previous != null && previous.focusKey !== focusKey;
    restoredDraftRef.current = { focusKey, draft: tabDraft };
    if (tabDraft || previous && (switched || previous.draft !== tabDraft)) {
      const text = tabDraft?.text ?? "";
      // Comparing the serialized document avoids resetting selection/history
      // when the parent returns the draft we just emitted while typing.
      if (switched || richEditor.current?.getText() !== text) richEditor.current?.setText(text);
      const nextAttachments = tabDraft?.attachments ?? [];
      const current = attachmentsRef.current;
      if (current !== nextAttachments && (current.length !== nextAttachments.length || current.some((item, index) => {
        const next = nextAttachments[index];
        return item.id !== next.id || item.name !== next.name || item.mime !== next.mime || item.kind !== next.kind || item.data !== next.data;
      }))) {
        // The draft emission effect below must see restored attachments in
        // this same pass, before the state update triggers another render.
        attachmentsRef.current = nextAttachments;
        setAttachments(nextAttachments);
      }
      refreshEmpty();
    }
    if (!isRunning && (!previous || switched)) edRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, tabDraft, editing]);

  /**
   * Fill the editor with message text, turning each <attached type=".."
   * title=".." content=".." /> tag back into a pill. The tag itself IS the
   * stored/sent representation, so edits always restore full mention objects.
   */
  const seedEditor = (_ed: HTMLDivElement, text: string) => {
    richEditor.current?.setText(text);
  };

  // Seed the editor once with existing text when opened in edit mode.
  React.useEffect(() => {
    const ed = edRef.current;
    if (!ed || initialText == null) return;
    seedEditor(ed, initialText);
    refreshEmpty();
    // Place caret at end + focus.
    ed.focus();
    const range = document.createRange();
    range.selectNodeContents(ed);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A reverted message arrives as a draft: load it into the editor as if unsent.
  React.useEffect(() => {
    if (!draft) return;
    const ed = edRef.current;
    if (!ed) return;
    seedEditor(ed, draft.text);
    attachmentsRef.current = draft.attachments ?? [];
    setAttachments(draft.attachments ?? []);
    refreshEmpty();
    ed.focus();
    const range = document.createRange();
    range.selectNodeContents(ed);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const queryFiles = React.useCallback((q: string) => {
    const id = ++mentionReqId;
    reqRef.current = id;
    post({ type: "searchFiles", query: q, requestId: id });
  }, []);

  const queryMentions = React.useCallback((cat: MentionCategory, q: string) => {
    const id = ++mentionReqId;
    reqRef.current = id;
    post({ type: "searchMentions", kind: cat, query: q, requestId: id });
  }, []);

  /** Categories filtered by the typed @query (top-level menu). */
  const filteredCats = React.useMemo(() => {
    const q = mentionQuery.toLowerCase();
    if (!q) return MENTION_CATEGORIES;
    return MENTION_CATEGORIES.filter((c) => c.label.toLowerCase().includes(q));
  }, [mentionQuery]);

  const addFiles = React.useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files);
    const results = await Promise.all(arr.map(fileToAttachment));
    const valid = results.filter((a): a is Attachment => a !== null);
    if (valid.length) {
      setAttachments((prev) => [...prev, ...valid]);
    }
  }, []);

  // Build an inline, non-editable mention pill with a keyboard-reachable
  // removal button after its label. Delegated events survive undo restoration.
  const makeMentionEl = (m: MentionItem): HTMLElement => {
    const span = document.createElement("span");
    span.className = "mention";
    span.contentEditable = "false";
    span.dataset.path = m.path;
    span.dataset.kind = m.kind;
    span.dataset.name = m.name;
    if (m.detail) span.dataset.detail = m.detail;
    span.title = m.detail || m.path;

    const icon = document.createElement("span");
    icon.className = "mention-icon";
    icon.innerHTML = KIND_SVG[m.kind] || KIND_SVG.file;
    if (m.kind === "file" || m.kind === "code") applyFileIconTo(icon, m.path);
    span.appendChild(icon);

    const label = document.createElement("span");
    label.className = "mention-label";
    label.textContent = m.name;
    span.appendChild(label);
    const x = document.createElement("button");
    x.type = "button";
    x.className = "mention-x";
    x.innerHTML = X_SVG;
    x.title = `Remove ${m.name}`;
    x.setAttribute("aria-label", `Remove mention ${m.name}`);
    x.tabIndex = 0;
    span.appendChild(x);
    return span;
  };

  const removeMention = (pill: HTMLElement) => {
    richEditor.current?.removeMention(pill);
    refreshEmpty();
    setMentionOpen(false);
    emitDraft();
  };

  // Move the caret to the end of the editor if the selection isn't inside it.
  const ensureCaretInEditor = () => {
    const ed = edRef.current;
    if (!ed) return;
    ed.focus();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !ed.contains(sel.anchorNode)) {
      const range = document.createRange();
      range.selectNodeContents(ed);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  };

  const insertTextAtCaret = (text: string, markdown = true) => {
    ensureCaretInEditor();
    richEditor.current?.insertText(text, markdown);
    refreshEmpty();
  };

  const insertMention = (mention: MentionItem) => {
    ensureCaretInEditor();
    richEditor.current?.insertMention(mention);
    refreshEmpty();
  };

  // Make the whole webview a valid drop target. VS Code only routes drag events
  // INTO a webview while the user holds Shift (otherwise the editor's own drop
  // overlay captures pointer events and opens the file in an editor group).
  React.useEffect(() => {
    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      const dt = e.dataTransfer;
      if (!dt) return;
      if (dt.files.length) {
        addFiles(dt.files);
      }
      const raws = [
        dt.getData("text/uri-list"),
        dt.getData("application/vnd.code.uri-list"),
        dt.getData("codeeditors"),
        dt.getData("resourceurls"),
        dt.getData("text/plain"),
      ].filter(Boolean);
      const paths = parseDroppedPaths(raws);
      if (paths.length) {
        for (const p of paths) {
          const name = p.split(/[\\/]/).pop() || p;
          insertMention({ path: p, name, kind: "file" });
        }
      } else if (!dt.files.length) {
        const plain = dt.getData("text/plain");
        if (plain) insertTextAtCaret(plain);
      }
    };
    const over = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setDragOver(true);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragOver(false);
    };
    // Capture phase so we win before VS Code's own webview handlers.
    window.addEventListener("dragover", over, true);
    window.addEventListener("drop", handleDrop, true);
    window.addEventListener("dragleave", leave, true);
    return () => {
      window.removeEventListener("dragover", over, true);
      window.removeEventListener("drop", handleDrop, true);
      window.removeEventListener("dragleave", leave, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Receive attachments + file-search results from the extension.
  React.useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.type === "attachmentsPicked" && Array.isArray(msg.attachments)) {
        setAttachments((prev) => [...prev, ...msg.attachments]);
      } else if (msg?.type === "fileSearchResults" && msg.requestId === reqRef.current) {
        setMentionItems(msg.items || []);
        setIndex(0);
      } else if (msg?.type === "mentionSearchResults" && msg.requestId === reqRef.current) {
        setMentionItems(msg.items || []);
        setIndex(0);
      } else if (msg?.type === "insertMention" && msg.mention && !editing) {
        // Ctrl+L from the editor: insert a @code/@file pill at the caret.
        insertMention(msg.mention as MentionItem);
      } else if (msg?.type === "pasteResolved" && pastePendingRef.current && msg.requestId === pastePendingRef.current.id) {
        // Host checked the pasted text against project files.
        const pending = pastePendingRef.current;
        pastePendingRef.current = null;
        if (msg.mention) insertMention(msg.mention as MentionItem);
        else insertTextAtCaret(pending.text);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const removeAttachment = (id: string) => setAttachments((prev) => prev.filter((a) => a.id !== id));

  // Detect an active "@query" right before the caret (within the current text node).
  const detectMention = React.useCallback(() => {
    const close = () => {
      setMentionOpen(false);
      setCat(null);
    };
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) {
      close();
      return;
    }
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE || !edRef.current?.contains(node) || node.parentElement?.closest("pre, code, .mention")) {
      close();
      return;
    }
    const text = node.textContent || "";
    const caret = range.startOffset;
    const upto = text.slice(0, caret);
    const at = upto.lastIndexOf("@");
    if (at === -1) {
      close();
      return;
    }
    const frag = upto.slice(at + 1);
    const prevChar = at > 0 ? upto[at - 1] : "";
    // Inside a category, allow spaces in the query (e.g. commit messages).
    if ((at !== 0 && !/\s/.test(prevChar)) || (mentionCatRef.current === null && /\s/.test(frag))) {
      close();
      return;
    }
    // Save the range covering "@frag" so we can replace it on selection.
    const r = document.createRange();
    r.setStart(node, at);
    r.setEnd(node, caret);
    queryRangeRef.current = r;
    setMentionOpen(true);
    mentionQueryRef.current = frag;
    setMentionQuery(frag);
    // Pasting/typing a URL after @ becomes a Link mention.
    if (/^https?:\/\//.test(frag)) {
      setCat("link");
      queryMentions("link", frag);
      return;
    }
    const cat = mentionCatRef.current;
    if (cat) queryMentions(cat, frag);
    else queryFiles(frag); // top level: quick file results above the categories
  }, [queryFiles, queryMentions]);
  detectMentionRef.current = detectMention;

  const pickMention = React.useCallback((m: MentionItem) => {
    const ed = edRef.current;
    const qr = queryRangeRef.current;
    if (!ed) return;
    if (qr) {
      // Replace the typed query and insert the mention as one undoable edit.
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(qr);
    }
    insertMention(m);
    setMentionOpen(false);
    setCat(null);
    queryRangeRef.current = null;
  }, []);

  /** Drill into a category from the top-level @ menu (leafs insert directly). */
  const pickCategory = React.useCallback((cat: MentionCategory) => {
    setCat(cat);
    setMentionItems([]);
    setIndex(0);
    queryMentions(cat, mentionQueryRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryMentions]);

  React.useEffect(() => {
    edRef.current?.focus();
  }, []);

  // Serialize the document as Markdown. Mention pills become full
  // <attached type=".." title=".." content=".." /> tags — the message text
  // itself carries the complete mention data and is sent to the AI as-is.
  const serialize = (): string => richEditor.current?.getText() ?? "";
  serializeRef.current = serialize;

  // Keep parent draft map in sync (typing + attachment chips).
  React.useEffect(() => {
    if (editing) return;
    emitDraft();
  }, [attachments, empty, editing, emitDraft]);

  const clear = () => {
    if (edRef.current) {
      richEditor.current?.setText("");
      edRef.current.focus();
    }
    refreshEmpty();
    if (!editing) onTabDraftRef.current?.({ text: "", attachments: [] });
  };

  // Send (or queue, when a run is in flight). Never stops the run — stopping is
  // only possible via an explicit click on the stop button.
  const submit = () => {
    const text = serialize();
    if (!text && attachments.length === 0) {
      // Empty editor + queued messages: fire the next queued one immediately
      // (replaces the current run if one is in flight).
      if ((queuedCount ?? 0) > 0) onRunNextQueued?.();
      return;
    }
    if (!editing) clear();
    const sent = attachments;
    if (!editing) setAttachments([]);
    setMentionOpen(false);
    setCat(null);
    onSubmit(text, sent);
  };
  submitRef.current = submit;

  const hasContent = !empty || attachments.length > 0;
  const canSend = hasContent;
  // While running with an empty editor the button is a Stop button; as soon as
  // there's content it becomes Send (which queues behind the current run).
  const showStop = !editing && isRunning && !hasContent;

  return (
    <div className={"chat-input" + (editing ? " is-editing" : "")}>
      <div
        className={"composer" + (dragOver ? " drag-over" : "")}
      >
        {dragOver && (
          <div className="drop-hint">
            <Icon name="at" size={13} /> Drop to mention &nbsp;·&nbsp; hold <kbd>Shift</kbd> if it opens the file instead
          </div>
        )}
        {attachments.length > 0 && (
          <div className="attach-chips">
            {attachments.map((a) => (
              <div className="attach-chip" key={a.id} title={a.name}>
                {a.kind === "image" ? (
                  <button type="button" className="image-attachment-trigger" aria-label={`Preview image ${a.name}`}
                    aria-haspopup="dialog" onClick={() => setPreviewImageId(a.id)}>
                    <img className="attach-thumb" src={a.data} alt="" />
                  </button>
                ) : (
                  <div className="attach-file">
                    <Icon name="file" size={16} />
                  </div>
                )}
                <button type="button" className="attach-remove" onClick={() => removeAttachment(a.id)} aria-label={`Remove ${a.name}`}>
                  <Icon name="close" size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
        {mentionOpen && (
          <div className="mention-popup" onMouseDown={(e) => e.preventDefault()}>
            {mentionCat === null ? (
              <>
                {/* Quick file results, divider, then categories. */}
                {mentionItems.slice(0, 3).map((m, i) => (
                  <div
                    key={m.kind + m.path}
                    className={"mention-item" + (i === mentionIndex ? " active" : "")}
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => pickMention(m)}
                  >
                    <Icon name={KIND_ICON[m.kind] || "file"} size={14} />
                    <span className="mi-name">{m.name}</span>
                    <span className="mi-path">{(m.detail ?? m.path).replace(/\/[^/]*$/, "") || "."}</span>
                  </div>
                ))}
                {mentionItems.length > 0 && filteredCats.length > 0 && <div className="mention-divider" />}
                {filteredCats.map((c, i) => {
                  const idx = Math.min(3, mentionItems.length) + i;
                  return (
                    <div
                      key={c.id}
                      className={"mention-item cat" + (idx === mentionIndex ? " active" : "")}
                      onMouseEnter={() => setIndex(idx)}
                      onClick={() => pickCategory(c.id)}
                    >
                      <Icon name={c.icon} size={14} />
                      <span className="mi-name">{c.label}</span>
                      {!c.leaf && <Icon name="chevR" size={12} className="mi-chev" />}
                    </div>
                  );
                })}
              </>
            ) : (
              <>
                <div className="mention-head">
                  <Icon name="at" size={11} /> {MENTION_CATEGORIES.find((c) => c.id === mentionCat)?.label ?? mentionCat}
                </div>
                {mentionItems.length === 0 ? (
                  <div className="mention-empty">{mentionCat === "link" ? "Type or paste a URL after @" : "No matches"}</div>
                ) : (
                  mentionItems.map((m, i) => (
                    <div
                      key={m.kind + m.path}
                      className={"mention-item" + (i === mentionIndex ? " active" : "")}
                      onMouseEnter={() => setIndex(i)}
                      onClick={() => pickMention(m)}
                    >
                      <Icon name={KIND_ICON[m.kind] || "file"} size={14} />
                      <span className="mi-name">{m.name}</span>
                      <span className="mi-path">{m.detail ?? m.path}</span>
                    </div>
                  ))
                )}
              </>
            )}
          </div>
        )}
        <div
          ref={edRef}
          className={"editor" + (showPlaceholder && attachments.length === 0 ? " empty" : "")}
          contentEditable
          role="textbox"
          aria-label={editing ? "Edit message" : "Message OpenCursor"}
          aria-multiline="true"
          data-placeholder={isFirst ? "Ask OpenCursor anything, @ to add context" : "Add a follow-up"}
          suppressContentEditableWarning
          onDragOver={(e) => e.preventDefault()}
          onClick={(e) => {
            const t = e.target as HTMLElement;
            const el = t.closest(".mention") as HTMLElement | null;
            if (!el) return;
            e.preventDefault();
            if (t.closest(".mention-x")) {
              e.stopPropagation();
              removeMention(el);
              return;
            }
            if (el.dataset.path) {
              post({ type: "openMention", kind: (el.dataset.kind as MentionItem["kind"]) || "file", path: el.dataset.path });
            }
          }}
          onInput={(e) => {
            if ((e.nativeEvent as InputEvent).isComposing) return;
            richEditor.current?.getText();
            refreshEmpty();
            detectMention();
            emitDraft();
          }}
          onPaste={(e) => {
            const plain = plainPasteRef.current;
            plainPasteRef.current = false;
            const dt = e.clipboardData;
            if (!dt) return; // let the browser handle it natively
            const files = Array.from(dt.items || [])
              .filter((it) => it.kind === "file")
              .map((it) => it.getAsFile())
              .filter((f): f is File => !!f);
            if (files.length) {
              e.preventDefault();
              addFiles(files);
              return;
            }
            const text = dt.getData("text/plain");
            if (!text) return; // nothing we can do better than the browser
            // Parse the clipboard's Markdown without inserting arbitrary HTML.
            e.preventDefault();
            const anchor = window.getSelection()?.anchorNode;
            if (anchor && edRef.current?.contains(anchor) && (anchor instanceof Element ? anchor : anchor.parentElement)?.closest("pre")) {
              insertTextAtCaret(text, false);
              return;
            }
            // Pasting a bare URL creates a @Link mention;
            // Ctrl+Shift+V skips this and pastes the raw text.
            const t = text.trim();
            if (!plain && /^https?:\/\/\S+$/.test(t) && !t.includes("\n")) {
              insertMention({ kind: "link", path: t, name: t.replace(/^https?:\/\//, "").replace(/\/$/, "") });
              return;
            }
            // Convert code copied from a project file into a @code mention.
            // Ask the host to locate the text; insert on reply (fast round-trip).
            if (!plain && t.includes("\n") && !/^(?: {0,3}(?:#{1,6} |`{3,}|~{3,}|[-*+] |>|\d+\. ))/m.test(t) && getCodeLanguage(t).id !== "plaintext") {
              const id = ++mentionReqId;
              pastePendingRef.current = { id, text };
              post({ type: "resolvePastedCode", text: t, requestId: id });
              return;
            }
            insertTextAtCaret(text, !plain);
          }}
          onKeyDown={(e) => {
            if (e.defaultPrevented || e.nativeEvent.isComposing || e.keyCode === 229) return;
            const remove = (e.target as HTMLElement).closest(".mention-x");
            if (remove) {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                const pill = remove.closest<HTMLElement>(".mention");
                if (pill) removeMention(pill);
                return;
              }
              // Tab keeps its normal focus traversal; other button keystrokes
              // cannot select a suggestion or accidentally submit the message.
              if (!((e.ctrlKey || e.metaKey) && ["z", "y"].includes(e.key.toLowerCase()))) return;
            }
            // Mention controls forward history shortcuts to the document too.
            if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "z") {
              e.preventDefault();
              e.stopPropagation();
              if (e.shiftKey) redoEdit();
              else undoEdit();
              return;
            }
            if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "y") {
              e.preventDefault();
              e.stopPropagation();
              redoEdit();
              return;
            }
            // Ctrl+Shift+V → paste without formatting (no link pills).
            // VS Code may swallow this chord before the webview gets a paste
            // event, so read the clipboard ourselves as a fallback.
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "v") {
              e.preventDefault();
              e.stopPropagation();
              navigator.clipboard
                .readText()
                .then((text) => {
                  if (text) insertTextAtCaret(text, false);
                })
                .catch(() => {
                  // Clipboard API blocked: fall back to the paste event path.
                  plainPasteRef.current = true;
                  document.execCommand("paste");
                });
              return;
            }
            if (mentionOpen) {
              // Top-level: quick file hits (max 3) then category rows.
              const quick = mentionCat === null ? Math.min(3, mentionItems.length) : 0;
              const count = mentionCat === null ? quick + filteredCats.length : mentionItems.length;
              if (count) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setIndex((mentionIndexRef.current + 1) % count);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setIndex((mentionIndexRef.current - 1 + count) % count);
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  const i = mentionIndexRef.current;
                  if (mentionCat === null) {
                    if (i < quick) pickMention(mentionItems[i]);
                    else pickCategory(filteredCats[i - quick].id);
                  } else {
                    pickMention(mentionItems[i]);
                  }
                  return;
                }
              }
              if (e.key === "Escape" || (e.key === "Backspace" && mentionCat !== null && !mentionQuery)) {
                e.preventDefault();
                if (mentionCat !== null) {
                  // Back out to the category menu.
                  setCat(null);
                  setMentionItems([]);
                  setIndex(0);
                  if (mentionQueryRef.current) queryFiles(mentionQueryRef.current);
                } else {
                  setMentionOpen(false);
                }
                return;
              }
            }
            if (e.key === "Enter" && (submitWithCtrlEnter ? e.ctrlKey || e.metaKey : !e.shiftKey)) {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape" && editing) {
              e.preventDefault();
              onCancelEdit?.();
            }
          }}
        />
        {codeBlocks.map(block => createPortal(
          <div className="composer-code-toolbar" onKeyDownCapture={event => {
            if (event.target instanceof Element && event.target.closest("button") && (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "a") {
              event.preventDefault(); event.stopPropagation(); richEditor.current?.selectAll();
            }
          }}>
            <CodeLanguagePicker value={block.language} detectedLabel={codeLabels.get(block.id) || ""}
              onChange={language => richEditor.current?.setCodeLanguage(block.id, language)} />
            <div className="composer-code-actions">
              <button type="button" aria-label="Insert text before code block" title="Insert text before code block"
                onClick={() => richEditor.current?.insertTextBesideCode(block.id, -1)}><Icon name="arrowUp" size={14} /></button>
              <button type="button" aria-label="Insert text after code block" title="Insert text after code block"
                onClick={() => richEditor.current?.insertTextBesideCode(block.id, 1)}><Icon name="arrowDown" size={14} /></button>
              <button type="button" aria-label="Remove code block" title="Remove code block"
                onClick={() => richEditor.current?.removeCodeBlock(block.id)}><Icon name="trash" size={14} /></button>
            </div>
          </div>,
          block.element, block.id,
        ))}
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,text/*,.md,.json,.ts,.tsx,.js,.jsx,.py,.css,.html,.yaml,.yml,.toml,.csv,.log"
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files?.length) {
              addFiles(e.target.files);
            }
            e.target.value = "";
          }}
        />
        <div className="composer-bar">
          <div className="composer-actions">
          <AttachmentMenu onFiles={(imagesOnly) => {
            const input = fileRef.current;
            if (!input) return;
            input.accept = imagesOnly ? "image/*" : "image/*,text/*,.md,.json,.ts,.tsx,.js,.jsx,.py,.css,.html,.yaml,.yml,.toml,.csv,.log";
            input.click();
          }} />
          {!editing && <ApprovalPicker policy={approvalPolicy} />}
          </div>
          <div className="right">
            {!editing && (() => {
              const sel = modelList.find((m) => m.id === selectedModel);
              const total = parseContextSize(sel?.options.find((o) => o.key === "max_context")?.value) || 128_000;
              return <ContextRing used={usedTokens ?? 0} total={total} />;
            })()}
            <ModelPicker models={models} modelList={modelList} selected={selectedModel} onSelect={onSelectModel} onSaveOptions={onSaveModelOptions} onResetOptions={onResetModelOptions} />
            {editing && (
              <button className="attach-btn" title="Cancel edit (Esc)" onClick={() => onCancelEdit?.()}>
                <Icon name="close" size={15} />
              </button>
            )}
            <button
              className={"send-btn" + (showStop ? " stop" : canSend ? "" : " disabled")}
              title={showStop ? "Stop" : `${editing ? "Resend" : isRunning ? "Queue message" : "Send"} (${submitWithCtrlEnter ? "Ctrl+Enter" : "Enter"})`}
              aria-label={showStop ? "Stop" : editing ? "Resend" : isRunning ? "Queue message" : "Send"}
              disabled={!showStop && !canSend}
              onClick={showStop ? onCancel : submit}
            >
              <span className="composer-send-glyph" aria-hidden="true">
                <Icon name="send" size={20} />
              </span>
              <span className="composer-stop-glyph" aria-hidden="true">
                <span className="composer-stop-ring" />
                <Icon name="stop" className="composer-stop-square" size={16} />
              </span>
            </button>
          </div>
        </div>
      </div>
      <div className="composer-footer">
        <div className="composer-footer-options">
          <ModePicker mode={mode} onMode={onMode} />
          {mode === "project" && <TeamPicker teams={teams ?? []} selected={activeTeamIds ?? []} onChange={(ids) => onTeams?.(ids)} />}
        </div>
        {persona && persona.id !== "default" && <span className="composer-persona" title={persona.description}><Icon name="agent" size={13} />{persona.name}</span>}
      </div>
      <ImagePreview images={previewImages} activeId={previewImageId} onClose={() => setPreviewImageId(null)} />
    </div>
  );
}
