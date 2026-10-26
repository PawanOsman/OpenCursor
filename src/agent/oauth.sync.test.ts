/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OAuthAccount } from "./oauth/types";

vi.mock("vscode", () => ({ EventEmitter: class { event = () => ({ dispose() {} }); fire() {} } }));
vi.mock("../stores/featureStore", () => ({ MODEL_CATALOG: [] }));
import { disconnect, initOAuth, listAccounts, setAccountEnabled, streamOAuthChat } from "./oauth";

/** SecretStorage shared by two simulated windows. */
const saved = new Map<string, string>();
let persistedIds: string[] = [];
let listeners: ((event: { key: string }) => void)[] = [];
const secretKey = (id: string) => `ocursor.oauth.acct.${id}`;

function fixture(id: string, overrides: Partial<OAuthAccount> = {}): OAuthAccount {
  return { id, kind: "codex", accountId: id, accessToken: "old-access", refreshToken: "old-refresh", expiresAt: Date.now() + 3_600_000, ...overrides };
}

/** A write from another VS Code window: store directly, then notify. */
function otherWindow(id: string, account?: OAuthAccount) {
  if (account) saved.set(secretKey(id), JSON.stringify(account));
  else saved.delete(secretKey(id));
  for (const listener of listeners) listener({ key: secretKey(id) });
}

async function seed(accounts: OAuthAccount[]) {
  persistedIds = accounts.map((account) => account.id);
  for (const account of accounts) saved.set(secretKey(account.id), JSON.stringify(account));
  initOAuth({
    subscriptions: [],
    globalState: {
      get: (key: string, fallback: unknown) => key === "ocursor.oauth.accountIds" ? [...persistedIds] : fallback,
      update: async (key: string, value: unknown) => { if (key === "ocursor.oauth.accountIds") persistedIds = [...value as string[]]; },
    },
    secrets: {
      get: async (key: string) => saved.get(key),
      store: async (key: string, value: string) => { saved.set(key, value); for (const listener of listeners) listener({ key }); },
      delete: async (key: string) => { saved.delete(key); for (const listener of listeners) listener({ key }); },
      onDidChange: (listener: (event: { key: string }) => void) => {
        listeners.push(listener);
        return { dispose: () => { listeners = listeners.filter((item) => item !== listener); } };
      },
    },
  } as unknown as Parameters<typeof initOAuth>[0]);
  await vi.waitFor(() => expect(listAccounts().map((account) => account.id)).toEqual(accounts.map((account) => account.id)));
}

beforeEach(async () => {
  for (const account of listAccounts()) await disconnect(account.id);
  saved.clear(); persistedIds = []; listeners = [];
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("OAuth cross-window synchronization", () => {
  it("adopts accounts added, changed and removed by another window", async () => {
    await seed([fixture("codex:a")]);
    otherWindow("codex:b", fixture("codex:b"));
    await vi.waitFor(() => expect(listAccounts().map((account) => account.id)).toEqual(["codex:a", "codex:b"]));
    otherWindow("codex:a", fixture("codex:a", { disabled: true }));
    await vi.waitFor(() => expect(listAccounts().find((account) => account.id === "codex:a")?.disabled).toBe(true));
    otherWindow("codex:b");
    await vi.waitFor(() => expect(listAccounts().map((account) => account.id)).toEqual(["codex:a"]));
  });

  it("uses a token another window already refreshed instead of rotating it again", async () => {
    await seed([fixture("codex:a", { expiresAt: Date.now() - 1000 })]);
    // Simulate a missed change event: only the store has the other window's rotation.
    saved.set(secretKey("codex:a"), JSON.stringify(fixture("codex:a", { accessToken: "other-access", refreshToken: "other-refresh" })));
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('data: {"type":"response.completed","response":{"status":"completed"}}\n\n'));
    vi.stubGlobal("fetch", fetchMock);
    for await (const _event of streamOAuthChat("codex", {
      model: "gpt-5.6-sol", messages: [{ role: "user", content: "Hello" }], promptCacheKey: "sync-fixture", signal: new AbortController().signal,
    })) { /* consume */ }
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/token"))).toBe(false);
    expect(JSON.stringify(fetchMock.mock.calls[0][1]?.headers)).toContain("other-access");
  });

  it("merges the account index instead of overwriting another window's ids", async () => {
    await seed([fixture("codex:a")]);
    persistedIds = [...persistedIds, "codex:elsewhere"];
    await setAccountEnabled("codex:a", false);
    expect(persistedIds.sort()).toEqual(["codex:a", "codex:elsewhere"]);
    await disconnect("codex:a");
    expect(persistedIds).toEqual(["codex:elsewhere"]);
  });
});
