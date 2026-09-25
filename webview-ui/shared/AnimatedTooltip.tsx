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
import { usePresence } from "./usePresence";
import { useReducedMotion } from "./motionPreference";
import "./component-transitions.css";

export function AnimatedTooltip({ open, id, elementRef, style, children }: {
  open: boolean; id: string; elementRef: React.RefObject<HTMLDivElement | null>;
  style: React.CSSProperties; children: React.ReactNode;
}) {
  const { present } = usePresence(open, 50);
  const reduced = useReducedMotion();
  const [shown, setShown] = React.useState(false);
  React.useLayoutEffect(() => {
    if (!open) { setShown(false); return; }
    if (reduced) { setShown(true); return; }
    void elementRef.current?.offsetWidth;
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, [open, reduced, elementRef]);
  return present ? createPortal(<div ref={elementRef} id={id} role="tooltip" className="context-tooltip t-tt"
    data-show={open && shown ? "true" : "false"} aria-hidden={!open || undefined} style={style}>
    <span className="t-tt-text">{children}</span>
  </div>, document.body) : null;
}
