/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { getWorkspaceRoot } from "../context/workspaceUtils";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { CallToolResultSchema, ReadResourceResultSchema, ToolListChangedNotificationSchema, ResourceListChangedNotificationSchema, ResourceUpdatedNotificationSchema, ElicitRequestSchema, type CallToolResult, type ReadResourceResult, type ElicitRequest, type ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import { McpOAuthProvider, McpAuthRequiredError, validateMcpRemoteUrl, type McpSecretStorage } from "./mcpOAuth";

export type McpToolResult = CallToolResult;
export type McpAuthState = "none" | "required" | "authorizing" | "authenticated";
export interface McpHost {
  secrets: McpSecretStorage;
  openExternal(url: string): PromiseLike<unknown>;
  elicit?(server: string, request: ElicitRequest["params"], signal: AbortSignal): Promise<ElicitResult>;
  notification?(server: string, method: string, params: unknown): void;
}
export interface McpResourceTemplate { uriTemplate: string; name: string; description?: string; mimeType?: string }

/** Text compatibility keeps binary payloads out of token-sized JSON strings. */
export function formatMcpToolResult(result: McpToolResult): string {
  const blocks = result.content.map((content) => {
    if (content.type === "text") return content.text;
    if (content.type === "image" || content.type === "audio") return `[${content.type} ${content.mimeType}; ${Math.floor(content.data.length * 3 / 4)} bytes]`;
    if (content.type === "resource") return "text" in content.resource ? content.resource.text : `[binary resource ${content.resource.uri}; ${content.resource.mimeType ?? "unknown MIME type"}]`;
    return JSON.stringify(content);
  });
  if (result.structuredContent !== undefined) blocks.push(JSON.stringify(result.structuredContent));
  return `${result.isError ? "error: " : ""}${blocks.join("\n")}`;
}

export interface McpServerConfig {
  name: string;
  /** "stdio" launches a command; "sse"/"http" connects to a URL. */
  transport: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  oauth?: { clientId?: string; scopes?: string[] };
  enabled: boolean;
}

export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: object;
  outputSchema?: object;
  annotations?: Record<string, unknown>;
}

interface JsonRpcResponse {
  id?: number | string;
  result?: any;
  error?: { code: number; message: string };
  method?: string;
  params?: any;
}

/** MCP stdio bridge and SDK-backed Streamable HTTP / legacy SSE connections. */
export class McpConnection {
  private client?: Client;
  private remote?: StreamableHTTPClientTransport | SSEClientTransport;
  private oauth?: McpOAuthProvider;
  private disposed = false;
  private refresh?: Promise<void>;
  private serverRequests = new Map<number | string, AbortController>();
  private proc?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private buf = "";
  public tools: McpToolDef[] = [];
  public connected = false;
  public lastError?: string;
  public authState: McpAuthState = "none";

  constructor(public readonly config: McpServerConfig, private readonly host?: McpHost) {}

  async connect(timeoutMs = 15000): Promise<void> {
    this.disposed = false;
    if (this.config.transport !== "stdio") {
      await this.connectRemote(timeoutMs);
      return;
    }
    if (!this.config.command) {
      throw new Error("stdio MCP server requires a command");
    }

    // On Windows, npm-shipped launchers (npx/npm/pnpm/yarn) are .cmd shims that
    // are not directly spawnable, so run through a shell. The shell also resolves
    // commands via PATHEXT instead of failing with ENOENT.
    // Node deprecated args+shell:true (DEP0190), so pre-join into one quoted string.
    const useShell = process.platform === "win32";
    const args = this.config.args ?? [];
    const cmd = useShell
      ? [this.config.command, ...args].map((a) => (/[\s"^&|<>]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a)).join(" ")
      : this.config.command;
    const proc = spawn(cmd, useShell ? [] : args, {
      cwd: getWorkspaceRoot(),
      env: { ...process.env, ...(this.config.env ?? {}) },
      shell: useShell,
    });
    this.proc = proc;
    proc.stdin.on("error", (error) => {
      this.lastError = error.message;
      for (const { reject } of this.pending.values()) reject(error);
    });

    // Keep the last stderr lines so a startup failure surfaces a real reason
    // instead of just "MCP server closed".
    let stderrTail = "";
    proc.stdout.on("data", (d) => this._onData(d.toString()));
    proc.stderr.on("data", (d) => {
      stderrTail = (stderrTail + d.toString()).slice(-2000);
    });
    proc.on("error", (e) => {
      this.lastError = e.message;
      this.connected = false;
    });
    proc.on("close", (code) => {
      this.connected = false;
      if (code) this.lastError = `${this.config.command} exited (code ${code})${stderrTail ? `: ${stderrTail.trim().split("\n").pop()}` : ""}`;
      const reason = this.lastError || "MCP server closed";
      for (const { reject } of this.pending.values()) {
        reject(new Error(reason));
      }
      this.pending.clear();
    });

    await this._request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: this.host?.elicit ? { elicitation: { form: {}, url: {} } } : {},
        clientInfo: { name: "ocursor", version: "1.0.0" },
      }, undefined, timeoutMs);
    this._notify("notifications/initialized", {});

    await this.refreshTools(timeoutMs);
    this.connected = true;
  }

  private authProvider(): McpOAuthProvider | undefined {
    if (!this.oauth && this.host && this.config.url) this.oauth = new McpOAuthProvider(this.config.url, this.config.name, this.host.secrets, (url) => this.host!.openExternal(url), this.config.oauth);
    return this.oauth;
  }

  private async connectRemote(timeoutMs: number): Promise<void> {
    if (!this.config.url) throw new Error("Remote MCP requires a server URL.");
    const url = validateMcpRemoteUrl(this.config.url);
    const authProvider = this.authProvider();
    const configuredHeaders = this.config.headers ?? {};
    const scopedFetch: typeof fetch = (input, init) => {
      const target = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const headers = new Headers(init?.headers);
      if (target.origin === url.origin) for (const [name, value] of Object.entries(configuredHeaders)) if (!headers.has(name)) headers.set(name, value);
      // Do not forward arbitrary configured secret headers through HTTP redirects.
      return fetch(input, { ...init, headers, redirect: "error" });
    };
    const client = new Client({ name: "opencursor", version: "0.1.5" }, { capabilities: this.host?.elicit ? { elicitation: { form: {}, url: {} } } : {} });
    client.onerror = (error) => { this.lastError = error.message; };
    client.onclose = () => { if (this.client === client) this.connected = false; };
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => { await this.refreshTools().catch((error) => { this.lastError = String(error); }); this.host?.notification?.(this.config.name, "notifications/tools/list_changed", {}); });
    client.setNotificationHandler(ResourceListChangedNotificationSchema, (event) => { this.host?.notification?.(this.config.name, event.method, event.params); });
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, (event) => { this.host?.notification?.(this.config.name, event.method, event.params); });
    if (this.host?.elicit) client.setRequestHandler(ElicitRequestSchema, (request, extra) => this.host!.elicit!(this.config.name, request.params, extra.signal));
    const transport = this.config.transport === "sse" ? new SSEClientTransport(url, { authProvider, fetch: scopedFetch }) : new StreamableHTTPClientTransport(url, { authProvider, fetch: scopedFetch, reconnectionOptions: { initialReconnectionDelay: 500, maxReconnectionDelay: 5000, reconnectionDelayGrowFactor: 2, maxRetries: 3 } });
    this.client = client; this.remote = transport;
    try {
      await client.connect(transport, { timeout: timeoutMs });
      if (this.disposed) { await client.close(); throw new Error("MCP connection was disposed during initialization."); }
      if (client.getServerCapabilities()?.tools) await this.refreshTools(timeoutMs);
      else this.tools = [];
      this.connected = true; this.lastError = undefined;
      this.authState = await authProvider?.tokens() ? "authenticated" : "none";
    } catch (error) {
      this.connected = false;
      if (error instanceof UnauthorizedError || error instanceof McpAuthRequiredError || (error as { code?: number })?.code === 401) this.authState = this.authState === "authorizing" ? "authorizing" : "required";
      throw error;
    }
  }

  private async refreshTools(timeoutMs = 15000): Promise<void> {
    if (this.refresh) return this.refresh;
    this.refresh = (async () => {
      const tools: McpToolDef[] = [], seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const result = await this._request("tools/list", cursor ? { cursor } : {}, undefined, timeoutMs);
        for (const tool of result?.tools ?? []) if (typeof tool.name === "string" && !tools.some((existing) => existing.name === tool.name)) tools.push({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, outputSchema: tool.outputSchema, annotations: tool.annotations });
        cursor = typeof result?.nextCursor === "string" ? result.nextCursor : undefined;
        if (cursor && seen.has(cursor)) throw new Error("MCP tools pagination repeated a cursor.");
        if (cursor) seen.add(cursor);
        if (seen.size > 100 || tools.length > 10000) throw new Error("MCP tool catalog exceeds the supported limit.");
      } while (cursor);
      this.tools = tools;
    })();
    try { await this.refresh; } finally { this.refresh = undefined; }
  }

  async login(): Promise<void> {
    if (this.config.transport === "stdio") throw new Error("OAuth applies to remote MCP servers.");
    const provider = this.authProvider();
    if (!provider) throw new Error("MCP authentication host has not been initialized.");
    this.disposed = false; this.authState = "authorizing";
    try {
      await provider.beginAuthorization();
      await this.client?.close();
      try { await this.connectRemote(15000); }
      catch (error) {
        if (!provider.authorizationUrl || !this.remote) throw error;
        const code = await provider.waitForCode();
        await this.remote.finishAuth(code);
        await this.client?.close();
        await this.connectRemote(15000);
      }
      this.authState = await provider.tokens() ? "authenticated" : "none"; this.lastError = undefined;
    } catch (error) { this.authState = "required"; this.lastError = error instanceof Error ? error.message : String(error); throw error; }
    finally { provider.endAuthorization(); }
  }

  async logout(): Promise<void> { await this.authProvider()?.invalidateCredentials("all"); this.dispose(); this.authState = "required"; }

  async callTool(name: string, args: any, signal?: AbortSignal): Promise<string> {
    return formatMcpToolResult(await this.callToolDetailed(name, args, signal));
  }

  async callToolDetailed(name: string, args: any, signal?: AbortSignal): Promise<McpToolResult> {
    const res = await this._request("tools/call", { name, arguments: args ?? {} }, signal);
    return CallToolResultSchema.parse(res);
  }

  /** List resources exposed by this server (resources/list). */
  async listResources(signal?: AbortSignal): Promise<{ uri: string; name?: string; description?: string; mimeType?: string }[]> {
    const resources = await this.paginate("resources/list", "resources", signal);
    return resources.map((r: any) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    }));
  }

  async listResourceTemplates(signal?: AbortSignal): Promise<McpResourceTemplate[]> { return this.paginate("resources/templates/list", "resourceTemplates", signal); }

  private async paginate(method: string, key: string, signal?: AbortSignal): Promise<any[]> {
    const values: any[] = [], seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const result = await this._request(method, cursor ? { cursor } : {}, signal);
      if (Array.isArray(result?.[key])) values.push(...result[key]);
      cursor = typeof result?.nextCursor === "string" ? result.nextCursor : undefined;
      if (cursor && seen.has(cursor)) throw new Error(`MCP ${method} repeated a pagination cursor.`);
      if (cursor) seen.add(cursor);
      if (seen.size > 100 || values.length > 10000) throw new Error(`MCP ${method} exceeds the supported limit.`);
    } while (cursor);
    return values;
  }

  /** Read a resource (resources/read); returns its text contents joined. */
  async readResource(uri: string, signal?: AbortSignal): Promise<string> {
    const res = await this.readResourceContents(uri, signal);
    const contents = res?.contents;
    if (Array.isArray(contents)) {
      return contents
        .map((c: any) => (typeof c.text === "string" ? c.text : c.blob !== undefined ? `[binary ${c.mimeType ?? ""}]` : JSON.stringify(c)))
        .join("\n");
    }
    return JSON.stringify(res ?? {});
  }

  async readResourceContents(uri: string, signal?: AbortSignal): Promise<ReadResourceResult> { return ReadResourceResultSchema.parse(await this._request("resources/read", { uri }, signal)); }

  dispose() {
    this.disposed = true;
    this.oauth?.endAuthorization();
    for (const controller of this.serverRequests.values()) controller.abort();
    this.serverRequests.clear();
    void this.client?.close().catch(() => {});
    for (const { reject } of this.pending.values()) reject(new Error("MCP connection closed"));
    this.pending.clear();
    this.proc?.kill();
    this.proc = undefined;
    this.connected = false;
  }

  private _onData(chunk: string) {
    this.buf += chunk;
    if (this.buf.length > 16 * 1024 * 1024) { this.lastError = "MCP message exceeds 16 MiB."; this.dispose(); return; }
    const lines = this.buf.split("\n");
    this.buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t) {
        continue;
      }
      let msg: JsonRpcResponse;
      try {
        msg = JSON.parse(t);
      } catch {
        continue;
      }
      if (msg.method) { void this.handleServerMessage(msg); continue; }
      if (typeof msg.id === "number" && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) {
          p.reject(new Error(msg.error.message));
        } else {
          p.resolve(msg.result);
        }
      }
    }
  }

  private async handleServerMessage(message: JsonRpcResponse): Promise<void> {
    try {
      if (message.method === "notifications/cancelled") { this.serverRequests.get(message.params?.requestId)?.abort(); return; }
      if (message.method === "notifications/tools/list_changed") { await this.refreshTools(); this.host?.notification?.(this.config.name, message.method, message.params); return; }
      if (message.id === undefined) { this.host?.notification?.(this.config.name, message.method!, message.params); return; }
      let result: unknown;
      if (message.method === "ping") result = {};
      else if (message.method === "elicitation/create") {
        const request = ElicitRequestSchema.parse(message);
        const controller = new AbortController(); this.serverRequests.set(message.id, controller);
        try { result = await this.host?.elicit?.(this.config.name, request.params, controller.signal) ?? { action: "decline" }; }
        finally { this.serverRequests.delete(message.id); }
      } else { this.writeServerResponse(message.id, undefined, { code: -32601, message: "Unsupported client request" }); return; }
      this.writeServerResponse(message.id, result);
    } catch (error) {
      if (message.id !== undefined) this.writeServerResponse(message.id, undefined, { code: -32603, message: error instanceof Error ? error.message : String(error) });
      else this.lastError = error instanceof Error ? error.message : String(error);
    }
  }
  private writeServerResponse(id: number | string, result?: unknown, error?: { code: number; message: string }): void {
    this.proc?.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, ...(error ? { error } : { result }) }) + "\n", () => {});
  }

  private _request(method: string, params: any, signal?: AbortSignal, timeoutMs = 300_000): Promise<any> {
    if (signal?.aborted) return Promise.reject(new Error("aborted: MCP request"));
    if (this.config.transport !== "stdio") return this.remoteRequest(method, params, signal, timeoutMs);
    if (!this.proc || this.proc.stdin.destroyed) return Promise.reject(new Error("MCP connection is closed"));
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, value?: any) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.pending.delete(id);
        if (error) reject(error); else resolve(value);
      };
      const cancel = (reason: string) => {
        if (settled) return;
        // MCP cancellation is advisory: the server may already have committed
        // an action. Never imply that settling the local promise rolls it back.
        if (method !== "initialize") this._notify("notifications/cancelled", { requestId: id, reason });
        finish(new Error(`${reason}; server cancellation is best effort`));
      };
      const onAbort = () => cancel("aborted: MCP request");
      const timer = setTimeout(() => cancel(`timeout: MCP ${method}`), timeoutMs);
      this.pending.set(id, { resolve: (value) => finish(undefined, value), reject: (error) => finish(error) });
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        this.proc!.stdin.write(payload, (error) => { if (error) finish(error); });
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private async remoteRequest(method: string, params: any, signal?: AbortSignal, timeout = 300_000): Promise<any> {
    const client = this.client;
    if (!client || this.disposed) throw new Error("MCP connection is closed");
    const options = { signal, timeout, maxTotalTimeout: timeout, onprogress: (progress: unknown) => this.host?.notification?.(this.config.name, "notifications/progress", progress) };
    try {
      switch (method) {
        case "tools/list": return await client.listTools(params, options);
        case "tools/call": return await client.callTool(params, CallToolResultSchema, options);
        case "resources/list": return await client.listResources(params, options);
        case "resources/templates/list": return await client.listResourceTemplates(params, options);
        case "resources/read": return await client.readResource(params, options);
        default: throw new Error(`Unsupported remote MCP request ${method}`);
      }
    } catch (error) {
      if (error instanceof UnauthorizedError || error instanceof McpAuthRequiredError) { this.authState = "required"; this.connected = false; }
      if (signal?.aborted) throw new Error("aborted: MCP request; server cancellation is best effort");
      throw error;
    }
  }

  private _notify(method: string, params: any) {
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n";
    try {
      if (!this.proc?.stdin.destroyed) this.proc?.stdin.write(payload, () => { /* close handler settles requests */ });
    } catch { /* cancellation notifications are best effort */ }
  }
}

/** Manages all configured MCP connections. */
export class McpManager {
  private host?: McpHost;
  private connections = new Map<string, McpConnection>();
  private syncing: Promise<void> = Promise.resolve();
  private generation = 0;

  configureHost(host: McpHost): void { this.host = host; }

  sync(configs: McpServerConfig[]): Promise<void> {
    const snapshot = structuredClone(configs);
    const generation = this.generation;
    const next = this.syncing.catch(() => {}).then(() => this.applyConfigs(snapshot, generation));
    this.syncing = next;
    return next;
  }

  private async applyConfigs(configs: McpServerConfig[], generation: number): Promise<void> {
    if (generation !== this.generation) return;
    // Dispose connections no longer present or disabled.
    for (const [name, conn] of this.connections) {
      const cfg = configs.find((c) => c.name === name);
      if (!cfg || !cfg.enabled || !conn.connected || JSON.stringify(cfg) !== JSON.stringify(conn.config)) {
        conn.dispose();
        this.connections.delete(name);
      }
    }
    // Connect new enabled servers.
    for (const cfg of configs) {
      if (generation !== this.generation) return;
      if (!cfg.enabled || this.connections.has(cfg.name)) {
        continue;
      }
      const conn = new McpConnection(cfg, this.host);
      this.connections.set(cfg.name, conn);
      try {
        await conn.connect();
      } catch (e) {
        conn.lastError = e instanceof Error ? e.message : String(e);
        conn.dispose();
      }
    }
  }

  /** Returns all tools across connected servers, namespaced as `mcp__<server>__<tool>`. */
  listTools(): { qualifiedName: string; server: string; tool: McpToolDef }[] {
    const out: { qualifiedName: string; server: string; tool: McpToolDef }[] = [];
    for (const [name, conn] of this.connections) {
      if (!conn.connected) {
        continue;
      }
      for (const tool of conn.tools) {
        out.push({ qualifiedName: `mcp__${name}__${tool.name}`, server: name, tool });
      }
    }
    return out;
  }

  async callTool(qualifiedName: string, args: any, signal?: AbortSignal): Promise<string> {
    return formatMcpToolResult(await this.callToolDetailed(qualifiedName, args, signal));
  }

  async callToolDetailed(qualifiedName: string, args: any, signal?: AbortSignal): Promise<McpToolResult> {
    const failure = (text: string): McpToolResult => ({ isError: true, content: [{ type: "text", text }] });
    const m = qualifiedName.match(/^mcp__(.+?)__(.+)$/);
    if (!m) {
      return failure(`invalid MCP tool name ${qualifiedName}`);
    }
    const conn = this.connections.get(m[1]);
    if (!conn || !conn.connected) {
      return failure(`MCP server ${m[1]} not connected`);
    }
    try {
      return await conn.callToolDetailed(m[2], args, signal);
    } catch (e) {
      return failure(e instanceof Error ? e.message : String(e));
    }
  }

  async login(name: string): Promise<void> {
    const connection = this.connections.get(name);
    if (!connection) throw new Error(`MCP server ${name} is not configured or enabled.`);
    await connection.login();
  }

  async logout(name: string): Promise<void> {
    const connection = this.connections.get(name);
    if (!connection) throw new Error(`MCP server ${name} is not configured or enabled.`);
    await connection.logout();
  }

  /** List resources across all connected servers, namespaced by server. */
  async listResources(signal?: AbortSignal): Promise<{ server: string; uri: string; name?: string; description?: string; mimeType?: string }[]> {
    const out: { server: string; uri: string; name?: string; description?: string; mimeType?: string }[] = [];
    for (const [name, conn] of this.connections) {
      if (signal?.aborted) throw new Error("aborted: MCP resource listing");
      if (!conn.connected) continue;
      try {
        for (const r of await conn.listResources(signal)) out.push({ server: name, ...r });
      } catch (error) {
        if (signal?.aborted) throw error;
        /* server may not support resources */
      }
    }
    return out;
  }

  async readResource(server: string, uri: string, signal?: AbortSignal): Promise<string> {
    const conn = this.connections.get(server);
    if (!conn || !conn.connected) return `error: MCP server ${server} not connected`;
    try {
      return await conn.readResource(uri, signal);
    } catch (e) {
      return `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  async readResourceContents(server: string, uri: string, signal?: AbortSignal): Promise<ReadResourceResult> {
    const connection = this.connections.get(server);
    if (!connection?.connected) throw new Error(`MCP server ${server} not connected`);
    return connection.readResourceContents(uri, signal);
  }

  async listResourceTemplates(signal?: AbortSignal): Promise<Array<McpResourceTemplate & { server: string }>> {
    const templates: Array<McpResourceTemplate & { server: string }> = [];
    for (const [name, connection] of this.connections) {
      signal?.throwIfAborted();
      if (!connection.connected) continue;
      try { for (const template of await connection.listResourceTemplates(signal)) templates.push({ server: name, ...template }); }
      catch (error) { if (signal?.aborted) throw error; /* Templates are optional. */ }
    }
    return templates;
  }

  status(): { name: string; connected: boolean; toolCount: number; tools: string[]; error?: string; authState: McpAuthState }[] {
    const out: { name: string; connected: boolean; toolCount: number; tools: string[]; error?: string; authState: McpAuthState }[] = [];
    for (const [name, conn] of this.connections) {
      out.push({ name, connected: conn.connected, toolCount: conn.tools.length, tools: conn.tools.map((t) => t.name), error: conn.lastError, authState: conn.authState });
    }
    return out;
  }

  disposeAll() {
    this.generation++;
    for (const conn of this.connections.values()) {
      conn.dispose();
    }
    this.connections.clear();
  }
}

export const mcpManager = new McpManager();
