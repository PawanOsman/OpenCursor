/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

/**
 * Per-action-type approval policy for agent tools.
 *
 * Each action type has a mode plus allow/deny pattern lists:
 *   - "allow"  → run without asking
 *   - "ask"    → prompt the user every time
 *   - "review" → auto-review: allow when it looks safe, ask when risky
 *   - "deny"   → always block
 * Deny list beats allow list beats mode.
 */

import * as nodePath from "path";
import { realpathSync } from "fs";
import { planRelativePath } from "../shared/planPath";
import { normalizePathInput, toWorkspacePath } from "../context/workspaceUtils";

export type ApprovalMode = "allow" | "ask" | "review" | "deny";

export interface ApprovalRule {
	mode: ApprovalMode;
	/** Patterns that always allow (command prefix/wildcard, or path glob). */
	allowlist: string[];
	/** Patterns that always deny. */
	denylist: string[];
}

export type ApprovalActionType = "shell" | "edits" | "delete" | "mcp" | "web" | "outside";

export type ApprovalPolicy = Record<ApprovalActionType, ApprovalRule>;

const rule = (mode: ApprovalMode): ApprovalRule => ({ mode, allowlist: [], denylist: [] });

/** Safe defaults: everything prompts until the user loosens it. */
export const DEFAULT_APPROVAL: ApprovalPolicy = {
	shell: rule("ask"),
	edits: rule("ask"),
	delete: rule("ask"),
	mcp: rule("ask"),
	web: rule("ask"),
	outside: rule("ask"),
};

/** Map a tool name to its approval action type (undefined = ungated). */
export function actionTypeFor(toolName: string): ApprovalActionType | undefined {
	if (toolName === "Shell" || toolName === "RunChecks" || toolName === "WriteStdin") return "shell";
	if (toolName === "Delete") return "delete";
	if (toolName === "StrReplace" || toolName === "Write" || toolName === "EditNotebook" || toolName === "WritePlan") return "edits";
	if (toolName === "WebSearch" || toolName === "WebFetch" || toolName.startsWith("Browser")) return "web";
	if (toolName === "CallMcpTool" || toolName === "FetchMcpResource" || toolName.startsWith("mcp__")) return "mcp";
	return undefined;
}

/** Path-bearing inputs by tool. Every filesystem traversal must use this map. */
const PATH_INPUTS: Record<string, string[]> = {
	Read: ["path"],
	ListDir: ["path"],
	Glob: ["target_directory"],
	Grep: ["path"],
	SemanticSearch: ["target_directories"],
	StrReplace: ["path"],
	Write: ["path"],
	Delete: ["path"],
	EditNotebook: ["target_notebook"],
	Shell: ["working_directory"],
	RunChecks: ["working_directory"],
	GoToDefinition: ["path"],
	FindReferences: ["path"],
	RenamePreview: ["path"],
	FetchMcpResource: ["downloadPath"],
	ReadLints: ["paths"],
	Rg: ["working_directory"],
};

// ripgrep flags whose value is the next argv entry (exact spellings only:
// misclassifying a boolean flag here would hide the following path).
const RG_VALUE_SHORT = new Set(["A", "B", "C", "d", "E", "e", "f", "g", "j", "M", "m", "r", "T", "t"]);
const RG_VALUE_LONG = new Set(["--after-context", "--before-context", "--context", "--regexp", "--file", "--glob", "--iglob", "--threads", "--max-count", "--max-columns", "--max-depth", "--max-filesize", "--type", "--type-not", "--type-add", "--type-clear", "--encoding", "--ignore-file", "--path-separator", "--colors", "--color", "--sort", "--sortr", "--context-separator", "--field-context-separator", "--field-match-separator", "--dfa-size-limit", "--regex-size-limit", "--engine", "--replace", "--pre", "--pre-glob", "--hostname-bin", "--hyperlink-format", "--generate"]);
const RG_FILE_FLAGS = new Set(["--file", "--ignore-file", "f"]);

/** Filesystem operands of an Rg argv: PATH operands plus pattern/ignore files. */
export function rgPathOperands(rawArgs: unknown): string[] {
	const args = Array.isArray(rawArgs) ? rawArgs.map(String) : [];
	if (args[0] === "rg" || /(^|[\\/])rg(\.exe)?$/i.test(args[0] ?? "")) args.shift();
	const positional: string[] = [];
	const files: string[] = [];
	let explicitPattern = false;
	let listFiles = false;
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "--") { positional.push(...args.slice(i + 1)); break; }
		if (a.startsWith("--")) {
			const eq = a.indexOf("=");
			const flag = eq >= 0 ? a.slice(0, eq) : a;
			if (flag === "--files") listFiles = true;
			if (flag === "--regexp" || flag === "--file") explicitPattern = true;
			if (!RG_VALUE_LONG.has(flag)) continue;
			const value = eq >= 0 ? a.slice(eq + 1) : args[++i];
			if (RG_FILE_FLAGS.has(flag) && value != null) files.push(value);
			continue;
		}
		if (a.startsWith("-") && a.length > 1) {
			for (let j = 1; j < a.length; j++) {
				const ch = a[j];
				if (!RG_VALUE_SHORT.has(ch)) continue;
				if (ch === "e" || ch === "f") explicitPattern = true;
				const value = j + 1 < a.length ? a.slice(j + 1) : args[++i];
				if (RG_FILE_FLAGS.has(ch) && value != null) files.push(value);
				break;
			}
			continue;
		}
		positional.push(a);
	}
	return [...files, ...(explicitPattern || listFiles ? positional : positional.slice(1))];
}

/** Resolve existing parents too, so a new file under a symlink is checked correctly. */
export function canonicalPath(input: string): string {
	let current = nodePath.resolve(input);
	const suffix: string[] = [];
	for (;;) {
		try { return nodePath.join(realpathSync(current), ...suffix.reverse()); }
		catch (error: any) {
			if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
			const parent = nodePath.dirname(current);
			if (parent === current) return nodePath.resolve(input);
			suffix.push(nodePath.basename(current));
			current = parent;
		}
	}
}

/** True when a file path lands outside the workspace root. */
export function isOutsideWorkspace(path: string, root: string | undefined): boolean {
	if (!root || !path) return false;
	const candidate = normalizePathInput(path);
	const resolvedRoot = canonicalPath(root);
	const resolvedPath = canonicalPath(nodePath.resolve(root, candidate));
	const relative = nodePath.relative(resolvedRoot, resolvedPath);
	return relative === ".." || relative.startsWith(`..${nodePath.sep}`) || nodePath.isAbsolute(relative);
}

function pathsForCall(toolName: string, input: any, root?: string): string[] {
	if (toolName === "WritePlan") return [nodePath.join(root ?? ".", planRelativePath(input?.title))];
	const paths = (PATH_INPUTS[toolName] ?? []).flatMap((key) => {
		const value = input?.[key];
		return Array.isArray(value) ? value.map(String) : value == null || value === "" ? [] : [String(value)];
	});
	if (toolName === "Rg") {
		// Operands resolve against the search's working directory.
		const cwd = input?.working_directory ? normalizePathInput(String(input.working_directory)) : "";
		for (const operand of rgPathOperands(input?.args)) {
			const p = normalizePathInput(operand);
			paths.push(nodePath.isAbsolute(p) || !cwd ? p : nodePath.join(cwd, p));
		}
	}
	return root ? paths.map((item) => toWorkspacePath(item, root)) : paths;
}

/** Every applicable action and location policy must allow a call. */
export function actionTypesForCall(toolName: string, input: any, root?: string): ApprovalActionType[] {
	if (toolName === "WriteStdin" && !input?.chars) return [];
	const action = actionTypeFor(toolName);
	const types: ApprovalActionType[] = action ? [action] : [];
	if (toolName === "FetchMcpResource" && input?.downloadPath) types.push("edits");
	if (pathsForCall(toolName, input, root).some((path) => isOutsideWorkspace(path, root))) types.push("outside");
	return types;
}

/** Primary UI label. Evaluation always checks all applicable policies. */
export function actionTypeForCall(toolName: string, input: any, root?: string): ApprovalActionType | undefined {
	const types = actionTypesForCall(toolName, input, root);
	return types.includes("outside") ? "outside" : types[0];
}

/** The string a rule's patterns match against, per action type. */
export function subjectFor(type: ApprovalActionType, toolName: string, input: any): string {
	switch (type) {
		case "shell": return String(toolName === "WriteStdin" ? input?.chars ?? "" : input?.command ?? "");
		case "edits":
		case "delete": return toolName === "WritePlan" ? planRelativePath(input?.title) : String(input?.path ?? input?.target_notebook ?? input?.downloadPath ?? "");
		case "outside": return pathsForCall(toolName, input).join(", ");
		case "web": return String(input?.url ?? input?.search_term ?? input?.query ?? "");
		case "mcp": return toolName;
	}
}

/** Windows runs commands through `powershell.exe -Command`; read at call time. */
const isWindowsShell = () => process.platform === "win32";

// Words after which `(`/`{` still opens a group at command position.
const GROUP_PREFIX = /^(?:!|time|then|do|else|elif|if|while|until)$/;

interface ShellSplit { parts: string[]; balanced: boolean }

/**
 * One lexing pass. POSIX: `\` escapes, backtick is substitution. PowerShell:
 * backtick escapes, `\` is literal. `(`/`{` group only at command position or
 * after `$`, `<`, `>` (PowerShell also `@`); inside an argument they're literal.
 */
function splitShell(command: string, ps: boolean): ShellSplit {
	const out: string[] = [];
	const bodies: string[] = [];
	let buf = "";
	let quote: '"' | "'" | "`" | null = null;
	let depth = 0;
	let groupStart = -1;
	let balanced = true;
	const escape = ps ? "`" : "\\";
	const push = () => {
		const s = buf.trim();
		if (s) out.push(s);
		buf = "";
	};
	for (let i = 0; i < command.length; i++) {
		const c = command[i];
		const next = command[i + 1];
		if (c === escape && quote !== "'" && next !== undefined) {
			buf += c + next;
			i++;
			continue;
		}
		if (quote) {
			buf += c;
			if (c === quote) quote = null;
			continue;
		}
		if (c === '"' || c === "'" || (!ps && c === "`")) {
			quote = c;
			buf += c;
			continue;
		}
		if (c === "(" || c === "{") {
			const prev = command[i - 1];
			const lead = buf.trim();
			const commandPos = !lead || GROUP_PREFIX.test(lead.split(/\s+/).pop() ?? "") && /\s$/.test(buf);
			if (depth > 0 || commandPos || prev === "$" || prev === "<" || prev === ">" || (ps && prev === "@")) {
				// Command-position groups run their body: check it as commands too.
				if (depth === 0 && commandPos) groupStart = buf.length + 1;
				depth++;
			}
			buf += c;
			continue;
		}
		if ((c === ")" || c === "}") && depth > 0) {
			if (--depth === 0 && groupStart >= 0) {
				bodies.push(buf.slice(groupStart));
				groupStart = -1;
			}
			buf += c;
			continue;
		}
		if (depth === 0) {
			if (c === "\n" || c === "\r" || c === ";") {
				push();
				continue;
			}
			if ((c === "&" || c === "|") && next === c) {
				push();
				i++;
				continue;
			}
			if (c === "|") {
				push();
				continue;
			}
			if (c === "&" && command[i - 1] !== ">" && next !== ">") {
				push();
				continue;
			}
		}
		buf += c;
	}
	push();
	if (quote || depth > 0) balanced = false;
	// A sub-shell body still has to be checked: unwrap one level and re-split.
	const parts: string[] = [];
	for (const part of out) {
		const m = /^[$@&]?\s*[({]\s*([\s\S]*?)\s*[)}]\s*$/.exec(part);
		if (m && m[1].trim()) {
			const inner = splitShell(m[1], ps);
			parts.push(...inner.parts);
			balanced &&= inner.balanced;
		} else parts.push(part);
	}
	for (const body of bodies) {
		const inner = splitShell(body, ps);
		for (const p of inner.parts) if (!parts.includes(p)) parts.push(p);
		balanced &&= inner.balanced;
	}
	return { parts, balanced };
}

/** Both readings on Windows (PowerShell host, bash in containers); strictest wins. */
function splitAll(command: string): ShellSplit {
	const posix = splitShell(command, false);
	if (!isWindowsShell()) return posix;
	const ps = splitShell(command, true);
	return { parts: [...new Set([...posix.parts, ...ps.parts])], balanced: posix.balanced && ps.balanced };
}

/**
 * Split a shell command line into the individual commands it will run.
 * `git add -A; git commit -m "x"` must be checked as two commands — otherwise a
 * deny rule on `git commit` is bypassed by chaining it behind another command.
 * Quoted sections are ignored so separators inside strings don't split.
 */
export function splitShellCommands(command: string): string[] {
	return splitAll(command).parts;
}

/** False when quotes or groups are left open: the split can't be trusted. */
export function shellCommandBalanced(command: string): boolean {
	return splitAll(command).balanced;
}

/** Inspect visible substitutions without executing source or claiming a shell sandbox. */
function scanSubstitutions(command: string, ps: boolean, depth = 0): { commands: string[]; dynamic: boolean } {
	if (depth > 16) return { commands: [], dynamic: true };
	const commands: string[] = [];
	let dynamic = splitShell(command, ps).parts.some((part) => /^(?:(?:eval|exec|source|\.|(?:ba|z|k|c)?sh|pwsh|powershell|cmd|if|for|while|until|case|select)\s|(?:function\s+)?[\w-]+\s*\(\)\s*\{)/i.test(part));
	// `{rm,-rf,x}` at command position is brace expansion into a command.
	if (!ps && /(?:^|[;&|\n(]\s*)\{[^\s{}]*,/.test(command)) dynamic = true;
	let quote: "'" | '"' | undefined;
	const escape = ps ? "`" : "\\";
	for (let i = 0; i < command.length; i++) {
		const c = command[i];
		if (quote === "'") { if (c === "'") quote = undefined; continue; }
		if (c === escape) { i++; continue; }
		if (c === "'" && !quote) { quote = "'"; continue; }
		if (c === '"') { quote = quote === '"' ? undefined : '"'; continue; }
		const parenthesized = (c === "$" || c === "<" || c === ">" || (ps && c === "@")) && command[i + 1] === "(";
		if (c === "$" || parenthesized || (!ps && c === "`")) dynamic = true;
		if (!parenthesized && (ps || c !== "`")) continue;
		const start = i + (parenthesized ? 2 : 1);
		let balance = 1;
		let innerQuote: "'" | '"' | undefined;
		let end = start;
		for (; end < command.length; end++) {
			const ch = command[end];
			if (ch === escape && innerQuote !== "'") { end++; continue; }
			if (innerQuote) { if (ch === innerQuote) innerQuote = undefined; continue; }
			if (ch === "'" || ch === '"') { innerQuote = ch; continue; }
			if (!parenthesized && ch === "`") break;
			if (parenthesized && ch === "(") balance++;
			if (parenthesized && ch === ")" && --balance === 0) break;
		}
		const body = command.slice(start, end);
		commands.push(...splitShell(body, ps).parts);
		const nested = scanSubstitutions(body, ps, depth + 1);
		commands.push(...nested.commands);
		i = end;
	}
	return { commands, dynamic };
}

function shellSubstitutions(command: string): { commands: string[]; dynamic: boolean } {
	const posix = scanSubstitutions(command, false);
	if (!isWindowsShell()) return posix;
	const ps = scanSubstitutions(command, true);
	return { commands: [...new Set([...posix.commands, ...ps.commands])], dynamic: posix.dynamic || ps.dynamic };
}

/**
 * Unquoted redirection or a raw socket path: a prefix allow rule for the
 * command can't vouch for what gets read or written. fd duplication (`2>&1`)
 * and discards (`>/dev/null`, `$null`, `NUL`) are fine.
 */
export function hasShellRedirect(part: string): boolean {
	if (/\/dev\/(?:tcp|udp)\//i.test(part)) return true;
	let quote: string | undefined;
	for (let i = 0; i < part.length; i++) {
		const c = part[i];
		// No escape handling: `\` is literal in PowerShell, so stay conservative.
		if (quote) { if (c === quote) quote = undefined; continue; }
		if (c === '"' || c === "'") { quote = c; continue; }
		if (c !== ">" && c !== "<") continue;
		let j = i + 1;
		while (part[j] === c) j++;
		if (part[j] === "&") {
			const dup = /^&(?:\d+|-)(?=$|[\s;|&)])/.exec(part.slice(j));
			if (dup) { i = j + dup[0].length - 1; continue; }
			return true;
		}
		const target = /^\s*(\S+)/.exec(part.slice(j))?.[1] ?? "";
		if (c === ">" && /^(?:\/dev\/null|\$null|nul)$/i.test(target)) { i = j; continue; }
		return true;
	}
	return false;
}

const escapeRx = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

/**
 * URL rule: exact origin (scheme+host+port; `*` stays inside the host) plus a
 * path prefix on a `/` boundary, so `https://github.com` never covers
 * `https://github.com.evil.io` or `https://github.com@evil.io`.
 */
function matchWebPattern(p: string, subject: string): boolean {
	let url: URL;
	try { url = new URL(subject); } catch { return false; }
	if (url.username || url.password) return false;
	const m = /^(https?:\/\/[^/?#]*)([\s\S]*)$/i.exec(p);
	if (!m) return false;
	const [, originPart, rest] = m;
	if (originPart.includes("*")) {
		const rx = escapeRx(originPart.toLowerCase()).replace(/\*+/g, "[a-z0-9.:-]*");
		if (!new RegExp(`^${rx}$`).test(url.origin.toLowerCase())) return false;
	} else {
		try { if (new URL(originPart).origin.toLowerCase() !== url.origin.toLowerCase()) return false; }
		catch { return false; }
	}
	const path = url.pathname + url.search + url.hash;
	if (!rest || rest === "/") return true;
	if (rest.includes("*")) return new RegExp(`^${escapeRx(rest).replace(/\*+/g, ".*")}$`, "i").test(path);
	const pl = rest.toLowerCase();
	const sl = path.toLowerCase();
	if (pl.endsWith("/")) return sl.startsWith(pl);
	return sl === pl || sl.startsWith(pl + "/") || sl.startsWith(pl + "?") || sl.startsWith(pl + "#");
}

/**
 * Wildcard pattern match. `prefixOk` distinguishes command-like subjects
 * (shell/mcp/web: `*` = any chars, exact/word-prefix match) from path-like ones
 * (edits/delete: glob semantics with `*` vs `**` + basename fallback).
 * URL patterns use origin + path-boundary rules; MCP needs `*` to go beyond exact.
 */
export function matchPattern(pattern: string, subject: string, prefixOk: boolean, type?: ApprovalActionType): boolean {
	const p = pattern.trim();
	if (!p) return false;
	if (prefixOk && type !== "mcp" && type !== "shell" && /^https?:\/\//i.test(p)) return matchWebPattern(p, subject.trim());
	const s = subject.replace(/\\/g, "/");
	if (p.includes("*")) {
		const esc = escapeRx(p);
		if (prefixOk) {
			// Command-like: `*` crosses everything (slashes included).
			const re = new RegExp(`^(?:${esc.replace(/\*+/g, ".*")})$`, "i");
			return re.test(s);
		}
		// Path-like: `**` crosses dirs, `*` stays within a segment.
		const rx = esc.replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*");
		// Also try matching the basename so "*.md" works without "**/".
		const base = s.split("/").pop() ?? s;
		const re = new RegExp(`^(?:${rx})$`, "i");
		if (re.test(s) || re.test(base)) return true;
		// `dir/**` should also allow the directory itself (ListDir on that folder).
		if (p.endsWith("/**")) {
			const dir = p.slice(0, -3).replace(/\\/g, "/").toLowerCase();
			const sl = s.toLowerCase();
			if (dir && (sl === dir || sl.startsWith(dir + "/"))) return true;
		}
		return false;
	}
	const pl = p.toLowerCase();
	const sl = s.toLowerCase();
	if (type === "mcp") return sl === pl;
	return prefixOk ? sl === pl || sl.startsWith(pl + " ") || sl.startsWith(pl + "\t") : sl === pl || sl.endsWith("/" + pl);
}

// Risky-looking subjects for "review" mode. ponytail: heuristic regexes; swap for
// an LLM judge (autoJudgeModel) if pattern coverage proves too coarse.
const RISKY_SHELL = /(\brm\s+-\w*[rf]|\brmdir\b|\bdel\s+\/|\bformat\b|\bmkfs|\bdd\s+if=|\bshutdown\b|\breboot\b|\bsudo\b|\bchmod\s+777|\bchown\b|\bgit\s+push\s+--force|\bgit\s+reset\s+--hard|\bgit\s+clean|\bnpm\s+publish|\bcurl[^|]*\|\s*(ba)?sh|\bwget[^|]*\|\s*(ba)?sh|Remove-Item.*-Recurse|Stop-Computer|Restart-Computer|\breg\s+delete|\btaskkill)/i;
// HTTP clients sending local data out (curl/wget flags are case-sensitive).
const RISKY_UPLOAD = /\bcurl\b[^|;&\n]*\s(?:-[a-zA-Z]*[dFT]|--data[\w-]*|--form[\w-]*|--upload-file|--json)|\bwget\b[^|;&\n]*\s--(?:post|body)-(?:data|file)\b/;
const RISKY_PS_UPLOAD = /\b(?:Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b[^|;&\n]*\s-(?:Body|InFile)\b/i;
const RISKY_PATH = /(^|[\\/])(\.env[^\\/]*|.*\.(pem|key|pfx|p12)|id_rsa[^\\/]*|credentials[^\\/]*|secrets?[^\\/]*|\.git[\\/])$/i;

let mcpReadOnly: ((toolName: string) => boolean) | undefined;
/** Lets the MCP layer report `readOnlyHint` tools for review mode. */
export function setMcpReadOnlyResolver(resolver: ((toolName: string) => boolean) | undefined): void {
	mcpReadOnly = resolver;
}

function looksRisky(type: ApprovalActionType, subject: string): boolean {
	if (type === "shell") return RISKY_SHELL.test(subject) || RISKY_UPLOAD.test(subject) || RISKY_PS_UPLOAD.test(subject);
	if (type === "edits" || type === "delete") return type === "delete" || RISKY_PATH.test(subject);
	if (type === "outside") return true; // outside-workspace access is always worth asking about in review mode
	if (type === "web") {
		// Query/fragment/userinfo can carry data out; plain page reads are fine.
		try { const u = new URL(subject); return !!u.search || u.hash.length > 1 || !!u.username || !!u.password; }
		catch { return false; }
	}
	// MCP tools can do anything unless the server marks them read-only.
	if (subject === "FetchMcpResource") return false;
	try { return !mcpReadOnly?.(subject); } catch { return true; }
}

export type ApprovalDecision = "allow" | "ask" | "deny";

/**
 * Decide one subject against a rule. `canonical` (edits/delete) is the
 * symlink-resolved path: allow rules see only it, deny rules see both.
 */
function decideSubject(r: ApprovalRule, type: ApprovalActionType, subject: string, prefixOk: boolean, canonical?: string): ApprovalDecision {
	const matcher = (value: string) => (pattern: string) => {
		if (type !== "shell" || pattern.includes("*")) return matchPattern(pattern, value, prefixOk, type);
		const prefix = pattern.trim().toLowerCase();
		const v = value.trim().toLowerCase();
		return !!prefix && (v === prefix || v.startsWith(prefix + " ") || v.startsWith(prefix + "\t"));
	};
	if ((r.denylist ?? []).some((p) => matcher(subject)(p) || (canonical !== undefined && matcher(canonical)(p)))) return "deny";
	// A command prefix can't vouch for where a redirection reads or writes.
	if ((r.allowlist ?? []).some(matcher(canonical ?? subject)) && !(type === "shell" && hasShellRedirect(subject))) return "allow";

	const mode: ApprovalMode = r.mode ?? "ask";
	if (mode === "allow") return "allow";
	if (mode === "deny") return "deny";
	if (mode === "review") return looksRisky(type, subject) || (canonical !== undefined && looksRisky(type, canonical)) ? "ask" : "allow";
	return "ask";
}

/** Workspace-relative symlink-resolved path (absolute when it escapes the root). */
function canonicalSubject(subject: string, root: string): string {
	if (!subject) return subject;
	try {
		const canonRoot = canonicalPath(root);
		const canon = canonicalPath(nodePath.resolve(root, normalizePathInput(subject)));
		const rel = nodePath.relative(canonRoot, canon);
		if (rel === "") return ".";
		return rel === ".." || rel.startsWith(`..${nodePath.sep}`) || nodePath.isAbsolute(rel) ? canon : rel;
	} catch {
		return nodePath.resolve(root, subject);
	}
}

/**
 * Every subject a call must clear. A shell command line is checked per chained
 * command so a denied command can't ride along behind an allowed one.
 */
export function subjectsFor(type: ApprovalActionType, toolName: string, input: any): string[] {
	const subject = subjectFor(type, toolName, input);
	if (type !== "shell") return [subject];
	const parts = splitShellCommands(subject);
	return [...(parts.length ? parts : [subject]), ...shellSubstitutions(subject).commands];
}

function decideAll(r: ApprovalRule, type: ApprovalActionType, toolName: string, input: any, root: string | undefined): Array<{ subject: string; decision: ApprovalDecision }> {
	const prefixOk = type === "shell" || type === "mcp" || type === "web";
	const canonicalize = (type === "edits" || type === "delete") && !!root;
	return subjectsFor(type, toolName, input).map((subject) => ({
		subject,
		decision: decideSubject(r, type, subject, prefixOk, canonicalize ? canonicalSubject(subject, root!) : undefined),
	}));
}

/**
 * Evaluate the policy for a tool call: deny list > allow list > mode.
 * The strictest decision across all of the call's subjects wins.
 */
export function evaluateApproval(policy: ApprovalPolicy, toolName: string, input: any, workspaceRoot?: string): ApprovalDecision {
	let decision: ApprovalDecision = "allow";
	for (const type of actionTypesForCall(toolName, input, workspaceRoot)) {
		const r = policy[type] ?? DEFAULT_APPROVAL[type];
		for (const { decision: d } of decideAll(r, type, toolName, input, workspaceRoot)) {
			if (d === "deny") return "deny";
			if (d === "ask") decision = "ask";
		}
		if (type !== "shell") continue;
		const line = subjectFor(type, toolName, input);
		// Unbalanced quotes/groups: the split above can't be trusted, so never auto-allow.
		if (!shellCommandBalanced(line)) {
			if (r.mode === "deny") return "deny";
			decision = "ask";
		}
		// Literal prefix rules cannot reliably authorize expanded shell programs.
		// Ask/review/deny stay conservative when expansion prevents evaluation.
		// Allow stays silent after the explicit deny checks above; unrelated deny
		// rules must not turn ordinary variable references into approval prompts.
		if (r.mode !== "allow" && shellSubstitutions(line).dynamic) {
			if (r.mode === "deny") return "deny";
			decision = "ask";
		}
	}
	return decision;
}

/** The subject that triggered any denial. */
export function deniedSubject(policy: ApprovalPolicy, toolName: string, input: any, workspaceRoot?: string): string | undefined {
	for (const type of actionTypesForCall(toolName, input, workspaceRoot)) {
		const r = policy[type] ?? DEFAULT_APPROVAL[type];
		const hit = decideAll(r, type, toolName, input, workspaceRoot).find((s) => s.decision === "deny");
		if (hit) return hit.subject;
	}
	return undefined;
}
