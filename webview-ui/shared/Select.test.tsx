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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Select } from "./Select";
import { setMotionPreference } from "./motionPreference";

let root: Root;
let container: HTMLDivElement;
const choices = <>
  <option value="alpha">Alpha</option>
  <option value="beta" disabled>Beta</option>
  <optgroup label="Unavailable" disabled><option value="cedar">Cedar</option></optgroup>
  <optgroup label="Available"><option value="delta">Delta</option><option value="echo">Echo</option><option value="elm">Elm</option></optgroup>
</>;
const trigger = () => container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
const list = () => document.querySelector<HTMLDivElement>('[role="listbox"]');
function key(value: string) { act(() => trigger().dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }))); }
function click(element: HTMLElement) { act(() => element.click()); }
function activeLabel() { return document.getElementById(trigger().getAttribute("aria-activedescendant")!)?.textContent; }

beforeEach(() => {
  setMotionPreference("reduced");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); setMotionPreference("full"); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("shared select", () => {
  it("uses a custom listbox, emits controlled values and preserves named form values", () => {
    const change = vi.fn();
    function Fixture() {
      const [value, setValue] = React.useState("alpha");
      return <form><Select name="strategy" aria-label="Load balancing" value={value} onChange={event => { setValue(event.target.value); change(event); }}>{choices}</Select></form>;
    }
    act(() => root.render(<Fixture />));
    expect(container.querySelector("select")).toBeNull();
    click(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(list()?.parentElement).toBe(document.body);
    const delta = [...list()!.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent === "Delta")!;
    click(delta);
    expect(change).toHaveBeenCalledOnce();
    expect(change).toHaveBeenCalledWith({ target: { value: "delta", name: "strategy" }, currentTarget: { value: "delta", name: "strategy" } });
    expect(trigger().textContent).toBe("Delta");
    expect(list()).toBeNull();
    expect(new FormData(container.querySelector("form")!).get("strategy")).toBe("delta");
    expect(document.activeElement).toBe(trigger());
  });

  it("supports keyboard navigation, disabled groups, Home/End and typeahead without prematurely changing the value", () => {
    const change = vi.fn();
    act(() => root.render(<Select value="alpha" onChange={change}>{choices}</Select>));
    key("ArrowDown");
    expect(activeLabel()).toBe("Alpha");
    key("ArrowDown");
    expect(activeLabel()).toBe("Delta");
    key("End");
    expect(activeLabel()).toBe("Elm");
    key("Home");
    expect(activeLabel()).toBe("Alpha");
    key("e");
    expect(activeLabel()).toBe("Echo");
    key("e");
    expect(activeLabel()).toBe("Elm");
    expect(change).not.toHaveBeenCalled();
    key("Enter");
    expect(change.mock.calls[0][0].target.value).toBe("elm");
    expect(list()).toBeNull();
    expect(trigger().textContent).toBe("Alpha"); // Controlled until the parent accepts the change.
  });

  it("closes only the list on Escape and restores focus without scrolling", () => {
    const parentKey = vi.fn();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    act(() => root.render(<div onKeyDown={parentKey}><Select defaultValue="delta">{choices}</Select></div>));
    click(trigger());
    key("Escape");
    expect(list()).toBeNull();
    expect(parentKey).not.toHaveBeenCalled();
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
  });

  it("lets outside controls receive focus and dismisses on Tab without trapping it", () => {
    act(() => root.render(<><Select>{choices}</Select><button id="next-control">Next</button></>));
    click(trigger());
    const next = container.querySelector<HTMLButtonElement>("#next-control")!;
    act(() => { next.dispatchEvent(new Event("pointerdown", { bubbles: true })); next.focus(); });
    expect(list()).toBeNull();
    expect(document.activeElement).toBe(next);
    click(trigger());
    key("Tab");
    expect(list()).toBeNull();
    expect(document.activeElement).toBe(next);
  });

  it("fits the popup above an edge trigger and repositions without changing document scroll or body styles", () => {
    vi.stubGlobal("innerWidth", 280);
    vi.stubGlobal("innerHeight", 400);
    act(() => root.render(<Select>{choices}</Select>));
    vi.spyOn(trigger(), "getBoundingClientRect").mockReturnValue({ left: 210, right: 280, top: 360, bottom: 392, width: 70, height: 32, x: 210, y: 360, toJSON: () => ({}) });
    document.documentElement.scrollTop = 123;
    const bodyStyle = document.body.getAttribute("style");
    click(trigger());
    expect(Number.parseFloat(list()!.style.left)).toBe(72);
    expect(Number.parseFloat(list()!.style.top)).toBeLessThan(360);
    expect(Number.parseFloat(list()!.style.width)).toBe(200);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(document.documentElement.scrollTop).toBe(123);
    expect(document.body.getAttribute("style")).toBe(bodyStyle);
  });

  it("handles empty lists and disabled options without selecting them", () => {
    const change = vi.fn();
    act(() => root.render(<Select onChange={change}><optgroup label="Unavailable" disabled><option value="one">One</option></optgroup></Select>));
    click(trigger());
    click(list()!.querySelector<HTMLElement>('[role="option"]')!);
    key("ArrowDown");
    key("Enter");
    expect(change).not.toHaveBeenCalled();
    expect(list()).not.toBeNull();
    act(() => root.render(<Select disabled onChange={change}>{choices}</Select>));
    expect(list()).toBeNull();
    click(trigger());
    expect(list()).toBeNull();
    act(() => root.render(<Select onChange={change} />));
    key("Enter");
    expect(list()?.textContent).toBe("No options available");
    key("Escape");
    expect(list()).toBeNull();
  });

  it("keeps parent click handlers isolated from portaled option picks and supports custom trigger handlers", () => {
    const parentClick = vi.fn();
    const customClick = vi.fn((event: React.MouseEvent<HTMLButtonElement>) => event.stopPropagation());
    act(() => root.render(<div onClick={parentClick}><Select id="approval-mode" aria-describedby="help" onClick={customClick}>{choices}</Select></div>));
    click(trigger());
    click(list()!.querySelector<HTMLElement>('[role="option"]')!);
    expect(customClick).toHaveBeenCalledOnce();
    expect(parentClick).not.toHaveBeenCalled();
    expect(trigger().id).toBe("approval-mode");
    expect(trigger().getAttribute("aria-describedby")).toBe("help");
  });

  it("preserves the highlighted value when options reorder, recovers when it disappears and reopens at the selected value", () => {
    const change = vi.fn();
    const render = (values: string[]) => act(() => root.render(<Select value="alpha" onChange={change}>
      {values.map(value => <option key={value} value={value}>{value}</option>)}
    </Select>));
    render(["alpha", "beta", "gamma"]);
    key("ArrowDown");
    key("ArrowDown");
    expect(activeLabel()).toBe("beta");
    render(["gamma", "alpha", "beta"]);
    expect(activeLabel()).toBe("beta");
    key("Enter");
    expect(change.mock.calls[0][0].target.value).toBe("beta");
    key("Enter");
    expect(activeLabel()).toBe("alpha");
    key("End");
    expect(activeLabel()).toBe("beta");
    render(["gamma", "alpha"]);
    expect(activeLabel()).toBe("alpha");
    key("Enter");
    expect(change).toHaveBeenCalledOnce();
  });

  it("retains a closing popup without accepting picks and cancels its exit when reopened", () => {
    setMotionPreference("full");
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const change = vi.fn();
    act(() => root.render(<Select value="alpha" onChange={change}>{choices}</Select>));
    click(trigger());
    expect(list()?.getAttribute("data-state")).toBe("open");
    expect(list()?.getAttribute("data-side")).toBe("bottom");
    key("Escape");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(list()?.getAttribute("data-state")).toBe("closing");
    expect(list()?.hasAttribute("inert")).toBe(true);
    expect(list()?.getAttribute("aria-hidden")).toBe("true");
    expect(list()?.style.pointerEvents).toBe("none");
    click(list()!.querySelector<HTMLElement>('[data-choice-index="3"]')!);
    expect(change).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger());
    act(() => vi.advanceTimersByTime(60));
    click(trigger());
    expect(list()?.hasAttribute("inert")).toBe(false);
    act(() => vi.advanceTimersByTime(120)); expect(list()).not.toBeNull();
    key("Tab");
    act(() => vi.advanceTimersByTime(120)); expect(list()).toBeNull();
  });
});
