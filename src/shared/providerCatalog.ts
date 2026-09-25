/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

/*!
 * OpenCursor provider registry.
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
/** OpenCursor's public coding/chat provider metadata; no credentials. */
export interface ProviderPreset { label:string; baseUrl:string; needsKey:boolean; noAuth?:boolean; adapterId?:string; protocol?:'openai'|'claude'|'adapter'; needsEndpoint?:boolean; setupHint?:string; authMode?:'apiKey'|'serviceAccount'; }
const PRESETS = {
  "openai": {
    "label": "OpenAI-compatible",
    "baseUrl": "https://api.openai.com/v1",
    "needsKey": true,
    "adapterId": "openai"
  },
  "anthropic": {
    "label": "Anthropic",
    "baseUrl": "https://api.anthropic.com/v1",
    "needsKey": true,
    "adapterId": "anthropic"
  },
  "google": {
    "label": "Google Gemini",
    "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
    "needsKey": true,
    "adapterId": "gemini"
  },
  "openrouter": {
    "label": "OpenRouter",
    "baseUrl": "https://openrouter.ai/api/v1",
    "needsKey": true,
    "adapterId": "openrouter"
  },
  "ollama": {
    "label": "Ollama",
    "baseUrl": "http://localhost:11434/v1",
    "needsKey": false,
    "adapterId": "ollama-local"
  },
  "llamacpp": {
    "label": "llama.cpp",
    "baseUrl": "http://localhost:8080/v1",
    "needsKey": false
  },
  "mimo": {
    "label": "Xiaomi MIMO",
    "baseUrl": "https://token-plan-sgp.xiaomimimo.com/v1",
    "needsKey": true,
    "adapterId": "xiaomi-tokenplan"
  },
  "atlascloud": {
    "label": "Atlas Cloud",
    "baseUrl": "https://api.atlascloud.ai/v1",
    "needsKey": true
  },
  "astraflow": {
    "label": "Astraflow",
    "baseUrl": "https://api-us-ca.umodelverse.ai/v1",
    "needsKey": true
  },
  "xai": {
    "label": "xAI",
    "baseUrl": "https://api.x.ai/v1",
    "needsKey": true
  },
  "deepseek": {
    "label": "DeepSeek",
    "baseUrl": "https://api.deepseek.com/v1",
    "needsKey": true,
    "adapterId": "deepseek"
  },
  "moonshot": {
    "label": "Moonshot / Kimi",
    "baseUrl": "https://api.moonshot.ai/v1",
    "needsKey": true
  },
  "z-ai": {
    "label": "Z.ai",
    "baseUrl": "https://api.z.ai/api/paas/v4",
    "needsKey": true
  },
  "minimax": {
    "label": "MiniMax",
    "baseUrl": "https://api.minimax.io/v1",
    "needsKey": true,
    "adapterId": "minimax"
  },
  "qwen": {
    "label": "Qwen",
    "baseUrl": "https://maas.qwencloudapi.com/compatible-mode/v1",
    "needsKey": true
  },
  "alicode-intl": {
    "label": "Alibaba Coding",
    "baseUrl": "https://coding-intl.dashscope.aliyuncs.com/v1",
    "needsKey": true,
    "adapterId": "alicode-intl",
    "protocol": "adapter"
  },
  "alicode": {
    "label": "Alibaba",
    "baseUrl": "https://coding.dashscope.aliyuncs.com/v1",
    "needsKey": true,
    "adapterId": "alicode",
    "protocol": "adapter"
  },
  "azure": {
    "label": "Azure OpenAI",
    "baseUrl": "",
    "needsKey": true,
    "adapterId": "azure",
    "protocol": "adapter",
    "needsEndpoint": true,
    "setupHint": "Enter your Azure OpenAI resource endpoint, such as https://my-resource.openai.azure.com."
  },
  "blackbox": {
    "label": "Blackbox AI",
    "baseUrl": "https://api.blackbox.ai/v1",
    "needsKey": true,
    "adapterId": "blackbox",
    "protocol": "adapter"
  },
  "byteplus": {
    "label": "BytePlus ModelArk",
    "baseUrl": "https://ark.ap-southeast.bytepluses.com/api/coding/v3",
    "needsKey": true,
    "adapterId": "byteplus",
    "protocol": "adapter"
  },
  "cerebras": {
    "label": "Cerebras",
    "baseUrl": "https://api.cerebras.ai/v1",
    "needsKey": true,
    "adapterId": "cerebras",
    "protocol": "adapter"
  },
  "chutes": {
    "label": "Chutes AI",
    "baseUrl": "https://llm.chutes.ai/v1",
    "needsKey": true,
    "adapterId": "chutes",
    "protocol": "adapter"
  },
  "cloudflare-ai": {
    "label": "Cloudflare",
    "baseUrl": "https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1",
    "needsKey": true,
    "adapterId": "cloudflare-ai",
    "protocol": "adapter",
    "needsEndpoint": true,
    "setupHint": "Replace {accountId} with your Cloudflare account ID in the base URL."
  },
  "cohere": {
    "label": "Cohere",
    "baseUrl": "https://api.cohere.ai/v1",
    "needsKey": true,
    "adapterId": "cohere",
    "protocol": "adapter"
  },
  "commandcode": {
    "label": "Command Code",
    "baseUrl": "https://api.commandcode.ai/alpha/generate",
    "needsKey": true,
    "adapterId": "commandcode",
    "protocol": "adapter"
  },
  "featherless": {
    "label": "Featherless",
    "baseUrl": "https://api.featherless.ai/v1",
    "needsKey": true,
    "adapterId": "featherless",
    "protocol": "adapter"
  },
  "fireworks": {
    "label": "Fireworks AI",
    "baseUrl": "https://api.fireworks.ai/inference/v1",
    "needsKey": true,
    "adapterId": "fireworks",
    "protocol": "adapter"
  },
  "glm-cn": {
    "label": "GLM (China)",
    "baseUrl": "https://open.bigmodel.cn/api/coding/paas/v4",
    "needsKey": true,
    "adapterId": "glm-cn",
    "protocol": "adapter"
  },
  "glm": {
    "label": "GLM Coding",
    "baseUrl": "https://api.z.ai/api/coding/paas/v4",
    "needsKey": true,
    "adapterId": "glm",
    "protocol": "adapter"
  },
  "groq": {
    "label": "Groq",
    "baseUrl": "https://api.groq.com/openai/v1",
    "needsKey": true,
    "adapterId": "groq",
    "protocol": "adapter"
  },
  "hyperbolic": {
    "label": "Hyperbolic",
    "baseUrl": "https://api.hyperbolic.xyz/v1",
    "needsKey": true,
    "adapterId": "hyperbolic",
    "protocol": "adapter"
  },
  "kimchi": {
    "label": "Kimchi",
    "baseUrl": "https://llm.kimchi.dev/openai/v1",
    "needsKey": true,
    "adapterId": "kimchi",
    "protocol": "adapter"
  },
  "minimax-cn": {
    "label": "Minimax (China)",
    "baseUrl": "https://api.minimaxi.com/v1",
    "needsKey": true,
    "adapterId": "minimax-cn",
    "protocol": "adapter"
  },
  "mistral": {
    "label": "Mistral",
    "baseUrl": "https://api.mistral.ai/v1",
    "needsKey": true,
    "adapterId": "mistral",
    "protocol": "adapter"
  },
  "nebius": {
    "label": "Nebius AI",
    "baseUrl": "https://api.studio.nebius.ai/v1",
    "needsKey": true,
    "adapterId": "nebius",
    "protocol": "adapter"
  },
  "nvidia": {
    "label": "NVIDIA NIM",
    "baseUrl": "https://integrate.api.nvidia.com/v1",
    "needsKey": true,
    "adapterId": "nvidia",
    "protocol": "adapter"
  },
  "ollama-cloud": {
    "label": "Ollama Cloud",
    "baseUrl": "https://ollama.com",
    "needsKey": true,
    "adapterId": "ollama",
    "protocol": "adapter"
  },
  "opencode-go": {
    "label": "OpenCode Go",
    "baseUrl": "https://opencode.ai/zen/go/v1",
    "needsKey": true,
    "adapterId": "opencode-go",
    "protocol": "adapter"
  },
  "opencode-zen": {
    "label": "OpenCode Zen",
    "baseUrl": "https://opencode.ai/zen/v1",
    "needsKey": true,
    "adapterId": "opencode-zen",
    "protocol": "adapter"
  },
  "perplexity": {
    "label": "Perplexity",
    "baseUrl": "https://api.perplexity.ai",
    "needsKey": true,
    "adapterId": "perplexity",
    "protocol": "adapter"
  },
  "perplexity-agent": {
    "label": "Perplexity Agent",
    "baseUrl": "https://api.perplexity.ai/v1",
    "needsKey": true,
    "adapterId": "perplexity-agent",
    "protocol": "adapter"
  },
  "siliconflow": {
    "label": "SiliconFlow",
    "baseUrl": "https://api.siliconflow.com/v1",
    "needsKey": true,
    "adapterId": "siliconflow",
    "protocol": "adapter"
  },
  "together": {
    "label": "Together AI",
    "baseUrl": "https://api.together.xyz/v1",
    "needsKey": true,
    "adapterId": "together",
    "protocol": "adapter"
  },
  "venice": {
    "label": "Venice AI",
    "baseUrl": "https://api.venice.ai/api/v1",
    "needsKey": true,
    "adapterId": "venice",
    "protocol": "adapter"
  },
  "vercel-ai-gateway": {
    "label": "Vercel AI Gateway",
    "baseUrl": "https://ai-gateway.vercel.sh/v1",
    "needsKey": true,
    "adapterId": "vercel-ai-gateway",
    "protocol": "adapter"
  },
  "vertex-partner": {
    "label": "Vertex Partner",
    "baseUrl": "https://aiplatform.googleapis.com",
    "needsKey": true,
    "adapterId": "vertex-partner",
    "protocol": "adapter",
    "authMode": "serviceAccount",
    "setupHint": "Paste Google Cloud service-account JSON or ADC JSON with its project ID. Stored only in secure storage."
  },
  "vertex": {
    "label": "Vertex AI",
    "baseUrl": "https://aiplatform.googleapis.com",
    "needsKey": true,
    "adapterId": "vertex",
    "protocol": "adapter",
    "authMode": "serviceAccount",
    "setupHint": "Paste Google Cloud service-account JSON or ADC JSON with its project ID. Stored only in secure storage."
  },
  "volcengine-ark": {
    "label": "Volcengine Ark",
    "baseUrl": "https://ark.cn-beijing.volces.com/api/coding/v3",
    "needsKey": true,
    "adapterId": "volcengine-ark",
    "protocol": "adapter"
  },
  "alims-intl": {
    "label": "Alibaba Studio",
    "baseUrl": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    "needsKey": true,
    "adapterId": "alims-intl",
    "protocol": "adapter"
  },
  "api-airforce": {
    "label": "API.airforce",
    "baseUrl": "https://api.airforce/v1",
    "needsKey": true,
    "adapterId": "api-airforce",
    "protocol": "adapter"
  },
  "baidu": {
    "label": "Baidu Qianfan",
    "baseUrl": "https://qianfan.baidubce.com/v2",
    "needsKey": true,
    "adapterId": "baidu",
    "protocol": "adapter"
  },
  "bazaarlink": {
    "label": "Bazaarlink",
    "baseUrl": "https://bazaarlink.ai/api/v1",
    "needsKey": true,
    "adapterId": "bazaarlink",
    "protocol": "adapter"
  },
  "kilo-gateway": {
    "label": "Kilo Gateway",
    "baseUrl": "https://api.kilo.ai/api/gateway",
    "needsKey": true,
    "adapterId": "kilo-gateway",
    "protocol": "adapter"
  },
  "llm7": {
    "label": "LLM7",
    "baseUrl": "https://api.llm7.io/v1",
    "needsKey": true,
    "adapterId": "llm7",
    "protocol": "adapter"
  },
  "tencent": {
    "label": "Tencent Hunyuan",
    "baseUrl": "https://api.hunyuan.cloud.tencent.com/v1",
    "needsKey": true,
    "adapterId": "tencent",
    "protocol": "adapter"
  },
  "morph": {
    "label": "Morph",
    "baseUrl": "https://api.morphllm.com/v1",
    "needsKey": true,
    "adapterId": "morph",
    "protocol": "adapter"
  },
  "poolside": {
    "label": "Poolside",
    "baseUrl": "https://inference.poolside.ai/v1",
    "needsKey": true,
    "adapterId": "poolside",
    "protocol": "adapter"
  },
  "tokenrouter": {
    "label": "TokenRouter",
    "baseUrl": "https://api.tokenrouter.com/v1",
    "needsKey": true,
    "adapterId": "tokenrouter",
    "protocol": "adapter"
  },
  "alitp-intl": {
    "label": "Alibaba Token Plan",
    "baseUrl": "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
    "needsKey": true,
    "adapterId": "alitp-intl",
    "protocol": "adapter"
  },
  "opencode": {
    "label": "OpenCode Free",
    "baseUrl": "https://opencode.ai",
    "needsKey": false,
    "noAuth": true,
    "adapterId": "opencode",
    "protocol": "adapter"
  }
} as const;
export type ProviderKind = keyof typeof PRESETS;
export const PROVIDER_PRESETS: Record<ProviderKind, ProviderPreset> = PRESETS;
export const POPULAR_KINDS: ProviderKind[] = ["anthropic","openai","google","xai","deepseek","moonshot","z-ai","minimax","qwen","openrouter","mimo","atlascloud","astraflow","alicode-intl","alicode","azure","blackbox","byteplus","cerebras","chutes","cloudflare-ai","cohere","commandcode","featherless","fireworks","glm-cn","glm","groq","hyperbolic","kimchi","minimax-cn","mistral","nebius","nvidia","ollama-cloud","opencode-go","opencode-zen","perplexity","perplexity-agent","siliconflow","together","venice","vercel-ai-gateway","vertex-partner","vertex","volcengine-ark","alims-intl","api-airforce","baidu","bazaarlink","kilo-gateway","llm7","tencent","morph","poolside","tokenrouter","alitp-intl"];
export const FREE_KINDS: ProviderKind[] = ["opencode"];
