/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { createServer, type Server } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

export interface McpSecretStorage {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

export class McpAuthRequiredError extends Error {
  constructor() { super("Authentication required. Use Sign in for this MCP server in Settings."); }
}

interface SavedCredentials { client?: OAuthClientInformationMixed; tokens?: OAuthTokens; redirectUrl?: string }

export function validateMcpRemoteUrl(value: string): URL {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("Remote MCP requires HTTPS, or HTTP on localhost.");
  if (url.username || url.password) throw new Error("MCP URL credentials are not supported; use OAuth or configured headers.");
  return url;
}

/** One server identity; credentials stay in host secret storage, PKCE/state stay in memory. */
export class McpOAuthProvider implements OAuthClientProvider {
  private saved?: SavedCredentials;
  private verifier?: string;
  private nonce = "";
  private server?: Server;
  private callback?: Promise<string>;
  private resolveCode?: (code: string) => void;
  private rejectCode?: (error: Error) => void;
  private timeout?: ReturnType<typeof setTimeout>;
  private redirect = "http://127.0.0.1/mcp/oauth/callback";
  private interactive = false;
  public authorizationUrl?: string;
  readonly key: string;

  constructor(readonly serverUrl: string, readonly serverName: string, private readonly secrets: McpSecretStorage,
    private readonly openExternal: (url: string) => PromiseLike<unknown>, private readonly options: { clientId?: string; scopes?: string[] } = {}) {
    this.key = `ocursor.mcp.oauth.${createHash("sha256").update(`${serverName}\0${serverUrl}`).digest("hex")}`;
  }

  get redirectUrl(): string { return this.redirect; }
  get clientMetadata(): OAuthClientMetadata {
    return { client_name: "OpenCursor", redirect_uris: [this.redirect], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none", ...(this.options.scopes?.length ? { scope: this.options.scopes.join(" ") } : {}) };
  }
  state(): string { if (!this.interactive) throw new McpAuthRequiredError(); return this.nonce; }
  private async load(): Promise<SavedCredentials> {
    if (!this.saved) {
      try { this.saved = JSON.parse(await this.secrets.get(this.key) || "{}"); } catch { this.saved = {}; }
    }
    return this.saved!;
  }
  private async save(): Promise<void> { await this.secrets.store(this.key, JSON.stringify(this.saved ?? {})); }
  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    if (this.options.clientId) return { client_id: this.options.clientId };
    const saved = await this.load();
    if (!this.interactive && !saved.client) throw new McpAuthRequiredError();
    // Re-register dynamic clients if the authorization server requires an exact redirect URI.
    if (this.interactive && saved.redirectUrl !== this.redirect) return undefined;
    return saved.client;
  }
  async saveClientInformation(client: OAuthClientInformationMixed): Promise<void> { const saved = await this.load(); saved.client = client; saved.redirectUrl = this.redirect; await this.save(); }
  async tokens(): Promise<OAuthTokens | undefined> { return (await this.load()).tokens; }
  async saveTokens(tokens: OAuthTokens): Promise<void> { const saved = await this.load(); saved.tokens = tokens; await this.save(); }
  async redirectToAuthorization(url: URL): Promise<void> {
    if (!this.interactive) throw new McpAuthRequiredError();
    validateMcpRemoteUrl(url.toString());
    if (url.searchParams.get("state") !== this.nonce) throw new Error("OAuth authorization request has an invalid state.");
    this.authorizationUrl = url.toString();
    if (await this.openExternal(this.authorizationUrl) === false) throw new Error("Could not open the browser for MCP sign in.");
  }
  saveCodeVerifier(verifier: string): void { this.verifier = verifier; }
  codeVerifier(): string { if (!this.verifier) throw new Error("OAuth sign-in session expired; sign in again."); return this.verifier; }
  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    const saved = await this.load();
    if (scope === "all" || scope === "client") delete saved.client;
    if (scope === "all" || scope === "tokens") delete saved.tokens;
    if (scope === "all" || scope === "verifier") this.verifier = undefined;
    if (scope === "all") { this.saved = {}; await this.secrets.delete(this.key); }
    else if (scope !== "discovery") await this.save();
  }

  async beginAuthorization(timeoutMs = 300_000): Promise<void> {
    if (this.server) throw new Error("MCP sign in is already running.");
    this.interactive = true; this.nonce = randomBytes(32).toString("hex"); this.authorizationUrl = undefined;
    this.callback = new Promise<string>((resolve, reject) => { this.resolveCode = resolve; this.rejectCode = reject; });
    void this.callback.catch(() => {});
    const server = createServer((request, response) => {
      const url = new URL(request.url || "/", this.redirect);
      response.setHeader("Cache-Control", "no-store");
      const state = Buffer.from(url.searchParams.get("state") || "");
      const expected = Buffer.from(this.nonce);
      if (request.method !== "GET" || request.headers.host !== new URL(this.redirect).host || url.pathname !== "/mcp/oauth/callback" || state.length !== expected.length || !timingSafeEqual(state, expected)) {
        response.writeHead(400); response.end("Invalid authorization callback."); return;
      }
      const code = url.searchParams.get("code");
      if (url.searchParams.has("error") || !code) {
        response.writeHead(400); response.end("Authorization was not completed. Return to OpenCursor.");
        this.rejectCode?.(new Error("MCP authorization was denied or returned no code."));
      } else {
        response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }); response.end("Authorization received. You can return to OpenCursor.");
        this.resolveCode?.(code);
      }
      this.resolveCode = undefined; this.rejectCode = undefined;
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not bind OAuth callback listener.");
    this.redirect = `http://127.0.0.1:${address.port}/mcp/oauth/callback`;
    this.timeout = setTimeout(() => { this.rejectCode?.(new Error("MCP sign in timed out.")); this.endAuthorization(); }, timeoutMs);
  }
  waitForCode(): Promise<string> { if (!this.callback) return Promise.reject(new Error("Sign in has not started.")); return this.callback; }
  endAuthorization(): void {
    clearTimeout(this.timeout); this.timeout = undefined;
    this.rejectCode?.(new Error("MCP sign in was cancelled.")); this.rejectCode = undefined; this.resolveCode = undefined;
    this.server?.close(); this.server?.closeAllConnections(); this.server = undefined;
    this.interactive = false; this.verifier = undefined; this.nonce = "";
  }
}
