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
import { DocsSection, type DocSourceInfo, type DocsStatus } from "./DocsSection";
import { vscode } from "../shared/vscode";
vi.mock("../shared/vscode", () => ({ vscode: { postMessage: vi.fn() } }));

let container: HTMLDivElement;
let root: Root;
const source: DocSourceInfo = { id: "reference", name: "Reference", url: "https://example.test/docs", pages: 10, chunks: 30, indexedAt: 1000, resolvedScope: "/docs" };
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const requests = () => vi.mocked(vscode.postMessage).mock.calls.map(([message]) => message as Record<string, unknown>);
const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === label || item.getAttribute("aria-label") === label)!;
const click = (label: string) => act(() => button(label).click());
const reply = (data: Record<string, unknown>) => act(() => window.dispatchEvent(new MessageEvent("message", { data })));
function render(docs: DocSourceInfo[] = [], status: DocsStatus = { done: 0, total: 0 }) { act(() => root.render(<DocsSection docs={docs} status={status} />)); }
function input(label: string, value: string) {
  const node = [...container.querySelectorAll<HTMLLabelElement>("label")].find(item => item.textContent?.startsWith(label))!;
  const field = document.getElementById(node.htmlFor) as HTMLInputElement | HTMLTextAreaElement;
  act(() => {
    Object.getOwnPropertyDescriptor(field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("documentation indexing controls", () => {
  it("sends a focused plan configuration and retains the form until correlated host success", () => {
    render(); click(" Add Doc");
    input("Name", "Streaming guide"); input("Documentation URL", "https://example.test/docs"); input("Topics to prioritize", "SSE, retries");
    click(" Advanced limits"); input("Section path", "/docs"); input("Page budget", "30"); input("Excluded paths", "/docs/archive\n/docs/deprecated");
    click("Add and index");
    expect(requests()[0]).toMatchObject({ type: "addDoc", name: "Streaming guide", scope: "section", focus: "SSE, retries", useAi: true, scopePath: "/docs", maxPages: 30, excludePaths: ["/docs/archive", "/docs/deprecated"] });
    expect(container.querySelector("form")).not.toBeNull();
    reply({ type: "docActionResult", requestId: "another-form", ok: true });
    expect(container.querySelector("form")).not.toBeNull();
    reply({ type: "docActionResult", requestId: requests()[0].requestId, ok: false, error: "Scope is outside the documentation URL" });
    expect(container.textContent).toContain("Scope is outside");
    expect(button("Add and index").disabled).toBe(false);
    click("Add and index"); reply({ type: "docActionResult", requestId: requests()[1].requestId, ok: true });
    expect(container.querySelector("form")).toBeNull();
  });
  it("blocks oversized budgets and non-HTTP URLs before posting", () => {
    render(); click(" Add Doc"); input("Name", "Docs"); input("Documentation URL", "file:///private/docs");
    expect(button("Add and index").disabled).toBe(true);
    input("Documentation URL", "https://example.test/docs"); click(" Advanced limits"); input("Page budget", "100000");
    expect(button("Add and index").disabled).toBe(true);
    expect(requests()).toHaveLength(0);
  });
  it("shows phase and bounded progress, prevents edits, and sends cancellation once", () => {
    render([source], { sourceId: source.id, indexing: source.id, phase: "indexing", done: 4, total: 20, fetched: 7, skipped: 3, scope: "/docs/api" });
    expect(container.textContent).toContain("Indexing selected pages");
    expect(container.textContent).toContain("4 / 20 selected pages processed · 7 fetched · 0 indexed · 3 skipped");
    expect(container.textContent).toContain("/docs/api");
    expect(button("Edit Reference").disabled).toBe(true);
    expect(button("Re-index Reference").disabled).toBe(true);
    click("Cancel"); expect(requests()).toEqual([{ type: "cancelDocIndex", id: source.id }]);
    expect(button("Cancelling…").disabled).toBe(true);
    render([source], { sourceId: source.id, phase: "cancelled", done: 4, total: 20, stopReason: "Stopped by user" });
    expect(container.textContent).toContain("Cancelled — previous index kept");
    expect(container.textContent).toContain("Stopped by user");
  });
  it("does not show another source's terminal status on a saved index", () => {
    render([source], { sourceId: "another-source", phase: "cancelled", done: 0, total: 0, scope: "/unrelated", stopReason: "Stopped by user" });
    expect(container.textContent).toContain("10 pages · 30 chunks");
    expect(container.textContent).not.toContain("Stopped by user");
    expect(container.textContent).not.toContain("/unrelated");
  });
  it("shows one current failure explanation without duplicating the stop reason", () => {
    const error = "No usable documentation was found. The source did not return readable content.";
    render([{ ...source, error: "Previous error" }], { sourceId: source.id, phase: "error", done: 0, total: 1, error, stopReason: error });
    expect(container.textContent?.split(error)).toHaveLength(2);
    expect(container.textContent).not.toContain("Previous error");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(error);
    expect(container.textContent).toContain("Indexing failed — previous index kept");
  });
  it("keeps a saved failure explanation once when live status belongs to another source", () => {
    const error = "The server returned HTTP 503.";
    render([{ ...source, error, stopReason: error }], { sourceId: "other", phase: "error", done: 0, total: 0, error: "Unrelated failure" });
    expect(container.textContent?.split(error)).toHaveLength(2);
    expect(container.textContent).not.toContain("Unrelated failure");
  });
  it("opens at the latest log and follows updates only while the user stays at the bottom", () => {
    render([source], { sourceId: source.id, indexing: source.id, phase: "indexing", done: 1, total: 20 });
    click("Indexing logs for Reference");
    const viewport = container.querySelector<HTMLElement>('[role="log"]')!;
    let height = 900;
    Object.defineProperty(viewport, "scrollHeight", { get: () => height });
    Object.defineProperty(viewport, "clientHeight", { value: 200 });
    reply({ type: "docLogs", id: source.id, lines: ["Started", "Newest line"] });
    expect(viewport.scrollTop).toBe(900);
    act(() => { viewport.scrollTop = 100; viewport.dispatchEvent(new Event("scroll", { bubbles: true })); });
    height = 1000;
    reply({ type: "docLogs", id: source.id, lines: ["Started", "Newest line", "Another line"] });
    expect(viewport.scrollTop).toBe(100);
    act(() => { viewport.scrollTop = 800; viewport.dispatchEvent(new Event("scroll", { bubbles: true })); });
    height = 1100;
    reply({ type: "docLogs", id: source.id, lines: ["Started", "Newest line", "Another line", "FAILED Final explanation"] });
    expect(viewport.scrollTop).toBe(1100);
    act(() => { viewport.scrollTop = 100; viewport.dispatchEvent(new Event("scroll", { bubbles: true })); });
    click("Indexing logs for Reference"); click("Indexing logs for Reference");
    expect(viewport.scrollTop).toBe(1100);
  });
});
