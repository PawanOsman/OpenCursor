/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { spawn } from "child_process";
import { getWorkspaceRoot } from "../context/workspaceUtils";
import type { HookDef } from "../stores/featureStore";
import { listExternalHooks, type ExternalHook } from "./externalHooks";
import { killShellProcess, trackShellProcess } from "../agent/tools/shared";
import { currentExecutionProfile, configuredExecutionProfile, spawnExecutionCommand, withExecutionProfile } from "../agent/execution";

/**
 * Trigger table: each unified event maps to the equivalent
 * - cursor: Cursor hooks.json event names
 * - claude: Claude Code settings.json event names, with optional tool for matchers
 * - blocking: "before" events whose hooks can veto the action (exit code 2 or
 *   JSON verdict on stdout: {permission:"deny"} / {decision:"block"} / {continue:false})
 */
const TRIGGERS = {
	preToolUse: { cursor: [], claude: [], blocking: true },
	postToolUse: { cursor: [], claude: [], blocking: false },
	permissionRequest: { cursor: [], claude: ["PermissionRequest"], blocking: true },
	postCompact: { cursor: [], claude: ["PostCompact"], blocking: false },
	subagentStart: { cursor: [], claude: ["SubagentStart"], blocking: false },
	interrupt: { cursor: [], claude: [], blocking: false },
	beforeSubmit: { cursor: ["beforeSubmitPrompt"], claude: ["UserPromptSubmit"], blocking: true },
	beforeShell: { cursor: ["beforeShellExecution"], claude: ["PreToolUse"], claudeTool: "Bash", blocking: true },
	beforeMcp: { cursor: ["beforeMCPExecution"], claude: ["PreToolUse"], blocking: true },
	beforeReadFile: { cursor: ["beforeReadFile"], claude: ["PreToolUse"], claudeTool: "Read", blocking: true },
	beforeEdit: { cursor: [], claude: ["PreToolUse"], blocking: true },
	afterEdit: { cursor: ["afterFileEdit"], claude: ["PostToolUse"], claudeTool: "Edit", blocking: false },
	afterRun: { cursor: ["stop"], claude: ["Stop"], blocking: false },
	notification: { cursor: [], claude: ["Notification"], blocking: false },
	subagentStop: { cursor: [], claude: ["SubagentStop"], blocking: false },
	preCompact: { cursor: [], claude: ["PreCompact"], blocking: false },
	sessionStart: { cursor: [], claude: ["SessionStart"], blocking: false },
	sessionEnd: { cursor: [], claude: ["SessionEnd"], blocking: false },
} as const;

export type TriggerEvent = keyof typeof TRIGGERS;

/** True when a Claude matcher (regex/pipe list, empty/* = all) matches the tool name. */
function matcherHits(matcher: string | undefined, tool: string | undefined): boolean {
	if (!matcher || matcher === "*") return true;
	if (!tool) return false;
	try {
		return new RegExp(`^(${matcher})$`, "i").test(tool);
	} catch {
		return matcher.toLowerCase() === tool.toLowerCase();
	}
}

/** External (Cursor/Claude file-based) hooks that should fire for a trigger. */
function externalFor(event: TriggerEvent, tool?: string): ExternalHook[] {
	const t = TRIGGERS[event];
	const claudeTool = tool ?? ("claudeTool" in t ? t.claudeTool : undefined);
	try {
		return listExternalHooks().filter((h) => {
			if (h.source.startsWith("cursor")) return (t.cursor as readonly string[]).includes(h.event);
			return (t.claude as readonly string[]).includes(h.event) && matcherHits(h.matcher, claudeTool);
		});
	} catch {
		return [];
	}
}

/** Result of one hook process: exit code + captured stdout. */
interface HookResult {
	code: number | null;
	stdout: string;
	stderr?: string;
	failure?: string;
}

const HOOK_TIMEOUT_MS = 30_000;

/** Run one hook command with a JSON payload on stdin; resolves with exit code + stdout. */
function runHook(command: string, root: string | undefined, env: NodeJS.ProcessEnv, stdinPayload: object, signal?: AbortSignal): Promise<HookResult> {
	return new Promise((resolve) => {
		if (signal?.aborted) { resolve({ code: null, stdout: "", failure: "hook cancelled" }); return; }
		const windows = process.platform === "win32";
		const shell = windows ? "powershell.exe" : "bash";
		// PowerShell -Command maps native failure to 1, which loses the hook
		// protocol's exit-2 denial. Preserve it only when the final command failed;
		// a later successful PowerShell command keeps its ordinary success result.
		const script = `$global:LASTEXITCODE = 0\n${command}\n$ocursorHookSucceeded = $?\nif ($ocursorHookSucceeded) { exit 0 }\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\nexit 1`;
		const args = windows ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script] : ["--noprofile", "--norc", "-c", command];
		try {
			// File-based hooks must obey the same execution boundary as tools.
			// beforeSubmit runs before a run scope exists, so honor host settings too.
			const profile = currentExecutionProfile().kind === "container" ? currentExecutionProfile() : configuredExecutionProfile();
			const workspace = root ?? getWorkspaceRoot() ?? process.cwd();
			const c = withExecutionProfile(profile, workspace, () => spawnExecutionCommand(command, workspace,
				() => spawn(shell, args, { cwd: root, env, windowsHide: true, detached: !windows, stdio: ["pipe", "pipe", "pipe"] })));
			trackShellProcess(c);
			let stdout = "";
			let stderr = "";
			let settled = false;
			let stopping = false;
			const finish = (result: HookResult) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
				resolve(result);
			};
			const stop = (failure: string) => {
				if (stopping || settled) return;
				stopping = true;
				void killShellProcess(c).then(closed => finish({ code: null, stdout, stderr,
					failure: closed ? failure : `${failure}; process shutdown remains unconfirmed` }));
			};
			const onAbort = () => stop("hook cancelled");
			const timer = setTimeout(() => stop("hook timed out after 30 seconds"), HOOK_TIMEOUT_MS);
			signal?.addEventListener("abort", onAbort, { once: true });
			c.stdout?.on("data", (d) => {
				stdout += String(d);
				if (stdout.length > 65_536) stop("hook output exceeded 64 KiB");
			});
			c.stderr?.on("data", (d) => { stderr = (stderr + String(d)).slice(-65_536); });
			// Hooks may exit without reading stdin; their exit status still decides
			// the verdict. EPIPE must not crash the extension host.
			c.stdin?.on("error", () => {});
			c.stdin?.write(JSON.stringify(stdinPayload));
			c.stdin?.end();
			c.on("close", (code) => { if (!stopping) finish({ code, stdout, stderr }); });
			c.on("error", (error) => finish({ code: null, stdout, stderr, failure: `hook failed: ${error.message}` }));
		} catch (error) {
			resolve({ code: null, stdout: "", failure: `hook failed: ${error instanceof Error ? error.message : String(error)}` });
		}
	});
}

/**
 * Interpret a hook's result as a veto (Cursor/Claude native protocols):
 * - exit code 2 → block
 * - stdout JSON: {permission:"deny"}, {decision:"block"}, {continue:false} → block
 * Returns a reason string when blocked, undefined otherwise.
 */
function verdictOf(r: HookResult): string | undefined {
	if (r.failure) return r.failure;
	if (r.code === 2) return r.stderr?.trim() || r.stdout.trim() || "blocked by hook (exit code 2)";
	try {
		const j = JSON.parse(r.stdout.trim());
		if (j && typeof j === "object") {
			const native = j.hookSpecificOutput;
			if (native?.permissionDecision === "deny" || native?.decision?.behavior === "deny") {
				return native.permissionDecisionReason || native.decision?.message || j.reason || "blocked by hook";
			}
			// A native request for confirmation must never silently allow execution.
			if (native?.permissionDecision === "ask" || native?.permissionDecision === "defer") {
				return native.permissionDecisionReason || "hook requires user confirmation before this action";
			}
			if (j.permission === "deny" || j.decision === "block" || j.continue === false) {
				return j.userMessage || j.agentMessage || j.reason || j.stopReason || "blocked by hook";
			}
		}
	} catch {
		// non-JSON stdout → not a verdict
	}
	return undefined;
}

/** Build the native stdin JSON payload for a Cursor or Claude Code hook. */
function nativePayload(h: ExternalHook, root: string | undefined, context: Record<string, string>, tool?: string): object {
	let toolInput: object | undefined;
	if (context.tool_input) {
		try {
			const parsed = JSON.parse(context.tool_input);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) toolInput = parsed;
		} catch { /* malformed optional context does not replace the native input */ }
	}
	if (h.source.startsWith("cursor")) {
		// Cursor hooks.json protocol: snake_case fields + event-specific keys.
		const base: Record<string, unknown> = {
			hook_event_name: h.event,
			workspace_roots: root ? [root] : [],
		};
		if (context.prompt !== undefined) base.prompt = context.prompt;
		if (context.command !== undefined) base.command = context.command;
		if (context.path !== undefined) base.file_path = context.path;
		if (tool) base.tool_name = tool;
		if (toolInput) base.tool_input = toolInput;
		return base;
	}
	// Claude Code settings.json protocol.
	const base: Record<string, unknown> = {
		hook_event_name: h.event,
		cwd: root ?? "",
	};
	if (context.prompt !== undefined) base.prompt = context.prompt;
	if (h.event === "PreToolUse" || h.event === "PostToolUse") {
		base.tool_name = tool ?? (context.command !== undefined ? "Bash" : context.path !== undefined ? "Edit" : "");
		base.tool_input = toolInput ?? (context.command !== undefined ? { command: context.command } : context.path !== undefined ? { file_path: context.path } : {});
	}
	if (context.message !== undefined) base.message = context.message;
	return base;
}

/** Stdin payload for our own hooks: unified event name + full context. */
function ownPayload(event: TriggerEvent, root: string | undefined, context: Record<string, string>, tool?: string): object {
	return { hook_event_name: event, workspace_root: root ?? "", tool_name: tool, ...context };
}

/** All hook launches for a trigger: [command, payload] pairs (our hooks + external). */
function launchesFor(hooks: HookDef[], event: TriggerEvent, root: string | undefined, context: Record<string, string>, tool?: string): { command: string; payload: object }[] {
	const out: { command: string; payload: object }[] = [];
	for (const h of hooks) {
		if (h.enabled && h.event === event) out.push({ command: h.command, payload: ownPayload(event, root, context, tool) });
	}
	for (const h of externalFor(event, tool)) {
		const trigger = TRIGGERS[event];
		const nativeTool = tool ?? ("claudeTool" in trigger ? trigger.claudeTool : undefined);
		out.push({ command: h.command, payload: nativePayload(h, root, context, nativeTool) });
	}
	return out;
}

function envFor(context: Record<string, string>): NodeJS.ProcessEnv {
	return { ...process.env, ...Object.fromEntries(Object.entries(context).map(([k, v]) => [`OPENCURSOR_${k.toUpperCase()}`, v])) };
}

/**
 * Fire-and-forget run of all enabled hooks (internal + Cursor/Claude external) for a trigger.
 * `tool` (when given) is used for Claude PreToolUse/PostToolUse matchers (e.g. MCP tool name).
 */
export function runHooks(hooks: HookDef[], event: TriggerEvent, context: Record<string, string> = {}, tool?: string): void {
	const root = getWorkspaceRoot();
	const env = envFor(context);
	for (const l of launchesFor(hooks, event, root, context, tool)) {
		void runHook(l.command, root, env, l.payload);
	}
}

/**
 * Blocking variant for "before" events: runs all hooks, waits, and returns a
 * block reason if any hook vetoed (exit code 2 or JSON verdict) — undefined otherwise.
 */
export async function runBlockingHooks(hooks: HookDef[], event: TriggerEvent, context: Record<string, string> = {}, tool?: string, signal?: AbortSignal): Promise<string | undefined> {
	if (signal?.aborted) return "hook cancelled";
	if (!TRIGGERS[event].blocking) {
		runHooks(hooks, event, context, tool);
		return undefined;
	}
	const root = getWorkspaceRoot();
	const env = envFor(context);
	const results = await Promise.all(launchesFor(hooks, event, root, context, tool).map((l) => runHook(l.command, root, env, l.payload, signal)));
	for (const r of results) {
		const reason = verdictOf(r);
		if (reason) return reason;
	}
	return undefined;
}
