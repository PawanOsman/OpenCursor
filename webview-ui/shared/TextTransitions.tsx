/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as React from "react";
import { useReducedMotion } from "./motionPreference";
import "./component-transitions.css";

/** Drive the supplied text-swap recipe when a label changes. */
export function TextSwap({ text, className = "" }: { text: string; className?: string }) {
  const reduced = useReducedMotion();
  const [displayed, setDisplayed] = React.useState(text);
  const current = React.useRef(text);
  const element = React.useRef<HTMLSpanElement>(null);
  const [phase, setPhase] = React.useState<"" | "is-exit" | "is-enter-start">("");
  React.useLayoutEffect(() => {
    if (reduced) { current.current = text; setDisplayed(text); setPhase(""); return; }
    if (text === current.current) { setPhase(""); return; }
    setPhase("is-exit");
    let firstFrame = 0, secondFrame = 0;
    const timer = window.setTimeout(() => {
      current.current = text;
      setDisplayed(text);
      setPhase("is-enter-start");
      firstFrame = requestAnimationFrame(() => {
        void element.current?.offsetWidth;
        secondFrame = requestAnimationFrame(() => setPhase(""));
      });
    }, 150);
    return () => { window.clearTimeout(timer); cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); };
  }, [text, reduced]);
  return <span ref={element} className={`t-text-swap ${phase} ${className}`.trim()}>{displayed}</span>;
}

/** Children carry t-stagger-line classes so their own typography is preserved. */
export function StaggerReveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  const element = React.useRef<HTMLDivElement>(null);
  const [shown, setShown] = React.useState(reduced);
  React.useLayoutEffect(() => {
    if (reduced) { setShown(true); return; }
    void element.current?.offsetWidth;
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, [reduced]);
  return <div ref={element} className={`t-stagger${shown ? " is-shown" : ""} ${className}`.trim()}>{children}</div>;
}
