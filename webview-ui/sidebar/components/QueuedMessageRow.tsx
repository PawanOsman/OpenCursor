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
import type { QueuedMessage } from "../../../src/shared/chatSession";
import { Icon, type IconName } from "../../shared/icons";
import { usePresence } from "../../shared/usePresence";
import { TextSwap } from "../../shared/TextTransitions";
import { renderMentionTokens } from "../types";

export interface QueuedMessageRowProps {
  item: QueuedMessage;
  running: boolean;
  steering?: boolean;
  canMoveUp: boolean;
  onSteer: () => void;
  onRun: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
}

export function QueuedMessageRow({ item, running, steering = false, canMoveUp, onSteer, onRun, onEdit, onRemove, onMoveUp }: QueuedMessageRowProps) {
  const menuId = React.useId();
  const trigger = React.useRef<HTMLButtonElement>(null);
  const menu = React.useRef<HTMLDivElement>(null);
  const buttons = React.useRef<(HTMLButtonElement | null)[]>([]);
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => { if (steering) setOpen(false); }, [steering]);
  const [active, setActive] = React.useState(0);
  const [side, setSide] = React.useState<"top" | "bottom">("top");
  const [position, setPosition] = React.useState<React.CSSProperties>({ visibility: "hidden" });
  const { present, exiting } = usePresence(open, 120);
  const queued = item.status === "queued";
  const canSteer = queued && running;
  const text = renderMentionTokens(item.text) || (item.attachments?.length
    ? `${item.attachments.length} attachment${item.attachments.length === 1 ? "" : "s"}` : "Empty message");
  const runLabel = queued ? "Send queued request now" : "Resume interrupted request";
  const actions: { label: string; ariaLabel?: string; title?: string; icon: IconName; run: () => void }[] = [
    ...(running && queued ? [{ label: "Send now", ariaLabel: runLabel, title: "Send now (stops current run)", icon: "play" as const, run: onRun }] : []),
    { label: "Edit message", icon: "edit", run: onEdit },
    ...(canMoveUp ? [{ label: "Move earlier", icon: "arrowUp" as const, run: onMoveUp }] : []),
  ];
  const actionCount = actions.length;

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  };
  const show = (index = 0) => { setActive(index); setOpen(true); };
  const focusItem = (index: number) => {
    setActive(index);
    buttons.current[index]?.focus({ preventScroll: true });
  };
  const choose = (index: number) => {
    if (!open || steering) return;
    close(true);
    actions[index]?.run();
  };

  React.useLayoutEffect(() => {
    if (!open || position.visibility !== "visible") return;
    const next = Math.min(active, actionCount - 1);
    setActive(next);
    buttons.current[next]?.focus({ preventScroll: true });
  }, [open, active, actionCount, position.visibility]);

  React.useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const anchor = trigger.current;
    const popup = menu.current;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const padding = 8, gap = 4;
      const width = Math.min(192, Math.max(0, window.innerWidth - padding * 2));
      popup.style.width = `${width}px`;
      const desiredHeight = popup.scrollHeight || actionCount * 32 + 8;
      const above = Math.max(0, rect.top - gap - padding);
      const below = Math.max(0, window.innerHeight - rect.bottom - gap - padding);
      const upward = above >= desiredHeight || above > below;
      const maxHeight = Math.min(Math.max(0, window.innerHeight - padding * 2), upward ? above : below);
      const height = Math.min(desiredHeight, maxHeight);
      setSide(upward ? "top" : "bottom");
      setPosition({
        left: Math.max(padding, Math.min(rect.right - width, window.innerWidth - width - padding)),
        top: Math.max(padding, Math.min(upward ? rect.top - gap - height : rect.bottom + gap, window.innerHeight - height - padding)),
        width, maxHeight, visibility: "visible",
      });
    };
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !popup.contains(event.target)) place(); };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", scroll, true);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(place);
    observer?.observe(anchor);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [open, actionCount]);

  React.useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      const target = event.target as Node | null;
      if (target && !trigger.current?.contains(target) && !menu.current?.contains(target)) close();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
    };
  }, [open]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); close(true);
    } else if (event.key === "Tab") {
      close(true);
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      focusItem(event.key === "Home" ? 0 : event.key === "End" ? actionCount - 1
        : (active + (event.key === "ArrowDown" ? 1 : -1) + actionCount) % actionCount);
    }
  };

  return <div className="queue-item" data-status={item.status} aria-busy={steering || undefined}>
    <Icon name={queued ? "queued" : "clock"} size={12} />
    <span className="queue-text" title={item.error || text}>
      {!queued && <strong>{item.status === "interrupted" ? "Interrupted" : item.status === "failed" ? "Needs attention" : "Sending"}: </strong>}<TextSwap text={text} />
    </span>
    <span className="queue-actions">
      {canSteer || steering ? <button type="button" className={`q-btn q-btn-steer${steering ? " queue-steering" : ""}`}
        title={steering ? "Waiting for the agent to apply this message" : item.attachments?.length ? "Use Send now for a message with attachments" : "Steer the current run without stopping it"}
        aria-label={steering ? "Steering message" : "Steer current run with queued message"} disabled={steering || !!item.attachments?.length || !item.text.trim()} onClick={onSteer}>
        {steering ? <span className="spinner" aria-hidden="true" /> : <Icon name="steer" size={12} />}<TextSwap text={steering ? "Steering…" : "Steer"} />
      </button> : <button type="button" className="q-btn q-btn-primary"
        title={queued ? "Send queued request now" : "Resume and reconcile completed work"} aria-label={runLabel} onClick={onRun}>
        <Icon name="play" size={12} /><span>{queued ? "Send" : "Resume"}</span>
      </button>}
      <button type="button" className="q-btn" title="Remove queued message" aria-label="Remove queued message" disabled={steering} onClick={onRemove}>
        <Icon name="trash" size={12} />
      </button>
      <button ref={trigger} type="button" className="q-btn" title="More queued message actions" aria-label="More queued message actions"
        disabled={steering}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => { if (open) close(true); else show(); }}
        onKeyDown={event => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault(); event.stopPropagation(); show(event.key === "ArrowUp" ? actionCount - 1 : 0);
          } else onKeyDown(event);
        }}>
        <Icon name="more" size={12} />
      </button>
    </span>
    {present && createPortal(<div ref={menu} id={menuId} role="menu" aria-label="Queued message actions" className="queue-menu"
      data-state={exiting ? "closing" : "open"} data-side={side} inert={exiting || undefined} aria-hidden={exiting || undefined}
      style={{ ...position, pointerEvents: exiting ? "none" : undefined }} onKeyDown={onKeyDown}>
      {actions.map((action, index) => <button key={action.label} ref={element => { buttons.current[index] = element; }}
        className="queue-menu-item" type="button" role="menuitem" aria-label={action.ariaLabel} title={action.title}
        tabIndex={open && active === index ? 0 : -1} onFocus={() => setActive(index)} onClick={() => choose(index)}>
        <Icon name={action.icon} size={14} /><span>{action.label}</span>
      </button>)}
    </div>, document.body)}
  </div>;
}
