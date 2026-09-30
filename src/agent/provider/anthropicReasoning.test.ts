/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it } from "vitest";
import { applyAnthropicReasoning, needsContext1mBeta } from "./anthropicReasoning";
import type { ModelParams } from "./types";

function configure(model: string, params?: ModelParams, maxTokens = 8192) {
  const body: Record<string, unknown> = { max_tokens: maxTokens };
  const betas = applyAnthropicReasoning(body, model, maxTokens, params);
  return { body, betas };
}

describe("Anthropic supported thinking and effort settings", () => {
  it.each(["low", "medium", "high", "xhigh", "max"])("honors Sonnet 5 thinking disabled at %s effort", (reasoningEffort) => {
    const { body } = configure("claude-sonnet-5", { thinking: "disabled", reasoningEffort });
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.output_config).toEqual({ effort: reasoningEffort });
  });

  it.each(["xhigh", "max"])("keeps Opus 5 disabled thinking valid with saved %s effort", (reasoningEffort) => {
    const { body } = configure("claude-opus-5", { thinking: "disabled", reasoningEffort });
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.output_config).toEqual({ effort: "high" });
  });

  it.each(["low", "medium", "high", "xhigh", "max"])("keeps Opus 5.5 thinking adaptive at %s effort after stale settings", (reasoningEffort) => {
    for (const thinking of ["disabled", "enabled", "adaptive"]) {
      const { body, betas } = configure("claude-opus-5-5", { thinking, reasoningEffort });
      expect(body.thinking).toEqual({ type: "adaptive", display: "summarized" });
      expect(body.output_config).toEqual({ effort: reasoningEffort });
      expect(body).not.toHaveProperty("temperature");
      expect(body.max_tokens).toBe(8192);
      expect(betas).toEqual([]);
    }
  });

  it("does not override Opus 5.5's medium effort default when only a stale thinking mode is supplied", () => {
    const { body } = configure("claude-opus-5-5", { thinking: "disabled" });
    expect(body.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(body).not.toHaveProperty("output_config");
  });

  it.each(["claude-fable-5-1", "claude-fable-5", "claude-mythos-5-1"])("keeps %s adaptive when saved settings request disabled thinking", (model) => {
    const { body } = configure(model, { thinking: "disabled", reasoningEffort: "max" });
    expect(body.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(body.output_config).toEqual({ effort: "max" });
    expect(body).not.toHaveProperty("temperature");
  });

  it.each(["claude-sonnet-4-6", "claude-opus-4-6"])("normalizes unsupported xhigh for %s without raising it to max", (model) => {
    expect(configure(model, { thinking: "adaptive", reasoningEffort: "xhigh" }).body.output_config).toEqual({ effort: "high" });
    expect(configure(model, { thinking: "adaptive", reasoningEffort: "max" }).body.output_config).toEqual({ effort: "max" });
  });

  it("caps unsupported Opus 4.5 effort and uses the generally available parameter", () => {
    for (const reasoningEffort of ["xhigh", "max"]) {
      const { body, betas } = configure("claude-opus-4-5-20251101", { thinking: "enabled", reasoningEffort });
      expect(body.output_config).toEqual({ effort: "high" });
      expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 4096 });
      expect(betas).toEqual([]);
    }
  });

  it.each(["claude-haiku-4-5-20251001", "claude-sonnet-4-5-20250929"])("does not send effort to %s", (model) => {
    const { body } = configure(model, { thinking: "enabled", reasoningEffort: "max" });
    expect(body).not.toHaveProperty("output_config");
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 4096 });
  });

  it("ignores unsupported effort strings instead of sending invalid API values", () => {
    const { body } = configure("claude-sonnet-5", { thinking: "adaptive", reasoningEffort: "minimal" });
    expect(body).not.toHaveProperty("output_config");
    expect(body.thinking).toEqual({ type: "adaptive", display: "summarized" });
  });

  it.each(["claude-opus-4-7", "claude-opus-4-8", "claude-opus-5", "claude-sonnet-5", "claude-fable-5-1"])("migrates stale manual settings to supported adaptive thinking for %s", (model) => {
    const { body } = configure(model, { thinking: "enabled", reasoningEffort: "xhigh" });
    expect(body.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(body.output_config).toEqual({ effort: "xhigh" });
  });

  it("retains the accepted manual configuration on Opus/Sonnet 4.6", () => {
    for (const model of ["claude-opus-4-6", "claude-sonnet-4-6"]) {
      expect(configure(model, { thinking: "enabled" }).body.thinking).toEqual({ type: "enabled", budget_tokens: 4096 });
    }
  });

  it("does not override API thinking defaults when no mode was selected", () => {
    for (const model of ["claude-opus-5", "claude-sonnet-5", "claude-fable-5-1", "claude-opus-4-8"]) {
      expect(configure(model).body).toEqual({ max_tokens: 8192 });
    }
  });
});

describe("Anthropic token bounds", () => {
  it.each([512, 1024])("rejects manual thinking with a %s-token output cap before sending an invalid request", (maxTokens) => {
    const body: Record<string, unknown> = { max_tokens: maxTokens };
    expect(() => applyAnthropicReasoning(body, "claude-haiku-4-5", maxTokens, { thinking: "enabled" }))
      .toThrow("Extended thinking requires max response tokens above 1024");
    expect(body.max_tokens).toBe(maxTokens);
    expect(body).not.toHaveProperty("thinking");
  });

  it("leaves answer room at the smallest valid manual output cap", () => {
    const { body } = configure("claude-haiku-4-5", { thinking: "enabled" }, 1025);
    expect(body.max_tokens).toBe(1025);
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 1024 });
  });

  it("preserves small output caps when thinking is disabled or adaptive", () => {
    expect(configure("claude-haiku-4-5", { thinking: "disabled" }, 512).body).toEqual({ max_tokens: 512, thinking: { type: "disabled" } });
    expect(configure("claude-sonnet-5", { thinking: "adaptive" }, 512).body.max_tokens).toBe(512);
  });

  it.each(["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5", "claude-sonnet-4-6", "claude-fable-5-1"])("does not advertise the retired context-window beta for %s", (model) => {
    expect(needsContext1mBeta(model)).toBe(false);
    expect(configure(model, { maxContext: "1m" }).betas).toEqual([]);
  });
});
