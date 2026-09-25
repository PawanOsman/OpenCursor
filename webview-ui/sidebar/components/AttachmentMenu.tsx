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
import { Icon } from "../../shared/icons";
import { useReducedMotion } from "../../shared/motionPreference";
import { usePresence } from "../../shared/usePresence";

export function AttachmentMenu({ onFiles }: { onFiles: (imagesOnly: boolean) => void }) {
  const id = React.useId();
  const trigger = React.useRef<HTMLButtonElement>(null);
  const surface = React.useRef<HTMLDivElement>(null);
  const items = React.useRef<(HTMLButtonElement | null)[]>([]);
  const [open, setOpen] = React.useState(false);
  const [shown, setShown] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const initialFocus = React.useRef(0);
  const reduced = useReducedMotion();
  const { present, exiting } = usePresence(open, 250);
  const [position, setPosition] = React.useState<React.CSSProperties>({ left: 8, bottom: 8, visibility: "hidden" });

  const close = (restoreFocus = false) => {
    setOpen(false);
    setShown(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  };
  const show = (index = 0) => {
    initialFocus.current = index;
    setActive(index);
    setOpen(true);
  };
  const focusItem = (index: number) => {
    setActive(index);
    items.current[index]?.focus({ preventScroll: true });
  };

  React.useLayoutEffect(() => {
    if (!present) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor) return;
      const margin = 8;
      const width = Math.min(208, Math.max(0, window.innerWidth - margin * 2));
      const height = Math.min(104, Math.max(0, window.innerHeight - margin * 2));
      const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin));
      const edge = Math.max(height + margin, Math.min(anchor.bottom, window.innerHeight - margin));
      setPosition({
        left, bottom: window.innerHeight - edge, visibility: "visible",
        maxWidth: "calc(100vw - 16px)", maxHeight: "calc(100vh - 16px)",
        "--morph-open-width": `${width}px`, "--morph-open-height": `${height}px`,
      } as React.CSSProperties);
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(place);
    if (trigger.current) observer?.observe(trigger.current);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      observer?.disconnect();
    };
  }, [present]);

  React.useLayoutEffect(() => {
    if (!open) { setShown(false); return; }
    if (reduced) { setShown(true); return; }
    // Paint the compact surface before starting its width, height, and radius transition.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setShown(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [open, reduced]);

  React.useLayoutEffect(() => {
    if (open && shown) items.current[initialFocus.current]?.focus({ preventScroll: true });
  }, [open, shown]);

  React.useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      const target = event.target as Node | null;
      if (!target || trigger.current?.contains(target) || surface.current?.contains(target)) return;
      close();
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
      // Move the browser's normal tab sequence back to the trigger's position in the composer.
      close(true);
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const index = event.key === "Home" ? 0 : event.key === "End" ? 1 : (active + (event.key === "ArrowDown" ? 1 : -1) + 2) % 2;
      focusItem(index);
    }
  };
  const choose = (imagesOnly: boolean) => {
    if (!open || !shown) return;
    try { onFiles(imagesOnly); } finally { close(true); }
  };

  return <>
    <button ref={trigger} type="button" className="attach-btn" aria-label="Attach images or files" title="Attach images or files"
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { if (open) close(true); else show(); }}
      onKeyDown={event => {
        if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          event.preventDefault(); event.stopPropagation(); show(event.key === "ArrowUp" ? 1 : 0);
        } else onKeyDown(event);
      }}>
      <Icon name="plus" size={18} />
    </button>
    {present && createPortal(<div ref={surface} className="t-morph attachment-menu-surface"
      data-open={open && shown ? "true" : "false"} data-state={exiting ? "closing" : "open"}
      inert={exiting || undefined} aria-hidden={exiting || undefined}
      style={{ ...position, pointerEvents: exiting ? "none" : undefined }} onKeyDown={onKeyDown}>
      <span className="t-morph-plus" aria-hidden="true"><Icon name="plus" size={18} /></span>
      <div id={id} className="t-morph-menu" role="menu" aria-label="Attachment options">
        <button ref={element => { items.current[0] = element; }} className="attachment-menu-item" type="button" role="menuitem"
          tabIndex={open && shown && active === 0 ? 0 : -1} onFocus={() => setActive(0)} onClick={() => choose(false)}>
          <Icon name="file" size={16} /><span>Attach files</span>
        </button>
        <button ref={element => { items.current[1] = element; }} className="attachment-menu-item" type="button" role="menuitem"
          tabIndex={open && shown && active === 1 ? 0 : -1} onFocus={() => setActive(1)} onClick={() => choose(true)}>
          <Icon name="image" size={16} /><span>Attach images</span>
        </button>
      </div>
    </div>, document.body)}
  </>;
}
