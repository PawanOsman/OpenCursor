/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn } from "child_process";

vi.mock("child_process", () => ({ spawn: vi.fn() }));
vi.mock("../context/workspaceUtils", () => ({ getWorkspaceRoot: () => undefined }));
import { McpConnection, McpManager, escapeCmdArgument, windowsLaunch } from "./mcpClient";

let connection: McpConnection;
let proc: EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };
let requests: any[];
function respond(id: number, result: unknown) { proc.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n"); }
beforeEach(async () => {
  requests = [];
  proc = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  proc.stdin.on("data", (data) => {
    const request = JSON.parse(String(data));
    requests.push(request);
    if (request.method === "initialize") respond(request.id, {});
    if (request.method === "tools/list") respond(request.id, { tools: [{ name: "fixture" }] });
  });
  vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);
  connection = new McpConnection({ name: "fixture", transport: "stdio", command: "fixture", enabled: true });
  await connection.connect();
});
afterEach(() => { connection.dispose(); vi.useRealTimers(); vi.clearAllMocks(); });

describe("MCP request lifetime", () => {
  it("sends cancellation for the correct request and ignores its eventual result", async () => {
    const abort = new AbortController();
    const call = connection.callTool("fixture", {}, abort.signal);
    const id = requests.at(-1).id;
    abort.abort();
    await expect(call).rejects.toThrow("server cancellation is best effort");
    expect(requests.at(-1)).toMatchObject({ method: "notifications/cancelled", params: { requestId: id } });
    respond(id, { content: [{ type: "text", text: "late result" }] });
    const next = connection.callTool("fixture", {});
    respond(requests.at(-1).id, { content: [{ type: "text", text: "new result" }] });
    expect(await next).toBe("new result");
  });

  it("does not submit an already cancelled request", async () => {
    const abort = new AbortController(); abort.abort();
    const before = requests.length;
    await expect(connection.callTool("fixture", {}, abort.signal)).rejects.toThrow("aborted");
    expect(requests).toHaveLength(before);
  });

  it("times out resource requests, sends cancellation and cleans up timers", async () => {
    vi.useFakeTimers();
    const call = connection.readResource("fixture://long");
    const rejected = expect(call).rejects.toThrow("timeout: MCP resources/read");
    await vi.advanceTimersByTimeAsync(300_000);
    await rejected;
    expect(requests.at(-1).method).toBe("notifications/cancelled");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles pending operations on dispose even before a process close event", async () => {
    const call = connection.callTool("fixture", {});
    connection.dispose();
    await expect(call).rejects.toThrow("connection closed");
    expect(proc.kill).toHaveBeenCalled();
  });

  it("preserves an MCP tool's error status", async () => {
    const call = connection.callTool("fixture", {});
    respond(requests.at(-1).id, { isError: true, content: [{ type: "text", text: "operation failed" }] });
    expect(await call).toBe("error: operation failed");
  });

  it("handles server requests with colliding ids without settling an unrelated tool call", async () => {
    const call = connection.callTool("fixture", {});
    const id = requests.at(-1).id;
    let settled = false; void call.then(() => { settled = true; });
    proc.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, method: "ping", params: {} }) + "\n");
    await Promise.resolve();
    expect(requests.at(-1)).toEqual({ jsonrpc: "2.0", id, result: {} });
    expect(settled).toBe(false);
    respond(id, { content: [{ type: "text", text: "actual tool result" }] });
    expect(await call).toBe("actual tool result");
  });

  it("refreshes tools on notifications and declines elicitation without an input host", async () => {
    proc.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed" }) + "\n");
    await vi.waitFor(() => expect(requests.filter((request) => request.method === "tools/list")).toHaveLength(2));
    proc.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: "server-form", method: "elicitation/create", params: { message: "Choose", requestedSchema: { type: "object", properties: {} } } }) + "\n");
    await vi.waitFor(() => expect(requests.at(-1)).toMatchObject({ id: "server-form", result: { action: "decline" } }));
  });

  it("reassembles responses split across chunks, including multi-byte characters and batched lines", async () => {
    const first = connection.callTool("fixture", {});
    const firstId = requests.at(-1).id;
    const second = connection.callTool("fixture", {});
    const secondId = requests.at(-1).id;
    const big = "é→✓".repeat(50_000);
    const bytes = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: firstId, result: { content: [{ type: "text", text: big }] } }) + "\n"
      + JSON.stringify({ jsonrpc: "2.0", id: secondId, result: { content: [{ type: "text", text: "second" }] } }) + "\n");
    // Odd chunk size so multi-byte sequences straddle chunk boundaries.
    for (let offset = 0; offset < bytes.length; offset += 4093) proc.stdout.write(bytes.subarray(offset, offset + 4093));
    expect(await first).toBe(big);
    expect(await second).toBe("second");
  });

  it("does not launch queued connections after manager disposal", async () => {
    const manager = new McpManager();
    const before = vi.mocked(spawn).mock.calls.length;
    const sync = manager.sync([{ name: "queued", transport: "stdio", command: "fixture", enabled: true }]);
    manager.disposeAll();
    await sync;
    expect(vi.mocked(spawn).mock.calls).toHaveLength(before);
  });
});

describe("MCP startup sync", () => {
  it("bounds how long a run waits for servers that are still connecting", async () => {
    const manager = new McpManager();
    (manager as any).syncing = new Promise(() => {});
    const started = Date.now();
    await manager.whenSettled(30);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("returns as soon as the sync finishes", async () => {
    const manager = new McpManager();
    let finish!: () => void;
    (manager as any).syncing = new Promise<void>((resolve) => { finish = resolve; });
    const settled = manager.whenSettled(60_000);
    finish();
    await expect(settled).resolves.toBeUndefined();
  });
});

describe("Windows stdio launch", () => {
  it("caret-escapes cmd metacharacters including percent signs", async () => {
    expect(escapeCmdArgument("%PATH%", false)).toBe('^"^%PATH^%^"');
    expect(escapeCmdArgument('a"b', false)).toBe('^"a\\^"b^"');
  });

  it.runIf(process.platform === "win32")("passes literal arguments through a .cmd shim without expansion", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("fs");
    const { join } = await import("path");
    const { tmpdir } = await import("os");
    const real = await vi.importActual<typeof import("child_process")>("child_process");
    const dir = mkdtempSync(join(tmpdir(), "ocursor-mcp-shim-"));
    try {
      writeFileSync(join(dir, "fixture.cmd"), `@"${process.execPath}" -e "process.stdout.write(JSON.stringify(process.argv.slice(1)))" %*\r\n`);
      const env = { ...process.env, PATH: `${dir};${process.env.PATH}` };
      const args = ["%PATH%", "a & echo injected", 'quote"d', "trail\\"];
      const launch = windowsLaunch("fixture", args, env);
      expect(launch.file.toLowerCase()).toContain("cmd");
      const out = real.spawnSync(launch.file, launch.args, { env, windowsHide: true, windowsVerbatimArguments: launch.verbatim, encoding: "utf8" });
      expect(JSON.parse(out.stdout)).toEqual(args);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
