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
import { createHash, randomUUID } from "node:crypto";

const execute = promisify(execFile);
export interface ConversationWorktree {
  path: string;
  branch: string;
  baseCommit: string;
  repositoryRoot: string;
  createdAt: number;
}

function within(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return !!rel && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}
const identity = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;

async function git(root: string, args: string[]): Promise<string> {
  try {
    const result = await execute("git", ["-C", root, ...args], { windowsHide: true, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 60_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    return result.stdout;
  } catch (error) {
    const detail = error as Error & { stderr?: string };
    throw new Error(`Git worktree operation failed: ${(detail.stderr || detail.message).trim().slice(0, 1600)}`);
  }
}

async function repositoryDirectory(root: string): Promise<string> {
  const resolved = (await git(path.resolve(root), ["rev-parse", "--show-toplevel"])).trim();
  if (!resolved) throw new Error("Open a Git repository before creating an isolated conversation.");
  const current = await fs.realpath(resolved);
  const primary = parseWorktrees(await git(current, ["worktree", "list", "--porcelain", "-z"]))[0]?.path;
  return primary ? fs.realpath(primary) : current;
}

async function ownedDirectory(repository: string, storage: string, create = false): Promise<string> {
  const resolvedStorage = path.resolve(storage);
  if (identity(resolvedStorage) === identity(repository) || within(repository, resolvedStorage)) throw new Error("Worktree storage must be outside the source repository.");
  if (create) await fs.mkdir(resolvedStorage, { recursive: true });
  const actualStorage = await fs.realpath(resolvedStorage);
  if (identity(actualStorage) === identity(repository) || within(repository, actualStorage)) throw new Error("Worktree storage must be outside the source repository.");
  const id = createHash("sha256").update(identity(repository)).digest("hex").slice(0, 20);
  const directory = path.join(actualStorage, id);
  if (create) await fs.mkdir(directory, { recursive: true });
  // Never traverse a pre-existing symlink into an unrelated directory.
  try { if (identity(await fs.realpath(directory)) !== identity(directory)) throw new Error("Worktree storage was redirected by a symbolic link."); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return directory;
}

/** New branch/worktree from a committed base. Existing uncommitted files stay in their original checkout. */
export async function createConversationWorktree(repositoryRoot: string, storageDirectory: string, title = "task", baseRef = "HEAD"): Promise<ConversationWorktree> {
  const repository = await repositoryDirectory(repositoryRoot);
  const directory = await ownedDirectory(repository, storageDirectory, true);
  const baseCommit = (await git(path.resolve(repositoryRoot), ["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`])).trim();
  if (!/^[a-f0-9]{40,64}$/i.test(baseCommit)) throw new Error("The selected worktree base is not a commit.");
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || "task";
  const name = `${slug}-${randomUUID().slice(0, 12)}`;
  const target = path.resolve(directory, name);
  if (!within(directory, target)) throw new Error("Invalid worktree destination.");
  const branch = `opencursor/${name}`;
  await git(repository, ["worktree", "add", "-b", branch, "--", target, baseCommit]);
  const record: ConversationWorktree = { path: target, branch, baseCommit, repositoryRoot: repository, createdAt: Date.now() };
  try { await fs.writeFile(path.join(directory, `${name}.json`), JSON.stringify({ version: 1, ...record }, null, 2), { flag: "wx", mode: 0o600 }); }
  catch (error) { throw new Error(`Worktree created at ${target}, but its ownership record could not be saved: ${error instanceof Error ? error.message : String(error)}. The worktree was preserved.`); }
  return record;
}

function parseWorktrees(output: string): Array<{ path: string; branch?: string }> {
  const results: Array<{ path: string; branch?: string }> = [];
  let current: { path: string; branch?: string } | undefined;
  for (const field of output.split("\0")) {
    if (field.startsWith("worktree ")) { if (current) results.push(current); current = { path: path.resolve(field.slice(9)) }; }
    else if (field.startsWith("branch ") && current) current.branch = field.slice(7).replace(/^refs\/heads\//, "");
    else if (!field && current) { results.push(current); current = undefined; }
  }
  if (current) results.push(current);
  return results;
}

export async function listConversationWorktrees(repositoryRoot: string, storageDirectory: string): Promise<ConversationWorktree[]> {
  const repository = await repositoryDirectory(repositoryRoot);
  let directory: string;
  try { directory = await ownedDirectory(repository, storageDirectory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const registered = parseWorktrees(await git(repository, ["worktree", "list", "--porcelain", "-z"]));
  const records: ConversationWorktree[] = [];
  for (const worktree of registered) {
    if (!within(directory, worktree.path) || identity(path.dirname(worktree.path)) !== identity(directory)) continue;
    try {
      const record = JSON.parse(await fs.readFile(path.join(directory, `${path.basename(worktree.path)}.json`), "utf8")) as ConversationWorktree & { version: number };
      if (record.version !== 1 || identity(record.path) !== identity(worktree.path) || identity(record.repositoryRoot) !== identity(repository) || record.branch !== worktree.branch) continue;
      if (identity(await fs.realpath(record.path)) !== identity(record.path)) continue;
      records.push({ path: record.path, branch: record.branch, baseCommit: record.baseCommit, repositoryRoot: record.repositoryRoot, createdAt: record.createdAt });
    } catch { /* Missing/corrupt ownership records must never grant deletion authority. */ }
  }
  return records.sort((a, b) => b.createdAt - a.createdAt);
}

/** Only explicitly owned, registered, clean checkouts can be removed. The branch/commits are retained. */
export async function removeConversationWorktree(repositoryRoot: string, storageDirectory: string, worktreePath: string): Promise<void> {
  const target = path.resolve(worktreePath);
  const owned = (await listConversationWorktrees(repositoryRoot, storageDirectory)).find((record) => identity(record.path) === identity(target));
  if (!owned) throw new Error("This worktree is not owned by OpenCursor for the selected repository.");
  if ((await git(target, ["status", "--porcelain", "--untracked-files=all"])).trim()) throw new Error("This worktree has uncommitted changes. Commit or preserve them before removing it.");
  await git(owned.repositoryRoot, ["worktree", "remove", "--", target]);
  await fs.rm(path.join(path.dirname(target), `${path.basename(target)}.json`), { force: true });
}
