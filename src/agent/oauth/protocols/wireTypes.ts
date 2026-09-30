/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

/**
 * Mutable upstream payloads have provider-specific extension fields. Dynamic
 * values are confined to this translation boundary; public transports validate
 * messages, tool arguments, completion markers and credentials before use.
 */
export type ProtocolValue = any;
export type ProtocolRecord = Record<string, ProtocolValue>;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ProtocolCredentials extends ProtocolRecord {
  id?: string;
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  connectionId?: string;
  providerSpecificData?: ProtocolRecord;
}
export interface ProviderTransport extends ProtocolRecord {
  format?: string;
  baseUrl?: string;
  baseUrls?: string[];
  headers?: Record<string, string>;
  auth?: ProtocolRecord;
  transports?: ProviderTransport[];
}
export interface ProviderModel extends ProtocolRecord {
  id: string;
  name: string;
  upstreamModelId?: string;
  targetFormat?: string;
  supportedFormats?: string[];
  contextLength?: number;
}
export interface TranslatorState extends ProtocolRecord {
  model?: string | null;
  messageId?: string | null;
  finishReason?: string | null;
  finishReasonSent?: boolean;
  toolCalls: Map<ProtocolValue, ProtocolValue>;
}
export interface StreamDelta extends ProtocolRecord {
  content?: string | null;
  reasoning_content?: string;
  tool_calls?: ProtocolRecord[];
}
export interface ResponseChunk extends ProtocolRecord {
  id?: string;
  model?: string | null;
  choices?: { index: number; delta: StreamDelta; finish_reason?: string | null }[];
  usage?: ProtocolRecord | null;
}
export interface ProtocolError extends Error { [key: string]: ProtocolValue }
