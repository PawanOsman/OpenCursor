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
import { runAgent } from "../agent/loop";
import { JobManager, type WorkerOptions } from "./jobs";
import { createWorkerServer } from "./server";
import { evaluate, type EvaluationCase } from "./evaluate";
import { configureFileMutationStorage } from "../stores/fileMutations";
import { pendingChanges } from "../stores/pendingChanges";
import { initRuntimeDeps } from "../runtimeDeps";

async function main(): Promise<void> {
  const [command, configPath, manifestPath, reportPath] = process.argv.slice(2);
  if (!["serve", "evaluate"].includes(command) || !configPath) throw new Error("Usage: node dist/worker.cjs serve worker.json OR evaluate worker.json tasks.json report.json");
  const config = JSON.parse(await fs.readFile(path.resolve(configPath), "utf8")) as WorkerOptions;
  if (!config.directory || !config.repositories || !Object.keys(config.repositories).length || !config.models?.length || !config.apiBaseUrl) throw new Error("Configure directory, repositories, models and apiBaseUrl");
  const endpoint = new URL(config.apiBaseUrl);
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error("Provider endpoint must be an HTTP(S) URL without embedded credentials or query parameters");
  if (config.execution?.kind === "local" && process.env.OPENCURSOR_TRUSTED_LOCAL_WORKER !== "1") throw new Error("Host execution requires OPENCURSOR_TRUSTED_LOCAL_WORKER=1. Default container execution requires Docker and a pre-pulled image.");
  config.directory = path.resolve(path.dirname(path.resolve(configPath)), config.directory);
  for (const [name, root] of Object.entries(config.repositories)) config.repositories[name] = path.resolve(path.dirname(path.resolve(configPath)), root);
  config.apiKey = process.env.OPENCURSOR_API_KEY ?? "";
  const manager = new JobManager(config, runAgent);
  await manager.initialize();
  const storage = path.join(config.directory, "runtime");
  await configureFileMutationStorage(storage); await pendingChanges.initialize(storage); initRuntimeDeps(storage);
  if (command === "evaluate") {
    if (!manifestPath || !reportPath) throw new Error("An evaluation manifest and output report path are required");
    try { const results = await evaluate(manager, JSON.parse(await fs.readFile(path.resolve(manifestPath), "utf8")) as EvaluationCase[], path.resolve(reportPath)); console.log(JSON.stringify(results, null, 2)); if (results.some(result => result.outcome !== "passed")) process.exitCode = 1; }
    finally { await manager.close(); }
    return;
  }
  const server = createWorkerServer(manager, process.env.OPENCURSOR_WORKER_TOKEN ?? "");
  server.requestTimeout = 30_000; server.headersTimeout = 15_000;
  const port = Number(process.env.OPENCURSOR_WORKER_PORT ?? 7337);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid worker port");
  server.listen(port, "127.0.0.1", () => console.log(`OpenCursor worker ready at http://127.0.0.1:${port}/v1 (use an SSH tunnel for remote access)`));
  server.on("error", error => { console.error(error.message); process.exitCode = 1; });
  const stop = () => { server.close(); void manager.close().then(() => pendingChanges.flush()).catch(error => { console.error(error.message); process.exitCode = 1; }); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
}
void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
