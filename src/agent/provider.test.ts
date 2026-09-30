/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

/**
 * Unit tests for provider utilities.
 * Runs via vitest in CI (no VS Code dependency).
 * Sensitive data (API keys, tokens) must NEVER appear here.
 */
import { afterEach, describe, it, expect, vi } from "vitest";
vi.mock("vscode", () => ({ workspace: {}, Uri: {}, EventEmitter: class { event = () => ({ dispose() {} }); fire() {} } }));
vi.mock("./oauth", () => ({ streamOAuthChat: vi.fn() }));
import { listModels } from "./provider";
import { kindMatches, PROVIDER_PRESETS } from "../stores/featureStore";

afterEach(() => vi.unstubAllGlobals());

describe("provider base URLs", () => {
  it.each([
    ["https://api.example.com/v1/", "https://api.example.com/v1/models"],
    ["https://api.example.com/v1///", "https://api.example.com/v1/models"],
    ["https://api.example.com/v1", "https://api.example.com/v1/models"],
    ["https://api.example.com/", "https://api.example.com/models"],
    ["https://a.com/b/c/", "https://a.com/b/c/models"],
  ])("normalizes %s at the actual HTTP boundary", async (base, expected) => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "fixture" }] })));
    vi.stubGlobal("fetch", fetch);
    expect(await listModels(base, "fixture-key", false)).toEqual([{ id: "fixture" }]);
    expect(fetch).toHaveBeenCalledWith(expected, { headers: { authorization: "Bearer fixture-key" }, signal: expect.any(AbortSignal) });
  });
});

// --- kindMatches ---

describe("kindMatches", () => {
  it("matches single kind", () => {
    expect(kindMatches("mimo", "mimo")).toBe(true);
    expect(kindMatches("mimo", "openai")).toBe(false);
  });

  it("matches array kind", () => {
    expect(kindMatches(["openai", "codex"], "openai")).toBe(true);
    expect(kindMatches(["openai", "codex"], "anthropic")).toBe(false);
  });
});

// --- Provider presets ---

describe("PROVIDER_PRESETS", () => {
  it("has all expected providers", () => {
    const expected = ["openai", "anthropic", "google", "openrouter", "ollama", "llamacpp", "mimo", "atlascloud", "astraflow"] as const;
    for (const key of expected) {
      expect(PROVIDER_PRESETS[key]).toBeDefined();
    }
  });

  it("every provider has a secure default endpoint or requires endpoint setup", () => {
    for (const [, preset] of Object.entries(PROVIDER_PRESETS)) {
      if (!preset.baseUrl) {
        expect(preset.needsEndpoint).toBe(true);
        expect(preset.setupHint).toBeTruthy();
        continue;
      }
      const url = new URL(preset.baseUrl);
      expect(url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "localhost")).toBe(true);
      if (/\{[^}]+\}/.test(preset.baseUrl)) expect(preset.needsEndpoint).toBe(true);
    }
  });

  it("providers with specialized protocols declare their transport identity", () => {
    for (const [, preset] of Object.entries(PROVIDER_PRESETS)) {
      if (preset.protocol === "adapter") expect(preset.adapterId).toBeTruthy();
    }
  });

  it("no provider URL has trailing slash", () => {
    for (const [, preset] of Object.entries(PROVIDER_PRESETS)) {
      expect(preset.baseUrl.endsWith("/")).toBe(false);
    }
  });

  it("remote providers require credentials unless explicitly anonymous", () => {
    const noKeyNeeded = ["ollama", "llamacpp", "opencode"];
    for (const [key, preset] of Object.entries(PROVIDER_PRESETS)) {
      if (noKeyNeeded.includes(key)) {
        expect(preset.needsKey).toBe(false);
        if (key === "opencode") expect(preset.noAuth).toBe(true);
      } else {
        expect(preset.needsKey).toBe(true);
      }
    }
  });
});

// --- Security: no sensitive data ---

describe("security", () => {
  it("provider presets contain no API keys or tokens", () => {
    for (const [, preset] of Object.entries(PROVIDER_PRESETS)) {
      expect(Object.keys(preset)).not.toEqual(expect.arrayContaining(["apiKey"]));
      for (const key of ["accessToken", "refreshToken", "clientSecret", "privateKey"]) {
        expect(preset).not.toHaveProperty(key);
      }
      expect(JSON.stringify(preset)).not.toMatch(/(?:sk-|tp-|vbk_)[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA )?PRIVATE KEY-----/);
      if (preset.baseUrl) {
        const url = new URL(preset.baseUrl);
        expect(url.username).toBe("");
        expect(url.password).toBe("");
        for (const key of url.searchParams.keys()) expect(key).not.toMatch(/key|token|secret|password/i);
      }
    }
  });
});
