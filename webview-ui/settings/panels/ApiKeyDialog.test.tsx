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
import { ApiKeyDialog } from "./ApiKeyDialog";
import { vscode } from "../../shared/vscode";
import type { ProviderApiKey, ProviderConfig } from "../features";
vi.mock("../../shared/vscode", () => ({ vscode: { postMessage: vi.fn() } }));

const provider: ProviderConfig = { id: "popular:deepseek", kind: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" };
const credential: ProviderApiKey = { id: `${provider.id}:key:fixture`, label: "Work", hasKey: true };
let container: HTMLDivElement;
let root: Root;
const close = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function render(saved?: ProviderApiKey) { act(() => root.render(<ApiKeyDialog provider={provider} credential={saved} onClose={close} onBack={vi.fn()} />)); }
function button(text: string) { return [...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === text)!; }
function click(text: string) { act(() => button(text).click()); }
function typeKey(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="password"]')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
function requests() { return vi.mocked(vscode.postMessage).mock.calls.map(([message]) => message as Record<string, unknown>); }
function reply(message: Record<string, unknown>) { act(() => window.dispatchEvent(new MessageEvent("message", { data: message }))); }

describe("API key connection testing", () => {
  it("does not claim a static catalog proves the credential is valid", () => {
    render(); typeKey("fixture-key"); click("Test connection");
    reply({ ...requests()[0], type: "modelsFetched", models: ["one"], verified: false });
    expect(container.textContent).toContain("1 catalog models available; connection not verified");
  });

  it("requires a complete tenant endpoint for Azure before storing its first key", () => {
    act(() => root.render(<ApiKeyDialog provider={{ id: "popular:azure", kind: "azure", name: "Azure", baseUrl: "https://{resource}.openai.azure.com/openai/v1" }} onClose={close} onBack={vi.fn()} />));
    const input = container.querySelector<HTMLInputElement>('[aria-label="Base URL"]')!;
    expect(input.readOnly).toBe(false);
    typeKey("azure-key-fixture"); click("Add key");
    expect(requests()).toHaveLength(0);
    expect(container.textContent).toContain("without placeholders");
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "https://tenant.openai.azure.com/openai/v1"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    click("Add key");
    expect(requests()).toEqual([expect.objectContaining({ action: "add", kind: "azure", baseUrl: "https://tenant.openai.azure.com/openai/v1", apiKey: "azure-key-fixture" })]);
  });
  it("tests a typed key without creating or saving a provider", () => {
    render(); expect(button("Test connection").disabled).toBe(true);
    typeKey(" private-fixture-key "); click("Test connection");
    expect(requests()).toEqual([expect.objectContaining({ type: "fetchModels", providerId: provider.id, apiBaseUrl: provider.baseUrl, apiKey: "private-fixture-key", anthropic: false })]);
    expect(requests()[0]).not.toHaveProperty("keyId");
    expect(button("Testing…").disabled).toBe(true);
    reply({ ...requests()[0], type: "modelsFetched", models: ["model-a", "model-b"] });
    expect(container.textContent).toContain("2 models available");
    expect(container.textContent).not.toContain("private-fixture-key");
    expect(close).not.toHaveBeenCalled();
  });

  it("tests the exact saved credential when no replacement key is typed", () => {
    render(credential); click("Test connection");
    expect(requests()[0]).toMatchObject({ type: "fetchModels", providerId: provider.id, keyId: credential.id });
    expect(requests()[0]).not.toHaveProperty("apiKey");
  });

  it("uses an edited raw key instead of the saved credential", () => {
    render(credential); typeKey("replacement"); click("Test connection");
    expect(requests()[0]).toMatchObject({ apiKey: "replacement" });
    expect(requests()[0]).not.toHaveProperty("keyId");
  });

  it("ignores foreign or stale responses after a key changes", () => {
    render(); typeKey("first"); click("Test connection"); const first = requests()[0];
    reply({ ...first, type: "modelsFetched", providerId: "foreign", models: ["wrong"] });
    expect(button("Testing…")).toBeDefined();
    typeKey("second"); reply({ ...first, type: "modelsFetched", models: ["old"] });
    expect(container.textContent).not.toContain("models available");
    click("Test connection"); const second = requests()[1];
    reply({ ...first, type: "modelsFetched", error: "stale failure" });
    expect(container.textContent).not.toContain("stale failure");
    reply({ ...second, type: "modelsFetched", error: "Invalid second credential" });
    expect(container.textContent).toContain("Invalid [redacted] credential");
    expect(container.textContent).not.toContain("Invalid second");
  });

  it("times out safely and allows a new correlated test", () => {
    render(credential); click("Test connection"); const first = requests()[0];
    act(() => vi.advanceTimersByTime(30_000));
    expect(container.textContent).toContain("Connection test did not respond");
    expect(button("Test connection").disabled).toBe(false);
    click("Test connection"); const second = requests()[1];
    reply({ ...first, type: "modelsFetched", models: ["old"] });
    expect(button("Testing…")).toBeDefined();
    reply({ ...second, type: "modelsFetched", models: [] });
    expect(container.textContent).toContain("0 models available");
  });

  it("invalidates a running test when saving starts and disables tests until save resolves", async () => {
    render(); typeKey("new-key"); click("Test connection"); const test = requests()[0];
    click("Add key");
    expect(button("Test connection").disabled).toBe(true);
    reply({ ...test, type: "modelsFetched", models: ["late"] });
    expect(container.textContent).not.toContain("models available");
    const save = requests()[1];
    await act(async () => window.dispatchEvent(new MessageEvent("message", { data: { type: "providerKeyActionResult", requestId: save.requestId, ok: false, error: "Could not save" } })));
    expect(button("Test connection").disabled).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });
});
