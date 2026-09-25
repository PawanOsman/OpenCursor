/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as React from "react";
import { usePresence } from "./usePresence";
import { useReducedMotion } from "./motionPreference";
import "./component-transitions.css";

/** Keep both ends of a disclosure mounted while its intrinsic height transitions. */
export function AnimatedDisclosure({ open, children }: { open: boolean; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const { present } = usePresence(open, 220);
  const [shown, setShown] = React.useState(false);
  React.useLayoutEffect(() => {
    if (!open) { setShown(false); return; }
    if (reduced) { setShown(true); return; }
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setShown(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [open, reduced]);
  return present ? <div className="animated-disclosure" data-open={open && shown}
    aria-hidden={!open || undefined} inert={!open || undefined}>{children}</div> : null;
}
