/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor, AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { MODEL_PROVIDER_ALIASES } from "./modelAliases";

export type ModelSpeed = "standard" | "fast";
export const MODEL_SPEED_DESCRIPTION = "Fast processing uses extra credits or higher API rates. Requires account support; custom gateways may ignore this setting.";

// Exact families only: Pro, Spark, fine-tunes and unknown suffixes are excluded.
const OPENAI_FAST = /^(?:gpt-6-(?:astra|sol|luna)|gpt-5\.6(?:-(?:sol|terra|luna))?|gpt-5\.5|gpt-5\.4(?:-mini)?|gpt-5\.3-codex)(?:-\d{4}-\d{2}-\d{2})?$/;
const ANTHROPIC_FAST = /^claude-opus-(?:5-5|5|4-8)(?:-\d{8})?$/;

/** Metadata matching never changes the model ID sent to a gateway. */
export function fastModeProtocol(modelId: string, kind?: string): "openai" | "anthropic" | undefined {
  let model = modelId;
  let provider = kind;
  const slash = model.indexOf("/");
  if (slash >= 0) {
    if (provider && provider !== "openai" && provider !== "anthropic") return undefined;
    const prefix = model.slice(0, slash);
    if (!Object.prototype.hasOwnProperty.call(MODEL_PROVIDER_ALIASES, prefix)) return undefined;
    const resolved = MODEL_PROVIDER_ALIASES[prefix];
    if (provider === "anthropic" && resolved !== "anthropic" && resolved !== "claude-code") return undefined;
    provider = resolved;
    model = model.slice(slash + 1);
  }
  if ((provider === "openai" || provider === "codex") && OPENAI_FAST.test(model)) return "openai";
  if ((provider === "anthropic" || provider === "claude-code") && ANTHROPIC_FAST.test(model)) return "anthropic";
  return undefined;
}

export function supportsFastMode(modelId: string, kind?: string): boolean {
  return fastModeProtocol(modelId, kind) !== undefined;
}

/** OpenAI-compatible gateways can forward either provider's explicit speed field. */
export function applyChatSpeed(body: Record<string, unknown>, model: string, speed?: ModelSpeed): void {
  if (speed !== "standard" && speed !== "fast") return;
  const protocol = fastModeProtocol(model, "openai");
  if (protocol === "openai") body.service_tier = speed === "fast" ? "priority" : "default";
  if (protocol === "anthropic" && speed === "fast") body.speed = "fast";
}
