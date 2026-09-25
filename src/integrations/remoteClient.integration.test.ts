/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { expect, it, vi } from "vitest";
vi.mock("vscode", () => ({ workspace: { workspaceFolders: [], textDocuments: [] } }));
import { JobManager, git } from "../worker/jobs";
import { createWorkerServer } from "../worker/server";
import { RemoteJobClient } from "./remoteClient";

it("drives the actual worker HTTP lifecycle with pinned checkout, auth, binary patch and cancellation", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ocursor-client-worker-"));
  const repository = path.join(directory, "source"); await fs.mkdir(repository);
  let began!: () => void; const started = new Promise<void>(resolve => { began = resolve; });
  const manager = new JobManager({ directory: path.join(directory, "jobs"), repositories: { fixture: repository }, models: ["fixture-model"], apiBaseUrl: "http://127.0.0.1:1/v1", apiKey: "test", execution: { kind: "local" } }, async options => {
    if (options.prompt === "Wait until cancelled") {
      began();
      await new Promise<void>(resolve => { if (options.signal.aborted) resolve(); else options.signal.addEventListener("abort", () => resolve(), { once: true }); });
      return;
    }
    await fs.writeFile(path.join(options.workspaceRoot!, "value.txt"), "updated\n");
    await fs.writeFile(path.join(options.workspaceRoot!, "image.bin"), Buffer.from([0, 1, 255, 0]));
    options.onGoalUsage?.(42);
    options.emit({ type: "run-result", text: "Updated fixture", durationMs: 1 });
  });
  const token = "integration-client-token-".repeat(2), server = createWorkerServer(manager, token);
  try {
    await git(repository, ["init"]); await git(repository, ["config", "user.name", "Client Test"]); await git(repository, ["config", "user.email", "test@example.invalid"]);
    await fs.writeFile(path.join(repository, "value.txt"), "original\n");
    await git(repository, ["add", "value.txt"]); await git(repository, ["commit", "-m", "fixture"]);
    const revision = (await git(repository, ["rev-parse", "HEAD"])).trim();
    await manager.initialize();
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const client = new RemoteJobClient(endpoint, token);
    await client.health();
    await expect(new RemoteJobClient(endpoint, "wrong".repeat(8)).list()).rejects.toThrow("401");
    expect(await client.list()).toEqual([]);
    const request = { repository: "fixture", revision, model: "fixture-model", prompt: "Update fixture", tokenBudget: 1000, maxSteps: 5 };
    const submitted = await client.submit(request);
    await manager.wait(submitted.id);
    expect(await client.get(submitted.id)).toMatchObject({ ...request, status: "finished", baseRevision: revision, tokensUsed: 42, result: "Updated fixture" });
    expect((await client.list()).map(job => job.id)).toEqual([submitted.id]);
    const patch = await client.patch(submitted.id);
    expect(patch).toContain("+updated"); expect(patch).toContain("GIT binary patch");
    expect(await fs.readFile(path.join(repository, "value.txt"), "utf8")).toBe("original\n");
    const running = await client.submit({ ...request, prompt: "Wait until cancelled" });
    await started;
    expect((await client.cancel(running.id)).status).toBe("cancelled");
    expect((await client.get(running.id)).status).toBe("cancelled");
  } finally {
    await manager.close();
    await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); });
    await fs.rm(directory, { recursive: true, force: true });
  }
}, 20_000);
