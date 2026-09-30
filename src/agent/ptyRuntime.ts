/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { EventEmitter } from "events";
import { PassThrough, Writable } from "stream";
import { finished } from "stream/promises";
import type { ChildProcess } from "child_process";
import type { IPty } from "@lydell/node-pty";
import { importRuntimeDep } from "../runtimeDeps";
import { currentExecutionProfile } from "./execution";

const terminals = new WeakMap<ChildProcess, IPty>();
export function getInteractiveTerminal(proc: ChildProcess): IPty | undefined { return terminals.get(proc); }

export function terminalDimensions(cols: unknown, rows: unknown): { cols: number; rows: number } {
  const width = cols == null ? 120 : Number(cols), height = rows == null ? 30 : Number(rows);
  if (!Number.isInteger(width) || width < 20 || width > 500 || !Number.isInteger(height) || height < 5 || height > 200) throw new Error("Terminal dimensions must be 20–500 columns and 5–200 rows.");
  return { cols: width, rows: height };
}

/** Adapt a real native PTY to the process lifecycle used by the bounded shell spool. */
export async function spawnPtyCommand(command: string, cwd: string, cols?: unknown, rows?: unknown, signal?: AbortSignal): Promise<ChildProcess> {
  if (currentExecutionProfile().kind !== "local") throw new Error("Interactive PTY sessions currently require local execution. Use ordinary Shell in container mode.");
  const dimensions = terminalDimensions(cols, rows);
  signal?.throwIfAborted();
  const module = await importRuntimeDep<typeof import("@lydell/node-pty")>("@lydell/node-pty");
  signal?.throwIfAborted();
  const native = module.spawn ?? (module as any).default?.spawn;
  if (typeof native !== "function") throw new Error("The installed terminal runtime does not export PTY support.");
  const windows = process.platform === "win32";
  const tty = native(windows ? "powershell.exe" : "bash", windows
    ? ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command]
    : ["--noprofile", "--norc", "-c", command], { cwd, ...dimensions, name: "xterm-256color", env: { ...process.env, TERM: "xterm-256color" } });
  const stdout = new PassThrough({ highWaterMark: 64 * 1024 });
  const stderr = new PassThrough(); // A PTY intentionally merges stdout and stderr.
  const stdin = new Writable({ write(chunk, _encoding, callback) {
    try { tty.write(chunk); callback(); } catch (error) { callback(error as Error); }
  } });
  const adapter = Object.assign(new EventEmitter(), { stdout, stderr, stdin,
    exitCode: null as number | null, signalCode: null as string | null,
    kill(killSignal?: string) { try { windows ? tty.kill() : tty.kill(killSignal); return true; } catch { return false; } },
  });
  // ConPTY allocates its child asynchronously; a copied initial PID can be 0.
  Object.defineProperty(adapter, "pid", { get: () => tty.pid });
  const proc = adapter as unknown as ChildProcess;
  terminals.set(proc, tty);
  stdout.on("drain", () => { try { tty.resume(); } catch { /* already exited */ } });
  const data = tty.onData(text => { if (!stdout.write(text)) tty.pause(); });
  let ended = false;
  const exit = tty.onExit(event => {
    if (ended) return; ended = true;
    adapter.exitCode = event.exitCode;
    adapter.signalCode = event.signal ? String(event.signal) : null;
    adapter.emit("exit", event.exitCode, adapter.signalCode);
    // On Windows a natural child exit can leave the ConPTY output worker alive.
    // The public kill operation also releases that owned native connection.
    if (windows) { try { tty.kill(); } catch { /* already released */ } }
    stdout.end(); stderr.end(); stdin.end();
    void Promise.allSettled([finished(stdout), finished(stderr)]).then(() => {
      data.dispose(); exit.dispose(); terminals.delete(proc);
      adapter.emit("close", event.exitCode, adapter.signalCode);
    });
  });
  return proc;
}
