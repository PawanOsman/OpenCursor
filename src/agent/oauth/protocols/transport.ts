/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { ProtocolCredentials, ProtocolRecord, TranslatorState } from "./wireTypes.js";
import type { ExecutorConfig, ExecutorRequest, ExecutorResult } from "./executors/types.js";
import { PROVIDERS, PROVIDER_MODELS } from './providers/index.js';
import { DefaultExecutor } from './executors/default.js';
import { GeminiCLIExecutor } from './executors/gemini-cli.js';
import { GithubExecutor } from './executors/github.js';
import { IFlowExecutor } from './executors/iflow.js';
import { QoderExecutor } from './executors/qoder.js';
import { KiroExecutor } from './executors/kiro.js';
import { CursorExecutor } from './executors/cursor.js';
import { GrokCliExecutor } from './executors/grok-cli.js';
import { CodeBuddyExecutor } from './executors/codebuddy-cn.js';
import { CodeBuddyIntlExecutor } from './executors/codebuddy-intl.js';
import TraeExecutor from './executors/trae.js';
import ZedExecutor from './executors/zed.js';
import WindsurfExecutor from './executors/windsurf.js';
import { XiaomiMimoExecutor } from './executors/xiaomi-mimo.js';
import { XiaomiTokenplanExecutor } from './executors/xiaomi-tokenplan.js';
import { KimchiExecutor } from './executors/kimchi.js';
import { CommandCodeExecutor } from './executors/commandcode.js';
import { OpenCodeExecutor } from './executors/opencode.js';
import { OpenCodeGoExecutor } from './executors/opencode-go.js';
import { OpenCodeZenExecutor } from './executors/opencode-zen.js';
import { AzureExecutor } from './executors/azure.js';
import { VertexExecutor } from './executors/vertex.js';
import { translateRequest, translateResponse, initState } from './translator/index.js';
import { applyThinking, captureThinking, parseSuffix } from './translator/concerns/thinkingUnified.js';
import { takeRenamedToolNames, restoreToolNames } from './utils/opencodeFingerprint.js';
import { withAuthSignal } from '../auth/network.js';


export interface ProviderRequest {
  providerId: string;
  model: string;
  body: ProtocolRecord;
  nativeBody?: ProtocolRecord;
  credentials: ProtocolCredentials;
  signal: AbortSignal;
  baseUrl?: string;
  onCredentialsRefresh?: (patch: Partial<ProtocolCredentials>) => Promise<void> | void;
}

interface RequestExecutor {
  config: ExecutorConfig;
  execute(request: ExecutorRequest): Promise<ExecutorResult>;
}
const constructors: Record<string, new (providerId: string) => RequestExecutor> = {
  'gemini-cli':GeminiCLIExecutor, github:GithubExecutor, iflow:IFlowExecutor,
  qoder:QoderExecutor, 'qoder-cn':QoderExecutor, kiro:KiroExecutor, cursor:CursorExecutor,
  'grok-cli':GrokCliExecutor, 'codebuddy-cn':CodeBuddyExecutor, 'codebuddy-intl':CodeBuddyIntlExecutor,
  trae:TraeExecutor, zed:ZedExecutor, windsurf:WindsurfExecutor, 'xiaomi-mimo':XiaomiMimoExecutor,
  'xiaomi-tokenplan':XiaomiTokenplanExecutor, kimchi:KimchiExecutor, commandcode:CommandCodeExecutor,
  opencode:OpenCodeExecutor, 'opencode-go':OpenCodeGoExecutor, 'opencode-zen':OpenCodeZenExecutor,
  azure:AzureExecutor, vertex:VertexExecutor, 'vertex-partner':VertexExecutor,
};
const normalized = new Set(['kiro','cursor','qoder','qoder-cn','github','zed','windsurf','trae','commandcode']);

export function describeProvider(providerId: string, requestedModel: string) {
  const config = PROVIDERS[providerId];
  if (!config) throw Object.assign(new Error('Unknown provider adapter: '+providerId), {status:400});
  const entry = (PROVIDER_MODELS[providerId] || []).find(item => item.id === requestedModel);
  const upstream = entry?.upstreamModelId || requestedModel;
  const model = parseSuffix(upstream).cleanModel;
  const intentModel = ['kiro','grok-cli'].includes(providerId) ? requestedModel : upstream;
  let format = entry?.targetFormat || config.format || 'openai';
  const transport = entry?.targetFormat ? config.transports?.find(item => item.format === format)
    : config.transports?.find(item => item.format === 'openai' && (!entry?.supportedFormats || entry.supportedFormats.includes('openai')))
      || config.transports?.find(item => item.format === format);
  if (transport?.format) format = transport.format;
  if (providerId === 'vertex') format = 'gemini';
  return {model, intentModel, format, upstream, config, transport, explicitFormat:!!entry?.targetFormat};
}

export function makeResponseState(model: string, sessionId: string): TranslatorState {
  return {...initState('openai') as TranslatorState, model, sessionId};
}
export function convertResponse(format: string, chunk: ProtocolRecord, state: TranslatorState, _toolNameMap?: Map<string, string>) {
  const converted = translateResponse(format, 'openai', chunk, state);
  return restoreToolNames(converted);
}

export async function performProviderRequest({providerId, model:requestedModel, body, nativeBody, credentials, signal, baseUrl, onCredentialsRefresh}: ProviderRequest) {
  signal?.throwIfAborted();
  const info = describeProvider(providerId, requestedModel);
  const Executor = constructors[providerId] || DefaultExecutor;
  // Each attempt gets its own executor and credential object. Instance fields
  // (model, headers, sessions) can never bleed between concurrently used accounts.
  const executor = new Executor(providerId);
  const creds: ProtocolCredentials & { providerSpecificData: ProtocolRecord } = {...credentials, providerSpecificData:{...credentials.providerSpecificData, kiroToolCallRepair:false}};
  if (executor instanceof GithubExecutor) {
    creds.copilotToken = creds.providerSpecificData.copilotToken;
    creds.copilotTokenExpiresAt = creds.providerSpecificData.copilotTokenExpiresAt;
    if (executor.needsRefresh(creds)) {
      const refreshed = await withAuthSignal(signal, () => executor.refreshCopilotToken(creds.accessToken ?? "", undefined));
      signal?.throwIfAborted();
      if (!refreshed?.token) throw Object.assign(new Error('GitHub Copilot could not authorize this account session.'), {status:401});
      creds.copilotToken = refreshed.token;
      creds.copilotTokenExpiresAt = refreshed.expiresAt;
      creds.providerSpecificData = {...creds.providerSpecificData,copilotToken:refreshed.token,copilotTokenExpiresAt:refreshed.expiresAt};
      await onCredentialsRefresh?.({providerSpecificData:{copilotToken:refreshed.token,copilotTokenExpiresAt:refreshed.expiresAt}});
    }
  }
  if (info.transport) creds.runtimeTransport = {...info.transport};
  executor.config = {...executor.config, ...(info.transport || {}), retry:{429:0,500:0,502:0,503:0,504:0}};
  if (providerId === 'azure') {
    if (!baseUrl && !creds.providerSpecificData.azureEndpoint) throw Object.assign(new Error('Azure requires a resource endpoint.'), {status:400});
    if (baseUrl) creds.providerSpecificData.azureEndpoint = baseUrl.replace(/\/+$/,'').replace(/\/openai\/v1$/i,'');
  } else if (baseUrl) {
    let url = baseUrl.replace(/\/+$/,'');
    if (info.format === 'openai' && !/\/chat\/completions(?:\?|$)/.test(url)) url += '/chat/completions';
    else if (info.format === 'claude' && !/\/messages(?:\?|$)/.test(url)) url += '/messages';
    else if (info.format === 'openai-responses' && !/\/responses(?:\?|$)/.test(url)) url += '/responses';
    else if (info.format === 'ollama' && !/\/api\/chat(?:\?|$)/.test(url)) url += url.endsWith('/api') ? '/chat' : '/api/chat';
    // Custom endpoint fields apply to generic transports; specialized executors
    // retain their protocol paths (OpenCode, Qoder, Cursor, etc.).
    if (!constructors[providerId] && !(info.explicitFormat && info.transport)) {
      executor.config.baseUrl = url;
      if (creds.runtimeTransport) creds.runtimeTransport.baseUrl = url;
    }
    if (providerId === 'cloudflare-ai') executor.config.baseUrl = url;
  }
  const intent = captureThinking(body);
  const translated = nativeBody || translateRequest('openai', info.format, info.intentModel, body, true, creds);
  if (!translated || typeof translated !== 'object') throw Object.assign(new Error('Provider rejected the request history shape.'), {status:400});
  if (info.format !== 'kiro') applyThinking(info.format, info.upstream, translated, providerId, intent);
  if (providerId === 'grok-cli') translated.model = requestedModel;
  if (providerId === 'deepseek' && /^deepseek-v4-pro-(max|none)$/.test(requestedModel)) {
    translated.model = 'deepseek-v4-pro';
    translated.thinking = {type:requestedModel.endsWith('-max') ? 'enabled' : 'disabled'};
    if (requestedModel.endsWith('-max')) translated.reasoning_effort = 'max';
    else delete translated.reasoning_effort;
  }
  const result = await withAuthSignal(signal, () => executor.execute({model:info.intentModel, body:translated, stream:true, credentials:creds, signal}), {timeoutMs:0});
  return {...result, model:info.model, format:result.responseFormat || (normalized.has(providerId) ? 'openai' : info.format),
    toolNameMap:takeRenamedToolNames() ?? undefined};
}
