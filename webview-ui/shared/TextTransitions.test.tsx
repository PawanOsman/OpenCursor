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
import { StaggerReveal, TextSwap } from "./TextTransitions";
import { AnimatedTooltip } from "./AnimatedTooltip";
import { AnimatedDisclosure } from "./AnimatedDisclosure";
import { setMotionPreference } from "./motionPreference";

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  setMotionPreference("full");
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); setMotionPreference("full"); vi.useRealTimers(); vi.unstubAllGlobals(); });
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

it("keeps collapsing content inert, supports reversal, and respects reduced motion", () => {
  const render = (open: boolean) => act(() => root.render(<AnimatedDisclosure open={open}><button>Keep file</button></AnimatedDisclosure>));
  render(true); advance(40);
  expect(container.firstElementChild?.getAttribute("data-open")).toBe("true");
  render(false);
  expect(container.firstElementChild?.hasAttribute("inert")).toBe(true);
  expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  advance(100); render(true); advance(150);
  expect(container.firstElementChild?.getAttribute("data-open")).toBe("true");
  expect(container.firstElementChild?.hasAttribute("inert")).toBe(false);
  render(false); advance(220);
  expect(container.firstElementChild).toBeNull();
  act(() => setMotionPreference("reduced"));
  render(true);
  expect(container.firstElementChild?.getAttribute("data-open")).toBe("true");
  render(false);
  expect(container.firstElementChild).toBeNull();
});

it("runs the supplied exit and enter classes while coalescing rapid label changes", () => {
  act(() => root.render(<TextSwap text="One" />));
  act(() => root.render(<TextSwap text="Two" />));
  expect(container.firstElementChild?.classList.contains("is-exit")).toBe(true);
  expect(container.textContent).toBe("One");
  advance(75);
  act(() => root.render(<TextSwap text="Three" />));
  advance(150);
  expect(container.textContent).toBe("Three");
  expect(container.firstElementChild?.classList.contains("is-enter-start")).toBe(true);
  advance(40);
  expect(container.firstElementChild?.classList.contains("is-enter-start")).toBe(false);
});

it("keeps reduced-motion labels visible and clears pending swap work on unmount", () => {
  act(() => root.render(<TextSwap text="One" />));
  act(() => root.render(<TextSwap text="Two" />));
  act(() => setMotionPreference("reduced"));
  expect(container.textContent).toBe("Two");
  expect(container.firstElementChild?.classList.contains("is-exit")).toBe(false);
  act(() => setMotionPreference("full"));
  act(() => root.render(<TextSwap text="Three" />));
  act(() => root.render(null));
  expect(vi.getTimerCount()).toBe(0);
});

it("reveals welcome lines once and does not restart on ordinary rerenders", () => {
  act(() => root.render(<StaggerReveal><span className="t-stagger-line">Welcome</span></StaggerReveal>));
  expect(container.firstElementChild?.classList.contains("is-shown")).toBe(false);
  advance(20);
  expect(container.firstElementChild?.classList.contains("is-shown")).toBe(true);
  act(() => root.render(<StaggerReveal><span className="t-stagger-line">Ready</span></StaggerReveal>));
  expect(container.firstElementChild?.classList.contains("is-shown")).toBe(true);
});

it("closes tooltips without an entrance delay and cancels stale exit timers on reopen", () => {
  const elementRef = React.createRef<HTMLDivElement>();
  const render = (open: boolean) => act(() => root.render(<AnimatedTooltip open={open} elementRef={elementRef} id="tip" style={{}}>Context usage</AnimatedTooltip>));
  render(true); advance(20);
  expect(document.querySelector('#tip')?.getAttribute("data-show")).toBe("true");
  render(false);
  expect(document.querySelector('#tip')?.getAttribute("data-show")).toBe("false");
  expect(document.querySelector('#tip')?.getAttribute("aria-hidden")).toBe("true");
  advance(25); render(true); advance(60);
  expect(document.querySelector('#tip')?.getAttribute("data-show")).toBe("true");
  render(false); advance(50);
  expect(document.querySelector('#tip')).toBeNull();
});
