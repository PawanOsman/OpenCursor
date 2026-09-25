/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { createServer, type IncomingMessage } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import type { JobManager, JobRequest } from "./jobs";

async function body(request: IncomingMessage): Promise<JobRequest> {
  const parts: Buffer[] = []; let size = 0;
  for await (const value of request) { const chunk = Buffer.from(value); size += chunk.length; if (size > 128_000) throw new Error("Request exceeds 128KB"); parts.push(chunk); }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
export function createWorkerServer(manager: JobManager, token: string) {
  if (token.length < 32) throw new Error("Worker bearer token must contain at least 32 characters");
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store"); response.setHeader("X-Content-Type-Options", "nosniff");
    const json = (status: number, value: unknown) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); };
    if (request.headers.origin || !timingSafeEqual(digest(request.headers.authorization ?? ""), digest(`Bearer ${token}`))) { json(401, { error: "Authentication required" }); return; }
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      if (url.pathname === "/v1/health" && request.method === "GET") { json(200, { version: 1, status: "ready" }); return; }
      if (parts[0] !== "v1" || parts[1] !== "jobs") { json(404, { error: "Unknown endpoint" }); return; }
      if (parts.length === 2 && request.method === "GET") { json(200, manager.list()); return; }
      if (parts.length === 2 && request.method === "POST") { json(202, await manager.submit(await body(request))); return; }
      const id = parts[2];
      if (!/^[0-9a-f-]{36}$/.test(id ?? "")) { json(404, { error: "Unknown job" }); return; }
      if (parts.length === 3 && request.method === "GET") { json(200, manager.get(id)); return; }
      if (parts.length === 4 && parts[3] === "cancel" && request.method === "POST") { json(200, await manager.cancel(id)); return; }
      if (parts.length === 4 && parts[3] === "events" && request.method === "GET") {
        const after = Number(url.searchParams.get("after") ?? "0"); if (!Number.isSafeInteger(after) || after < 0) throw new Error("Invalid event cursor");
        json(200, await manager.events(id, after)); return;
      }
      if (parts.length === 4 && parts[3] === "patch" && request.method === "GET") {
        const patch = await manager.patch(id); response.writeHead(200, { "Content-Type": "text/x-diff; charset=utf-8", "Content-Disposition": `attachment; filename="${id}.patch"` }); response.end(patch); return;
      }
      json(404, { error: "Unknown endpoint" });
    } catch (error) { json(400, { error: error instanceof Error ? error.message : String(error) }); }
  });
}
