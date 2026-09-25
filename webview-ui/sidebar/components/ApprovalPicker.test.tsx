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
import { ApprovalPicker, approvalPreset } from "./ApprovalPicker";
import { vscode } from "../../shared/vscode";
import { setMotionPreference } from "../../shared/motionPreference";
import type { ApprovalMode, ApprovalPolicy } from "../types";

vi.mock("../../shared/vscode", () => ({ vscode: { postMessage: vi.fn() } }));
let root: Root, container: HTMLDivElement;
const policy = (mode: ApprovalMode = "ask"): ApprovalPolicy => {
  const rule = () => ({ mode, allowlist: [], denylist: [] });
  return { shell: rule(), edits: rule(), delete: rule(), mcp: rule(), web: rule(), outside: rule() };
};
const trigger = () => container.querySelector("button")!;
const items = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
function key(target: HTMLElement, key: string) {
  act(() => target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
}
beforeEach(() => {
  setMotionPreference("reduced");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks(); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); setMotionPreference("full"); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("classifies mixed, denied and patterned permissions as Custom", () => {
  expect(approvalPreset()).toBeUndefined();
  for (const mode of ["ask", "review", "allow"] as const) expect(approvalPreset(policy(mode))).toBe(mode);
  expect(approvalPreset(policy("deny"))).toBe("custom");
  const mixed = policy("allow"); mixed.outside.mode = "ask";
  expect(approvalPreset(mixed)).toBe("custom");
  for (const list of ["allowlist", "denylist"] as const) {
    const patterned = policy("allow"); patterned.shell[list] = ["git push"];
    expect(approvalPreset(patterned)).toBe("custom");
  }
});

it("waits for host policy and changes it only after an explicit selection", () => {
  act(() => root.render(<ApprovalPicker />));
  expect(trigger().disabled).toBe(true);
  expect(trigger().textContent).toContain("Permissions");
  expect(vscode.postMessage).not.toHaveBeenCalled();
  act(() => root.render(<ApprovalPicker policy={policy()} />));
  act(() => trigger().click());
  expect(items()[0].getAttribute("aria-checked")).toBe("true");
  act(() => items()[2].click());
  expect(vscode.postMessage).toHaveBeenCalledTimes(1);
  expect(vscode.postMessage).toHaveBeenCalledWith({ type: "setApprovalPreset", preset: "allow" });
  expect(items()).toHaveLength(0);
  expect(document.activeElement).toBe(trigger());
  expect(trigger().textContent).toContain("Ask for approval");
  act(() => root.render(<ApprovalPicker policy={policy("allow")} />));
  expect(trigger().textContent).toContain("Full access");
});

it("supports keyboard navigation, Escape and outside dismissal without changing policy", () => {
  act(() => root.render(<ApprovalPicker policy={policy("review")} />));
  key(trigger(), "ArrowDown");
  expect(document.activeElement).toBe(items()[1]);
  key(items()[1], "ArrowDown"); expect(document.activeElement).toBe(items()[2]);
  key(items()[2], "Home"); expect(document.activeElement).toBe(items()[0]);
  key(items()[0], "ArrowUp"); expect(document.activeElement).toBe(items()[3]);
  key(items()[3], "Escape");
  expect(items()).toHaveLength(0); expect(document.activeElement).toBe(trigger());
  act(() => trigger().click());
  act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(items()).toHaveLength(0); expect(vscode.postMessage).not.toHaveBeenCalled();
});

it("opens the real custom policy settings and respects disabled state", () => {
  const custom = policy("allow"); custom.web.denylist = ["*.example.test"];
  act(() => root.render(<ApprovalPicker policy={custom} />));
  expect(trigger().textContent).toContain("Custom");
  act(() => trigger().click());
  expect(document.activeElement).toBe(items()[3]);
  act(() => items()[3].click());
  expect(vscode.postMessage).toHaveBeenCalledTimes(1);
  expect(vscode.postMessage).toHaveBeenCalledWith({ type: "openSettings", section: "behavior" });
  act(() => trigger().click());
  act(() => root.render(<ApprovalPicker policy={custom} disabled />));
  expect(items()).toHaveLength(0); expect(trigger().disabled).toBe(true);
});

it("closes permissions immediately while retaining an inert surface for its exit animation", () => {
  setMotionPreference("full");
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  act(() => root.render(<ApprovalPicker policy={policy()} />));
  act(() => trigger().click());
  const menu = document.querySelector<HTMLElement>('.approval-menu')!;
  expect(menu.dataset.state).toBe('open');
  expect(menu.dataset.side).toBe('bottom');
  key(items()[0], 'Escape');
  expect(trigger().getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger());
  expect(menu.dataset.state).toBe('closing');
  expect(menu.hasAttribute('inert')).toBe(true);
  expect(menu.getAttribute('aria-hidden')).toBe('true');
  expect(menu.style.pointerEvents).toBe('none');
  act(() => items()[2].click());
  act(() => menu.querySelector<HTMLButtonElement>('.approval-menu-learn')!.click());
  expect(vscode.postMessage).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(60));
  act(() => trigger().click());
  expect(document.querySelector('.approval-menu')).toBe(menu);
  expect(menu.dataset.state).toBe('open');
  expect(menu.hasAttribute('inert')).toBe(false);
  expect(document.activeElement).toBe(items()[0]);
  act(() => vi.advanceTimersByTime(120));
  expect(document.querySelector('.approval-menu')).toBe(menu);
  key(items()[0], 'Escape');
  act(() => vi.advanceTimersByTime(120));
  expect(document.querySelector('.approval-menu')).toBeNull();
});
