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
import { createHash } from "node:crypto";
import { compileGlob } from "../agent/tools/fileScan";

export interface ScopedInstruction {
  path: string;
  /** Absolute directory scope; glob rules additionally carry their pattern. */
  scope: string;
  content: string;
  fingerprint: string;
  globs?: string;
}

export function isWithinDirectory(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try { const parsed: unknown = JSON.parse(trimmed); if (typeof parsed === "string") return parsed; } catch { /* A list of quoted scalars. */ }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    const inner = trimmed.slice(1, -1);
    if (!inner.replace(/''/g, "").includes("'")) return inner.replace(/''/g, "'");
  }
  return trimmed;
}

/** Small frontmatter reader: scalar fields, folded descriptions and glob arrays. */
export function parseRuleFrontmatter(raw: string): { alwaysApply: boolean; globs: string; description: string; name: string; body: string } {
  const match = raw.replace(/^\uFEFF/, "").match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { alwaysApply: true, globs: "", description: "", name: "", body: raw };
  const fields = new Map<string, string>();
  let current = "";
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([\w-]+):\s*(.*)$/);
    if (field) { current = field[1]; fields.set(current, field[2]); }
    else if (current && /^\s+\S/.test(line)) {
      const previous = fields.get(current) || "";
      fields.set(current, `${/^[>|]-?$/.test(previous) ? "" : previous}${current === "globs" && previous ? "," : " "}${line.trim().replace(/^-\s+/, "")}`.trim());
    }
  }
  return {
    alwaysApply: fields.get("alwaysApply")?.trim().toLowerCase() === "true",
    globs: fields.get("globs") || "",
    description: unquote(fields.get("description") || ""),
    name: unquote(fields.get("name") || ""),
    body: raw.replace(/^\uFEFF/, "").slice(match[0].length),
  };
}

function globPatterns(raw: string): string[] {
  // Split commas outside quotes/braces, preserving patterns such as **/*.{ts,tsx}.
  const value = unquote(raw.trim()).replace(/^\[(.*)\]$/, "$1");
  const result: string[] = [];
  let start = 0, depth = 0, quote = "";
  for (let i = 0; i <= value.length; i++) {
    const char = value[i];
    if (quote) { if (char === quote && value[i - 1] !== "\\") quote = ""; }
    else if (char === "\"" || char === "'") quote = char;
    else if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") depth--;
    if (i === value.length || (char === "," && !quote && depth === 0)) {
      const part = unquote(value.slice(start, i));
      if (part) result.push(part);
      start = i + 1;
    }
  }
  return result;
}

export function ruleMatches(globs: string, relative: string): boolean {
  const rel = relative.split(path.sep).join("/").replace(/^\.\//, "");
  return globPatterns(globs).some((pattern) => {
    const normalized = pattern.replace(/^\.\//, "");
    const glob = compileGlob(normalized);
    return glob.test(rel) || (!normalized.includes("/") && glob.test(path.posix.basename(rel)));
  });
}

/** Resolve only ancestor scopes of requested paths; sibling instructions never leak. */
export async function resolveScopedInstructions(root: string, matchFiles: string[] = []): Promise<ScopedInstruction[]> {
  root = path.resolve(root);
  const directories = new Set<string>();
  for (let directory = root;; directory = path.dirname(directory)) {
    directories.add(directory);
    if (path.dirname(directory) === directory) break;
  }
  const relativeTargets: string[] = [];
  for (const input of matchFiles) {
    const target = path.resolve(root, input);
    if (!isWithinDirectory(root, target)) continue;
    relativeTargets.push(path.relative(root, target).split(path.sep).join("/"));
    let directory = path.dirname(target);
    try { if ((await fs.stat(target)).isDirectory()) directory = target; } catch { /* New file: its parent scope applies. */ }
    while (isWithinDirectory(root, directory)) {
      directories.add(directory);
      if (directory === root) break;
      directory = path.dirname(directory);
    }
  }
  const result: ScopedInstruction[] = [];
  const append = async (file: string, scope: string, globs?: string): Promise<boolean> => {
    try {
      const raw = await fs.readFile(file, "utf8");
      const content = globs !== undefined ? parseRuleFrontmatter(raw).body.trim() : raw.trim();
      if (!content) return false;
      result.push({ path: file, scope, content, globs, fingerprint: createHash("sha256").update(file).update("\0").update(content).digest("hex") });
      return true;
    } catch { return false; }
  };
  // Parent first; the prompt documents that a deeper directory wins on conflict.
  const ordered = [...directories].sort((a, b) => a.split(path.sep).length - b.split(path.sep).length || a.localeCompare(b));
  for (const directory of ordered) {
    if (!await append(path.join(directory, "AGENTS.override.md"), directory)) await append(path.join(directory, "AGENTS.md"), directory);
  }
  await append(path.join(root, ".cursorrules"), root);
  const rulesDir = path.join(root, ".cursor", "rules");
  let files: string[] = [];
  try { files = (await fs.readdir(rulesDir)).sort(); } catch { /* Optional rules. */ }
  for (const file of files.filter((name) => /\.mdc?$/.test(name))) {
    try {
      const parsed = parseRuleFrontmatter(await fs.readFile(path.join(rulesDir, file), "utf8"));
      if (parsed.alwaysApply || relativeTargets.some((target) => ruleMatches(parsed.globs, target))) {
        await append(path.join(rulesDir, file), root, parsed.globs);
      }
    } catch { /* Missing or unreadable rule. */ }
  }
  return result;
}

const attribute = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function renderScopedInstructions(instructions: ScopedInstruction[]): string {
  if (!instructions.length) return "";
  return "Instructions apply only to their stated directory/glob scope. More specific directory instructions override conflicting parent instructions; explicit user instructions take precedence.\n" + instructions.map((rule) =>
    `<workspace_rule path="${attribute(rule.path)}" scope="${attribute(rule.scope)}"${rule.globs ? ` globs="${attribute(rule.globs)}"` : ""} fingerprint="${rule.fingerprint}">\n${rule.content}\n</workspace_rule>`,
  ).join("\n\n");
}
