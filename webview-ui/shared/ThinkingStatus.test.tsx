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
import { ThinkingStatus } from "./ThinkingStatus";

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("./motionPreference", () => ({ useReducedMotion: () => motion.reduced }));

let root: Root;
let container: HTMLDivElement;
const render = (text: string) => act(() => root.render(<ThinkingStatus text={text} className="test-status" />));
const lines = () => [...container.querySelectorAll<HTMLElement>(".t-think-text")];
const advance = (time: number) => act(() => vi.advanceTimersByTime(time));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  motion.reduced = false;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("renders the actual initial status with synchronized shimmer text and a decorative matrix", () => {
  render("Thinking…");
  expect(container.querySelector(".activity-status.test-status")).not.toBeNull();
  expect(container.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Thinking…");
  expect(lines()).toHaveLength(1);
  expect(lines()[0].textContent).toBe("Thinking…");
  expect(lines()[0].dataset.text).toBe("Thinking…");
  expect(lines()[0].className).toBe("t-think-text");
  expect(container.querySelectorAll(".t-matrix i")).toHaveLength(16);
  expect(container.querySelector(".t-matrix")?.getAttribute("aria-hidden")).toBe("true");
  expect(vi.getTimerCount()).toBe(0);
});

it("exits the previous copy, releases the incoming copy after the gap, and removes the old line after its swap", () => {
  render("Thinking…");
  const previous = lines()[0];
  render("Reading files…");
  expect(lines()).toHaveLength(2);
  expect(lines()[0]).toBe(previous);
  expect(previous.classList.contains("is-exit")).toBe(true);
  expect(lines()[1].classList.contains("is-enter-start")).toBe(true);
  expect(lines()[1].dataset.text).toBe("Reading files…");
  advance(49);
  expect(lines()[1].classList.contains("is-enter-start")).toBe(true);
  advance(1);
  expect(lines()[1].classList.contains("is-enter-start")).toBe(false);
  advance(149);
  expect(lines()).toHaveLength(2);
  advance(1);
  expect(lines()).toHaveLength(1);
  expect(lines()[0].textContent).toBe("Reading files…");
  expect(lines()[0].dataset.text).toBe(lines()[0].textContent);
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps the last visible copy while rapid updates replace pending text and cancel stale cleanup", () => {
  render("Thinking…");
  render("Reading files…");
  advance(25);
  render("Running tests…");
  expect(lines()).toHaveLength(2);
  expect(lines()[0].textContent).toBe("Thinking…");
  expect(lines()[1].textContent).toBe("Running tests…");
  expect(container.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Running tests…");
  advance(50);
  render("Checking results…");
  expect(lines()[0].textContent).toBe("Running tests…");
  advance(500);
  expect(lines()).toHaveLength(1);
  expect(lines()[0].textContent).toBe("Checking results…");
  expect(lines()[0].dataset.text).toBe("Checking results…");
});

it("does not cycle invented labels or restart a transition when the same status is rendered", () => {
  render("Waiting for approval…");
  advance(10000);
  expect(lines()[0].textContent).toBe("Waiting for approval…");
  render("Running tests…");
  advance(30);
  render("Running tests…");
  advance(20);
  expect(lines()[1].classList.contains("is-enter-start")).toBe(false);
  advance(150);
  expect(lines()).toHaveLength(1);
});

it("measures label width instead of character count and retains the widest sizer", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const width = this.classList.contains("t-think-measure") ? this.textContent === "WWW" ? 42 : 24 : 0;
    return { x: 0, y: 0, top: 0, left: 0, bottom: 16, right: width, height: 16, width, toJSON: () => ({}) };
  });
  render("iiiiii");
  expect((container.querySelector(".t-think-sizer") as HTMLElement).style.width).toBe("24px");
  render("WWW");
  expect((container.querySelector(".t-think-sizer") as HTMLElement).style.width).toBe("42px");
  render("i");
  expect(container.querySelector(".t-think-sizer")?.textContent).toBe("WWW");
  expect((container.querySelector(".t-think-sizer") as HTMLElement).style.width).toBe("42px");
});

it("switches directly to the current text in reduced motion and cancels any pending swap", () => {
  render("Thinking…");
  render("Reading files…");
  expect(vi.getTimerCount()).toBe(2);
  motion.reduced = true;
  render("Reading files…");
  expect(lines()).toHaveLength(1);
  expect(lines()[0].textContent).toBe("Reading files…");
  expect(lines()[0].className).toBe("t-think-text");
  expect(vi.getTimerCount()).toBe(0);
  render("Running tests…");
  expect(lines()[0].textContent).toBe("Running tests…");
  expect(vi.getTimerCount()).toBe(0);
});

it("cleans both timers when a status is removed during its transition", () => {
  render("Thinking…");
  render("Reading files…");
  expect(vi.getTimerCount()).toBe(2);
  act(() => root.render(null));
  expect(vi.getTimerCount()).toBe(0);
  advance(500);
  expect(container.childElementCount).toBe(0);
});

it("exposes exactly one current status as live-region content throughout a swap", () => {
  const announced = () => [...container.querySelector('[role="status"]')!.children]
    .filter(element => element.getAttribute("aria-hidden") !== "true");
  render("Thinking");
  expect(announced().map(element => element.textContent)).toEqual(["Thinking"]);
  render("Reading files");
  expect(lines()).toHaveLength(2);
  expect(announced().map(element => element.textContent)).toEqual(["Reading files"]);
  expect(lines().every(line => line.getAttribute("aria-hidden") === "true")).toBe(true);
  motion.reduced = true;
  render("Running tests");
  expect(announced().map(element => element.textContent)).toEqual(["Running tests"]);
  expect(container.querySelector('.t-think-announcement')?.hasAttribute("aria-hidden")).toBe(false);
});
