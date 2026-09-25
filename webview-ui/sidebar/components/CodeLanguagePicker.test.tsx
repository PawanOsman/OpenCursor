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
import { CodeLanguagePicker } from "./CodeLanguagePicker";
import { setMotionPreference } from "../../shared/motionPreference";

let root: Root, container: HTMLDivElement;
const onChange = vi.fn();
const trigger = () => container.querySelector<HTMLButtonElement>("button")!;
const search = () => document.querySelector<HTMLInputElement>('[aria-label="Search languages"]')!;
const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')];
function key(target: HTMLElement, value: string) {
  act(() => target.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true })));
}
function input(value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search(), value);
    search().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(() => {
  setMotionPreference("reduced");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onChange.mockClear();
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount()); container.remove(); setMotionPreference("full"); vi.useRealTimers(); vi.unstubAllGlobals();
});

it("defaults to Auto and retains a selectable Plain text override", () => {
  act(() => root.render(<CodeLanguagePicker detectedLabel="JavaScript" onChange={onChange} />));
  expect(trigger().textContent).toBe("Auto (JavaScript)");
  act(() => trigger().click());
  expect(options()[0].textContent).toBe("Auto detect");
  expect(options()[0].getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(search());
  act(() => options()[1].click());
  expect(onChange).toHaveBeenCalledWith("plaintext");
  expect(options()).toHaveLength(0); expect(document.activeElement).toBe(trigger());
  act(() => root.render(<CodeLanguagePicker value="plaintext" detectedLabel="JavaScript" onChange={onChange} />));
  expect(trigger().textContent).toBe("Plain text");
});

it("filters language names and aliases, handles empty results and selects from the keyboard", () => {
  const bubbled = vi.fn();
  act(() => root.render(<div onKeyDown={bubbled}><CodeLanguagePicker value="auto" detectedLabel="Plain text" onChange={onChange} /></div>));
  key(trigger(), "Enter"); key(trigger(), " "); expect(bubbled).not.toHaveBeenCalled();
  key(trigger(), "ArrowDown");
  input("tsx"); expect(options().map(option => option.textContent)).toEqual(["TypeScript"]);
  key(search(), "Enter"); expect(onChange).toHaveBeenCalledWith("typescript"); expect(bubbled).not.toHaveBeenCalled();
  act(() => trigger().click());
  input("does-not-exist"); expect(options()).toHaveLength(0);
  expect(document.querySelector('[role="status"]')?.textContent).toBe("No languages found");
  key(search(), "Enter"); expect(onChange).toHaveBeenCalledTimes(1);
  input("c#"); expect(options().map(option => option.textContent)).toEqual(["C#"]);
  key(search(), "Escape"); expect(options()).toHaveLength(0); expect(document.activeElement).toBe(trigger());
});

it("wraps keyboard selection, dismisses outside and does not change the value on dismissal", () => {
  act(() => root.render(<CodeLanguagePicker detectedLabel="" onChange={onChange} />));
  expect(trigger().textContent).toBe("Auto detect");
  act(() => trigger().click());
  key(search(), "ArrowUp");
  const choices = options();
  expect(search().getAttribute("aria-activedescendant")).toBe(choices[choices.length - 1].id);
  key(search(), "ArrowDown"); expect(search().getAttribute("aria-activedescendant")).toBe(options()[0].id);
  act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(options()).toHaveLength(0); expect(onChange).not.toHaveBeenCalled();
  act(() => trigger().click());
  act(() => root.render(<CodeLanguagePicker detectedLabel="" onChange={onChange} disabled />));
  expect(options()).toHaveLength(0); expect(trigger().disabled).toBe(true);
});

it("clamps the menu to narrow viewports and does not scroll the editor", () => {
  vi.stubGlobal("innerWidth", 180); vi.stubGlobal("innerHeight", 220);
  const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 155, y: 180, top: 180, left: 155, bottom: 204, right: 220, width: 65, height: 24, toJSON() {} });
  act(() => root.render(<CodeLanguagePicker detectedLabel="JavaScript" onChange={onChange} />));
  act(() => trigger().click());
  const menu = document.querySelector<HTMLElement>(".code-language-menu")!;
  expect(menu.style.width).toBe("164px"); expect(menu.style.left).toBe("8px");
  expect(menu.style.height).toBe("167px"); expect(menu.style.top).toBe("8px");
  key(search(), "ArrowUp"); expect(document.scrollingElement?.scrollTop ?? 0).toBe(0);
  bounds.mockRestore();
});

it("retains only an inert closing menu for the exit animation", () => {
  setMotionPreference("full"); vi.useFakeTimers();
  act(() => root.render(<CodeLanguagePicker detectedLabel="JavaScript" onChange={onChange} />));
  act(() => trigger().click());
  const menu = document.querySelector<HTMLElement>(".code-language-menu")!;
  key(search(), "Escape");
  expect(menu.dataset.state).toBe("closing"); expect(menu.hasAttribute("inert")).toBe(true);
  act(() => options()[1].click()); expect(onChange).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(120)); expect(document.querySelector(".code-language-menu")).toBeNull();
});
