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

/** Shared keyboard behavior for settings dialogs and their nested menus. */
export function SettingsDialog({ title, onClose, children, className = "" }: {
  title: string; onClose: () => void; children: React.ReactNode; className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const close = React.useRef(onClose);
  close.current = onClose;
  const titleId = React.useId();
  React.useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current!;
    const isTopmost = () => {
      const layers = document.querySelectorAll('[data-modal-layer]');
      return layers[layers.length - 1] === dialog.parentElement;
    };
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), a[href], [tabindex="0"]:not(:disabled)')]
      .filter(element => !element.hidden && !element.closest('[hidden]'));
    const initial = () => dialog.querySelector<HTMLElement>('[data-dialog-autofocus]') ?? focusable()[0] ?? dialog;
    initial().focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (!isTopmost()) return;
      // Let an open field menu consume Escape before closing its parent dialog.
      if (event.key === "Escape" && event.target instanceof Element && event.target.closest('[role="combobox"][aria-expanded="true"]')) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0] ?? dialog;
      const last = items[items.length - 1] ?? dialog;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault(); last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
        event.preventDefault(); first.focus({ preventScroll: true });
      }
    };
    const focusin = (event: FocusEvent) => { if (isTopmost() && !dialog.contains(event.target as Node)) initial().focus({ preventScroll: true }); };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("focusin", focusin);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("focusin", focusin);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return <div className="modal-overlay" data-modal-layer onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={`modal ${className}`}>
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-btn close" onClick={onClose} aria-label="Close dialog" title="Close"><Icon name="close" size={16} /></button>
      </div>
      {children}
    </div>
  </div>;
}
