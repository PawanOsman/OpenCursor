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
import { App } from "./App";
import { vscode } from "../shared/vscode";

vi.mock("../shared/vscode", () => ({ vscode: { postMessage: vi.fn() } }));
let root: Root;
let container: HTMLDivElement;
const usage = { "fixture-model": { promptTokens: 100, completionTokens: 20, requests: 1, lastUsed: 1 } };
function receive(data: unknown) { act(() => window.dispatchEvent(new MessageEvent("message", { data }))); }
function button(label: string): HTMLButtonElement {
  const element = [...container.querySelectorAll("button")].find(item => item.textContent?.trim() === label);
  if (!element) throw new Error(`Missing button: ${label}`);
  return element;
}
function click(label: string) { act(() => button(label).click()); }
function posted(type: string): any[] { return vi.mocked(vscode.postMessage).mock.calls.map(([message]) => message as any).filter(message => message.type === type); }
function latest(type: string) { const messages = posted(type); return messages[messages.length - 1]; }
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<App />));
  receive({ type: "usageData", usage });
  click("Usage & Quota");
  vi.mocked(vscode.postMessage).mockClear();
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("posts Reset without browser dialogs and changes data only after a committed host update", () => {
  const confirm = vi.fn(() => { throw new Error("Browser dialogs unavailable"); });
  vi.stubGlobal("confirm", confirm);
  click("Reset Usage");
  const request = latest("resetUsage");
  expect(request.requestId).toEqual(expect.any(String));
  expect(confirm).not.toHaveBeenCalled();
  expect(button("Awaiting reset…").disabled).toBe(true);
  expect(button("Refresh").disabled).toBe(true);
  expect(container.textContent).toContain("fixture-model");
  receive({ type: "usageActionResult", requestId: request.requestId, action: "reset", status: "cancelled" });
  expect(container.textContent).toContain("Usage reset cancelled.");
  expect(container.textContent).toContain("fixture-model");
  click("Reset Usage");
  const next = latest("resetUsage");
  receive({ type: "usageActionResult", requestId: next.requestId, action: "reset", status: "success" });
  expect(container.textContent).toContain("fixture-model");
  receive({ type: "usageData", usage: {} });
  expect(container.textContent).toContain("No usage recorded yet");
  expect(button("Reset Usage").disabled).toBe(true);
});

it("refreshes local usage and visible quotas with independent outcome feedback", () => {
  receive({ type: "oauthStatus", status: { accounts: [{ id: "account", kind: "codex" }], errors: {} } });
  const initial = latest("oauthLimits");
  receive({ type: "oauthLimits", id: "account", requestId: initial.requestId, limits: [{ label: "Five-hour", remaining: 80, limit: 100 }] });
  click("Refresh");
  const local = latest("getUsage");
  const quota = latest("oauthLimits");
  expect(quota.requestId).not.toBe(initial.requestId);
  expect(button("Refreshing…").disabled).toBe(true);
  act(() => button("Refreshing…").click());
  expect(posted("getUsage")).toHaveLength(1);
  receive({ type: "usageData", usage });
  receive({ type: "usageActionResult", requestId: local.requestId, action: "refresh", status: "success" });
  expect(container.textContent).toContain("Local usage refreshed.");
  expect(button("Refresh").disabled).toBe(false);
  receive({ type: "oauthLimits", id: "account", requestId: quota.requestId, error: "Quota service unavailable" });
  expect(container.textContent).toContain("Quota service unavailable");
  expect(container.textContent).toContain("80% left");
  expect(container.textContent).not.toContain("All quotas refreshed");
});

it("recovers from missing replies and ignores stale action acknowledgements", () => {
  click("Refresh");
  const old = latest("getUsage");
  act(() => vi.advanceTimersByTime(30_000));
  expect(container.textContent).toContain("No response received.");
  expect(button("Refresh").disabled).toBe(false);
  click("Refresh");
  const current = latest("getUsage");
  receive({ type: "usageActionResult", requestId: old.requestId, action: "refresh", status: "success" });
  expect(button("Refreshing…").disabled).toBe(true);
  receive({ type: "usageActionResult", requestId: current.requestId, action: "refresh", status: "error", error: "Storage read failed" });
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Storage read failed");
  expect(container.textContent).toContain("fixture-model");
  expect(button("Refresh").disabled).toBe(false);
});

it("renders committed usage pushes while the page stays open", () => {
  receive({ type: "usageData", usage: { ...usage, "new-model": { promptTokens: 30, completionTokens: 4, requests: 1, lastUsed: 2 } } });
  expect(container.textContent).toContain("new-model");
  expect(posted("getUsage")).toHaveLength(0);
});

it("preserves model options changed elsewhere when saving an unrelated setting", () => {
  const speed = { key: "speed", label: "Speed", type: "select", values: ["standard", "fast"], value: "standard" };
  receive({ type: "features", features: { trackUsage: true, modelOptions: { "openai:gpt-6-sol": [speed] } } });
  // The sidebar has since saved Fast, without reloading this settings view.
  let hostFeatures = { trackUsage: true, modelOptions: { "openai:gpt-6-sol": [{ ...speed, value: "fast" }] } };
  const savePatch = (message: any) => {
    if (message.type === "saveFeatures") hostFeatures = { ...hostFeatures, ...message.features };
  };
  vi.mocked(vscode.postMessage).mockImplementationOnce(savePatch).mockImplementationOnce(savePatch);
  const trackUsage = container.querySelector<HTMLInputElement>('[aria-label="Track Usage"]')!;
  act(() => trackUsage.click());
  expect(trackUsage.checked).toBe(false);
  expect(latest("saveFeatures").features).toEqual({ trackUsage: false });
  expect(hostFeatures.modelOptions["openai:gpt-6-sol"][0].value).toBe("fast");
  act(() => trackUsage.click());
  expect(trackUsage.checked).toBe(true);
  expect(hostFeatures.trackUsage).toBe(true);
  expect(hostFeatures.modelOptions["openai:gpt-6-sol"][0].value).toBe("fast");
});
