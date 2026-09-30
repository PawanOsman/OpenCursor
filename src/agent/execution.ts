/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import * as vscode from "vscode";
import { canonicalPath } from "./approvalPolicy";

export interface ExecutionProfile { kind: "local" | "container"; image?: string; network?: boolean; memoryMb?: number; cpus?: number }
interface ExecutionScope { profile: ExecutionProfile; root: string }
const scopes = new AsyncLocalStorage<ExecutionScope>();
const containerJobs = new WeakMap<ChildProcess, string>();

export function configuredExecutionProfile(): ExecutionProfile {
  const config = vscode.workspace.getConfiguration?.("ocursor");
  return { kind: config?.get<string>("executionMode", "local") === "container" ? "container" : "local", image: config?.get("containerImage", "node:22-bookworm-slim"), network: config?.get("containerNetwork", false), memoryMb: config?.get("containerMemoryMb", 4096), cpus: config?.get("containerCpus", 2) };
}
export function validateExecutionProfile(profile: ExecutionProfile): void {
  if (profile.kind !== "local" && profile.kind !== "container") throw new Error("Execution kind must be local or container");
  if (profile.network !== undefined && typeof profile.network !== "boolean") throw new Error("Container network must be a boolean");
  if (profile.memoryMb !== undefined && (!Number.isFinite(profile.memoryMb) || profile.memoryMb < 256 || profile.memoryMb > 262144)) throw new Error("Container memory must be between 256 and 262144 MiB");
  if (profile.cpus !== undefined && (!Number.isFinite(profile.cpus) || profile.cpus < 0.25 || profile.cpus > 128)) throw new Error("Container CPUs must be between 0.25 and 128");
  if (profile.image !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]*$/.test(profile.image)) throw new Error("Invalid container image name");
}
export function withExecutionProfile<T>(profile: ExecutionProfile, root: string, work: () => T): T {
  validateExecutionProfile(profile);
  return scopes.run({ profile, root: canonicalPath(root) }, work);
}
export function currentExecutionProfile(): ExecutionProfile { return scopes.getStore()?.profile ?? { kind: "local" }; }
export function assertExecutionPath(candidate: string): void {
  const scope = scopes.getStore();
  if (scope?.profile.kind !== "container") return;
  const relative = path.relative(scope.root, canonicalPath(path.resolve(scope.root, candidate)));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Container execution only permits files inside this run's workspace. Select local execution for explicitly approved external paths.");
}
export function containerArguments(profile: ExecutionProfile, root: string, cwd: string, command: string, name: string): string[] {
  validateExecutionProfile(profile);
  root = canonicalPath(root);
  cwd = canonicalPath(cwd);
  const relative = path.relative(root, cwd);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Container working directory must be inside the run workspace");
  const image = profile.image ?? "node:22-bookworm-slim";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]*$/.test(image)) throw new Error("Invalid container image name");
  if (root.includes(",")) throw new Error("Docker mount paths containing commas are unsupported; choose another workspace path");
  const memory = Math.max(256, Math.min(262144, Math.floor(profile.memoryMb || 4096)));
  const cpus = Math.max(0.25, Math.min(128, profile.cpus || 2));
  return ["run", "--rm", "--init", "--interactive", "--name", name, "--pull=never", "--network", profile.network ? "bridge" : "none", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=256", "--memory", `${memory}m`, "--cpus", String(cpus), "--read-only", "--tmpfs", "/tmp:rw,nosuid,size=512m", "--mount", `type=bind,source=${root},target=/workspace`, "--workdir", `/workspace${relative ? "/" + relative.split(path.sep).join("/") : ""}`, "--user", `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`, image, "/bin/sh", "-lc", command];
}
/** Caller retains the same pipes, exit codes and cancellation contract in either backend. */
export function spawnExecutionCommand(command: string, cwd: string, local: () => ChildProcess): ChildProcess {
  const scope = scopes.getStore();
  if (!scope || scope.profile.kind === "local") return local();
  assertExecutionPath(cwd);
  const name = `ocursor-${randomUUID()}`;
  const proc = spawn("docker", containerArguments(scope.profile, scope.root, cwd, command, name), { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  containerJobs.set(proc, name);
  return proc;
}
export async function cleanupExecutionProcess(proc: ChildProcess): Promise<boolean> {
  const name = containerJobs.get(proc);
  if (!name) return true;
  return new Promise(resolve => {
    const cleanup = spawn("docker", ["rm", "--force", name], { windowsHide: true, stdio: "ignore" });
    const timer = setTimeout(() => { cleanup.kill(); resolve(false); }, 10_000);
    cleanup.once("error", () => { clearTimeout(timer); resolve(false); });
    cleanup.once("close", code => { clearTimeout(timer); if (code === 0) containerJobs.delete(proc); resolve(code === 0); });
  });
}
