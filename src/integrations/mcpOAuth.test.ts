/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, expect, it, vi } from "vitest";
import { McpOAuthProvider, validateMcpRemoteUrl } from "./mcpOAuth";

let provider: McpOAuthProvider | undefined;
afterEach(() => provider?.endAuthorization());

function fixture() {
  const values = new Map<string, string>();
  const open = vi.fn(async () => true);
  const secrets = { get: async (key: string) => values.get(key), store: async (key: string, value: string) => { values.set(key, value); }, delete: async (key: string) => { values.delete(key); } };
  provider = new McpOAuthProvider("https://mcp.example.test/api", "example", secrets, open);
  return { provider, open, values, secrets };
}

it("never opens a browser from a noninteractive connection or registers a client without login", async () => {
  const fixtureState = fixture();
  await expect(fixtureState.provider.clientInformation()).rejects.toThrow("Authentication required");
  await expect(fixtureState.provider.redirectToAuthorization(new URL("https://login.example.test/authorize"))).rejects.toThrow("Authentication required");
  expect(fixtureState.open).not.toHaveBeenCalled();
});

it("validates OAuth callback state, exchanges no code on bad state and retains PKCE only in memory", async () => {
  const f = fixture(); await f.provider.beginAuthorization(5000);
  const state = f.provider.state();
  f.provider.saveCodeVerifier("fixture-pkce-verifier");
  const authorization = new URL("https://login.example.test/authorize"); authorization.searchParams.set("state", state);
  await f.provider.redirectToAuthorization(authorization);
  expect(f.open).toHaveBeenCalledWith(authorization.toString());
  const bad = await fetch(`${f.provider.redirectUrl}?state=bad&code=untrusted`);
  expect(bad.status).toBe(400);
  const accepted = await fetch(`${f.provider.redirectUrl}?state=${state}&code=confirmed-code`);
  expect(accepted.status).toBe(200);
  expect(await f.provider.waitForCode()).toBe("confirmed-code");
  expect(f.provider.codeVerifier()).toBe("fixture-pkce-verifier");
  expect([...f.values.values()].join("")).not.toContain("fixture-pkce-verifier");
  f.provider.endAuthorization();
  expect(() => f.provider.codeVerifier()).toThrow("expired");
});

it("stores credentials per server identity and invalidates them on logout", async () => {
  const f = fixture();
  await f.provider.saveTokens({ access_token: "test-access", token_type: "Bearer", refresh_token: "test-refresh" });
  const second = new McpOAuthProvider("https://mcp.example.test/api", "other-server", f.secrets, f.open);
  expect(await second.tokens()).toBeUndefined();
  expect((await f.provider.tokens())?.refresh_token).toBe("test-refresh");
  await f.provider.invalidateCredentials("all");
  expect(await f.provider.tokens()).toBeUndefined(); expect(f.values.size).toBe(0);
  expect(() => validateMcpRemoteUrl("http://remote.example.test/mcp")).toThrow("HTTPS");
  expect(() => validateMcpRemoteUrl("https://user:secret@example.test/mcp")).toThrow("URL credentials");
});
