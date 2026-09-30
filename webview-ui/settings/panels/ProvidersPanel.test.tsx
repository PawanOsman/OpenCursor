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
import { ProvidersPanel } from "./ProvidersPanel";
import { EMPTY_FEATURES, OAUTH_PROVIDERS, POPULAR_KINDS, FREE_KINDS, PROVIDER_PRESETS, type FeatureConfig, type ProviderConfig, type OAuthStatus } from "../features";
import { vscode } from "../../shared/vscode";
import { setMotionPreference } from "../../shared/motionPreference";

vi.mock("../../shared/vscode", () => ({ vscode: { postMessage: vi.fn() } }));

let root: Root;
let container: HTMLDivElement;
const authorizationUrl = "https://auth.openai.com/oauth/authorize?state=fixture&code_challenge=public-challenge";
const pending: OAuthStatus = { accounts: [], errors: {}, pending: "codex", authorizationUrl };
const saved = vi.fn<(patch: Partial<FeatureConfig>) => void>();
function Fixture({ status }: { status: OAuthStatus }) {
  const [features, setFeatures] = React.useState(() => structuredClone(EMPTY_FEATURES));
  React.useEffect(() => {
    const handler = (event: MessageEvent) => { if (event.data?.type === "features") setFeatures(previous => ({ ...previous, ...event.data.features })); };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);
  return <ProvidersPanel features={features} setFeatures={patch => {
    saved(patch);
    setFeatures(previous => ({ ...previous, ...patch }));
  }} oauthStatus={status} />;
}
function render(status: OAuthStatus) {
  act(() => root.render(<Fixture status={status} />));
}
function button(label: string): HTMLButtonElement {
  const scope = container.querySelector('[role="dialog"]') ?? container;
  const result = [...scope.querySelectorAll("button")].find((element) => element.getAttribute("aria-label") === label || element.textContent?.trim() === label);
  if (!result) throw new Error(`Button not found: ${label}`);
  return result;
}
function click(label: string) { act(() => button(label).click()); }
function selectOptions(select: HTMLButtonElement): HTMLElement[] {
  act(() => { select.focus(); select.click(); });
  return [...document.querySelectorAll<HTMLElement>('[data-select-popup] [role="option"]')];
}
function chooseOption(select: HTMLButtonElement, label: string) {
  const option = selectOptions(select).find(item => item.textContent?.trim() === label);
  if (!option) throw new Error(`Option not found: ${label}`);
  act(() => option.click());
}
function setInput(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function dialog(): HTMLElement {
  const element = container.querySelector<HTMLElement>('[role="dialog"]');
  if (!element) throw new Error("No open provider dialog");
  return element;
}
function openPicker(trigger = "Add provider", title = "Add account") {
  act(() => { button(trigger).focus(); button(trigger).click(); });
  expect(dialog().getAttribute("aria-label") || document.getElementById(dialog().getAttribute("aria-labelledby") || "")?.textContent).toBe(title);
  return dialog();
}
function openApiPicker() { click("API Providers"); return openPicker("Add provider", "Add API provider"); }
function openCustomPicker(trigger = "Add provider") { click("Custom Providers"); return openPicker(trigger, "Add custom provider"); }
function pickerOptions(): HTMLButtonElement[] { return [...dialog().querySelectorAll<HTMLButtonElement>("button[data-provider-id]")]; }
function providerSearch(): HTMLInputElement { return dialog().querySelector<HTMLInputElement>('[aria-label="Search providers"]')!; }
function keyDown(target: Element, key: string, shiftKey = false) {
  const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
  act(() => target.dispatchEvent(event));
  return event;
}
function posted(type: string): Record<string, unknown>[] {
  return vi.mocked(vscode.postMessage).mock.calls.map(([message]) => message as Record<string, unknown>).filter(message => message.type === type);
}
function apiKeyInput(): HTMLInputElement {
  const input = dialog().querySelector<HTMLInputElement>('input[type="password"]');
  if (!input) throw new Error("API key field not found");
  return input;
}
function baseUrlInput(): HTMLInputElement {
  const input = [...dialog().querySelectorAll<HTMLInputElement>("input")].find(element => element.value.startsWith("http"));
  if (!input) throw new Error("Provider URL field not found");
  return input;
}
function deepSeekProvider(): ProviderConfig {
  return { id: "popular:deepseek", name: "DeepSeek", kind: "deepseek", baseUrl: PROVIDER_PRESETS.deepseek.baseUrl,
    enabled: true, hasKey: true, apiKeyBalance: "round-robin", apiKeys: [{ id: "deepseek-key-1", label: "Key 1", hasKey: true }] };
}
function sendFeatures(providers: ProviderConfig[]) {
  act(() => window.dispatchEvent(new MessageEvent("message", { data: { type: "features", features: { providers } } })));
}
async function completeAction(action: Record<string, unknown>, providers: ProviderConfig[], error?: string) {
  await act(async () => {
    if (!error) window.dispatchEvent(new MessageEvent("message", { data: { type: "features", features: { providers } } }));
    window.dispatchEvent(new MessageEvent("message", { data: { type: "providerKeyActionResult", requestId: action.requestId, ok: !error, error } }));
  });
}
beforeEach(() => {
  setMotionPreference("reduced");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  render({ accounts: [], errors: {} });
  click("OAuth Accounts");
});
afterEach(() => { act(() => root.unmount()); container.remove(); setMotionPreference("full"); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("OAuth account sign-in UI", () => {
  it("groups accounts by provider and sends independent balancing settings", () => {
    render({ accounts: [
      { id: "codex-work", kind: "codex", email: "work@example.test" },
      { id: "claude-work", kind: "claude-code", email: "claude@example.test" },
      { id: "codex-backup", kind: "codex", email: "backup@example.test", disabled: true },
    ], errors: {}, balanceStrategy: "first", balanceStrategies: { codex: "round-robin", "claude-code": "highest-limit" } });
    const groups = container.querySelectorAll(".oauth-provider-card");
    expect(groups).toHaveLength(2);
    expect(groups[0].querySelectorAll(".oauth-account-list > .feature-card")).toHaveLength(2);
    expect(groups[0].textContent).toContain("2 accounts · 1 enabled");
    expect(groups[1].querySelectorAll(".oauth-account-list > .feature-card")).toHaveLength(1);
    const codex = container.querySelector<HTMLButtonElement>('[aria-label="OpenAI Codex account load balancing"]')!;
    const claude = container.querySelector<HTMLButtonElement>('[aria-label="Claude Code account load balancing"]')!;
    expect(codex.textContent).toBe("Round robin");
    expect(claude.textContent).toBe("Highest remaining limit");
    chooseOption(codex, "Nearest reset time");
    expect(posted("oauthSetBalance")).toEqual([{ type: "oauthSetBalance", kind: "codex", strategy: "nearest-reset" }]);
    expect(claude.textContent).toBe("Highest remaining limit");
    act(() => [...groups[0].querySelectorAll("button")].find(item => item.textContent?.trim() === "Add account")!.click());
    expect(posted("oauthLogin")).toEqual([{ type: "oauthLogin", kind: "codex" }]);
  });

  it.each(OAUTH_PROVIDERS.filter(provider => provider.kind !== "gitlab"))("dispatches $label login and shows immediate cancellable progress before a host reply", ({ kind, label }) => {
    openPicker("Add account");
    click(label);
    expect(posted("oauthLogin")).toEqual([{ type: "oauthLogin", kind }]);
    expect(container.textContent).toContain(`Starting sign-in to ${label}`);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(posted("saveProviderKey")).toHaveLength(0);
    click("Cancel");
    expect(vscode.postMessage).toHaveBeenCalledWith({ type: "oauthCancel", kind });
    expect(button("Add account")).toBeDefined();
  });

  it("offers the authorization link, browser retry, copy, and manual completion after launch failure", () => {
    render({ ...pending, errors: { codex: "The browser could not be opened." } });
    const link = container.querySelector<HTMLInputElement>('[aria-label="Authorization URL"]')!;
    expect(link.value).toBe(authorizationUrl);
    expect(link.readOnly).toBe(true);
    click("Open browser");
    click("Copy link");
    expect(vscode.postMessage).toHaveBeenCalledWith({ type: "oauthOpenLogin", kind: "codex" });
    expect(vscode.postMessage).toHaveBeenCalledWith({ type: "oauthCopyLogin", kind: "codex" });
    const callback = container.querySelector<HTMLInputElement>('[aria-label="Callback URL or authorization code"]')!;
    expect(button("Submit").disabled).toBe(true);
    setInput(callback, "  http://localhost:1455/auth/callback?code=example&state=fixture  ");
    click("Submit");
    expect(vscode.postMessage).toHaveBeenCalledWith({ type: "oauthManualCallback", kind: "codex", url: "http://localhost:1455/auth/callback?code=example&state=fixture" });
    render({ ...pending, errors: { codex: "Callback could not be validated." } });
    expect(callback.value).toContain("code=example");
    expect(container.textContent).toContain("paste the full callback URL");
  });

  it("acknowledges only the current copied link and removes fallback state after cancellation", () => {
    render(pending);
    act(() => window.dispatchEvent(new MessageEvent("message", { data: { type: "oauthLinkCopied", kind: "codex", authorizationUrl: "stale-url" } })));
    expect(button("Copy link")).toBeDefined();
    act(() => window.dispatchEvent(new MessageEvent("message", { data: { type: "oauthLinkCopied", kind: "codex", authorizationUrl } })));
    expect(button("Copied")).toBeDefined();
    render({ accounts: [], errors: {} });
    expect(container.querySelector('[aria-label="Authorization URL"]')).toBeNull();
    render({ ...pending, authorizationUrl: `${authorizationUrl}&new_attempt=1` });
    expect(button("Copy link")).toBeDefined();
  });

  it("shows all provider errors with the current sign-in error first", () => {
    render({ ...pending, errors: { "claude-code": "Earlier Claude failure", codex: "Port 1455 is busy", antigravity: "Google sign-in failed" } });
    const errors = [...container.querySelectorAll('[role="alert"]')].map((element) => element.textContent);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain("OpenAI Codex: Port 1455 is busy");
    expect(errors.join(" ")).toContain("Earlier Claude failure");
    expect(errors.join(" ")).toContain("Google sign-in failed");
    expect(container.querySelector('[aria-label="Authorization URL"]')).not.toBeNull();
  });
});

describe("provider selection dialog", () => {
  it.each([
    { tab: "OAuth Accounts", title: "Add account", labels: OAUTH_PROVIDERS.map(provider => provider.label) },
    { tab: "API Providers", title: "Add API provider", labels: POPULAR_KINDS.map(kind => kind === "openai" ? "OpenAI" : PROVIDER_PRESETS[kind].label) },
    { tab: "Custom Providers", title: "Add custom provider", labels: ["OpenAI-compatible endpoint", "Anthropic-compatible endpoint"] },
  ])("lists only $tab choices with visible icons when the header Add provider is used", ({ tab, title, labels }) => {
    click(tab);
    openPicker("Add provider", title);
    expect(pickerOptions().map(option => option.getAttribute("aria-label")).sort()).toEqual(labels.sort());
    for (const option of pickerOptions()) {
      expect(option.querySelector("svg")).not.toBeNull();
      expect(option.disabled).toBe(false);
    }
    expect(document.activeElement).toBe(providerSearch());
    expect(saved).not.toHaveBeenCalled();
    expect(posted("oauthLogin")).toHaveLength(0);
    expect(posted("saveProviderKey")).toHaveLength(0);
  });

  it("filters by provider name without starting a connection and restores all results when cleared", () => {
    openPicker();
    const total = pickerOptions().length;
    setInput(providerSearch(), "  cOdEx  ");
    expect(pickerOptions().map(option => option.getAttribute("aria-label"))).toEqual(["OpenAI Codex"]);
    setInput(providerSearch(), "not-a-supported-provider");
    expect(pickerOptions()).toHaveLength(0);
    setInput(providerSearch(), "");
    expect(pickerOptions()).toHaveLength(total);
    expect(saved).not.toHaveBeenCalled();
    expect(posted("oauthLogin")).toHaveLength(0);
  });

  it("contains keyboard focus, closes with Escape, and returns focus to the trigger", () => {
    const trigger = button("Add account");
    const modal = openPicker("Add account");
    const focusable = [...modal.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    act(() => last.focus());
    expect(keyDown(last, "Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    act(() => first.focus());
    expect(keyDown(first, "Tab", true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    keyDown(last, "Escape");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(saved).not.toHaveBeenCalled();
  });

  it("keeps a provider dialog open when Escape dismisses its custom select", () => {
    openCustomPicker();
    click("OpenAI-compatible endpoint");
    const modal = dialog();
    const select = modal.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    act(() => { select.focus(); select.click(); });
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
    keyDown(select, "Escape");
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(dialog()).toBe(modal);
    expect(document.activeElement).toBe(select);
    keyDown(select, "Escape");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(saved).not.toHaveBeenCalled();
  });

  it("keeps the custom-provider entry point and search limited to compatible endpoints", () => {
    openCustomPicker("Add Custom Provider");
    expect(pickerOptions().map(option => option.getAttribute("aria-label"))).toEqual(["OpenAI-compatible endpoint", "Anthropic-compatible endpoint"]);
    setInput(providerSearch(), "Anthropic");
    expect(pickerOptions().map(option => option.getAttribute("aria-label"))).toEqual(["Anthropic-compatible endpoint"]);
    click("Anthropic-compatible endpoint");
    click("Back to providers");
    expect(providerSearch().value).toBe("");
    expect(pickerOptions().map(option => option.getAttribute("aria-label"))).toEqual(["OpenAI-compatible endpoint", "Anthropic-compatible endpoint"]);
    expect(saved).not.toHaveBeenCalled();
  });

  it("blocks another account login while one is pending and leaves the separate API picker available", () => {
    render(pending);
    openPicker();
    for (const { label } of OAUTH_PROVIDERS) {
      expect(button(label).disabled).toBe(true);
      click(label);
    }
    click("Cancel");
    openApiPicker();
    expect(button("DeepSeek").disabled).toBe(false);
    expect(posted("oauthLogin")).toHaveLength(0);
    expect(saved).not.toHaveBeenCalled();
  });

  it("adds only a confirmed key to the API list and preserves its provider endpoint", async () => {
    click("API Providers");
    expect(container.querySelector(".api-provider-card")).toBeNull();
    expect(container.textContent).toContain("No API providers added");
    openApiPicker();
    click("DeepSeek");
    expect(dialog().textContent).toContain("Add DeepSeek key");
    expect(baseUrlInput().value).toBe(PROVIDER_PRESETS.deepseek.baseUrl);
    expect(baseUrlInput().readOnly).toBe(true);
    expect(button("Add key").disabled).toBe(true);
    setInput(apiKeyInput(), "  fixture-api-key  ");
    click("Add key");
    const action = posted("providerKeyAction")[0];
    expect(action).toMatchObject({ action: "add", providerId: "popular:deepseek", kind: "deepseek", apiKey: "fixture-api-key" });
    expect(saved).not.toHaveBeenCalled();
    expect(posted("saveProviderKey")).toHaveLength(0);
    expect(button("Saving\u2026").disabled).toBe(true);
    expect(container.querySelector(".api-provider-card")).toBeNull();
    const provider = deepSeekProvider();
    await completeAction(action, [provider]);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelectorAll(".api-provider-card")).toHaveLength(1);
    expect(container.querySelectorAll(".api-key-row")).toHaveLength(1);
    expect(container.textContent).not.toContain("fixture-api-key");
    expect(container.textContent).not.toContain("Google Gemini");
    openApiPicker();
    click("DeepSeek");
    expect(dialog().textContent).toContain("Add DeepSeek key");
    expect(apiKeyInput().value).toBe("");
  });

  it("discards an API draft on cancel without persisting credentials or a provider", () => {
    openApiPicker();
    click("OpenAI");
    setInput(apiKeyInput(), "fixture-abandoned-key");
    click("Cancel");
    expect(saved).not.toHaveBeenCalled();
    expect(posted("saveProviderKey")).toHaveLength(0);
    expect(posted("oauthLogin")).toHaveLength(0);
    openApiPicker();
    click("OpenAI");
    expect(apiKeyInput().value).toBe("");
  });

  it("collects a GitLab application ID before starting browser login", () => {
    openPicker("Add account"); click("GitLab Duo");
    expect(posted("oauthLogin")).toHaveLength(0);
    expect(button("Continue to sign in").disabled).toBe(true);
    setInput(dialog().querySelector<HTMLInputElement>('[aria-label="GitLab application ID"]')!, "application-fixture");
    act(() => dialog().querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(posted("oauthLogin")).toEqual([{ type: "oauthLogin", kind: "gitlab", options: { clientId: "application-fixture", baseUrl: "https://gitlab.com" } }]);
  });

  it("shows a device code and waits for approval without offering a callback form", () => {
    render({ accounts: [], errors: {}, pending: "github", authorizationUrl: "https://github.com/login/device", loginMethod: "device-code", userCode: "ABCD-EFGH" });
    expect(container.querySelector<HTMLInputElement>('[aria-label="Device sign-in code"]')!.value).toBe("ABCD-EFGH");
    expect(container.querySelector('[aria-label="Callback URL or authorization code"]')).toBeNull();
    click("Open browser");
    expect(posted("oauthOpenLogin").slice(-1)[0]).toEqual({ type: "oauthOpenLogin", kind: "github" });
  });

  it("offers quota-aware balancing only for providers with live quota support", () => {
    render({ accounts: [{ id: "github-fixture", kind: "github" }, { id: "codex-fixture", kind: "codex" }], errors: {}, balanceStrategy: "highest-limit" });
    const github = container.querySelector<HTMLButtonElement>('[aria-label="GitHub Copilot account load balancing"]')!;
    const codex = container.querySelector<HTMLButtonElement>('[aria-label="OpenAI Codex account load balancing"]')!;
    expect(selectOptions(github).map(option => option.textContent)).toEqual(["First account", "Round robin"]);
    expect(github.textContent).toBe("First account");
    keyDown(github, "Escape");
    expect(selectOptions(codex).map(option => option.textContent)).toContain("Highest remaining limit");
    expect(codex.textContent).toBe("Highest remaining limit");
    keyDown(codex, "Escape");
  });

  it("keeps an imported account token masked and submits only to the host", () => {
    render({ accounts: [], errors: {}, pending: "cursor", loginMethod: "import-token" });
    const input = container.querySelector<HTMLInputElement>('[aria-label="Account access token"]')!;
    expect(input.type).toBe("password");
    setInput(input, "private-token-fixture"); click("Submit");
    expect(posted("oauthManualCallback")).toEqual([{ type: "oauthManualCallback", kind: "cursor", url: "private-token-fixture" }]);
    expect(container.textContent).not.toContain("private-token-fixture");
    expect(posted("saveFeatures")).toHaveLength(0);
  });

  it("adds a no-auth provider only after host acknowledgement and keeps it separate from API keys", async () => {
    click("No-auth Providers");
    openPicker("Add provider", "Add no-auth provider");
    expect(pickerOptions().map(option => option.dataset.providerId)).toEqual(FREE_KINDS.map(kind => `free:${kind}`));
    click("OpenCode Free");
    const action = posted("providerKeyAction")[0];
    expect(action).toMatchObject({ action: "connect", kind: "opencode", providerId: "popular:opencode" });
    expect(action).not.toHaveProperty("apiKey");
    expect(container.querySelector('[aria-label="OpenCode Free no-auth provider"]')).toBeNull();
    await completeAction(action, [{ id: "popular:opencode", kind: "opencode", name: "OpenCode Free", baseUrl: PROVIDER_PRESETS.opencode.baseUrl, apiKeys: [], enabled: true }]);
    expect(container.querySelector('[aria-label="OpenCode Free no-auth provider"]')).not.toBeNull();
    click("API Providers");
    expect(container.textContent).not.toContain("OpenCode Free");
    click("Custom Providers");
    expect(container.textContent).not.toContain("OpenCode Free");
  });

  it("keeps a failed API key save open without inventing a connected provider", async () => {
    openApiPicker();
    click("DeepSeek");
    setInput(apiKeyInput(), "fixture-failed-key");
    click("Add key");
    const action = posted("providerKeyAction")[0];
    await act(async () => window.dispatchEvent(new MessageEvent("message", { data: { type: "providerKeyActionResult", requestId: "old-request", ok: true } })));
    expect(button("Saving\u2026").disabled).toBe(true);
    await completeAction(action, [], "Secure storage is unavailable");
    expect(dialog().querySelector('[role="alert"]')?.textContent).toBe("Secure storage is unavailable");
    expect(button("Add key").disabled).toBe(false);
    expect(container.querySelector(".api-provider-card")).toBeNull();
    expect(saved).not.toHaveBeenCalled();
  });

  it("adds another independent key to an existing provider and keeps one provider card", async () => {
    const provider = deepSeekProvider();
    sendFeatures([provider]);
    click("API Providers");
    click("Add key");
    setInput(apiKeyInput(), "fixture-second-key");
    setInput(dialog().querySelector<HTMLInputElement>('[aria-label="Key name"]')!, "Work account");
    click("Add key");
    const action = posted("providerKeyAction")[0];
    expect(action).toMatchObject({ action: "add", providerId: provider.id, label: "Work account", apiKey: "fixture-second-key" });
    expect(action).not.toHaveProperty("keyId");
    await completeAction(action, [{ ...provider, apiKeys: [...provider.apiKeys!, { id: "second-key", label: "Work account", hasKey: true }] }]);
    expect(container.querySelectorAll(".api-provider-card")).toHaveLength(1);
    expect(container.querySelectorAll(".api-key-row")).toHaveLength(2);
    expect(container.textContent).toContain("2 keys");
    expect(saved).not.toHaveBeenCalled();
  });

  it("routes balancing, key toggles and removal through the host without overwriting other keys", async () => {
    const provider = { ...deepSeekProvider(), apiKeys: [...deepSeekProvider().apiKeys!, { id: "second-key", label: "Work", hasKey: true }] };
    sendFeatures([provider]);
    click("API Providers");
    const select = container.querySelector<HTMLButtonElement>('[aria-label="DeepSeek load balancing"]')!;
    chooseOption(select, "First available key");
    const balance = posted("providerKeyAction")[0];
    expect(balance).toMatchObject({ action: "setBalance", providerId: provider.id, strategy: "first" });
    await completeAction(balance, [{ ...provider, apiKeyBalance: "first" }]);
    const checkbox = container.querySelector<HTMLInputElement>('[aria-label="Enable DeepSeek Work"]')!;
    act(() => checkbox.click());
    const toggle = posted("providerKeyAction")[1];
    expect(toggle).toMatchObject({ action: "toggle", providerId: provider.id, keyId: "second-key", enabled: false });
    const disabled = { ...provider, apiKeys: provider.apiKeys.map(key => key.id === "second-key" ? { ...key, enabled: false } : key) };
    await completeAction(toggle, [disabled]);
    expect(checkbox.checked).toBe(false);
    click("Remove DeepSeek Work");
    const removal = posted("providerKeyAction")[2];
    expect(removal).toMatchObject({ action: "remove", providerId: provider.id, keyId: "second-key" });
    await completeAction(removal, [deepSeekProvider()]);
    expect(container.querySelectorAll(".api-key-row")).toHaveLength(1);
    click("Remove DeepSeek Key 1");
    await completeAction(posted("providerKeyAction")[3], []);
    expect(container.querySelectorAll(".api-provider-card")).toHaveLength(0);
    expect(container.textContent).toContain("No API providers added");
    expect(saved).not.toHaveBeenCalled();
  });

  it("edits a named key without re-enabling its provider or exposing the saved secret", async () => {
    const provider = { ...deepSeekProvider(), enabled: false };
    sendFeatures([provider]);
    click("API Providers");
    expect(container.querySelector<HTMLInputElement>('[aria-label="Enable DeepSeek"]')!.checked).toBe(false);
    click("Edit DeepSeek Key 1");
    expect(apiKeyInput().value).toBe("");
    click("Save");
    const action = posted("providerKeyAction")[0];
    expect(action).toMatchObject({ action: "update", providerId: provider.id, keyId: provider.apiKeys![0].id, label: "Key 1" });
    expect(action).not.toHaveProperty("apiKey");
    expect(action).not.toHaveProperty("enabled");
    expect(saved).not.toHaveBeenCalled();
    await completeAction(action, [provider]);
    expect(container.querySelector<HTMLInputElement>('[aria-label="Enable DeepSeek"]')!.checked).toBe(false);
  });

  it("uses only the current connection test reply and invalidates requests after key or URL edits", () => {
    const reply = (request: Record<string, unknown>, details: Record<string, unknown> = {}) => {
      act(() => window.dispatchEvent(new MessageEvent("message", { data: {
        type: "modelsFetched", providerId: request.providerId, requestId: request.requestId, models: ["fixture-model"], ...details,
      } })));
    };
    openCustomPicker();
    click("OpenAI-compatible endpoint");
    setInput(apiKeyInput(), "fixture-first-key");
    click("Test connection");
    const first = posted("fetchModels")[0];
    expect(first.requestId).toEqual(expect.any(String));
    expect(first.requestId).not.toBe("");
    setInput(apiKeyInput(), "fixture-revised-key");
    reply(first);
    expect(dialog().querySelector(".test-result")).toBeNull();
    expect(button("Test connection").disabled).toBe(false);
    click("Test connection");
    const second = posted("fetchModels")[1];
    expect(second.requestId).not.toBe(first.requestId);
    expect(second.apiKey).toBe("fixture-revised-key");
    setInput(baseUrlInput(), "http://localhost:12000/v1");
    reply(second, { error: "Obsolete endpoint failed" });
    expect(dialog().querySelector(".test-result")).toBeNull();
    click("Test connection");
    const current = posted("fetchModels")[2];
    expect(current.requestId).not.toBe(second.requestId);
    expect(current.apiBaseUrl).toBe("http://localhost:12000/v1");
    reply(second);
    reply(current, { requestId: undefined });
    reply(current, { providerId: "unrelated-provider" });
    expect(dialog().querySelector(".test-result")).toBeNull();
    expect(dialog().querySelector<HTMLButtonElement>(".test-row button")!.disabled).toBe(true);
    reply(current, { models: ["model-a", "model-b"] });
    expect(dialog().querySelector('[role="status"]')?.textContent).toContain("2 models available");
    expect(button("Test connection").disabled).toBe(false);
    reply(second, { error: "Late failure from obsolete request" });
    expect(dialog().querySelector('[role="status"]')?.textContent).toContain("2 models available");
    expect(dialog().textContent).not.toContain("Late failure");
    expect(saved).not.toHaveBeenCalled();
    expect(posted("saveProviderKey")).toHaveLength(0);
  });

  it("times out a connection test, allows retry, and clears timers on a reply or closing the dialog", () => {
    vi.useFakeTimers();
    openCustomPicker();
    click("OpenAI-compatible endpoint");
    click("Test connection");
    act(() => vi.advanceTimersByTime(29_999));
    expect(dialog().querySelector<HTMLButtonElement>(".test-row button")!.disabled).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(dialog().querySelector('[role="alert"]')?.textContent).toBe("Connection test did not respond. Try again.");
    expect(button("Test connection").disabled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    click("Test connection");
    const retry = posted("fetchModels")[1];
    expect(vi.getTimerCount()).toBe(1);
    act(() => window.dispatchEvent(new MessageEvent("message", { data: {
      type: "modelsFetched", providerId: retry.providerId, requestId: retry.requestId, models: ["fixture-model"],
    } })));
    expect(dialog().querySelector('[role="status"]')?.textContent).toContain("1 models available");
    expect(vi.getTimerCount()).toBe(0);
    const scheduled = vi.spyOn(window, "setTimeout");
    const cleared = vi.spyOn(window, "clearTimeout");
    try {
      click("Test connection");
      const timerIndex = scheduled.mock.calls.findIndex(([, delay]) => delay === 30_000);
      expect(timerIndex).toBeGreaterThanOrEqual(0);
      const timeoutId = scheduled.mock.results[timerIndex].value;
      click("Cancel");
      expect(cleared).toHaveBeenCalledWith(timeoutId);
      // Restoring input focus can queue a jsdom task; the connection timeout must be gone.
      act(() => vi.advanceTimersByTime(0));
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      scheduled.mockRestore();
      cleared.mockRestore();
    }
    act(() => vi.advanceTimersByTime(30_000));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(saved).not.toHaveBeenCalled();
  });

  it("returns from an API connection form to the API picker with safe focus and discards the unsaved draft", () => {
    click("API Providers");
    const trigger = button("Add provider");
    openPicker("Add provider", "Add API provider");
    setInput(providerSearch(), "DeepSeek");
    click("DeepSeek");
    expect(document.activeElement).toBe(apiKeyInput());
    setInput(apiKeyInput(), "fixture-unsaved-back-key");
    click("Back to providers");
    expect(providerSearch().value).toBe("");
    expect(document.activeElement).toBe(providerSearch());
    expect(pickerOptions().map(option => option.getAttribute("aria-label")).sort()).toEqual(POPULAR_KINDS.map(kind => kind === "openai" ? "OpenAI" : PROVIDER_PRESETS[kind].label).sort());
    click("DeepSeek");
    expect(apiKeyInput().value).toBe("");
    click("Back to providers");
    keyDown(providerSearch(), "Escape");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(saved).not.toHaveBeenCalled();
    expect(posted("saveProviderKey")).toHaveLength(0);
    expect(posted("oauthLogin")).toHaveLength(0);
  });

  it("connects a configurable custom endpoint while its optional API key is blank", () => {
    openCustomPicker();
    click("OpenAI-compatible endpoint");
    expect(dialog().textContent).toContain("Connect custom provider");
    expect(apiKeyInput().value).toBe("");
    const endpoint = baseUrlInput();
    expect(endpoint.readOnly).toBe(false);
    setInput(endpoint, "http://localhost:11435/v1");
    click("Connect");
    expect(saved).toHaveBeenLastCalledWith({ providers: [expect.objectContaining({ kind: "openai", baseUrl: "http://localhost:11435/v1", enabled: true, hasKey: false })] });
    expect(posted("saveProviderKey")).toHaveLength(0);
    expect(posted("oauthLogin")).toHaveLength(0);
  });

  it("rejects a non-HTTP compatible endpoint before any settings or key are persisted", () => {
    openCustomPicker();
    click("OpenAI-compatible endpoint");
    setInput(apiKeyInput(), "fixture-custom-key");
    setInput(baseUrlInput(), "file:///tmp/unsupported-endpoint");
    click("Connect");
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(saved).not.toHaveBeenCalled();
    expect(posted("saveProviderKey")).toHaveLength(0);
    expect(posted("oauthLogin")).toHaveLength(0);
  });
});
