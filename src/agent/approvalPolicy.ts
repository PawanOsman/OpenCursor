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
};

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
	return (PATH_INPUTS[toolName] ?? []).flatMap((key) => {
		const value = input?.[key];
		const paths = Array.isArray(value) ? value.map(String) : value == null ? [] : [String(value)];
		return root ? paths.map((item) => toWorkspacePath(item, root)) : paths;
	});
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

/**
 * Split a shell command line into the individual commands it will run.
 * `git add -A; git commit -m "x"` must be checked as two commands — otherwise a
 * deny rule on `git commit` is bypassed by chaining it behind another command.
 * Quoted sections are ignored so separators inside strings don't split.
 */
export function splitShellCommands(command: string): string[] {
	const out: string[] = [];
	let buf = "";
	let quote: '"' | "'" | "`" | null = null;
	let depth = 0;
	const push = () => {
		const s = buf.trim();
		if (s) out.push(s);
		buf = "";
	};
	for (let i = 0; i < command.length; i++) {
		const c = command[i];
		const next = command[i + 1];
		if (c === "\\" && quote !== "'" && next) {
			buf += c + next;
			i++;
			continue;
		}
		if (quote) {
			buf += c;
			if (c === quote && command[i - 1] !== "\\") quote = null;
			continue;
		}
		if (c === '"' || c === "'" || c === "`") {
			quote = c;
			buf += c;
			continue;
		}
		// Sub-shells / command substitution: `$(...)`, `(...)`, `{...}`.
		if (c === "(" || c === "{") {
			depth++;
			buf += c;
			continue;
		}
		if (c === ")" || c === "}") {
			depth = Math.max(0, depth - 1);
			buf += c;
			continue;
		}
		if (depth === 0) {
			if (c === "\n" || c === ";") {
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
	// A sub-shell body still has to be checked: unwrap one level and re-split.
	return out.flatMap((part) => {
		const m = /^[$@&]?\s*[({]\s*([\s\S]*?)\s*[)}]\s*$/.exec(part);
		return m && m[1].trim() ? splitShellCommands(m[1]) : [part];
	});
}

/** Inspect visible substitutions without executing source or claiming a shell sandbox. */
function shellSubstitutions(command: string, depth = 0): { commands: string[]; dynamic: boolean } {
	if (depth > 16) return { commands: [], dynamic: true };
	const commands: string[] = [];
	let dynamic = splitShellCommands(command).some((part) => /^(?:(?:eval|exec|source|\.|(?:ba|z|k|c)?sh|pwsh|powershell|cmd|if|for|while|until|case|select)\s|(?:function\s+)?[\w-]+\s*\(\)\s*\{)/i.test(part));
	let quote: "'" | '"' | undefined;
	for (let i = 0; i < command.length; i++) {
		const c = command[i];
		if (quote === "'") { if (c === "'") quote = undefined; continue; }
		if (c === "\\") { i++; continue; }
		if (c === "'" && !quote) { quote = "'"; continue; }
		if (c === '"') { quote = quote === '"' ? undefined : '"'; continue; }
		const parenthesized = (c === "$" || c === "<" || c === ">") && command[i + 1] === "(";
		if (c === "$" || parenthesized || c === "`") dynamic = true;
		if (!parenthesized && c !== "`") continue;
		const start = i + (parenthesized ? 2 : 1);
		let balance = 1;
		let innerQuote: "'" | '"' | undefined;
		let end = start;
		for (; end < command.length; end++) {
			const ch = command[end];
			if (ch === "\\" && innerQuote !== "'") { end++; continue; }
			if (innerQuote) { if (ch === innerQuote) innerQuote = undefined; continue; }
			if (ch === "'" || ch === '"') { innerQuote = ch; continue; }
			if (!parenthesized && ch === "`") break;
			if (parenthesized && ch === "(") balance++;
			if (parenthesized && ch === ")" && --balance === 0) break;
		}
		const body = command.slice(start, end);
		commands.push(...splitShellCommands(body));
		const nested = shellSubstitutions(body, depth + 1);
		commands.push(...nested.commands);
		i = end;
	}
	return { commands, dynamic };
}

/**
 * Wildcard pattern match. `prefixOk` distinguishes command-like subjects
 * (shell/mcp/web: `*` = any chars, exact/prefix match) from path-like ones
 * (edits/delete: glob semantics with `*` vs `**` + basename fallback).
 */
export function matchPattern(pattern: string, subject: string, prefixOk: boolean): boolean {
	const p = pattern.trim();
	if (!p) return false;
	const s = subject.replace(/\\/g, "/");
	if (p.includes("*")) {
		const esc = p.replace(/[.+^${}()|[\]\\]/g, "\\$&");
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
			if (dir && (s === dir || s.startsWith(dir + "/"))) return true;
		}
		return false;
	}
	const pl = p.toLowerCase();
	const sl = s.toLowerCase();
	return prefixOk ? sl === pl || sl.startsWith(pl + " ") || sl.startsWith(pl) : sl === pl || sl.endsWith("/" + pl);
}

// Risky-looking subjects for "review" mode. ponytail: heuristic regexes; swap for
// an LLM judge (autoJudgeModel) if pattern coverage proves too coarse.
const RISKY_SHELL = /(\brm\s+-\w*[rf]|\brmdir\b|\bdel\s+\/|\bformat\b|\bmkfs|\bdd\s+if=|\bshutdown\b|\breboot\b|\bsudo\b|\bchmod\s+777|\bchown\b|\bgit\s+push\s+--force|\bgit\s+reset\s+--hard|\bgit\s+clean|\bnpm\s+publish|\bcurl[^|]*\|\s*(ba)?sh|\bwget[^|]*\|\s*(ba)?sh|Remove-Item.*-Recurse|Stop-Computer|Restart-Computer|\breg\s+delete|\btaskkill)/i;
const RISKY_PATH = /(^|[\\/])(\.env[^\\/]*|.*\.(pem|key|pfx|p12)|id_rsa[^\\/]*|credentials[^\\/]*|secrets?[^\\/]*|\.git[\\/])$/i;

function looksRisky(type: ApprovalActionType, subject: string): boolean {
	if (type === "shell") return RISKY_SHELL.test(subject);
	if (type === "edits" || type === "delete") return type === "delete" || RISKY_PATH.test(subject);
	if (type === "outside") return true; // outside-workspace access is always worth asking about in review mode
	return false; // mcp/web reviewed as safe by default
}

export type ApprovalDecision = "allow" | "ask" | "deny";

/** Decide one subject against a rule. */
function decideSubject(r: ApprovalRule, type: ApprovalActionType, subject: string, prefixOk: boolean): ApprovalDecision {
	const matches = (pattern: string) => {
		if (type !== "shell" || pattern.includes("*")) return matchPattern(pattern, subject, prefixOk);
		const prefix = pattern.trim().toLowerCase();
		const value = subject.trim().toLowerCase();
		return !!prefix && (value === prefix || value.startsWith(prefix + " ") || value.startsWith(prefix + "\t"));
	};
	if ((r.denylist ?? []).some(matches)) return "deny";
	if ((r.allowlist ?? []).some(matches)) return "allow";

	const mode: ApprovalMode = r.mode ?? "ask";
	if (mode === "allow") return "allow";
	if (mode === "deny") return "deny";
	if (mode === "review") return looksRisky(type, subject) ? "ask" : "allow";
	return "ask";
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

/**
 * Evaluate the policy for a tool call: deny list > allow list > mode.
 * The strictest decision across all of the call's subjects wins.
 */
export function evaluateApproval(policy: ApprovalPolicy, toolName: string, input: any, workspaceRoot?: string): ApprovalDecision {
	let decision: ApprovalDecision = "allow";
	for (const type of actionTypesForCall(toolName, input, workspaceRoot)) {
		const r = policy[type] ?? DEFAULT_APPROVAL[type];
		const prefixOk = type === "shell" || type === "mcp" || type === "web";
		for (const subject of subjectsFor(type, toolName, input)) {
			const d = decideSubject(r, type, subject, prefixOk);
			if (d === "deny") return "deny";
			if (d === "ask") decision = "ask";
		}
		// Literal prefix rules cannot reliably authorize expanded shell programs.
		// Ask/review/deny stay conservative when expansion prevents evaluation.
		// Allow stays silent after the explicit deny checks above; unrelated deny
		// rules must not turn ordinary variable references into approval prompts.
		if (type === "shell" && r.mode !== "allow" && shellSubstitutions(subjectFor(type, toolName, input)).dynamic) {
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
		const prefixOk = type === "shell" || type === "mcp" || type === "web";
		const subject = subjectsFor(type, toolName, input).find((s) => decideSubject(r, type, s, prefixOk) === "deny");
		if (subject !== undefined) return subject;
	}
	return undefined;
}
