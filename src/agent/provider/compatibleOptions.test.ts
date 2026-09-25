/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it } from "vitest";
import { applyCompatibleOptions, compatibleProviderFor } from "./compatibleOptions";

describe("official compatible-provider option contracts", () => {
  it("forwards selected thinking for qualified gateway models", () => {
    const body = { model: "cc/claude-opus-5-5", reasoning_effort: "high" };
    applyCompatibleOptions(body, "http://localhost:20128/v1", body.model, { thinking: "adaptive", reasoningEffort: "high" });
    expect(body).toEqual({ model: "cc/claude-opus-5-5", reasoning_effort: "high", thinking: { type: "adaptive" } });
  });
  it.each([
    ["https://api.x.ai/v1", "grok-4.7", "xai"],
    ["https://api.deepseek.com/v1/", "deepseek-flash", "deepseek"],
    ["https://api.deepseek.com", "deepseek-v4-pro", "deepseek"],
    ["https://api.moonshot.ai/v1", "kimi-k3", "moonshot"],
    ["https://api.z.ai/api/paas/v4", "glm-5.3-flashx", "z-ai"],
    ["https://api.z.ai/api/coding/paas/v4/", "glm-5.3", "z-ai"],
    ["https://api.minimax.io/v1", "MiniMax-M3", "minimax"],
    ["https://maas.qwencloudapi.com/compatible-mode/v1", "qwen3.8-max", "qwen"],
    ["https://workspace-1.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1", "qwen3.8-flash", "qwen"],
  ])("recognizes %s / %s", (url, model, provider) => {
    expect(compatibleProviderFor(url, model)).toBe(provider);
  });

  it.each([
    "http://api.deepseek.com/v1", "https://api.deepseek.com.proxy.invalid/v1", "https://api.deepseek.com/v1/proxy",
    "https://user:pass@api.deepseek.com/v1", "https://api.deepseek.com:8443/v1", "https://api.deepseek.com/v1?proxy=true",
    "http://localhost:11434/v1", "https://api.openai.com/v1", "not a url",
  ])("leaves other endpoints untouched: %s", (url) => {
    const body = { reasoning_effort: "ultra", temperature: 0.1 };
    applyCompatibleOptions(body, url, "deepseek-flash", { thinking: "disabled" });
    expect(body).toEqual({ reasoning_effort: "ultra", temperature: 0.1 });
  });

  it("does not guess capabilities for an unknown future model", () => {
    const body = { reasoning_effort: "none" };
    applyCompatibleOptions(body, "https://api.moonshot.ai/v1", "kimi-k99");
    expect(body).toEqual({ reasoning_effort: "none" });
  });

  it("maps impossible Grok off mode to low without a thinking field", () => {
    const body = { reasoning_effort: "none", thinking: { type: "disabled" }, top_k: 3, logprobs: true };
    applyCompatibleOptions(body, "https://api.x.ai/v1", "grok-4.7");
    expect(body).toEqual({ reasoning_effort: "low" });
  });

  it("sends DeepSeek thinking and valid effort, omitting ignored sampling", () => {
    const body = { reasoning_effort: "medium", temperature: 0.1, top_p: 0.3, top_k: 5, presence_penalty: 1, tool_choice: "required" };
    applyCompatibleOptions(body, "https://api.deepseek.com/v1", "deepseek-v4-pro");
    expect(body).toEqual({ reasoning_effort: "high", thinking: { type: "enabled" }, top_p: 0.95, tool_choice: "auto" });
  });

  it("honors explicit DeepSeek thinking-off ahead of a saved high effort", () => {
    const body = { reasoning_effort: "high", temperature: 0.3 };
    applyCompatibleOptions(body, "https://api.deepseek.com", "deepseek-flash", { thinking: "disabled" });
    expect(body).toEqual({ thinking: { type: "disabled" }, temperature: 0.3 });
  });

  it("strips rejected Kimi sampling values and omits K2 thinking for K3", () => {
    const body = { thinking: { type: "disabled" }, reasoning_effort: "medium", temperature: 0.2, top_p: 0.5, top_k: 5, n: 2, presence_penalty: 1, frequency_penalty: 1 };
    applyCompatibleOptions(body, "https://api.moonshot.ai/v1", "kimi-k3");
    expect(body).toEqual({ reasoning_effort: "high" });
  });

  it("keeps K2.7 preserved thinking on and removes unsupported effort", () => {
    const body = { reasoning_effort: "high", tool_choice: "required" };
    applyCompatibleOptions(body, "https://api.moonshot.ai/v1", "kimi-k2.7-code-highspeed", { thinking: "disabled" });
    expect(body).toEqual({ thinking: { type: "enabled", keep: "all" }, tool_choice: "auto" });
  });

  it("supports K2.6 non-thinking mode without an effort field", () => {
    const body = { reasoning_effort: "high" };
    applyCompatibleOptions(body, "https://api.moonshot.ai/v1", "kimi-k2.6", { thinking: "disabled" });
    expect(body).toEqual({ thinking: { type: "disabled" } });
  });

  it("keeps GLM5.3 thinking on and preserves previous thinking", () => {
    const body = { reasoning_effort: "none" };
    applyCompatibleOptions(body, "https://api.z.ai/api/paas/v4", "glm-5.3-flash");
    expect(body).toEqual({ thinking: { type: "enabled", clear_thinking: false }, reasoning_effort: "low" });
  });

  it("translates MiniMax M3 thinking and token caps without inflating output", () => {
    const body = { reasoning_effort: "high", max_tokens: 1024 };
    applyCompatibleOptions(body, "https://api.minimax.io/v1", "MiniMax-M3", { thinking: "disabled" });
    expect(body).toEqual({ thinking: { type: "disabled" }, max_completion_tokens: 1024 });
  });

  it("does not promise MiniMax M2.7 can disable thinking", () => {
    const body = { reasoning_effort: "none", thinking: { type: "disabled" } };
    applyCompatibleOptions(body, "https://api.minimax.io/v1", "MiniMax-M2.7");
    expect(body).toEqual({});
  });

  it("maps Qwen effort and prevents mutually exclusive token-budget parameters", () => {
    const body = { reasoning_effort: "max", thinking_budget: 1000 };
    applyCompatibleOptions(body, "https://maas.qwencloudapi.com/compatible-mode/v1", "qwen3.8-max");
    expect(body).toEqual({ reasoning_effort: "xhigh", enable_thinking: true, preserve_thinking: true });
  });

  it("actually disables Qwen thinking instead of sending an unsupported enum", () => {
    const body = { reasoning_effort: "none" };
    applyCompatibleOptions(body, "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "qwen3.8-flash");
    expect(body).toEqual({ enable_thinking: false, preserve_thinking: true });
  });

  it("caps Qwen thinking plus final output and avoids unsupported forced tools", () => {
    const body = { max_tokens: 8192, tool_choice: { type: "function", function: { name: "answer" } } };
    applyCompatibleOptions(body, "https://maas.qwencloudapi.com/compatible-mode/v1", "qwen3.8-flash");
    expect(body).toEqual({ max_completion_tokens: 8192, enable_thinking: true, preserve_thinking: true, tool_choice: "auto" });
  });

  it("uses cheap supported modes for auxiliary calls without changing user caps", () => {
    const kimi: Record<string, unknown> = { max_tokens: 4096 };
    const deepseek: Record<string, unknown> = { max_tokens: 512 };
    applyCompatibleOptions(kimi, "https://api.moonshot.ai/v1", "kimi-k3", undefined, { auxiliary: true });
    applyCompatibleOptions(deepseek, "https://api.deepseek.com/v1", "deepseek-flash", undefined, { auxiliary: true });
    expect(kimi).toEqual({ max_tokens: 4096, reasoning_effort: "low" });
    expect(deepseek).toEqual({ max_tokens: 512, thinking: { type: "disabled" } });
  });
});
