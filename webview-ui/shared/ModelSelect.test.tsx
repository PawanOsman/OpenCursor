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
import { ModelSelect } from "./ModelSelect";
import { setMotionPreference } from "./motionPreference";

let root: Root, container: HTMLDivElement;
const change = vi.fn();
const models = [{ id: "one", name: "One", providerName: "Provider A" }, { id: "two", name: "Two", providerName: "Provider B" }];
beforeEach(() => {
  setMotionPreference("reduced");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  act(() => root.render(<ModelSelect models={models} value="one" onChange={change} customItems={[{ value: "", label: "Inherit chat model" }]} />));
});
afterEach(() => { act(() => root.unmount()); container.remove(); setMotionPreference("full"); vi.unstubAllGlobals(); });
const trigger = () => container.querySelector<HTMLButtonElement>(".msel-trigger")!;
const search = () => document.querySelector<HTMLInputElement>(".msel-search")!;
function key(target: HTMLElement, value: string, extra: KeyboardEventInit = {}) {
  act(() => target.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...extra })));
}

it("searches and selects without a native popup, then restores focus without scrolling", () => {
  const focus = vi.spyOn(HTMLElement.prototype, "focus");
  act(() => trigger().click());
  expect(document.activeElement).toBe(search());
  expect(document.querySelector("select")).toBeNull();
  expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("Choose model");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search(), "Two");
    search().dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
  key(search(), "Enter");
  expect(change).toHaveBeenCalledWith("two");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(trigger());
  expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
  focus.mockRestore();
});

it("navigates model results with arrows and Home/End and dismisses with Escape", () => {
  act(() => trigger().click());
  const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
  key(search(), "ArrowDown"); expect(document.activeElement).toBe(options[0]);
  key(options[0], "End"); expect(document.activeElement).toBe(options[2]);
  key(options[2], "ArrowDown"); expect(document.activeElement).toBe(options[0]);
  key(options[0], "ArrowUp"); expect(document.activeElement).toBe(options[2]);
  key(options[2], "Home"); expect(document.activeElement).toBe(options[0]);
  key(options[0], "Escape");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(change).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(trigger());
});

it("traps Tab in the picker and exposes the selected provider filter", () => {
  act(() => trigger().click());
  const options = document.querySelectorAll<HTMLElement>('[role="option"]');
  const last = options[options.length - 1];
  key(search(), "Tab", { shiftKey: true }); expect(document.activeElement).toBe(last);
  key(last, "Tab"); expect(document.activeElement).toBe(search());
  const filter = [...document.querySelectorAll<HTMLButtonElement>(".msel-chip")].find(button => button.textContent === "Provider B")!;
  act(() => filter.click());
  expect(filter.getAttribute("aria-pressed")).toBe("true");
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
  expect(document.querySelector('[role="option"]')?.textContent).toContain("Two");
});

it("returns focus immediately and prevents selection while its exit animation finishes", () => {
  act(() => setMotionPreference("full"));
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  act(() => root.render(null));
  act(() => root.render(<ModelSelect models={models} value="one" onChange={change} />));
  try {
    act(() => trigger().click());
    key(search(), "Escape");
    const overlay = document.querySelector('.msel-overlay')!;
    expect(overlay.getAttribute("data-state")).toBe("closing");
    expect(overlay.hasAttribute("inert")).toBe(true);
    expect(overlay.getAttribute("aria-hidden")).toBe("true");
    expect(overlay.hasAttribute("data-modal-layer")).toBe(false);
    expect(document.activeElement).toBe(trigger());
    act(() => document.querySelector<HTMLButtonElement>('[role="option"]')!.click());
    expect(change).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(120));
    expect(document.querySelector('.msel-overlay')).toBeNull();
  } finally { vi.useRealTimers(); }
});
