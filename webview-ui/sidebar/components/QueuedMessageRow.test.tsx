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
import { QueuedMessageRow, type QueuedMessageRowProps } from "./QueuedMessageRow";
import { setMotionPreference } from "../../shared/motionPreference";

let root: Root, container: HTMLDivElement, props: QueuedMessageRowProps;
const trigger = () => container.querySelector<HTMLButtonElement>('[aria-label="More queued message actions"]')!;
const menu = () => document.querySelector<HTMLDivElement>(".queue-menu");
const items = () => [...document.querySelectorAll<HTMLButtonElement>('.queue-menu [role="menuitem"]')];
const click = (element: HTMLElement) => act(() => element.click());
const render = () => act(() => root.render(<QueuedMessageRow {...props} />));
function key(element: HTMLElement, key: string) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  act(() => element.dispatchEvent(event));
  return event;
}

beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setMotionPreference("reduced");
  props = {
    item: { id: "request-2", text: "Check the error handling", status: "queued", createdAt: 1 },
    running: true, canMoveUp: true,
    onSteer: vi.fn(), onRun: vi.fn(), onEdit: vi.fn(), onRemove: vi.fn(), onMoveUp: vi.fn(),
  };
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  render();
});
afterEach(() => {
  act(() => root.unmount()); container.remove(); setMotionPreference("full");
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

it("keeps only Steer, remove, and more in the running row and dispatches secondary actions from its menu", () => {
  expect(container.querySelectorAll("button")).toHaveLength(3);
  click(container.querySelector<HTMLButtonElement>(".q-btn-steer")!);
  expect(props.onSteer).toHaveBeenCalledOnce(); expect(props.onRun).not.toHaveBeenCalled();
  click(trigger());
  expect(menu()?.parentElement).toBe(document.body);
  expect(items().map(item => item.textContent)).toEqual(["Send now", "Edit message", "Move earlier"]);
  click(items()[0]); expect(props.onRun).toHaveBeenCalledOnce(); expect(menu()).toBeNull();
  click(trigger()); click(items()[1]); expect(props.onEdit).toHaveBeenCalledOnce();
  click(trigger()); click(items()[2]); expect(props.onMoveUp).toHaveBeenCalledOnce();
  click(container.querySelector<HTMLButtonElement>('[aria-label="Remove queued message"]')!);
  expect(props.onRemove).toHaveBeenCalledOnce();
});

it("prevents attachment-only or empty messages from steering while preserving Send now", () => {
  props.item = { ...props.item, text: "", attachments: [{ id: "image-1", kind: "image", name: "diagram.png", mime: "image/png", data: "data:image/png;base64,a" }] };
  render();
  expect(container.querySelector<HTMLButtonElement>(".q-btn-steer")?.disabled).toBe(true);
  expect(container.querySelector(".queue-text")?.textContent).toBe("1 attachment");
  click(container.querySelector<HTMLButtonElement>(".q-btn-steer")!);
  expect(props.onSteer).not.toHaveBeenCalled();
  click(trigger()); click(items()[0]); expect(props.onRun).toHaveBeenCalledOnce();
  props.item = { ...props.item, attachments: undefined }; render();
  expect(container.querySelector<HTMLButtonElement>(".q-btn-steer")?.disabled).toBe(true);
});

it("exposes direct Send or Resume appropriately and omits unavailable move actions", () => {
  props.running = false; props.canMoveUp = false; render();
  expect(container.querySelector(".q-btn-steer")).toBeNull();
  expect(container.querySelector(".q-btn-primary")?.textContent).toBe("Send");
  click(trigger()); expect(items().map(item => item.textContent)).toEqual(["Edit message"]);
  key(items()[0], "Escape");
  props.item = { ...props.item, status: "interrupted" }; render();
  expect(container.querySelector(".queue-text")?.textContent).toBe("Interrupted: Check the error handling");
  click(container.querySelector<HTMLButtonElement>('[aria-label="Resume interrupted request"]')!);
  expect(props.onRun).toHaveBeenCalledOnce();
  props.item = { ...props.item, status: "failed", error: "Connection closed" }; render();
  expect(container.querySelector(".queue-text")?.textContent).toBe("Needs attention: Check the error handling");
  expect(container.querySelector(".queue-text")?.getAttribute("title")).toBe("Connection closed");
});

it("supports keyboard focus, Escape, Tab, and outside dismissal without trapping focus", () => {
  key(trigger(), "ArrowUp"); expect(document.activeElement).toBe(items()[2]);
  key(items()[2], "ArrowDown"); expect(document.activeElement).toBe(items()[0]);
  key(items()[0], "ArrowUp"); expect(document.activeElement).toBe(items()[2]);
  key(items()[2], "Home"); expect(document.activeElement).toBe(items()[0]);
  key(items()[0], "End"); expect(document.activeElement).toBe(items()[2]);
  key(items()[2], "Escape"); expect(menu()).toBeNull(); expect(document.activeElement).toBe(trigger());
  key(trigger(), "ArrowDown"); expect(document.activeElement).toBe(items()[0]);
  expect(key(items()[0], "Tab").defaultPrevented).toBe(false);
  expect(menu()).toBeNull(); expect(document.activeElement).toBe(trigger());
  const outside = document.createElement("button"); document.body.appendChild(outside);
  try {
    click(trigger()); act(() => outside.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(menu()).toBeNull();
    click(trigger()); act(() => outside.focus());
    expect(menu()).toBeNull(); expect(document.activeElement).toBe(outside);
  } finally { outside.remove(); }
});

it("positions the menu before focusing its first item", () => {
  const originalFocus = HTMLElement.prototype.focus;
  vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
    if (this.closest<HTMLElement>(".queue-menu")?.style.visibility === "hidden") return;
    originalFocus.call(this, options);
  });
  click(trigger());
  expect(menu()?.style.visibility).toBe("visible");
  expect(document.activeElement).toBe(items()[0]);
});

it("retains an inert closing menu, rejects actions during exit, and safely reopens", () => {
  act(() => setMotionPreference("full"));
  click(trigger()); key(items()[0], "Escape");
  expect(menu()?.dataset.state).toBe("closing"); expect(menu()?.hasAttribute("inert")).toBe(true);
  expect(menu()?.getAttribute("aria-hidden")).toBe("true"); expect(menu()?.style.pointerEvents).toBe("none");
  click(items()[0]); expect(props.onRun).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(60)); click(trigger());
  expect(menu()?.dataset.state).toBe("open"); expect(menu()?.hasAttribute("inert")).toBe(false);
  act(() => vi.advanceTimersByTime(100)); expect(menu()).not.toBeNull();
  key(items()[0], "Escape");
  act(() => vi.advanceTimersByTime(119)); expect(menu()).not.toBeNull();
  act(() => vi.advanceTimersByTime(1)); expect(menu()).toBeNull();
});

it("anchors above the row, stays inside narrow viewports, and adjusts after a resize or scroll", () => {
  vi.stubGlobal("innerWidth", 375); vi.stubGlobal("innerHeight", 700);
  let right = 359, top = 650;
  vi.spyOn(trigger(), "getBoundingClientRect").mockImplementation(() => ({ left: right - 24, right, top, bottom: top + 24,
    width: 24, height: 24, x: right - 24, y: top, toJSON() {} }));
  click(trigger());
  expect(menu()?.dataset.side).toBe("top"); expect(menu()?.style.left).toBe("167px"); expect(menu()?.style.top).toBe("542px");
  vi.stubGlobal("innerWidth", 180); act(() => window.dispatchEvent(new Event("resize")));
  expect(menu()?.style.width).toBe("164px"); expect(menu()?.style.left).toBe("8px");
  right = 100; top = 20; act(() => window.dispatchEvent(new Event("scroll")));
  expect(menu()?.dataset.side).toBe("bottom"); expect(menu()?.style.top).toBe("48px");
});
