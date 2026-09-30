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
import { DateField, isValidDate } from "./DateField";
import { setMotionPreference } from "./motionPreference";

let root: Root, container: HTMLDivElement;
const change = vi.fn();
beforeEach(() => {
  setMotionPreference("reduced");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); setMotionPreference("full"); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const render = (props: Partial<React.ComponentProps<typeof DateField>> = {}) => act(() => root.render(<DateField label="Due date" value="2024-02-29" onChange={change} {...props} />));
const input = () => container.querySelector<HTMLInputElement>("input")!;
const trigger = () => container.querySelector<HTMLButtonElement>(".oc-date-trigger")!;
const day = (value: string) => document.querySelector<HTMLButtonElement>(`[data-date="${value}"]`)!;
const dialog = () => document.querySelector<HTMLDivElement>('[role="dialog"]');
function key(target: HTMLElement, value: string, extra: KeyboardEventInit = {}) {
  act(() => target.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...extra })));
}

it("validates date-only values, leap centuries, and the full supported year range", () => {
  for (const value of ["0001-01-01", "2024-02-29", "2000-02-29", "9999-12-31"]) expect(isValidDate(value), value).toBe(true);
  for (const value of ["", "0000-01-01", "10000-01-01", "1900-02-29", "2025-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-01-00", "2026-1-01", "2026-01-01Z"]) expect(isValidDate(value), value).toBe(false);
});

it("uses custom text editing and preserves input options and submit keys", () => {
  const submit = vi.fn(), focus = vi.spyOn(HTMLElement.prototype, "focus");
  render({ value: "2026-02-31", autoFocus: true, required: true, onKeyDown: submit, id: "deadline" });
  expect(input().type).toBe("text"); expect(input().id).toBe("deadline");
  expect(input().getAttribute("aria-label")).toBe("Due date");
  expect(input().getAttribute("aria-invalid")).toBe("true"); expect(input().required).toBe(true);
  expect(document.activeElement).toBe(input()); expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), "2026-03-01");
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(change).toHaveBeenCalledWith("2026-03-01");
  key(input(), "Enter"); expect(submit).toHaveBeenCalled();
});

it("opens a stable custom calendar and selects a date without scrolling the page", () => {
  const focus = vi.spyOn(HTMLElement.prototype, "focus"); render();
  act(() => trigger().click());
  expect(dialog()?.getAttribute("aria-label")).toBe("Due date calendar");
  expect(dialog()?.style.opacity).toBe("1");
  expect(document.querySelectorAll('[role="gridcell"]')).toHaveLength(42);
  expect(day("2024-02-29").getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(day("2024-02-29"));
  act(() => day("2024-03-01").click());
  expect(change).toHaveBeenCalledWith("2024-03-01"); expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(input()); expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
});

it("navigates days, weeks, months and years, clamping leap days when necessary", () => {
  render(); act(() => trigger().click());
  key(day("2024-02-29"), "ArrowRight"); expect(document.activeElement).toBe(day("2024-03-01"));
  key(day("2024-03-01"), "ArrowLeft"); expect(document.activeElement).toBe(day("2024-02-29"));
  key(day("2024-02-29"), "Home"); expect(document.activeElement).toBe(day("2024-02-26"));
  key(day("2024-02-26"), "End"); expect(document.activeElement).toBe(day("2024-03-03"));
  key(day("2024-03-03"), "ArrowUp"); expect(document.activeElement).toBe(day("2024-02-25"));
  key(day("2024-02-25"), "ArrowDown"); expect(document.activeElement).toBe(day("2024-03-03"));
  key(day("2024-03-03"), "PageDown"); expect(document.activeElement).toBe(day("2024-04-03"));
  key(day("2024-04-03"), "PageUp"); expect(document.activeElement).toBe(day("2024-03-03"));
  key(day("2024-03-03"), "PageUp", { shiftKey: true }); expect(document.activeElement).toBe(day("2023-03-03"));
  expect(change).not.toHaveBeenCalled();
  key(day("2023-03-03"), "Escape"); render(); act(() => trigger().click());
  key(day("2024-02-29"), "PageDown", { shiftKey: true }); expect(document.activeElement).toBe(day("2025-02-28"));
});

it("dismisses with Escape or an outside press and keeps Tab inside the open calendar", () => {
  render(); key(input(), "ArrowDown", { altKey: true });
  const previous = document.querySelector<HTMLButtonElement>('[aria-label="Previous month"]')!;
  const last = document.querySelector<HTMLButtonElement>(".oc-date-footer button")!;
  act(() => previous.focus());
  key(previous, "Tab", { shiftKey: true }); expect(document.activeElement).toBe(last);
  key(last, "Tab"); expect(document.activeElement).toBe(previous);
  key(previous, "Escape"); expect(dialog()).toBeNull(); expect(document.activeElement).toBe(trigger());
  act(() => trigger().click());
  act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(dialog()).toBeNull(); expect(change).not.toHaveBeenCalled();
});

it("never navigates or selects outside supported years and respects disabled fields", () => {
  render({ value: "0001-01-01" }); act(() => trigger().click());
  expect(document.querySelector<HTMLButtonElement>('[aria-label="Previous month"]')!.disabled).toBe(true);
  key(day("0001-01-01"), "ArrowLeft"); expect(document.activeElement).toBe(day("0001-01-01"));
  expect([...document.querySelectorAll<HTMLButtonElement>('[data-date^="0000-"]')].every(button => button.disabled)).toBe(true);
  key(day("0001-01-01"), "Escape");
  render({ value: "9999-12-31" }); act(() => trigger().click());
  expect(document.querySelector<HTMLButtonElement>('[aria-label="Next month"]')!.disabled).toBe(true);
  key(day("9999-12-31"), "ArrowRight"); expect(document.activeElement).toBe(day("9999-12-31"));
  render({ disabled: true }); expect(dialog()).toBeNull();
  expect(input().disabled).toBe(true); expect(trigger().disabled).toBe(true);
  act(() => trigger().click()); expect(dialog()).toBeNull();
});

it("keeps the exit animation inert, releases focus and restores the active date on reopen", () => {
  setMotionPreference("full");
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  render(); act(() => trigger().click());
  expect(dialog()?.getAttribute("data-state")).toBe("open");
  expect(dialog()?.getAttribute("data-side")).toBe("bottom");
  key(day("2024-02-29"), "Escape");
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
  expect(dialog()?.getAttribute("data-state")).toBe("closing");
  expect(dialog()?.hasAttribute("inert")).toBe(true);
  expect(dialog()?.getAttribute("aria-hidden")).toBe("true");
  expect(dialog()?.style.pointerEvents).toBe("none");
  expect(document.activeElement).toBe(trigger());
  expect(day("2024-02-29").disabled).toBe(false);
  expect([...dialog()!.querySelectorAll<HTMLButtonElement>("[data-date]")].every(button => button.tabIndex === -1)).toBe(true);
  const closingDay = day("2024-03-01");
  act(() => closingDay.click());
  const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  act(() => closingDay.dispatchEvent(tab));
  expect(tab.defaultPrevented).toBe(false); expect(change).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(60));
  act(() => trigger().click());
  expect(dialog()?.hasAttribute("inert")).toBe(false);
  expect(document.activeElement).toBe(day("2024-02-29"));
  act(() => vi.advanceTimersByTime(120)); expect(dialog()).not.toBeNull();
  act(() => day("2024-03-01").click());
  expect(document.activeElement).toBe(input()); expect(change).toHaveBeenCalledOnce();
  act(() => vi.advanceTimersByTime(120)); expect(dialog()).toBeNull();
});
