/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { fastModeProtocol } from "../../shared/modelSpeed";

/**
 * Fast is a separate, account-gated inference mode, independent of effort.
 * Standard omits the beta-only field and uses the API's normal request shape.
 * https://platform.claude.com/docs/en/build-with-claude/fast-mode
 */
export function applyAnthropicSpeed(
  body: Record<string, unknown>,
  model: string,
  speed?: "standard" | "fast",
): string[] {
  if (speed === "fast" && fastModeProtocol(model, "anthropic") === "anthropic") {
    body.speed = "fast";
    return ["fast-mode-2026-02-01"];
  }
  delete body.speed;
  return [];
}
