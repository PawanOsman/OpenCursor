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
import { usePresence } from "./usePresence";
import { setMotionPreference } from "./motionPreference";

let root: Root, container: HTMLDivElement;
let preference: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
let onPreferenceChange: (() => void) | undefined;
const snapshots: { present: boolean; exiting: boolean }[] = [];
function Fixture({ open, exitMs }: { open: boolean; exitMs?: number }) {
  const state = usePresence(open, exitMs);
  snapshots.push(state);
  return state.present ? <div data-state={state.exiting ? "closing" : "open"} /> : null;
}
const render = (open: boolean, exitMs?: number) => act(() => root.render(<Fixture open={open} exitMs={exitMs} />));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  preference = { matches: false, addEventListener: vi.fn((_: string, callback: () => void) => { onPreferenceChange = callback; }), removeEventListener: vi.fn() };
  vi.stubGlobal("matchMedia", vi.fn(() => preference));
  setMotionPreference("system");
  snapshots.length = 0; onPreferenceChange = undefined;
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount()); container.remove();
  setMotionPreference("full");
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it("renders immediately on opening and keeps the closing surface for the exit duration", () => {
  render(false); expect(container.firstChild).toBeNull();
  snapshots.length = 0;
  render(true);
  expect(snapshots[0]).toEqual({ present: true, exiting: false });
  render(false);
  expect(container.firstElementChild?.getAttribute("data-state")).toBe("closing");
  act(() => vi.advanceTimersByTime(119)); expect(container.firstChild).not.toBeNull();
  act(() => vi.advanceTimersByTime(1)); expect(container.firstChild).toBeNull();
});

it("cancels stale exit timers when reopened and when unmounted", () => {
  render(true); render(false); act(() => vi.advanceTimersByTime(70));
  render(true); act(() => vi.advanceTimersByTime(120));
  expect(container.firstElementChild?.getAttribute("data-state")).toBe("open");
  render(false); expect(vi.getTimerCount()).toBe(1);
  act(() => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
  expect(preference.removeEventListener).toHaveBeenCalledWith("change", onPreferenceChange);
  root = createRoot(container);
});

it("removes immediately when reduced motion is enabled and does not restore a finished exit", () => {
  render(true); render(false);
  act(() => { preference.matches = true; onPreferenceChange?.(); });
  expect(container.firstChild).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  act(() => { preference.matches = false; onPreferenceChange?.(); });
  expect(container.firstChild).toBeNull();
  render(true); expect(container.firstElementChild?.getAttribute("data-state")).toBe("open");
});

it("skips retention for reduced motion and zero duration but supports motion without matchMedia", () => {
  preference.matches = true;
  render(true); render(false); expect(container.firstChild).toBeNull();
  act(() => root.unmount()); root = createRoot(container);
  vi.stubGlobal("matchMedia", undefined);
  render(true); render(false); expect(container.firstChild).not.toBeNull();
  act(() => vi.advanceTimersByTime(120)); expect(container.firstChild).toBeNull();
  act(() => root.unmount()); root = createRoot(container);
  preference.matches = false; vi.stubGlobal("matchMedia", vi.fn(() => preference));
  render(true, 0); render(false, 0); expect(container.firstChild).toBeNull();
});

it("keeps exit motion enabled when the extension overrides the system preference", () => {
  preference.matches = true;
  setMotionPreference("full");
  render(true); render(false);
  expect(container.firstElementChild?.getAttribute("data-state")).toBe("closing");
  act(() => setMotionPreference("reduced"));
  expect(container.firstChild).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
