/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// Shared file-discovery layer for Glob / FileSearch / Grep.
//
// Goals: bounded, cancellable, and fast on large repos.
//  - Parallel breadth-first walk (bounded concurrency) instead of serial DFS.
//  - Short-TTL scan cache so batched search calls walk the tree once.
//  - .gitignore-aware pruning so we do not waste time on build output.
//  - Real glob semantics (`**`, `*`, `?`, `{a,b}`, `[a-z]`) + literal prefix
//    extraction so `src/foo/**/*.ts` only descends into `src/foo`.

import * as fs from "fs/promises";
import * as path from "path";
import type { Dirent } from "fs";
import { IGNORE } from "./ignore";

export interface ScannedFile {
  /** Absolute path. */
  abs: string;
  /** Workspace-relative path, always forward-slashed. */
  rel: string;
  size: number;
  mtimeMs: number;
}

export interface ScanOptions {
  /** Walk directories normally pruned (node_modules, dist, …). */
  includeIgnored?: boolean;
  /** Honor .gitignore files found while walking. Default true. */
  useGitignore?: boolean;
  /** Hard cap on collected files. */
  maxFiles?: number;
  /** Max directory depth below the scan root. */
  maxDepth?: number;
  /** Wall-clock budget; the scan returns what it has when exceeded. */
  timeMs?: number;
  signal?: AbortSignal;
  /**
   * Prune directories eagerly. Receives the workspace-relative dir path
   * (forward-slashed, no trailing slash). Return false to skip the subtree.
   */
  dirFilter?: (rel: string) => boolean;
}

export interface ScanResult {
  files: ScannedFile[];
  /** True when maxFiles / timeMs / abort cut the walk short. */
  truncated: boolean;
}

const toPosix = (p: string): string => p.split(path.sep).join("/");

// ---------------------------------------------------------------------------
// .gitignore
// ---------------------------------------------------------------------------

interface IgnoreRule {
  re: RegExp;
  negated: boolean;
  dirOnly: boolean;
  /** Directory the rule was declared in, workspace-relative ("" for root). */
  base: string;
}

/** Translate one .gitignore line into an anchored RegExp (git wildmatch subset). */
function ignoreLineToRe(line: string, anchored: boolean): RegExp {
  let out = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "*") {
      if (line[i + 1] === "*") {
        // `**/` matches zero or more leading dirs; bare `**` matches anything.
        if (line[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if (c === "[") {
      const end = line.indexOf("]", i + 1);
      if (end === -1) {
        out += "\\[";
      } else {
        out += line.slice(i, end + 1).replace(/\\/g, "\\\\");
        i = end;
      }
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  // Unanchored patterns ("build") match at any depth.
  return new RegExp(`^${anchored ? "" : "(?:.*/)?"}${out}$`);
}

function parseGitignore(text: string, base: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const negated = line.startsWith("!");
    if (negated) line = line.slice(1);
    const dirOnly = line.endsWith("/");
    if (dirOnly) line = line.slice(0, -1);
    // A leading/interior slash anchors the pattern to the .gitignore's dir.
    const anchored = line.startsWith("/") || line.slice(0, -1).includes("/");
    if (line.startsWith("/")) line = line.slice(1);
    if (!line) continue;
    try {
      rules.push({ re: ignoreLineToRe(line, anchored), negated, dirOnly, base });
    } catch {
      /* skip malformed pattern */
    }
  }
  return rules;
}

/** Last matching rule wins, mirroring git's precedence. */
function isIgnored(rules: IgnoreRule[], rel: string, isDir: boolean): boolean {
  let ignored = false;
  for (const r of rules) {
    if (r.dirOnly && !isDir) continue;
    const scoped = r.base ? (rel === r.base || rel.startsWith(r.base + "/") ? rel.slice(r.base.length + 1) : null) : rel;
    if (scoped == null) continue;
    if (r.re.test(scoped)) ignored = !r.negated;
  }
  return ignored;
}

/** Ignore policies shared by scans and incremental indexing. */
export const IGNORE_POLICY_FILES = [".gitignore", ".cursorignore", ".cursorindexingignore"];

async function directoryIgnoreRules(dir: string, base: string): Promise<IgnoreRule[]> {
  const rules: IgnoreRule[] = [];
  for (const name of IGNORE_POLICY_FILES) {
    try { rules.push(...parseGitignore(await fs.readFile(path.join(dir, name), "utf8"), base)); } catch { /* absent */ }
  }
  return rules;
}

/** Check ancestry before reading content; ignored parents cannot be re-included by children. */
export async function isPathExcluded(root: string, relIn: string): Promise<boolean> {
  const rel = toPosix(path.relative(root, path.resolve(root, relIn)));
  if (!rel || rel === ".." || rel.startsWith("../") || path.isAbsolute(rel)) return true;
  const parts = rel.split("/");
  let rules: IgnoreRule[] = [];
  for (let i = 0; i < parts.length; i++) {
    const base = parts.slice(0, i).join("/");
    rules.push(...await directoryIgnoreRules(path.join(root, base), base));
    const candidate = parts.slice(0, i + 1).join("/");
    const isDir = i < parts.length - 1;
    if ((isDir && IGNORE.has(parts[i])) || isIgnored(rules, candidate, isDir)) return true;
  }
  try {
    const [actualRoot, actualFile] = await Promise.all([fs.realpath(root), fs.realpath(path.join(root, rel))]);
    const actualRel = path.relative(actualRoot, actualFile);
    if (actualRel === ".." || actualRel.startsWith(`..${path.sep}`) || path.isAbsolute(actualRel)) return true;
    // An allowed alias must not expose a target excluded elsewhere in the workspace.
    if (toPosix(actualRel) !== rel) return isPathExcluded(root, actualRel);
  } catch { return true; }
  return false;
}

// ---------------------------------------------------------------------------
// Glob compilation
// ---------------------------------------------------------------------------

export interface CompiledGlob {
  re: RegExp;
  /**
   * Literal directory prefix before the first wildcard ("" when none).
   * Lets the walker skip entire subtrees instead of matching every path.
   */
  prefix: string;
  test: (rel: string) => boolean;
}

/**
 * Compile a glob into an anchored RegExp.
 * Supports `**`, `*`, `?`, `{a,b}` alternation and `[a-z]` classes.
 * `**` spans directory separators; `*` and `?` never do.
 */
export function compileGlob(pattern: string, caseInsensitive = process.platform === "win32"): CompiledGlob {
  const src = pattern.replace(/\\/g, "/");
  let out = "";
  const stack: number[] = []; // open `{` groups
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "*") {
      if (src[i + 1] === "*") {
        let j = i + 2;
        while (src[j] === "*") j++;
        if (src[j] === "/") {
          out += "(?:[^/]*/)*"; // `**/` also matches zero directories
          i = j;
        } else {
          out += ".*";
          i = j - 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if (c === "{") {
      stack.push(1);
      out += "(?:";
    } else if (c === "}" && stack.length) {
      stack.pop();
      out += ")";
    } else if (c === "," && stack.length) {
      out += "|";
    } else if (c === "[") {
      const end = src.indexOf("]", i + 1);
      if (end === -1) {
        out += "\\[";
      } else {
        let cls = src.slice(i + 1, end);
        if (cls.startsWith("!")) cls = "^" + cls.slice(1);
        out += `[${cls.replace(/\\/g, "\\\\")}]`;
        i = end;
      }
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  while (stack.length) {
    stack.pop();
    out += ")";
  }

  let re: RegExp;
  try {
    re = new RegExp(`^${out}$`, caseInsensitive ? "i" : "");
  } catch {
    re = /^$/;
  }

  // Literal prefix: everything before the first wildcard/brace, trimmed to a dir.
  const wildcard = src.search(/[*?[{]/);
  let prefix = "";
  if (wildcard > 0) {
    const head = src.slice(0, wildcard);
    const cut = head.lastIndexOf("/");
    if (cut > 0) prefix = head.slice(0, cut);
  } else if (wildcard === -1) {
    const cut = src.lastIndexOf("/");
    if (cut > 0) prefix = src.slice(0, cut);
  }
  if (prefix.startsWith("./")) prefix = prefix.slice(2);

  return {
    re,
    prefix,
    test: (rel: string) => {
      try {
        return re.test(rel);
      } catch {
        return false;
      }
    },
  };
}

/** Back-compat wrapper: previous helper returned a bare RegExp. */
export function globToRe(p: string): RegExp {
  return compileGlob(p).re;
}

/** Normalize user glob input the way the tool contract documents it. */
export function normalizeGlobPattern(pattern: string): string {
  let p = String(pattern ?? "").trim().replace(/\\/g, "/");
  if (!p) return "**/*";
  if (p.startsWith("./")) p = p.slice(2);
  // Bare patterns are recursive: "*.ts" -> "**/*.ts".
  if (!p.startsWith("**/") && !p.includes("/")) p = "**/" + p;
  // A directory-looking pattern means "everything under it".
  if (p.endsWith("/")) p += "**";
  return p;
}

// ---------------------------------------------------------------------------
// Parallel directory walk
// ---------------------------------------------------------------------------

const DIR_CONCURRENCY = 24;

/**
 * Breadth-first, bounded-concurrency scan. Returns file metadata (size/mtime)
 * gathered from the dirent + a single stat per file, so callers can sort by
 * mtime or filter by size without a second pass over the filesystem.
 */
export async function scanFiles(root: string, opts: ScanOptions = {}): Promise<ScanResult> {
  const {
    includeIgnored = false,
    useGitignore = true,
    maxFiles = 50_000,
    maxDepth = 24,
    timeMs = 10_000,
    signal,
    dirFilter,
  } = opts;

  const deadline = Date.now() + timeMs;
  const files: ScannedFile[] = [];
  let truncated = false;
  let gitRules: IgnoreRule[] = [];

  const stop = (): boolean => {
    if (signal?.aborted || Date.now() > deadline || files.length >= maxFiles) {
      truncated = truncated || files.length >= maxFiles || signal?.aborted === true || Date.now() > deadline;
      return true;
    }
    return false;
  };

  if (useGitignore) gitRules = await directoryIgnoreRules(root, "");

  let level: Array<{ abs: string; rel: string; depth: number }> = [{ abs: root, rel: "", depth: 0 }];

  while (level.length && !stop()) {
    const next: Array<{ abs: string; rel: string; depth: number }> = [];
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (cursor < level.length) {
        if (stop()) return;
        const dir = level[cursor++];
        let entries: Dirent[];
        try {
          entries = await fs.readdir(dir.abs, { withFileTypes: true });
        } catch {
          continue; // permission denied / vanished
        }

        // Nested .gitignore files refine pruning for their subtree.
        if (useGitignore && dir.rel) {
          // Await before reading gitRules: concurrent workers append to the live array.
          const nested = await directoryIgnoreRules(dir.abs, dir.rel);
          if (nested.length) gitRules = gitRules.concat(nested);
        }

        for (const e of entries) {
          if (stop()) return;
          const name = e.name;
          const rel = dir.rel ? `${dir.rel}/${name}` : name;
          const abs = path.join(dir.abs, name);
          const isDir = e.isDirectory();

          if (isDir) {
            if (name === ".git") continue; // never useful, always huge
            if (!includeIgnored && IGNORE.has(name)) continue;
            if (dir.depth + 1 > maxDepth) continue;
            if (useGitignore && gitRules.length && isIgnored(gitRules, rel, true)) continue;
            if (dirFilter && !dirFilter(rel)) continue;
            next.push({ abs, rel, depth: dir.depth + 1 });
            continue;
          }

          if (!e.isFile() && !e.isSymbolicLink()) continue;
          if (e.isSymbolicLink() && await isPathExcluded(root, rel)) continue;
          if (useGitignore && gitRules.length && isIgnored(gitRules, rel, false)) continue;

          let size = 0;
          let mtimeMs = 0;
          try {
            const st = await fs.stat(abs);
            if (!st.isFile()) continue; // broken/dir symlink
            size = st.size;
            mtimeMs = st.mtimeMs;
          } catch {
            continue;
          }
          if (files.length >= maxFiles) {
            truncated = true;
            return;
          }
          files.push({ abs, rel, size, mtimeMs });
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(DIR_CONCURRENCY, level.length) }, worker));
    level = next;
  }

  return { files, truncated };
}

// ---------------------------------------------------------------------------
// Short-TTL scan cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  at: number;
  result: ScanResult;
}

const SCAN_TTL_MS = 15_000;
const scanCache = new Map<string, CacheEntry>();

function cacheKey(root: string, opts: ScanOptions): string {
  return [root, opts.includeIgnored ? 1 : 0, opts.useGitignore === false ? 0 : 1, opts.maxFiles ?? "", opts.maxDepth ?? ""].join("|");
}

/**
 * scanFiles + a short TTL cache. Agents typically fire several searches back
 * to back; this makes the 2nd..Nth call effectively free. Scans that were cut
 * short are never cached, so we don't pin a partial view of the repo.
 */
export async function scanFilesCached(root: string, opts: ScanOptions = {}): Promise<ScanResult> {
  // A dirFilter makes the result subtree-specific — do not share it.
  if (opts.dirFilter) return scanFiles(root, opts);
  const key = cacheKey(root, opts);
  const hit = scanCache.get(key);
  if (hit && Date.now() - hit.at < SCAN_TTL_MS) return hit.result;
  const result = await scanFiles(root, opts);
  if (!result.truncated && !opts.signal?.aborted) {
    scanCache.set(key, { at: Date.now(), result });
    if (scanCache.size > 8) scanCache.delete(scanCache.keys().next().value as string);
  }
  return result;
}

/** Drop cached scans (called by the workspace file watcher). */
export function invalidateScanCache(): void {
  scanCache.clear();
}

// ---------------------------------------------------------------------------
// Fuzzy path matching
// ---------------------------------------------------------------------------

/**
 * Score a path against a query (higher = better, 0 = no match).
 *
 * The old implementation only rewarded raw subsequence length, so long vendor
 * paths outranked the exact file the user asked for. This version scores by
 * match quality: exact basename > basename prefix > basename substring >
 * path substring > subsequence, with bonuses for word-boundary hits and
 * consecutive runs, and a mild penalty for path depth and extra length.
 */
export function scorePath(rel: string, query: string): number {
  if (!query) return 0;
  const relLower = rel.toLowerCase();
  const q = query.toLowerCase();
  const slash = relLower.lastIndexOf("/");
  const base = relLower.slice(slash + 1);
  const stem = base.replace(/\.[^.]+$/, "");

  // Path-ish queries ("agent/loop") are matched against the whole path.
  const pathish = q.includes("/");

  let score = 0;
  if (!pathish) {
    if (base === q || stem === q) score = 1000;
    else if (base.startsWith(q) || stem.startsWith(q)) score = 800;
    else if (base.includes(q)) score = 600;
  }
  if (!score && relLower.includes(q)) score = pathish ? 700 : 400;

  if (!score) {
    const sub = subsequenceScore(base, q);
    if (sub > 0) score = 200 + sub;
    else {
      const subPath = subsequenceScore(relLower, q);
      if (subPath <= 0) return 0;
      score = 60 + subPath;
    }
  }

  // Prefer shallow, short, and non-test/vendor paths when scores tie.
  const depth = rel.split("/").length - 1;
  score -= Math.min(depth * 4, 40);
  score -= Math.min(Math.floor(rel.length / 12), 20);
  if (/(^|\/)(test|tests|__tests__|spec|fixtures|examples?)(\/|$)/.test(relLower)) score -= 25;
  if (/\.(d\.ts|min\.js|map)$/.test(relLower)) score -= 30;
  return score;
}

/** Subsequence match quality: rewards consecutive + word-boundary hits. */
function subsequenceScore(text: string, query: string): number {
  let qi = 0;
  let score = 0;
  let run = 0;
  for (let i = 0; i < text.length && qi < query.length; i++) {
    if (text[i] !== query[qi]) {
      run = 0;
      continue;
    }
    run++;
    score += run > 1 ? 4 : 1;
    const prev = i > 0 ? text[i - 1] : "/";
    if (prev === "/" || prev === "-" || prev === "_" || prev === "." || prev === " ") score += 6;
    qi++;
  }
  if (qi < query.length) return 0;
  // Tighter matches (fewer skipped chars) rank higher.
  return score + Math.max(0, 30 - (text.length - query.length));
}

/** Back-compat wrapper for the previous fuzzy helper. */
export function fuzzyScore(text: string, query: string): number {
  return scorePath(text, query);
}

export { toPosix };
