/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { spawn } from "child_process";
import { homedir } from "node:os";
import { getWorkspaceRoot } from "./workspaceUtils";
import { isWithinDirectory, parseRuleFrontmatter, resolveScopedInstructions, renderScopedInstructions } from "./scopedInstructions";
import { installedPluginSkills } from "../integrations/pluginManager";
export type { ScopedInstruction } from "./scopedInstructions";

const IGNORE = new Set([".git", "node_modules", "dist", "out", ".next", "build", ".cache", "coverage"]);

async function buildTree(dir: string, prefix: string, depth: number, lines: string[], budget: { n: number }): Promise<void> {
  if (depth > 3 || budget.n <= 0) {
    return;
  }
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) {
      return a.isDirectory() ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  for (const e of entries) {
    if (IGNORE.has(e.name) || e.name.startsWith(".") && e.name !== ".cursor") {
      continue;
    }
    if (budget.n <= 0) {
      lines.push(`${prefix}…`);
      return;
    }
    budget.n--;
    if (e.isDirectory()) {
      lines.push(`${prefix}${e.name}/`);
      await buildTree(path.join(dir, e.name), prefix + "  ", depth + 1, lines, budget);
    } else {
      lines.push(`${prefix}${e.name}`);
    }
  }
}

export async function getFileTree(): Promise<string> {
  const root = getWorkspaceRoot();
  const lines: string[] = [];
  await buildTree(root, "", 0, lines, { n: 200 });
  return lines.join("\n");
}

export function getOpenFiles(): string[] {
  const root = getWorkspaceRoot();
  const out: string[] = [];
  for (const editor of vscode.window.visibleTextEditors || []) {
    const fsPath = editor.document.uri.fsPath;
    if (isWithinDirectory(root, fsPath)) {
      out.push(path.relative(root, fsPath).split(path.sep).join("/"));
    }
  }
  return [...new Set(out)];
}

export function getActiveSelection(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    return undefined;
  }
  const root = getWorkspaceRoot();
  const rel = path.relative(root, editor.document.uri.fsPath).split(path.sep).join("/");
  const sel = editor.selection;
  const text = editor.document.getText(sel);
  if (!text.trim()) {
    return undefined;
  }
  return `${rel} (L${sel.start.line + 1}-${sel.end.line + 1}):\n${text.slice(0, 2000)}`;
}

function git(args: string[]): Promise<string> {
  const root = getWorkspaceRoot();
  return new Promise((res) => {
    // Read-only context must not execute a repository's external fsmonitor.
    const c = spawn("git", ["-c", "core.fsmonitor=false", ...args], { cwd: root, windowsHide: true });
    const timer = setTimeout(() => { c.kill(); res(""); }, 5000);
    let o = "";
    c.stdout.on("data", (d) => (o += d));
    c.on("error", () => { clearTimeout(timer); res(""); });
    c.on("close", () => { clearTimeout(timer); res(o.trim()); });
  });
}

export async function getGitContext(): Promise<string> {
  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch) {
    return "";
  }
  const status = await git(["status", "--short"]);
  const parts = [`Branch: ${branch}`];
  if (status) {
    parts.push(`Status:\n${status.split("\n").slice(0, 30).join("\n")}`);
  } else {
    parts.push("Status: clean");
  }
  return parts.join("\n");
}

/** Structured instructions used by the agent's before-tool scope gate. */
export async function scopedInstructionsForPaths(matchFiles: string[] = []) {
  return resolveScopedInstructions(getWorkspaceRoot(), matchFiles);
}

/** Scoped AGENTS.md, legacy rules, and matching Cursor rules, in precedence order. */
export async function getCursorRules(matchFiles: string[] = []): Promise<string> {
  return renderScopedInstructions(await scopedInstructionsForPaths(matchFiles));
}

const parseFrontmatter = parseRuleFrontmatter;

export interface RuleInfo {
  file: string;
  /** Absolute path (for opening in the editor). */
  path?: string;
  alwaysApply: boolean;
  globs: string;
  description: string;
}

/** List all rules (for settings UI), regardless of always-apply. */
export async function listRules(): Promise<RuleInfo[]> {
  const root = getWorkspaceRoot();
  const out: RuleInfo[] = [];
  const rulesDir = path.join(root, ".cursor", "rules");
  try {
    const files = await fs.readdir(rulesDir);
    for (const f of files) {
      if (!f.endsWith(".md") && !f.endsWith(".mdc")) {
        continue;
      }
      try {
        const raw = await fs.readFile(path.join(rulesDir, f), "utf8");
        const p = parseFrontmatter(raw);
        out.push({ file: f, path: path.join(rulesDir, f), alwaysApply: p.alwaysApply, globs: p.globs, description: p.description });
      } catch {
        // skip
      }
    }
  } catch {
    // no rules dir
  }
  return out;
}

/** Applicable rules with explicit path provenance and directory scope. */
export async function listRulesForPrompt(matchFiles: string[] = []): Promise<string> {
  return renderScopedInstructions(await scopedInstructionsForPaths(matchFiles));
}

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  pluginId?: string;
}

/** Workspace definitions take precedence over user skills of the same name. */
export async function listSkills(options: { root?: string; userHome?: string; codexHome?: string } = {}): Promise<SkillInfo[]> {
  const root = options.root ?? getWorkspaceRoot();
  const home = options.userHome ?? homedir();
  const codexHome = options.codexHome ?? process.env.CODEX_HOME ?? path.join(home, ".codex");
  const out: SkillInfo[] = [];
  const names = new Set<string>();
  const seenPaths = new Set<string>();
  const bases = [
    path.join(root, ".opencursor", "skills"), path.join(root, ".agents", "skills"),
    path.join(root, ".codex", "skills"), path.join(root, ".cursor", "skills"), path.join(root, ".cursor", "skills-cursor"),
    path.join(home, ".opencursor", "skills"), path.join(home, ".agents", "skills"),
    path.join(codexHome, "skills"), path.join(home, ".cursor", "skills"),
  ];
  const visit = async (directory: string, depth = 0): Promise<void> => {
    let canonical: string;
    try { canonical = await fs.realpath(directory); } catch { return; }
    if (seenPaths.has(canonical)) return;
    seenPaths.add(canonical);
    const skillFile = path.join(directory, "SKILL.md");
    try {
      const raw = await fs.readFile(skillFile, "utf8");
      const p = parseFrontmatter(raw);
      const name = p.name || p.body.match(/^#\s*(.+)$/m)?.[1]?.trim() || path.basename(directory);
      const key = name.toLowerCase();
      if (!names.has(key)) {
        names.add(key);
        out.push({ name, description: (p.description || p.body.replace(/\n/g, " ").trim()).slice(0, 1000), path: skillFile });
      }
      return;
    } catch { /* A namespace such as .system may contain individual skills. */ }
    if (depth >= 2) return;
    let dirs: import("fs").Dirent[];
    try { dirs = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const dir of dirs.sort((a, b) => a.name.localeCompare(b.name))) {
      if (dir.isDirectory() || dir.isSymbolicLink()) await visit(path.join(directory, dir.name), depth + 1);
    }
  };
  for (const base of bases) await visit(base);
  const pluginSkills = await installedPluginSkills(path.join(home, ".opencursor", "plugins")).catch(() => []);
  for (const skill of pluginSkills) {
    const name = skill.name.toLowerCase();
    if (!names.has(name)) { names.add(name); out.push(skill); }
  }
  return out;
}

export async function buildContextBlock(): Promise<string> {
  const openFiles = getOpenFiles();
  const [tree, git, rules, skills] = await Promise.all([getFileTree(), getGitContext(), getCursorRules(openFiles), listSkills()]);
  const selection = getActiveSelection();

  const parts: string[] = [];
  parts.push(`<workspace_files>\n${tree}\n</workspace_files>`);
  if (openFiles.length) {
    parts.push(`<open_files>\n${openFiles.join("\n")}\n</open_files>`);
  }
  if (selection) {
    parts.push(`<active_selection>\n${selection}\n</active_selection>`);
  }
  if (git) {
    parts.push(`<git>\n${git}\n</git>`);
  }
  if (rules) {
    parts.push(`<rules>\n${rules}\n</rules>`);
  }
  if (skills.length) {
    const list = skills.map((s) => `- ${s.name}: ${s.description} (read ${s.path} to use)`).join("\n");
    parts.push(`<available_skills>\nThese skills provide specialized instructions. When a task matches, read the SKILL.md file with read_file and follow it.\n${list}\n</available_skills>`);
  }
  return parts.join("\n\n");
}
