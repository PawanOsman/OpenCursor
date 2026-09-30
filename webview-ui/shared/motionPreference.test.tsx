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
import { initializeMotionPreference, setMotionPreference, useReducedMotion } from "./motionPreference";

let root: Root;
let container: HTMLDivElement;
let dispose: (() => void) | undefined;
let change: (() => void) | undefined;
let query: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
function Fixture() {
  const reduced = useReducedMotion();
  return <span>{reduced ? "reduced" : "full"}</span>;
}
const render = () => act(() => root.render(<Fixture />));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  query = {
    matches: true,
    addEventListener: vi.fn((_: string, listener: () => void) => { change = listener; }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("matchMedia", vi.fn(() => query));
  change = undefined;
  setMotionPreference("full");
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount()); container.remove();
  dispose?.(); dispose = undefined;
  setMotionPreference("full");
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

it("enables animation by default even when the system reports reduced motion", () => {
  dispose = initializeMotionPreference(); render();
  expect(document.documentElement.dataset.motion).toBe("full");
  expect(container.textContent).toBe("full");
  act(() => { query.matches = false; change?.(); });
  act(() => { query.matches = true; change?.(); });
  expect(container.textContent).toBe("full");
});

it("keeps CSS and React in sync when the saved policy changes", () => {
  dispose = initializeMotionPreference(); render();
  act(() => setMotionPreference("system"));
  expect(document.documentElement.dataset.motion).toBe("reduced");
  expect(container.textContent).toBe("reduced");
  act(() => { query.matches = false; change?.(); });
  expect(document.documentElement.dataset.motion).toBe("full");
  expect(container.textContent).toBe("full");
  act(() => setMotionPreference("reduced"));
  expect(document.documentElement.dataset.motion).toBe("reduced");
  expect(container.textContent).toBe("reduced");
  act(() => setMotionPreference(undefined));
  expect(document.documentElement.dataset.motion).toBe("full");
  expect(container.textContent).toBe("full");
});

it("shares one media listener and removes it after the final consumer exits", () => {
  dispose = initializeMotionPreference();
  const second = initializeMotionPreference();
  render();
  expect(query.addEventListener).toHaveBeenCalledTimes(1);
  dispose(); dispose(); dispose = undefined;
  expect(query.removeEventListener).not.toHaveBeenCalled();
  second();
  expect(query.removeEventListener).not.toHaveBeenCalled();
  act(() => root.unmount()); root = createRoot(container);
  expect(query.removeEventListener).toHaveBeenCalledTimes(1);
  expect(query.removeEventListener).toHaveBeenCalledWith("change", change);
});

it("supports missing matchMedia without disabling full animation", () => {
  vi.stubGlobal("matchMedia", undefined);
  dispose = initializeMotionPreference(); render();
  expect(container.textContent).toBe("full");
  act(() => setMotionPreference("system"));
  expect(container.textContent).toBe("full");
  act(() => setMotionPreference("reduced"));
  expect(container.textContent).toBe("reduced");
});

it("supports older media listeners and removes them on cleanup", () => {
  const legacy = { matches: true, addListener: vi.fn(), removeListener: vi.fn() };
  vi.stubGlobal("matchMedia", vi.fn(() => legacy));
  setMotionPreference("system");
  dispose = initializeMotionPreference();
  expect(document.documentElement.dataset.motion).toBe("reduced");
  expect(legacy.addListener).toHaveBeenCalledTimes(1);
  dispose(); dispose = undefined;
  expect(legacy.removeListener).toHaveBeenCalledTimes(1);
  expect(legacy.removeListener).toHaveBeenCalledWith(legacy.addListener.mock.calls[0][0]);
});
