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
import "./ReelCounter.css";

const digits = Array.from({ length: 30 }, (_, index) => index % 10);

function milliseconds(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed * (value.trim().endsWith("ms") ? 1 : value.trim().endsWith("s") ? 1000 : 1)) : fallback;
}

/** Read the visible position when a new value arrives before the previous spin settles. */
function visibleCell(strip: HTMLSpanElement, column: HTMLSpanElement, fallback: number): number {
  const transform = getComputedStyle(strip).transform;
  const matrix = transform.match(/^matrix(3d)?\((.+)\)$/);
  const height = column.getBoundingClientRect().height;
  if (matrix && height > 0) {
    const values = matrix[2].split(",").map(Number);
    const translation = values[matrix[1] ? 13 : 5];
    if (Number.isFinite(translation)) return -translation / height;
  }
  return fallback;
}

function ReelDigit({ digit, place, reduced }: { digit: number; place: number; reduced: boolean }) {
  const column = React.useRef<HTMLSpanElement>(null);
  const strip = React.useRef<HTMLSpanElement>(null);
  const blur = React.useRef<SVGFEGaussianBlurElement>(null);
  const initialDigit = React.useRef(digit);
  const previous = React.useRef(digit);
  const position = React.useRef(digit);
  const filterId = `reel-${React.useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  React.useLayoutEffect(() => {
    const reel = strip.current, viewport = column.current, gaussian = blur.current;
    if (!reel || !viewport || !gaussian) return;
    let frame = 0;
    const settle = () => {
      reel.style.transition = "none";
      reel.style.transform = `translateY(calc(var(--reel-cell) * -${digit}))`;
      reel.style.filter = "none";
      gaussian.setAttribute("stdDeviation", "0 0");
      viewport.dataset.spinning = "false";
      position.current = digit;
    };
    if (reduced || previous.current === digit) {
      previous.current = digit;
      settle();
      return;
    }

    const style = getComputedStyle(viewport);
    const duration = milliseconds(style.getPropertyValue("--reel-dur"), 1400);
    const delay = place * milliseconds(style.getPropertyValue("--reel-stagger"), 90);
    const parsedBlur = Number.parseFloat(style.getPropertyValue("--reel-spin-blur"));
    const maxBlur = Number.isFinite(parsedBlur) ? Math.max(0, parsedBlur) : 3;
    const current = visibleCell(reel, viewport, position.current);
    const start = ((current % 10) + 10) % 10;
    const target = digit + (digit > start ? 10 : 20);
    previous.current = digit;
    position.current = target;
    if (duration === 0) { settle(); return; }

    reel.style.transition = "none";
    reel.style.transform = `translateY(calc(var(--reel-cell) * -${start}))`;
    reel.style.filter = `url(#${filterId})`;
    gaussian.setAttribute("stdDeviation", "0 0");
    void reel.offsetHeight;

    frame = requestAnimationFrame(now => {
      reel.style.transition = `transform var(--reel-dur) var(--reel-ease) ${delay}ms`;
      reel.style.transform = `translateY(calc(var(--reel-cell) * -${target}))`;
      viewport.dataset.spinning = "true";
      const started = now + delay;
      const animateBlur = (now: number) => {
        const elapsed = now - started;
        const progress = Math.max(0, Math.min(1, elapsed / duration));
        gaussian.setAttribute("stdDeviation", `0 ${elapsed < 0 ? 0 : (maxBlur * (1 - progress) ** 2).toFixed(3)}`);
        if (progress < 1) frame = requestAnimationFrame(animateBlur);
        else settle();
      };
      animateBlur(now);
    });
    return () => {
      cancelAnimationFrame(frame);
      gaussian.setAttribute("stdDeviation", "0 0");
      reel.style.filter = "none";
    };
  }, [digit, place, reduced, filterId]);

  return <span ref={column} className="t-reel-col" data-place={place} data-digit={digit} aria-hidden="true">
    <svg className="t-reel-filter" aria-hidden="true" focusable="false">
      <defs><filter id={filterId} x="0" y="-30%" width="100%" height="160%" colorInterpolationFilters="sRGB">
        <feGaussianBlur ref={blur} stdDeviation="0 0" />
      </filter></defs>
    </svg>
    <span ref={strip} className="t-reel-strip" style={{ transform: `translateY(calc(var(--reel-cell) * -${initialDigit.current}))` }}>
      {digits.map((value, index) => <span key={index} className="t-reel-digit">{value}</span>)}
    </span>
  </span>;
}

/** Swap only the outgoing and incoming digit, with no intermediate rotations. */
function StepDigit({ digit, place, reduced }: { digit: number; place: number; reduced: boolean }) {
  const [state, setState] = React.useState({ digit, previous: null as number | null });
  if (state.digit !== digit) setState({ digit, previous: state.digit });
  const moving = state.previous !== null && !reduced;
  return <span className="t-reel-step" data-place={place} data-digit={digit} aria-hidden="true">
    <span key={digit} className="t-reel-step-frame">
      {moving && <span className="t-reel-step-out">{state.previous}</span>}
      <span className={moving ? "t-reel-step-in" : undefined}>{digit}</span>
    </span>
  </span>;
}

/** Animate only the places whose numeric value changes. */
export function ReelCounter({ value, className = "", variant = "spin" }: { value: number; className?: string; variant?: "spin" | "step" }) {
  const reduced = useReducedMotion();
  const text = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number.isFinite(value) ? value : 0))).toString();
  return <span className={`t-reel ${className}`.trim()} role="img" aria-label={text}>
    {Array.from(text, (digit, index) => {
      const place = text.length - index - 1;
      return variant === "step"
        ? <StepDigit key={place} digit={Number(digit)} place={place} reduced={reduced} />
        : <ReelDigit key={place} digit={Number(digit)} place={place} reduced={reduced} />;
    })}
  </span>;
}
