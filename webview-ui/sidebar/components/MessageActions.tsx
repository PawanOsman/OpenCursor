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
import "./message-actions.css";

export interface MessageActionsProps {
  variant: "user" | "assistant";
  text: string;
  onEdit?: () => void;
  onRetry?: () => void;
  onRevert?: () => void;
  disabled?: boolean;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* A webview may deny clipboard access; try its document command. */ }

  const previousFocus = document.activeElement;
  const selection = window.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const field = document.createElement("textarea");
  field.value = text;
  field.tabIndex = -1;
  field.setAttribute("aria-hidden", "true");
  Object.assign(field.style, { position: "fixed", top: "0", left: "0", opacity: "0", pointerEvents: "none" });
  try {
    document.body.appendChild(field);
    field.focus({ preventScroll: true });
    field.select();
    return document.execCommand?.("copy") === true;
  } catch {
    return false;
  } finally {
    field.remove();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
  }
}

export function MessageActions({ variant, text, onEdit, onRetry, onRevert, disabled = false }: MessageActionsProps) {
  const [copyState, setCopyState] = React.useState<"idle" | "pending" | "copied" | "failed">("idle");
  const mounted = React.useRef(true);
  const copying = React.useRef(false);
  const resetTimer = React.useRef<number | undefined>(undefined);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearTimeout(resetTimer.current);
    };
  }, []);

  const copy = async () => {
    if (!text || copying.current) return;
    copying.current = true;
    window.clearTimeout(resetTimer.current);
    setCopyState("pending");
    const copied = await copyText(text);
    copying.current = false;
    if (!mounted.current) return;
    setCopyState(copied ? "copied" : "failed");
    if (copied) resetTimer.current = window.setTimeout(() => setCopyState("idle"), 1800);
  };

  const copyTitle = copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed. Try again" : "Copy message";
  const retryLabel = variant === "user" ? "Resend message" : "Retry response";

  return <div className={`message-actions message-actions-${variant}`} role="group" aria-label={variant === "user" ? "User message actions" : "Assistant message actions"}>
    <button type="button" className="message-action" aria-label="Copy message" title={copyTitle} aria-busy={copyState === "pending"} aria-disabled={copyState === "pending" || undefined} disabled={!text} onClick={() => { void copy(); }}>
      <Icon name={copyState === "copied" ? "check" : "copy"} size={16} />
    </button>
    {onEdit && <button type="button" className="message-action" aria-label="Edit message" title="Edit message" disabled={disabled} onClick={onEdit}><Icon name="edit" size={16} /></button>}
    {onRetry && <button type="button" className="message-action" aria-label={retryLabel} title={retryLabel} disabled={disabled} onClick={onRetry}><Icon name="reset" size={16} /></button>}
    {onRevert && <button type="button" className="message-action" aria-label="Revert to this message" title="Revert to this message" disabled={disabled} onClick={onRevert}><Icon name="history" size={16} /></button>}
    <span className="message-actions-status" role="status" aria-live="polite" aria-atomic="true">{copyState === "copied" ? "Message copied" : copyState === "failed" ? "Could not copy the message. Try again." : ""}</span>
  </div>;
}
