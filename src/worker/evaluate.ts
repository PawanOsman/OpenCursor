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
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { JobManager, saveJson, type JobRequest } from "./jobs";
import { containerArguments, validateExecutionProfile, type ExecutionProfile } from "../agent/execution";
import { isWithinDirectory } from "../context/scopedInstructions";

export interface EvaluationCase extends JobRequest { name: string; split: "development" | "held-out"; grader: { executable: string; args: string[]; timeoutMs?: number; directory?: string; image?: string } }
export interface EvaluationResult { name: string; split: string; id?: string; outcome: "passed" | "failed" | "inconclusive"; elapsedMs: number; tokensUsed: number | null; details: string; baseRevision?: string }

/** Trusted grader code is mounted separately; generated code never runs on the host. */
export async function containerGraderArguments(profile: ExecutionProfile, workspace: string, grader: EvaluationCase["grader"], baseRevision: string, name: string): Promise<string[]> {
  if (!grader.directory || !path.isAbsolute(grader.directory)) throw new Error("Container graders require an absolute trusted directory mounted at /grader");
  const directory = await fs.realpath(grader.directory);
  const root = await fs.realpath(workspace);
  if (!(await fs.stat(directory)).isDirectory() || isWithinDirectory(root, directory) || isWithinDirectory(directory, root)) throw new Error("Grader directory must be separate from the writable agent workspace");
  if (directory.includes(",")) throw new Error("Grader mount paths containing commas are unsupported");
  const args = containerArguments({ ...profile, kind: "container", network: false, image: grader.image ?? profile.image }, root, root, "", name);
  args.splice(-3); // Remove the shell command; exec the trusted grader directly.
  const mount = args.findIndex(value => value.startsWith("type=bind,"));
  args[mount] += ",readonly";
  const workdir = args.indexOf("--workdir"); args[workdir + 1] = "/grader";
  args.splice(args.length - 1, 0, "--mount", `type=bind,source=${directory},target=/grader,readonly`, "--env", "OPENCURSOR_EVAL_WORKSPACE=/workspace", "--env", `OPENCURSOR_EVAL_BASE_REVISION=${baseRevision}`);
  args.push(grader.executable, ...grader.args);
  return args;
}

/** Graders run outside the writable agent workspace, after its processes close. */
export async function evaluate(manager: JobManager, manifest: EvaluationCase[], report: string): Promise<EvaluationResult[]> {
  const results: EvaluationResult[] = [];
  for (const item of manifest) {
    const start = Date.now(); let id: string | undefined;
    try {
      if (!item.name || !["development", "held-out"].includes(item.split) || typeof item.grader?.executable !== "string" || !item.grader.executable || !Array.isArray(item.grader.args) || item.grader.args.some(arg => typeof arg !== "string")) throw new Error("Invalid evaluation case");
      if (item.grader.timeoutMs !== undefined && (!Number.isSafeInteger(item.grader.timeoutMs) || item.grader.timeoutMs <= 0)) throw new Error("Grader timeout must be a positive integer");
      const profile = manager.options.execution ?? { kind: "container" };
      if (profile.kind === "container") {
        validateExecutionProfile({ ...profile, image: item.grader.image ?? profile.image });
        if (!item.grader.directory || !path.isAbsolute(item.grader.directory) || !(await fs.stat(item.grader.directory)).isDirectory()) throw new Error("Container graders require an absolute trusted directory mounted at /grader");
      }
      const job = await manager.submit(item); id = job.id;
      const state = await manager.wait(id);
      if (state.status !== "finished") { results.push({ name: item.name, split: item.split, id, outcome: "inconclusive", elapsedMs: Date.now() - start, tokensUsed: state.tokensUsed, details: state.error ?? `Run ${state.status}`, baseRevision: state.baseRevision }); continue; }
      const workspace = path.join(manager.directory(id), "workspace");
      const grader = item.grader;
      let output: string;
      try {
        const container = profile.kind === "container" ? `ocursor-grader-${randomUUID()}` : undefined;
        const args = container ? await containerGraderArguments(profile, workspace, grader, state.baseRevision!, container) : grader.args;
        const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, HOME: process.env.HOME, OPENCURSOR_EVAL_WORKSPACE: workspace, OPENCURSOR_EVAL_BASE_REVISION: state.baseRevision };
        // These configure the trusted Docker CLI, not the grader process. Only
        // the two explicit --env values above are forwarded into the container.
        if (container) for (const key of ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH", "XDG_RUNTIME_DIR"]) env[key] = process.env[key];
        const result = await promisify(execFile)(container ? "docker" : grader.executable, args, {
          cwd: manager.options.directory, windowsHide: true, timeout: Math.min(grader.timeoutMs ?? 120_000, 600_000), maxBuffer: 4 * 1024 * 1024,
          env,
        }).finally(async () => {
          if (!container) return;
          try { await promisify(execFile)("docker", ["rm", "--force", container], { env, windowsHide: true, timeout: 10_000 }); }
          catch (error) { if (!/No such (container|object)/i.test(String((error as { stderr?: string }).stderr ?? error))) throw new Error("Could not confirm grader container cleanup"); }
        }); output = result.stdout;
      } catch (error) { throw new Error(`Grader infrastructure failure: ${error instanceof Error ? error.message : String(error)}`); }
      const grade = JSON.parse(output);
      if (typeof grade.passed !== "boolean") throw new Error("Grader must return JSON {passed:boolean,details?:string}; an empty output is inconclusive");
      results.push({ name: item.name, split: item.split, id, outcome: grade.passed ? "passed" : "failed", elapsedMs: Date.now() - start, tokensUsed: state.tokensUsed, details: String(grade.details ?? ""), baseRevision: state.baseRevision });
    } catch (error) { results.push({ name: item.name, split: item.split, id, outcome: "inconclusive", elapsedMs: Date.now() - start, tokensUsed: id ? manager.get(id).tokensUsed : null, details: String(error) }); }
    finally {
      await fs.mkdir(path.dirname(report), { recursive: true });
      await saveJson(report, { version: 1, modelSettings: { models: manager.options.models, maxTokens: manager.options.maxTokens, contextTokens: manager.options.contextTokens, execution: manager.options.execution ?? { kind: "container", network: false } }, interpretation: "Run completion is not task success. Only external grader decisions count. Inconclusive runs remain in the denominator. Billed cost is unmeasured. Use held-out tasks and repeated trials before comparing model quality.", results });
    }
  }
  return results;
}
