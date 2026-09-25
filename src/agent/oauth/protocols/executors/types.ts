/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { ProtocolCredentials, ProtocolRecord, ProviderTransport } from "../wireTypes.js";

export interface ExecutorLogger {
  debug?(category: string, message: string): void;
  info?(category: string, message: string): void;
  error?(category: string, message: string): void;
  warn?(category: string, message: string): void;
}
export interface ExecutorRequest {
  model: string;
  body: ProtocolRecord;
  stream: boolean;
  credentials: ProtocolCredentials;
  signal?: AbortSignal;
  log?: ExecutorLogger;
  proxyOptions?: ProtocolRecord | null;
  upstreamExtraHeaders?: Record<string,string>;
}
export interface ExecutorResult {
  response: Response;
  url: string;
  headers: Record<string, string>;
  transformedBody: ProtocolRecord | Uint8Array;
  responseFormat?: string;
}
export interface TokenRefreshResult extends ProtocolRecord {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  expiresAt?: number;
}
export interface ExecutorConfig extends ProviderTransport {
  retry?: Record<number, number | { attempts: number; delayMs: number }>;
  noAuth?: boolean;
  timeoutMs?: number;
}
