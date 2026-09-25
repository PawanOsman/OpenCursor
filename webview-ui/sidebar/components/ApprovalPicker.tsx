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
import { Icon, type IconName } from "../../shared/icons";
import { vscode } from "../../shared/vscode";
import { usePresence } from "../../shared/usePresence";
import type { ApprovalPolicy } from "../types";

type Preset = "ask" | "review" | "allow" | "custom";
const ACTIONS = ["shell", "edits", "delete", "mcp", "web", "outside"] as const;
const OPTIONS: { id: Preset; label: string; description: string; icon: IconName }[] = [
  { id: "ask", label: "Ask for approval", description: "Ask before edits, commands and external access", icon: "handRaised" },
  { id: "review", label: "Approve for me", description: "Ask for actions detected as potentially unsafe", icon: "shieldCheck" },
  { id: "allow", label: "Full access", description: "Run actions without approval prompts", icon: "shieldWarning" },
  { id: "custom", label: "Custom", description: "Use per-action permissions and saved rules", icon: "settings" },
];

/** Never label a patterned or mixed policy as unrestricted. */
export function approvalPreset(policy?: ApprovalPolicy): Preset | undefined {
  if (!policy) return undefined;
  const rules = ACTIONS.map((action) => policy[action]);
  if (rules.some((rule) => !rule || rule.allowlist.length || rule.denylist.length)) return "custom";
  const mode = rules[0].mode;
  return (mode === "ask" || mode === "review" || mode === "allow") && rules.every((rule) => rule.mode === mode) ? mode : "custom";
}

export function ApprovalPicker({ policy, disabled = false }: { policy?: ApprovalPolicy; disabled?: boolean }) {
  const preset = approvalPreset(policy);
  const selected = OPTIONS.find((option) => option.id === preset);
  const [open, setOpen] = React.useState(false);
  const { present, exiting } = usePresence(open);
  const [position, setPosition] = React.useState<React.CSSProperties>({ left: 8, top: 8 });
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const itemRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = React.useId();
  const unavailable = disabled || !policy;

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  };
  const openSettings = () => {
    if (!open) return;
    vscode.postMessage({ type: "openSettings", section: "behavior" });
    close(true);
  };
  const choose = (value: Preset) => {
    if (unavailable || !open) return;
    if (value === "custom") { openSettings(); return; }
    vscode.postMessage({ type: "setApprovalPreset", preset: value });
    close(true);
  };

  React.useLayoutEffect(() => {
    if (!open) return;
    const reposition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(386, window.innerWidth - 16);
      const above = rect.top >= Math.min(240, window.innerHeight / 2);
      const space = above ? rect.top - 16 : window.innerHeight - rect.bottom - 16;
      setPosition({ position: "fixed", width, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        ...(above ? { bottom: window.innerHeight - rect.top + 8, top: "auto" } : { top: rect.bottom + 8, bottom: "auto" }), maxHeight: Math.max(96, space), overflowY: "auto" });
    };
    reposition();
    itemRefs.current[Math.max(0, OPTIONS.findIndex((option) => option.id === preset))]?.focus({ preventScroll: true });
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => { window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true); };
  }, [open]);

  React.useEffect(() => {
    if (unavailable) setOpen(false);
  }, [unavailable]);

  React.useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onFocus = (event: FocusEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("focusin", onFocus);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("focusin", onFocus); };
  }, [open]);

  function onMenuKey(event: React.KeyboardEvent) {
    if (!open) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
    const index = itemRefs.current.findIndex((item) => item === document.activeElement);
    let next: number | undefined;
    if (event.key === "ArrowDown") next = (index + 1) % OPTIONS.length;
    if (event.key === "ArrowUp") next = (index - 1 + OPTIONS.length) % OPTIONS.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = OPTIONS.length - 1;
    if (next !== undefined) { event.preventDefault(); itemRefs.current[next]?.focus(); }
  }

  return <>
    <button ref={triggerRef} type="button" className={`composer-approval-trigger${preset === "allow" ? " is-full-access" : ""}`}
      aria-label={`Change approvals: ${selected?.label ?? "Loading permissions"}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      title={selected?.description ?? "Loading permissions"} disabled={unavailable} onClick={() => setOpen(!open)}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); if (!unavailable) setOpen(true); }
        if (event.key === "Escape" && open) { event.preventDefault(); close(true); }
      }}>
      <Icon name={selected?.icon ?? "settings"} size={14} /><span>{selected?.label ?? "Permissions"}</span>
    </button>
    {present && createPortal(<div ref={menuRef} id={menuId} className="approval-menu"
      data-state={exiting ? "closing" : "open"} data-side={position.bottom !== undefined && position.bottom !== "auto" ? "top" : "bottom"}
      inert={exiting || undefined} aria-hidden={exiting || undefined}
      style={{ ...position, pointerEvents: exiting ? "none" : undefined }} onKeyDown={onMenuKey}>
      <div className="approval-menu-heading"><span>How should OpenCursor actions be approved?</span><button type="button" className="approval-menu-learn" onClick={openSettings}>Learn more</button></div>
      <div role="menu" aria-label="Approval permissions">
        {OPTIONS.map((option, index) => <button key={option.id} ref={(node) => { itemRefs.current[index] = node; }} type="button"
          role="menuitemradio" aria-checked={preset === option.id} tabIndex={preset === option.id ? 0 : -1}
          className={`approval-menu-option${preset === option.id ? " is-selected" : ""}${option.id === "allow" ? " is-full-access" : ""}`}
          onClick={() => choose(option.id)}>
          <Icon name={option.icon} size={18} />
          <span className="approval-menu-copy"><span className="approval-menu-label">{option.label}</span><span className="approval-menu-description">{option.description}</span></span>
          {preset === option.id && <Icon name="check" size={16} className="approval-menu-check" />}
        </button>)}
      </div>
    </div>, document.body)}
  </>;
}
