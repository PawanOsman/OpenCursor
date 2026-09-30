/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor, AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it } from "vitest";
import { applyChatSpeed, fastModeProtocol, supportsFastMode } from "./modelSpeed";

describe("fast mode capabilities", () => {
  it.each([
    ["gpt-6-astra", "openai", "openai"],
    ["gpt-6-sol", "codex", "openai"],
    ["gpt-5.5-2026-04-23", "openai", "openai"],
    ["cx/gpt-6-astra", "openai", "openai"],
    ["openai/gpt-5.4", "openai", "openai"],
    ["claude-opus-5-5", "anthropic", "anthropic"],
    ["claude-opus-5", "claude-code", "anthropic"],
    ["claude-opus-4-8-20260528", "anthropic", "anthropic"],
    ["cc/claude-opus-5-5", "openai", "anthropic"],
    ["anthropic/claude-opus-5-5", "anthropic", "anthropic"],
  ])("recognizes %s through %s without rewriting its ID", (model, kind, protocol) => {
    expect(fastModeProtocol(model, kind)).toBe(protocol);
  });

  it.each([
    ["gpt-6-astra", "google"], ["gpt-6-astra", "ollama"],
    ["cx/gpt-6-astra", "ollama"], ["gpt-6-astra", "anthropic"],
    ["cx/gpt-6-astra", "anthropic"],
    ["claude-opus-5-5", "openai"], ["unknown/gpt-6-astra", "openai"],
    ["gpt-5.5-pro", "openai"], ["gpt-5.3-codex-spark", "codex"],
    ["gpt-6-astra-custom", "openai"], ["ft:gpt-6-astra:custom", "openai"],
    ["claude-opus-4-6", "anthropic"], ["claude-sonnet-5", "claude-code"],
    ["claude-opus-5-50", "anthropic"],
  ])("excludes unsupported %s through %s", (model, kind) => {
    expect(supportsFastMode(model, kind)).toBe(false);
  });

  it("leaves default and unsupported requests untouched", () => {
    for (const [model, speed] of [["gpt-6-astra", undefined], ["gpt-5.5-pro", "fast"], ["cc/claude-opus-5-5", "standard"]] as const) {
      const body = { model };
      applyChatSpeed(body, model, speed);
      expect(body).toEqual({ model });
    }
  });
});
