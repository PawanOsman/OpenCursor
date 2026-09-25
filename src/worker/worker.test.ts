/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("vscode", () => ({ workspace: { workspaceFolders: [], textDocuments: [] } }));
import { JobManager, git, type Runner, type JobRequest, type WorkerOptions } from "./jobs";
import { createWorkerServer } from "./server";
import { evaluate, containerGraderArguments } from "./evaluate";

const directories: string[] = [];
const managers: JobManager[] = [];
afterEach(async () => {
  await Promise.all(managers.splice(0).map(manager => manager.close()));
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});
async function fixture(runner: Runner) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ocursor-worker-")); directories.push(root);
  const repo = path.join(root, "original"); await fs.mkdir(repo);
  await git(repo, ["init"]); await git(repo, ["config", "user.name", "Worker Test"]); await git(repo, ["config", "user.email", "test@example.invalid"]);
  await fs.writeFile(path.join(repo, "value.cjs"), "exports.value=41;\n");
  await git(repo, ["add", "value.cjs"]); await git(repo, ["commit", "-m", "fixture"]);
  const revision = (await git(repo, ["rev-parse", "HEAD"])).trim();
  const options: WorkerOptions = { directory: path.join(root, "jobs"), repositories: { test: repo }, models: ["fixture"], apiBaseUrl: "http://127.0.0.1:1/v1", apiKey: "secret-never-persist", execution: { kind: "local" } };
  const manager = new JobManager(options, runner); managers.push(manager); await manager.initialize();
  const request: JobRequest = { repository: "test", revision, model: "fixture", prompt: "Change value to 42" };
  return { root, repo, manager, request, options };
}
it("exports a pinned binary-capable patch while preserving the source and private Git metadata", async () => {
  const f = await fixture(async options => {
    expect(options.workspaceRoot).toBeTruthy();
    expect(await fs.stat(path.join(options.workspaceRoot!, ".git")).catch(() => null)).toBeNull();
    await fs.writeFile(path.join(options.workspaceRoot!, "value.cjs"), "exports.value=42;\n");
    await fs.writeFile(path.join(options.workspaceRoot!, "added.bin"), Buffer.from([0, 1, 255]));
    options.onGoalUsage?.(100);
    await options.onRunEvent?.({ type: "tool-result", at: Date.now(), data: { output: "changed" } });
    options.emit({ type: "run-result", text: "Implemented", durationMs: 1 });
  });
  const job = await f.manager.submit(f.request); const final = await f.manager.wait(job.id);
  expect(final.status).toBe("finished"); expect(final.tokensUsed).toBe(100); expect(final.baseRevision).toBe(f.request.revision);
  expect(await fs.readFile(path.join(f.repo, "value.cjs"), "utf8")).toBe("exports.value=41;\n");
  const patch = await f.manager.patch(job.id); expect(patch).toContain("+exports.value=42;"); expect(patch).toContain("GIT binary patch");
  expect((await f.manager.events(job.id)).events).toHaveLength(1);
  expect(await fs.readFile(path.join(f.manager.directory(job.id), "state.json"), "utf8")).not.toContain("secret-never-persist");
});
it("rejects guessed repositories/revisions/models and serializes concurrent submissions", async () => {
  const f = await fixture(async () => {});
  await expect(f.manager.submit({ ...f.request, repository: "../../escape" })).rejects.toThrow("allowlist");
  await expect(f.manager.submit({ ...f.request, revision: "HEAD" })).rejects.toThrow("commit hash");
  await expect(f.manager.submit({ ...f.request, model: "not-enabled" })).rejects.toThrow("allowlist");
  const results = await Promise.allSettled([f.manager.submit(f.request), f.manager.submit(f.request)]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
});
it("waits for cancellation cleanup and reconnects to persisted state without replay", async () => {
  let started!: () => void; const start = new Promise<void>(resolve => { started = resolve; });
  const runner = vi.fn<Runner>(async options => { started(); await new Promise<void>(resolve => options.signal.addEventListener("abort", () => resolve(), { once: true })); });
  const f = await fixture(runner); const job = await f.manager.submit(f.request); await start;
  expect((await f.manager.cancel(job.id)).status).toBe("cancelled");
  const stateFile = path.join(f.manager.directory(job.id), "state.json");
  const saved = JSON.parse(await fs.readFile(stateFile, "utf8")); saved.status = "running"; await fs.writeFile(stateFile, JSON.stringify(saved));
  const restarted = new JobManager(f.options, runner); managers.push(restarted); await restarted.initialize();
  expect(restarted.get(job.id).status).toBe("interrupted"); expect(runner).toHaveBeenCalledTimes(1);
});
it("authenticates every endpoint and refuses browser-origin requests", async () => {
  const f = await fixture(async () => {}), token = "x".repeat(48), server = createWorkerServer(f.manager, token);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number }; const url = `http://127.0.0.1:${address.port}/v1/jobs`;
  try {
    expect((await fetch(url)).status).toBe(401);
    expect((await fetch(url, { headers: { Authorization: `Bearer ${token}`, Origin: "https://untrusted.invalid" } })).status).toBe(401);
    const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(f.request) });
    expect(response.status).toBe(202); const job = await response.json() as { id: string }; await f.manager.wait(job.id);
    const states = await fetch(url, { headers: { Authorization: `Bearer ${token}` } }); expect((await states.json() as unknown[])).toHaveLength(1);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
it("requires external grader evidence and retains failed/inconclusive cases", async () => {
  const f = await fixture(async options => { await fs.writeFile(path.join(options.workspaceRoot!, "value.cjs"), "exports.value=42;\n"); });
  const grader = path.join(f.root, "grader.cjs");
  await fs.writeFile(grader, "const path=require('node:path');const value=require(path.join(process.env.OPENCURSOR_EVAL_WORKSPACE,'value.cjs')).value;console.log(JSON.stringify({passed:value===Number(process.argv[2])}));");
  const cases = [42, 43].map(value => ({ ...f.request, name: String(value), split: "held-out" as const, grader: { executable: process.execPath, args: [grader, String(value)] } }));
  cases.push({ ...f.request, name: "missing grader", split: "held-out", grader: { executable: path.join(f.root, "missing.exe"), args: [] } });
  const results = await evaluate(f.manager, cases, path.join(f.root, "report.json"));
  expect(results.map(result => result.outcome)).toEqual(["passed", "failed", "inconclusive"]);
  expect(JSON.parse(await fs.readFile(path.join(f.root, "report.json"), "utf8")).results).toHaveLength(3);
});
it("does not launch a job after shutdown races its initial durable save", async () => {
  const runner = vi.fn<Runner>(async () => {}), f = await fixture(runner);
  const submitted = f.manager.submit(f.request), closed = f.manager.close();
  await closed; const job = await submitted;
  expect(job.status).toBe("cancelled"); expect(runner).not.toHaveBeenCalled();
  expect(JSON.parse(await fs.readFile(path.join(f.manager.directory(job.id), "state.json"), "utf8")).status).toBe("cancelled");
});
it("preserves incomplete job directories on restart without preventing new jobs", async () => {
  const f = await fixture(async () => {}), orphan = path.join(f.options.directory, "00000000-0000-0000-0000-000000000000");
  await fs.mkdir(orphan); await fs.writeFile(path.join(orphan, "preserved.tmp"), "interrupted");
  const restarted = new JobManager(f.options, async () => {}); managers.push(restarted); await restarted.initialize();
  const job = await restarted.submit(f.request); expect((await restarted.wait(job.id)).status).toBe("finished");
  expect(await fs.readFile(path.join(orphan, "preserved.tmp"), "utf8")).toBe("interrupted");
});
it("runs container graders directly with isolated read-only mounts and no network", async () => {
  const f = await fixture(async () => {}), directory = path.join(f.root, "grader"); await fs.mkdir(directory);
  const args = await containerGraderArguments({ kind: "container", network: true }, f.repo, { directory, executable: "node", args: ["/grader/check.cjs"] }, f.request.revision, "grader-test");
  expect(args[args.indexOf("--network") + 1]).toBe("none");
  expect(args.filter(arg => arg.startsWith("type=bind,"))).toHaveLength(2);
  expect(args.filter(arg => arg.startsWith("type=bind,")).every(arg => arg.endsWith(",readonly"))).toBe(true);
  expect(args).toContain("OPENCURSOR_EVAL_WORKSPACE=/workspace"); expect(args.slice(-2)).toEqual(["node", "/grader/check.cjs"]);
  expect(args).not.toContain("-lc");
  await expect(containerGraderArguments({ kind: "container" }, f.repo, { directory: f.repo, executable: "node", args: [] }, f.request.revision, "test")).rejects.toThrow("separate");
  await expect(containerGraderArguments({ kind: "container" }, f.repo, { executable: "node", args: [] }, f.request.revision, "test")).rejects.toThrow("trusted directory");
});
