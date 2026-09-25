/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as crypto from "crypto";
import * as http from "http";
import type { OAuthAccount, OAuthKind, OAuthStatus } from "./types";
import type { AuthConfig, AuthDeviceCode, AuthPayload, AuthProvider, AuthTokens } from "./auth/types.js";
// Authentication protocols are compiled as part of OpenCursor.
import { PROVIDERS } from "./auth/providers/index.js";
import { withAuthSignal, authFetch } from "./auth/network.js";
import { fetchKiroProfileArn } from "./auth/providerHelpers.js";
import * as xiaomi from "./auth/providers/xiaomi-mimo.js";
import * as refresh from "./auth/refresh/providers.js";

export interface OAuthLoginOptions { clientId?: string; baseUrl?: string; token?: string; machineId?: string; region?: string; startUrl?: string; providerSpecificData?: Record<string, unknown> }
export type AccountLoginState = Pick<OAuthStatus, "authorizationUrl" | "loginMethod" | "userCode" | "verificationUri" | "expiresAt">;
interface LoginHooks { change(): void; complete(account: OAuthAccount): Promise<void>; error(message: string): void; open(url: string): Promise<void> }
const nativeCallbacks = new Set(["trae", "windsurf", "zed", "xiaomi-mimo"]);
const noStateCallbacks = new Set(["cline", "clinepass", "trae", "zed", "xiaomi-mimo"]);

function mappedAccount(kind: OAuthKind, tokens: AuthTokens): OAuthAccount {
  if (typeof tokens?.accessToken !== "string" || !tokens.accessToken.trim()) throw new Error("The provider returned no access token.");
  const absolute = typeof tokens.expiresAt === "string" ? Date.parse(tokens.expiresAt) : Number(tokens.expiresAt);
  const seconds = Number(tokens.expiresIn);
  const email = tokens.email || tokens.providerSpecificData?.email;
  return {
    id: `${kind}:${crypto.randomUUID()}`, kind, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken || "",
    expiresAt: Number.isFinite(absolute) && absolute > 0 ? absolute : tokens.expiresIn != null && Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Number.MAX_SAFE_INTEGER,
    email: typeof email === "string" ? email : undefined, accountId: tokens.accountId, projectId: tokens.projectId,
    providerSpecificData: tokens.providerSpecificData,
  };
}

/** A cancellable browser/device/import flow. Sensitive state never enters status. */
export class AccountLogin {
  readonly abort = new AbortController();
  readonly state: AccountLoginState = {};
  private server?: http.Server;
  private deadline?: ReturnType<typeof setTimeout>;
  private provider!: AuthProvider;
  private config!: AuthConfig;
  private verifier = crypto.randomBytes(96).toString("base64url");
  private nonce = crypto.randomBytes(24).toString("hex");
  private redirect = "";
  private busy = false;
  private keyPair?: { publicKey: string; privateKeyDer: Buffer };

  constructor(readonly kind: OAuthKind, private readonly options: OAuthLoginOptions, private readonly hooks: LoginHooks) {}

  private network<T>(work: () => Promise<T>): Promise<T> { return withAuthSignal(this.abort.signal, work); }

  cancel(closeConnections = true) {
    this.abort.abort();
    if (this.deadline) clearTimeout(this.deadline);
    try { this.server?.close(); if (closeConnections) this.server?.closeAllConnections(); } catch { /* already closed */ }
  }

  async start(): Promise<void> {
    this.abort.signal.throwIfAborted();
    const kind = this.kind;
    this.provider = PROVIDERS[kind];
    if (!this.provider && kind !== "xiaomi-mimo") throw new Error("Unsupported account provider.");
    const flow = this.provider?.flowType ?? "authorization_code";
    this.state.loginMethod = flow === "device_code" ? "device-code" : ["import_token", "browser_token"].includes(flow) ? "import-token" : "browser";
    this.state.expiresAt = Date.now() + 600_000;
    this.deadline = setTimeout(() => { this.hooks.error("Sign-in expired. Add the account again to retry."); this.cancel(); }, 600_000);
    this.hooks.change();
    if (kind === "gitlab") {
      if (!this.options.clientId?.trim()) throw new Error("Enter your GitLab OAuth application client ID.");
      const url = new URL(this.options.baseUrl || "https://gitlab.com");
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error("Enter a valid GitLab HTTP(S) server URL.");
    }
    if (this.state.loginMethod === "import-token") {
      this.config = this.provider.config;
      if (flow === "browser_token") this.state.authorizationUrl = this.provider.buildAuthUrl?.(this.config, "", this.nonce, "");
      this.hooks.change();
      if (this.options.token) await this.complete(this.options.token);
      return;
    }
    if (flow === "device_code") {
      this.config = this.provider.config;
      const challenge = crypto.createHash("sha256").update(this.verifier).digest("base64url");
      const requestDeviceCode = this.provider.requestDeviceCode;
      if (!requestDeviceCode) throw new Error("The provider returned no device authorization adapter.");
      const device: AuthDeviceCode = await this.network(() => requestDeviceCode(this.config, challenge, this.options));
      this.abort.signal.throwIfAborted();
      if (typeof device.codeVerifier === "string" && device.codeVerifier) this.verifier = device.codeVerifier;
      if (!device.device_code) throw new Error("The provider returned no device authorization code.");
      this.state.userCode = device.user_code;
      this.state.verificationUri = device.verification_uri;
      this.state.authorizationUrl = device.verification_uri_complete || device.verification_uri;
      this.state.expiresAt = Date.now() + Math.min(600_000, Math.max(1, Number(device.expires_in) || 600) * 1000);
      this.hooks.change();
      if (this.state.authorizationUrl) await this.hooks.open(this.state.authorizationUrl);
      void this.poll(device).catch(error => { if (!this.abort.signal.aborted) { this.hooks.error(safeLoginError(error)); this.cancel(); } });
      return;
    }
    const callbackPath = this.provider?.callbackPath ?? "/callback";
    const privatePath = noStateCallbacks.has(kind) && kind !== "zed" ? `${callbackPath.replace(/\/$/, "")}/${this.nonce}` : callbackPath;
    this.server = http.createServer((request, response) => {
      const url = new URL(request.url || "/", this.redirect);
      if (request.method !== "GET" || url.pathname !== new URL(this.redirect).pathname || (request.url?.length ?? 0) > 32_768) { response.writeHead(404).end("Not found"); return; }
      void this.complete(url.href, true).then(() => response.writeHead(200, { "content-type": "text/plain" }).end("Connected. Return to OpenCursor."))
        .catch(() => response.writeHead(400, { "content-type": "text/plain" }).end("Sign-in could not be completed. Return to OpenCursor."));
    });
    const port = this.provider?.fixedPort || this.provider?.config?.defaultNativeAppPort || 0;
    await new Promise<void>((resolve, reject) => {
      const complete = (error?: unknown) => {
        this.server!.off("error", complete);
        this.abort.signal.removeEventListener("abort", aborted);
        if (error) reject(error); else resolve();
      };
      const aborted = () => complete(this.abort.signal.reason);
      this.server!.once("error", complete);
      this.abort.signal.addEventListener("abort", aborted, { once: true });
      this.server!.listen({ port, host: "127.0.0.1", signal: this.abort.signal }, () => complete());
    });
    const actualPort = (this.server.address() as { port: number }).port;
    this.redirect = `http://127.0.0.1:${actualPort}${privatePath}`;
    if (kind === "xiaomi-mimo") {
      this.keyPair = xiaomi.generateKeyPair();
      this.state.authorizationUrl = xiaomi.buildAuthorizeUrl(this.keyPair!.publicKey, this.redirect, "OpenCursor");
    } else {
      const meta = { ...this.options, nativeAppPort: actualPort };
      const prepareConfig = this.provider.prepareConfig;
      this.config = prepareConfig ? await this.network(() => prepareConfig(this.provider.config, meta)) : this.provider.config;
      if (this.config.loginTraceID) this.nonce = this.config.loginTraceID;
      if (this.config.privateKeyVerifier) this.verifier = this.config.privateKeyVerifier;
      const challenge = crypto.createHash("sha256").update(this.verifier).digest("base64url");
      if (!this.provider.buildAuthUrl) throw new Error("The provider returned no browser authorization adapter.");
      this.state.authorizationUrl = this.provider.buildAuthUrl(this.config, this.redirect, this.nonce, challenge, meta);
    }
    this.abort.signal.throwIfAborted();
    this.hooks.change();
    if (this.state.authorizationUrl) await this.hooks.open(this.state.authorizationUrl);
  }

  private async finish(tokens: AuthTokens) {
    this.abort.signal.throwIfAborted();
    await this.hooks.complete(mappedAccount(this.kind, tokens));
    this.cancel(false);
  }

  async complete(text: string, fromLoopback = false): Promise<void> {
    this.abort.signal.throwIfAborted();
    if (this.busy) throw new Error("Sign-in is already being completed.");
    if (this.state.loginMethod === "device-code") throw new Error("Finish authorization in your browser; the device code is polled automatically.");
    let code = text.trim();
    if (!code) throw new Error("Enter the callback or account token.");
    let url: URL | undefined;
    try { url = new URL(code); } catch { /* manually pasted code/token */ }
    if (this.state.loginMethod === "browser" && !url && this.provider?.flowType !== "authorization_code_pkce") {
      throw new Error("Paste the full callback URL from the current sign-in attempt.");
    }
    if (url && this.state.loginMethod !== "import-token") {
      const expected = new URL(this.redirect);
      if (url.protocol !== expected.protocol || url.username || url.password || !["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== expected.port || url.pathname !== expected.pathname) throw new Error("Callback does not match this sign-in attempt.");
      if (url.searchParams.has("error")) throw new Error("Sign-in was declined by the provider.");
      if (!noStateCallbacks.has(this.kind) && url.searchParams.get("state") !== this.nonce) throw new Error("OAuth state mismatch. Use the current sign-in callback.");
      if (fromLoopback && url.pathname !== new URL(this.redirect).pathname) throw new Error("Callback does not match this sign-in attempt.");
      if (!nativeCallbacks.has(this.kind)) code = url.searchParams.get("code") || "";
    }
    this.busy = true;
    try {
      if (this.kind === "xiaomi-mimo") {
        if (!url || !this.keyPair) throw new Error("Paste the encrypted Xiaomi callback URL from this sign-in attempt.");
        const payload = xiaomi.decryptCallback(this.keyPair.privateKeyDer, url.searchParams.get("u") || "");
        const origin = new URL(payload.url || "https://api.xiaomimimo.com");
        if (origin.protocol !== "https:" || !/(^|\.)xiaomimimo\.com$/.test(origin.hostname)) throw new Error("The Xiaomi callback returned an unexpected endpoint.");
        await this.finish({ accessToken: payload.sk, providerSpecificData: { uid: payload.uid, baseUrl: origin.href } });
      } else if (this.kind === "cursor") {
        const accessToken = code.replace(/^Bearer\s+/i, "");
        if (/\s/.test(accessToken) || accessToken.length < 16) throw new Error("Enter a valid Cursor account token.");
        await this.finish(this.provider.mapTokens({ accessToken, machineId: this.options.machineId || crypto.randomUUID() }));
      } else {
        const exchangeToken = this.provider.exchangeToken;
        if (!exchangeToken) throw new Error("The provider returned no token exchange adapter.");
        const raw = await this.network(() => exchangeToken(this.config, code, this.redirect, this.verifier, this.nonce, { ...this.options, systemId: this.config?.systemId }));
        const postExchange = this.provider.postExchange;
        const extra = postExchange ? await this.network(() => postExchange(raw)) : undefined;
        await this.finish(this.provider.mapTokens(raw, extra));
      }
    } finally { this.busy = false; }
  }

  private async poll(device: AuthDeviceCode) {
    let seconds = Math.max(1, Number(device.interval) || 5);
    const pollToken = this.provider.pollToken;
    if (!pollToken) throw new Error("The provider returned no device polling adapter.");
    while (!this.abort.signal.aborted && Date.now() < this.state.expiresAt!) {
      await pause(seconds * 1000, this.abort.signal);
      const result = await this.network(() => pollToken(this.config, device.device_code, this.verifier, device));
      if (result.ok && result.data?.access_token) {
        const postExchange = this.provider.postExchange;
        const extra = postExchange ? await this.network(() => postExchange(result.data)) : undefined;
        const tokens = this.provider.mapTokens(result.data, extra);
        if (this.kind === "kiro" && !tokens.providerSpecificData?.profileArn) {
          const profileArn = await this.network(() => fetchKiroProfileArn(tokens.accessToken));
          if (profileArn) tokens.providerSpecificData = { ...tokens.providerSpecificData, profileArn };
        }
        await this.finish(tokens); return;
      }
      const error = result.data?.error;
      if (error === "slow_down") seconds = Math.min(30, seconds + 5);
      else if (error && error !== "authorization_pending") throw new Error("The device authorization was declined or expired. Add the account again.");
    }
    this.abort.signal.throwIfAborted();
    throw new Error("Device authorization expired. Add the account again.");
  }
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const stop = () => { clearTimeout(timer); signal.removeEventListener("abort", stop); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, ms);
    if (signal.aborted) stop(); else signal.addEventListener("abort", stop, { once: true });
  });
}

export function safeLoginError(error: unknown): string {
  // Upstream exchange bodies may echo credentials. Keep actionable local errors only.
  const message = error instanceof Error ? error.message : "";
  return /^(?:Enter |Paste |OAuth state mismatch|Callback does not|Sign-in |The device |Device authorization|The provider returned no)/.test(message)
    ? message.slice(0, 240) : "The provider could not complete sign-in. Check your account and try again.";
}

export async function refreshProviderAccount(account: OAuthAccount, signal: AbortSignal): Promise<OAuthAccount> {
  const data: AuthPayload = account.providerSpecificData ?? {};
  const kind = account.kind;
  const handlers: Record<string, () => Promise<AuthPayload | null>> = {
    "gemini-cli": () => refresh.refreshGoogleToken(account.refreshToken, PROVIDERS[kind].config.clientId, PROVIDERS[kind].config.clientSecret),
    xai: () => refresh.refreshXaiToken(account.refreshToken), "grok-cli": () => refresh.refreshXaiToken(account.refreshToken),
    iflow: () => refresh.refreshIflowToken(account.refreshToken), github: () => refresh.refreshGitHubToken(account.refreshToken),
    kiro: () => refresh.refreshKiroToken(account.refreshToken, data), kimi: () => refresh.refreshKimiToken(account.refreshToken, account),
    cline: () => refresh.refreshClineToken(account.refreshToken), clinepass: () => refresh.refreshClineToken(account.refreshToken),
    "codebuddy-cn": () => refresh.refreshCodebuddyToken(account.refreshToken), "codebuddy-intl": () => refresh.refreshCodebuddyIntlToken(account.refreshToken),
    trae: () => refresh.refreshTraeToken(account.refreshToken, account),
  };
  let tokens: AuthPayload | null | undefined;
  if (kind === "gitlab") {
    tokens = await withAuthSignal(signal, async () => {
      const response = await authFetch(`${String(data.baseUrl || "https://gitlab.com").replace(/\/$/, "")}/oauth/token`, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: account.refreshToken, client_id: String(data.clientId || "") }),
      });
      if (!response.ok) return undefined;
      const raw = await response.json();
      return { accessToken: raw.access_token, refreshToken: raw.refresh_token, expiresIn: raw.expires_in };
    });
  } else if (handlers[kind]) tokens = await withAuthSignal(signal, handlers[kind]);
  if (!tokens?.accessToken) throw new Error("This account could not be refreshed. Reconnect it in Providers.");
  return { ...account, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken || account.refreshToken,
    expiresAt: Date.now() + Math.max(60, Number(tokens.expiresIn) || 3600) * 1000,
    providerSpecificData: { ...data, ...(tokens.providerSpecificData ?? {}) } };
}
