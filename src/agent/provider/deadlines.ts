/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

/** A deadline applies to each event, never to the total length of a useful run. */
export async function* withStreamDeadline<T>(
  source: (signal: AbortSignal) => AsyncGenerator<T>, signal: AbortSignal,
  firstEventMs = 120_000, idleMs = 180_000,
): AsyncGenerator<T> {
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  const iterator = source(combined);
  let first = true;
  try {
    for (;;) {
      combined.throwIfAborted();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      try {
        const deadline = new Promise<never>((_, reject) => {
          onAbort = () => reject(combined.reason ?? new DOMException("Aborted", "AbortError"));
          combined.addEventListener("abort", onAbort, { once: true });
          timer = setTimeout(() => controller.abort(new Error(first
            ? "Provider did not begin responding before the connection deadline. Check the endpoint or local model readiness."
            : "Provider stream stalled before completion. Received output was preserved; no tools were replayed.")), first ? firstEventMs : idleMs);
        });
        const result = await Promise.race([iterator.next(), deadline]);
        if (result.done) return;
        first = false;
        yield result.value;
      } finally {
        if (timer) clearTimeout(timer);
        if (onAbort) combined.removeEventListener("abort", onAbort);
      }
    }
  } finally {
    controller.abort();
    // A broken provider must not hold cleanup forever by ignoring cancellation.
    void iterator.return(undefined as never).catch(() => {});
  }
}

export async function fetchWithConnectionTimeout(url: string | URL, init?: RequestInit, timeoutMs = 45_000): Promise<Response> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new Error("Provider connection timed out")), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout.signal]) : timeout.signal });
  } finally { clearTimeout(timer); }
}
