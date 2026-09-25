/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// OpenCursor adapter: per-login cancellation without modifying global fetch.
import { AsyncLocalStorage } from "node:async_hooks";
import type { AuthPayload } from "./types.js";
/** Provider-defined JSON is normalized and validated by each authentication adapter. */
export interface AuthResponse extends Response { json(): Promise<AuthPayload> }
interface AuthRequestContext { signal?: AbortSignal; timeoutMs: number }
const requests = new AsyncLocalStorage<AuthRequestContext>();
export function withAuthSignal<T>(signal: AbortSignal | undefined, run: () => T, { timeoutMs = 30_000 }: { timeoutMs?: number } = {}): T {
  return requests.run({ signal, timeoutMs }, run);
}
export function authFetch(url: string | URL | Request, init: RequestInit = {}): Promise<AuthResponse> {
  const context = requests.getStore();
  // Authentication is bounded here; generation uses the caller's connection,
  // inactivity and cancellation deadlines without truncating a healthy stream.
  const timeoutMs = context?.timeoutMs ?? 30_000;
  const signals = [context?.signal, init.signal, timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined].filter((signal): signal is AbortSignal => !!signal);
  const signal = AbortSignal.any(signals);
  signal.throwIfAborted();
  return globalThis.fetch(url, { ...init, signal }) as Promise<AuthResponse>;
}
