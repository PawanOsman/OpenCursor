/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

/*!
 * OpenCursor model catalog.
 * MIT License
 * 
 * Copyright (c) 2024-2026 decolua and contributors
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
/** OpenCursor's provider-scoped chat models and supported request formats. */
export interface ProviderModelSpec { id:string; name:string; kind:string; contextLength?:number; upstreamModelId?:string; targetFormat?:string; supportedFormats?:string[]; }
export const PROVIDER_MODELS: ProviderModelSpec[] = [
  {
    "id": "qwen3.5-plus",
    "name": "Qwen3.5 Plus",
    "kind": "alicode-intl"
  },
  {
    "id": "kimi-k2.5",
    "name": "Kimi K2.5",
    "kind": "alicode-intl"
  },
  {
    "id": "glm-5",
    "name": "GLM 5",
    "kind": "alicode-intl"
  },
  {
    "id": "MiniMax-M2.5",
    "name": "MiniMax M2.5",
    "kind": "alicode-intl"
  },
  {
    "id": "qwen3-coder-next",
    "name": "Qwen3 Coder Next",
    "kind": "alicode-intl"
  },
  {
    "id": "qwen3-coder-plus",
    "name": "Qwen3 Coder Plus",
    "kind": "alicode-intl"
  },
  {
    "id": "glm-4.7",
    "name": "GLM 4.7",
    "kind": "alicode-intl"
  },
  {
    "id": "qwen3.5-plus",
    "name": "Qwen3.5 Plus",
    "kind": "alicode"
  },
  {
    "id": "kimi-k2.5",
    "name": "Kimi K2.5",
    "kind": "alicode"
  },
  {
    "id": "glm-5",
    "name": "GLM 5",
    "kind": "alicode"
  },
  {
    "id": "MiniMax-M2.5",
    "name": "MiniMax M2.5",
    "kind": "alicode"
  },
  {
    "id": "qwen3-max-2026-01-23",
    "name": "Qwen3 Max",
    "kind": "alicode"
  },
  {
    "id": "qwen3-coder-next",
    "name": "Qwen3 Coder Next",
    "kind": "alicode"
  },
  {
    "id": "qwen3-coder-plus",
    "name": "Qwen3 Coder Plus",
    "kind": "alicode"
  },
  {
    "id": "glm-4.7",
    "name": "GLM 4.7",
    "kind": "alicode"
  },
  {
    "id": "claude-sonnet-4-20250514",
    "name": "Claude Sonnet 4",
    "kind": "anthropic"
  },
  {
    "id": "claude-opus-4-20250514",
    "name": "Claude Opus 4",
    "kind": "anthropic"
  },
  {
    "id": "claude-3-5-sonnet-20241022",
    "name": "Claude 3.5 Sonnet",
    "kind": "anthropic"
  },
  {
    "id": "gemini-3.8-flash-high",
    "name": "Gemini 3.8 Flash (High)",
    "kind": "antigravity",
    "upstreamModelId": "gemini-3.8-flash-high(high)"
  },
  {
    "id": "gemini-3.8-flash-medium",
    "name": "Gemini 3.8 Flash (Medium)",
    "kind": "antigravity",
    "upstreamModelId": "gemini-3.8-flash-medium(medium)"
  },
  {
    "id": "gemini-3.8-flash-low",
    "name": "Gemini 3.8 Flash (Low)",
    "kind": "antigravity",
    "upstreamModelId": "gemini-3.8-flash-low(low)"
  },
  {
    "id": "gemini-3.8-flash",
    "name": "Gemini 3.8 Flash",
    "kind": "antigravity",
    "upstreamModelId": "gemini-3.8-flash-medium(medium)"
  },
  {
    "id": "gemini-3.7-flash-high",
    "name": "Gemini 3.7 Flash (High)",
    "kind": "antigravity",
    "upstreamModelId": "gemini-3.7-flash-tiered(high)"
  },
  {
    "id": "gemini-3.7-flash-medium",
    "name": "Gemini 3.7 Flash (Medium)",
    "kind": "antigravity",
    "upstreamModelId": "gemini-3.7-flash-tiered(medium)"
  },
  {
    "id": "gemini-3.7-flash-low",
    "name": "Gemini 3.7 Flash (Low)",
    "kind": "antigravity",
    "upstreamModelId": "gemini-3.7-flash-tiered(low)"
  },
  {
    "id": "gemini-3.6-flash-high",
    "name": "Gemini 3.6 Flash (High)",
    "kind": "antigravity",
    "upstreamModelId": "gemini-3.6-flash-tiered(high)"
  },
  {
    "id": "gemini-3.6-flash-medium",
    "name": "Gemini 3.6 Flash (Medium)",
    "kind": "antigravity",
    "upstreamModelId": "gemini-3.6-flash-tiered(medium)"
  },
  {
    "id": "gemini-3.6-flash-low",
    "name": "Gemini 3.6 Flash (Low)",
    "kind": "antigravity",
    "upstreamModelId": "gemini-3.6-flash-tiered(low)"
  },
  {
    "id": "gemini-3.5-flash-high",
    "name": "Gemini 3.5 Flash (High)",
    "kind": "antigravity"
  },
  {
    "id": "gemini-3-flash-agent",
    "name": "Gemini 3.5 Flash (High)",
    "kind": "antigravity"
  },
  {
    "id": "gemini-3.5-flash-low",
    "name": "Gemini 3.5 Flash (Medium)",
    "kind": "antigravity"
  },
  {
    "id": "gemini-3.5-flash-extra-low",
    "name": "Gemini 3.5 Flash (Low)",
    "kind": "antigravity"
  },
  {
    "id": "gemini-pro-agent",
    "name": "Gemini 3.1 Pro (High)",
    "kind": "antigravity"
  },
  {
    "id": "gemini-3.1-pro-low",
    "name": "Gemini 3.1 Pro (Low)",
    "kind": "antigravity"
  },
  {
    "id": "claude-sonnet-4-6",
    "name": "Claude Sonnet 4.6 (Thinking)",
    "kind": "antigravity"
  },
  {
    "id": "claude-opus-4-6-thinking",
    "name": "Claude Opus 4.6 (Thinking)",
    "kind": "antigravity"
  },
  {
    "id": "gpt-oss-120b-medium",
    "name": "GPT-OSS 120B (Medium)",
    "kind": "antigravity"
  },
  {
    "id": "gemini-3-flash",
    "name": "Gemini 3 Flash",
    "kind": "antigravity"
  },
  {
    "id": "claude-fable-5",
    "name": "Claude Fable 5",
    "kind": "blackbox",
    "upstreamModelId": "blackboxai/anthropic/claude-fable-5"
  },
  {
    "id": "claude-opus-4.8",
    "name": "Claude Opus 4.8",
    "kind": "blackbox",
    "upstreamModelId": "blackboxai/anthropic/claude-opus-4.8"
  },
  {
    "id": "claude-sonnet-4.6",
    "name": "Claude Sonnet 4.6",
    "kind": "blackbox",
    "upstreamModelId": "blackboxai/anthropic/claude-sonnet-4.6"
  },
  {
    "id": "gpt-5.5",
    "name": "GPT-5.5",
    "kind": "blackbox",
    "upstreamModelId": "blackboxai/openai/gpt-5.5"
  },
  {
    "id": "gpt-5.4-pro",
    "name": "GPT-5.4 Pro",
    "kind": "blackbox",
    "upstreamModelId": "blackboxai/openai/gpt-5.4-pro"
  },
  {
    "id": "gpt-5.4",
    "name": "GPT-5.4",
    "kind": "blackbox",
    "upstreamModelId": "blackboxai/openai/gpt-5.4"
  },
  {
    "id": "gpt-5.3-codex",
    "name": "GPT-5.3 Codex",
    "kind": "blackbox",
    "upstreamModelId": "blackboxai/openai/gpt-5.3-codex"
  },
  {
    "id": "gpt-5.4-nano",
    "name": "GPT-5.4 Nano",
    "kind": "blackbox",
    "upstreamModelId": "blackboxai/openai/gpt-5.4-nano"
  },
  {
    "id": "deepseek-v4-flash",
    "name": "DeepSeek V4 Flash",
    "kind": "blackbox",
    "upstreamModelId": "blackboxai/deepseek/deepseek-v4-flash"
  },
  {
    "id": "grok-4.3",
    "name": "Grok 4.3",
    "kind": "blackbox",
    "upstreamModelId": "blackboxai/x-ai/grok-4.3"
  },
  {
    "id": "seed-2-0-pro-260328",
    "name": "Seed 2.0 Pro",
    "kind": "byteplus"
  },
  {
    "id": "seed-2-0-code-preview-260328",
    "name": "Seed 2.0 Code Preview",
    "kind": "byteplus"
  },
  {
    "id": "seed-2-0-mini-260215",
    "name": "Seed 2.0 Mini",
    "kind": "byteplus"
  },
  {
    "id": "seed-2-0-lite-260228",
    "name": "Seed 2.0 Lite",
    "kind": "byteplus"
  },
  {
    "id": "kimi-k2-thinking-251104",
    "name": "Kimi K2 Thinking",
    "kind": "byteplus"
  },
  {
    "id": "glm-4-7-251222",
    "name": "GLM 4.7",
    "kind": "byteplus"
  },
  {
    "id": "gpt-oss-120b-250805",
    "name": "GPT-OSS-120B",
    "kind": "byteplus"
  },
  {
    "id": "gpt-oss-120b",
    "name": "GPT OSS 120B",
    "kind": "cerebras"
  },
  {
    "id": "zai-glm-4.7",
    "name": "ZAI GLM 4.7",
    "kind": "cerebras"
  },
  {
    "id": "llama-3.3-70b",
    "name": "Llama 3.3 70B",
    "kind": "cerebras"
  },
  {
    "id": "llama-4-scout-17b-16e-instruct",
    "name": "Llama 4 Scout",
    "kind": "cerebras"
  },
  {
    "id": "qwen-3-235b-a22b-instruct-2507",
    "name": "Qwen3 235B A22B",
    "kind": "cerebras"
  },
  {
    "id": "qwen-3-32b",
    "name": "Qwen3 32B",
    "kind": "cerebras"
  },
  {
    "id": "claude-opus-5-5",
    "name": "Claude Opus 5.5",
    "kind": "claude-code"
  },
  {
    "id": "claude-opus-5",
    "name": "Claude Opus 5",
    "kind": "claude-code"
  },
  {
    "id": "claude-fable-5-1",
    "name": "Claude Fable 5.1",
    "kind": "claude-code"
  },
  {
    "id": "claude-fable-5",
    "name": "Claude Fable 5",
    "kind": "claude-code"
  },
  {
    "id": "claude-sonnet-5",
    "name": "Claude Sonnet 5",
    "kind": "claude-code"
  },
  {
    "id": "claude-haiku-4-5-20251001",
    "name": "Claude 4.5 Haiku",
    "kind": "claude-code"
  },
  {
    "id": "anthropic/claude-opus-4.7",
    "name": "Claude Opus 4.7",
    "kind": "cline"
  },
  {
    "id": "anthropic/claude-sonnet-4.6",
    "name": "Claude Sonnet 4.6",
    "kind": "cline"
  },
  {
    "id": "anthropic/claude-opus-4.6",
    "name": "Claude Opus 4.6",
    "kind": "cline"
  },
  {
    "id": "openai/gpt-5.3-codex",
    "name": "GPT-5.3 Codex",
    "kind": "cline"
  },
  {
    "id": "openai/gpt-5.4",
    "name": "GPT-5.4",
    "kind": "cline"
  },
  {
    "id": "google/gemini-3.1-pro-preview",
    "name": "Gemini 3.1 Pro Preview",
    "kind": "cline"
  },
  {
    "id": "google/gemini-3.1-flash-lite-preview",
    "name": "Gemini 3.1 Flash Lite Preview",
    "kind": "cline"
  },
  {
    "id": "kwaipilot/kat-coder-pro",
    "name": "KAT Coder Pro",
    "kind": "cline"
  },
  {
    "id": "cline-pass/glm-5.2",
    "name": "GLM-5.2 (ClinePass)",
    "kind": "clinepass"
  },
  {
    "id": "cline-pass/kimi-k2.7-code",
    "name": "Kimi K2.7 Code (ClinePass)",
    "kind": "clinepass"
  },
  {
    "id": "cline-pass/kimi-k2.6",
    "name": "Kimi K2.6 (ClinePass)",
    "kind": "clinepass"
  },
  {
    "id": "cline-pass/deepseek-v4-pro",
    "name": "DeepSeek V4 Pro (ClinePass)",
    "kind": "clinepass"
  },
  {
    "id": "cline-pass/deepseek-v4-flash",
    "name": "DeepSeek V4 Flash (ClinePass)",
    "kind": "clinepass"
  },
  {
    "id": "cline-pass/mimo-v2.5",
    "name": "MiMo-V2.5 (ClinePass)",
    "kind": "clinepass"
  },
  {
    "id": "cline-pass/mimo-v2.5-pro",
    "name": "MiMo-V2.5-Pro (ClinePass)",
    "kind": "clinepass"
  },
  {
    "id": "cline-pass/minimax-m3",
    "name": "MiniMax M3 (ClinePass)",
    "kind": "clinepass"
  },
  {
    "id": "cline-pass/qwen3.7-max",
    "name": "Qwen3.7 Max (ClinePass)",
    "kind": "clinepass"
  },
  {
    "id": "cline-pass/qwen3.7-plus",
    "name": "Qwen3.7 Plus (ClinePass)",
    "kind": "clinepass"
  },
  {
    "id": "@cf/meta/llama-3.2-1b-instruct",
    "name": "Llama 3.2 1B Instruct",
    "kind": "cloudflare-ai"
  },
  {
    "id": "@cf/meta/llama-3.2-3b-instruct",
    "name": "Llama 3.2 3B Instruct",
    "kind": "cloudflare-ai"
  },
  {
    "id": "@cf/meta/llama-3.1-8b-instruct-fp8-fast",
    "name": "Llama 3.1 8B Instruct FP8 Fast",
    "kind": "cloudflare-ai"
  },
  {
    "id": "@cf/meta/llama-3.1-8b-instruct-awq",
    "name": "Llama 3.1 8B Instruct AWQ",
    "kind": "cloudflare-ai"
  },
  {
    "id": "@cf/mistralai/mistral-small-3.1-24b-instruct",
    "name": "Mistral Small 3.1 24B Instruct",
    "kind": "cloudflare-ai"
  },
  {
    "id": "@cf/meta/llama-3.1-70b-instruct-fp8-fast",
    "name": "Llama 3.1 70B Instruct FP8 Fast",
    "kind": "cloudflare-ai"
  },
  {
    "id": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    "name": "Llama 3.3 70B Instruct FP8 Fast",
    "kind": "cloudflare-ai"
  },
  {
    "id": "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
    "name": "DeepSeek R1 Distill Qwen 32B",
    "kind": "cloudflare-ai"
  },
  {
    "id": "@cf/moonshotai/kimi-k2.5",
    "name": "Kimi K2.5",
    "kind": "cloudflare-ai"
  },
  {
    "id": "@cf/moonshotai/kimi-k2.6",
    "name": "Kimi K2.6",
    "kind": "cloudflare-ai"
  },
  {
    "id": "@cf/zai-org/glm-4.7-flash",
    "name": "GLM 4.7 Flash",
    "kind": "cloudflare-ai"
  },
  {
    "id": "@cf/qwen/qwq-32b",
    "name": "QwQ 32B",
    "kind": "cloudflare-ai"
  },
  {
    "id": "@cf/qwen/qwen2.5-coder-32b-instruct",
    "name": "Qwen 2.5 Coder 32B Instruct",
    "kind": "cloudflare-ai"
  },
  {
    "id": "glm-5.2",
    "name": "GLM-5.2",
    "kind": "codebuddy-cn"
  },
  {
    "id": "glm-5.1",
    "name": "GLM-5.1",
    "kind": "codebuddy-cn"
  },
  {
    "id": "glm-5v-turbo",
    "name": "GLM-5v-Turbo",
    "kind": "codebuddy-cn"
  },
  {
    "id": "minimax-m3",
    "name": "MiniMax-M3",
    "kind": "codebuddy-cn"
  },
  {
    "id": "kimi-k2.7",
    "name": "Kimi-K2.7-Code",
    "kind": "codebuddy-cn"
  },
  {
    "id": "kimi-k2.6",
    "name": "Kimi-K2.6",
    "kind": "codebuddy-cn"
  },
  {
    "id": "hy3",
    "name": "Hy3",
    "kind": "codebuddy-cn"
  },
  {
    "id": "hy4-preview",
    "name": "Hy4-Preview",
    "kind": "codebuddy-cn"
  },
  {
    "id": "glm-5.3",
    "name": "GLM-5.3",
    "kind": "codebuddy-cn"
  },
  {
    "id": "glm-5.3-flash",
    "name": "GLM-5.3-Flash",
    "kind": "codebuddy-cn"
  },
  {
    "id": "kimi-k3-1",
    "name": "Kimi-K3",
    "kind": "codebuddy-cn"
  },
  {
    "id": "deepseek-v4-pro",
    "name": "DeepSeek-V4-Pro",
    "kind": "codebuddy-cn"
  },
  {
    "id": "deepseek-v4.1-flash",
    "name": "DeepSeek-V4.1-Flash",
    "kind": "codebuddy-cn"
  },
  {
    "id": "gpt-6-astra",
    "name": "GPT 6.0 Astra",
    "kind": "codex"
  },
  {
    "id": "gpt-5.6-sol",
    "name": "GPT 5.6 Sol",
    "kind": "codex"
  },
  {
    "id": "gpt-5.6-sol-review",
    "name": "GPT 5.6 Sol Review",
    "kind": "codex",
    "upstreamModelId": "gpt-5.6-sol"
  },
  {
    "id": "gpt-5.6-terra",
    "name": "GPT 5.6 Terra",
    "kind": "codex"
  },
  {
    "id": "gpt-5.6-terra-review",
    "name": "GPT 5.6 Terra Review",
    "kind": "codex",
    "upstreamModelId": "gpt-5.6-terra"
  },
  {
    "id": "gpt-5.6-luna",
    "name": "GPT 5.6 Luna",
    "kind": "codex"
  },
  {
    "id": "gpt-5.6-luna-review",
    "name": "GPT 5.6 Luna Review",
    "kind": "codex",
    "upstreamModelId": "gpt-5.6-luna"
  },
  {
    "id": "gpt-5.5",
    "name": "GPT 5.5",
    "kind": "codex"
  },
  {
    "id": "gpt-5.5-review",
    "name": "GPT 5.5 Review",
    "kind": "codex",
    "upstreamModelId": "gpt-5.5"
  },
  {
    "id": "gpt-5.4",
    "name": "GPT 5.4",
    "kind": "codex"
  },
  {
    "id": "gpt-5.4-review",
    "name": "GPT 5.4 Review",
    "kind": "codex",
    "upstreamModelId": "gpt-5.4"
  },
  {
    "id": "gpt-5.4-mini",
    "name": "GPT 5.4 Mini",
    "kind": "codex"
  },
  {
    "id": "gpt-5.4-mini-review",
    "name": "GPT 5.4 Mini Review",
    "kind": "codex",
    "upstreamModelId": "gpt-5.4-mini"
  },
  {
    "id": "gpt-5.3-codex-spark",
    "name": "GPT 5.3 Codex Spark",
    "kind": "codex"
  },
  {
    "id": "gpt-5.3-codex-spark-review",
    "name": "GPT 5.3 Codex Spark Review",
    "kind": "codex",
    "upstreamModelId": "gpt-5.3-codex-spark"
  },
  {
    "id": "codex-auto-review",
    "name": "Codex Auto Review",
    "kind": "codex",
    "upstreamModelId": "codex-auto-review"
  },
  {
    "id": "command-r-plus-08-2024",
    "name": "Command R+ (Aug 2024)",
    "kind": "cohere"
  },
  {
    "id": "command-r-08-2024",
    "name": "Command R (Aug 2024)",
    "kind": "cohere"
  },
  {
    "id": "command-a-03-2025",
    "name": "Command A (Mar 2025)",
    "kind": "cohere"
  },
  {
    "id": "deepseek/deepseek-v4-pro",
    "name": "DeepSeek V4 Pro",
    "kind": "commandcode"
  },
  {
    "id": "deepseek/deepseek-v4-flash",
    "name": "DeepSeek V4 Flash",
    "kind": "commandcode"
  },
  {
    "id": "moonshotai/Kimi-K2.7-Code",
    "name": "Kimi K2.7 Code",
    "kind": "commandcode"
  },
  {
    "id": "moonshotai/Kimi-K2.7-Code-Highspeed",
    "name": "Kimi K2.7 Code HighSpeed",
    "kind": "commandcode"
  },
  {
    "id": "moonshotai/Kimi-K2.6",
    "name": "Kimi K2.6",
    "kind": "commandcode"
  },
  {
    "id": "moonshotai/Kimi-K2.5",
    "name": "Kimi K2.5",
    "kind": "commandcode"
  },
  {
    "id": "zai-org/GLM-5.2",
    "name": "GLM 5.2",
    "kind": "commandcode"
  },
  {
    "id": "zai-org/GLM-5.2-Fast",
    "name": "GLM 5.2 Fast",
    "kind": "commandcode"
  },
  {
    "id": "zai-org/GLM-5.1",
    "name": "GLM 5.1",
    "kind": "commandcode"
  },
  {
    "id": "zai-org/GLM-5",
    "name": "GLM 5",
    "kind": "commandcode"
  },
  {
    "id": "MiniMaxAI/MiniMax-M3",
    "name": "MiniMax M3",
    "kind": "commandcode"
  },
  {
    "id": "MiniMaxAI/MiniMax-M2.7",
    "name": "MiniMax M2.7",
    "kind": "commandcode"
  },
  {
    "id": "MiniMaxAI/MiniMax-M2.5",
    "name": "MiniMax M2.5",
    "kind": "commandcode"
  },
  {
    "id": "xiaomi/mimo-v2.5-pro",
    "name": "MiMo V2.5 Pro",
    "kind": "commandcode"
  },
  {
    "id": "xiaomi/mimo-v2.5",
    "name": "MiMo V2.5",
    "kind": "commandcode"
  },
  {
    "id": "Qwen/Qwen3.6-Max-Preview",
    "name": "Qwen 3.6 Max Preview",
    "kind": "commandcode"
  },
  {
    "id": "Qwen/Qwen3.6-Plus",
    "name": "Qwen 3.6 Plus",
    "kind": "commandcode"
  },
  {
    "id": "Qwen/Qwen3.7-Max",
    "name": "Qwen 3.7 Max",
    "kind": "commandcode"
  },
  {
    "id": "Qwen/Qwen3.7-Plus",
    "name": "Qwen 3.7 Plus",
    "kind": "commandcode"
  },
  {
    "id": "stepfun/Step-3.7-Flash",
    "name": "Step 3.7 Flash",
    "kind": "commandcode"
  },
  {
    "id": "stepfun/Step-3.5-Flash",
    "name": "Step 3.5 Flash",
    "kind": "commandcode"
  },
  {
    "id": "nvidia/nemotron-3-ultra-550b-a55b",
    "name": "Nemotron 3 Ultra",
    "kind": "commandcode"
  },
  {
    "id": "default",
    "name": "Auto (Server Picks)",
    "kind": "cursor"
  },
  {
    "id": "claude-4.5-opus-high-thinking",
    "name": "Claude 4.5 Opus High Thinking",
    "kind": "cursor"
  },
  {
    "id": "claude-4.5-opus-high",
    "name": "Claude 4.5 Opus High",
    "kind": "cursor"
  },
  {
    "id": "claude-4.5-sonnet-thinking",
    "name": "Claude 4.5 Sonnet Thinking",
    "kind": "cursor"
  },
  {
    "id": "claude-4.5-sonnet",
    "name": "Claude 4.5 Sonnet",
    "kind": "cursor"
  },
  {
    "id": "claude-4.5-haiku",
    "name": "Claude 4.5 Haiku",
    "kind": "cursor"
  },
  {
    "id": "claude-4.5-opus",
    "name": "Claude 4.5 Opus",
    "kind": "cursor"
  },
  {
    "id": "gpt-5.2-codex",
    "name": "GPT 5.2 Codex",
    "kind": "cursor"
  },
  {
    "id": "claude-4.6-opus-max",
    "name": "Claude 4.6 Opus Max",
    "kind": "cursor"
  },
  {
    "id": "claude-4.6-sonnet-medium-thinking",
    "name": "Claude 4.6 Sonnet Medium Thinking",
    "kind": "cursor"
  },
  {
    "id": "kimi-k2.5",
    "name": "Kimi K2.5",
    "kind": "cursor"
  },
  {
    "id": "gemini-3-flash-preview",
    "name": "Gemini 3 Flash Preview",
    "kind": "cursor"
  },
  {
    "id": "gpt-5.2",
    "name": "GPT 5.2",
    "kind": "cursor"
  },
  {
    "id": "gpt-5.3-codex",
    "name": "GPT 5.3 Codex",
    "kind": "cursor"
  },
  {
    "id": "deepseek-v4-pro",
    "name": "DeepSeek V4 Pro",
    "kind": "deepseek"
  },
  {
    "id": "deepseek-v4-pro-max",
    "name": "DeepSeek V4 Pro Max",
    "kind": "deepseek",
    "upstreamModelId": "deepseek-v4-pro"
  },
  {
    "id": "deepseek-v4-pro-none",
    "name": "DeepSeek V4 Pro No Thinking",
    "kind": "deepseek",
    "upstreamModelId": "deepseek-v4-pro"
  },
  {
    "id": "deepseek-v4.1-flash",
    "name": "DeepSeek V4.1 Flash",
    "kind": "deepseek"
  },
  {
    "id": "deepseek-v4-flash",
    "name": "DeepSeek V4 Flash",
    "kind": "deepseek"
  },
  {
    "id": "deepseek-v4-flash-vision-exp",
    "name": "DeepSeek V4 Flash Vision (Exp)",
    "kind": "deepseek"
  },
  {
    "id": "deepseek-chat",
    "name": "DeepSeek V3.2 Chat",
    "kind": "deepseek"
  },
  {
    "id": "deepseek-reasoner",
    "name": "DeepSeek V3.2 Reasoner",
    "kind": "deepseek"
  },
  {
    "id": "deepseek-ai/DeepSeek-V4-Pro",
    "name": "DeepSeek V4 Pro",
    "kind": "featherless"
  },
  {
    "id": "deepseek-ai/DeepSeek-V4-Flash",
    "name": "DeepSeek V4 Flash",
    "kind": "featherless"
  },
  {
    "id": "zai-org/GLM-5.2",
    "name": "GLM 5.2",
    "kind": "featherless"
  },
  {
    "id": "zai-org/GLM-5.1",
    "name": "GLM 5.1",
    "kind": "featherless"
  },
  {
    "id": "moonshotai/Kimi-K2.7-Code",
    "name": "Kimi K2.7 Code",
    "kind": "featherless"
  },
  {
    "id": "moonshotai/Kimi-K2.6",
    "name": "Kimi K2.6",
    "kind": "featherless"
  },
  {
    "id": "moonshotai/Kimi-K2.5",
    "name": "Kimi K2.5",
    "kind": "featherless"
  },
  {
    "id": "accounts/fireworks/models/deepseek-v3p1",
    "name": "DeepSeek V3.1",
    "kind": "fireworks"
  },
  {
    "id": "accounts/fireworks/models/llama-v3p3-70b-instruct",
    "name": "Llama 3.3 70B",
    "kind": "fireworks"
  },
  {
    "id": "accounts/fireworks/models/qwen3-235b-a22b",
    "name": "Qwen3 235B",
    "kind": "fireworks"
  },
  {
    "id": "gemini-3.1-pro-preview",
    "name": "Gemini 3.1 Pro Preview",
    "kind": "gemini-cli"
  },
  {
    "id": "gemini-3-pro-preview",
    "name": "Gemini 3 Pro Preview",
    "kind": "gemini-cli"
  },
  {
    "id": "gemini-3-flash-preview",
    "name": "Gemini 3 Flash Preview",
    "kind": "gemini-cli"
  },
  {
    "id": "gemini-3.1-flash-lite-preview",
    "name": "Gemini 3.1 Flash Lite Preview",
    "kind": "gemini-cli"
  },
  {
    "id": "gemini-2.5-pro",
    "name": "Gemini 2.5 Pro",
    "kind": "gemini-cli"
  },
  {
    "id": "gemini-2.5-flash",
    "name": "Gemini 2.5 Flash",
    "kind": "gemini-cli"
  },
  {
    "id": "gemini-2.5-flash-lite",
    "name": "Gemini 2.5 Flash Lite",
    "kind": "gemini-cli"
  },
  {
    "id": "gemini-3.8-flash",
    "name": "Gemini 3.8 Flash",
    "kind": "google"
  },
  {
    "id": "gemini-3.7-flash",
    "name": "Gemini 3.7 Flash",
    "kind": "google"
  },
  {
    "id": "gemini-3.6-flash",
    "name": "Gemini 3.6 Flash",
    "kind": "google"
  },
  {
    "id": "gemini-3.5-flash-lite",
    "name": "Gemini 3.5 Flash Lite",
    "kind": "google"
  },
  {
    "id": "gemini-3.1-pro-preview",
    "name": "Gemini 3.1 Pro Preview",
    "kind": "google"
  },
  {
    "id": "gemini-3.1-flash-lite-preview",
    "name": "Gemini 3.1 Flash Lite Preview",
    "kind": "google"
  },
  {
    "id": "gemini-3-flash-preview",
    "name": "Gemini 3 Flash Preview",
    "kind": "google"
  },
  {
    "id": "gemini-2.5-pro",
    "name": "Gemini 2.5 Pro",
    "kind": "google"
  },
  {
    "id": "gemini-2.5-flash",
    "name": "Gemini 2.5 Flash",
    "kind": "google"
  },
  {
    "id": "gemini-2.5-flash-lite",
    "name": "Gemini 2.5 Flash Lite",
    "kind": "google"
  },
  {
    "id": "gemma-4-31b-it",
    "name": "Gemma 4 31B IT",
    "kind": "google"
  },
  {
    "id": "gpt-5.2",
    "name": "GPT-5.2",
    "kind": "github"
  },
  {
    "id": "gpt-5.2-codex",
    "name": "GPT-5.2 Codex",
    "kind": "github"
  },
  {
    "id": "gpt-5.3-codex",
    "name": "GPT-5.3 Codex",
    "kind": "github"
  },
  {
    "id": "gpt-5.4",
    "name": "GPT-5.4",
    "kind": "github"
  },
  {
    "id": "gpt-5.4-mini",
    "name": "GPT-5.4 Mini",
    "kind": "github"
  },
  {
    "id": "claude-haiku-4.5",
    "name": "Claude Haiku 4.5",
    "kind": "github"
  },
  {
    "id": "claude-opus-4.5",
    "name": "Claude Opus 4.5",
    "kind": "github"
  },
  {
    "id": "claude-sonnet-4.5",
    "name": "Claude Sonnet 4.5",
    "kind": "github"
  },
  {
    "id": "claude-sonnet-4.6",
    "name": "Claude Sonnet 4.6",
    "kind": "github"
  },
  {
    "id": "claude-opus-4.6",
    "name": "Claude Opus 4.6",
    "kind": "github"
  },
  {
    "id": "claude-opus-4.7",
    "name": "Claude Opus 4.7",
    "kind": "github"
  },
  {
    "id": "gemini-2.5-pro",
    "name": "Gemini 2.5 Pro",
    "kind": "github"
  },
  {
    "id": "gemini-3-flash-preview",
    "name": "Gemini 3 Flash",
    "kind": "github"
  },
  {
    "id": "gemini-3.1-pro-preview",
    "name": "Gemini 3.1 Pro",
    "kind": "github"
  },
  {
    "id": "grok-code-fast-1",
    "name": "Grok Code Fast 1",
    "kind": "github"
  },
  {
    "id": "oswe-vscode-prime",
    "name": "Raptor Mini",
    "kind": "github"
  },
  {
    "id": "goldeneye-free-auto",
    "name": "GoldenEye",
    "kind": "github"
  },
  {
    "id": "glm-5.3",
    "name": "GLM 5.3",
    "kind": "glm-cn"
  },
  {
    "id": "glm-5.3-flash",
    "name": "GLM 5.3 Flash (Vision)",
    "kind": "glm-cn"
  },
  {
    "id": "glm-5.2",
    "name": "GLM 5.2",
    "kind": "glm-cn"
  },
  {
    "id": "glm-5.1",
    "name": "GLM 5.1",
    "kind": "glm-cn"
  },
  {
    "id": "glm-5-turbo",
    "name": "GLM 5 Turbo",
    "kind": "glm-cn"
  },
  {
    "id": "glm-5",
    "name": "GLM 5",
    "kind": "glm-cn"
  },
  {
    "id": "glm-4.7",
    "name": "GLM-4.7",
    "kind": "glm-cn"
  },
  {
    "id": "glm-4.6v",
    "name": "GLM 4.6V (Vision)",
    "kind": "glm-cn"
  },
  {
    "id": "glm-4.6",
    "name": "GLM-4.6",
    "kind": "glm-cn"
  },
  {
    "id": "glm-4.5-air",
    "name": "GLM-4.5-Air",
    "kind": "glm-cn"
  },
  {
    "id": "glm-5.3",
    "name": "GLM 5.3",
    "kind": "glm"
  },
  {
    "id": "glm-5.3-flash",
    "name": "GLM 5.3 Flash (Vision)",
    "kind": "glm"
  },
  {
    "id": "glm-5.2",
    "name": "GLM 5.2",
    "kind": "glm"
  },
  {
    "id": "glm-5.1",
    "name": "GLM 5.1",
    "kind": "glm"
  },
  {
    "id": "glm-5-turbo",
    "name": "GLM 5 Turbo",
    "kind": "glm"
  },
  {
    "id": "glm-5",
    "name": "GLM 5",
    "kind": "glm"
  },
  {
    "id": "glm-4.7",
    "name": "GLM 4.7",
    "kind": "glm"
  },
  {
    "id": "glm-4.6v",
    "name": "GLM 4.6V (Vision)",
    "kind": "glm"
  },
  {
    "id": "grok-build",
    "name": "Grok Build",
    "kind": "grok-cli",
    "contextLength": 500000
  },
  {
    "id": "grok-4.5",
    "name": "Grok 4.5",
    "kind": "grok-cli"
  },
  {
    "id": "grok-4.5-high",
    "name": "Grok 4.5 (High)",
    "kind": "grok-cli",
    "upstreamModelId": "grok-4.5"
  },
  {
    "id": "grok-4.5-medium",
    "name": "Grok 4.5 (Medium)",
    "kind": "grok-cli",
    "upstreamModelId": "grok-4.5"
  },
  {
    "id": "grok-4.5-low",
    "name": "Grok 4.5 (Low)",
    "kind": "grok-cli",
    "upstreamModelId": "grok-4.5"
  },
  {
    "id": "llama-3.3-70b-versatile",
    "name": "Llama 3.3 70B",
    "kind": "groq"
  },
  {
    "id": "meta-llama/llama-4-maverick-17b-128e-instruct",
    "name": "Llama 4 Maverick",
    "kind": "groq"
  },
  {
    "id": "qwen/qwen3-32b",
    "name": "Qwen3 32B",
    "kind": "groq"
  },
  {
    "id": "openai/gpt-oss-120b",
    "name": "GPT-OSS 120B",
    "kind": "groq"
  },
  {
    "id": "Qwen/QwQ-32B",
    "name": "QwQ 32B",
    "kind": "hyperbolic"
  },
  {
    "id": "deepseek-ai/DeepSeek-R1",
    "name": "DeepSeek R1",
    "kind": "hyperbolic"
  },
  {
    "id": "deepseek-ai/DeepSeek-V3",
    "name": "DeepSeek V3",
    "kind": "hyperbolic"
  },
  {
    "id": "meta-llama/Llama-3.3-70B-Instruct",
    "name": "Llama 3.3 70B",
    "kind": "hyperbolic"
  },
  {
    "id": "meta-llama/Llama-3.2-3B-Instruct",
    "name": "Llama 3.2 3B",
    "kind": "hyperbolic"
  },
  {
    "id": "Qwen/Qwen2.5-72B-Instruct",
    "name": "Qwen 2.5 72B",
    "kind": "hyperbolic"
  },
  {
    "id": "Qwen/Qwen2.5-Coder-32B-Instruct",
    "name": "Qwen 2.5 Coder 32B",
    "kind": "hyperbolic"
  },
  {
    "id": "NousResearch/Hermes-3-Llama-3.1-70B",
    "name": "Hermes 3 70B",
    "kind": "hyperbolic"
  },
  {
    "id": "anthropic/claude-sonnet-4-20250514",
    "name": "Claude Sonnet 4",
    "kind": "kilocode"
  },
  {
    "id": "anthropic/claude-opus-4-20250514",
    "name": "Claude Opus 4",
    "kind": "kilocode"
  },
  {
    "id": "google/gemini-2.5-pro",
    "name": "Gemini 2.5 Pro",
    "kind": "kilocode"
  },
  {
    "id": "google/gemini-2.5-flash",
    "name": "Gemini 2.5 Flash",
    "kind": "kilocode"
  },
  {
    "id": "openai/gpt-4.1",
    "name": "GPT-4.1",
    "kind": "kilocode"
  },
  {
    "id": "openai/o3",
    "name": "o3",
    "kind": "kilocode"
  },
  {
    "id": "deepseek/deepseek-chat",
    "name": "DeepSeek Chat",
    "kind": "kilocode"
  },
  {
    "id": "deepseek/deepseek-reasoner",
    "name": "DeepSeek Reasoner",
    "kind": "kilocode"
  },
  {
    "id": "minimax-m3",
    "name": "MiniMax-M3",
    "kind": "kimchi"
  },
  {
    "id": "kimi-k2.7",
    "name": "Kimi-K2.7",
    "kind": "kimchi"
  },
  {
    "id": "kimi-k2.6",
    "name": "Kimi-K2.6",
    "kind": "kimchi"
  },
  {
    "id": "kimi-k2.5",
    "name": "Kimi-K2.5",
    "kind": "kimchi"
  },
  {
    "id": "nemotron-3-ultra-fp4",
    "name": "Nemotron 3 Ultra FP4",
    "kind": "kimchi"
  },
  {
    "id": "minimax-m2.7",
    "name": "MiniMax-M2.7",
    "kind": "kimchi"
  },
  {
    "id": "claude-opus-4-6",
    "name": "Claude Opus 4.6",
    "kind": "kimchi"
  },
  {
    "id": "claude-sonnet-4-6",
    "name": "Claude Sonnet 4.6",
    "kind": "kimchi"
  },
  {
    "id": "kimi-k3",
    "name": "Kimi K3",
    "kind": "kimi"
  },
  {
    "id": "k3",
    "name": "Kimi K3 (Code)",
    "kind": "kimi"
  },
  {
    "id": "kimi-for-coding",
    "name": "Kimi for Coding",
    "kind": "kimi"
  },
  {
    "id": "kimi-for-coding-highspeed",
    "name": "Kimi for Coding Highspeed",
    "kind": "kimi"
  },
  {
    "id": "kimi-k2.7-code",
    "name": "Kimi K2.7 Code",
    "kind": "kimi"
  },
  {
    "id": "kimi-k2.7-code-highspeed",
    "name": "Kimi K2.7 Code Highspeed",
    "kind": "kimi"
  },
  {
    "id": "kimi-k2.6",
    "name": "Kimi K2.6",
    "kind": "kimi"
  },
  {
    "id": "kimi-k2.5",
    "name": "Kimi K2.5",
    "kind": "kimi"
  },
  {
    "id": "kimi-k2.5-thinking",
    "name": "Kimi K2.5 Thinking",
    "kind": "kimi"
  },
  {
    "id": "kimi-latest",
    "name": "Kimi Latest",
    "kind": "kimi"
  },
  {
    "id": "claude-opus-5",
    "name": "Claude Opus 5",
    "kind": "kiro"
  },
  {
    "id": "claude-opus-5-thinking",
    "name": "Claude Opus 5 (Thinking)",
    "kind": "kiro"
  },
  {
    "id": "claude-opus-5-agentic",
    "name": "Claude Opus 5 (Agentic)",
    "kind": "kiro"
  },
  {
    "id": "claude-opus-5-thinking-agentic",
    "name": "Claude Opus 5 (Thinking + Agentic)",
    "kind": "kiro"
  },
  {
    "id": "claude-opus-4.8",
    "name": "Claude Opus 4.8",
    "kind": "kiro"
  },
  {
    "id": "claude-opus-4.8-thinking",
    "name": "Claude Opus 4.8 (Thinking)",
    "kind": "kiro"
  },
  {
    "id": "claude-opus-4.8-agentic",
    "name": "Claude Opus 4.8 (Agentic)",
    "kind": "kiro"
  },
  {
    "id": "claude-opus-4.8-thinking-agentic",
    "name": "Claude Opus 4.8 (Thinking + Agentic)",
    "kind": "kiro"
  },
  {
    "id": "claude-opus-4.7",
    "name": "Claude Opus 4.7",
    "kind": "kiro"
  },
  {
    "id": "claude-opus-4.7-thinking",
    "name": "Claude Opus 4.7 (Thinking)",
    "kind": "kiro"
  },
  {
    "id": "claude-opus-4.7-agentic",
    "name": "Claude Opus 4.7 (Agentic)",
    "kind": "kiro"
  },
  {
    "id": "claude-opus-4.7-thinking-agentic",
    "name": "Claude Opus 4.7 (Thinking + Agentic)",
    "kind": "kiro"
  },
  {
    "id": "claude-opus-4.5",
    "name": "Claude Opus 4.5",
    "kind": "kiro"
  },
  {
    "id": "claude-opus-4.5-thinking",
    "name": "Claude Opus 4.5 (Thinking)",
    "kind": "kiro"
  },
  {
    "id": "claude-opus-4.5-agentic",
    "name": "Claude Opus 4.5 (Agentic)",
    "kind": "kiro"
  },
  {
    "id": "claude-opus-4.5-thinking-agentic",
    "name": "Claude Opus 4.5 (Thinking + Agentic)",
    "kind": "kiro"
  },
  {
    "id": "claude-sonnet-5",
    "name": "Claude Sonnet 5",
    "kind": "kiro"
  },
  {
    "id": "claude-sonnet-4.5",
    "name": "Claude Sonnet 4.5",
    "kind": "kiro"
  },
  {
    "id": "claude-haiku-4.5",
    "name": "Claude Haiku 4.5",
    "kind": "kiro"
  },
  {
    "id": "deepseek-3.2",
    "name": "DeepSeek 3.2",
    "kind": "kiro"
  },
  {
    "id": "qwen3-coder-next",
    "name": "Qwen3 Coder Next",
    "kind": "kiro"
  },
  {
    "id": "glm-5",
    "name": "GLM 5",
    "kind": "kiro"
  },
  {
    "id": "MiniMax-M2.5",
    "name": "MiniMax M2.5",
    "kind": "kiro"
  },
  {
    "id": "gpt-5.6-sol",
    "name": "GPT 5.6 Sol",
    "kind": "kiro",
    "contextLength": 272000,
    "upstreamModelId": "gpt-5.6-sol"
  },
  {
    "id": "gpt-5.6-terra",
    "name": "GPT 5.6 Terra",
    "kind": "kiro",
    "contextLength": 272000,
    "upstreamModelId": "gpt-5.6-terra"
  },
  {
    "id": "gpt-5.6-luna",
    "name": "GPT 5.6 Luna",
    "kind": "kiro",
    "contextLength": 272000,
    "upstreamModelId": "gpt-5.6-luna"
  },
  {
    "id": "claude-sonnet-5-thinking",
    "name": "Claude Sonnet 5 (Thinking)",
    "kind": "kiro"
  },
  {
    "id": "claude-sonnet-4.5-thinking",
    "name": "Claude Sonnet 4.5 (Thinking)",
    "kind": "kiro"
  },
  {
    "id": "claude-haiku-4.5-thinking",
    "name": "Claude Haiku 4.5 (Thinking)",
    "kind": "kiro"
  },
  {
    "id": "gpt-5.6-sol-thinking",
    "name": "GPT 5.6 Sol (Thinking)",
    "kind": "kiro",
    "contextLength": 272000,
    "upstreamModelId": "gpt-5.6-sol"
  },
  {
    "id": "gpt-5.6-terra-thinking",
    "name": "GPT 5.6 Terra (Thinking)",
    "kind": "kiro",
    "contextLength": 272000,
    "upstreamModelId": "gpt-5.6-terra"
  },
  {
    "id": "gpt-5.6-luna-thinking",
    "name": "GPT 5.6 Luna (Thinking)",
    "kind": "kiro",
    "contextLength": 272000,
    "upstreamModelId": "gpt-5.6-luna"
  },
  {
    "id": "claude-sonnet-5-agentic",
    "name": "Claude Sonnet 5 (Agentic)",
    "kind": "kiro"
  },
  {
    "id": "claude-sonnet-4.5-agentic",
    "name": "Claude Sonnet 4.5 (Agentic)",
    "kind": "kiro"
  },
  {
    "id": "claude-haiku-4.5-agentic",
    "name": "Claude Haiku 4.5 (Agentic)",
    "kind": "kiro"
  },
  {
    "id": "gpt-5.6-sol-agentic",
    "name": "GPT 5.6 Sol (Agentic)",
    "kind": "kiro",
    "contextLength": 272000,
    "upstreamModelId": "gpt-5.6-sol"
  },
  {
    "id": "gpt-5.6-terra-agentic",
    "name": "GPT 5.6 Terra (Agentic)",
    "kind": "kiro",
    "contextLength": 272000,
    "upstreamModelId": "gpt-5.6-terra"
  },
  {
    "id": "gpt-5.6-luna-agentic",
    "name": "GPT 5.6 Luna (Agentic)",
    "kind": "kiro",
    "contextLength": 272000,
    "upstreamModelId": "gpt-5.6-luna"
  },
  {
    "id": "claude-sonnet-5-thinking-agentic",
    "name": "Claude Sonnet 5 (Thinking + Agentic)",
    "kind": "kiro"
  },
  {
    "id": "claude-sonnet-4.5-thinking-agentic",
    "name": "Claude Sonnet 4.5 (Thinking + Agentic)",
    "kind": "kiro"
  },
  {
    "id": "claude-haiku-4.5-thinking-agentic",
    "name": "Claude Haiku 4.5 (Thinking + Agentic)",
    "kind": "kiro"
  },
  {
    "id": "gpt-5.6-sol-thinking-agentic",
    "name": "GPT 5.6 Sol (Thinking + Agentic)",
    "kind": "kiro",
    "contextLength": 272000,
    "upstreamModelId": "gpt-5.6-sol"
  },
  {
    "id": "gpt-5.6-terra-thinking-agentic",
    "name": "GPT 5.6 Terra (Thinking + Agentic)",
    "kind": "kiro",
    "contextLength": 272000,
    "upstreamModelId": "gpt-5.6-terra"
  },
  {
    "id": "gpt-5.6-luna-thinking-agentic",
    "name": "GPT 5.6 Luna (Thinking + Agentic)",
    "kind": "kiro",
    "contextLength": 272000,
    "upstreamModelId": "gpt-5.6-luna"
  },
  {
    "id": "MiniMax-M3",
    "name": "MiniMax M3",
    "kind": "minimax-cn",
    "targetFormat": "claude"
  },
  {
    "id": "MiniMax-M2.7",
    "name": "MiniMax M2.7",
    "kind": "minimax-cn"
  },
  {
    "id": "MiniMax-M2.5",
    "name": "MiniMax M2.5",
    "kind": "minimax-cn"
  },
  {
    "id": "MiniMax-M2.1",
    "name": "MiniMax M2.1",
    "kind": "minimax-cn"
  },
  {
    "id": "MiniMax-M3",
    "name": "MiniMax M3",
    "kind": "minimax",
    "targetFormat": "claude"
  },
  {
    "id": "MiniMax-M2.7",
    "name": "MiniMax M2.7",
    "kind": "minimax"
  },
  {
    "id": "MiniMax-M2.5",
    "name": "MiniMax M2.5",
    "kind": "minimax"
  },
  {
    "id": "MiniMax-M2.1",
    "name": "MiniMax M2.1",
    "kind": "minimax"
  },
  {
    "id": "mistral-large-latest",
    "name": "Mistral Large 3",
    "kind": "mistral"
  },
  {
    "id": "codestral-latest",
    "name": "Codestral",
    "kind": "mistral"
  },
  {
    "id": "mistral-medium-latest",
    "name": "Mistral Medium 3",
    "kind": "mistral"
  },
  {
    "id": "meta-llama/Llama-3.3-70B-Instruct",
    "name": "Llama 3.3 70B Instruct",
    "kind": "nebius"
  },
  {
    "id": "minimaxai/minimax-m2.7",
    "name": "MiniMax M2.7",
    "kind": "nvidia"
  },
  {
    "id": "minimaxai/minimax-m3",
    "name": "MiniMax M3",
    "kind": "nvidia"
  },
  {
    "id": "z-ai/glm-5.2",
    "name": "GLM 5.2",
    "kind": "nvidia"
  },
  {
    "id": "deepseek-ai/deepseek-v4-pro",
    "name": "DeepSeek V4 Pro",
    "kind": "nvidia"
  },
  {
    "id": "deepseek-ai/deepseek-v4-flash",
    "name": "DeepSeek V4 Flash",
    "kind": "nvidia"
  },
  {
    "id": "moonshotai/kimi-k2.6",
    "name": "Kimi K2.6",
    "kind": "nvidia"
  },
  {
    "id": "nvidia/nemotron-3-ultra-550b-a55b",
    "name": "Nemotron 3 Ultra",
    "kind": "nvidia"
  },
  {
    "id": "gpt-oss:120b",
    "name": "GPT OSS 120B",
    "kind": "ollama-cloud"
  },
  {
    "id": "kimi-k2.5",
    "name": "Kimi K2.5",
    "kind": "ollama-cloud"
  },
  {
    "id": "glm-5",
    "name": "GLM 5",
    "kind": "ollama-cloud"
  },
  {
    "id": "minimax-m2.5",
    "name": "MiniMax M2.5",
    "kind": "ollama-cloud"
  },
  {
    "id": "glm-4.7-flash",
    "name": "GLM 4.7 Flash",
    "kind": "ollama-cloud"
  },
  {
    "id": "qwen3.5",
    "name": "Qwen3.5",
    "kind": "ollama-cloud"
  },
  {
    "id": "minimax-m3",
    "name": "MiniMax M3",
    "kind": "ollama-cloud"
  },
  {
    "id": "deepseek-v4.1-flash:cloud",
    "name": "DeepSeek V4.1 Flash",
    "kind": "ollama-cloud"
  },
  {
    "id": "ultimate",
    "name": "Ultimate",
    "kind": "qoder-cn"
  },
  {
    "id": "auto",
    "name": "Auto",
    "kind": "qoder-cn"
  },
  {
    "id": "performance",
    "name": "Performance",
    "kind": "qoder-cn"
  },
  {
    "id": "efficient",
    "name": "Efficient",
    "kind": "qoder-cn"
  },
  {
    "id": "lite",
    "name": "Lite",
    "kind": "qoder-cn"
  },
  {
    "id": "qmodel_38max",
    "name": "Qwen3.8-Max",
    "kind": "qoder-cn"
  },
  {
    "id": "qmodel_latest",
    "name": "Qwen3.7-Max",
    "kind": "qoder-cn"
  },
  {
    "id": "qmodel",
    "name": "Qwen3.7-Plus",
    "kind": "qoder-cn"
  },
  {
    "id": "qfmodel",
    "name": "Qwen3.8-Flash",
    "kind": "qoder-cn"
  },
  {
    "id": "kmodel_latest",
    "name": "Kimi-K3",
    "kind": "qoder-cn"
  },
  {
    "id": "kmodel",
    "name": "Kimi-K2.7-Code",
    "kind": "qoder-cn"
  },
  {
    "id": "gmodel",
    "name": "GLM-5.3",
    "kind": "qoder-cn"
  },
  {
    "id": "gfmodel",
    "name": "GLM-5.3-Flash",
    "kind": "qoder-cn"
  },
  {
    "id": "dmodel",
    "name": "DeepSeek-V4-Pro",
    "kind": "qoder-cn"
  },
  {
    "id": "dfmodel",
    "name": "DeepSeek-V4-Flash",
    "kind": "qoder-cn"
  },
  {
    "id": "mmodel",
    "name": "MiniMax-M3",
    "kind": "qoder-cn"
  },
  {
    "id": "gpt-5.5",
    "name": "GPT-5.5",
    "kind": "openai"
  },
  {
    "id": "gpt-5.4",
    "name": "GPT-5.4",
    "kind": "openai"
  },
  {
    "id": "gpt-5.4-mini",
    "name": "GPT-5.4 Mini",
    "kind": "openai"
  },
  {
    "id": "gpt-5.4-nano",
    "name": "GPT-5.4 Nano",
    "kind": "openai"
  },
  {
    "id": "gpt-5.2",
    "name": "GPT-5.2",
    "kind": "openai"
  },
  {
    "id": "gpt-5.1",
    "name": "GPT-5.1",
    "kind": "openai"
  },
  {
    "id": "gpt-5",
    "name": "GPT-5",
    "kind": "openai"
  },
  {
    "id": "gpt-5-mini",
    "name": "GPT-5 Mini",
    "kind": "openai"
  },
  {
    "id": "gpt-5-nano",
    "name": "GPT-5 Nano",
    "kind": "openai"
  },
  {
    "id": "gpt-4o",
    "name": "GPT-4o",
    "kind": "openai"
  },
  {
    "id": "gpt-4o-mini",
    "name": "GPT-4o Mini",
    "kind": "openai"
  },
  {
    "id": "gpt-4-turbo",
    "name": "GPT-4 Turbo",
    "kind": "openai"
  },
  {
    "id": "gpt-4.1",
    "name": "GPT-4.1",
    "kind": "openai"
  },
  {
    "id": "gpt-4.1-mini",
    "name": "GPT-4.1 Mini",
    "kind": "openai"
  },
  {
    "id": "gpt-4.1-nano",
    "name": "GPT-4.1 Nano",
    "kind": "openai"
  },
  {
    "id": "o3",
    "name": "O3",
    "kind": "openai"
  },
  {
    "id": "o3-mini",
    "name": "O3 Mini",
    "kind": "openai"
  },
  {
    "id": "o3-pro",
    "name": "O3 Pro",
    "kind": "openai"
  },
  {
    "id": "o4-mini",
    "name": "O4 Mini",
    "kind": "openai"
  },
  {
    "id": "o1",
    "name": "O1",
    "kind": "openai"
  },
  {
    "id": "o1-mini",
    "name": "O1 Mini",
    "kind": "openai"
  },
  {
    "id": "deepseek-flash",
    "name": "DeepSeek V4.1 Flash",
    "kind": "opencode-go",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "glm-5.3-flash",
    "name": "GLM 5.3 Flash (Vision)",
    "kind": "opencode-go",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "glm-5.3",
    "name": "GLM 5.3",
    "kind": "opencode-go",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "glm-5.2",
    "name": "GLM 5.2",
    "kind": "opencode-go",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "glm-5.1",
    "name": "GLM 5.1",
    "kind": "opencode-go",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "kimi-k2.7-code",
    "name": "Kimi K2.7 Code",
    "kind": "opencode-go",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "kimi-k2.6",
    "name": "Kimi K2.6",
    "kind": "opencode-go",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "kimi-k3",
    "name": "Kimi K3",
    "kind": "opencode-go",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "deepseek-v4-pro",
    "name": "DeepSeek V4 Pro",
    "kind": "opencode-go",
    "supportedFormats": [
      "openai",
      "claude",
      "openai-responses"
    ]
  },
  {
    "id": "deepseek-v4-flash",
    "name": "DeepSeek V4 Flash",
    "kind": "opencode-go",
    "supportedFormats": [
      "openai",
      "claude",
      "openai-responses"
    ]
  },
  {
    "id": "deepseek-v4-flash-vision-exp",
    "name": "DeepSeek V4 Flash Vision (Exp)",
    "kind": "opencode-go",
    "supportedFormats": [
      "openai",
      "claude",
      "openai-responses"
    ]
  },
  {
    "id": "longcat-2.0",
    "name": "LongCat 2.0",
    "kind": "opencode-go",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "mimo-v2.5",
    "name": "MiMo V2.5",
    "kind": "opencode-go",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "mimo-v2.5-pro",
    "name": "MiMo V2.5 Pro",
    "kind": "opencode-go",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "minimax-m3",
    "name": "MiniMax M3",
    "kind": "opencode-go",
    "supportedFormats": [
      "openai",
      "claude"
    ]
  },
  {
    "id": "minimax-m2.7",
    "name": "MiniMax M2.7",
    "kind": "opencode-go",
    "supportedFormats": [
      "openai",
      "claude"
    ]
  },
  {
    "id": "minimax-m2.5",
    "name": "MiniMax M2.5",
    "kind": "opencode-go",
    "supportedFormats": [
      "openai",
      "claude"
    ]
  },
  {
    "id": "qwen3.8-max",
    "name": "Qwen 3.8 Max",
    "kind": "opencode-go",
    "supportedFormats": [
      "openai",
      "claude"
    ]
  },
  {
    "id": "qwen3.8-flash",
    "name": "Qwen 3.8 Flash",
    "kind": "opencode-go",
    "supportedFormats": [
      "openai",
      "claude"
    ]
  },
  {
    "id": "qwen3.7-max",
    "name": "Qwen 3.7 Max",
    "kind": "opencode-go",
    "supportedFormats": [
      "openai",
      "claude"
    ]
  },
  {
    "id": "qwen3.7-plus",
    "name": "Qwen 3.7 Plus",
    "kind": "opencode-go",
    "supportedFormats": [
      "openai",
      "claude"
    ]
  },
  {
    "id": "qwen3.6-plus",
    "name": "Qwen 3.6 Plus",
    "kind": "opencode-go",
    "supportedFormats": [
      "openai",
      "claude"
    ]
  },
  {
    "id": "hy4-preview",
    "name": "Hy4 Preview",
    "kind": "opencode-go",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "hy3",
    "name": "Hy3",
    "kind": "opencode-go",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "grok-4.6",
    "name": "Grok 4.6",
    "kind": "opencode-go",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "gpt-5.6-luna",
    "name": "GPT 5.6 Luna",
    "kind": "opencode-go",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "muse-spark-1.2-contributor",
    "name": "Muse Spark 1.2 Contributor",
    "kind": "opencode-go",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "muse-spark-1.3-contributor",
    "name": "Muse Spark 1.3 Contributor",
    "kind": "opencode-go",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "claude-fable-5",
    "name": "Claude Fable 5",
    "kind": "opencode-zen",
    "supportedFormats": [
      "claude"
    ]
  },
  {
    "id": "claude-fable-5-1",
    "name": "Claude Fable 5.1",
    "kind": "opencode-zen",
    "supportedFormats": [
      "claude"
    ]
  },
  {
    "id": "claude-opus-5",
    "name": "Claude Opus 5",
    "kind": "opencode-zen",
    "supportedFormats": [
      "claude"
    ]
  },
  {
    "id": "claude-opus-4-8",
    "name": "Claude Opus 4.8",
    "kind": "opencode-zen",
    "supportedFormats": [
      "claude"
    ]
  },
  {
    "id": "claude-opus-4-7",
    "name": "Claude Opus 4.7",
    "kind": "opencode-zen",
    "supportedFormats": [
      "claude"
    ]
  },
  {
    "id": "claude-opus-4-6",
    "name": "Claude Opus 4.6",
    "kind": "opencode-zen",
    "supportedFormats": [
      "claude"
    ]
  },
  {
    "id": "claude-opus-4-5",
    "name": "Claude Opus 4.5",
    "kind": "opencode-zen",
    "supportedFormats": [
      "claude"
    ]
  },
  {
    "id": "claude-sonnet-5",
    "name": "Claude Sonnet 5",
    "kind": "opencode-zen",
    "supportedFormats": [
      "claude"
    ]
  },
  {
    "id": "claude-sonnet-4-6",
    "name": "Claude Sonnet 4.6",
    "kind": "opencode-zen",
    "supportedFormats": [
      "claude"
    ]
  },
  {
    "id": "claude-sonnet-4-5",
    "name": "Claude Sonnet 4.5",
    "kind": "opencode-zen",
    "supportedFormats": [
      "claude"
    ]
  },
  {
    "id": "claude-sonnet-4",
    "name": "Claude Sonnet 4",
    "kind": "opencode-zen",
    "supportedFormats": [
      "claude"
    ]
  },
  {
    "id": "claude-haiku-4-5",
    "name": "Claude Haiku 4.5",
    "kind": "opencode-zen",
    "supportedFormats": [
      "claude"
    ]
  },
  {
    "id": "gemini-3.6-flash",
    "name": "Gemini 3.6 Flash",
    "kind": "opencode-zen",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "gemini-3.8-flash",
    "name": "Gemini 3.8 Flash",
    "kind": "opencode-zen",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "gemini-3.7-flash",
    "name": "Gemini 3.7 Flash",
    "kind": "opencode-zen",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "gemini-3.5-flash-lite",
    "name": "Gemini 3.5 Flash Lite",
    "kind": "opencode-zen",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "gemini-3.5-flash",
    "name": "Gemini 3.5 Flash",
    "kind": "opencode-zen",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "gemini-3.1-pro",
    "name": "Gemini 3.1 Pro",
    "kind": "opencode-zen",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "gemini-3-flash",
    "name": "Gemini 3 Flash",
    "kind": "opencode-zen",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "gpt-6-astra",
    "name": "GPT 6 Astra",
    "kind": "opencode-zen",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "gpt-5.6-sol",
    "name": "GPT 5.6 Sol",
    "kind": "opencode-zen",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "gpt-5.6-terra",
    "name": "GPT 5.6 Terra",
    "kind": "opencode-zen",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "gpt-5.6-luna",
    "name": "GPT 5.6 Luna",
    "kind": "opencode-zen",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "gpt-5.5",
    "name": "GPT 5.5",
    "kind": "opencode-zen",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "gpt-5.5-pro",
    "name": "GPT 5.5 Pro",
    "kind": "opencode-zen",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "gpt-5.4",
    "name": "GPT 5.4",
    "kind": "opencode-zen",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "gpt-5.4-pro",
    "name": "GPT 5.4 Pro",
    "kind": "opencode-zen",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "gpt-5.4-mini",
    "name": "GPT 5.4 Mini",
    "kind": "opencode-zen",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "gpt-5.4-nano",
    "name": "GPT 5.4 Nano",
    "kind": "opencode-zen",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "gpt-5.3-codex-spark",
    "name": "GPT 5.3 Codex Spark",
    "kind": "opencode-zen",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "gpt-5.3-codex",
    "name": "GPT 5.3 Codex",
    "kind": "opencode-zen",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "gpt-5.2",
    "name": "GPT 5.2",
    "kind": "opencode-zen",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "gpt-5.2-codex",
    "name": "GPT 5.2 Codex",
    "kind": "opencode-zen",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "gpt-5.1",
    "name": "GPT 5.1",
    "kind": "opencode-zen",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "gpt-5.1-codex-max",
    "name": "GPT 5.1 Codex Max",
    "kind": "opencode-zen",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "gpt-5.1-codex",
    "name": "GPT 5.1 Codex",
    "kind": "opencode-zen",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "gpt-5.1-codex-mini",
    "name": "GPT 5.1 Codex Mini",
    "kind": "opencode-zen",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "gpt-5",
    "name": "GPT 5",
    "kind": "opencode-zen",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "gpt-5-codex",
    "name": "GPT 5 Codex",
    "kind": "opencode-zen",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "gpt-5-nano",
    "name": "GPT 5 Nano",
    "kind": "opencode-zen",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "grok-build-0.1",
    "name": "Grok Build 0.1",
    "kind": "opencode-zen",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "grok-4.6",
    "name": "Grok 4.6",
    "kind": "opencode-zen",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "grok-4.5",
    "name": "Grok 4.5",
    "kind": "opencode-zen",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "muse-spark-1.3",
    "name": "Muse Spark 1.3",
    "kind": "opencode-zen",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "muse-spark-1.2",
    "name": "Muse Spark 1.2",
    "kind": "opencode-zen",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "qwen3.6-plus",
    "name": "Qwen 3.6 Plus",
    "kind": "opencode-zen",
    "supportedFormats": [
      "claude"
    ]
  },
  {
    "id": "qwen3.5-plus",
    "name": "Qwen 3.5 Plus",
    "kind": "opencode-zen",
    "supportedFormats": [
      "claude"
    ]
  },
  {
    "id": "deepseek-v4-pro",
    "name": "DeepSeek V4 Pro",
    "kind": "opencode-zen",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "deepseek-v4-flash",
    "name": "DeepSeek V4 Flash",
    "kind": "opencode-zen",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "deepseek-v4-flash-vision-exp",
    "name": "DeepSeek V4 Flash Vision Exp",
    "kind": "opencode-zen",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "glm-5.3-flash",
    "name": "GLM 5.3 Flash (Vision)",
    "kind": "opencode-zen",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "glm-5.3",
    "name": "GLM 5.3",
    "kind": "opencode-zen",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "glm-5.2",
    "name": "GLM 5.2",
    "kind": "opencode-zen",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "glm-5.1",
    "name": "GLM 5.1",
    "kind": "opencode-zen",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "glm-5",
    "name": "GLM 5",
    "kind": "opencode-zen",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "minimax-m3",
    "name": "MiniMax M3",
    "kind": "opencode-zen",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "minimax-m2.7",
    "name": "MiniMax M2.7",
    "kind": "opencode-zen",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "minimax-m2.5",
    "name": "MiniMax M2.5",
    "kind": "opencode-zen",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "kimi-k3",
    "name": "Kimi K3",
    "kind": "opencode-zen",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "kimi-k2.7-code",
    "name": "Kimi K2.7 Code",
    "kind": "opencode-zen",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "kimi-k2.6",
    "name": "Kimi K2.6",
    "kind": "opencode-zen",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "kimi-k2.5",
    "name": "Kimi K2.5",
    "kind": "opencode-zen",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "big-pickle",
    "name": "Big Pickle",
    "kind": "opencode-zen",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "union-alpha",
    "name": "Union Alpha",
    "kind": "opencode-zen",
    "supportedFormats": [
      "claude"
    ]
  },
  {
    "id": "deepseek-v4-flash-free",
    "name": "DeepSeek V4 Flash Free",
    "kind": "opencode-zen",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "mimo-v2.6-flash-free",
    "name": "MiMo V2.6 Flash Free",
    "kind": "opencode-zen",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "mimo-v2.5-free",
    "name": "MiMo V2.5 Free",
    "kind": "opencode-zen",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "ling-3.0-flash-fin-free",
    "name": "Ling 3.0 Flash Fin Free",
    "kind": "opencode-zen",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "nemotron-3-ultra-free",
    "name": "Nemotron 3 Ultra Free",
    "kind": "opencode-zen",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "nemotron-3.5-lightning-free",
    "name": "Nemotron 3.5 Lightning Free",
    "kind": "opencode-zen",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "muse-spark-1.3-contributor-free",
    "name": "Muse Spark 1.3 Contributor Free",
    "kind": "opencode-zen",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "muse-spark-1.2-contributor-free",
    "name": "Muse Spark 1.2 Contributor Free",
    "kind": "opencode-zen",
    "targetFormat": "openai-responses",
    "supportedFormats": [
      "openai-responses"
    ]
  },
  {
    "id": "muse-spark-1.2-contributor-free",
    "name": "Muse Spark 1.2 Contributor Free",
    "kind": "opencode",
    "targetFormat": "openai-responses"
  },
  {
    "id": "muse-spark-1.3-contributor-free",
    "name": "Muse Spark 1.3 Contributor Free",
    "kind": "opencode",
    "targetFormat": "openai-responses"
  },
  {
    "id": "union-alpha",
    "name": "Union Alpha Free",
    "kind": "opencode",
    "targetFormat": "claude"
  },
  {
    "id": "sonar-pro",
    "name": "Sonar Pro",
    "kind": "perplexity"
  },
  {
    "id": "sonar",
    "name": "Sonar",
    "kind": "perplexity"
  },
  {
    "id": "perplexity/sonar",
    "name": "Perplexity Sonar",
    "kind": "perplexity-agent"
  },
  {
    "id": "openai/gpt-5.5",
    "name": "GPT-5.5",
    "kind": "perplexity-agent"
  },
  {
    "id": "openai/gpt-5.4",
    "name": "GPT-5.4",
    "kind": "perplexity-agent"
  },
  {
    "id": "openai/gpt-5.4-mini",
    "name": "GPT-5.4 Mini",
    "kind": "perplexity-agent"
  },
  {
    "id": "anthropic/claude-sonnet-4-6",
    "name": "Claude Sonnet 4.6",
    "kind": "perplexity-agent"
  },
  {
    "id": "anthropic/claude-opus-4-8",
    "name": "Claude Opus 4.8",
    "kind": "perplexity-agent"
  },
  {
    "id": "google/gemini-3.1-pro-preview",
    "name": "Gemini 3.1 Pro",
    "kind": "perplexity-agent"
  },
  {
    "id": "xai/grok-4.20-reasoning",
    "name": "Grok 4.20 Reasoning",
    "kind": "perplexity-agent"
  },
  {
    "id": "perplexity/glm-5.2",
    "name": "GLM 5.2",
    "kind": "perplexity-agent"
  },
  {
    "id": "perplexity/kimi-k2.7-code",
    "name": "Kimi K2.7 Code",
    "kind": "perplexity-agent"
  },
  {
    "id": "nvidia/nemotron-3-super-120b-a12b",
    "name": "Nemotron 3 Super 120B",
    "kind": "perplexity-agent"
  },
  {
    "id": "ultimate",
    "name": "Ultimate",
    "kind": "qoder"
  },
  {
    "id": "auto",
    "name": "Auto",
    "kind": "qoder"
  },
  {
    "id": "performance",
    "name": "Performance",
    "kind": "qoder"
  },
  {
    "id": "efficient",
    "name": "Efficient",
    "kind": "qoder"
  },
  {
    "id": "lite",
    "name": "Lite",
    "kind": "qoder"
  },
  {
    "id": "qmodel_38max",
    "name": "Qwen3.8-Max",
    "kind": "qoder"
  },
  {
    "id": "qmodel_latest",
    "name": "Qwen3.7-Max",
    "kind": "qoder"
  },
  {
    "id": "qmodel",
    "name": "Qwen3.7-Plus",
    "kind": "qoder"
  },
  {
    "id": "qfmodel",
    "name": "Qwen3.8-Flash",
    "kind": "qoder"
  },
  {
    "id": "kmodel_latest",
    "name": "Kimi-K3",
    "kind": "qoder"
  },
  {
    "id": "kmodel",
    "name": "Kimi-K2.7-Code",
    "kind": "qoder"
  },
  {
    "id": "gmodel",
    "name": "GLM-5.3",
    "kind": "qoder"
  },
  {
    "id": "gfmodel",
    "name": "GLM-5.3-Flash",
    "kind": "qoder"
  },
  {
    "id": "dmodel",
    "name": "DeepSeek-V4-Pro",
    "kind": "qoder"
  },
  {
    "id": "dfmodel",
    "name": "DeepSeek-V4-Flash",
    "kind": "qoder"
  },
  {
    "id": "mmodel",
    "name": "MiniMax-M3",
    "kind": "qoder"
  },
  {
    "id": "deepseek-ai/DeepSeek-V4-Pro",
    "name": "DeepSeek V4 Pro",
    "kind": "siliconflow"
  },
  {
    "id": "deepseek-ai/DeepSeek-V4-Flash",
    "name": "DeepSeek V4 Flash",
    "kind": "siliconflow"
  },
  {
    "id": "deepseek-ai/DeepSeek-V3.2",
    "name": "DeepSeek V3.2",
    "kind": "siliconflow"
  },
  {
    "id": "deepseek-ai/DeepSeek-V3.2-Exp",
    "name": "DeepSeek V3.2 Exp",
    "kind": "siliconflow"
  },
  {
    "id": "deepseek-ai/DeepSeek-V3.1",
    "name": "DeepSeek V3.1",
    "kind": "siliconflow"
  },
  {
    "id": "deepseek-ai/DeepSeek-V3.1-Terminus",
    "name": "DeepSeek V3.1 Terminus",
    "kind": "siliconflow"
  },
  {
    "id": "deepseek-ai/DeepSeek-R1",
    "name": "DeepSeek R1",
    "kind": "siliconflow"
  },
  {
    "id": "Qwen/Qwen3.5-397B-A17B",
    "name": "Qwen 3.5 397B A17B",
    "kind": "siliconflow"
  },
  {
    "id": "Qwen/Qwen3.5-122B-A10B",
    "name": "Qwen 3.5 122B A10B",
    "kind": "siliconflow"
  },
  {
    "id": "zai-org/GLM-5.1",
    "name": "GLM 5.1",
    "kind": "siliconflow"
  },
  {
    "id": "zai-org/GLM-5",
    "name": "GLM 5",
    "kind": "siliconflow"
  },
  {
    "id": "moonshotai/Kimi-K2.6",
    "name": "Kimi K2.6",
    "kind": "siliconflow"
  },
  {
    "id": "moonshotai/Kimi-K2.5",
    "name": "Kimi K2.5",
    "kind": "siliconflow"
  },
  {
    "id": "openai/gpt-oss-120b",
    "name": "GPT OSS 120B",
    "kind": "siliconflow"
  },
  {
    "id": "MiniMaxAI/MiniMax-M2.5",
    "name": "MiniMax M2.5",
    "kind": "siliconflow"
  },
  {
    "id": "inclusionAI/Ling-flash-2.0",
    "name": "Ling Flash 2.0",
    "kind": "siliconflow"
  },
  {
    "id": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    "name": "Llama 3.3 70B Turbo",
    "kind": "together"
  },
  {
    "id": "deepseek-ai/DeepSeek-R1",
    "name": "DeepSeek R1",
    "kind": "together"
  },
  {
    "id": "Qwen/Qwen3-235B-A22B",
    "name": "Qwen3 235B",
    "kind": "together"
  },
  {
    "id": "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
    "name": "Llama 4 Maverick",
    "kind": "together"
  },
  {
    "id": "venice-uncensored-1-2",
    "name": "Venice Uncensored 1.2",
    "kind": "venice"
  },
  {
    "id": "zai-org-glm-5",
    "name": "GLM-5",
    "kind": "venice"
  },
  {
    "id": "qwen3-235b-a22b-instruct-2507",
    "name": "Qwen3 235B A22B Instruct",
    "kind": "venice"
  },
  {
    "id": "qwen3-coder-480b-a35b-instruct-turbo",
    "name": "Qwen3 Coder 480B A35B Turbo",
    "kind": "venice"
  },
  {
    "id": "qwen3-vl-235b-a22b",
    "name": "Qwen3 VL 235B A22B",
    "kind": "venice"
  },
  {
    "id": "deepseek-v4-pro",
    "name": "DeepSeek V4 Pro",
    "kind": "venice"
  },
  {
    "id": "llama-3.3-70b",
    "name": "Llama 3.3 70B",
    "kind": "venice"
  },
  {
    "id": "hermes-3-llama-3.1-405b",
    "name": "Hermes 3 Llama 3.1 405B",
    "kind": "venice"
  },
  {
    "id": "mistral-small-3-2-24b-instruct",
    "name": "Mistral Small 3.2 24B",
    "kind": "venice"
  },
  {
    "id": "deepseek-ai/deepseek-v3.2-maas",
    "name": "DeepSeek V3.2 (Vertex)",
    "kind": "vertex-partner"
  },
  {
    "id": "qwen/qwen3-next-80b-a3b-thinking-maas",
    "name": "Qwen3 Next 80B Thinking (Vertex)",
    "kind": "vertex-partner"
  },
  {
    "id": "qwen/qwen3-next-80b-a3b-instruct-maas",
    "name": "Qwen3 Next 80B Instruct (Vertex)",
    "kind": "vertex-partner"
  },
  {
    "id": "zai-org/glm-5-maas",
    "name": "GLM-5 (Vertex)",
    "kind": "vertex-partner"
  },
  {
    "id": "gemini-3.1-pro-preview",
    "name": "Gemini 3.1 Pro Preview",
    "kind": "vertex"
  },
  {
    "id": "gemini-3.1-flash-lite-preview",
    "name": "Gemini 3.1 Flash Lite Preview",
    "kind": "vertex"
  },
  {
    "id": "gemini-3-flash-preview",
    "name": "Gemini 3 Flash Preview",
    "kind": "vertex"
  },
  {
    "id": "gemini-2.5-flash",
    "name": "Gemini 2.5 Flash",
    "kind": "vertex"
  },
  {
    "id": "Doubao-Seed-2.0-Code",
    "name": "Doubao-Seed-2.0-Code",
    "kind": "volcengine-ark"
  },
  {
    "id": "Doubao-Seed-2.0-pro",
    "name": "Doubao-Seed-2.0-pro",
    "kind": "volcengine-ark"
  },
  {
    "id": "Doubao-Seed-2.0-lite",
    "name": "Doubao-Seed-2.0-lite",
    "kind": "volcengine-ark"
  },
  {
    "id": "Doubao-Seed-Code",
    "name": "Doubao-Seed-Code",
    "kind": "volcengine-ark"
  },
  {
    "id": "DeepSeek-V4-Flash",
    "name": "DeepSeek-V4-Flash",
    "kind": "volcengine-ark"
  },
  {
    "id": "DeepSeek-V4-Pro",
    "name": "DeepSeek-V4-Pro",
    "kind": "volcengine-ark"
  },
  {
    "id": "GLM-5.1",
    "name": "GLM-5.1",
    "kind": "volcengine-ark"
  },
  {
    "id": "MiniMax-M2.7",
    "name": "MiniMax-M2.7",
    "kind": "volcengine-ark"
  },
  {
    "id": "Kimi-K2.6",
    "name": "Kimi-K2.6",
    "kind": "volcengine-ark"
  },
  {
    "id": "grok-4.6",
    "name": "Grok 4.6",
    "kind": "xai"
  },
  {
    "id": "grok-4.5",
    "name": "Grok 4.5",
    "kind": "xai"
  },
  {
    "id": "grok-4",
    "name": "Grok 4",
    "kind": "xai"
  },
  {
    "id": "grok-4-fast-reasoning",
    "name": "Grok 4 Fast Reasoning",
    "kind": "xai"
  },
  {
    "id": "grok-code-fast-1",
    "name": "Grok Code Fast",
    "kind": "xai"
  },
  {
    "id": "grok-3",
    "name": "Grok 3",
    "kind": "xai"
  },
  {
    "id": "mimo-v2.6-pro",
    "name": "MiMo V2.6 Pro",
    "kind": "xiaomi-mimo",
    "upstreamModelId": "xiaomi/mimo-v2.6-pro",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "mimo-v2.6-flash",
    "name": "MiMo V2.6 Flash",
    "kind": "xiaomi-mimo",
    "upstreamModelId": "xiaomi/mimo-v2.6-flash",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "mimo-v2.6-pro-ultraspeed",
    "name": "MiMo V2.6 Pro UltraSpeed",
    "kind": "xiaomi-mimo",
    "upstreamModelId": "xiaomi/mimo-v2.6-pro-ultraspeed",
    "supportedFormats": [
      "openai"
    ]
  },
  {
    "id": "mimo-v2.5-pro",
    "name": "MiMo V2.5 Pro",
    "kind": "xiaomi-mimo"
  },
  {
    "id": "mimo-v2.5",
    "name": "MiMo V2.5",
    "kind": "xiaomi-mimo"
  },
  {
    "id": "mimo-v2-omni",
    "name": "MiMo V2 Omni",
    "kind": "xiaomi-mimo"
  },
  {
    "id": "mimo-v2-flash",
    "name": "MiMo V2 Flash",
    "kind": "xiaomi-mimo"
  },
  {
    "id": "mimo-v2.5-pro",
    "name": "MiMo V2.5 Pro",
    "kind": "mimo"
  },
  {
    "id": "mimo-v2.5-pro-claude",
    "name": "MiMo V2.5 Pro (Claude Native)",
    "kind": "mimo",
    "upstreamModelId": "mimo-v2.5-pro",
    "targetFormat": "claude"
  },
  {
    "id": "mimo-v2.5",
    "name": "MiMo V2.5",
    "kind": "mimo"
  },
  {
    "id": "mimo-v2-pro",
    "name": "MiMo V2 Pro",
    "kind": "mimo"
  },
  {
    "id": "mimo-v2-omni",
    "name": "MiMo V2 Omni",
    "kind": "mimo"
  },
  {
    "id": "qwen3.5-plus",
    "name": "Qwen3.5 Plus",
    "kind": "alims-intl"
  },
  {
    "id": "kimi-k2.5",
    "name": "Kimi K2.5",
    "kind": "alims-intl"
  },
  {
    "id": "glm-5",
    "name": "GLM 5",
    "kind": "alims-intl"
  },
  {
    "id": "MiniMax-M2.5",
    "name": "MiniMax M2.5",
    "kind": "alims-intl"
  },
  {
    "id": "qwen3-coder-next",
    "name": "Qwen3 Coder Next",
    "kind": "alims-intl"
  },
  {
    "id": "qwen3-coder-plus",
    "name": "Qwen3 Coder Plus",
    "kind": "alims-intl"
  },
  {
    "id": "glm-4.7",
    "name": "GLM 4.7",
    "kind": "alims-intl"
  },
  {
    "id": "glm-5.2",
    "name": "GLM-5.2",
    "kind": "codebuddy-intl"
  },
  {
    "id": "glm-5.1",
    "name": "GLM-5.1",
    "kind": "codebuddy-intl"
  },
  {
    "id": "glm-5.0",
    "name": "GLM-5.0",
    "kind": "codebuddy-intl"
  },
  {
    "id": "glm-5.0-turbo",
    "name": "GLM-5.0-Turbo",
    "kind": "codebuddy-intl"
  },
  {
    "id": "glm-5v-turbo",
    "name": "GLM-5v-Turbo",
    "kind": "codebuddy-intl"
  },
  {
    "id": "glm-4.7",
    "name": "GLM-4.7",
    "kind": "codebuddy-intl"
  },
  {
    "id": "minimax-m3",
    "name": "MiniMax-M3",
    "kind": "codebuddy-intl"
  },
  {
    "id": "minimax-m2.7",
    "name": "MiniMax-M2.7",
    "kind": "codebuddy-intl"
  },
  {
    "id": "kimi-k2.7",
    "name": "Kimi-K2.7-Code",
    "kind": "codebuddy-intl"
  },
  {
    "id": "kimi-k2.6",
    "name": "Kimi-K2.6",
    "kind": "codebuddy-intl"
  },
  {
    "id": "kimi-k2.5",
    "name": "Kimi-K2.5",
    "kind": "codebuddy-intl"
  },
  {
    "id": "hy3-preview",
    "name": "Hy3 Preview",
    "kind": "codebuddy-intl"
  },
  {
    "id": "deepseek-v4-pro",
    "name": "DeepSeek-V4-Pro",
    "kind": "codebuddy-intl"
  },
  {
    "id": "deepseek-v4.1-flash",
    "name": "DeepSeek-V4.1-Flash",
    "kind": "codebuddy-intl"
  },
  {
    "id": "deepseek-v3-2-volc",
    "name": "DeepSeek-V3.2",
    "kind": "codebuddy-intl"
  },
  {
    "id": "gpt-oss-120b",
    "name": "GPT-OSS 120B (Free)",
    "kind": "api-airforce",
    "contextLength": 131072
  },
  {
    "id": "gpt-oss-20b",
    "name": "GPT-OSS 20B (Free)",
    "kind": "api-airforce",
    "contextLength": 131072
  },
  {
    "id": "kimi-k2.7-code",
    "name": "Kimi K2.7 Code (Free)",
    "kind": "api-airforce",
    "contextLength": 262144
  },
  {
    "id": "deepseek-v4-pro",
    "name": "DeepSeek V4 Pro",
    "kind": "baidu",
    "contextLength": 1048576
  },
  {
    "id": "deepseek-v4-flash",
    "name": "DeepSeek V4 Flash",
    "kind": "baidu",
    "contextLength": 1048576
  },
  {
    "id": "glm-5.2",
    "name": "GLM 5.2",
    "kind": "baidu",
    "contextLength": 512000
  },
  {
    "id": "glm-5.1",
    "name": "GLM 5.1",
    "kind": "baidu",
    "contextLength": 198000
  },
  {
    "id": "kimi-k2.6",
    "name": "Kimi K2.6",
    "kind": "baidu",
    "contextLength": 262144
  },
  {
    "id": "qwen3.5-397b-a17b",
    "name": "Qwen 3.5 397B A17B",
    "kind": "baidu",
    "contextLength": 262144
  },
  {
    "id": "qwen3.5-27b",
    "name": "Qwen 3.5 27B",
    "kind": "baidu",
    "contextLength": 262144
  },
  {
    "id": "auto:free",
    "name": "Auto Free (Zero Cost)",
    "kind": "bazaarlink"
  },
  {
    "id": "claude-opus-4.7",
    "name": "Claude Opus 4.7",
    "kind": "bazaarlink",
    "contextLength": 1000000
  },
  {
    "id": "claude-sonnet-4.6",
    "name": "Claude Sonnet 4.6",
    "kind": "bazaarlink",
    "contextLength": 1000000
  },
  {
    "id": "claude-haiku-4.5",
    "name": "Claude Haiku 4.5",
    "kind": "bazaarlink",
    "contextLength": 200000
  },
  {
    "id": "gpt-5.5",
    "name": "GPT-5.5",
    "kind": "bazaarlink",
    "contextLength": 1050000
  },
  {
    "id": "gpt-5.4",
    "name": "GPT-5.4",
    "kind": "bazaarlink",
    "contextLength": 1050000
  },
  {
    "id": "gpt-5.4-mini",
    "name": "GPT-5.4 Mini",
    "kind": "bazaarlink",
    "contextLength": 400000
  },
  {
    "id": "gpt-5.4-nano",
    "name": "GPT-5.4 Nano",
    "kind": "bazaarlink",
    "contextLength": 400000
  },
  {
    "id": "grok-4.3",
    "name": "Grok 4.3",
    "kind": "bazaarlink",
    "contextLength": 1000000
  },
  {
    "id": "grok-4.20",
    "name": "Grok 4.20",
    "kind": "bazaarlink",
    "contextLength": 2000000
  },
  {
    "id": "gemini-3.1-pro-preview",
    "name": "Gemini 3.1 Pro",
    "kind": "bazaarlink",
    "contextLength": 1048576
  },
  {
    "id": "gemini-3-flash-preview",
    "name": "Gemini 3 Flash",
    "kind": "bazaarlink",
    "contextLength": 1048576
  },
  {
    "id": "gemini-3.1-flash-lite-preview",
    "name": "Gemini 3.1 Flash Lite",
    "kind": "bazaarlink",
    "contextLength": 1048576
  },
  {
    "id": "kimi-k2.6",
    "name": "Kimi K2.6",
    "kind": "bazaarlink",
    "contextLength": 262144
  },
  {
    "id": "kimi-k2.5",
    "name": "Kimi K2.5",
    "kind": "bazaarlink",
    "contextLength": 262144
  },
  {
    "id": "glm-5.1",
    "name": "GLM 5.1",
    "kind": "bazaarlink",
    "contextLength": 204800
  },
  {
    "id": "glm-5",
    "name": "GLM 5",
    "kind": "bazaarlink",
    "contextLength": 204800
  },
  {
    "id": "mimo-v2.5-pro",
    "name": "MiMo-V2.5-Pro",
    "kind": "bazaarlink",
    "contextLength": 1050000
  },
  {
    "id": "mimo-v2.5",
    "name": "MiMo-V2.5",
    "kind": "bazaarlink",
    "contextLength": 1050000
  },
  {
    "id": "minimax-m3",
    "name": "MiniMax M3",
    "kind": "bazaarlink",
    "contextLength": 1048576
  },
  {
    "id": "minimax-m2.7",
    "name": "MiniMax M2.7",
    "kind": "bazaarlink",
    "contextLength": 204800
  },
  {
    "id": "minimax-m2.5",
    "name": "MiniMax M2.5",
    "kind": "bazaarlink",
    "contextLength": 204800
  },
  {
    "id": "qwen3.6-plus",
    "name": "Qwen 3.6 Plus",
    "kind": "bazaarlink",
    "contextLength": 1000000
  },
  {
    "id": "nemotron-3-super-120b-a12b",
    "name": "Nemotron 3 Super",
    "kind": "bazaarlink",
    "contextLength": 1000000
  },
  {
    "id": "kilo-auto/free",
    "name": "Kilo Auto Free",
    "kind": "kilo-gateway",
    "contextLength": 256000
  },
  {
    "id": "nvidia/nemotron-3-super-120b-a12b:free",
    "name": "Nemotron 3 Super 120B (Free)",
    "kind": "kilo-gateway",
    "contextLength": 262144
  },
  {
    "id": "nvidia/nemotron-3-ultra-550b-a55b:free",
    "name": "Nemotron 3 Ultra 550B (Free)",
    "kind": "kilo-gateway",
    "contextLength": 1000000
  },
  {
    "id": "kwaipilot/kat-coder-pro-v2.5:free",
    "name": "Kat Coder Pro v2.5 (Free)",
    "kind": "kilo-gateway",
    "contextLength": 256000
  },
  {
    "id": "kilo-auto/frontier",
    "name": "Kilo Auto Frontier",
    "kind": "kilo-gateway",
    "contextLength": 1000000
  },
  {
    "id": "kilo-auto/balanced",
    "name": "Kilo Auto Balanced",
    "kind": "kilo-gateway",
    "contextLength": 1000000
  },
  {
    "id": "gpt-5.5",
    "name": "GPT-5.5 (LLM7)",
    "kind": "llm7",
    "contextLength": 1050000
  },
  {
    "id": "claude-opus-5",
    "name": "Claude Opus 5 (LLM7)",
    "kind": "llm7",
    "contextLength": 1000000
  },
  {
    "id": "deepseek-v4-flash",
    "name": "DeepSeek V4 Flash (LLM7)",
    "kind": "llm7",
    "contextLength": 1000000
  },
  {
    "id": "grok-4.5",
    "name": "Grok 4.5 (LLM7)",
    "kind": "llm7",
    "contextLength": 500000
  },
  {
    "id": "kimi-k3",
    "name": "Kimi K3 (LLM7)",
    "kind": "llm7",
    "contextLength": 1000000
  },
  {
    "id": "hunyuan-turbos-latest",
    "name": "Hunyuan TurboS Latest",
    "kind": "tencent",
    "contextLength": 200000
  },
  {
    "id": "hunyuan-t1-latest",
    "name": "Hunyuan T1 Latest",
    "kind": "tencent",
    "contextLength": 256000
  },
  {
    "id": "morph-v3-large",
    "name": "Morph v3 Large",
    "kind": "morph"
  },
  {
    "id": "morph-v3-fast",
    "name": "Morph v3 Fast",
    "kind": "morph"
  },
  {
    "id": "morph-qwen35-397b",
    "name": "Qwen 3.5 397B (Morph)",
    "kind": "morph",
    "contextLength": 262144
  },
  {
    "id": "morph-minimax27-230b",
    "name": "MiniMax M2.7 (Morph)",
    "kind": "morph",
    "contextLength": 200704
  },
  {
    "id": "morph-qwen36-27b",
    "name": "Qwen 3.6 27B (Morph)",
    "kind": "morph",
    "contextLength": 262144
  },
  {
    "id": "morph-dsv4flash",
    "name": "DeepSeek V4 Flash (Morph)",
    "kind": "morph",
    "contextLength": 1048576
  },
  {
    "id": "poolside/laguna-s-2.1",
    "name": "Laguna S 2.1",
    "kind": "poolside"
  },
  {
    "id": "poolside/laguna-xs-2.1",
    "name": "Laguna XS 2.1",
    "kind": "poolside"
  },
  {
    "id": "anthropic/claude-haiku-4.5",
    "name": "Claude Haiku 4.5",
    "kind": "tokenrouter"
  },
  {
    "id": "anthropic/claude-sonnet-4.6",
    "name": "Claude Sonnet 4.6",
    "kind": "tokenrouter"
  },
  {
    "id": "anthropic/claude-opus-4.8",
    "name": "Claude Opus 4.8",
    "kind": "tokenrouter"
  },
  {
    "id": "anthropic/claude-opus-4.8-fast",
    "name": "Claude Opus 4.8 Fast",
    "kind": "tokenrouter"
  },
  {
    "id": "openai/gpt-5.4",
    "name": "Gpt 5.4",
    "kind": "tokenrouter"
  },
  {
    "id": "openai/gpt-5.4-mini",
    "name": "Gpt 5.4 Mini",
    "kind": "tokenrouter"
  },
  {
    "id": "openai/gpt-5.4-pro",
    "name": "Gpt 5.4 Pro",
    "kind": "tokenrouter"
  },
  {
    "id": "openai/gpt-5.5",
    "name": "Gpt 5.5",
    "kind": "tokenrouter"
  },
  {
    "id": "openai/gpt-5.6-sol",
    "name": "Gpt 5.6 Sol",
    "kind": "tokenrouter"
  },
  {
    "id": "google/gemini-3.5-flash",
    "name": "Gemini 3.5 Flash",
    "kind": "tokenrouter"
  },
  {
    "id": "google/gemini-3.6-flash",
    "name": "Gemini 3.6 Flash",
    "kind": "tokenrouter"
  },
  {
    "id": "deepseek/deepseek-v4-flash",
    "name": "Deepseek V4 Flash",
    "kind": "tokenrouter"
  },
  {
    "id": "deepseek/deepseek-v4-pro",
    "name": "Deepseek V4 Pro",
    "kind": "tokenrouter"
  },
  {
    "id": "qwen/qwen3-coder-next",
    "name": "Qwen3 Coder Next",
    "kind": "tokenrouter"
  },
  {
    "id": "qwen/qwen3.7-max",
    "name": "Qwen3.7 Max",
    "kind": "tokenrouter"
  },
  {
    "id": "qwen/qwen3.8-max",
    "name": "Qwen3.8 Max",
    "kind": "tokenrouter"
  },
  {
    "id": "moonshotai/kimi-k2.7-code",
    "name": "Kimi K2.7 Code",
    "kind": "tokenrouter"
  },
  {
    "id": "moonshotai/kimi-k3-free",
    "name": "Kimi K3 Free",
    "kind": "tokenrouter"
  },
  {
    "id": "z-ai/glm-5.3-free",
    "name": "Glm 5.3 Free",
    "kind": "tokenrouter"
  },
  {
    "id": "z-ai/glm-5.2",
    "name": "Glm 5.2",
    "kind": "tokenrouter"
  },
  {
    "id": "z-ai/glm-5-turbo",
    "name": "Glm 5 Turbo",
    "kind": "tokenrouter"
  },
  {
    "id": "x-ai/grok-4.5",
    "name": "Grok 4.5",
    "kind": "tokenrouter"
  },
  {
    "id": "qwen3.8-max-preview",
    "name": "Qwen3.8 Max Preview",
    "kind": "alitp-intl"
  },
  {
    "id": "qwen3.7-max",
    "name": "Qwen3.7 Max",
    "kind": "alitp-intl"
  },
  {
    "id": "qwen3.7-plus",
    "name": "Qwen3.7 Plus",
    "kind": "alitp-intl"
  },
  {
    "id": "qwen3.6-flash",
    "name": "Qwen3.6 Flash",
    "kind": "alitp-intl"
  },
  {
    "id": "glm-5.2",
    "name": "GLM 5.2",
    "kind": "alitp-intl"
  },
  {
    "id": "deepseek-v4-pro",
    "name": "DeepSeek V4 Pro",
    "kind": "alitp-intl"
  }
];
