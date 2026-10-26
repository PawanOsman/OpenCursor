/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { ToolOutcome } from "./toolOutcome";
import type { TodoItem } from "./tools";

/**
 * Durable run memory that lives outside the message history.
 *
 * History may be summarized or trimmed at the budget ceiling; this ledger keeps
 * action and file totals. Its model-facing view is a bounded recent window with
 * current work, so a long run does not resend an ever-growing activity list.
 */

/** One recorded action: the shape of a tool card, minus its payload. */
interface Entry {
	name: string;
	target: string;
	ok: boolean;
	state?: ToolOutcome["status"];
	note: string;
}

/** Path-ish argument keys, in the order they identify a tool's target. */
const TARGET_KEYS = ["path", "target_notebook", "target_directory", "file", "url", "glob_pattern", "pattern", "query", "command", "description"];

function targetOf(input: unknown, max = 90): string {
	if (!input || typeof input !== "object") return "";
	const o = input as Record<string, unknown>;
	for (const k of TARGET_KEYS) {
		const v = o[k];
		if (typeof v === "string" && v.trim()) return v.trim().replace(/\s+/g, " ").slice(0, max);
	}
	return "";
}

function concise(value: string, max: number): string {
	const text = value.trim().replace(/\s+/g, " ");
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Keep the filename visible when a long directory path must be abbreviated. */
function concisePath(value: string, max = 90): string {
	if (value.length <= max) return value;
	const head = Math.floor((max - 1) / 2);
	return `${value.slice(0, head)}…${value.slice(-(max - head - 1))}`;
}

function firstLine(s: string, max: number): string {
	const line = (s || "").split(/\r?\n/).find((l) => l.trim()) ?? "";
	return line.trim().slice(0, max);
}

function countLines(s: unknown): number {
	return typeof s === "string" && s ? s.split(/\r?\n/).length : 0;
}

/** Short outcome note per tool — the useful part of a card, never the payload. */
function noteFor(name: string, input: unknown, ok: boolean, output: string): string {
	if (!ok) return `failed: ${firstLine(output.replace(/^error:\s*/i, ""), 120)}`;
	const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
	switch (name) {
		case "Write":
			return `wrote ${countLines(o.contents)} lines`;
		case "StrReplace": {
			const before = countLines(o.old_string);
			const after = countLines(o.new_string);
			const plus = Math.max(0, after - before);
			const minus = Math.max(0, before - after);
			return plus || minus ? `edited +${plus} -${minus}` : "edited";
		}
		case "EditNotebook":
			return o.is_new_cell ? `added cell ${String(o.cell_idx ?? "")}` : `edited cell ${String(o.cell_idx ?? "")}`;
		case "Delete":
			return "deleted";
		case "Read": {
			const m = /^\s*\.{3}\s*(\d+)/.exec(output);
			return m ? `read (${m[1]} lines skipped)` : "read";
		}
		case "Shell":
		case "AwaitShell":
			return firstLine(output, 120) || "ran";
		case "WritePlan":
			return `plan written${o.title ? `: ${String(o.title).slice(0, 60)}` : ""}`;
		case "Task":
			return `subagent ${String(o.subagent_type || "generalPurpose")} → ${firstLine(output, 90)}`;
		case "TodoWrite":
			return "todos updated";
		case "SwitchMode":
			return `mode → ${String(o.target_mode_id ?? "")}`;
		case "AskQuestion":
			return "asked the user";
		default: {
			const n = output.length;
			return n > 400 ? `ok (${n} chars)` : firstLine(output, 90) || "ok";
		}
	}
}

/** Tools whose result adds nothing once recorded (pure navigation noise). */
const SKIP = new Set(["TodoRead", "ReadContext", "ListMcpResources"]);
const MAX_ACTIONS = 12;
const MAX_FILES = 10;
const MAX_TODOS = 5;

export class ActivityLedger {
	/** Only the most recent entries can ever be rendered; older ones are counted. */
	private readonly entries: Entry[] = [];
	private total = 0;
	/** path -> cumulative +added/-removed, so the file ledger stays one line each. */
	private readonly files = new Map<string, { plus: number; minus: number; deleted: boolean }>();
	private plan = "";

	/** Record a settled tool call. Consecutive identical actions collapse. */
	record(name: string, input: unknown, status: "completed" | "error", output: string, outcome?: ToolOutcome): void {
		if (SKIP.has(name)) return;
		const ok = status === "completed" && (!outcome || outcome.status === "completed");
		const target = targetOf(input, Infinity);
		const entry: Entry = { name, target, ok, state: outcome?.status, note: outcome ? `${outcome.status}${outcome.processStatus && outcome.processStatus !== outcome.status ? ` (process ${outcome.processStatus})` : ""}${outcome.exitCode !== undefined ? ` (exit ${outcome.exitCode})` : ""}${outcome.outputRef ? `; ReadContext ${outcome.outputRef.id}` : ""}` : noteFor(name, input, ok, output || "") };
		const last = this.entries[this.entries.length - 1];
		if (!last || last.name !== entry.name || last.target !== entry.target || last.note !== entry.note || last.ok !== entry.ok) {
			this.entries.push(entry);
			this.total++;
			if (this.entries.length > MAX_ACTIONS) this.entries.shift();
		}

		if (ok && (name === "Write" || name === "StrReplace" || name === "EditNotebook" || name === "Delete")) {
			// Full paths are identities; truncating them here merges different files
			// in deep directories. Only the rendered display is abbreviated.
			const path = target;
			if (path) {
				const cur = this.files.get(path) ?? { plus: 0, minus: 0, deleted: false };
				if (name === "Delete") cur.deleted = true;
				else {
					cur.deleted = false;
					const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
					const before = countLines(o.old_string);
					const after = name === "Write" ? countLines(o.contents) : countLines(o.new_string);
					cur.plus += Math.max(0, after - before);
					cur.minus += Math.max(0, before - after);
				}
				// Map insertion order now tracks the most recent successful change.
				this.files.delete(path);
				this.files.set(path, cur);
			}
		}
		if (ok && name === "WritePlan") {
			const m = /\.plans\/[^\s`"']+/.exec(output);
			if (m) this.plan = m[0];
		}
	}

	get isEmpty(): boolean {
		return this.entries.length === 0 && this.files.size === 0;
	}

	/**
	 * Render the durable state block: the request, the todo list, the files
	 * touched, and the action log (most recent last, older entries counted).
	 */
	render(opts: { request: string; todos: TodoItem[]; maxActions?: number }): string {
		const maxActions = typeof opts.maxActions === "number" && Number.isFinite(opts.maxActions)
			? Math.max(0, Math.min(MAX_ACTIONS, Math.floor(opts.maxActions)))
			: MAX_ACTIONS;
		const parts: string[] = [];

		const request = concise(opts.request, 400);
		if (request) parts.push(`Original request: ${request}`);

		if (opts.todos.length) {
			const counts = { completed: 0, in_progress: 0, pending: 0, cancelled: 0 };
			for (const t of opts.todos) counts[t.status]++;
			const open = counts.pending + counts.in_progress;
			const parts_list: string[] = [];
			if (counts.completed) parts_list.push(`${counts.completed} done`);
			if (open) parts_list.push(`${open} open`);
			if (counts.cancelled) parts_list.push(`${counts.cancelled} cancelled`);
			parts.push(`Todos: ${opts.todos.length} total (${parts_list.join(", ")})`);
			const active = [
				...opts.todos.filter((todo) => todo.status === "in_progress"),
				...opts.todos.filter((todo) => todo.status === "pending"),
			].slice(0, MAX_TODOS);
			if (active.length) {
				const lines = active.map((todo) => `  [${todo.status}] ${concise(todo.id, 40)}: ${concise(todo.content, 96)}`);
				const omitted = open - active.length;
				parts.push(`Active todos${omitted ? ` (${omitted} more omitted; use TodoRead for the full list)` : ""}:\n${lines.join("\n")}`);
			}
		}

		if (this.files.size) {
			const shown = [...this.files.entries()].slice(-MAX_FILES);
			const hidden = this.files.size - shown.length;
			const lines = shown.map(([path, d]) =>
				`  ${concisePath(path)}${d.deleted ? " (deleted)" : ` +${d.plus} -${d.minus}`}`,
			);
			parts.push(`Files changed (${this.files.size} total${hidden ? `, ${hidden} older omitted` : ""}):\n${lines.join("\n")}`);
		}

		if (this.plan) parts.push(`Plan file: ${concisePath(this.plan, 160)}`);

		if (this.entries.length) {
			const shown = maxActions ? this.entries.slice(-maxActions) : [];
			const hidden = this.total - shown.length;
			const lines = shown.map((e) => `  ${e.state === "running" ? "…" : e.ok ? "✓" : "✗"} ${concise(e.name, 32)}${e.target ? ` ${concisePath(e.target, 72)}` : ""} — ${concise(e.note, 80)}`);
			parts.push(
				`Actions so far (${this.total} total${hidden ? `, ${hidden} older omitted` : ""}):\n${lines.join("\n")}`,
			);
		}

		if (!parts.length) return "";
		return `<task_state>\nRecent run state and current work; older details are omitted. Use ReadContext with an archive id from the conversation to retrieve saved payloads.\n\n${parts.join("\n\n")}\n</task_state>`;
	}
}
