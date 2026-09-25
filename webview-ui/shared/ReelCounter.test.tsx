/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReelCounter } from "./ReelCounter";
import { setMotionPreference } from "./motionPreference";

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (frame: number) => window.clearTimeout(frame));
  setMotionPreference("full");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setMotionPreference("full");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const render = (value: number) => act(() => root.render(<ReelCounter value={value} />));
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const column = (place: number) => container.querySelector<HTMLSpanElement>(`.t-reel-col[data-place="${place}"]`)!;
const strip = (place: number) => column(place).querySelector<HTMLSpanElement>(".t-reel-strip")!;

it("steps directly between changed digits without cycling through intermediate values", () => {
  const step = (value: number) => act(() => root.render(<ReelCounter value={value} variant="step" />));
  step(58);
  const tens = container.querySelector('.t-reel-step[data-place="1"] > span');
  step(59);
  expect(container.querySelector('.t-reel-step[data-place="1"] > span')).toBe(tens);
  expect(container.querySelector('.t-reel-step-out')?.textContent).toBe('8');
  expect(container.querySelector('.t-reel-step-in')?.textContent).toBe('9');
  step(60);
  expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('60');
  expect([...container.querySelectorAll('.t-reel-step-in')].map(node => node.textContent)).toEqual(['6', '0']);
  expect(container.querySelector('.t-reel-strip, svg')).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

it("shows step digits immediately when reduced motion is enabled", () => {
  act(() => root.render(<ReelCounter value={9} variant="step" />));
  act(() => setMotionPreference('reduced'));
  act(() => root.render(<ReelCounter value={10} variant="step" />));
  expect(container.textContent).toBe('10');
  expect(container.querySelector('.t-reel-step-in, .t-reel-step-out')).toBeNull();
});

it("exposes one numeric label while keeping repeated strip copies hidden", () => {
  render(12);
  expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("12");
  expect(container.querySelectorAll(".t-reel-col")).toHaveLength(2);
  expect(container.querySelectorAll('.t-reel-col[aria-hidden="true"]')).toHaveLength(2);
  expect(container.querySelectorAll(".t-reel-digit")).toHaveLength(60);
  expect(strip(0).style.transform).toContain("-2");
  expect(vi.getTimerCount()).toBe(0);
});

it("spins only changed places and settles each strip with no residual blur", () => {
  render(12);
  const tens = column(1), tensTransform = strip(1).style.transform;
  render(13); advance(32);
  expect(column(1)).toBe(tens);
  expect(column(1).dataset.spinning).toBe("false");
  expect(strip(1).style.transform).toBe(tensTransform);
  expect(column(0).dataset.spinning).toBe("true");
  const deviation = column(0).querySelector("feGaussianBlur")!.getAttribute("stdDeviation")!.split(" ").map(Number);
  expect(deviation[0]).toBe(0);
  expect(deviation[1]).toBeGreaterThan(0);
  advance(1450);
  expect(column(0).dataset.spinning).toBe("false");
  expect(strip(0).style.transform).toContain("-3");
  expect(strip(0).style.filter).toBe("none");
  expect(column(0).querySelector("feGaussianBlur")!.getAttribute("stdDeviation")).toBe("0 0");
  expect(vi.getTimerCount()).toBe(0);
  render(13); advance(32);
  expect(column(0).dataset.spinning).toBe("false");
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps ones mounted when a new tens place appears and handles wraparound", () => {
  render(9);
  const ones = column(0);
  render(10); advance(32);
  expect(column(0)).toBe(ones);
  expect(column(0).dataset.spinning).toBe("true");
  expect(column(1).dataset.spinning).toBe("false");
  expect(strip(0).style.transform).toContain("-20");
  advance(1450);
  expect(strip(0).style.transform).toContain("-0");
  expect(container.querySelectorAll(".t-reel-digit")).toHaveLength(60);
});

it("coalesces fast changes, cancels stale animation work, and honors reduced motion immediately", () => {
  render(1);
  render(2); advance(32);
  render(3); advance(32);
  expect(column(0).dataset.digit).toBe("3");
  expect(vi.getTimerCount()).toBe(1);
  act(() => setMotionPreference("reduced"));
  expect(column(0).dataset.spinning).toBe("false");
  expect(strip(0).style.transform).toContain("-3");
  expect(strip(0).style.filter).toBe("none");
  expect(vi.getTimerCount()).toBe(0);
  render(4);
  expect(strip(0).style.transform).toContain("-4");
  act(() => setMotionPreference("full"));
  expect(column(0).dataset.spinning).toBe("false");
  render(5); advance(32);
  expect(column(0).dataset.spinning).toBe("true");
  act(() => root.render(null));
  expect(vi.getTimerCount()).toBe(0);
});

it("normalizes invalid values without rendering non-digit columns", () => {
  for (const invalid of [NaN, Infinity, -1]) {
    render(invalid);
    expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("0");
    expect(container.querySelectorAll(".t-reel-col")).toHaveLength(1);
  }
});
