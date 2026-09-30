/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OAuthAccount, OAuthBalanceStrategy } from "./oauth/types";

vi.mock("vscode", () => ({ EventEmitter: class { event = () => ({ dispose() {} }); fire() {} } }));
vi.mock("../stores/featureStore", () => ({ MODEL_CATALOG: [] }));
import { disconnect, initOAuth, listAccounts, setAccountEnabled, streamOAuthChat } from "./oauth";

const saved = new Map<string, string>();
let persistedIds: string[] = [];
let beforeStore: ((key: string, value: string) => Promise<void>) | undefined;
const secretKey = (id: string) => `ocursor.oauth.acct.${id}`;

function fixture(id: string, expiresAt = Date.now() + 3_600_000): OAuthAccount {
  return { id, kind: "codex", accountId: id, accessToken: "old-access", refreshToken: "old-refresh", expiresAt };
}

async function seed(accounts: OAuthAccount[], strategy: OAuthBalanceStrategy = "first") {
  persistedIds = accounts.map((account) => account.id);
  for (const account of accounts) saved.set(secretKey(account.id), JSON.stringify(account));
  initOAuth({
    globalState: {
      get: (key: string, fallback: unknown) => key === "ocursor.oauth.accountIds" ? [...persistedIds]
        : key === "ocursor.oauth.balanceStrategy" ? strategy : fallback,
      update: async (key: string, value: unknown) => { if (key === "ocursor.oauth.accountIds") persistedIds = [...value as string[]]; },
    },
    secrets: {
      get: async (key: string) => saved.get(key),
      store: async (key: string, value: string) => {
        await beforeStore?.(key, value);
        saved.set(key, value);
      },
      delete: async (key: string) => { saved.delete(key); },
    },
  } as unknown as Parameters<typeof initOAuth>[0]);
  await vi.waitFor(() => expect(listAccounts().map((account) => account.id)).toEqual(accounts.map((account) => account.id)));
}

async function chat(signal = new AbortController().signal) {
  for await (const _event of streamOAuthChat("codex", {
    model: "gpt-5.6-sol", messages: [{ role: "user", content: "Hello" }], promptCacheKey: "persistence-fixture", signal,
  })) { /* consume the real account router, transport and stream parser */ }
}

function delayRotatedCredentialWrite() {
  let release: (() => void) | undefined;
  beforeStore = async (_key, value) => {
    const account = JSON.parse(value) as OAuthAccount;
    if (account.accessToken === "new-access" && !account.disabled && !release) {
      await new Promise<void>((resolve) => { release = resolve; });
    }
  };
  const fetchMock = vi.fn(async (url: string) => url.includes("/token")
    ? Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 })
    : new Response('data: {"type":"response.completed","response":{"status":"completed"}}\n\n'));
  vi.stubGlobal("fetch", fetchMock);
  return {
    waitForStore: () => vi.waitFor(() => expect(release).toBeTypeOf("function")),
    release: () => release?.(),
    fetchMock,
  };
}

beforeEach(async () => {
  beforeStore = undefined;
  for (const account of listAccounts()) await disconnect(account.id);
  saved.clear();
  persistedIds = [];
});
afterEach(() => { beforeStore = undefined; vi.unstubAllGlobals(); });

describe("OAuth credential persistence ordering", () => {
  it("ignores a stale secret-load completion after switching contexts", async () => {
    let release!: (value: string) => void;
    initOAuth({ globalState: { get: (_key: string, fallback: unknown) => Array.isArray(fallback) ? ["stale"] : fallback },
      secrets: { get: () => new Promise<string>(resolve => { release = resolve; }) } } as unknown as Parameters<typeof initOAuth>[0]);
    await seed([fixture("current-context")]);
    release(JSON.stringify(fixture("stale")));
    await Promise.resolve(); await Promise.resolve();
    expect(listAccounts().map(account => account.id)).toEqual(["current-context"]);
  });

  it("resets transient account cooldown when reinitializing the same fixture context", async () => {
    const account = fixture("reinitialized");
    await seed([account]);
    const fetch = vi.fn().mockResolvedValueOnce(new Response("limited", { status: 429 }))
      .mockResolvedValue(new Response('data: {"type":"response.completed","response":{"status":"completed"}}\n\n'));
    vi.stubGlobal("fetch", fetch);
    await expect(chat()).rejects.toMatchObject({ status: 429 });
    await seed([account]);
    await expect(chat()).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("keeps a later disable durable when refresh credential storage is still pending", async () => {
    const account = fixture("persistence-disable", Date.now() - 1);
    await seed([account]);
    const gate = delayRotatedCredentialWrite();
    const request = chat().catch((error: unknown) => error);
    await gate.waitForStore();
    const disabled = setAccountEnabled(account.id, false);
    try {
      expect(listAccounts()[0].disabled).toBe(true);
    } finally {
      gate.release();
      await Promise.all([request, disabled]);
    }
    expect(JSON.parse(saved.get(secretKey(account.id))!)).toMatchObject({
      accessToken: "new-access", refreshToken: "new-refresh", disabled: true,
    });
    expect(persistedIds).toEqual([account.id]);
  });

  it("removes pending refresh credentials and prevents dispatch after disconnect", async () => {
    const account = fixture("persistence-disconnect", Date.now() - 1);
    await seed([account]);
    const gate = delayRotatedCredentialWrite();
    const request = chat().then(() => "completed", (error: unknown) => error);
    await gate.waitForStore();
    const disconnected = disconnect(account.id);
    try {
      expect(listAccounts()).toEqual([]);
    } finally {
      gate.release();
      await disconnected;
    }
    expect(await request).toBeInstanceOf(Error);
    expect(saved.has(secretKey(account.id))).toBe(false);
    expect(persistedIds).toEqual([]);
    // Only token rotation began; the removed account never starts inference.
    expect(gate.fetchMock).toHaveBeenCalledOnce();
  });
});

describe("OAuth account selection cancellation", () => {
  it.each(["highest-limit", "nearest-reset"] as const)("stops waiting for %s quota scoring immediately", async (strategy) => {
    await seed([fixture("scoring-one"), fixture("scoring-two")], strategy);
    const release: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { release.push(resolve); }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const request = chat(controller.signal).then(() => "completed", (error: Error) => error.name);
    await vi.waitFor(() => expect(release).toHaveLength(2));
    controller.abort();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await Promise.race([
        request,
        new Promise<string>((resolve) => { timeout = setTimeout(() => resolve("still waiting for quota"), 100); }),
      ]);
      expect(outcome).toBe("AbortError");
    } finally {
      clearTimeout(timeout);
      release.forEach((resolve) => resolve(Response.json({})));
      await request;
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
