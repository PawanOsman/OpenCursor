/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, afterEach, expect, it } from "vitest";
import { createConversationWorktree, listConversationWorktrees, removeConversationWorktree } from "./worktrees";
const execute = promisify(execFile);
let fixture: string, repository: string, storage: string;
async function git(...args: string[]) { return (await execute("git", ["-C", repository, ...args], { windowsHide: true })).stdout.trim(); }
beforeEach(async () => {
  fixture = await fs.mkdtemp(path.join(tmpdir(), "ocursor-worktree-")); repository = path.join(fixture, "source repository"); storage = path.join(fixture, "managed worktrees");
  await fs.mkdir(repository); await git("init"); await git("config", "core.autocrlf", "false");
  await fs.writeFile(path.join(repository, "app.txt"), "committed source\n"); await git("add", "app.txt");
  await git("-c", "user.name=OpenCursor Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "fixture");
});
afterEach(async () => { await fs.rm(fixture, { recursive: true, force: true }); });

it("creates a separate registered branch and leaves source uncommitted edits intact", async () => {
  const sourceBranch = await git("branch", "--show-current");
  await fs.writeFile(path.join(repository, "app.txt"), "manual source changes\n");
  const worktree = await createConversationWorktree(repository, storage, "Fix login bug");
  expect(worktree.branch).toMatch(/^opencursor\/fix-login-bug-/);
  expect(await fs.readFile(path.join(worktree.path, "app.txt"), "utf8")).toBe("committed source\n");
  await fs.writeFile(path.join(worktree.path, "app.txt"), "isolated changes\n");
  expect(await fs.readFile(path.join(repository, "app.txt"), "utf8")).toBe("manual source changes\n");
  expect(await git("branch", "--show-current")).toBe(sourceBranch);
  expect((await listConversationWorktrees(repository, storage)).map((record) => record.path)).toEqual([worktree.path]);
  await expect(removeConversationWorktree(repository, storage, worktree.path)).rejects.toThrow("uncommitted changes");
});

it("removes only a clean owned worktree and retains its branch", async () => {
  const worktree = await createConversationWorktree(repository, storage);
  await expect(removeConversationWorktree(repository, storage, repository)).rejects.toThrow("not owned");
  await removeConversationWorktree(repository, storage, worktree.path);
  await expect(fs.stat(worktree.path)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await listConversationWorktrees(repository, storage)).toEqual([]);
  expect(await git("branch", "--list", worktree.branch)).toContain(worktree.branch);
});

it("rejects repository-internal storage and invalid revision options", async () => {
  await expect(createConversationWorktree(repository, path.join(repository, ".worktrees"))).rejects.toThrow("outside the source repository");
  await expect(createConversationWorktree(repository, storage, "task", "--help")).rejects.toThrow("Git worktree operation failed");
});

it("keeps ownership at the original repository when branching from an existing worktree", async () => {
  const first = await createConversationWorktree(repository, storage, "first");
  const second = await createConversationWorktree(first.path, storage, "second");
  expect(second.repositoryRoot).toBe(await fs.realpath(repository));
  expect((await listConversationWorktrees(first.path, storage)).map((item) => item.path).sort()).toEqual([first.path, second.path].sort());
});
