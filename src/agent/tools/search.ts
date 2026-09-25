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
import * as vscode from "vscode";
import { safePath, getWorkspaceRoot } from "../../context/workspaceUtils";
import { isWithinDirectory } from "../../context/scopedInstructions";
import { defineTool } from "./types";
import { rgCommand } from "./shared";
import { scanFilesCached, compileGlob, normalizeGlobPattern } from "./fileScan";
import { BINARY_EXTS, isNoisePath, NOISE_GLOBS } from "./ignore";
import { search as semanticIndexSearch, buildIndex, isIndexing, isIndexingEnabled } from "../semanticIndex";
import { searchDocs, listDocSources } from "../docsIndex";
import { GrepPage, type GrepMode } from "./grepResults";
import type { ToolOutcome } from "../toolOutcome";
import { fuseRetrieval, lexicalCodeSearch } from "./hybridRetrieval";

// Minimal ripgrep --type -> file-extension map for the node fallback.
const TYPE_EXTS: Record<string, string[]> = {
  js: [".js", ".jsx", ".mjs", ".cjs"],
  ts: [".ts", ".tsx", ".mts", ".cts"],
  py: [".py", ".pyi"],
  rust: [".rs"],
  go: [".go"],
  java: [".java"],
  c: [".c", ".h"],
  cpp: [".cpp", ".cc", ".cxx", ".hpp", ".hh"],
  cs: [".cs"],
  rb: [".rb"],
  php: [".php"],
  json: [".json"],
  md: [".md", ".markdown"],
  html: [".html", ".htm"],
  css: [".css", ".scss", ".sass"],
  sh: [".sh", ".bash"],
  yaml: [".yaml", ".yml"],
};

// ---- Grep (ripgrep with a node fallback) ----
export const grepTool = defineTool("Grep", false, async (input, abortSignal) => {
  try {
    if (abortSignal?.aborted) return { output: "(grep aborted)", outcome: { status: "aborted" } };
    const root = getWorkspaceRoot();
    const mode: GrepMode = input.output_mode || "content";
    if (!["content", "files_with_matches", "count"].includes(mode)) return { output: "error: invalid output_mode" };
    const pageNumber = (value: unknown, fallback: number, name: string) => {
      if (value == null) return fallback;
      const n = Number(value);
      if (!Number.isSafeInteger(n) || n < 0) throw new Error(`invalid ${name}`);
      return n;
    };
    const cap = Math.min(pageNumber(input.head_limit, 200, "head_limit") || 200, 2000);
    const skip = pageNumber(input.offset, 0, "offset");
    const aCtx = Math.min(pageNumber(input["-A"] ?? input["-C"], 0, "context"), 50);
    const bCtx = Math.min(pageNumber(input["-B"] ?? input["-C"], 0, "context"), 50);
    const pattern = String(input.pattern ?? "");
    if (!pattern) return { output: "error: pattern is required" };
    const target = input.path ? safePath(input.path) : root;
    const relative = (file: string) => (path.isAbsolute(file) ? path.relative(root, file) : file.replace(/^\.\//, "")).split(path.sep).join("/");
    const page = new GrepPage(mode, skip, cap);
    const rgBin = await rgCommand();
    if (rgBin) {
      // JSON keeps filenames containing ':' unambiguous and separates source rows
      // from file/group separators. Sorting applies to page zero too.
      const args = ["--json", "--sort=path", "--color=never", "--hidden", "--no-messages", "--line-number", "--with-filename", "--path-separator", "/", "--max-filesize", "8M"];
      for (const g of NOISE_GLOBS) args.push("--glob", `!${g}`);
      args.push("--glob", "!**/.git/**", "--glob", "!**/node_modules/**");
      if (mode === "content") args.push("-A", String(aCtx), "-B", String(bCtx));
      if (mode === "files_with_matches") args.push("--max-count", "1");
      if (input["-i"]) args.push("-i");
      if (input.multiline) args.push("-U", "--multiline-dotall");
      if (input.glob) args.push("--glob", String(input.glob));
      if (input.type) args.push("--type", String(input.type));
      args.push("--regexp", pattern, "--", target);
      let outcome: ToolOutcome | undefined;
      const output = await new Promise<string>((resolve) => {
        let settled = false;
        let child: ReturnType<typeof spawn> | undefined;
        let pending = "";
        let stderr = "";
        let currentPath = "";
        let lastRow = 0;
        let lastMatch = 0;
        let matchingLines = 0;
        let markedFile = false;
        let stopping: { message?: string; status?: ToolOutcome["status"] } | undefined;
        let closeFallback: ReturnType<typeof setTimeout> | undefined;
        const finish = (message?: string, status?: ToolOutcome["status"]) => {
          if (settled) return;
          settled = true;
          if (status) outcome = { status };
          clearTimeout(timer);
          clearTimeout(closeFallback);
          abortSignal?.removeEventListener("abort", onAbort);
          resolve(page.format(message));
        };
        const stop = (message?: string, status?: ToolOutcome["status"]) => {
          if (settled || stopping) return;
          stopping = { message, status };
          if (!child) { finish(message, status); return; }
          // Windows retains the process cwd until close; await it before reporting
          // the search settled so the next tool can safely rename/remove files.
          closeFallback = setTimeout(() => finish(message, status), 1500);
          try { child.kill("SIGKILL"); } catch { finish(message, status); }
        };
        const onAbort = () => stop("grep aborted", "aborted");
        const timer = setTimeout(() => stop("grep timed out", "timed_out"), 15_000);
        const decode = (v: { text?: string; bytes?: string } | undefined) => v?.text ?? (v?.bytes ? Buffer.from(v.bytes, "base64").toString("utf8") : "");
        const accept = (record: string) => {
          if (!record || settled || stopping) return;
          const event = JSON.parse(record);
          const data = event.data;
          if (event.type === "begin") {
            currentPath = relative(decode(data.path)); lastRow = 0; lastMatch = 0; matchingLines = 0; markedFile = false;
          } else if (event.type === "match" || event.type === "context") {
            const file = relative(decode(data.path));
            const matching = event.type === "match";
            const lines = decode(data.lines).replace(/\r?\n$/, "").split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
              const number = Number(data.line_number) + i;
              if (matching && number > lastMatch) { matchingLines++; lastMatch = number; }
              if (mode === "files_with_matches" && matching && !markedFile) {
                markedFile = true;
                if (!page.push({ path: file })) { stop(); return; }
              }
              if (mode === "content" && number > lastRow) {
                lastRow = number;
                if (!page.push({ path: file, line: number, text: lines[i], match: matching })) { stop(); return; }
              }
            }
          } else if (event.type === "end" && mode === "count" && matchingLines > 0) {
            if (!page.push({ path: currentPath, count: matchingLines })) stop();
          }
        };
        try { child = spawn(rgBin, args, { cwd: root, windowsHide: true }); }
        catch (e) { finish(`grep failed: ${e instanceof Error ? e.message : String(e)}`, "failed"); return; }
        child.on("error", (e) => finish(`error: ripgrep failed: ${e.message}`, "failed"));
        if (abortSignal?.aborted) onAbort();
        else abortSignal?.addEventListener("abort", onAbort, { once: true });
        child.stdout?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string) => {
          if (settled || stopping) return;
          pending += chunk;
          // A record contains at most one <=8 MiB file, but allow JSON escaping.
          if (pending.length > 64 * 1024 * 1024) { stop("grep JSON record exceeded its memory limit", "failed"); return; }
          let newline: number;
          try {
            while (!settled && !stopping && (newline = pending.indexOf("\n")) >= 0) {
              const record = pending.slice(0, newline); pending = pending.slice(newline + 1); accept(record);
            }
          } catch { stop("error: malformed ripgrep output", "failed"); }
        });
        child.stderr?.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(0, 2000); });
        child.on("close", (code) => {
          if (settled) return;
          if (stopping) { finish(stopping.message, stopping.status); return; }
          try { if (pending.trim()) accept(pending); } catch { finish("error: malformed ripgrep output", "failed"); return; }
          finish(code === null || code > 1 ? `error: ripgrep failed: ${stderr.trim().split("\n")[0] || `exit ${code}`}` : undefined, code === null || code > 1 ? "failed" : undefined);
        });
      });
      return { output, ...(outcome ? { outcome } : {}) };
    }

    // Files are read concurrently within a small batch, then consumed in sorted
    // order. Completion order must never decide which files make the first page.
    const flags = input["-i"] ? "i" : "";
    let expression: RegExp;
    try { expression = new RegExp(pattern, flags + (input.multiline ? "gs" : "")); }
    catch (e) { return { output: `error: invalid pattern: ${e instanceof Error ? e.message : String(e)}` }; }
    const glob = input.glob ? compileGlob(normalizeGlobPattern(String(input.glob))) : null;
    const typeExts = input.type ? TYPE_EXTS[String(input.type)] : null;
    if (input.type && !typeExts) return { output: `error: unsupported file type without ripgrep: ${String(input.type)}` };
    const st = await fs.stat(target);
    const scan = st.isFile() ? { files: [{ abs: target, rel: relative(target), size: st.size, mtimeMs: st.mtimeMs }], truncated: false }
      : await scanFilesCached(target, { signal: abortSignal, maxFiles: 40_000, timeMs: 10_000 });
    if (abortSignal?.aborted) return { output: "(grep aborted)", outcome: { status: "aborted" } };
    const candidates = scan.files.filter((f) => {
      const rel = relative(f.abs);
      return (!glob || glob.test(rel)) && (!typeExts || typeExts.includes(path.extname(f.abs).toLowerCase()))
        && !BINARY_EXTS.has(path.extname(f.abs).toLowerCase()) && !isNoisePath(rel) && f.size <= 8 * 1024 * 1024;
    }).sort((a, b) => Buffer.compare(Buffer.from(relative(a.abs)), Buffer.from(relative(b.abs))));
    const list = candidates.slice(0, 20_000);
    const deadline = Date.now() + 15_000;
    let incomplete = scan.truncated || candidates.length > list.length ? "file scan limit reached" : undefined;
    let unreadable = 0;
    outer: for (let at = 0; at < list.length; at += 4) {
      if (abortSignal?.aborted) return { output: page.format("grep aborted"), outcome: { status: "aborted" } };
      if (Date.now() > deadline) { incomplete = "grep timed out"; break; }
      const batch = await Promise.all(list.slice(at, at + 4).map(async (file) => {
        try {
          const buf = await fs.readFile(file.abs, { signal: abortSignal });
          if (buf.length > 8 * 1024 * 1024 || buf.subarray(0, 8192).includes(0)) return null;
          return { file: relative(file.abs), text: buf.toString("utf8").replace(/^\uFEFF/, "") };
        } catch { unreadable++; return null; }
      }));
      if (abortSignal?.aborted) return { output: page.format("grep aborted"), outcome: { status: "aborted" } };
      for (const entry of batch) {
        if (!entry) continue;
        if (abortSignal?.aborted) return { output: page.format("grep aborted"), outcome: { status: "aborted" } };
        const lines = entry.text ? entry.text.split(/\r?\n/) : [];
        if (entry.text.endsWith("\n")) lines.pop();
        const matches = new Set<number>();
        if (input.multiline) {
          expression.lastIndex = 0;
          let match: RegExpExecArray | null;
          let position = 0;
          let line = 0;
          while ((match = expression.exec(entry.text)) !== null) {
            while (position < match.index) { if (entry.text.charCodeAt(position++) === 10) line++; }
            let last = line;
            for (let i = match.index; i < match.index + match[0].length; i++) {
              if (entry.text.charCodeAt(i) === 10 && i + 1 < match.index + match[0].length) last++;
            }
            for (let i = line; i <= last && i < lines.length; i++) matches.add(i);
            if (match[0].length === 0) expression.lastIndex++;
          }
        } else {
          for (let i = 0; i < lines.length; i++) if (expression.test(lines[i])) matches.add(i);
        }
        if (!matches.size) continue;
        if (mode !== "content") {
          if (!page.push({ path: entry.file, count: matches.size })) break outer;
          continue;
        }
        // Merge overlapping context windows before paging; each source line is
        // emitted once and a matching line always keeps its ':' marker.
        let previousEnd = -1;
        for (const index of matches) {
          const start = Math.max(previousEnd + 1, index - bCtx, 0);
          const end = Math.min(lines.length - 1, index + aCtx);
          for (let i = start; i <= end; i++) {
            if (!page.push({ path: entry.file, line: i + 1, text: lines[i], match: matches.has(i) })) break outer;
          }
          previousEnd = Math.max(previousEnd, end);
        }
      }
    }
    if (unreadable && !incomplete) incomplete = `${unreadable} unreadable file(s)`;
    return { output: page.format(incomplete), ...(incomplete === "grep timed out" ? { outcome: { status: "timed_out" as const } } : {}) };
  } catch (e) {
    return { output: `error: Grep failed: ${e instanceof Error ? e.message : String(e)}`, outcome: { status: abortSignal?.aborted ? "aborted" : "failed" } };
  }
});

// ---- Rg (raw ripgrep, no shell) ----
const RG_OUTPUT_CAP = 60_000;
const RG_TIMEOUT_MS = 60_000;
// Flags that would make ripgrep touch things outside the read-only contract.
const RG_BLOCKED_FLAGS = new Set(["--pre", "--pre-glob", "-r", "--replace", "--passthru", "--files-from"]);

export const rgTool = defineTool("Rg", false, async (input, abortSignal) => {
  if (abortSignal?.aborted) return { output: "(rg aborted)", outcome: { status: "aborted" } };
  const raw = Array.isArray(input?.args) ? input.args : [];
  const args = raw.map((a: unknown) => String(a));
  if (!args.length) return { output: "error: args is required (argv after 'rg')" };
  if (args[0] === "rg" || /(^|[\\/])rg(\.exe)?$/i.test(args[0])) args.shift();
  for (const a of args) {
    const flag = a.includes("=") ? a.slice(0, a.indexOf("=")) : a;
    if (RG_BLOCKED_FLAGS.has(flag)) return { output: `error: ${flag} is not permitted; Rg is read-only. Use Shell for anything that executes programs or rewrites output.` };
  }
  const rgBin = await rgCommand();
  if (!rgBin) return { output: "error: ripgrep is not available on this machine (not bundled with this VS Code build and not on PATH). Use Grep instead." };
  let cwd: string;
  try { cwd = input?.working_directory ? safePath(String(input.working_directory)) : getWorkspaceRoot(); }
  catch (e) { return { output: `error: ${e instanceof Error ? e.message : String(e)}` }; }

  const finalArgs = ["--color=never", "--no-messages", "--path-separator", "/", ...args];
  return new Promise((resolve) => {
    let settled = false;
    let out = "";
    let err = "";
    let truncated = false;
    let child: ReturnType<typeof spawn> | undefined;
    const done = (status: ToolOutcome["status"], exitCode?: number, note?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      abortSignal?.removeEventListener("abort", onAbort);
      const head = `[rg ${status}${exitCode != null ? ` exit_code=${exitCode}` : ""}${truncated ? " output=truncated" : ""}]`;
      const body = out.trim() || (exitCode === 1 && status === "completed" ? "(no matches)" : "");
      const trailer = [err.trim() && `stderr:\n${err.trim()}`, note].filter(Boolean).join("\n");
      resolve({ output: [head, body, trailer].filter(Boolean).join("\n"), outcome: { status, exitCode } });
    };
    const kill = () => { try { child?.kill("SIGKILL"); } catch { /* exited */ } };
    const onAbort = () => { kill(); done("aborted"); };
    const timer = setTimeout(() => { kill(); done("timed_out", undefined, `rg exceeded ${RG_TIMEOUT_MS / 1000}s; narrow the search.`); }, RG_TIMEOUT_MS);
    try { child = spawn(rgBin, finalArgs, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); }
    catch (e) { done("failed", undefined, `spawn failed: ${e instanceof Error ? e.message : String(e)}`); return; }
    if (abortSignal?.aborted) { onAbort(); return; }
    abortSignal?.addEventListener("abort", onAbort, { once: true });
    const collect = (sink: "out" | "err") => (chunk: Buffer) => {
      if (settled) return;
      const text = chunk.toString("utf8");
      if (sink === "err") { if (err.length < 8_000) err += text; return; }
      if (out.length >= RG_OUTPUT_CAP) { if (!truncated) { truncated = true; kill(); } return; }
      out += text;
      if (out.length > RG_OUTPUT_CAP) { out = out.slice(0, RG_OUTPUT_CAP); truncated = true; kill(); }
    };
    child.stdout?.on("data", collect("out"));
    child.stderr?.on("data", collect("err"));
    child.on("error", (e) => done("failed", undefined, `ripgrep failed: ${e.message}`));
    child.on("close", (code) => {
      // ripgrep: 0 matches, 1 no matches, 2 error. A kill from truncation still counts as completed.
      if (truncated) done("completed", code ?? 0, `output capped at ${RG_OUTPUT_CAP} chars; narrow the query (e.g. add a path, -l, or --max-count).`);
      else done(code === 2 ? "failed" : "completed", code ?? undefined);
    });
  });
});

// ---- SemanticSearch ----
// Fuse exact identifiers/current text with semantic candidates on every query.

const AUTO_BUILD_MIN_INTERVAL_MS = 5 * 60_000;
const lastAutoBuild = new Map<string, number>();

export const semanticSearchTool = defineTool("SemanticSearch", false, async (input, abortSignal, callId, ctx) => {
  try {
  if (abortSignal?.aborted) return { output: "(search aborted)" };
  const query = String(input.query || "").trim();
  if (!query) return { output: "(no query)" };
  const root = getWorkspaceRoot();

  // Build/refresh index on demand (incremental; cheap if already fresh).
  // Never await a full rebuild here — that hung explore tools for minutes.
  // Throttled: the watcher already keeps the index current, so a full workspace
  // scan on every single SemanticSearch call is pure overhead.
  if (isIndexingEnabled() && !isIndexing() && Date.now() - (lastAutoBuild.get(root) ?? 0) > AUTO_BUILD_MIN_INTERVAL_MS) {
    lastAutoBuild.set(root, Date.now());
    if (lastAutoBuild.size > 32) lastAutoBuild.delete(lastAutoBuild.keys().next().value!);
    void buildIndex(root).catch(() => {});
  }

  // Scope by target_directories (prefix match on workspace-relative paths).
  const dirs: string[] = Array.isArray(input.target_directories) ? input.target_directories : [];
  const prefixes = dirs.map((directory) => {
    const target = safePath(String(directory));
    if (!isWithinDirectory(root, target)) throw new Error("Search scopes must be inside the current workspace.");
    return path.relative(root, target).split(path.sep).join("/");
  });
  const filter = prefixes.length
    ? (rel: string) => prefixes.some((p) => !p || rel === p || rel.startsWith(p + "/"))
    : undefined;

  const editors = (vscode.workspace.textDocuments ?? [])
    .filter((document) => document.isDirty && document.uri.scheme === "file" && isWithinDirectory(root, document.uri.fsPath))
    .map((document) => ({ path: path.relative(root, document.uri.fsPath).split(path.sep).join("/"), text: document.getText(), version: document.version }));
  const editorPaths = new Set(editors.map((editor) => editor.path));
  const [semantic, lexical] = await Promise.all([
    semanticIndexSearch(root, query, 16, (relative) => !editorPaths.has(relative) && (!filter || filter(relative))).catch(() => []),
    lexicalCodeSearch(root, query, { filter, signal: abortSignal, editors }),
  ]);
  if (abortSignal?.aborted) return { output: "(search aborted)", outcome: { status: "aborted" } };
  const hits = fuseRetrieval(semantic, lexical.hits);
  const note = lexical.incomplete ? `\n\nKeyword scan was bounded (${lexical.scannedFiles} files examined); narrow target_directories or use Grep for exhaustive exact matching.` : "";
  if (!hits.length) return { output: `(no matching indexed or keyword excerpts)${note}` };

  // Cap each chunk so a few large hits don't blow the context budget.
  const snip = (t: string) => (t.length > 1200 ? t.slice(0, 1200) + "\n... (trimmed - Read the file for full context)" : t);
  const out = hits
    .map((h) => `${h.path}:${h.start}-${h.end} [${h.signals!.join("+")}${h.source === "editor" ? "; unsaved editor buffer" : ""}]\n${snip(h.text)}`)
    .join("\n\n---\n\n");
  return { output: out + note };
  } catch (e) {
    return { output: `error: SemanticSearch failed: ${e instanceof Error ? e.message : String(e)}` };
  }
});

// ---- SearchDocs (user-indexed external documentation) ----
export const searchDocsTool = defineTool("SearchDocs", false, async (input) => {
  try {
  const query = String(input.query || "").trim();
  if (!query) return { output: "(no query)" };
  const k = Math.max(1, Math.min(Number(input.num_results) || 6, 12));
  const sources = listDocSources().filter((d) => (d.pages ?? 0) > 0);
  if (!sources.length) return { output: "(no indexed doc sources - add them in Settings > Indexing & Docs)" };

  const want = String(input.doc || "").trim().toLowerCase();
  const targets = want
    ? sources.filter((d) => d.id.toLowerCase() === want || d.name.toLowerCase() === want)
    : sources;
  if (!targets.length) {
    return { output: `(no indexed doc source matching "${input.doc}". Available: ${sources.map((d) => d.name).join(", ")})` };
  }

  const all: { doc: string; url: string; title: string; text: string; score: number }[] = [];
  const failures: string[] = [];
  for (const d of targets) {
    try {
      const hits = await searchDocs(d.id, query, k);
      for (const h of hits) all.push({ doc: d.name, ...h });
    } catch (error) {
      failures.push(`${d.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  all.sort((a, b) => b.score - a.score);
  const top = all.slice(0, k);
  if (!top.length) return { output: failures.length ? `error: ${failures.join("; ")}` : "(no matching excerpts)" };
  const snip = (t: string) => (t.length > 1200 ? t.slice(0, 1200) + "\n... (trimmed)" : t);
  return {
    output: top
      .map((h) => `[${h.doc}] ${h.title} - ${h.url} (${h.score.toFixed(2)})\n${snip(h.text)}`)
      .join("\n\n---\n\n") + (failures.length ? `\n\nUnavailable sources: ${failures.join("; ")}` : ""),
  };
  } catch (e) {
    return { output: `error: SearchDocs failed: ${e instanceof Error ? e.message : String(e)}` };
  }
});
