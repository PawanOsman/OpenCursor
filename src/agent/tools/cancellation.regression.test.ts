/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it, vi } from "vitest";
import { spawnShellCommand, killShellProcess, withToolTimeout, waitForShell } from "./shared";

vi.mock("vscode", () => ({ EventEmitter: class { event = () => ({ dispose() {} }); fire() {} }, workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } }));

describe("production cancellation boundaries", () => {
  it("does not classify abort as timeout", async () => {
    const ac = new AbortController(); const timeout = vi.fn();
    const work = withToolTimeout(new Promise(() => {}), 1000, "Write", timeout, ac.signal);
    ac.abort(); await expect(work).rejects.toThrow("aborted: Write");
    expect(timeout).not.toHaveBeenCalled();
  });
  it("settles an already aborted shell wait", async () => {
    const ac = new AbortController(); ac.abort();
    await expect(waitForShell({} as any, 1000, undefined, ac.signal)).resolves.toBeUndefined();
  });
  it.skipIf(process.platform === "win32")("owns and kills the POSIX shell process group", async () => {
    const proc = spawnShellCommand("sleep 60 & echo $!; wait", process.cwd());
    try {
      const childPid = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("no child pid")), 3000);
        proc.stdout!.once("data", data => { clearTimeout(timer); resolve(Number(String(data).trim())); });
      });
      const closed = new Promise<void>(resolve => proc.once("close", () => resolve()));
      killShellProcess(proc); await closed;
      // Linux may briefly retain a zombie until its new parent reaps it.
      const fs = await import("fs");
      let active = false;
      try { active = !fs.readFileSync(`/proc/${childPid}/stat`, "utf8").includes(") Z "); }
      catch { /* reaped */ }
      expect(active).toBe(false);
    } finally { killShellProcess(proc); }
  });
});
