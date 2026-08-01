/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { streamChat, SamplingParams, ModelParams } from "./provider";
import type { OAuthKind } from "./oauth";
import { TOOLS, schemasForMode, toolsForMode, disposeShellSession, EDIT_TOOLS, MULTITASK_TOOLS, toolTimeoutMs, withToolTimeout, type AskQuestionItem, type ToolContext } from "./tools";
import { actionTypeForCall } from "./approvalPolicy";
import { getWorkspaceRoot, normalizeToolPaths } from "../context/workspaceUtils";
import { systemPrompt } from "./prompt";
import { buildMessages, fitStepsToBudget, splitForCompaction, stepsToTranscript, stepsTokens, type CursorContextBlocks } from "./messages";
import { economizeHistory, COMPACT_AT_FILL, COMPACT_SOFT_FILL, COMPACT_KEEP_FRAC, isCompactionBoundary } from "./contextEconomy";
import { buildUserInfoBlock, buildOpenFilesBlock } from "../context/cursorContext";
import { mcpManager } from "../integrations/mcpClient";
import type { AgentEvent, Attachment, Mode, Step, ToolCall, ToolSchema } from "./types";
import type { SubagentDef } from "../stores/featureStore";
import type { RunAgentOptions } from "./loopTypes";
import { buildTeamsBlock, resolveTeamSubagents } from "./teams";
import {
	streamPolicyFor,
	clipArgsText,
	TEXT_INTERVAL_MS,
	THINKING_INTERVAL_MS,
	SUBAGENT_INTERVAL_MS,
} from "../shared/streamPolicy";
import { logError } from "../logging";

// Appended after every live user query in multitask mode so the model never
// forgets it is a COORDINATOR: edit tools are disabled and all work must be
// delegated to parallel background subagents via the Task tool.
const MULTITASK_REMINDER =
	"<reminder>\nYou are in MULTITASK mode: you are a COORDINATOR, not an implementer. " +
	"Do NOT edit files, run terminal commands, or do the work yourself — the edit tools are DISABLED and will refuse. " +
	"Break the request into independent units, then delegate EVERY unit to a background subagent via the Task tool " +
	"(run_in_background=true), launching multiple subagents AT THE SAME TIME in a single turn.\n</reminder>";

// Project-mode counterpart: the model is the lead of the assigned team(s).
const PROJECT_REMINDER =
	"<reminder>\nYou are in PROJECT mode: you are the PROJECT LEAD of the team(s) in <assigned_teams>, not an implementer. " +
	"Do NOT edit files or run terminal commands yourself — those tools are DISABLED and will refuse. " +
	"Plan the project with TodoWrite, then delegate each unit of work to the right team member with the Task tool " +
	'(run_in_background=true, subagent_type set to the member name), launching every independent member AT THE SAME TIME in a single turn.\n</reminder>';

const MAX_STEPS = 50;

/**
 * Batch text/thinking/tool-args deltas so streaming cannot flood the host
 * reducer + webview (main cause of UI freezes that look like "stuck" tools).
 * Terminal events flush pending deltas first to preserve order.
 *
 * Cadence is per-event-class rather than one global interval: assistant text is
 * the primary signal and stays snappy, while reasoning traces, subagent chatter,
 * and tool arguments batch progressively harder. Tool args additionally obey the
 * per-tool policy — most tools only need one early update to title their card,
 * so their arg deltas are dropped instead of rendered frame after frame.
 */
function coalesceEmit(raw: (e: AgentEvent) => void): (e: AgentEvent) => void {
	const pending = new Map<string, AgentEvent>();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let timerDue = 0;
	// Tool name per callId, so arg deltas can be matched to a policy.
	const toolNames = new Map<string, string>();
	// callIds whose "once" preview has already been sent.
	const argsSent = new Set<string>();
	const flush = () => {
		timer = undefined;
		timerDue = 0;
		if (!pending.size) return;
		const batch = [...pending.values()];
		pending.clear();
		for (const e of batch) {
			// A "once" preview counts as spent only when it actually ships, so the
			// single update carries the most complete args seen in the window
			// (not the first 4-character fragment).
			if (e.type === "tool-call-args") argsSent.add(e.callId);
			try { raw(e); } catch { /* ignore */ }
		}
	};
	// Earliest deadline wins: a pending fast event must not be delayed by a
	// slower one already holding the timer.
	const schedule = (delay: number) => {
		const due = Date.now() + delay;
		if (timer) {
			if (due >= timerDue) return;
			clearTimeout(timer);
		}
		timerDue = due;
		timer = setTimeout(flush, delay);
	};
	return (event: AgentEvent) => {
		// Remember the tool name so its arg deltas can be policed below.
		if (event.type === "tool-call-started") toolNames.set(event.callId, event.name);
		if (event.type === "text-delta") {
			const prev = pending.get("text");
			if (prev && prev.type === "text-delta") {
				pending.set("text", { type: "text-delta", text: prev.text + event.text });
			} else {
				pending.set("text", event);
			}
			schedule(TEXT_INTERVAL_MS);
			return;
		}
		if (event.type === "thinking-delta") {
			const prev = pending.get("think");
			if (prev && prev.type === "thinking-delta") {
				pending.set("think", { type: "thinking-delta", text: prev.text + event.text });
			} else {
				pending.set("think", event);
			}
			schedule(THINKING_INTERVAL_MS);
			return;
		}
		if (event.type === "tool-call-args") {
			const policy = streamPolicyFor(toolNames.get(event.callId));
			if (policy.args === "off") return;
			if (policy.args === "once" && argsSent.has(event.callId)) return;
			// Latest full argsText wins (provider sends cumulative chunks).
			pending.set(`args:${event.callId}`, {
				type: "tool-call-args",
				callId: event.callId,
				argsText: clipArgsText(event.argsText, policy.maxChars),
			});
			schedule(policy.intervalMs);
			return;
		}
		if (event.type === "tool-call-progress") {
			// Latest snapshot wins; live shell output can arrive far faster than
			// the UI can paint.
			pending.set(`prog:${event.callId}`, event);
			schedule(150);
			return;
		}
		if (event.type === "subagent-event") {
			const child = event.event;
			// Coalesce nested high-freq child stream events per parent call.
			if (child.type === "text-delta" || child.type === "thinking-delta" || child.type === "tool-call-args") {
				const key =
					child.type === "tool-call-args"
						? `sub:${event.callId}:args:${child.callId}`
						: `sub:${event.callId}:${child.type}`;
				if (child.type === "text-delta" || child.type === "thinking-delta") {
					const prev = pending.get(key);
					if (prev && prev.type === "subagent-event" && prev.event.type === child.type) {
						pending.set(key, {
							type: "subagent-event",
							callId: event.callId,
							event: { type: child.type, text: (prev.event as { text: string }).text + child.text },
						});
					} else {
						pending.set(key, event);
					}
				} else {
					pending.set(key, event);
				}
				schedule(SUBAGENT_INTERVAL_MS);
				return;
			}
		}
		// Ordering: flush coalesced deltas before discrete events.
		if (pending.size) {
			if (timer) { clearTimeout(timer); timer = undefined; timerDue = 0; }
			flush();
		}
		if (event.type === "tool-call-completed") {
			toolNames.delete(event.callId);
			argsSent.delete(event.callId);
		}
		try { raw(event); } catch { /* ignore */ }
	};
}

export async function runAgent(opts: RunAgentOptions): Promise<void> {
	const { apiBaseUrl, apiKey, model, prompt, attachments, history: persistedHistory, maxTokens, maxSteps, autoContinue, contextTokens, sampling, modelParams, anthropic, oauthKind, systemPromptOverride, extraInstructions, enableFileReading, enableTerminalSuggestions, enableWorkspaceContext, approve, isSubagent, customSubagents, teams, activeTeamIds, subagentModel, availableModels, registerSubagentAbort, askUser, onAfterRun, onBeforeShell, onAfterEdit, onHook, signal, emit: rawEmit } = opts;
	// Model history is disposable and may be compacted/pruned. Persisted history
	// remains lossless for chat display/export, including full tool output/thinking.
	const history: Step[] = persistedHistory.map((s) => structuredClone(s));
	const pushHistory = (...steps: Step[]) => {
		history.push(...steps);
		persistedHistory.push(...steps.map((s) => structuredClone(s)));
	};
	const emit = coalesceEmit(rawEmit);
	// Mutable so the SwitchMode tool can change it mid-run.
	let mode = opts.mode;
	// multitask/project are agentic (full tool access); treat them like agent for gating.
	const isAgentic = () => mode === "agent" || mode === "multitask" || mode === "project" || mode === "debug";
	/** Coordinator modes: the model delegates instead of implementing. */
	const isCoordinator = () => mode === "multitask" || mode === "project";
	// In project mode the roster is limited to the members of the assigned team(s).
	const teamRoster =
		opts.mode === "project" && teams?.length && activeTeamIds?.length
			? resolveTeamSubagents(teams, customSubagents ?? [], activeTeamIds)
			: undefined;
	const roster = teamRoster?.length ? teamRoster : customSubagents;
	// In-flight background subagents. The run is not "finished" until these settle,
	// so the chat stays busy (and can't be closed) while they keep working. When they
	// finish, their summaries are fed back into the loop so the model can synthesize.
	const bgSubagents: Promise<{ title: string; text: string }>[] = [];
	// Settled bg results (parallel to bgSubagents), so exit paths can flush them
	// into history without re-awaiting.
	const bgSettled: ({ title: string; text: string } | undefined)[] = [];
	// Background subagent results already fed back into the conversation.
	let bgReported = 0;
	const started = Date.now();
	// Frozen per run: a changing timestamp inside the cached query block would
	// break the provider prompt-cache prefix on every step of a multi-step run.
	const runTimestamp = new Date(started).toLocaleString();
	// Per-run tool context (avoids module globals so chats run concurrently).
	const shellSessionKey = `run_${started}_${Math.random().toString(36).slice(2, 8)}`;
	const toolCtx: ToolContext = {
		todos: [],
		askUser,
		shellSessionKey,
		getMode: () => mode,
		emitShellNotify: (message) => emit({ type: "shell-notify", message }),
		emitToolProgress: (callId, text) => emit({ type: "tool-call-progress", callId, text }),
	};
	toolCtx.switchMode = (next) => {
		if (next === mode) {
			return `Already in ${mode} mode.`;
		}
		const prev = mode;
		mode = next;
		emit({ type: "mode-changed", mode: next });
		return `Switched from ${prev} mode to ${next} mode.`;
	};
	if (!isSubagent) {
		// Subagent runner for the `task` tool (top-level runs only).
		toolCtx.runSubagent = async (subPrompt, readonly, subagentName, subSignal, callId, opts) => {
			// resume/interrupt aren't representable in this single-shot runtime.
			if (opts?.resume) {
				return "error: resuming or forking subagents is not supported in this runtime; launch a fresh subagent instead.";
			}
			const def = subagentName ? roster?.find((s) => s.name.toLowerCase() === subagentName.toLowerCase()) : undefined;
			const subReadonly = def ? def.readonly : readonly;
			const subSystemOverride = def ? def.prompt : systemPromptOverride;
			// Model precedence: explicit task model → per-subagent override → global subagent model → chat model.
			// Models the agent invents (or that belong to another provider) would fail
			// against this run's endpoint, so only honour ids the provider actually offers.
			const known = (id: string | undefined): string | undefined => {
				if (!id) return undefined;
				if (!availableModels?.length) return id;
				return availableModels.some((m) => m.toLowerCase() === id.toLowerCase()) ? id : undefined;
			};
			const subModel = known(opts?.model) || known(def?.model) || known(subagentModel) || model;
			// Surface the resolved model on the Task card even when the call didn't name one.
			if (callId) {
				emit({
					type: "tool-call-started",
					callId,
					name: "Task",
					input: { model: subModel },
				});
			}
			// Attach any provided files to the subagent prompt as context.
			if (opts?.fileAttachments?.length) {
				subPrompt = `${subPrompt}\n\n<attached_files>\n${opts.fileAttachments.join("\n")}\n</attached_files>`;
			}
			// Per-subagent abort: child controller linked to the parent signal so the
			// user can stop just this subagent and return to the parent.
			const childAC = new AbortController();
			const parentSig = subSignal ?? signal;
			const onParentAbort = () => {
				try { childAC.abort(); } catch { /* ignore */ }
			};
			if (parentSig.aborted) onParentAbort();
			else parentSig.addEventListener("abort", onParentAbort, { once: true });
			if (callId && registerSubagentAbort) {
				registerSubagentAbort(callId, () => {
					try { childAC.abort(); } catch { /* ignore */ }
				});
			}
			let finalText = "";
			// No outer Task/subagent wall clock — nested tools already have per-tool timeouts.
			// Parent Stop still aborts via childAC.
			// Same context window + step budget as the parent agent (compaction/summarize
			// runs inside the child loop against this budget).
			const subContextTokens =
				contextTokens && contextTokens > 0 ? contextTokens : undefined;
			const runP = runAgent({
				apiBaseUrl,
				apiKey,
				model: subModel,
				mode: subReadonly ? "ask" : "agent",
				prompt: subPrompt,
				history: [],
				maxTokens,
				maxSteps,
				autoContinue,
				contextTokens: subContextTokens,
				sampling,
				modelParams,
				anthropic,
				oauthKind,
				systemPromptOverride: subSystemOverride,
				enableFileReading,
				enableTerminalSuggestions,
				enableWorkspaceContext,
				approve,
				isSubagent: true,
				// Nested Task disabled; child still needs hooks for compaction etc.
				onHook,
				onBeforeShell,
				onAfterEdit,
				signal: childAC.signal,
				emit: (e) => {
					if (e.type === "run-result") finalText = e.text;
					// UI stream only — not parent history. Coalesced via parent emit.
					if (callId) emit({ type: "subagent-event", callId, event: e });
				},
			});
			// Background subagents return immediately; they keep streaming via emit.
			if (opts?.runInBackground) {
				const title = opts.description || subagentName || "subagent";
				// Track the work so the parent run waits for it before reporting "finished",
				// and capture its summary so it can be fed back into the loop on completion.
				const idx = bgSubagents.length;
				const tracked = runP
					.then(() => ({
						title,
						text: finalText || "(subagent finished with no summary)",
					}))
					.catch((e) => {
						logError("task.background", e, { title, callId });
						return {
							title,
							text: `(subagent failed: ${e instanceof Error ? e.message : String(e)})`,
						};
					})
					.finally(() => {
						parentSig.removeEventListener("abort", onParentAbort);
						onHook?.("subagentStop", { subagent: title });
					});
				bgSubagents.push(tracked);
				void tracked.then((v) => { bgSettled[idx] = v; });
				if (callId) emit({ type: "subagent-event", callId, event: { type: "run-status", status: "running" } });
				return `Launched ${title} in the background${callId ? ` (call ${callId})` : ""}. It will keep working and stream its results; you do not need to wait or poll for it. When all background subagents finish, their summaries will be delivered to you automatically and you can continue.`;
			}
			try {
				await runP;
			} catch (e) {
				if (childAC.signal.aborted || parentSig.aborted) {
					return "(subagent cancelled)";
				}
				logError("task.foreground", e, { subagent: subagentName, callId });
				return `(subagent failed: ${e instanceof Error ? e.message : String(e)})`;
			} finally {
				parentSig.removeEventListener("abort", onParentAbort);
				onHook?.("subagentStop", { subagent: subagentName || "subagent" });
			}
			if (childAC.signal.aborted || parentSig.aborted) return "(subagent cancelled)";
			return finalText || "(subagent finished with no summary)";
		};
	}
	// Cursor-shaped context blocks, sent as cached user content (not in system).
	let cursorCtx: CursorContextBlocks | undefined;
	if (!isSubagent) {
		try {
			let userInfo = await buildUserInfoBlock({ userRules: extraInstructions, enableWorkspaceContext });
			if (roster && roster.length) {
				const list = roster.map((s) => `- ${s.name}${s.readonly ? " (read-only)" : ""}: ${s.description}`).join("\n");
				userInfo += `\n\n<subagents>\nLaunch one of these with the Task tool by setting "subagent_type" to its name:\n${list}\n</subagents>`;
			}
			if (opts.mode === "project" && teams?.length && activeTeamIds?.length) {
				userInfo += buildTeamsBlock(teams, customSubagents ?? [], activeTeamIds);
			}
			const openFiles = enableWorkspaceContext !== false ? await buildOpenFilesBlock() : "";
			cursorCtx = { userInfo, openFiles };
		} catch {
			// context is best-effort
		}
	}

	// MCP tools available across connected servers.
	const mcpTools = isSubagent ? [] : mcpManager.listTools();
	const mcpSchemas: ToolSchema[] = mcpTools.map((t) => ({
		type: "function",
		function: {
			name: t.qualifiedName,
			description: `[MCP:${t.server}] ${t.tool.description ?? t.tool.name}`,
			parameters: (t.tool.inputSchema as object) ?? { type: "object", properties: {} },
		},
	}));

	const system = systemPrompt(mode, systemPromptOverride);

	const disabledToolNames = new Set<string>();
	if (!enableFileReading) {
		disabledToolNames.add("Read");
		disabledToolNames.add("Glob");
		disabledToolNames.add("Grep");
		disabledToolNames.add("SemanticSearch");
		disabledToolNames.add("FileSearch");
	}
	if (!enableTerminalSuggestions) {
		disabledToolNames.add("Shell");
	}
	if (opts.enableWebSearch === false) disabledToolNames.add("WebSearch");
	if (opts.enableWebFetch === false) disabledToolNames.add("WebFetch");
	if (isSubagent) {
		// Prevent unbounded recursion of subagents.
		disabledToolNames.add("Task");
	}

	// Tools the current mode is permitted to invoke (ask/plan = read-only,
	// plan additionally gets write_plan, agent gets everything).
	const allowedNamesFor = () =>
		new Set(
			toolsForMode(mode)
				.map((t) => t.schema.function.name)
				.filter((n) => !disabledToolNames.has(n)),
		);

	pushHistory({ kind: "user", text: prompt, attachments: attachments && attachments.length ? attachments : undefined });
	let settledEmitted = false;
	const emitSettled = (status: "finished" | "cancelled" | "error") => {
		if (settledEmitted) return;
		settledEmitted = true;
		try {
			emit({ type: "run-status", status });
		} catch { /* never throw from settle */ }
	};
	emit({ type: "run-status", status: "running" });

	// Last request's usage = actual context occupancy (cumulative sums overstate
	// it massively since every step resends the whole conversation).
	let lastPrompt = 0;
	let lastCompletion = 0;

	try {
		let finalText = "";
		let planWritten = false;
		let planNudged = false;
		// One-shot nudge when the model stops with unfinished todos.
		let todoNudged = false;

		// Feed already-finished (but unreported) background subagent results into the
		// conversation, so the model always knows what has completed. Returns count.
		const flushSettledBg = (): number => {
			const done: { title: string; text: string }[] = [];
			while (bgReported < bgSubagents.length && bgSettled[bgReported] !== undefined) {
				done.push(bgSettled[bgReported]!);
				bgReported++;
			}
			if (done.length) {
				pushHistory({
					kind: "user",
					text: `[System: Background subagent${done.length > 1 ? "s" : ""} finished — results below.]\n\n${done.map((v) => `### ${v.title}\n${v.text}`).join("\n\n")}`,
				});
			}
			return done.length;
		};

		const bgPending = () => bgSubagents.length > bgReported;

		/** Race a promise against user abort. No wall clock: a subagent's own
		 *  per-tool timeouts + step limit guarantee it terminates, so declaring
		 *  "timeout" here while it is still working desyncs the parent (it
		 *  continues, re-dispatches duplicate work, and the late result lands in
		 *  a slot that was already reported). */
		const raceAbort = <T,>(p: Promise<T>): Promise<T | "aborted"> =>
			new Promise((resolve) => {
				let done = false;
				const finish = (v: T | "aborted") => {
					if (done) return;
					done = true;
					resolve(v);
				};
				if (signal.aborted) { finish("aborted"); return; }
				const onAbort = () => finish("aborted");
				signal.addEventListener("abort", onAbort, { once: true });
				p.then(
					(v) => { signal.removeEventListener("abort", onAbort); finish(v); },
					() => { signal.removeEventListener("abort", onAbort); finish("aborted"); },
				);
			});

		/** Block until all unreported background subagents settle, then flush into history. */
		const awaitPendingBg = async (): Promise<boolean> => {
			if (!bgPending()) return false;
			flushSettledBg();
			if (!bgPending()) return true;
			const pending = bgSubagents.slice(bgReported);
			const n = pending.length;
			emit({ type: "run-status", status: "running" });
			emit({
				type: "shell-notify",
				message: `Waiting for ${n} background subagent${n > 1 ? "s" : ""} to finish — will resume when done…`,
			});
			// Wait until every launched subagent actually settles (or the user
			// aborts). Never declare a still-running subagent "timed out".
			const outcome = await raceAbort(Promise.allSettled(pending));
			if (outcome === "aborted" || signal.aborted) {
				for (let i = bgReported; i < bgSubagents.length; i++) {
					if (bgSettled[i] === undefined) bgSettled[i] = { title: "subagent", text: "(cancelled)" };
				}
				flushSettledBg();
				return true;
			}
			flushSettledBg();
			return true;
		};

		// Summarize older steps with the same model (non-streaming aggregate) so
		// compaction keeps task intent, decisions, file paths and unfinished work.
		const summarizeSteps = async (steps: Step[]): Promise<string> => {
			const sys =
				"You compress an agent coding session transcript. Write a dense summary that preserves: " +
				"1) the user's original request(s) and intent, " +
				"2) files created/edited/deleted with paths and short change notes (e.g. +12 -5), not full code, " +
				"3) the latest todo list / task status if present, " +
				"4) key assistant conclusions and decisions (not chain-of-thought), " +
				"5) subagent/task outcomes, 6) errors hit and fixes, 7) unfinished work / next steps. " +
				"Use short markdown sections. Do not invent details. Do not paste large file bodies.";
			let text = "";
			for await (const ev of streamChat({
				apiBaseUrl,
				apiKey,
				model,
				messages: [
					{ role: "system", content: sys },
					{ role: "user", content: stepsToTranscript(steps).slice(0, 400_000) },
				],
				maxTokens: 2048,
				anthropic,
				oauthKind,
				signal,
				maxRetries: 2,
			})) {
				if (ev.type === "text-delta") text += ev.text;
			}
			if (!text.trim()) throw new Error("empty summary");
			return text.trim();
		};

		const stepLimit = maxSteps && maxSteps > 0 ? maxSteps : MAX_STEPS;
		let hitStepLimit = false;
		for (let step = 0; ; step++) {
			if (!autoContinue && step >= stepLimit) {
				hitStepLimit = true;
				break;
			}
			if (signal.aborted) {
				emitSettled("cancelled");
				return;
			}

			// Any background subagents that finished while the model was busy? Report
			// them now so it never reasons about "still running" work that's done.
			flushSettledBg();

			// Auto context management. Budget = window minus the reply reservation.
			const budget = contextTokens && contextTokens > 0
				? Math.max(1024, contextTokens - (maxTokens ?? 4096) - 1024)
				: 0;
			// 0) Cheap in-place economy every step: stub stale tool dumps + slim old
			// edit args. Free wins (no LLM call). UI cards keep full results via turns.
			economizeHistory(history);
			// 1) Auto-summarization: soft boundary from 65% fill; hard at 78%.
			// Live-turn tool results stay verbatim (see economizeHistory) so the
			// agent cannot amnesically re-do the same edits/reads mid-task.
			const usedEst = stepsTokens(history) + Math.ceil(system.length / 4);
			const fill = Math.max(usedEst, lastPrompt);
			const shouldCompact = budget > 0 && (
				fill >= budget * COMPACT_AT_FILL ||
				(fill >= budget * COMPACT_SOFT_FILL && isCompactionBoundary(history))
			);
			if (shouldCompact) {
				const { prefix, tail } = splitForCompaction(history, Math.floor(budget * COMPACT_KEEP_FRAC));
				if (prefix.length >= 2) {
					onHook?.("preCompact", { dropped: String(prefix.length), reason: "auto-summarize" });
					emit({ type: "compaction", status: "running" });
					try {
						const summary = await summarizeSteps(prefix);
						history.length = 0;
						history.push(
							{ kind: "user", text: `[System: Earlier conversation was summarized to free context. Summary:]\n\n${summary}` },
							{ kind: "assistant", text: "Understood. Continuing with the summarized context.", calls: [] },
							...tail,
						);
						// Re-economize the new tail (summary is dense; keep it).
						economizeHistory(history);
						emit({ type: "compaction", status: "done", summary });
					} catch {
						emit({ type: "compaction", status: "failed" });
					}
				}
			}
			// 2) Trim fallback: guarantees the request fits even if summarization
			// didn't run or wasn't enough (rare).
			const fitted = budget > 0 ? fitStepsToBudget(history, system, budget) : history;
			if (fitted !== history && fitted.length < history.length) {
				onHook?.("preCompact", { dropped: String(history.length - fitted.length) });
			}
			const liveCtx = cursorCtx
				? { ...cursorCtx, reminder: mode === "multitask" ? MULTITASK_REMINDER : mode === "project" ? PROJECT_REMINDER : undefined, timestamp: runTimestamp }
				: cursorCtx;
			const messages = buildMessages(system, fitted, liveCtx);
			let assistantText = "";
			let thinking = "";
			let finishReason = "";
			const calls: ToolCall[] = [];
			// Map provider stream index → call id, so streamed args route to the
			// already-announced tool card in the UI.
			const callIdByIndex = new Map<number, string>();
			const argsByIndex = new Map<number, string>();

			// Tool definitions are paid on every step. Keep every tool callable, but
			// replace long instructional descriptions after the first turn; parameter
			// schemas retain the exact calling contract.
			const compactSchema = (s: ToolSchema): ToolSchema => {
				if (step === 0 || s.function.description.length <= 240) return s;
				const first = s.function.description.split(/\n|(?<=[.!?])\s/)[0]?.trim();
				return {
					...s,
					function: {
						...s.function,
						description: (first || `Use ${s.function.name} when needed.`).slice(0, 240),
					},
				};
			};
			const activeTools = [
				...schemasForMode(mode).filter((s) => !disabledToolNames.has(s.function.name)).map(compactSchema),
				...mcpSchemas.map(compactSchema),
			];

			// Stream response from LLM
			for await (const ev of streamChat({
				apiBaseUrl,
				apiKey,
				model,
				messages,
				tools: activeTools,
				maxTokens,
				sampling,
				modelParams,
				anthropic,
				oauthKind,
				signal,
				onRetry: (attempt, max, delayMs, error) => emit({ type: "retry", attempt, max, delayMs, error }),
			})) {
				if (ev.type === "text-delta") {
					assistantText += ev.text;
					emit({ type: "text-delta", text: ev.text });
				} else if (ev.type === "thinking-delta") {
					thinking += ev.text;
					emit({ type: "thinking-delta", text: ev.text });
				} else if (ev.type === "tool-call-start") {
					// Surface the tool card the moment the model commits to a call.
					// No startedAt yet — countdown begins when execute actually starts.
					callIdByIndex.set(ev.index, ev.id);
					argsByIndex.set(ev.index, "");
					const tMs = toolTimeoutMs(ev.name);
					emit({
						type: "tool-call-started",
						callId: ev.id,
						name: ev.name,
						input: {},
						timeoutMs: tMs > 0 ? tMs : undefined,
					});
				} else if (ev.type === "tool-call-args-delta") {
					const id = callIdByIndex.get(ev.index);
					const acc = (argsByIndex.get(ev.index) ?? "") + ev.delta;
					argsByIndex.set(ev.index, acc);
					if (id) emit({ type: "tool-call-args", callId: id, argsText: acc });
				} else if (ev.type === "tool-call") {
					calls.push(ev.call);
				} else if (ev.type === "usage") {
					lastPrompt = ev.promptTokens ?? lastPrompt;
					lastCompletion = ev.completionTokens ?? lastCompletion;
					// Live-update the ring after every step. prompt/completion carry
					// this step's delta (usage tracking accumulates them); totalTokens
					// is the current context occupancy.
					emit({ type: "usage", promptTokens: ev.promptTokens ?? 0, completionTokens: ev.completionTokens ?? 0, totalTokens: lastPrompt + lastCompletion });
				} else if (ev.type === "done") {
					finishReason = ev.finishReason || "";
				}
			}

			if (assistantText || thinking || !calls.length) {
				pushHistory({ kind: "assistant", text: assistantText, thinking: thinking || undefined, calls: [] });
			}

			if (!calls.length) {
				// Plan mode must persist a plan file. If the model tries to end without
				// calling write_plan, force it once.
				if (mode === "plan" && !planWritten && !planNudged) {
					planNudged = true;
					pushHistory({
						kind: "user",
						text: "[System: You are in PLAN MODE and have not written the plan yet. Call the WritePlan tool now with a title and the complete Markdown plan. Do not respond with the plan as plain text — it must be saved via WritePlan.]",
					});
					continue;
				}
				// In-flight background Task subagents: wait + feed results before any
				// "continue" nudge. Otherwise the model gets another turn while workers
				// are still running and often spawns a second wave of subagents.
				if (bgPending()) {
					await awaitPendingBg();
					if (signal.aborted) {
						emitSettled("cancelled");
						return;
					}
					continue;
				}
				// Truncated response (hit max output tokens): the model didn't choose to
				// stop — never treat this as a final answer. Ask it to continue.
				if (isAgentic() && /length|max_tokens|max_output_tokens/i.test(finishReason)) {
					pushHistory({
						kind: "user",
						text: "[System: Your previous response was cut off because it hit the output-token limit. Continue exactly where you left off; re-issue any tool call that was truncated.]",
					});
					continue;
				}
				// Thinking-only turn (reasoned but produced no answer and no tool calls):
				// the task isn't done — nudge it to act instead of silently stopping.
				if (isAgentic() && !assistantText.trim() && thinking.trim()) {
					pushHistory({
						kind: "user",
						text: "[System: You produced only internal reasoning with no answer or tool calls. Continue working on the task now — make the necessary tool calls, or reply with your final answer if fully finished.]",
					});
					continue;
				}
				const prev = history[history.length - 2];
				// Empty turn right after a tool result → nudge for more work. If it
				// produced any text, that's its final answer — stop.
				if (isAgentic() && !assistantText.trim() && !thinking.trim() && prev && prev.kind === "tool-result") {
					pushHistory({
						kind: "user",
						text: "[System: If you need to make more tool calls to complete the task, please do so now. If you are fully finished, reply normally without calling any tools.]",
					});
					continue;
				}
				// Unfinished todo list → one nudge to finish or explicitly wrap up.
				if (isAgentic() && !isSubagent && !todoNudged) {
					const open = toolCtx.todos.filter((t) => t.status === "pending" || t.status === "in_progress");
					if (open.length) {
						todoNudged = true;
						pushHistory({
							kind: "user",
							text: `[System: Your todo list still has ${open.length} unfinished item${open.length > 1 ? "s" : ""}: ${open.map((t) => `"${t.content}"`).join(", ")}. Continue working on them now. If they are actually done or no longer needed, update the todo list, then give your final answer.]`,
						});
						continue;
					}
				}
				finalText = assistantText;
				break;
			}

			// Add a separate step for the tool calls so they are separated in history
			pushHistory({ kind: "assistant", text: "", calls: calls });

			const parsed = calls.map((call) => {
				let input: any = {};
				let badArgs = false;
				try {
					input = normalizeToolPaths(call.name, JSON.parse(call.arguments || "{}"), getWorkspaceRoot());
				} catch {
					// Truncated/invalid args JSON (common on very large edits). Executing
					// with {} would call tools with missing params — fail the call instead.
					badArgs = true;
				}
				// MCP tools share CallMcpTool budget when no per-name override.
				const tMs = call.name.startsWith("mcp__")
					? toolTimeoutMs("CallMcpTool")
					: toolTimeoutMs(call.name);
				// Shell foreground expiry backgrounds the command; it is not the tool's
				// hard timeout. Keep the outer safety budget so cleanup can return smoothly.
				let timeoutMs = tMs > 0 ? tMs : undefined;
				// Task: no outer timeout — nested tool calls already time out individually.
				// Announce card; startedAt set when exec actually begins.
				emit({
					type: "tool-call-started",
					callId: call.id,
					name: call.name,
					input,
					timeoutMs,
				});
				return { call, input, badArgs, timeoutMs };
			});

			const results = new Array<{ status: "completed" | "error"; output: string; diff?: string; startLine?: number; endLine?: number; image?: { mime: string; base64: string } }>(parsed.length);
			const completedUi = new Set<number>();
			const finishUi = (i: number) => {
				if (completedUi.has(i) || !results[i]) return;
				completedUi.add(i);
				const { call } = parsed[i];
				const r = results[i];
				// Surface completion as soon as the tool settles — don't wait for
				// siblings. Prevents one slow tool from freezing the whole card strip.
				emit({
					type: "tool-call-completed",
					callId: call.id,
					name: call.name,
					status: r.status,
					result: r.output,
					diff: r.diff,
					startLine: r.startLine,
					endLine: r.endLine,
				});
			};

			const exec = async (i: number) => {
				const { call, input, badArgs } = parsed[i];
				if (badArgs) {
					results[i] = {
						status: "error",
						output: `error: tool arguments were not valid JSON (likely truncated — the payload was too large). Retry with a smaller edit: split the change into multiple smaller ${call.name} calls.`,
					};
					finishUi(i);
					return;
				}
				// MCP tool dispatch (same hard timeout + countdown as built-ins).
				if (call.name.startsWith("mcp__")) {
					if (!isAgentic() || isCoordinator()) {
						// MCP tools may mutate; only allow in agentic modes. Multitask is a
						// coordinator and must delegate MCP work to subagents.
						results[i] = { status: "error", output: `MCP tools not allowed in ${mode} mode` };
						return;
					}
					// Approval policy decides silently (allow/deny) or prompts (ask/review).
					if (approve) {
						const approval = await approve(call.name, input, call.id);
						if (approval !== true) {
							results[i] = { status: "error", output: `user denied ${call.name}` };
							return;
						}
					}
					// beforeMCPExecution hook (may veto).
					const mcpVeto = await onHook?.("beforeMcp", { tool: call.name }, call.name);
					if (mcpVeto) {
						results[i] = { status: "error", output: `blocked by hook: ${mcpVeto}` };
						return;
					}
					const limitMs = parsed[i].timeoutMs ?? toolTimeoutMs("CallMcpTool");
					const toolAc = new AbortController();
					const killTool = () => { try { toolAc.abort(); } catch { /* ignore */ } };
					if (registerSubagentAbort) registerSubagentAbort(call.id, killTool);
					emit({
						type: "tool-call-started",
						callId: call.id,
						name: call.name,
						input,
						timeoutMs: limitMs > 0 ? limitMs : undefined,
						startedAt: Date.now(),
					});
					const onParentAbort = () => killTool();
					if (signal.aborted) onParentAbort();
					else signal.addEventListener("abort", onParentAbort, { once: true });
					try {
						const out = await withToolTimeout(
							Promise.resolve().then(() => mcpManager.callTool(call.name, input)),
							limitMs,
							call.name,
							() => {
								killTool();
								results[i] = {
									status: "error",
									output: `error: timeout: ${call.name} exceeded ${Math.round((limitMs || 0) / 1000)}s. Tool aborted.`,
								};
								finishUi(i);
							},
							toolAc.signal,
						);
						if (completedUi.has(i)) return;
						results[i] = { status: out.startsWith("error:") ? "error" : "completed", output: out };
						finishUi(i);
					} catch (e) {
						const msg = e instanceof Error ? e.message : String(e);
						logError("tool.mcp", e, { tool: call.name, callId: call.id });
						if (completedUi.has(i)) return;
						results[i] = {
							status: "error",
							output: msg.startsWith("timeout:") || msg.startsWith("aborted:")
								? `error: timeout: ${call.name} exceeded ${Math.round((limitMs || 0) / 1000)}s. Tool aborted.`
								: `error: ${msg}`,
						};
						finishUi(i);
					} finally {
						signal.removeEventListener("abort", onParentAbort);
					}
					return;
				}
				const tool = TOOLS[call.name];
				if (!tool || disabledToolNames.has(call.name)) {
					results[i] = { status: "error", output: `unknown or disabled tool: ${call.name}` };
					return;
				}
				// Multitask/project are coordinators: they can read/search/manage todos but
				// must never mutate files or the shell — delegate that to a subagent.
				if (isCoordinator() && !MULTITASK_TOOLS.has(call.name)) {
					results[i] = {
						status: "error",
						output: `tool ${call.name} not allowed in ${mode} mode — delegate file/shell edits to a background subagent with the Task tool.`,
					};
					return;
				}
				if (!isAgentic() && !allowedNamesFor().has(call.name)) {
					results[i] = { status: "error", output: `tool ${call.name} not allowed in ${mode} mode` };
					return;
				}
				// Approval gate: every policy-covered action consults the approver, which
				// resolves the per-type policy (allow silently / ask / deny) itself.
				const isEditTool = EDIT_TOOLS.has(call.name);
				// Per-call action type: also gates ungated tools (e.g. Read) when they
				// target paths outside the workspace.
				const needsApproval = actionTypeForCall(call.name, input, getWorkspaceRoot()) !== undefined;
				if (needsApproval && approve) {
					const approval = await approve(call.name, input, call.id);
					if (approval !== true) {
						const denied = approval && typeof approval === "object"
							? `user denied/blocked "${approval.blockedSubject}"`
							: `user denied ${call.name}`;
						results[i] = { status: "error", output: `${denied}; try a different approach or ask the user` };
						return;
					}
				}
				// beforeShell hook (may veto).
				if (call.name === "Shell" && onBeforeShell) {
					const veto = await onBeforeShell(String(input?.command ?? ""));
					if (veto) {
						results[i] = { status: "error", output: `blocked by hook: ${veto}` };
						return;
					}
				}
				// beforeReadFile hook (may veto).
				if (call.name === "Read") {
					const veto = await onHook?.("beforeReadFile", { path: String(input?.path ?? "") });
					if (veto) {
						results[i] = { status: "error", output: `blocked by hook: ${veto}` };
						return;
					}
				}
				try {
					// Per-tool hard timeout + linked abort. On timeout: kill immediately
					// and settle UI — never leave the card spinning "Working".
					const limitMs = parsed[i].timeoutMs ?? toolTimeoutMs(call.name);
					const toolAc = new AbortController();
					const killTool = () => {
						try { toolAc.abort(); } catch { /* ignore */ }
					};
					// Register so UI countdown-0 / cancelSubagent can kill any tool.
					if (registerSubagentAbort) {
						registerSubagentAbort(call.id, killTool);
					}
					// Countdown clock starts now (not when the card was announced).
					emit({
						type: "tool-call-started",
						callId: call.id,
						name: call.name,
						input,
						timeoutMs: limitMs > 0 ? limitMs : undefined,
						startedAt: Date.now(),
					});
					const onParentAbort = () => killTool();
					if (signal.aborted) onParentAbort();
					else signal.addEventListener("abort", onParentAbort, { once: true });
					let r: Awaited<ReturnType<typeof tool.execute>>;
					let timedOut = false;
					try {
						r = await withToolTimeout(
							Promise.resolve().then(() => tool.execute(input, toolAc.signal, call.id, toolCtx)),
							limitMs,
							call.name,
							() => {
								timedOut = true;
								killTool();
								// Immediate UI settle on timeout — don't wait for tool cleanup.
								results[i] = {
									status: "error",
									output: `error: timeout: ${call.name} exceeded ${Math.round((limitMs || 0) / 1000)}s. Tool aborted - retry with a narrower scope or shorter command.`,
								};
								finishUi(i);
							},
							// Also settle when UI cancelSubagent aborts (countdown-0), not only wall timer.
							toolAc.signal,
						);
					} catch (e) {
						const msg = e instanceof Error ? e.message : String(e);
						logError("tool.execute", e, { tool: call.name, callId: call.id });
						try { toolAc.abort(); } catch { /* ignore */ }
						const isTo = timedOut || msg.startsWith("timeout:") || msg.startsWith("aborted:");
						r = {
							output: isTo
								? `error: timeout: ${call.name} exceeded ${Math.round((limitMs || 0) / 1000)}s. Tool aborted - retry with a narrower scope or shorter command.`
								: `error: ${msg}`,
						};
					} finally {
						signal.removeEventListener("abort", onParentAbort);
					}
					// Timeout path already set results + finishUi; don't overwrite with a late success.
					if (timedOut || completedUi.has(i)) {
						if (!results[i]) {
							results[i] = {
								status: "error",
								output: `error: timeout: ${call.name} exceeded ${Math.round((limitMs || 0) / 1000)}s. Tool aborted - retry with a narrower scope or shorter command.`,
							};
						}
						finishUi(i);
						return;
					}
					const status: "completed" | "error" = r.output.startsWith("error:") ? "error" : "completed";
					results[i] = { status, output: r.output, diff: r.diff, startLine: r.startLine, endLine: r.endLine, image: r.image };
					// afterEdit hook on successful edits.
					if (status === "completed" && isEditTool && onAfterEdit) {
						onAfterEdit(String(input?.path ?? ""));
					}
					// Immediate UI settle (especially on timeout) — do not wait for siblings.
					finishUi(i);
				} catch (e) {
					logError("tool.lifecycle", e, { tool: call.name, callId: call.id });
					results[i] = { status: "error", output: `error: ${e instanceof Error ? e.message : String(e)}` };
					finishUi(i);
				}
			};

			// Early-exit paths inside exec that set results without finishUi.
			const wrapExec = async (i: number) => {
				try {
					await exec(i);
				} finally {
					// Guarantee UI settles even if a branch forgot finishUi.
					if (results[i]) finishUi(i);
					else {
						results[i] = { status: "error", output: "error: tool produced no result" };
						finishUi(i);
					}
				}
			};

			// Cap parallel RO tools so a burst of Grep/Glob/Task can't thrash CPU/IO.
			// Worker pool (not batch-wait): a long Task doesn't block the next free slot.
			const RO_CONCURRENCY = 8;
			const roIdx: number[] = [];
			for (let i = 0; i < parsed.length; i++) {
				const name = parsed[i].call.name;
				const tool = TOOLS[name];
				if (tool && !tool.mutating && !name.startsWith("mcp__")) roIdx.push(i);
			}
			if (roIdx.length) {
				let cursor = 0;
				const workers = Array.from(
					{ length: Math.min(RO_CONCURRENCY, roIdx.length) },
					async () => {
						while (cursor < roIdx.length) {
							const i = roIdx[cursor++];
							await wrapExec(i);
						}
					},
				);
				await Promise.all(workers);
			}
			for (let i = 0; i < parsed.length; i++) {
				const name = parsed[i].call.name;
				const tool = TOOLS[name];
				if (!tool || tool.mutating || name.startsWith("mcp__")) {
					await wrapExec(i);
				}
			}

			for (let i = 0; i < parsed.length; i++) {
				const { call } = parsed[i];
				const r = results[i] ?? { status: "error" as const, output: "error: tool produced no result" };
				if (call.name === "WritePlan" && r.status === "completed") {
					planWritten = true;
				}
				// Live-turn results stay full; economizeHistory stubs older dumps only.
				pushHistory({ kind: "tool-result", callId: call.id, name: call.name, output: r.output, status: r.status, image: r.image });
			}
			// After launching background Task(s), wait for that wave before calling the
			// model again. Otherwise the next turn (or empty-turn / todo nudge) races
			// ahead and the coordinator spawns more subagents while workers still run.
			if (bgPending()) {
				const launchedBg = parsed.some((p, i) => {
					if (p.call.name !== "Task") return false;
					const out = results[i]?.output || "";
					return /Launched .+ in the background/i.test(out);
				});
				if (launchedBg) {
					await awaitPendingBg();
					if (signal.aborted) {
						emitSettled("cancelled");
						return;
					}
				}
			}
		}

		// Paused at the step limit with work still in flight → surface a Continue
		// prompt in the chat instead of silently finishing.
		if (hitStepLimit) {
			emit({ type: "max-steps", steps: stepLimit });
		}
		// Usage is emitted per step above (live ring + per-step usage tracking).
		// Safety net: if any background subagents are still unsettled (e.g. hit MAX_STEPS
		// before the model wrapped up), wait for them so the chat isn't marked finished early.
		// Crucially, flush their summaries into history too — otherwise the persisted
		// conversation only contains "launched in background…" and a follow-up message
		// makes the model believe the subagent is still running.
		if (bgSubagents.length > bgReported) {
			await awaitPendingBg();
			if (signal.aborted) {
				emitSettled("cancelled");
				return;
			}
		}
		if (signal.aborted) {
			emitSettled("cancelled");
			return;
		}
		emitSettled("finished");
		emit({ type: "run-result", text: finalText, durationMs: Date.now() - started });
		if (!isSubagent && onAfterRun) {
			onAfterRun();
		}
	} catch (e) {
		if (signal.aborted) {
			emitSettled("cancelled");
			return;
		}
		logError("agent.loop", e, { model, mode, isSubagent: Boolean(isSubagent) });
		try { emit({ type: "error", message: e instanceof Error ? e.message : String(e) }); } catch { /* ignore */ }
		emitSettled("error");
	} finally {
		// Force-mark any still-unsettled bg slots so we never hang a follow-up wait.
		if (signal.aborted || !settledEmitted) {
			for (let i = bgReported; i < bgSubagents.length; i++) {
				if (bgSettled[i] === undefined) bgSettled[i] = { title: "subagent", text: "(cancelled)" };
			}
			bgReported = bgSubagents.length;
		}
		// Guarantee a terminal status even if the loop exited without one.
		if (!settledEmitted) emitSettled(signal.aborted ? "cancelled" : "finished");
		// Tear down this run's persistent shell session.
		try { disposeShellSession(shellSessionKey); } catch { /* ignore */ }
	}
}
