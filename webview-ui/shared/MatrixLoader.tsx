/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as React from "react";
import "./activity-effects.css";

export interface MatrixLoaderProps {
  variant?: "scan" | "twinkle" | "orbit" | "pulse";
  rounded?: boolean;
  className?: string;
}

// Staggered delay tables for each matrix loader pattern.
const TWINKLE_ORDER = [7, 2, 11, 5, 14, 9, 0, 12, 3, 15, 6, 10, 13, 1, 8, 4];
const ORBIT_RING = [1, 2, 7, 11, 14, 13, 8, 4];
const INNER_DOTS = new Set([5, 6, 9, 10]);
const CORNER_DOTS = new Set([0, 3, 12, 15]);
const CYCLE_MS = 1200;

export function MatrixLoader({ variant = "scan", rounded = false, className = "" }: MatrixLoaderProps) {
  return <span className={`t-matrix ${className}`.trim()} data-variant={variant} aria-hidden="true">
    {Array.from({ length: 16 }, (_, index) => {
      const ringPosition = ORBIT_RING.indexOf(index);
      const delay = variant === "scan" ? (index % 4) * CYCLE_MS / 10
        : variant === "twinkle" ? TWINKLE_ORDER.indexOf(index) * CYCLE_MS / 16
        : variant === "orbit" ? Math.max(0, ringPosition) * CYCLE_MS / 8
        : INNER_DOTS.has(index) ? 0 : CYCLE_MS * .16;
      const gap = rounded && CORNER_DOTS.has(index);
      const steady = variant === "orbit" && ringPosition < 0;
      return <i key={index} className={[gap && "is-gap", steady && "is-steady"].filter(Boolean).join(" ") || undefined}
        style={{ "--d": delay } as React.CSSProperties} />;
    })}
  </span>;
}
