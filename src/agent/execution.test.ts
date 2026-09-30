/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
vi.mock("vscode", () => ({ workspace: {} }));
import { assertExecutionPath, containerArguments, withExecutionProfile } from "./execution";
import { readFileTool } from "./tools/files";
describe("container execution boundaries", () => {
  it("enforces isolation and never interpolates command text into another host shell", () => {
    const root = path.resolve(".");
    const args = containerArguments({ kind: "container" }, root, root, "echo 'hello'; touch /tmp/example", "job");
    expect(args).toContain("--cap-drop=ALL"); expect(args).toContain("none"); expect(args).toContain("--pull=never");
    expect(args.at(-1)).toBe("echo 'hello'; touch /tmp/example");
    expect(() => containerArguments({ kind: "container", image: "node;echo x" }, root, root, "true", "job")).toThrow();
  });
  it("blocks tools outside a container workspace and isolates concurrent profiles", async () => {
    const root = path.resolve(".");
    await Promise.all([
      withExecutionProfile({ kind: "container" }, root, async () => { await Promise.resolve(); expect(() => assertExecutionPath("../protected")).toThrow("inside"); }),
      withExecutionProfile({ kind: "local" }, root, async () => { await Promise.resolve(); expect(() => assertExecutionPath("../protected")).not.toThrow(); }),
    ]);
  });
  it("rejects invalid profiles and working directories escaping through directory links", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ocursor-execution-"));
    try {
      const workspace = path.join(root, "workspace"), outside = path.join(root, "outside");
      await fs.mkdir(workspace); await fs.mkdir(outside); await fs.symlink(outside, path.join(workspace, "link"), "junction");
      await fs.writeFile(path.join(outside, "private.txt"), "must not be returned");
      expect(() => containerArguments({ kind: "container" }, workspace, path.join(workspace, "link"), "true", "test")).toThrow("inside");
      expect(() => withExecutionProfile({ kind: "unexpected" as "container" }, workspace, () => true)).toThrow("kind");
      expect(() => containerArguments({ kind: "container", cpus: Infinity }, workspace, workspace, "true", "test")).toThrow("CPUs");
      expect(() => withExecutionProfile({ kind: "container", network: "false" as unknown as boolean }, workspace, () => true)).toThrow("boolean");
      const result = await withExecutionProfile({ kind: "container" }, workspace, () => readFileTool.execute({ path: path.join(workspace, "link", "private.txt") }));
      expect(result.output).toContain("inside this run's workspace"); expect(result.output).not.toContain("must not be returned");
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});
