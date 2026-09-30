/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

/** Public, token-free OAuth types shared across the OAuth subsystem and UI. */

/** OAuth provider kinds we support (login with an account, not an API key). */
export type OAuthKind = import("../../shared/oauthProviders").OAuthProviderKind;

export interface OAuthAccount {
  /** Unique id for this account (allows multiple accounts per kind). */
  id: string;
  kind: OAuthKind;
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
  email?: string;
  /** Anthropic account uuid, or Codex chatgpt_account_id. */
  accountId?: string;
  /** Raw OpenAI id_token (Codex only). */
  idToken?: string;
  /** Google Cloud project id (Antigravity only). */
  projectId?: string;
  /** Provider-specific session/region metadata, kept only in secret storage. */
  providerSpecificData?: Record<string, unknown>;
  /** Disabled accounts are skipped by routing/load balancing. */
  disabled?: boolean;
}

/** How to pick among multiple accounts of the same kind. */
export type OAuthBalanceStrategy = "first" | "round-robin" | "highest-limit" | "nearest-reset";

/** One usage/limit window for an account (e.g. 5-hour, weekly). */
export interface OAuthLimit {
  label: string;
  /** Percent of the quota still available (0–100). */
  remaining: number;
  limit: number;
  /** Epoch ms when this window resets (optional). */
  resetsAt?: number;
}

/** Usage snapshot for an account: limit windows + optional Codex reset credits. */
export interface OAuthUsage {
  limits: OAuthLimit[];
  /** Codex only: available rate-limit reset credits the user can spend. */
  resetCredits?: number;
}

/** Public summary of a connected account (no token material). */
export interface OAuthAccountInfo {
  id: string;
  kind: OAuthKind;
  email?: string;
  accountId?: string;
  disabled?: boolean;
}

export interface OAuthStatus {
  /** Connected accounts (multiple per kind allowed). */
  accounts: OAuthAccountInfo[];
  /** Kind currently mid-login (waiting for the browser callback). */
  pending?: OAuthKind;
  /** Current sign-in link; contains a PKCE challenge, never the verifier or account tokens. */
  authorizationUrl?: string;
  loginMethod?: "browser" | "device-code" | "import-token";
  userCode?: string;
  verificationUri?: string;
  expiresAt?: number;
  /** Login errors keyed by kind. */
  errors: Partial<Record<OAuthKind, string>>;
  /** Load-balancing strategy for kinds with multiple accounts. */
  balanceStrategy: OAuthBalanceStrategy;
  balanceStrategies?: Partial<Record<OAuthKind, OAuthBalanceStrategy>>;
}
