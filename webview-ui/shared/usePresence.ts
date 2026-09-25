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

/** Retain a closing surface for its exit animation, without delaying its opening. */
export function usePresence(open: boolean, exitMs = 120): { present: boolean; exiting: boolean } {
  const reduced = useReducedMotion();
  const [retained, setRetained] = React.useState(open);

  React.useLayoutEffect(() => {
    if (open) { setRetained(true); return; }
    if (reduced || exitMs <= 0) { setRetained(false); return; }
    const timer = window.setTimeout(() => setRetained(false), exitMs);
    return () => window.clearTimeout(timer);
  }, [open, reduced, exitMs]);

  const present = open || retained && !reduced && exitMs > 0;
  return { present, exiting: present && !open };
}
