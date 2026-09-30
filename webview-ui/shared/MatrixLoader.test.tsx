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
import { MatrixLoader, type MatrixLoaderProps } from "./MatrixLoader";

let root: Root;
let container: HTMLDivElement;
const render = (props: MatrixLoaderProps = {}) => act(() => root.render(<MatrixLoader {...props} />));
const dots = () => [...container.querySelectorAll<HTMLElement>(".t-matrix i")];
const delays = () => dots().map(dot => Number(dot.style.getPropertyValue("--d")));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("renders sixteen decorative dots with column scan delays by default", () => {
  render({ className: "compact-loader" });
  expect(dots()).toHaveLength(16);
  expect(delays()).toEqual([0, 120, 240, 360, 0, 120, 240, 360, 0, 120, 240, 360, 0, 120, 240, 360]);
  expect(container.querySelector(".t-matrix.compact-loader")?.getAttribute("data-variant")).toBe("scan");
  expect(container.querySelector(".t-matrix")?.getAttribute("aria-hidden")).toBe("true");
});

it("uses the sixteen-step shuffled twinkle sequence", () => {
  render({ variant: "twinkle" });
  expect(delays()).toEqual([450, 975, 75, 600, 1125, 225, 750, 0, 1050, 375, 825, 150, 525, 900, 300, 675]);
  expect(dots().every(dot => !dot.classList.contains("is-steady"))).toBe(true);
});

it("advances around the eight-dot orbit while leaving non-ring dots steady", () => {
  render({ variant: "orbit" });
  const orbit = [1, 2, 7, 11, 14, 13, 8, 4];
  expect(orbit.map(index => delays()[index])).toEqual([0, 150, 300, 450, 600, 750, 900, 1050]);
  expect(dots().filter(dot => dot.classList.contains("is-steady"))).toHaveLength(8);
  expect([5, 6, 9, 10].every(index => dots()[index].classList.contains("is-steady"))).toBe(true);
});

it("pulses the four inner dots first and the outer dots sixteen percent of a cycle later", () => {
  render({ variant: "pulse" });
  expect(delays()).toEqual([192, 192, 192, 192, 192, 0, 0, 192, 192, 0, 0, 192, 192, 192, 192, 192]);
});

it("hides only the corner dots in rounded variants without changing their sixteen-dot geometry", () => {
  render({ variant: "orbit", rounded: true });
  expect(dots()).toHaveLength(16);
  expect(dots().flatMap((dot, index) => dot.classList.contains("is-gap") ? [index] : [])).toEqual([0, 3, 12, 15]);
  render({ rounded: false });
  expect(container.querySelector(".is-gap")).toBeNull();
});
