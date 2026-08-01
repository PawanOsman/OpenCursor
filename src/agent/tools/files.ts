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
import { safePath, getWorkspaceRoot } from "../../context/workspaceUtils";
import { pendingChanges } from "../../stores/pendingChanges";
import { defineTool, type Tool, type ToolResult, type ToolContext } from "./types";
import { IGNORE, makeDiff, firstDiffLine } from "./shared";
import { scanFilesCached, compileGlob, normalizeGlobPattern, scorePath } from "./fileScan";

function getVscode() {
	try {
		return require("vscode");
	} catch {
		return undefined;
	}
}

// Image extensions the Read tool returns as base64 blocks to the model.
const IMAGE_MIME: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
};

/** Race a promise against abort + wall clock so network/missing paths never hang the agent. */
function withAbortTimeout<T>(p: Promise<T>, ms: number, signal?: AbortSignal, label = "read"): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error(`aborted: ${label}`));
			return;
		}
		let settled = false;
		const done = (fn: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			fn();
		};
		const onAbort = () => done(() => reject(new Error(`aborted: ${label}`)));
		const timer = setTimeout(() => done(() => reject(new Error(`timeout: ${label} exceeded ${Math.round(ms / 1000)}s`))), ms);
		signal?.addEventListener("abort", onAbort, { once: true });
		Promise.resolve(p).then(
			(v) => done(() => resolve(v)),
			(e) => done(() => reject(e instanceof Error ? e : new Error(String(e)))),
		);
	});
}

const READ_STAT_MS = 3_000;
const READ_IO_MS = 12_000;
const READ_MAX_BYTES = 8 * 1024 * 1024; // 8 MiB
const BINARY_EXTS = new Set([".exe", ".dll", ".so", ".dylib", ".bin", ".dat", ".o", ".a", ".lib", ".zip", ".gz", ".7z", ".rar", ".tar", ".bz2", ".xz", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp3", ".mp4", ".wav", ".avi", ".mov", ".mkv", ".webm", ".class", ".pyc", ".pyo", ".wasm", ".node", ".pdb", ".obj"]);

function readErrMsg(e: unknown, pathHint: string): string {
	const err = e as NodeJS.ErrnoException & Error;
	const code = err?.code;
	const msg = err instanceof Error ? err.message : String(e);
	if (msg.startsWith("timeout:") || msg.startsWith("aborted:")) {
		return `error: ${msg}. Path may be missing, locked, or on a slow/unreachable share: ${pathHint}`;
	}
	switch (code) {
		case "ENOENT":
			return `error: path not found: ${pathHint}`;
		case "EACCES":
		case "EPERM":
			return `error: permission denied: ${pathHint}`;
		case "EISDIR":
			return `error: path is a directory, not a file: ${pathHint}`;
		case "ENOTDIR":
			return `error: parent path is not a directory: ${pathHint}`;
		case "EBUSY":
		case "EAGAIN":
			return `error: file busy/locked: ${pathHint}`;
		case "EINVAL":
			return `error: invalid path or device: ${pathHint}`;
		case "ENAMETOOLONG":
			return `error: path too long: ${pathHint}`;
		case "ELOOP":
			return `error: too many symlinks: ${pathHint}`;
		case "ENOTSUP":
		case "EOPNOTSUPP":
			return `error: operation not supported for this path: ${pathHint}`;
		default:
			return `error: cannot read file${code ? ` (${code})` : ""}: ${msg}`;
	}
}

function looksBinary(buf: Buffer): boolean {
	const n = Math.min(buf.length, 8_192);
	let odd = 0;
	for (let i = 0; i < n; i++) {
		const b = buf[i];
		if (b === 0) return true;
		// High ratio of non-text control bytes → binary
		if (b < 7 || (b > 13 && b < 32 && b !== 27)) odd++;
	}
	return n > 0 && odd / n > 0.3;
}

// ---- Read ----
export const readFileTool = defineTool("Read", false, async (input, abortSignal) => {
	try {
		if (typeof input.path !== "string" || !input.path) {
			return { output: "error: path is required and must be a string" };
		}
		if (abortSignal?.aborted) return { output: "error: aborted" };

		const pathHint = String(input.path);
		let p: string;
		try {
			// safePath strips quotes, keeps spaces in folder names.
			p = safePath(pathHint);
		} catch (e) {
			return { output: `error: invalid path: ${e instanceof Error ? e.message : String(e)}` };
		}

		// fs.stat has no AbortSignal in @types/node — abort via withAbortTimeout only.
		const readOpts = abortSignal ? { signal: abortSignal as AbortSignal } : undefined;

		// Fast existence/type check first (before realpath) so directories error cleanly
		// and missing/network paths fail within READ_STAT_MS.
		let st: Awaited<ReturnType<typeof fs.stat>>;
		try {
			st = await withAbortTimeout(fs.stat(p), READ_STAT_MS, abortSignal, "stat");
		} catch (e) {
			return { output: readErrMsg(e, pathHint) };
		}
		if (st.isDirectory()) {
			return {
				output: `error: path is a directory, not a file. Use ListDir or Glob instead. Path: ${pathHint}`,
			};
		}
		if (st.isFIFO?.() || st.isSocket?.() || st.isCharacterDevice?.() || st.isBlockDevice?.()) {
			return { output: `error: path is a special device/socket/pipe, not a regular file: ${pathHint}` };
		}

		// Resolve symlinks with a short wall (broken/network links hang otherwise).
		try {
			const resolved = await withAbortTimeout(fs.realpath(p), READ_STAT_MS, abortSignal, "realpath");
			if (resolved !== p) {
				p = resolved;
				try {
					st = await withAbortTimeout(fs.stat(p), READ_STAT_MS, abortSignal, "stat");
				} catch (e) {
					return { output: readErrMsg(e, pathHint) };
				}
				if (st.isDirectory()) {
					return {
						output: `error: path resolves to a directory, not a file. Use ListDir or Glob instead. Path: ${pathHint}`,
					};
				}
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			if (msg.startsWith("timeout:") || msg.startsWith("aborted:")) {
				return { output: readErrMsg(e, pathHint) };
			}
			// keep original p; read below will surface errors
		}
		if (st.size > READ_MAX_BYTES) {
			return {
				output: `error: file too large (${st.size} bytes, max ${READ_MAX_BYTES}). Use offset/limit on a text file or pick a smaller path.`,
			};
		}

		const ext = path.extname(p).toLowerCase();

		// Image files: return a base64 image block so it reaches the model.
		if (IMAGE_MIME[ext]) {
			try {
				const buf = await withAbortTimeout(fs.readFile(p, readOpts), READ_IO_MS, abortSignal, "Read");
				return {
					output: `[image ${path.basename(p)} (${IMAGE_MIME[ext]}, ${buf.length} bytes)]`,
					image: { mime: IMAGE_MIME[ext], base64: buf.toString("base64") },
				};
			} catch (e) {
				return { output: readErrMsg(e, String(input.path)) };
			}
		}

		// PDF files: extract text (honoring the same char cap as text reads).
		if (ext === ".pdf") {
			try {
				const { PDFParse } = await import("pdf-parse");
				const buf = await withAbortTimeout(fs.readFile(p, readOpts), READ_IO_MS, abortSignal, "Read");
				const parser = new PDFParse({ data: new Uint8Array(buf) });
				const res = await withAbortTimeout(parser.getText(), READ_IO_MS, abortSignal, "PDF parse");
				try {
					await parser.destroy?.();
				} catch {
					/* ignore */
				}
				const text = (res?.text ?? "").slice(0, 100_000);
				return { output: text || "(no extractable text in PDF)" };
			} catch (e) {
				return { output: `error: cannot read PDF: ${e instanceof Error ? e.message : String(e)}` };
			}
		}

		if (BINARY_EXTS.has(ext)) {
			return {
				output: `error: binary file (${ext}, ${st.size} bytes) — cannot display as text. Path: ${input.path}`,
			};
		}

		let buf: Buffer;
		try {
			buf = await withAbortTimeout(fs.readFile(p, readOpts), READ_IO_MS, abortSignal, "Read");
		} catch (e) {
			return { output: readErrMsg(e, String(input.path)) };
		}

		if (buf.length === 0) return { output: "File is empty." };

		if (looksBinary(buf)) {
			return {
				output: `error: binary content detected (${buf.length} bytes) — cannot display as text. Path: ${input.path}`,
			};
		}

		// Decode as UTF-8 (replacement for invalid sequences so latin-1-ish files still open).
		let content = buf.toString("utf8");
		// Strip UTF-8 BOM if present.
		if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);

		const lines = content.split(/\r?\n/);
		const totalLines = lines.length;
		// Map Cursor's offset/limit (whole-file by default) to a line window.
		let start = 1;
		let end = totalLines;
		if (input.offset !== undefined && input.offset !== null) {
			const off = Number(input.offset);
			if (!Number.isFinite(off)) {
				return { output: `error: invalid offset: ${input.offset}` };
			}
			start = off < 0 ? Math.max(1, totalLines + off + 1) : Math.max(1, Math.floor(off));
		}
		// Default line cap: whole-file reads shouldn't dump thousands of lines
		// into context. Callers wanting more pass an explicit limit/offset.
		const DEFAULT_MAX_LINES = 1500;
		let capped = false;
		if (input.limit !== undefined && input.limit !== null) {
			const lim = Number(input.limit);
			if (!Number.isFinite(lim) || lim < 1) {
				return { output: `error: invalid limit: ${input.limit}` };
			}
			end = Math.min(totalLines, start + Math.floor(lim) - 1);
		} else if (input.offset !== undefined && input.offset !== null) {
			end = totalLines;
		} else if (totalLines > DEFAULT_MAX_LINES) {
			end = DEFAULT_MAX_LINES;
			capped = true;
		}
		if (end < start) end = start;
		if (start > totalLines) {
			return { output: `error: offset ${start} past end of file (${totalLines} lines)` };
		}

		let out = lines
			.slice(start - 1, end)
			.map((l, idx) => `${start + idx}|${l}`)
			.join("\n");
		if (capped) {
			out += `\n... (${totalLines - end} more lines - read with offset=${end + 1} to continue)`;
		}
		return { output: out, startLine: start, endLine: end };
	} catch (e) {
		return { output: readErrMsg(e, String((input as { path?: string })?.path ?? "")) };
	}
});

// ---- ListDir ----
export const listDirTool = defineTool("ListDir", false, async (input, abortSignal) => {
	try {
		if (abortSignal?.aborted) return { output: "error: aborted" };
		let p: string;
		try {
			const pathInput = typeof input.path === "string" && input.path.trim() ? input.path : ".";
			p = safePath(pathInput);
		} catch (e) {
			return { output: `error: invalid path: ${e instanceof Error ? e.message : String(e)}` };
		}
		const opts: { withFileTypes: true; signal?: AbortSignal } = { withFileTypes: true };
		if (abortSignal) opts.signal = abortSignal;
		const entries = await withAbortTimeout(fs.readdir(p, opts), READ_IO_MS, abortSignal, "ListDir");
		const visible = entries.filter((e) => !IGNORE.has(e.name));
		// Dirs first, then files — fewer tokens spent scanning, easier to navigate.
		visible.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
		const shown = visible.slice(0, 300);
		const extra = visible.length > shown.length ? `\n... (${visible.length - shown.length} more entries)` : "";
		const out = shown.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join("\n") || "(empty)";
		// One short legend beats per-entry type labels: models otherwise treat a
		// trailing "/" as cosmetic and try to Read directories.
		return { output: `(trailing / = directory, no slash = file)\n${out}${extra}` };
	} catch (e) {
		return { output: `error: ListDir failed: ${e instanceof Error ? e.message : String(e)}` };
	}
});

// ---- Glob ----
const GLOB_MAX_RESULTS = 200;

export const globTool = defineTool("Glob", false, async (input, abortSignal) => {
	try {
		let root: string;
		try {
			root = input.target_directory ? safePath(input.target_directory) : getWorkspaceRoot();
		} catch (e) {
			return { output: `error: invalid target_directory: ${e instanceof Error ? e.message : String(e)}` };
		}
		const raw = String(input.glob_pattern ?? "");
		if (!raw.trim()) return { output: "error: glob_pattern is required" };
		const pattern = normalizeGlobPattern(raw);
		const g = compileGlob(pattern);

		// Only descend into normally-ignored trees when the pattern asks for them,
		// otherwise node_modules alone can dominate the walk.
		const wantsIgnored = /node_modules|dist|out|build|coverage|vendor|target|\.venv/.test(pattern);

		// Literal prefix pruning: "src/agent/**/*.ts" never descends outside src/agent.
		const prefix = g.prefix;
		const dirFilter = prefix
			? (rel: string) => rel === prefix || rel.startsWith(prefix + "/") || prefix.startsWith(rel + "/")
			: undefined;

		const { files, truncated } = await scanFilesCached(root, {
			includeIgnored: wantsIgnored,
			signal: abortSignal,
			maxFiles: 60_000,
			timeMs: 12_000,
			dirFilter,
		});
		if (abortSignal?.aborted) return { output: "(glob aborted)" };

		const matched = files.filter((f) => g.test(f.rel));
		// Sort by mtime (newest first) — metadata already gathered during the scan,
		// so this no longer costs a second stat pass over thousands of files.
		matched.sort((a, b) => b.mtimeMs - a.mtimeMs || a.rel.localeCompare(b.rel));

		const hits = matched.slice(0, GLOB_MAX_RESULTS).map((f) => f.rel);
		if (!hits.length) {
			return {
				output: truncated
					? `(no matches — search was truncated; narrow target_directory or the pattern)`
					: "(no matches)",
			};
		}
		const more = matched.length - hits.length;
		const notes: string[] = [];
		if (more > 0) notes.push(`… (${more} more matches)`);
		if (truncated) notes.push("(scan truncated: repo too large / time budget hit)");
		return { output: hits.join("\n") + (notes.length ? "\n" + notes.join("\n") : "") };
	} catch (e) {
		return { output: `error: Glob failed: ${e instanceof Error ? e.message : String(e)}` };
	}
});

// ---- FileSearch (fuzzy filename search) ----
const FILESEARCH_MAX_RESULTS = 30;

export const fileSearchTool = defineTool("FileSearch", false, async (input, abortSignal) => {
	try {
		const q = String(input.query || "").trim();
		if (!q) return { output: "(empty query)" };
		const root = getWorkspaceRoot();

		const { files, truncated } = await scanFilesCached(root, {
			signal: abortSignal,
			maxFiles: 60_000,
			timeMs: 10_000,
		});
		if (abortSignal?.aborted) return { output: "(FileSearch aborted)" };

		const scored: Array<{ rel: string; score: number }> = [];
		for (const f of files) {
			const score = scorePath(f.rel, q);
			if (score > 0) scored.push({ rel: f.rel, score });
		}
		scored.sort((a, b) => b.score - a.score || a.rel.length - b.rel.length || a.rel.localeCompare(b.rel));
		const hits = scored.slice(0, FILESEARCH_MAX_RESULTS).map((x) => x.rel);
		if (!hits.length) return { output: "(no matches)" };
		const more = scored.length - hits.length;
		const notes: string[] = [];
		if (more > 0) notes.push(`… (${more} more, lower ranked)`);
		if (truncated) notes.push("(scan truncated: repo too large / time budget hit)");
		return { output: hits.join("\n") + (notes.length ? "\n" + notes.join("\n") : "") };
	} catch (e) {
		return { output: `error: FileSearch failed: ${e instanceof Error ? e.message : String(e)}` };
	}
});

// ---- StrReplace / Write (shared edit handler) ----
// StrReplace edits an existing file (old_string -> new_string, optionally all
// occurrences). Write creates/overwrites a file (contents). Both share logic.
// In multitask mode the agent is a COORDINATOR: it must NOT edit anything itself.
// Edit tools refuse and instruct it to delegate to parallel subagents instead.
const MULTITASK_BLOCK: ToolResult = {
	output: "error: editing is disabled in coordinator modes (multitask/project) — you are a COORDINATOR and must NOT edit files yourself. " + "Delegate ALL implementation work to subagents: call the Task tool (run_in_background=true) for each " + "independent unit of work and launch multiple subagents AT THE SAME TIME in a single turn. " + "Have the subagents make these edits in parallel; do not call edit tools directly.",
};

function blockedInMultitask(ctx?: ToolContext): boolean {
	const m = ctx?.getMode?.();
	return m === "multitask" || m === "project";
}

const editExecute: Tool["execute"] = async (input, _signal, _callId, ctx) => {
	if (blockedInMultitask(ctx)) return MULTITASK_BLOCK;
	if (typeof input.path !== "string" || !input.path) return { output: "error: path is required and must be a string" };
	let p: string;
	try {
		p = safePath(input.path);
	} catch (e) {
		return { output: `error: invalid path: ${e instanceof Error ? e.message : String(e)}` };
	}
	let existedBefore = false;
	try {
		await fs.access(p);
		existedBefore = true;
	} catch {}
	const original = existedBefore ? await fs.readFile(p, "utf8") : "";

	// Write: full create / overwrite.
	if (input.contents !== undefined && input.old_string === undefined) {
		await fs.mkdir(path.dirname(p), { recursive: true });
		await fs.writeFile(p, input.contents, "utf8");
		pendingChanges.record(input.path, original, input.contents, existedBefore);
		return {
			output: `wrote ${input.path} (${input.contents.split("\n").length} lines)`,
			diff: makeDiff(input.path, original, input.contents),
			startLine: firstDiffLine(original, input.contents),
		};
	}

	if (!existedBefore) {
		return { output: `error: ${input.path} does not exist; pass contents to create it` };
	}

	const oldS = input.old_string ?? "";
	const newS = input.new_string ?? "";
	const replaceAll = input.replace_all ?? input.allow_multiple_matches;
	let matched = original;

	// Strategy 1: exact substring match.
	const idx = original.indexOf(oldS);
	if (idx !== -1) {
		const isUnique = original.indexOf(oldS, idx + 1) === -1;
		if (!isUnique && !replaceAll) {
			return { output: `error: old_string is not unique in ${input.path}; add more context or set replace_all` };
		}
		matched = replaceAll ? original.split(oldS).join(newS) : original.slice(0, idx) + newS + original.slice(idx + oldS.length);
	} else {
		// Strategy 2: whitespace-insensitive line-window match.
		const norm = (s: string) => s.replace(/\s+/g, " ").trim();
		const target = norm(oldS);
		const lines = original.split("\n");
		const windowSize = Math.max(1, oldS.split("\n").length);
		const candidates: number[] = [];
		for (let i = 0; i <= lines.length - windowSize; i++) {
			if (norm(lines.slice(i, i + windowSize).join("\n")) === target) candidates.push(i);
		}
		if (candidates.length === 0) {
			return { output: `error: could not find old_string in ${input.path}` };
		}
		if (candidates.length > 1 && !replaceAll) {
			return { output: `error: old_string matches ${candidates.length} locations in ${input.path}; add more context` };
		}
		const targets = replaceAll ? candidates.slice().reverse() : [candidates[0]];
		for (const found of targets) lines.splice(found, windowSize, ...newS.split("\n"));
		matched = lines.join("\n");
	}

	if (matched === original) {
		return { output: `error: edit produced no change in ${input.path}` };
	}
	await fs.writeFile(p, matched, "utf8");
	pendingChanges.record(input.path, original, matched, existedBefore);
	return {
		output: `edited ${input.path}`,
		diff: makeDiff(input.path, original, matched),
		startLine: firstDiffLine(original, matched),
	};
};

export const strReplaceTool = defineTool("StrReplace", true, editExecute);
export const writeTool = defineTool("Write", true, editExecute);

// ---- Delete ----
const DELETE_IO_MS = 8_000;
const DELETE_BACKUP_MAX = 2 * 1024 * 1024; // 2 MiB snapshot for undo

export const deleteFileTool = defineTool("Delete", true, async (input, abortSignal, _callId, ctx) => {
	if (blockedInMultitask(ctx)) return MULTITASK_BLOCK;
	if (typeof input.path !== "string" || !input.path) return { output: "error: path is required and must be a string" };
	if (abortSignal?.aborted) return { output: "error: aborted" };
	const pathHint = String(input.path);
	let p: string;
	try {
		p = safePath(pathHint);
	} catch (e) {
		return { output: `error: invalid path: ${e instanceof Error ? e.message : String(e)}` };
	}

	// Stat first so missing/dir/network hangs fail fast (not on readFile of whole tree).
	let st: Awaited<ReturnType<typeof fs.stat>> | undefined;
	try {
		st = await withAbortTimeout(fs.stat(p), READ_STAT_MS, abortSignal, "stat");
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		if (msg.startsWith("timeout:") || msg.startsWith("aborted:")) {
			return { output: `error: cannot access path (timed out or aborted): ${pathHint}` };
		}
		return { output: `error: ${pathHint} does not exist` };
	}
	if (st.isDirectory()) {
		return { output: `error: path is a directory, not a file: ${pathHint}` };
	}
	if (abortSignal?.aborted) return { output: "error: aborted" };

	// Optional undo snapshot — skip huge files so delete never hangs on a giant read.
	let before = "";
	if (st.size > 0 && st.size <= DELETE_BACKUP_MAX) {
		try {
			const readOpts = abortSignal ? { encoding: "utf8" as const, signal: abortSignal } : { encoding: "utf8" as const };
			before = await withAbortTimeout(fs.readFile(p, readOpts), DELETE_IO_MS, abortSignal, "Delete backup");
		} catch {
			before = "";
		}
	}
	if (abortSignal?.aborted) return { output: "error: aborted" };

	try {
		// fs.unlink has no AbortSignal in @types/node — race with withAbortTimeout.
		await withAbortTimeout(fs.unlink(p), DELETE_IO_MS, abortSignal, "Delete");
	} catch (e: any) {
		const msg = e instanceof Error ? e.message : String(e);
		if (msg.startsWith("timeout:") || msg.startsWith("aborted:")) {
			return { output: `error: delete timed out or aborted (file locked or unreachable): ${pathHint}` };
		}
		if (e?.code === "ENOENT") return { output: `error: ${pathHint} does not exist` };
		if (e?.code === "EISDIR" || e?.code === "EPERM" || e?.code === "EACCES" || e?.code === "EBUSY") {
			return { output: `error: cannot delete ${pathHint}: ${e.code}` };
		}
		return { output: `error: cannot delete ${pathHint}: ${msg}` };
	}
	// Track as a change so the user can restore the deleted file.
	try {
		pendingChanges.record(pathHint, before, "", true);
	} catch {
		/* ignore undo-tracking failures */
	}
	return { output: `deleted ${pathHint}` };
});

// ---- EditNotebook ----
// The strict set of languages allowed by the schema.
const NB_LANGS = new Set(["python", "markdown", "javascript", "typescript", "r", "sql", "shell", "raw", "other"]);
// Map a cell_language to a Jupyter cell_type. Markdown/raw map directly; every
// programming language is a "code" cell (the language id is kept in metadata).
function nbCellType(lang: string): "code" | "markdown" | "raw" {
	const l = (lang || "").toLowerCase();
	if (l === "markdown") return "markdown";
	if (l === "raw") return "raw";
	return "code";
}
// VS Code language id used in a code cell's metadata so r/sql/shell/etc keep
// their identity (cell_type alone only distinguishes code/markdown/raw).
function nbLanguageId(lang: string): string {
	const l = (lang || "").toLowerCase();
	const map: Record<string, string> = {
		python: "python",
		javascript: "javascript",
		typescript: "typescript",
		r: "r",
		sql: "sql",
		shell: "shellscript",
		other: "plaintext",
	};
	return map[l] || "python";
}
function nbSourceToString(source: unknown): string {
	if (Array.isArray(source)) return source.join("");
	return typeof source === "string" ? source : "";
}
function nbStringToSource(s: string): string[] {
	if (s === "") return [];
	// Each line keeps its trailing "\n" except the final line (Jupyter convention).
	const lines = s.split("\n");
	return lines.map((line, i) => (i < lines.length - 1 ? line + "\n" : line));
}

export const editNotebookTool = defineTool("EditNotebook", true, async (input, _signal, _callId, ctx) => {
	if (blockedInMultitask(ctx)) return MULTITASK_BLOCK;
	const target = String(input?.target_notebook ?? "");
	if (!target) return { output: "error: target_notebook is required" };
	if (!target.toLowerCase().endsWith(".ipynb")) {
		return { output: "error: EditNotebook only edits .ipynb files" };
	}
	const cellIdx = Number(input?.cell_idx);
	if (!Number.isInteger(cellIdx) || cellIdx < 0) {
		return { output: "error: cell_idx must be a non-negative integer" };
	}
	const isNew = input?.is_new_cell === true;
	const language = String(input?.cell_language ?? "");
	if (language && !NB_LANGS.has(language.toLowerCase())) {
		return { output: `error: cell_language must be one of: ${[...NB_LANGS].join(", ")}` };
	}
	const oldString = String(input?.old_string ?? "");
	const newString = String(input?.new_string ?? "");

	let abs: string;
	try {
		abs = safePath(target);
	} catch (e) {
		return { output: `error: invalid path: ${e instanceof Error ? e.message : String(e)}` };
	}

	// Read (or scaffold) the notebook JSON.
	let nb: any;
	let before = "";
	try {
		before = await fs.readFile(abs, "utf8");
		nb = JSON.parse(before);
	} catch (e: any) {
		if (e?.code === "ENOENT" && isNew) {
			nb = { cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 };
		} else {
			return { output: `error: cannot read notebook: ${e instanceof Error ? e.message : String(e)}` };
		}
	}
	if (!nb || typeof nb !== "object" || !Array.isArray(nb.cells)) {
		return { output: "error: not a valid notebook (missing cells array)" };
	}

	const cellType = nbCellType(language);
	const makeCell = (content: string) => {
		const cell: any = { cell_type: cellType, metadata: {}, source: nbStringToSource(content) };
		if (cellType === "code") {
			cell.execution_count = null;
			cell.outputs = [];
			cell.metadata.vscode = { languageId: nbLanguageId(language) };
		}
		return cell;
	};

	if (isNew) {
		// Insert a new cell at cell_idx (clamped to the end of the list).
		const at = Math.min(cellIdx, nb.cells.length);
		nb.cells.splice(at, 0, makeCell(newString));
	} else {
		const cell = nb.cells[cellIdx];
		if (!cell) {
			return { output: `error: cell ${cellIdx} does not exist (notebook has ${nb.cells.length} cells)` };
		}
		const src = nbSourceToString(cell.source);
		if (oldString === "") {
			return { output: "error: old_string is required when editing an existing cell (set is_new_cell=true to create one)" };
		}
		// old_string must uniquely identify the target text within the cell.
		const first = src.indexOf(oldString);
		if (first === -1) {
			return { output: `error: old_string not found in cell ${cellIdx}` };
		}
		if (src.indexOf(oldString, first + 1) !== -1) {
			return { output: `error: old_string is not unique in cell ${cellIdx}; add more surrounding context` };
		}
		const updated = src.slice(0, first) + newString + src.slice(first + oldString.length);
		cell.source = nbStringToSource(updated);
		// Honor an explicit language change, keeping code/markdown/raw cells valid.
		cell.cell_type = cellType;
		if (cellType === "code") {
			if (cell.execution_count === undefined) cell.execution_count = null;
			if (!Array.isArray(cell.outputs)) cell.outputs = [];
			cell.metadata = { ...(cell.metadata ?? {}), vscode: { languageId: nbLanguageId(language) } };
		} else {
			// markdown / raw cells must not carry code-only keys.
			delete cell.execution_count;
			delete cell.outputs;
			if (cell.metadata && cell.metadata.vscode) delete cell.metadata.vscode;
		}
	}

	const after = JSON.stringify(nb, null, 1) + "\n";
	await fs.mkdir(path.dirname(abs), { recursive: true });
	await fs.writeFile(abs, after, "utf8");

	const action = isNew ? `Created ${cellType} cell at index ${Math.min(cellIdx, nb.cells.length - 1)}` : `Edited cell ${cellIdx}`;
	return { output: `${action} in ${target}`, diff: makeDiff(abs, before, after) };
});

// ---- ReadLints ----
export const readLintsTool = defineTool("ReadLints", false, async (input) => {
	const vsc = getVscode();
	if (!vsc?.languages?.getDiagnostics) {
		return { output: "(diagnostics unavailable in standalone CLI mode)" };
	}
	const root = getWorkspaceRoot();
	const all = vsc.languages.getDiagnostics();

	// Normalize each requested path (absolute OR workspace-relative) to a
	// workspace-relative, forward-slashed prefix. A path equal to the workspace
	// root (or "."/"") means "all files" (empty filter list -> no filtering).
	const toRel = (raw: string): string | null => {
		const trimmed = String(raw).trim();
		if (trimmed === "" || trimmed === ".") return null; // means "all"
		const abs = path.resolve(root, trimmed);
		let rel = path.relative(root, abs).split(path.sep).join("/");
		if (rel === "") return null; // path resolves to the root itself -> all
		rel = rel.replace(/\/+$/, "");
		return rel.startsWith("..") ? `\u0000outside\u0000` : rel; // outside workspace -> never matches
	};

	let allFiles = false;
	const filters: string[] = [];
	if (Array.isArray(input.paths)) {
		for (const p of input.paths) {
			const r = toRel(p);
			if (r === null) allFiles = true;
			else filters.push(r);
		}
	}
	// Case-insensitive comparison on win32 (drive-letter / path casing).
	const ci = process.platform === "win32";
	const norm = (s: string) => (ci ? s.toLowerCase() : s);
	const filtersN = filters.map(norm);

	const out: string[] = [];
	for (const [uri, diags] of all) {
		const relRaw = path.relative(root, (uri as any).fsPath).split(path.sep).join("/");
		if (relRaw.startsWith("..")) continue; // outside workspace
		const rel = norm(relRaw);
		if (!allFiles && filtersN.length && !filtersN.some((f) => rel === f || rel.startsWith(f + "/"))) continue;
		for (const d of diags as any[]) {
			if (d.severity > (vsc.DiagnosticSeverity?.Warning ?? 1)) continue;
			const sev = d.severity === (vsc.DiagnosticSeverity?.Error ?? 0) ? "error" : "warning";
			out.push(`${relRaw}:${d.range.start.line + 1}:${d.range.start.character + 1} ${sev}: ${d.message}`);
		}
	}
	return { output: out.slice(0, 100).join("\n") || "(no diagnostics)" };
});
