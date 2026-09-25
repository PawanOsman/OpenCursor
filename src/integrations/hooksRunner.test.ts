/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("../context/workspaceUtils", () => ({ getWorkspaceRoot: () => undefined }));
vi.mock("vscode", () => ({ EventEmitter: class { event = () => ({ dispose() {} }); fire() {} }, workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } }));
vi.mock("./externalHooks", () => ({ listExternalHooks: vi.fn(() => []) }));

import { listExternalHooks } from "./externalHooks";
import { runBlockingHooks } from "./hooksRunner";

// Keep the actual process and stdin protocol, with quoting valid in both shells.
function nodeCommand(code: string): string {
  const encoded = Buffer.from(code).toString("base64");
  const command = `node -e "eval(Buffer.from('${encoded}','base64').toString())"`;
  return command;
}

afterEach(() => { vi.clearAllMocks(); vi.mocked(listExternalHooks).mockReturnValue([]); vi.useRealTimers(); });

describe("native hook decisions", () => {
  it.each(["deny", "ask", "defer"])("does not execute through a Claude %s decision", async (decision) => {
    const output = JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: "Requires review" } });
    vi.mocked(listExternalHooks).mockReturnValue([{ source: "claude-user", event: "PreToolUse", matcher: "Bash", ref: "fixture", command: nodeCommand(`process.stdout.write(${JSON.stringify(output)})`) }]);
    expect(await runBlockingHooks([], "beforeShell", { command: "echo fixture" })).toBe("Requires review");
  });

  it("allows an explicit native allow without manufacturing a veto", async () => {
    const output = JSON.stringify({ hookSpecificOutput: { permissionDecision: "allow" } });
    expect(await runBlockingHooks([{ id: "fixture", enabled: true, event: "beforeShell", command: nodeCommand(`process.stdout.write(${JSON.stringify(output)})`) }], "beforeShell")).toBeUndefined();
  });

  it("runs a native Write hook before a mutation with its actual input", async () => {
    const code = 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);process.stdout.write(JSON.stringify({hookSpecificOutput:{permissionDecision:p.tool_name==="Write" && p.tool_input.file_path==="blocked.txt" ? "deny":"allow",permissionDecisionReason:"Write forbidden"}}))})';
    vi.mocked(listExternalHooks).mockReturnValue([{ source: "claude-user", event: "PreToolUse", matcher: "Write|Edit", ref: "fixture", command: nodeCommand(code) }]);
    expect(await runBlockingHooks([], "beforeEdit", { tool_input: JSON.stringify({ file_path: "blocked.txt", content: "new data" }) }, "Write")).toBe("Write forbidden");
  });

  it("sends the correct native Read name when the caller relies on the event default", async () => {
    const code = 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);process.stdout.write(JSON.stringify({hookSpecificOutput:{permissionDecision:p.tool_name==="Read" ? "deny":"allow",permissionDecisionReason:"Read forbidden"}}))})';
    vi.mocked(listExternalHooks).mockReturnValue([{ source: "claude-user", event: "PreToolUse", matcher: "Read", ref: "fixture", command: nodeCommand(code) }]);
    expect(await runBlockingHooks([], "beforeReadFile", { path: "blocked.txt" })).toBe("Read forbidden");
  });

  it("preserves the stderr reason from an exit-code denial", async () => {
    expect(await runBlockingHooks([{ id: "fixture", enabled: true, event: "beforeShell", command: nodeCommand("process.stderr.write('Denied by policy'); process.exitCode=2") }], "beforeShell")).toBe("Denied by policy");
  });

  it.runIf(process.platform === "win32")("preserves a later successful PowerShell command after an earlier native failure", async () => {
    const command = `${nodeCommand("process.exitCode=2")}; Write-Output 'diagnostic only'`;
    expect(await runBlockingHooks([{ id: "fixture", enabled: true, event: "beforeShell", command }], "beforeShell")).toBeUndefined();
  });

  it.runIf(process.platform === "win32")("confirms Windows hook termination before returning cancellation", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ocursor-hook-windows-"));
    const started = join(directory, "started");
    const controller = new AbortController();
    let pid: number | undefined;
    const result = runBlockingHooks([{ id: "fixture", enabled: true, event: "beforeShell",
      command: nodeCommand(`require('fs').writeFileSync(${JSON.stringify(started)},String(process.pid));setInterval(()=>{},1000)`) }], "beforeShell", {}, undefined, controller.signal);
    try {
      await vi.waitFor(() => expect(existsSync(started)).toBe(true), { timeout: 5000 });
      pid = Number(readFileSync(started, "utf8"));
      controller.abort();
      expect(await result).toBe("hook cancelled");
      expect(() => process.kill(pid!, 0)).toThrow();
    } finally {
      controller.abort(); await result;
      if (pid) try { process.kill(pid, "SIGKILL"); } catch { /* already stopped */ }
      rmSync(directory, { recursive: true, force: true });
    }
  }, 10_000);

  it("fails closed when a blocking hook reaches its deadline", async () => {
    vi.useFakeTimers();
    const result = runBlockingHooks([{ id: "fixture", enabled: true, event: "beforeShell", command: nodeCommand("setInterval(()=>{},1000)") }], "beforeShell");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toBe("hook timed out after 30 seconds");
  });

  it.skipIf(process.platform === "win32")("stops a blocking hook and its child process before they can perform later work", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ocursor-hook-cancel-"));
    const started = join(dir, "started");
    const later = join(dir, "later");
    const code = `const fs=require("fs");fs.writeFileSync(${JSON.stringify(started)},String(process.pid));setTimeout(()=>fs.writeFileSync(${JSON.stringify(later)},"unexpected"),400);setInterval(()=>{},1000)`;
    const abort = new AbortController();
    const result = runBlockingHooks([{ id: "fixture", enabled: true, event: "beforeShell", command: `node -e '${code}' & wait` }], "beforeShell", {}, undefined, abort.signal);
    let pid: number | undefined;
    try {
      await vi.waitFor(() => expect(existsSync(started)).toBe(true));
      pid = Number(readFileSync(started, "utf8"));
      abort.abort();
      expect(await result).toBe("hook cancelled");
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(existsSync(later)).toBe(false);
    } finally {
      abort.abort();
      if (pid) try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
