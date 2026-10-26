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
  // One abort listener for the whole stream instead of adding and removing one
  // per token event. (A single long-lived race promise would instead retain a
  // reaction per event, so each wait still gets its own short-lived promise.)
  let rejectWait: ((reason: unknown) => void) | undefined;
  const onAbort = () => rejectWait?.(combined.reason ?? new DOMException("Aborted", "AbortError"));
  combined.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      combined.throwIfAborted();
      // The deadline only covers waiting on the provider, never the consumer.
      const timer = setTimeout(() => controller.abort(new Error(first
        ? "Provider did not begin responding before the connection deadline. Check the endpoint or local model readiness."
        : "Provider stream stalled before completion. Received output was preserved; no tools were replayed.")), first ? firstEventMs : idleMs);
      let result: IteratorResult<T>;
      try {
        result = await Promise.race([iterator.next(), new Promise<never>((_, reject) => { rejectWait = reject; })]);
      } finally {
        rejectWait = undefined;
        clearTimeout(timer);
      }
      if (result.done) return;
      first = false;
      yield result.value;
    }
  } finally {
    combined.removeEventListener("abort", onAbort);
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
