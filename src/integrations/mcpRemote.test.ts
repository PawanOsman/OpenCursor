/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { createServer, type Server as HttpServer } from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, ReadResourceRequestSchema, ElicitResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("../context/workspaceUtils", () => ({ getWorkspaceRoot: () => process.cwd() }));
import { McpConnection, McpManager, formatMcpToolResult, type McpHost } from "./mcpClient";

let http: HttpServer | undefined, protocol: Server | undefined, connection: McpConnection | undefined;
afterEach(async () => {
  connection?.dispose(); await protocol?.close();
  if (http) { http.closeAllConnections(); await new Promise<void>((resolve) => http!.close(() => resolve())); }
  http = undefined; protocol = undefined; connection = undefined;
});

async function start(transport: "http" | "sse", host?: McpHost) {
  let toolName = "inspect";
  let waiting = false, cancelled = false;
  const headers: Array<string | undefined> = [];
  protocol = new Server({ name: "fixture", version: "1" }, { capabilities: { tools: { listChanged: true }, resources: { listChanged: true } } });
  protocol.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: toolName, inputSchema: { type: "object" as const }, description: "Fixture tool" }] }));
  protocol.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (request.params.arguments?.wait) {
      waiting = true;
      await new Promise<void>((resolve) => extra.signal.addEventListener("abort", () => { cancelled = true; resolve(); }, { once: true }));
      return { content: [{ type: "text" as const, text: "Cancelled by server" }] };
    }
    if (request.params.arguments?.elicit) {
      const result = await extra.sendRequest({ method: "elicitation/create", params: { mode: "form", message: "Choose a project", requestedSchema: { type: "object", properties: { project: { type: "string" } }, required: ["project"] } } }, ElicitResultSchema);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    }
    return { content: [{ type: "text" as const, text: "Visible result" }, { type: "image" as const, mimeType: "image/png", data: "cGl4ZWw=" }], structuredContent: { count: 2 } };
  });
  protocol.setRequestHandler(ListResourcesRequestSchema, async (request) => request.params?.cursor ? { resources: [{ uri: "fixture://second", name: "Second" }] } : { resources: [{ uri: "fixture://first", name: "First" }], nextCursor: "page-two" });
  protocol.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [{ uriTemplate: "fixture://items/{id}", name: "Item" }] }));
  protocol.setRequestHandler(ReadResourceRequestSchema, async (request) => ({ contents: [{ uri: request.params.uri, mimeType: "application/octet-stream", blob: "YmluYXJ5" }] }));
  let sse: SSEServerTransport | undefined;
  const streamable = transport === "http" ? new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() }) : undefined;
  if (streamable) await protocol.connect(streamable);
  http = createServer((request, response) => {
    headers.push(request.headers["x-fixture-key"] as string | undefined);
    const route = async () => {
      if (streamable) await streamable.handleRequest(request, response);
      else if (request.method === "GET" && request.url === "/sse") { sse = new SSEServerTransport("/messages", response); await protocol!.connect(sse); }
      else if (sse && request.method === "POST" && request.url?.startsWith("/messages")) await sse.handlePostMessage(request, response);
      else { response.writeHead(404); response.end(); }
    };
    void route().catch((error) => { if (!response.headersSent) response.writeHead(500); response.end(String(error)); });
  });
  await new Promise<void>((resolve) => http!.listen(0, "127.0.0.1", resolve));
  const address = http.address(); if (!address || typeof address === "string") throw new Error("No fixture port");
  connection = new McpConnection({ name: "remote", transport, url: `http://127.0.0.1:${address.port}/${transport === "sse" ? "sse" : "mcp"}`, enabled: true, headers: { "X-Fixture-Key": "local-test" } }, host);
  await connection.connect(2500);
  return { connection, headers, get waiting() { return waiting; }, get cancelled() { return cancelled; }, changeTools: async () => { toolName = "updated"; await protocol!.sendToolListChanged(); } };
}

it.each(["http", "sse"] as const)("negotiates %s and preserves typed results/resources/pagination and configured headers", async (transport) => {
  const fixture = await start(transport);
  expect(fixture.connection.connected).toBe(true);
  expect(fixture.connection.tools[0].name).toBe("inspect");
  const result = await fixture.connection.callToolDetailed("inspect", {});
  expect(result.content[1]).toMatchObject({ type: "image", data: "cGl4ZWw=" });
  expect(result.structuredContent).toEqual({ count: 2 });
  expect(formatMcpToolResult(result)).toContain("Visible result");
  expect(formatMcpToolResult(result)).not.toContain("cGl4ZWw=");
  expect(await fixture.connection.listResources()).toHaveLength(2);
  expect((await fixture.connection.listResourceTemplates())[0].uriTemplate).toBe("fixture://items/{id}");
  expect((await fixture.connection.readResourceContents("fixture://first")).contents[0]).toMatchObject({ blob: "YmluYXJ5" });
  expect(fixture.headers.length).toBeGreaterThan(4);
  expect(fixture.headers.every((header) => header === "local-test")).toBe(true);
  await fixture.changeTools();
  await vi.waitFor(() => expect(fixture.connection.tools.map((tool) => tool.name)).toEqual(["updated"]));
});

it("passes server elicitation to an explicit host callback and returns the user's answer", async () => {
  const elicit = vi.fn(async () => ({ action: "accept" as const, content: { project: "fixture-project" } }));
  const fixture = await start("http", { secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} }, openExternal: async () => true, elicit });
  const result = await fixture.connection.callTool("inspect", { elicit: true });
  expect(elicit).toHaveBeenCalledWith("remote", expect.objectContaining({ message: "Choose a project" }), expect.any(AbortSignal));
  expect(result).toContain('"project":"fixture-project"');
});

it("cancels remote requests with an honest best-effort outcome", async () => {
  const fixture = await start("http");
  const controller = new AbortController();
  const call = fixture.connection.callTool("inspect", { wait: true }, controller.signal);
  await vi.waitFor(() => expect(fixture.waiting).toBe(true));
  const rejected = expect(call).rejects.toThrow("server cancellation is best effort");
  controller.abort(); await rejected;
  await vi.waitFor(() => expect(fixture.cancelled).toBe(true));
});

it("reports authentication required without claiming a remote connection succeeded", async () => {
  http = createServer((_request, response) => { response.writeHead(401); response.end("Authentication required"); });
  await new Promise<void>((resolve) => http!.listen(0, "127.0.0.1", resolve));
  const address = http.address(); if (!address || typeof address === "string") throw new Error("No port");
  const manager = new McpManager();
  await manager.sync([{ name: "protected", transport: "http", enabled: true, url: `http://127.0.0.1:${address.port}/mcp` }]);
  expect(manager.status()[0]).toMatchObject({ connected: false, authState: "required" });
  expect(manager.listTools()).toEqual([]);
  manager.disposeAll();
});

it("completes an explicit OAuth PKCE sign in against a loopback server and logs out", async () => {
  const secrets = new Map<string, string>();
  let base = "", challenge = "", opened = 0, exchanged = 0;
  protocol = new Server({ name: "oauth-fixture", version: "1" }, { capabilities: { tools: {} } });
  protocol.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "authorized", inputSchema: { type: "object" as const } }] }));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
  await protocol.connect(transport);
  http = createServer((request, response) => {
    const route = async () => {
      const url = new URL(request.url || "/", base);
      const json = (body: unknown, status = 200) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(body)); };
      if (url.pathname === "/.well-known/oauth-protected-resource") return json({ resource: `${base}/mcp`, authorization_servers: [base] });
      if (url.pathname === "/.well-known/oauth-authorization-server") return json({ issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, registration_endpoint: `${base}/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"] });
      if (url.pathname === "/register") {
        let body = ""; for await (const chunk of request) body += chunk;
        return json({ ...JSON.parse(body), client_id: "fixture-client" }, 201);
      }
      if (url.pathname === "/authorize") {
        challenge = url.searchParams.get("code_challenge") || "";
        const callback = new URL(url.searchParams.get("redirect_uri")!);
        callback.searchParams.set("state", url.searchParams.get("state")!); callback.searchParams.set("code", "fixture-code");
        response.writeHead(302, { Location: callback.toString() }); response.end(); return;
      }
      if (url.pathname === "/token") {
        let body = ""; for await (const chunk of request) body += chunk;
        const params = new URLSearchParams(body);
        if (params.get("code") !== "fixture-code" || createHash("sha256").update(params.get("code_verifier") || "").digest("base64url") !== challenge) return json({ error: "invalid_grant" }, 400);
        exchanged++; return json({ access_token: "fixture-access", token_type: "Bearer", refresh_token: "fixture-refresh-token" });
      }
      if (url.pathname === "/mcp") {
        if (request.headers.authorization !== "Bearer fixture-access") {
          response.writeHead(401, { "WWW-Authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"` }); response.end(); return;
        }
        await transport.handleRequest(request, response); return;
      }
      response.writeHead(404); response.end();
    };
    void route().catch((error) => { if (!response.headersSent) response.writeHead(500); response.end(String(error)); });
  });
  await new Promise<void>((resolve) => http!.listen(0, "127.0.0.1", resolve));
  const address = http.address(); if (!address || typeof address === "string") throw new Error("No port");
  base = `http://127.0.0.1:${address.port}`;
  const manager = new McpManager();
  manager.configureHost({ secrets: { get: async (key) => secrets.get(key), store: async (key, value) => { secrets.set(key, value); }, delete: async (key) => { secrets.delete(key); } }, openExternal: async (url) => { opened++; const response = await fetch(url); return response.ok; } });
  try {
    await manager.sync([{ name: "oauth", transport: "http", enabled: true, url: `${base}/mcp` }]);
    expect(opened).toBe(0); expect(manager.status()[0].authState).toBe("required");
    await manager.login("oauth");
    expect(opened).toBe(1); expect(exchanged).toBe(1);
    expect(manager.status()[0]).toMatchObject({ connected: true, authState: "authenticated", tools: ["authorized"] });
    expect([...secrets.values()].join("")).toContain("fixture-refresh-token");
    expect([...secrets.values()].join("")).not.toContain("code_verifier");
    await manager.logout("oauth"); expect(secrets.size).toBe(0);
    expect(manager.status()[0]).toMatchObject({ connected: false, authState: "required" });
  } finally { manager.disposeAll(); }
}, 10_000);
