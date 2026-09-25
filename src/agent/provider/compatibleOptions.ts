/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { ModelParams } from "./types";
import { MODEL_PROVIDER_ALIASES } from "../../shared/modelAliases";

export type CompatibleProvider = "xai" | "deepseek" | "moonshot" | "z-ai" | "minimax" | "qwen";

/** These contracts belong to the provider's own API, not arbitrary compatible
 * proxies or local runtimes that happen to serve a similarly named model. */
export function compatibleProviderFor(baseUrl: string, model: string): CompatibleProvider | undefined {
  let url: URL;
  try { url = new URL(baseUrl); } catch { return; }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.port && url.port !== "443")) return;
  const path = url.pathname.replace(/\/+$/, "");
  const host = url.hostname;
  if (host === "api.x.ai" && path === "/v1" && /^grok-4\.[567]$/.test(model)) return "xai";
  if (host === "api.deepseek.com" && ["", "/v1"].includes(path) && /^(?:deepseek-flash|deepseek-v4-pro)$/.test(model)) return "deepseek";
  if (host === "api.moonshot.ai" && path === "/v1" && /^kimi-(?:k3|k2\.7-code(?:-highspeed)?|k2\.6)$/.test(model)) return "moonshot";
  if (host === "api.z.ai" && /^\/api\/(?:coding\/)?paas\/v4$/.test(path) && /^glm-5\.3(?:-flashx?)?$/.test(model)) return "z-ai";
  if (host === "api.minimax.io" && path === "/v1" && /^MiniMax-M(?:3|2\.7(?:-highspeed)?)$/.test(model)) return "minimax";
  const qwenHost = host === "maas.qwencloudapi.com"
    || ["dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com", "dashscope-us.aliyuncs.com", "cn-hongkong.dashscope.aliyuncs.com"].includes(host)
    || /^[a-z0-9-]+\.(?:cn-beijing|cn-hongkong|ap-southeast-1|ap-northeast-1|us-east-1)\.maas\.aliyuncs\.com$/.test(host);
  if (qwenHost && path === "/compatible-mode/v1" && /^qwen3\.8-(?:max(?:-0902)?|flash)$/.test(model)) return "qwen";
}

const OFF = new Set(["none", "off", "disabled"]);
const normalized = (value: unknown): string | undefined => typeof value === "string" ? value.trim().toLowerCase() : undefined;

function setEffort(body: Record<string, unknown>, effort: string | undefined, values: string[]): void {
  if (effort && values.includes(effort)) body.reasoning_effort = effort;
  else delete body.reasoning_effort;
}

/** Map catalog options to documented Chat Completions fields. Call after generic
 * sampling and tool parameters. Auxiliary calls may use the least expensive
 * supported reasoning mode, but the caller remains responsible for output caps.
 */
export function applyCompatibleOptions(
  body: Record<string, unknown>, apiBaseUrl: string, model: string, params?: ModelParams,
  options: { auxiliary?: boolean } = {},
): void {
  const provider = compatibleProviderFor(apiBaseUrl, model);
  if (!provider) {
    // Qualified gateway models retain their routing ID and use shared controls.
    const slash = model.indexOf("/");
    if (slash > 0 && Object.hasOwn(MODEL_PROVIDER_ALIASES, model.slice(0, slash))
      && ["disabled", "enabled", "adaptive"].includes(params?.thinking ?? "")) {
      body.thinking = { type: params!.thinking };
    }
    return;
  }
  const selectedThinking = normalized(params?.thinking);
  let effort = normalized(params?.reasoningEffort ?? body.reasoning_effort);
  const disabled = options.auxiliary || selectedThinking === "disabled" || (!selectedThinking && !!effort && OFF.has(effort));

  if (provider === "xai") {
    // https://docs.x.ai/developers/model-capabilities/text/reasoning
    if (disabled || effort === "minimal") effort = "low";
    if (effort === "max" || effort === "ultra") effort = "xhigh";
    if (model === "grok-4.5" && effort === "xhigh") effort = "high";
    setEffort(body, effort, ["low", "medium", "high", ...(model === "grok-4.5" ? [] : ["xhigh"])]);
    delete body.thinking;
    delete body.top_k;
    delete body.logprobs;
    delete body.top_logprobs;
    return;
  }

  if (provider === "deepseek") {
    // https://api-docs.deepseek.com/guides/thinking_mode/
    body.thinking = { type: disabled ? "disabled" : "enabled" };
    if (disabled) delete body.reasoning_effort;
    else {
      if (effort === "minimal") effort = "low";
      if (effort === "medium" || effort === "xhigh") effort = "high";
      if (effort === "ultra") effort = "max";
      setEffort(body, effort, ["low", "high", "max"]);
      for (const key of ["temperature", "presence_penalty", "frequency_penalty"]) delete body[key];
      if (typeof body.top_p === "number") body.top_p = Math.max(0.95, Math.min(1, body.top_p));
      if (body.tool_choice && body.tool_choice !== "auto" && body.tool_choice !== "none") body.tool_choice = "auto";
    }
    delete body.top_k;
    return;
  }

  if (provider === "moonshot") {
    // https://platform.kimi.ai/docs/api/models-overview
    // Fixed-value fields reject a user's generic sampling settings. Omit them.
    for (const key of ["temperature", "top_p", "top_k", "presence_penalty", "frequency_penalty", "n"]) delete body[key];
    if (model === "kimi-k3") {
      delete body.thinking;
      if (disabled || effort === "minimal") effort = "low";
      if (effort === "medium" || effort === "xhigh") effort = "high";
      if (effort === "ultra") effort = "max";
      setEffort(body, effort, ["low", "high", "max"]);
    } else {
      delete body.reasoning_effort;
      body.thinking = model.startsWith("kimi-k2.7-code")
        ? { type: "enabled", keep: "all" }
        : { type: disabled ? "disabled" : "enabled" };
      if (body.tool_choice === "required") body.tool_choice = "auto";
    }
    return;
  }

  if (provider === "z-ai") {
    // https://docs.z.ai/guides/llm/glm-5.3
    // https://docs.z.ai/guides/vlm/glm-5.3-flash
    body.thinking = { type: "enabled", clear_thinking: false };
    if (disabled || effort === "minimal") effort = "low";
    if (effort === "medium" || effort === "xhigh") effort = "high";
    if (effort === "ultra") effort = "max";
    setEffort(body, effort, ["low", "high", "max"]);
    return;
  }

  if (provider === "minimax") {
    // https://platform.minimax.io/docs/api-reference/text-openai-api
    delete body.reasoning_effort;
    if (model === "MiniMax-M3") body.thinking = { type: disabled ? "disabled" : "adaptive" };
    else delete body.thinking; // M2.7 always thinks and has no effort control.
    if (body.max_tokens !== undefined) {
      if (body.max_completion_tokens === undefined) body.max_completion_tokens = body.max_tokens;
      delete body.max_tokens;
    }
    // Keep native <think> content intact. reasoning_split would require replay
    // of reasoning_details, a different wire format from reasoning_content.
    return;
  }

  // https://docs.qwencloud.com/api-reference/chat/openai-chat
  // max_tokens excludes thinking on Qwen; reserve the same total generation
  // budget for reasoning and final text rather than allowing unbounded thought.
  if (body.max_tokens !== undefined) {
    if (body.max_completion_tokens === undefined) body.max_completion_tokens = body.max_tokens;
    delete body.max_tokens;
  }
  body.enable_thinking = !disabled;
  if (disabled) delete body.reasoning_effort;
  else {
    if (effort === "minimal") effort = "low";
    if (effort === "high" || effort === "max" || effort === "ultra") effort = "xhigh";
    setEffort(body, effort, ["low", "medium", "xhigh"]);
    // These controls are mutually exclusive. The explicit catalog effort wins.
    if (body.reasoning_effort !== undefined) delete body.thinking_budget;
  }
  if (body.tool_choice === "required" || (!disabled && body.tool_choice && typeof body.tool_choice === "object")) body.tool_choice = "auto";
  delete body.thinking;
  body.preserve_thinking = true;
}
