/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as path from "path";

function getVscode() {
	try {
		return require("vscode");
	} catch {
		return undefined;
	}
}

export function getWorkspaceRoot(): string {
	if (process.env.OPEN_CURSOR_WORKSPACE_ROOT) {
		return path.resolve(process.env.OPEN_CURSOR_WORKSPACE_ROOT);
	}
	const vsc = getVscode();
	const folders = vsc?.workspace?.workspaceFolders;
	if (folders && folders.length > 0) {
		return folders[0].uri.fsPath;
	}
	return process.cwd();
}

/** Recently viewed files (workspace-relative), most recent first. */
export function getRecentFiles(): string[] {
	const root = getWorkspaceRoot();
	const out: string[] = [];
	const vsc = getVscode();
	if (!vsc?.window?.tabGroups?.all) return out;
	for (const tab of vsc.window.tabGroups.all.flatMap((g: any) => g.tabs)) {
		const input = tab.input as { uri?: any } | undefined;
		const uri = input?.uri;
		if (uri && uri.scheme === "file" && uri.fsPath.startsWith(root)) {
			const rel = path.relative(root, uri.fsPath).split(path.sep).join("/");
			if (!out.includes(rel)) {
				out.push(uri.fsPath);
			}
		}
	}
	return out;
}

/**
 * Normalize a model/user path: spaces, quotes, file:// URIs, mixed separators.
 * Does not shell-quote — callers that inject into a shell must quote the result.
 */
export function normalizePathInput(rel: string): string {
	let s = String(rel ?? "").trim();
	// file:///C:/foo%20bar or file://localhost/C:/...
	if (/^file:\/\//i.test(s)) {
		try {
			const vsc = getVscode();
			if (vsc?.Uri?.parse) {
				s = decodeURIComponent(vsc.Uri.parse(s).fsPath);
			} else {
				throw new Error("no vscode uri");
			}
		} catch {
			s = s.replace(/^file:\/\/\/?/i, "").replace(/\//g, path.sep);
			try {
				s = decodeURIComponent(s);
			} catch {
				/* keep */
			}
		}
	}
	// Strip surrounding quotes the model wraps around paths with spaces.
	// Also handle nested `"path with spaces"` and smart quotes.
	for (let i = 0; i < 3; i++) {
		const t = s.trim();
		if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")) || (t.startsWith("`") && t.endsWith("`")) || (t.startsWith("\u201c") && t.endsWith("\u201d")) || (t.startsWith("\u2018") && t.endsWith("\u2019"))) {
			s = t.slice(1, -1).trim();
			continue;
		}
		s = t;
		break;
	}
	// Model sometimes escapes spaces as `\ ` (unix-style).
	s = s.replace(/\\ /g, " ");
	// `/workspace` is the portable model-facing alias on every host OS.
	if (/^[/\\]workspace(?:[/\\]|$)/i.test(s)) {
		const suffix = s.replace(/^[/\\]workspace(?:[/\\]?)/i, "");
		s = path.join(getWorkspaceRoot(), suffix);
	}
	// Collapse only internal runs of spaces that are clearly accidental? Keep
	// real spaces in folder names — do not collapse.
	// Normalize separators; path.resolve will also fix mixed ones.
	s = s.replace(/\//g, path.sep);
	// Drop trailing separators except drive root (C:\).
	if (s.length > 3 && (s.endsWith(path.sep) || s.endsWith("/") || s.endsWith("\\"))) {
		s = s.replace(/[\\/]+$/, "");
	}
	return s;
}

/**
 * Resolve a workspace path safely. Handles spaces, unicode, and mixed
 * separators. Does not shell-quote — callers that inject into a shell must
 * quote the result (see shell.ts quotePath).
 */
/** Show workspace paths relative to its root; keep outside paths absolute. */
export function toWorkspacePath(input: string, root = getWorkspaceRoot()): string {
	const s = normalizePathInput(input);
	if (!s) return s;
	const ws = path.resolve(root);
	const resolved = path.resolve(path.isAbsolute(s) ? s : path.join(ws, s));
	const relative = path.relative(ws, resolved);
	if (relative === "") return ".";
	if (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
		return relative;
	}
	return resolved;
}

export function normalizeToolPaths(toolName: string, input: any, root = getWorkspaceRoot()): any {
	const keys: Record<string, string[]> = {
		Read: ["path"], ListDir: ["path"], Glob: ["target_directory"], Grep: ["path"],
		SemanticSearch: ["target_directories"], StrReplace: ["path"], Write: ["path"],
		Delete: ["path"], EditNotebook: ["target_notebook"], ReadLints: ["paths"],
		Task: ["file_attachments"], FetchMcpResource: ["downloadPath"],
		Shell: ["working_directory"],
	};
	const out = { ...input };
	for (const key of keys[toolName] ?? []) {
		const value = out[key];
		if (Array.isArray(value)) out[key] = value.map((item) => toWorkspacePath(String(item), root));
		else if (value != null && value !== "") out[key] = toWorkspacePath(String(value), root);
	}
	return out;
}

/**
 * Resolve a tool/user path to an absolute filesystem path.
 * Outside-workspace paths are allowed here — the approval gate
 * (`actionTypeForCall` → "outside") is the security boundary.
 */
export function safePath(rel: string): string {
	const root = getWorkspaceRoot();
	const s = normalizePathInput(rel);
	if (!s) throw new Error("empty path");
	const abs = path.isAbsolute(s) ? s : path.join(root, s);
	return path.resolve(abs);
}
