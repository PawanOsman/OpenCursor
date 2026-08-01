/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { spawn } from "child_process";
import { getWorkspaceRoot } from "./workspaceUtils";

function getVscode() {
  try {
    return require("vscode");
  } catch {
    return undefined;
  }
}

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
  const vsc = getVscode();
  if (!vsc?.window?.visibleTextEditors) return out;
  for (const editor of vsc.window.visibleTextEditors) {
    const fsPath = editor.document.uri.fsPath;
    if (fsPath.startsWith(root)) {
      out.push(path.relative(root, fsPath).split(path.sep).join("/"));
    }
  }
  return [...new Set(out)];
}

export function getActiveSelection(): string | undefined {
  const vsc = getVscode();
  const editor = vsc?.window?.activeTextEditor;
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
    const c = spawn("git", args, { cwd: root });
    let o = "";
    c.stdout.on("data", (d) => (o += d));
    c.on("error", () => res(""));
    c.on("close", () => res(o.trim()));
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

function globMatches(globs: string, filePath: string): boolean {
  if (!globs) {
    return false;
  }
  const patterns = globs.split(",").map((g) => g.trim()).filter(Boolean);
  for (const p of patterns) {
    const re = new RegExp(
      "^" +
        p
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*\*/g, "\u0000")
          .replace(/\*/g, "[^/]*")
          .replace(/\u0000/g, ".*")
          .replace(/\?/g, ".") +
        "$"
    );
    if (re.test(filePath) || re.test(filePath.split("/").pop() || "")) {
      return true;
    }
  }
  return false;
}

/**
 * Load .cursor/rules/*.md(c) and AGENTS.md.
 * Always-apply rules are returned always; glob rules only when an open file matches.
 */
export async function getCursorRules(matchFiles: string[] = []): Promise<string> {
  const root = getWorkspaceRoot();
  const blocks: string[] = [];

  // AGENTS.md at root
  for (const name of ["AGENTS.md", ".cursorrules"]) {
    try {
      const body = await fs.readFile(path.join(root, name), "utf8");
      if (body.trim()) {
        blocks.push(`# ${name}\n${body.trim()}`);
      }
    } catch {
      // not present
    }
  }

  // .cursor/rules/*.md(c)
  const rulesDir = path.join(root, ".cursor", "rules");
  try {
    const files = await fs.readdir(rulesDir);
    for (const f of files) {
      if (!f.endsWith(".md") && !f.endsWith(".mdc")) {
        continue;
      }
      try {
        const raw = await fs.readFile(path.join(rulesDir, f), "utf8");
        const parsed = parseFrontmatter(raw);
        const globMatched = parsed.globs && matchFiles.some((mf) => globMatches(parsed.globs, mf));
        if (parsed.alwaysApply || globMatched) {
          blocks.push(`# rule: ${f}\n${parsed.body.trim()}`);
        }
      } catch {
        // skip
      }
    }
  } catch {
    // no rules dir
  }

  return blocks.join("\n\n");
}

function parseFrontmatter(raw: string): { alwaysApply: boolean; globs: string; description: string; body: string } {
  if (raw.startsWith("---")) {
    const end = raw.indexOf("---", 3);
    if (end !== -1) {
      const fm = raw.slice(3, end);
      const body = raw.slice(end + 3);
      const alwaysApply = /alwaysApply:\s*true/i.test(fm);
      const globsMatch = fm.match(/globs:\s*(.*)/i);
      const descMatch = fm.match(/description:\s*(.*)/i);
      return { alwaysApply, globs: globsMatch ? globsMatch[1].trim() : "", description: descMatch ? descMatch[1].trim() : "", body };
    }
  }
  // No frontmatter → treat as always-apply.
  return { alwaysApply: true, globs: "", description: "", body: raw };
}

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

/** Always-applied rules formatted as Cursor's <always_applied_workspace_rule> entries. */
export async function listRulesForPrompt(matchFiles: string[] = []): Promise<string> {
  const root = getWorkspaceRoot();
  const blocks: string[] = [];
  for (const name of ["AGENTS.md", ".cursorrules"]) {
    try {
      const body = await fs.readFile(path.join(root, name), "utf8");
      if (body.trim()) {
        blocks.push(`<always_applied_workspace_rule name="${path.join(root, name)}">${body.trim()}</always_applied_workspace_rule>`);
      }
    } catch {
      // not present
    }
  }
  const rulesDir = path.join(root, ".cursor", "rules");
  try {
    const files = await fs.readdir(rulesDir);
    for (const f of files) {
      if (!f.endsWith(".md") && !f.endsWith(".mdc")) {
        continue;
      }
      try {
        const raw = await fs.readFile(path.join(rulesDir, f), "utf8");
        const parsed = parseFrontmatter(raw);
        const globMatched = parsed.globs && matchFiles.some((mf) => globMatches(parsed.globs, mf));
        if (parsed.alwaysApply || globMatched) {
          blocks.push(`<always_applied_workspace_rule name="${f}">${parsed.body.trim()}</always_applied_workspace_rule>`);
        }
      } catch {
        // skip
      }
    }
  } catch {
    // no rules dir
  }
  return blocks.join("\n");
}

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
}

/** Load SKILL.md files from .cursor/skills/STAR/SKILL.md and skill plugin dirs. */
export async function listSkills(): Promise<SkillInfo[]> {
  const root = getWorkspaceRoot();
  const out: SkillInfo[] = [];
  const bases = [path.join(root, ".cursor", "skills"), path.join(root, ".cursor", "skills-cursor")];
  for (const base of bases) {
    let dirs: import("fs").Dirent[];
    try {
      dirs = await fs.readdir(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of dirs) {
      if (!d.isDirectory()) {
        continue;
      }
      const skillFile = path.join(base, d.name, "SKILL.md");
      try {
        const raw = await fs.readFile(skillFile, "utf8");
        const p = parseFrontmatter(raw);
        const name = p.body.match(/^#\s*(.+)$/m)?.[1]?.trim() || d.name;
        out.push({ name, description: p.description || p.body.slice(0, 200).replace(/\n/g, " ").trim(), path: skillFile });
      } catch {
        // skip
      }
    }
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
