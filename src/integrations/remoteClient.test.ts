/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { createServer, type Server, type RequestListener } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { RemoteJobClient, workerEndpoint } from "./remoteClient";

const servers: Server[] = [];
async function serve(handler: RequestListener) {
  const server = createServer(handler); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }))); });

describe("remote worker client", () => {
  it("requires encrypted remote origins and rejects URL credentials and redirects", async () => {
    expect(workerEndpoint("http://127.0.0.1:7337/")).toBe("http://127.0.0.1:7337");
    expect(workerEndpoint("https://worker.example.test")).toBe("https://worker.example.test");
    for (const url of ["http://worker.example.test", "https://secret@worker.example.test", "https://worker.example.test/path", "file:///worker", "http://127.0.0.1.example.test"]) expect(() => workerEndpoint(url)).toThrow();
    let forwarded = false;
    const target = await serve((_req, res) => { forwarded = true; res.end("{}"); });
    const origin = await serve((_req, res) => { res.writeHead(302, { Location: target }); res.end(); });
    await expect(new RemoteJobClient(origin, "a".repeat(32)).health()).rejects.toThrow();
    expect(forwarded).toBe(false);
  });
  it("authenticates requests, submits pinned revisions and preserves binary patch text", async () => {
    const id = "12345678-1234-1234-1234-123456789abc";
    const patch = "diff --git a/image.png b/image.png\nGIT binary patch\nliteral 4\nLc${Nk!_%dD0#u9W\n";
    let request: unknown;
    const origin = await serve(async (req, res) => {
      expect(req.headers.authorization).toBe(`Bearer ${"a".repeat(32)}`);
      if (req.method === "POST") { let body = ""; for await (const chunk of req) body += chunk; request = JSON.parse(body); }
      res.end(req.url?.endsWith("/patch") ? patch : req.url === "/v1/health" ? JSON.stringify({ version: 1, status: "ready" }) : JSON.stringify({ id, status: "queued" }));
    });
    const client = new RemoteJobClient(origin, "a".repeat(32));
    await client.health();
    const task = { repository: "project", revision: "c".repeat(40), model: "local", prompt: "Fix the regression" };
    expect((await client.submit(task)).id).toBe(id);
    expect(request).toEqual(task);
    expect(await client.patch(id)).toBe(patch);
    await expect(client.patch("../../credentials")).rejects.toThrow("Invalid remote job ID");
  });
  it("bounds response bodies and reports structured worker failures", async () => {
    const oversized = await serve((_req, res) => res.end("x".repeat(2 * 1024 * 1024 + 1)));
    await expect(new RemoteJobClient(oversized, "a".repeat(32)).list()).rejects.toThrow("allowed size");
    const denied = await serve((_req, res) => { res.writeHead(401); res.end(JSON.stringify({ error: "Authentication required" })); });
    await expect(new RemoteJobClient(denied, "a".repeat(32)).health()).rejects.toThrow("401): Authentication required");
  });
});
