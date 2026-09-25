/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { createHash } from "crypto";
import { PROVIDER_PRESETS, type ProviderKind } from "../../shared/providerCatalog";

export interface ApiKeyPoolProvider {
  id: string;
  baseUrl: string;
  kind?: string;
  enabled?: boolean;
  apiKeys?: { id: string; label?: string; enabled?: boolean; hasKey?: boolean }[];
  apiKeyBalance?: "first" | "round-robin";
}

export interface ApiKeyCredential { id: string; apiKey: string; legacy: boolean }
type Snapshot = { balance: "first" | "round-robin"; credentials: ApiKeyCredential[] };
type PoolRequest = {
  apiBaseUrl: string;
  signal: AbortSignal;
  maxAttempts?: number;
  onRetry?: (attempt: number, max: number, delayMs: number, error: string) => void;
};

/** Terminal at this layer: callers must not replay an exhausted/partial request. */
export class ApiKeyPoolError extends Error {
  readonly retryable = false;
  constructor(message: string, public readonly status?: number) { super(message); this.name = "ApiKeyPoolError"; }
}

function statusOf(error: unknown): number | undefined {
  const value = Number((error as { status?: unknown } | undefined)?.status);
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
}

function failoverAllowed(error: unknown): boolean {
  if ((error as { name?: string } | undefined)?.name === "AbortError" || (error as { retryable?: boolean } | undefined)?.retryable === false) return false;
  const status = statusOf(error);
  if (status !== undefined) return [401, 403, 408, 429].includes(status) || status >= 500;
  if (error instanceof TypeError) return /fetch|network|socket|connection/i.test(error.message);
  const code = String((error as { code?: unknown; cause?: { code?: unknown } } | undefined)?.code
    ?? (error as { cause?: { code?: unknown } } | undefined)?.cause?.code ?? "");
  return /^(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|UND_ERR_)/.test(code)
    || (error instanceof Error && /connection timed out|network (?:error|failure)|socket hang up/i.test(error.message));
}

function endpoint(value: string): string { return value.replace(/\/+$/, ""); }
function fingerprint(secret: string): string { return createHash("sha256").update(secret).digest("hex"); }

async function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
    })]);
  } finally { if (abort) signal.removeEventListener("abort", abort); }
}

/** One endpoint only. Holds cursors/cooldowns, never stored plaintext credentials. */
export class ApiKeyPool {
  private cursor: string | undefined;
  private readonly cooldown = new Map<string, { until: number; fingerprint: string }>();

  constructor(
    readonly providerId: string,
    readonly apiBaseUrl: string,
    private readonly resolve: () => Promise<Snapshot>,
    private readonly now: () => number = Date.now,
  ) {}

  private async select(excluded: Set<string>, signal: AbortSignal): Promise<ApiKeyCredential | undefined> {
    signal.throwIfAborted();
    const snapshot = await untilAborted(this.resolve(), signal);
    signal.throwIfAborted();
    const credentials = snapshot.credentials.filter((credential, index, all) => all.findIndex(other => other.id === credential.id || other.apiKey === credential.apiKey) === index);
    const ids = new Set(credentials.map(credential => credential.id));
    for (const id of this.cooldown.keys()) if (!ids.has(id)) this.cooldown.delete(id);
    const previous = credentials.findIndex(credential => credential.id === this.cursor);
    const start = snapshot.balance === "round-robin" && previous >= 0 ? (previous + 1) % credentials.length : 0;
    for (let offset = 0; offset < credentials.length; offset++) {
      const credential = credentials[(start + offset) % credentials.length];
      if (excluded.has(credential.id)) continue;
      const blocked = this.cooldown.get(credential.id);
      if (blocked && blocked.until > this.now() && blocked.fingerprint === fingerprint(credential.apiKey)) continue;
      this.cooldown.delete(credential.id);
      this.cursor = credential.id;
      return credential;
    }
    return undefined;
  }

  private fail(credential: ApiKeyCredential, error: unknown) {
    // A replaced secret is eligible immediately; no plaintext remains in the pool.
    const status = statusOf(error);
    const suggested = Number((error as { retryAfterMs?: unknown } | undefined)?.retryAfterMs);
    const duration = status === 401 || status === 403 ? 300_000 : status === 429 ? 60_000 : 15_000;
    this.cooldown.set(credential.id, {
      until: this.now() + Math.min(300_000, Math.max(duration, Number.isFinite(suggested) ? suggested : 0)),
      fingerprint: fingerprint(credential.apiKey),
    });
  }

  async *stream<T>(make: (credential: ApiKeyCredential) => AsyncGenerator<T>, options: PoolRequest & { visible: (event: T) => boolean }): AsyncGenerator<T> {
    if (endpoint(options.apiBaseUrl) !== endpoint(this.apiBaseUrl)) throw new ApiKeyPoolError("API key pool cannot be used with a different provider endpoint.");
    const attempted = new Set<string>();
    const secrets = new Set<string>();
    const max = Math.max(1, Math.min(5, Math.floor(Number.isFinite(options.maxAttempts) ? options.maxAttempts! : 5)));
    let lastError: ApiKeyPoolError | undefined;
    const redact = (error: unknown) => {
      let message = error instanceof Error ? error.message : String(error);
      for (const secret of secrets) if (secret) message = message.split(secret).join("[redacted]");
      return new ApiKeyPoolError(message.slice(0, 600), statusOf(error));
    };
    for (let attempt = 1; attempt <= max; attempt++) {
      options.signal.throwIfAborted();
      let credential: ApiKeyCredential | undefined;
      try { credential = await this.select(attempted, options.signal); }
      catch (error) { if (options.signal.aborted) throw options.signal.reason; throw redact(error); }
      if (!credential) throw lastError ?? new ApiKeyPoolError("No enabled API key is available for this provider. Check its keys or retry after the cooldown.");
      attempted.add(credential.id);
      secrets.add(credential.apiKey);
      let visible = false;
      try {
        for await (const event of make(credential)) {
          visible ||= options.visible(event);
          yield event;
        }
        this.cooldown.delete(credential.id);
        return;
      } catch (error) {
        if (options.signal.aborted) throw options.signal.reason;
        if ((error as { name?: string } | undefined)?.name === "AbortError") throw error;
        lastError = redact(error);
        if (visible || !failoverAllowed(error)) throw lastError;
        this.fail(credential, error);
        if (attempt === max) throw lastError;
        options.onRetry?.(attempt, max, 0, lastError.message);
      }
    }
  }

  async request<T>(make: (credential: ApiKeyCredential) => Promise<T>, options: PoolRequest): Promise<T> {
    for await (const value of this.stream(async function* (credential) { yield await make(credential); }, { ...options, visible: () => true })) return value;
    throw new ApiKeyPoolError("The provider returned no response.");
  }
}

const pools = new WeakMap<object, Map<string, ApiKeyPool>>();

/** Share rotation across chat, children, auxiliary requests and model discovery. */
export function providerApiKeyPool(
  provider: ApiKeyPoolProvider,
  source: { get(): { providers: ApiKeyPoolProvider[] } },
  secrets: { getProviderKey(id: string): Promise<string | undefined> },
): ApiKeyPool {
  let entries = pools.get(source);
  if (!entries) { entries = new Map(); pools.set(source, entries); }
  const existing = entries.get(provider.id);
  if (existing?.apiBaseUrl === provider.baseUrl) return existing;
  const id = provider.id;
  const baseUrl = provider.baseUrl;
  const pool = new ApiKeyPool(id, baseUrl, async () => {
    const current = source.get().providers.find(item => item.id === id);
    if (!current || current.enabled === false) throw new ApiKeyPoolError("The selected API provider is unavailable or disabled.");
    if (endpoint(current.baseUrl) !== endpoint(baseUrl)) throw new ApiKeyPoolError("The provider endpoint changed. Start a new request to use its updated settings.");
    const legacy = current.apiKeys === undefined;
    const keys = current.apiKeys ?? [{ id, enabled: true }];
    const credentials = (await Promise.all(keys.filter(key => key && typeof key.id === "string" && key.enabled !== false && (key.id === id || key.id.startsWith(`${id}:key:`))).map(async key => {
      let apiKey: string;
      try { apiKey = (await secrets.getProviderKey(key.id))?.trim() ?? ""; }
      catch { throw new ApiKeyPoolError("Could not read this provider's stored API keys."); }
      return apiKey ? { id: key.id, apiKey, legacy } : undefined;
    }))).filter((key): key is ApiKeyCredential => !!key);
    const latest = source.get().providers.find(item => item.id === id);
    if (!latest || latest.enabled === false) throw new ApiKeyPoolError("The selected API provider is unavailable or disabled.");
    if (endpoint(latest.baseUrl) !== endpoint(baseUrl)) throw new ApiKeyPoolError("The provider endpoint changed. Start a new request to use its updated settings.");
    const latestKeys = latest.apiKeys ?? [{ id, enabled: true }];
    const stillEnabled = credentials.filter(credential => latestKeys.some(key => key && key.id === credential.id && key.enabled !== false));
    const noAuthPreset = latest.kind && Object.prototype.hasOwnProperty.call(PROVIDER_PRESETS, latest.kind)
      ? PROVIDER_PRESETS[latest.kind as ProviderKind] : undefined;
    if (!stillEnabled.length && noAuthPreset?.noAuth && id === `popular:${latest.kind}`
      && endpoint(latest.baseUrl) === endpoint(noAuthPreset.baseUrl)) stillEnabled.push({ id, apiKey: "", legacy: false });
    // Legacy custom/local servers can be unauthenticated. Explicit [] always means no keys.
    if (legacy && latest.apiKeys === undefined && !stillEnabled.length && current.kind !== "anthropic" && !id.startsWith("popular:")) stillEnabled.push({ id, apiKey: "", legacy: true });
    return { balance: latest.apiKeyBalance ?? "first", credentials: stillEnabled };
  });
  entries.set(id, pool);
  return pool;
}
