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
import { ImagePreview } from "./ImagePreview";
import { setMotionPreference } from "./motionPreference";

const images = [
  { id: "first", name: "design.png", data: "data:image/png;base64,Zmlyc3Q=" },
  { id: "second", name: "details.webp", data: "data:image/webp;base64,c2Vjb25k" },
];
let root: Root, container: HTMLDivElement;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const button = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
const title = () => document.querySelector(".image-preview-name")?.textContent;
const click = (element: HTMLElement) => act(() => element.click());
const key = (value: string, shiftKey = false) => act(() => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true })));
function loadImage() {
  const image = document.querySelector<HTMLImageElement>(".image-preview-image")!;
  Object.defineProperties(image, { naturalWidth: { configurable: true, value: 1200 }, naturalHeight: { configurable: true, value: 800 } });
  act(() => image.dispatchEvent(new Event("load", { bubbles: false })));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setMotionPreference("reduced");
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount()); container.remove();
  setMotionPreference("full"); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

function Fixture({ data = images, initial = "first", parentClick = vi.fn(), parentKey = vi.fn() }: {
  data?: typeof images; initial?: string; parentClick?: () => void; parentKey?: () => void;
}) {
  const [active, setActive] = React.useState<string | null>(null);
  return <div onClick={parentClick} onKeyDown={parentKey}>
    <button id="opener" onClick={() => setActive(initial)}>Preview image</button>
    <ImagePreview images={data} activeId={active} onClose={() => setActive(null)} />
  </div>;
}
function openFixture(props?: React.ComponentProps<typeof Fixture>) {
  act(() => root.render(<Fixture {...props} />));
  const opener = container.querySelector<HTMLButtonElement>("#opener")!;
  act(() => opener.focus()); click(opener);
  return opener;
}

it("opens in a portal, traps focus and restores the trigger without scrolling on Escape", () => {
  const parentKey = vi.fn();
  const focus = vi.spyOn(HTMLElement.prototype, "focus");
  const opener = openFixture({ parentKey });
  expect(dialog()?.parentElement?.parentElement).toBe(document.body);
  expect(dialog()?.getAttribute("aria-modal")).toBe("true");
  expect(document.activeElement).toBe(button("Close image preview"));
  expect(container.inert).toBe(true);
  key("Tab", true);
  expect(document.activeElement).toBe(button("Next image"));
  key("Tab");
  expect(document.activeElement).toBe(button("Close image preview"));
  act(() => opener.focus());
  expect(document.activeElement).toBe(button("Close image preview"));
  key("Escape");
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect(container.inert).not.toBe(true);
  expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
  expect(parentKey).not.toHaveBeenCalled();
});

it("navigates by buttons and arrows, wraps at both ends and resets zoom/loading", () => {
  openFixture();
  expect(title()).toBe("design.png");
  expect(button("Show actual size").disabled).toBe(true);
  loadImage(); click(button("Show actual size"));
  expect(document.querySelector(".image-preview-stage")?.getAttribute("data-zoomed")).toBe("true");
  click(button("Next image"));
  expect(title()).toBe("details.webp");
  expect(button("Show actual size").disabled).toBe(true);
  expect(document.querySelector(".image-preview-stage")?.hasAttribute("data-zoomed")).toBe(false);
  key("ArrowRight"); expect(title()).toBe("design.png");
  key("ArrowLeft"); expect(title()).toBe("details.webp");
  click(button("Previous image")); expect(title()).toBe("design.png");
});

it("does not let preview interactions edit the underlying message and closes only on the backdrop", () => {
  const parentClick = vi.fn();
  openFixture({ parentClick }); parentClick.mockClear();
  click(document.querySelector<HTMLElement>(".image-preview-name")!);
  expect(dialog()).not.toBeNull();
  click(button("Next image"));
  expect(parentClick).not.toHaveBeenCalled();
  click(document.querySelector<HTMLElement>(".image-preview-backdrop")!);
  expect(dialog()).toBeNull();
  expect(parentClick).not.toHaveBeenCalled();
});

it("shows an error for failed or nonlocal images and recovers when navigating", () => {
  openFixture({ data: [...images, { id: "external", name: "remote.png", data: "https://example.test/private.png" }] });
  act(() => document.querySelector(".image-preview-image")!.dispatchEvent(new Event("error")));
  expect(dialog()?.textContent).toContain("This image could not be loaded.");
  click(button("Next image"));
  expect(dialog()?.textContent).toContain("Loading image…");
  loadImage();
  expect(dialog()?.textContent).not.toContain("Loading image…");
  expect(dialog()?.textContent).toContain("1200 × 800");
  click(button("Next image"));
  expect(dialog()?.textContent).toContain("This image could not be loaded.");
  expect(document.querySelector(".image-preview-image")).toBeNull();
});

it("keeps a closing preview for the exit animation while restoring focus immediately", () => {
  vi.useFakeTimers(); setMotionPreference("full");
  const opener = openFixture();
  click(button("Close image preview"));
  expect(document.querySelector(".image-preview-backdrop")?.getAttribute("data-exiting")).toBe("true");
  expect(document.activeElement).toBe(opener);
  act(() => vi.advanceTimersByTime(150));
  expect(dialog()).toBeNull();
  click(opener); click(button("Close image preview"));
  act(() => setMotionPreference("reduced"));
  expect(dialog()).toBeNull();
});

it("does not refocus or lose the selected image when the conversation rerenders", () => {
  const close = vi.fn();
  const render = () => act(() => root.render(<ImagePreview images={[...images]} activeId="first" onClose={() => close()} />));
  render(); loadImage();
  const next = button("Next image");
  act(() => next.focus()); click(next);
  render();
  expect(title()).toBe("details.webp");
  expect(document.activeElement).toBe(next);
  expect(close).not.toHaveBeenCalled();
});

it("reopens the requested attachment when a previous gallery is still animating closed", () => {
  vi.useFakeTimers(); setMotionPreference("full");
  const opener = openFixture();
  click(button("Next image")); expect(title()).toBe("details.webp");
  click(button("Close image preview"));
  act(() => vi.advanceTimersByTime(60));
  click(opener);
  expect(title()).toBe("design.png");
  expect(document.activeElement).toBe(button("Close image preview"));
  act(() => vi.advanceTimersByTime(150));
  expect(dialog()).not.toBeNull();
});

it("responds to a different selected attachment and safely closes when that attachment is removed", () => {
  const close = vi.fn();
  act(() => root.render(<ImagePreview images={images} activeId="first" onClose={close} />));
  act(() => root.render(<ImagePreview images={images} activeId="second" onClose={close} />));
  expect(title()).toBe("details.webp");
  act(() => root.render(<ImagePreview images={[]} activeId="second" onClose={close} />));
  expect(dialog()).toBeNull();
  expect(container.inert).not.toBe(true);
});
