/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ root: "" }));
vi.mock("vscode", () => ({ workspace: { get workspaceFolders() { return [{ uri: { fsPath: fixture.root } }]; }, getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } }));
vi.mock("../../runtimeDeps", () => ({ importRuntimeDep: async () => import("@lydell/node-pty") }));
import { runTerminalTool, awaitShellTool, writeStdinTool } from "./shell";
import { disposeShellSession, getOwnedShell, pruneShellJobs, SHELL_OUTPUT_LIMITS } from "./shared";
import { getInteractiveTerminal } from "../ptyRuntime";
import { withExecutionProfile } from "../execution";
import type { ToolContext } from "./types";

let root: string;
let context: ToolContext;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "ocursor-pty-")); fixture.root = root;
  context = { todos: [], shellSessionKey: `pty-${Date.now()}`, shellOwnerKey: `owner-${Date.now()}` };
  await fs.writeFile(path.join(root, "interactive.cjs"), `
const readline = require('readline');
console.log('READY_TTY=' + process.stdin.isTTY);
const input = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
input.on('line', line => { if (line === 'exit') process.exit(7); else console.log('ACK=' + line); });
`);
});
afterEach(async () => {
  await disposeShellSession(context.shellSessionKey!);
  await pruneShellJobs(Date.now() + SHELL_OUTPUT_LIMITS.retentionMs + 1);
  await fs.rm(root, { recursive: true, force: true });
});

describe("real native PTY execution", () => {
  it("provides real TTY input, resize, transcript output and process exit evidence", async () => {
    // PowerShell -Command normally maps a failing native command to exit 1;
    // request propagation explicitly so we can assert the observed shell code.
    const command = process.platform === "win32" ? "node interactive.cjs; exit $LASTEXITCODE" : "node interactive.cjs";
    const start = await runTerminalTool.execute({ command, tty: true, cols: 100, rows: 30, block_until_ms: 0 }, undefined, "start", context);
    expect(start.outcome?.status).toBe("running");
    const id = start.outcome!.jobId!;
    const ready = await awaitShellTool.execute({ shell_id: id, pattern: "READY_TTY=true", block_until_ms: 5000 }, undefined, "ready", context);
    expect(ready.output).toContain("READY_TTY=true");
    await writeStdinTool.execute({ shell_id: id, chars: "hello\r", cols: 110, rows: 35 }, undefined, "input", context);
    const output = await awaitShellTool.execute({ shell_id: id, pattern: "ACK=hello", block_until_ms: 5000 }, undefined, "read", context);
    expect(output.output).toContain("ACK=hello");
    const terminal = getInteractiveTerminal(getOwnedShell(context.shellOwnerKey, id)!.proc!);
    expect(terminal?.cols).toBe(110); expect(terminal?.rows).toBe(35);
    const exit = await writeStdinTool.execute({ shell_id: id, chars: "exit\r", block_until_ms: 5000 }, undefined, "exit", context);
    expect(exit.outcome).toMatchObject({ status: "failed", exitCode: 7 });
  }, 15_000);

  it("rejects input from another owner and confirms termination before workspace removal", async () => {
    const start = await runTerminalTool.execute({ command: "node interactive.cjs", tty: true, block_until_ms: 0 }, undefined, "start", context);
    const id = start.outcome!.jobId!;
    const other = await writeStdinTool.execute({ shell_id: id, chars: "untrusted\r" }, undefined, "other", { ...context, shellOwnerKey: "another-owner" });
    expect(other.output).toContain("unavailable");
    const stop = await writeStdinTool.execute({ shell_id: id, terminate: true }, undefined, "stop", context);
    expect(stop.outcome?.status).toBe("aborted");
    expect(getOwnedShell(context.shellOwnerKey, id)?.proc).toBeUndefined();
  }, 15_000);

  it("does not escape container execution by launching a host PTY", async () => {
    const result = await withExecutionProfile({ kind: "container" }, root, () => runTerminalTool.execute({ command: "node interactive.cjs", tty: true, block_until_ms: 0 }, undefined, "blocked", context));
    expect(result.output).toContain("require local execution");
    expect(result.outcome?.status).toBe("failed");
  });
});
