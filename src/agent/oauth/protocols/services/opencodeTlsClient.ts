/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// TLS-impersonating HTTP client for opencode.ai's free tier (9router parity).
//
// The free gate keys on the TLS ClientHello, not on headers: Node's OpenSSL
// fingerprint is refused with 429 FreeUsageLimitError while Bun's BoringSSL
// cipher list passes. Only the cipher-list hash is compared (JA4), so the list
// below must stay verbatim.
//
// wreq-js is an optional native dependency loaded on demand; when it cannot be
// loaded the caller falls back to native fetch.

import { loadRuntimeDep } from "./lazyRuntime.js";

const OPENCODE_CIPHER_LIST = [
  "TLS_AES_128_GCM_SHA256",
  "TLS_AES_256_GCM_SHA384",
  "TLS_CHACHA20_POLY1305_SHA256",
  "ECDHE-ECDSA-AES128-GCM-SHA256",
  "ECDHE-RSA-AES128-GCM-SHA256",
  "ECDHE-ECDSA-AES256-GCM-SHA384",
  "ECDHE-RSA-AES256-GCM-SHA384",
  "ECDHE-ECDSA-CHACHA20-POLY1305",
  "ECDHE-RSA-CHACHA20-POLY1305",
  "ECDHE-ECDSA-AES128-SHA",
  "ECDHE-RSA-AES128-SHA",
  "ECDHE-ECDSA-AES256-SHA",
  "ECDHE-RSA-AES256-SHA",
  "AES128-GCM-SHA256",
  "AES256-GCM-SHA384",
  "AES128-SHA",
  "AES256-SHA",
].join(":");

const DEFAULT_TIMEOUT_MS = 120000;

type BodyInit = ConstructorParameters<typeof Response>[0];
type HeadersInit = ConstructorParameters<typeof Headers>[0];
interface WreqResponse { status: number; statusText: string; headers?: { forEach?(cb: (value: string, key: string) => void): void }; body: BodyInit | null }
interface WreqSession { fetch(url: string, options: Record<string, unknown>): Promise<WreqResponse>; close?(): unknown }

let sessionPromise: Promise<WreqSession> | null = null;

export class OpencodeTlsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpencodeTlsUnavailableError";
  }
}

function loadSession(): Promise<WreqSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const wreq = await loadRuntimeDep("wreq-js") as { createSession?: (options: unknown) => Promise<WreqSession> };
      if (typeof wreq.createSession !== "function") throw new Error("wreq-js runtime is missing createSession");
      return wreq.createSession({ emulation: { tlsOptions: { cipherList: OPENCODE_CIPHER_LIST } } });
    })().catch((error) => {
      sessionPromise = null;
      throw error;
    });
  }
  return sessionPromise;
}

export function resetOpencodeTlsSession(): void {
  const pending = sessionPromise;
  sessionPromise = null;
  pending?.then((session) => session.close?.()).catch(() => {});
}

/** Fetch through the impersonated-TLS session; streams the body without buffering. */
export async function opencodeTlsFetch(
  url: string,
  init: { method?: string; headers?: HeadersInit; body?: BodyInit | null } = {},
  { signal, timeoutMs = DEFAULT_TIMEOUT_MS }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Response> {
  let session: WreqSession;
  try {
    session = await loadSession();
  } catch (error) {
    throw new OpencodeTlsUnavailableError(
      `wreq-js unavailable (${error instanceof Error ? error.message : "unknown"}) — install the optional wreq-js dependency to reach the OpenCode free tier`
    );
  }
  const options: Record<string, unknown> = { method: init.method || "GET", headers: init.headers, redirect: "follow", timeout: timeoutMs };
  if (init.body !== undefined) options.body = init.body;
  if (signal) options.signal = signal;

  const res = await session.fetch(url, options);
  const headers: Record<string, string> = {};
  res.headers?.forEach?.((value, key) => { headers[key] = value; });
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export const __test__ = { OPENCODE_CIPHER_LIST };
