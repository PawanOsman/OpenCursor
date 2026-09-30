/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it } from "vitest";
import { applyAnthropicSpeed } from "./anthropicSpeed";

describe("Anthropic inference speed", () => {
  it.each(["claude-opus-5-5", "claude-opus-5", "claude-opus-4-8"])("opts %s into fast inference without changing reasoning", (model) => {
    const body: Record<string, unknown> = {
      model, max_tokens: 4096, thinking: { type: "adaptive" }, output_config: { effort: "max" },
    };
    expect(applyAnthropicSpeed(body, model, "fast")).toEqual(["fast-mode-2026-02-01"]);
    expect(body).toEqual({ model, max_tokens: 4096, thinking: { type: "adaptive" }, output_config: { effort: "max" }, speed: "fast" });
  });

  it.each([undefined, "standard"] as const)("omits beta-only fields for %s speed", (speed) => {
    const body: Record<string, unknown> = { max_tokens: 4096, speed: "fast" };
    expect(applyAnthropicSpeed(body, "claude-opus-5-5", speed)).toEqual([]);
    expect(body).toEqual({ max_tokens: 4096 });
  });

  it.each(["claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-5", "claude-haiku-4-5", "claude-fable-5-1", "claude-opus-5-50", "cx/gpt-6-astra"])("does not send an unsupported fast request to %s", (model) => {
    const body: Record<string, unknown> = { model, speed: "fast" };
    expect(applyAnthropicSpeed(body, model, "fast")).toEqual([]);
    expect(body).toEqual({ model });
  });
});
