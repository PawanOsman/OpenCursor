/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// Service-account credentials remain in host memory and never enter UI status.
import { createHash, sign } from "node:crypto";
import { authFetch } from "./auth/network.js";
import type { AuthLogger } from "./auth/types.js";

export interface GoogleServiceAccount extends Record<string, unknown> {
  type: "service_account";
  client_email: string;
  private_key: string;
  project_id?: string;
}
export interface GoogleAccessToken { accessToken: string; expiresAt: number }
const tokens = new Map<string, GoogleAccessToken>();

export function parseVertexSaJson(value: unknown): GoogleServiceAccount | null {
  try {
    const data: unknown = typeof value === "string" ? JSON.parse(value) : value;
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const account = data as Record<string, unknown>;
    if (account.type !== "service_account" || typeof account.client_email !== "string" || typeof account.private_key !== "string") return null;
    if (account.project_id !== undefined && typeof account.project_id !== "string") return null;
    return account as GoogleServiceAccount;
  } catch { return null; }
}

export async function refreshVertexToken(account: GoogleServiceAccount, _log?: AuthLogger): Promise<GoogleAccessToken> {
  const key = createHash("sha256").update(account.client_email).update(account.private_key).digest("hex");
  const cached = tokens.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached;
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: Record<string, string | number>): string => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: account.client_email, scope: "https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  let assertion: string;
  try { assertion = `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), account.private_key).toString("base64url")}`; }
  catch { throw Object.assign(new Error("The service account private key is invalid."), { status: 400 }); }
  const response = await authFetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(30_000),
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) throw Object.assign(new Error(`Google service-account authentication failed (${response.status}).`), { status: response.status });
  const data = await response.json() as { access_token?: unknown; expires_in?: unknown };
  if (typeof data.access_token !== "string" || !data.access_token) throw Object.assign(new Error("Google returned no service-account access token."), { status: 502 });
  const token = { accessToken: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  if (tokens.size >= 100) {
    const oldest = tokens.keys().next().value;
    if (oldest !== undefined) tokens.delete(oldest);
  }
  tokens.set(key, token);
  return token;
}
