/**
 * Unit tests for provider utilities.
 * Runs via vitest in CI (no VS Code dependency).
 * Sensitive data (API keys, tokens) must NEVER appear here.
 */
import { describe, it, expect } from "vitest";

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function kindMatches(kind: string | string[], k: string): boolean {
  return Array.isArray(kind) ? kind.includes(k) : kind === k;
}

// --- normalizeBaseUrl ---

describe("normalizeBaseUrl", () => {
  it("strips trailing slashes", () => {
    expect(normalizeBaseUrl("https://api.example.com/v1/")).toBe("https://api.example.com/v1");
    expect(normalizeBaseUrl("https://api.example.com/v1///")).toBe("https://api.example.com/v1");
  });

  it("leaves clean URLs untouched", () => {
    expect(normalizeBaseUrl("https://api.example.com/v1")).toBe("https://api.example.com/v1");
  });

  it("handles root URLs", () => {
    expect(normalizeBaseUrl("https://api.example.com/")).toBe("https://api.example.com");
  });

  it("preserves internal path separators", () => {
    expect(normalizeBaseUrl("https://a.com/b/c/")).toBe("https://a.com/b/c");
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

const PROVIDER_PRESETS: Record<string, { label: string; baseUrl: string; needsKey: boolean }> = {
  openai: { label: "OpenAI-compatible", baseUrl: "https://api.openai.com/v1", needsKey: true },
  anthropic: { label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", needsKey: true },
  google: { label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", needsKey: true },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", needsKey: true },
  ollama: { label: "Ollama", baseUrl: "http://localhost:11434/v1", needsKey: false },
  llamacpp: { label: "llama.cpp", baseUrl: "http://localhost:8080/v1", needsKey: false },
  mimo: { label: "Xiaomi MIMO", baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1", needsKey: true },
  atlascloud: { label: "Atlas Cloud", baseUrl: "https://api.atlascloud.ai/v1", needsKey: true },
  astraflow: { label: "Astraflow", baseUrl: "https://api-us-ca.umodelverse.ai/v1", needsKey: true },
};

describe("PROVIDER_PRESETS", () => {
  it("has all expected providers", () => {
    const expected = ["openai", "anthropic", "google", "openrouter", "ollama", "llamacpp", "mimo", "atlascloud", "astraflow"];
    for (const key of expected) {
      expect(PROVIDER_PRESETS[key]).toBeDefined();
    }
  });

  it("every provider has a valid HTTPS or localhost URL", () => {
    for (const [, preset] of Object.entries(PROVIDER_PRESETS)) {
      expect(preset.baseUrl.startsWith("https://") || preset.baseUrl.startsWith("http://localhost")).toBe(true);
    }
  });

  it("every provider URL has a versioned API path", () => {
    for (const [key, preset] of Object.entries(PROVIDER_PRESETS)) {
      expect(preset.baseUrl).toMatch(/\/v\d/);
    }
  });

  it("no provider URL has trailing slash", () => {
    for (const [, preset] of Object.entries(PROVIDER_PRESETS)) {
      expect(preset.baseUrl.endsWith("/")).toBe(false);
    }
  });

  it("remote providers require API keys", () => {
    const noKeyNeeded = ["ollama", "llamacpp"];
    for (const [key, preset] of Object.entries(PROVIDER_PRESETS)) {
      if (noKeyNeeded.includes(key)) {
        expect(preset.needsKey).toBe(false);
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
      expect(preset.baseUrl).not.toMatch(/^(sk-|tp-|vbk_)/);
      expect(preset.label).not.toMatch(/key|token|secret/i);
    }
  });
});
