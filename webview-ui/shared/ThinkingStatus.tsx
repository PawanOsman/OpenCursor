/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as React from "react";
import { MatrixLoader } from "./MatrixLoader";
import { useReducedMotion } from "./motionPreference";
import "./activity-effects.css";

export interface ThinkingStatusProps {
  text: string;
  className?: string;
}

interface StatusLine { id: number; text: string; }
interface StatusSwap {
  incoming: StatusLine;
  outgoing?: StatusLine;
  entering: boolean;
}

function duration(style: CSSStyleDeclaration, property: string, fallback: number): number {
  const value = style.getPropertyValue(property).trim();
  const amount = Number.parseFloat(value);
  return Number.isFinite(amount) ? Math.max(0, amount * (value.endsWith("ms") ? 1 : value.endsWith("s") ? 1000 : 1)) : fallback;
}

/** Animated thinking states driven by real activity updates. */
export function ThinkingStatus({ text, className = "" }: ThinkingStatusProps) {
  const reducedMotion = useReducedMotion();
  const thinkRef = React.useRef<HTMLSpanElement>(null);
  const incomingRef = React.useRef<HTMLSpanElement>(null);
  const measureRef = React.useRef<HTMLSpanElement>(null);
  const sequence = React.useRef(0);
  const desiredText = React.useRef(text);
  const [sizer, setSizer] = React.useState({ text, width: 0 });
  const [swap, setSwap] = React.useState<StatusSwap>({ incoming: { id: 0, text }, entering: false });

  // Remember the widest measured label so an update never shrinks the status box.
  React.useLayoutEffect(() => {
    const width = measureRef.current?.getBoundingClientRect().width ?? 0;
    setSizer(previous => width > previous.width ? { text, width } : previous);
  }, [text]);

  React.useLayoutEffect(() => {
    if (reducedMotion) {
      desiredText.current = text;
      setSwap(previous => previous.incoming.text === text && !previous.entering && !previous.outgoing
        ? previous : { incoming: { id: ++sequence.current, text }, entering: false });
      return;
    }
    if (desiredText.current === text) return;
    desiredText.current = text;
    const incoming = { id: ++sequence.current, text };
    setSwap(previous => ({
      incoming,
      // Rapid updates replace the pending copy while the last visible line exits.
      outgoing: previous.entering ? previous.outgoing ?? previous.incoming : previous.incoming,
      entering: true,
    }));
    const style = getComputedStyle(thinkRef.current!);
    const gap = duration(style, "--think-gap", 50);
    const swapTime = duration(style, "--think-swap", 150);
    const enterTimer = window.setTimeout(() => {
      // Commit the below-baseline pose before releasing the incoming transition.
      incomingRef.current?.getBoundingClientRect();
      setSwap(previous => previous.incoming.id === incoming.id ? { ...previous, entering: false } : previous);
    }, gap);
    const cleanupTimer = window.setTimeout(() => {
      setSwap(previous => previous.incoming.id === incoming.id ? { incoming, entering: false } : previous);
    }, gap + swapTime);
    return () => {
      window.clearTimeout(enterTimer);
      window.clearTimeout(cleanupTimer);
    };
  }, [text, reducedMotion]);

  return <span className={`activity-status ${className}`.trim()}>
    <MatrixLoader />
    <span className="t-think" ref={thinkRef} role="status" aria-live="polite" aria-atomic="true" aria-label={text}>
      <span className="t-think-announcement">{text}</span>
      <span className="t-think-sizer" aria-hidden="true" style={{ width: sizer.width || undefined }}>{sizer.text}</span>
      <span className="t-think-measure-root" aria-hidden="true"><span className="t-think-measure" ref={measureRef}>{text}</span></span>
      {swap.outgoing && <span key={swap.outgoing.id} className="t-think-text is-exit" data-text={swap.outgoing.text} aria-hidden="true">{swap.outgoing.text}</span>}
      <span key={swap.incoming.id} ref={incomingRef} className={`t-think-text${swap.entering ? " is-enter-start" : ""}`} data-text={swap.incoming.text} aria-hidden="true">{swap.incoming.text}</span>
    </span>
  </span>;
}
