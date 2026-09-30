/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as React from "react";
import { AnimatedDisclosure } from "../../shared/AnimatedDisclosure";
import { ReelCounter } from "../../shared/ReelCounter";
import { Icon } from "../../shared/icons";

export interface WorkingSectionProps {
  running: boolean;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  activity: React.ReactNode;
  conclusion?: React.ReactNode;
  hasActivity: boolean;
  forceOpen?: boolean;
  status?: React.ReactNode;
}

function validTime(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function durationParts(milliseconds: number): { value: number; unit: string }[] {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return [
    ...(hours ? [{ value: hours, unit: "h" }] : []),
    ...(hours || minutes ? [{ value: minutes, unit: "m" }] : []),
    { value: remaining, unit: "s" },
  ];
}

/** Keep the live clock local to the activity header, without rerendering the transcript. */
export function WorkingSection({
  running, startedAt, endedAt, durationMs, activity, conclusion,
  hasActivity, forceOpen = false, status,
}: WorkingSectionProps) {
  const bodyId = React.useId();
  const [clock, setClock] = React.useState(() => {
    const now = Date.now();
    return { running, now, startedAt: running ? now : undefined, endedAt: undefined as number | undefined };
  });
  const [expansion, setExpansion] = React.useState({ running, open: running });

  // A resumed run gets its own live clock and opens its activity again. Historical
  // messages without recorded timing never inherit the time the view was mounted.
  if (clock.running !== running) {
    const now = Date.now();
    setClock({ running, now, startedAt: running ? now : clock.startedAt, endedAt: running ? undefined : now });
  }
  if (expansion.running !== running) setExpansion({ running, open: running });

  React.useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => setClock(current => ({ ...current, now: Date.now() })), 1000);
    return () => window.clearInterval(interval);
  }, [running]);

  const start = validTime(startedAt) ? startedAt : clock.startedAt;
  const end = running ? clock.now : validTime(endedAt) ? endedAt : clock.endedAt;
  const elapsed = !running && validTime(durationMs) ? durationMs
    : validTime(start) && validTime(end) ? Math.max(0, end - start) : undefined;
  const parts = elapsed !== undefined && (!running || elapsed >= 1000) ? durationParts(elapsed) : [];
  const prefix = `${running ? "Working" : "Worked"}${parts.length ? " for" : ""}`;
  const label = prefix + (parts.length ? ` ${parts.map(part => `${part.value}${part.unit}`).join(" ")}` : "");
  const open = forceOpen || (expansion.running === running ? expansion.open : running);

  // Retain the visible activity throughout the closing transition. The parent may
  // move the final response out of activity as soon as the run settles.
  const previousContent = React.useRef({ activity, status });
  React.useLayoutEffect(() => {
    if (open) previousContent.current = { activity, status };
  }, [activity, status, open]);
  const content = open ? { activity, status } : previousContent.current;
  const heading = <>
    <span className="working-title" role="timer" aria-live="off" aria-label={label}>
      <span className="working-prefix" aria-hidden="true">{prefix}</span>
      {parts.length > 0 && <span className="working-duration" aria-hidden="true">
        {parts.map(part => <span key={part.unit} className="working-time-part" data-unit={part.unit}>
          <ReelCounter value={part.value} variant="step" className="working-time-value" />
          <span className="working-time-unit">{part.unit}</span>
        </span>)}
      </span>}
    </span>
    {hasActivity && <Icon name="chevR" size={12} className="working-chevron" />}
  </>;

  return <section className="working-section" data-running={running} data-open={open}>
    {hasActivity
      ? <button type="button" className="working-head" aria-label={label}
          aria-expanded={open} aria-controls={bodyId} aria-disabled={forceOpen || undefined}
          onClick={() => { if (!forceOpen) setExpansion({ running, open: !open }); }}>
          {heading}
        </button>
      : <div className="working-head">{heading}</div>}
    <AnimatedDisclosure open={open}>
      <div className="working-body" id={bodyId}>
        {content.activity}
        {content.status}
      </div>
    </AnimatedDisclosure>
    {conclusion != null && <div className="working-conclusion">{conclusion}</div>}
  </section>;
}
