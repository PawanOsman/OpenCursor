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
import { AttachmentMenu } from "./AttachmentMenu";
import { setMotionPreference } from "../../shared/motionPreference";

let root: Root, container: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>, frameId: number;
const files = vi.fn();
const trigger = () => container.querySelector<HTMLButtonElement>(".attach-btn")!;
const surface = () => document.querySelector<HTMLDivElement>(".attachment-menu-surface");
const items = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
function key(target: HTMLElement, key: string, shiftKey = false) {
  const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
  act(() => target.dispatchEvent(event));
  return event;
}
function click(element: HTMLElement) { act(() => element.click()); }
function frame() {
  const callbacks = [...frames.values()]; frames.clear();
  act(() => callbacks.forEach(callback => callback(0)));
}
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setMotionPreference("reduced");
  files.mockClear(); frames = new Map(); frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  act(() => root.render(<AttachmentMenu onFiles={files} />));
});
afterEach(() => {
  act(() => root.unmount()); container.remove(); setMotionPreference("full");
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

it("opens accessible attachment choices and dispatches the chosen file type synchronously", () => {
  expect(trigger().getAttribute("aria-label")).toBe("Attach images or files");
  click(trigger());
  expect(surface()?.parentElement).toBe(document.body);
  expect(trigger().getAttribute("aria-expanded")).toBe("true");
  expect(surface()?.dataset.open).toBe("true");
  expect(items().map(item => item.textContent)).toEqual(["Attach files", "Attach images"]);
  expect(document.activeElement).toBe(items()[0]);
  click(items()[0]);
  expect(files).toHaveBeenCalledWith(false);
  expect(surface()).toBeNull();
  expect(document.activeElement).toBe(trigger());
  click(trigger()); click(items()[1]);
  expect(files).toHaveBeenLastCalledWith(true);
  expect(files).toHaveBeenCalledTimes(2);
});

it("supports roving menu focus, Escape, and an untrapped Tab back through the composer", () => {
  key(trigger(), "ArrowUp"); expect(document.activeElement).toBe(items()[1]);
  key(items()[1], "ArrowDown"); expect(document.activeElement).toBe(items()[0]);
  key(items()[0], "ArrowUp"); expect(document.activeElement).toBe(items()[1]);
  key(items()[1], "Home"); expect(document.activeElement).toBe(items()[0]);
  key(items()[0], "End"); expect(document.activeElement).toBe(items()[1]);
  key(items()[1], "Escape"); expect(surface()).toBeNull(); expect(document.activeElement).toBe(trigger());
  key(trigger(), "ArrowDown");
  expect(key(items()[0], "Tab").defaultPrevented).toBe(false);
  expect(surface()).toBeNull(); expect(document.activeElement).toBe(trigger());
  expect(files).not.toHaveBeenCalled();
});

it("dismisses on outside pointer or focus without stealing that focus", () => {
  const outside = document.createElement("button"); document.body.appendChild(outside);
  try {
    click(trigger());
    act(() => outside.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(surface()).toBeNull();
    click(trigger()); act(() => outside.focus());
    expect(surface()).toBeNull(); expect(document.activeElement).toBe(outside);
  } finally { outside.remove(); }
});

it("paints the collapsed morph first, retains an inert exit, and reverses a rapid reopen", () => {
  act(() => setMotionPreference("full"));
  click(trigger()); expect(surface()?.dataset.open).toBe("false");
  frame(); expect(surface()?.dataset.open).toBe("false");
  frame(); expect(surface()?.dataset.open).toBe("true");
  expect(document.activeElement).toBe(items()[0]);
  key(items()[0], "Escape");
  expect(surface()?.dataset.open).toBe("false");
  expect(surface()?.dataset.state).toBe("closing");
  expect(surface()?.hasAttribute("inert")).toBe(true);
  expect(surface()?.getAttribute("aria-hidden")).toBe("true");
  expect(surface()?.style.pointerEvents).toBe("none");
  click(items()[0]); expect(files).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(100)); click(trigger()); frame(); frame();
  expect(surface()?.hasAttribute("inert")).toBe(false);
  act(() => vi.advanceTimersByTime(200)); expect(surface()).not.toBeNull();
  key(items()[0], "Escape");
  act(() => vi.advanceTimersByTime(249)); expect(surface()).not.toBeNull();
  act(() => vi.advanceTimersByTime(1)); expect(surface()).toBeNull();
});

it("clamps the morph to the viewport and repositions on resizing and scrolling", () => {
  vi.stubGlobal("innerWidth", 375); vi.stubGlobal("innerHeight", 700);
  let left = 340, bottom = 650;
  vi.spyOn(trigger(), "getBoundingClientRect").mockImplementation(() => ({ left, bottom, top: bottom - 28, right: left + 28, width: 28, height: 28, x: left, y: bottom - 28, toJSON() {} }));
  click(trigger());
  expect(surface()?.style.left).toBe("159px");
  expect(surface()?.style.bottom).toBe("50px");
  expect(surface()?.style.getPropertyValue("--morph-open-width")).toBe("208px");
  left = 16; bottom = 550;
  act(() => window.dispatchEvent(new Event("scroll")));
  expect(surface()?.style.left).toBe("16px"); expect(surface()?.style.bottom).toBe("150px");
  vi.stubGlobal("innerWidth", 180);
  act(() => window.dispatchEvent(new Event("resize")));
  expect(surface()?.style.left).toBe("8px");
  expect(surface()?.style.getPropertyValue("--morph-open-width")).toBe("164px");
});

it("cancels pending animation frames on close and removes the surface immediately when motion is reduced", () => {
  act(() => setMotionPreference("full"));
  click(trigger()); expect(frames.size).toBe(1);
  click(trigger()); expect(frames.size).toBe(0);
  frame(); expect(surface()?.dataset.open).toBe("false");
  act(() => setMotionPreference("reduced")); expect(surface()).toBeNull();
  click(trigger()); expect(surface()?.dataset.open).toBe("true"); expect(frames.size).toBe(0);
  click(trigger()); expect(surface()).toBeNull();
});
