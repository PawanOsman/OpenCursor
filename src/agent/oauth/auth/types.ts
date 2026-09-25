/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

/** Shared boundaries for provider-specific authentication protocols. */
// Wire responses have provider-defined fields. Adapters normalize them into
// AuthTokens before they reach account storage; no wire fields enter UI status.
export interface AuthPayload { [field: string]: any }
export type AuthConfig = AuthPayload;
export interface AuthTokens {
  accessToken: string;
  refreshToken?: string | null;
  accountId?: string;
  projectId?: string;
  idToken?: string;
  scope?: string;
  lastRefreshAt?: string;
  expiresIn?: number | string | null;
  expiresAt?: number | string | null;
  email?: string | null;
  providerSpecificData?: AuthPayload;
}
export interface AuthDeviceCode extends AuthPayload {
  device_code: string;
  user_code?: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  interval?: number;
  expires_in?: number;
}
export function authDeviceCode(payload: AuthPayload): AuthDeviceCode {
  if (typeof payload.device_code !== "string" || !payload.device_code) throw new Error("The provider returned no device authorization code.");
  return { ...payload, device_code: payload.device_code };
}
export interface AuthPollResult { ok: boolean; data: AuthPayload }
export interface AuthProvider {
  config: AuthConfig;
  flowType: "authorization_code" | "authorization_code_pkce" | "device_code" | "import_token" | "browser_token";
  fixedPort?: number;
  callbackPath?: string;
  pkceVerifierBytes?: number;
  prepareConfig?(config: AuthConfig, meta?: AuthPayload): Promise<AuthConfig>;
  buildAuthUrl?(config: AuthConfig, redirectUri: string, state: string, codeChallenge: string, meta?: AuthPayload): string;
  requestDeviceCode?(config: AuthConfig, codeChallenge?: string, meta?: AuthPayload): Promise<AuthDeviceCode>;
  pollToken?(config: AuthConfig, deviceCode: string, codeVerifier?: string, extraData?: AuthPayload): Promise<AuthPollResult>;
  exchangeToken?(config: AuthConfig, code: string, redirectUri: string, codeVerifier: string, state: string, meta?: AuthPayload): Promise<AuthPayload>;
  postExchange?(tokens: AuthPayload): Promise<AuthPayload>;
  mapTokens(tokens: AuthPayload, extra?: AuthPayload): AuthTokens;
}
export function authErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export interface AuthLogger {
  info?(event: string, message: string, details?: AuthPayload): void;
  warn?(event: string, message: string, details?: AuthPayload): void;
  error?(event: string, message: string, details?: AuthPayload): void;
  debug?(event: string, message: string, details?: AuthPayload): void;
}
