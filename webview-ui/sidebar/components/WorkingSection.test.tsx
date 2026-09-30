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
import { setMotionPreference } from "../../shared/motionPreference";
import { WorkingSection, type WorkingSectionProps } from "./WorkingSection";

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  setMotionPreference("reduced");
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

const render = (props: Partial<WorkingSectionProps> = {}) => act(() => root.render(
  <WorkingSection running hasActivity activity={<p>Read source files</p>} {...props} />,
));
const advance = (milliseconds: number) => act(() => vi.advanceTimersByTime(milliseconds));
const label = () => container.querySelector(".working-title")?.getAttribute("aria-label");
const header = () => container.querySelector<HTMLButtonElement>("button.working-head")!;

it("shows Working immediately and updates seconds, minutes, and hours on its own clock", () => {
  render();
  expect(label()).toBe("Working");
  expect(header().getAttribute("aria-expanded")).toBe("true");
  advance(3000);
  expect(label()).toBe("Working for 3s");
  vi.setSystemTime(112_000);
  advance(1000);
  expect(label()).toBe("Working for 1m 43s");
  vi.setSystemTime(3_732_000);
  advance(1000);
  expect(label()).toBe("Working for 1h 2m 3s");
});

it("auto-collapses finished work while keeping the conclusion visible and supports reopening", () => {
  render({ startedAt: 0 });
  render({ running: false, startedAt: 0, endedAt: 103_000, conclusion: <p>Finished the requested changes.</p> });
  expect(label()).toBe("Worked for 1m 43s");
  expect(header().getAttribute("aria-expanded")).toBe("false");
  expect(container.querySelector(".working-body")).toBeNull();
  expect(container.querySelector(".working-conclusion")?.textContent).toBe("Finished the requested changes.");
  expect(header().type).toBe("button");
  header().focus();
  expect(document.activeElement).toBe(header());
  act(() => header().click());
  expect(header().getAttribute("aria-expanded")).toBe("true");
  expect(container.querySelector(".working-body")?.id).toBe(header().getAttribute("aria-controls"));
  expect(container.querySelector(".working-body")?.textContent).toBe("Read source files");
});

it("honors a manual collapse while working and opens again for the next run", () => {
  render();
  act(() => header().click());
  advance(3000);
  expect(header().getAttribute("aria-expanded")).toBe("false");
  render({ running: false });
  expect(label()).toBe("Worked for 3s");
  render({ running: true });
  expect(header().getAttribute("aria-expanded")).toBe("true");
  expect(label()).toBe("Working");
});

it("does not invent durations for untimed historical work", () => {
  render({ running: false });
  expect(label()).toBe("Worked");
  render({ running: false, startedAt: 1 });
  expect(label()).toBe("Worked");
  render({ running: false, startedAt: 0, endedAt: 6000, durationMs: 3000 });
  expect(label()).toBe("Worked for 3s");
  render({ running: false, durationMs: Number.NaN });
  expect(label()).toBe("Worked");
});

it("keeps required input visible even after work stops", () => {
  render({ running: false, forceOpen: true, activity: <button>Approve command</button> });
  expect(header().getAttribute("aria-expanded")).toBe("true");
  expect(header().getAttribute("aria-disabled")).toBe("true");
  act(() => header().click());
  expect(container.querySelector(".working-body")?.textContent).toBe("Approve command");
  render({ running: false });
  expect(header().getAttribute("aria-expanded")).toBe("false");
});

it("uses a plain heading without an empty history toggle while showing the live status", () => {
  render({ hasActivity: false, activity: null, status: <p>Thinking</p> });
  expect(container.querySelector("button.working-head")).toBeNull();
  expect(container.querySelector(".working-body")?.textContent).toBe("Thinking");
});

it("retains outgoing activity during collapse when the parent moves the final text", () => {
  act(() => setMotionPreference("full"));
  render({ activity: <p>Working through the final step</p>, status: <span>Thinking</span> });
  advance(40);
  render({ running: false, activity: <p>Saved tool history</p>, conclusion: <p>Done</p> });
  expect(container.querySelector(".working-body")?.textContent).toBe("Working through the final stepThinking");
  expect(container.querySelector(".animated-disclosure")?.hasAttribute("inert")).toBe(true);
  expect(container.querySelector(".working-conclusion")?.textContent).toBe("Done");
  advance(220);
  expect(container.querySelector(".working-body")).toBeNull();
  act(() => header().click());
  expect(container.querySelector(".working-body")?.textContent).toBe("Saved tool history");
});

it("freezes elapsed time and clears its interval when stopped or unmounted", () => {
  render();
  advance(3000);
  render({ running: false });
  expect(label()).toBe("Worked for 3s");
  expect(vi.getTimerCount()).toBe(0);
  advance(5000);
  render({ running: false, conclusion: <p>A later UI update</p> });
  expect(label()).toBe("Worked for 3s");
  render();
  expect(vi.getTimerCount()).toBe(1);
  act(() => root.render(null));
  expect(vi.getTimerCount()).toBe(0);
});
