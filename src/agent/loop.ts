/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { streamChat, SamplingParams, ModelParams } from "./provider";
import { responseTokenReservation } from "./providerLimits";
import type { OAuthKind } from "./oauth";
import { OAUTH_PROVIDER_DEFINITIONS, supportsOAuthTools } from "../shared/oauthProviders";
import { TOOLS, schemasForMode, toolsForMode, disposeShellSession, EDIT_TOOLS, MULTITASK_TOOLS, toolTimeoutMs, withToolTimeout, type AskQuestionItem, type ToolContext } from "./tools";
import { actionTypeForCall } from "./approvalPolicy";
import { getWorkspaceRoot, normalizeToolPaths, withWorkspaceRoot } from "../context/workspaceUtils";
import { scopedInstructionsForPaths } from "../context/workspaceContext";
import { renderScopedInstructions } from "../context/scopedInstructions";
import { systemPrompt } from "./prompt";
import { buildMessages, snapshotUserContext, clip, fitStepsToBudget, splitForCompaction, stepsToTranscript, stepsTokens, type CursorContextBlocks } from "./messages";
import {
	economizeHistory,
	COMPACT_AT_FILL,
	COMPACT_SOFT_FILL,
	COMPACT_KEEP_FRAC,
	COMPACT_MIN_GAIN_FRAC,
	COMPACT_COOLDOWN_STEPS,
	currentRequestText,
	isCompactionBoundary,
} from "./contextEconomy";
import { createHash } from "node:crypto";
import { BackgroundTasks } from "./backgroundTasks";
import type { ToolOutcome } from "./toolOutcome";
import { ActivityLedger } from "./taskState";
import { RetrievalProgress } from "./retrievalProgress";
import { ContextArchive } from "./contextArchive";
import { DeferredToolSchemas, OPTIONAL_BUILTIN_TOOLS } from "./deferredTools";
import { restoreContext, saveContext } from "./contextState";
import { buildUserInfoBlock, buildOpenFilesBlock } from "../context/cursorContext";
import { mcpManager, formatMcpToolResult } from "../integrations/mcpClient";
import { firstMcpImage } from "../integrations/mcpContent";
import type { AgentEvent, Attachment, ChatReasoning, Mode, ResponsesReasoning, Step, ToolCall, ToolSchema } from "./types";
import type { SubagentDef } from "../stores/featureStore";
import type { RunAgentOptions } from "./loopTypes";
import { buildTeamsBlock, findSubagentByName, resolveTeamSubagents } from "./teams";
import {
	streamPolicyFor,
	clipArgsText,
	TEXT_INTERVAL_MS,
	THINKING_INTERVAL_MS,
	SUBAGENT_INTERVAL_MS,
} from "../shared/streamPolicy";
import { logError } from "../logging";
import { planRelativePath } from "../shared/planPath";
import { resolveToolName, validateToolInput } from "./toolValidation";
import { VerificationLedger } from "./verification";
import type { Collaborator } from "./collaborationState";
import { withExecutionProfile, configuredExecutionProfile, assertExecutionPath, currentExecutionProfile } from "./execution";
import { disposeBrowserSession } from "./tools/browser";

// Persisted with each new coordinator-mode user turn. Required mode
// transitions append an explicit superseding instruction.
const MULTITASK_REMINDER =
	"<reminder>\nYou are in MULTITASK mode: you are a COORDINATOR, not an implementer. " +
	"Do NOT edit files, run terminal commands, or do the work yourself — the edit tools are DISABLED and will refuse. " +
	"Break the request into independent units, then delegate EVERY unit to a background subagent via the Task tool " +
	"(run_in_background=true), with at most four active tasks. Batch independent launches and do not duplicate running work.\n</reminder>";

// Project-mode counterpart: the model is the lead of the assigned team(s).
const PROJECT_REMINDER =
	"<reminder>\nYou are in PROJECT mode: you are the PROJECT LEAD of the team(s) in <assigned_teams>, not an implementer. " +
	"Do NOT edit files or run terminal commands yourself — those tools are DISABLED and will refuse. " +
	"Plan the project with TodoWrite, then delegate each unit of work to the right team member with the Task tool " +
	'(run_in_background=true, subagent_type set to the member name), batching independent launches with at most four active tasks and avoiding duplicate running work.\n</reminder>';

const MAX_STEPS = 200;

/** Searchable text view of the lossless conversation; binary images stay in chat. */
function archivedTranscript(steps: Step[]): string {
	return steps.map((s) => {
		if (s.kind === "user") {
			const files = (s.attachments ?? []).filter((a) => a.kind === "text")
				.map((a) => `\nAttached file: ${a.name}\n${a.data}`).join("\n");
			return `## ${s.synthetic ? "System note" : "User"}\n${s.text}${files}`;
		}
		if (s.kind === "assistant") {
			return `## Assistant\n${s.text}\n${s.calls.map((c) => `Tool call: ${c.name} (${c.id})\n${c.arguments}`).join("\n")}`;
		}
		return `## Tool result: ${s.name} (${s.callId}, ${s.status})\n${s.output}`;
	}).join("\n\n");
}

/**
 * Tools whose description carries protocol the model must not lose mid-run
 * (delegation rules, background-subagent etiquette, edit contracts). Everything
 * else is compacted to its first sentence — but for the WHOLE run, so the tool
 * block stays byte-identical and cacheable instead of changing after step 0.
 */
const VERBOSE_TOOL_DESCRIPTIONS = new Set([
	"Task",
	"Rg",
	"Shell",
	"AwaitShell",
	"TodoWrite",
	"WritePlan",
	"AskQuestion",
	"SwitchMode",
	"StrReplace",
	"Write",
	"Delete",
	"EditNotebook",
	"Read",
]);

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
	if (opts.oauthKind && !supportsOAuthTools(opts.oauthKind) && opts.mode !== "ask") {
		const label = OAUTH_PROVIDER_DEFINITIONS.find(provider => provider.kind === opts.oauthKind)?.label ?? opts.oauthKind;
		opts.emit({ type: "error", message: `${label} supports chat only. Switch to Ask mode to use this account, or select a provider with tool support.` });
		opts.emit({ type: "run-status", status: "error" });
		return;
	}
	return withWorkspaceRoot(opts.workspaceRoot, () => withExecutionProfile(opts.executionProfile ?? configuredExecutionProfile(), getWorkspaceRoot(), () => runAgentInWorkspace(opts)));
}

async function runAgentInWorkspace(opts: RunAgentOptions): Promise<void> {
	const { apiBaseUrl, apiKey, model, prompt, attachments, history: persistedHistory, maxTokens, maxSteps, autoContinue, contextTokens, sampling, modelParams, anthropic, oauthKind, systemPromptOverride, extraInstructions, enableFileReading, enableTerminalSuggestions, enableWorkspaceContext, approve, isSubagent, customSubagents, teams, activeTeamIds, subagentModel, availableModels, registerSubagentAbort, askUser, onAfterRun, onBeforeShell, onAfterEdit, onHook, signal, emit: rawEmit } = opts;
	const chatOnly = !!oauthKind && !supportsOAuthTools(oauthKind);
	const chatOnlyCapabilities = "<capabilities>\nThis provider supports chat only. No tools are available. MCP execution is unavailable. Answer using the supplied conversation, attachments and context. Do not request tools, invent tool results, or claim to have read files, executed commands or changed resources. Describe any proposed changes for the user to apply.\n</capabilities>";
	// Model history is disposable and may be compacted when the window fills.
	// Persisted history remains lossless for chat display/export, including full
	// tool output/thinking. Shallow clone suffices: economizeHistory/stripThinking
	// replaces entries via spread (never mutates originals), and new steps are
	// pushed as fresh objects.
	const history: Step[] = restoreContext(persistedHistory, opts.contextState);
	const runStart = persistedHistory.length;
	const archive = new ContextArchive();
	archive.prepareSteps(persistedHistory);
	let deferredTools: DeferredToolSchemas | undefined;
	let deferredBuiltins: DeferredToolSchemas | undefined;
	const pushHistory = (...steps: Step[]) => {
		history.push(...steps);
		persistedHistory.push(...steps);
	};
	let tokensUsed = opts.goal?.tokensUsed ?? 0;
	const budgetExhausted = () => Boolean(opts.budgetExhausted?.() || (opts.goal?.tokenBudget && tokensUsed >= opts.goal.tokenBudget));
	const emit = coalesceEmit(event => {
		if (event.type === "usage") {
			const delta = Math.max(0, event.promptTokens) + Math.max(0, event.completionTokens);
			tokensUsed += delta;
			opts.onGoalUsage?.(delta);
		}
		rawEmit(event);
	});
	/** Loop-injected note. Marked synthetic so it never poses as the user's request. */
	const pushSystemNote = (text: string) => pushHistory({ kind: "user", text, synthetic: true });
	// Mutable so the SwitchMode tool can change it mid-run.
	let mode = opts.mode;
	const initialToolNames = new Set(chatOnly ? [] : toolsForMode(opts.mode).map(t => t.schema.function.name));
	const inheritedReadOnly = opts.mode === "ask" || opts.mode === "plan";
	const webSearchEnabled = opts.enableWebSearch;
	const webFetchEnabled = opts.enableWebFetch;
	const changeOwner = opts.changeOwner;
	// These modes may need continuation nudges; execution permissions are separate.
	const isAgentic = () => mode === "agent" || mode === "multitask" || mode === "project" || mode === "debug" || mode === "plan";
	const canExecuteMcp = (m: Mode) => !chatOnly && currentExecutionProfile().kind !== "container" && (opts.mode === "agent" || opts.mode === "debug") && (m === "agent" || m === "debug");
	/** Coordinator modes: the model delegates instead of implementing. */
	const isCoordinator = () => mode === "multitask" || mode === "project";
	// In project mode the roster is limited to the members of the assigned team(s).
	const teamRoster =
		opts.mode === "project" && teams?.length && activeTeamIds?.length
			? resolveTeamSubagents(teams, customSubagents ?? [], activeTeamIds)
			: undefined;
	const roster = teamRoster?.length ? teamRoster : customSubagents;
	const background = new BackgroundTasks();
	const collaborators: Collaborator[] = opts.contextState?.agents ?? [];
	if (opts.contextState) opts.contextState.agents = collaborators;
	for (const agent of collaborators) if (agent.status === "running") agent.status = "interrupted";
	const activeAgents = new Map<string, { abort: AbortController; promise: Promise<void> }>();
	let childSequence = 0;
	const started = Date.now();
	const instructionFingerprints = new Set<string>();
	// Frozen per run: a changing timestamp inside the cached query block would
	// break the provider prompt-cache prefix on every step of a multi-step run.
	const runTimestamp = new Date(started).toLocaleString();
	// Per-run tool context (avoids module globals so chats run concurrently).
	const shellSessionKey = `run_${started}_${Math.random().toString(36).slice(2, 8)}`;
	const observedOutcomes = new Map<string, ToolOutcome>();
	const failedOutcome = (callId: string, status: ToolOutcome["status"]): ToolOutcome => ({ ...observedOutcomes.get(callId), status });
	const failureText = (callId: string, text: string) => {
		const observed = observedOutcomes.get(callId);
		return observed?.jobId ? `${text}\nProcess status: ${observed.processStatus ?? "unknown"}; terminal evidence: ReadContext {"id":"${observed.jobId}"}.` : text;
	};
	const toolCtx: ToolContext = {
		verification: new VerificationLedger(),
		getGoal: () => opts.goal ? { ...opts.goal, tokensUsed } : undefined,
		updateGoal: opts.goal ? status => { opts.goal!.status = status; opts.onGoalStatus?.(status); return `Goal status: ${status}`; } : undefined,
		recordToolOutcome: (callId, outcome) => { observedOutcomes.set(callId, outcome); },
		todos: opts.contextState?.todos?.map((todo) => ({ ...todo })) ?? [],
		readContext: (input) => {
			if (input.id === "parent_history") {
				if (!opts.inheritedContext) return "error: this run has no parent request history";
				const id = archive.store(opts.inheritedContext.userRequests, "Parent user instructions");
				return archive.read({ ...input, id });
			}
			if (input.id === "capabilities") {
				refreshCapabilities();
				const id = archive.store(capabilityText(), "Runtime capabilities");
				return archive.read({ ...input, id });
			}
			if (input.id === "history") {
				// Do not retain another full transcript snapshot on each page read.
				// The history alias stays valid as the append-only transcript grows.
				const snapshot = new ContextArchive();
				const id = snapshot.store(archivedTranscript(persistedHistory), "Conversation history");
				return snapshot.read({ ...input, id }).replace(`id: ${id}`, "id: history");
			}
			const id = input.id === "tools" ? deferredBuiltins?.catalogId ?? archive.store("No optional built-in tools are available in this run.", "Built-in tool catalog")
				: input.id === "mcp" ? deferredTools?.catalogId ?? archive.store(mcpSchemas.map(s => JSON.stringify(s)).join("\n"), "MCP tool catalog") : input.id;
			const output = archive.read({ ...input, id });
			if (!output.startsWith("Error:") && (deferredTools?.activate(id) || deferredBuiltins?.activate(id))) {
				schemaCache.clear();
				toolTokenCache.clear();
			}
			return output;
		},
		askUser,
		shellSessionKey,
		shellOwnerKey: opts.shellOwnerKey ?? opts.promptCacheKey ?? shellSessionKey,
		getMode: () => mode,
		changeOwner,
		beforeResourceWrite: async (path, content, resourceSignal) => onHook?.("beforeEdit", { path, tool_input: JSON.stringify({ file_path: path, content }) }, "Write", resourceSignal ?? signal),
		emitShellNotify: (message) => emit({ type: "shell-notify", message }),
		emitToolProgress: (callId, text) => emit({ type: "tool-call-progress", callId, text }),
	};
	toolCtx.switchMode = (next) => {
		if (next === mode) {
			return `Already in ${mode} mode.`;
		}
		if (toolsForMode(next).some(t => !initialToolNames.has(t.schema.function.name))) {
			return `error: ${next} mode expands this run's permissions. Ask the user to select that mode in the chat controls and send a new message.`;
		}
		const prev = mode;
		mode = next;
		system = makeSystem();
		cursorCtx = { ...cursorCtx!, userInfo: `${baseUserInfo}\n\n${capabilityText()}`.trim() };
		pushSystemNote(`Mode changed from ${prev} to ${next}. Follow the current mode instructions; previous mode reminders are superseded.\n${capabilityText()}`);
		emit({ type: "mode-changed", mode: next });
		return `Switched from ${prev} mode to ${next} mode.`;
	};
	if (!isSubagent) {
		// Subagent runner for the `task` tool (top-level runs only).
		toolCtx.runSubagent = async (subPrompt, readonly, subagentName, subSignal, callId, taskOpts) => {
			const resumed = taskOpts?.resume ? collaborators.find(agent => agent.id === taskOpts.resume) : undefined;
			if (taskOpts?.resume && !resumed) return "error: unknown collaborator ID in this conversation";
			if (resumed && activeAgents.has(resumed.id)) { resumed.mailbox.push(subPrompt); return `Message queued for active collaborator ${resumed.id}`; }
			const def = subagentName ? findSubagentByName(roster, subagentName) : undefined;
			const subReadonly = inheritedReadOnly || mode === "ask" || mode === "plan" || readonly || def?.readonly === true || resumed?.readonly === true;
			const subSystemOverride = def ? def.prompt : systemPromptOverride;
			// Model precedence: explicit task model → per-subagent override → global subagent model → chat model.
			// Models the agent invents (or that belong to another provider) would fail
			// against this run's endpoint, so only honour ids the provider actually offers.
			const known = (id: string | undefined): string | undefined => {
				if (!id) return undefined;
				if (!availableModels?.length) return id;
				return availableModels.some((m) => m.toLowerCase() === id.toLowerCase()) ? id : undefined;
			};
			const subModel = known(taskOpts?.model) || known(def?.model) || known(subagentModel) || model;
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
			if (taskOpts?.fileAttachments?.length) {
				subPrompt = `${subPrompt}\n\n<attached_files>\n${taskOpts.fileAttachments.join("\n")}\n</attached_files>`;
			}
			const taskKey = createHash("sha256").update(JSON.stringify([subPrompt.trim(), subModel, subReadonly, subagentName])).digest("hex");
			const duplicate = background.findActive(taskKey);
			if (duplicate) return `Task ${duplicate} is already running. Its result will be delivered automatically; continue independent work.`;
			if (activeAgents.size >= background.limit) return `error: ${background.limit} collaborators are already running. Continue independent work or wait for a result.`;
			const childId = resumed?.id ?? callId ?? `task_${Date.now()}_${++childSequence}`;
			const collaborator: Collaborator = resumed ?? { id: childId, title: taskOpts?.description || subagentName || "subagent", type: subagentName, model: subModel, readonly: subReadonly, status: "running", history: taskOpts?.fork ? structuredClone(persistedHistory) : [], mailbox: [], updatedAt: Date.now() };
			if (!resumed) collaborators.push(collaborator);
			collaborator.status = "running"; collaborator.model = subModel; collaborator.readonly = subReadonly;
			const parentRequests = persistedHistory.filter((s): s is Extract<Step, { kind: "user" }> => s.kind === "user" && !s.synthetic).map((s, i) => `User request ${i + 1}:\n${s.text}`).join("\n\n");
			const parentSummary = history.find(s => s.kind === "user" && s.synthetic && s.text.startsWith("Earlier conversation summary"));
			const inheritedContext = {
				instructions: cursorCtx?.userInfo.match(/<rules>[\s\S]*?<\/rules>/)?.[0] || extraInstructions || "",
				userRequests: parentRequests,
				summary: parentSummary?.kind === "user" ? clip(parentSummary.text, 4000) : undefined,
			};
			const childConfig = subModel === model ? { contextTokens, maxTokens, sampling, modelParams } : opts.resolveModelOptions?.(subModel) ?? {};
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
			let childError = "";
			let childPauseReason = "";
			const childReport = () => childAC.signal.aborted ? "(subagent cancelled)"
				: childError ? `(subagent failed: ${childError})`
					: childPauseReason ? `(subagent ${childPauseReason}; work is incomplete)${finalText ? `\n${finalText}` : ""}`
						: finalText || "(subagent finished with no summary; verify whether its task is complete)";
			// No outer Task/subagent wall clock — nested tools already have per-tool timeouts.
			// Parent Stop still aborts via childAC.
			const runP = runAgent({
				workspaceRoot: getWorkspaceRoot(),
				executionProfile: currentExecutionProfile(),
				unavailableTools: opts.unavailableTools,
				onRunEvent: opts.onRunEvent,
				budgetExhausted,
				onGoalStatus: status => { if (status !== "active" && status !== "complete") childPauseReason = `paused: ${status}`; },
				drainSteering: () => collaborator.mailbox.splice(0).map(message => `Parent agent message:\n${message}`),
				apiBaseUrl,
				apiKey,
				model: subModel,
				apiKeyPool: opts.apiKeyPool,
				mode: subReadonly ? "ask" : "agent",
				prompt: subPrompt,
				history: collaborator.history,
				maxTokens: childConfig.maxTokens,
				maxSteps,
				autoContinue,
				contextTokens: childConfig.contextTokens,
				sampling: childConfig.sampling,
				modelParams: childConfig.modelParams,
				promptCacheKey: `${opts.promptCacheKey ?? shellSessionKey}/task/${childId}`,
				shellOwnerKey: toolCtx.shellOwnerKey,
				anthropic,
				oauthKind,
				systemPromptOverride: subSystemOverride,
				enableFileReading,
				enableTerminalSuggestions,
				enableWorkspaceContext,
				enableWebSearch: webSearchEnabled,
				enableWebFetch: webFetchEnabled,
				changeOwner,
				approve,
				isSubagent: true,
				inheritedContext,
				// Nested Task disabled; child still needs hooks for compaction etc.
				onHook,
				onBeforeShell,
				onAfterEdit,
				signal: childAC.signal,
				emit: (e) => {
					if (e.type === "run-result") finalText = e.text;
					if (e.type === "error") childError = e.message;
					if (e.type === "run-status" && e.status === "error" && !childError) childError = "the child run ended with an error";
					if (e.type === "max-steps") childPauseReason = "reached its step limit";
					if (e.type === "usage") emit({ ...e, model: e.model ?? subModel, source: e.source === "summary" ? "summary" : "subagent" });
					// UI stream only — not parent history. Coalesced via parent emit.
					if (callId) emit({ type: "subagent-event", callId, event: e });
				},
			}).finally(() => {
				collaborator.status = childAC.signal.aborted || childPauseReason ? "interrupted" : childError ? "failed" : "completed";
				collaborator.result = childReport(); collaborator.updatedAt = Date.now(); activeAgents.delete(childId);
			});
			activeAgents.set(childId, { abort: childAC, promise: runP });
			void onHook?.("subagentStart", { subagent: collaborator.title, id: childId });
			// Background subagents return immediately; they keep streaming via emit.
			if (taskOpts?.runInBackground) {
				const title = taskOpts.description || subagentName || "subagent";
				const tracked = runP.then(childReport).finally(() => {
					parentSig.removeEventListener("abort", onParentAbort);
					onHook?.("subagentStop", { subagent: title });
				});
				background.add(childId, taskKey, title, tracked, () => childAC.abort());
				return `Launched ${title} in the background (task ${childId}). Continue independent work; its result will be delivered automatically when ready. If your next step depends on it, end your turn without tool calls and the system will wait for it. Do not relaunch this task or poll it with AwaitShell.`;
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
			return `Collaborator ${childId}:\n${childReport()}`;
		};
		toolCtx.agentControl = async (request, controlSignal) => {
			if (request.action === "list") return JSON.stringify(collaborators.map(({ history: _history, mailbox, ...agent }) => ({ ...agent, queuedMessages: mailbox.length })));
			const agent = collaborators.find(agent => agent.id === request.id);
			if (!agent) return "error: unknown collaborator ID in this conversation";
			const active = activeAgents.get(agent.id);
			if (request.action === "message" || request.action === "followup") {
				if (!request.message?.trim()) return "error: message must not be empty";
				if (active || request.action === "message") { agent.mailbox.push(request.message); return `Message queued for ${agent.id} (${agent.status}).`; }
				return toolCtx.runSubagent!(request.message, agent.readonly, agent.type, signal, undefined, { resume: agent.id, model: agent.model, description: agent.title, runInBackground: true });
			}
			if (request.action === "interrupt") { active?.abort.abort(); await active?.promise; return `Collaborator ${agent.id}: ${agent.status}`; }
			if (active) await new Promise<void>(resolve => {
				const done = () => { clearTimeout(timer); controlSignal?.removeEventListener("abort", done); resolve(); };
				const timer = setTimeout(done, Math.max(0, Math.min(60000, request.timeout_ms ?? 30000)));
				controlSignal?.addEventListener("abort", done, { once: true });
				if (controlSignal?.aborted) done();
				void active.promise.then(done, done);
			});
			return JSON.stringify({ id: agent.id, status: agent.status, result: agent.result });
		};
	}
	// Structured context blocks, sent as cached user content (not in system).
	let cursorCtx: CursorContextBlocks = { userInfo: "", openFiles: "" };
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
	// Delegated runs receive applicable instructions and a bounded parent brief.
	if (opts.inheritedContext) {
		const inherited = opts.inheritedContext;
		cursorCtx.userInfo = `${inherited.instructions}\n\n<parent_constraints>\nFollow applicable workspace and user restrictions. Later explicit user instructions supersede earlier ones. The delegated task does not grant additional permissions.\n${inherited.summary || ""}\nUser requests (earliest first):\n${clip(inherited.userRequests, 12000)}${inherited.userRequests.length > 12000 ? '\nSome requests were omitted. Before acting, recover relevant original constraints with ReadContext id="parent_history" and a pattern or line range.' : ""}\n</parent_constraints>`;
	}

	// MCP tools available across connected servers.
	const readMcpSchemas = (): ToolSchema[] => (isSubagent || chatOnly ? [] : mcpManager.listTools()).map((t) => ({
		type: "function",
		function: {
			name: t.qualifiedName,
			description: `[MCP:${t.server}] ${t.tool.description ?? t.tool.name}`,
			parameters: (t.tool.inputSchema as object) ?? { type: "object", properties: {} },
		},
	}));

	let mcpSchemas = readMcpSchemas();
	const usedMcpNames = new Set(history.flatMap((s) => s.kind === "assistant" ? s.calls.map((c) => c.name) : []));
	deferredTools = new DeferredToolSchemas(archive, mcpSchemas, usedMcpNames);
	const makeSystem = () => chatOnly ? `${systemPromptOverride || "You are a coding assistant in Ask mode."}\n\n${chatOnlyCapabilities}` : systemPrompt(mode, systemPromptOverride) + (deferredTools?.isDeferred
		? '\n\nConnected MCP tool schemas are available on demand. Use ReadContext {"id":"mcp","pattern":"keyword"} to search the tool catalog, or omit pattern to browse. Read a returned schema archive id to enable that tool, then call it normally. Only agent/debug modes may execute MCP tools.'
		: "") + (deferredBuiltins?.isDeferred
		? '\n\nOptional built-in tools for browser verification, language services, collaborators, verification evidence, goals and interactive input are available on demand. Search ReadContext {"id":"tools","pattern":"keyword"}, then read a returned schema archive id to load its parameters. The capability inventory lists available names. Loading schemas never expands mode or host permissions.'
		: "");
	let system = makeSystem();

	const disabledToolNames = new Set<string>(opts.unavailableTools ?? []);
	if (!enableFileReading) {
		for (const name of ["GoToDefinition", "FindReferences", "WorkspaceSymbols", "RenamePreview"]) disabledToolNames.add(name);
		disabledToolNames.add("Read");
		disabledToolNames.add("Glob");
		disabledToolNames.add("Grep");
		disabledToolNames.add("Rg");
		disabledToolNames.add("SemanticSearch");
		disabledToolNames.add("FileSearch");
	}
	if (!enableTerminalSuggestions) {
		disabledToolNames.add("WriteStdin");
		disabledToolNames.add("Shell");
		disabledToolNames.add("RunChecks");
	}
	if (opts.enableWebSearch === false) disabledToolNames.add("WebSearch");
	if (opts.enableWebFetch === false) disabledToolNames.add("WebFetch");
	if (opts.enableWebFetch === false || (currentExecutionProfile().kind === "container" && !currentExecutionProfile().network)) {
		for (const name of ["BrowserNavigate", "BrowserInspect", "BrowserScreenshot", "BrowserInteract", "BrowserClose", "WebFetch", "WebSearch"]) disabledToolNames.add(name);
	}
	if (currentExecutionProfile().kind === "container") for (const name of ["Rg", "CallMcpTool", "FetchMcpResource", "ListMcpResources", "SearchDocs"]) disabledToolNames.add(name);
	if (isSubagent) {
		// Prevent unbounded recursion of subagents.
		disabledToolNames.add("Task");
	}
	deferredBuiltins = new DeferredToolSchemas(archive,
		(chatOnly ? [] : schemasForMode(opts.mode)).filter(schema => OPTIONAL_BUILTIN_TOOLS.has(schema.function.name) && !disabledToolNames.has(schema.function.name)),
		new Set(persistedHistory.flatMap(step => step.kind === "assistant" ? step.calls.map(call => call.name) : [])),
		{ label: "optional built-in", thresholdChars: 0 });
	system = makeSystem();

	/**
	 * Tool block for a mode, built once and reused byte-for-byte for the rest of
	 * the run: the schemas sit in front of the messages in the cached prefix, so
	 * changing a description mid-run (as this used to do after step 0) throws away
	 * the whole prompt cache and quietly drops usage rules the model still needs.
	 */
	const schemaCache = new Map<Mode, ToolSchema[]>();
	const schemasFor = (m: Mode): ToolSchema[] => {
		if (chatOnly) return [];
		const hit = schemaCache.get(m);
		if (hit) return hit;
		const compact = (s: ToolSchema): ToolSchema => {
			if (VERBOSE_TOOL_DESCRIPTIONS.has(s.function.name) || s.function.description.length <= 240) return s;
			const first = s.function.description.split(/\n|(?<=[.!?])\s/)[0]?.trim();
			return {
				...s,
				function: { ...s.function, description: (first || `Use ${s.function.name} when needed.`).slice(0, 240) },
			};
		};
		const activeOptionalNames = new Set(deferredBuiltins!.activeSchemas().map(schema => schema.function.name));
		const built = [
			...schemasForMode(m).filter((s) => !disabledToolNames.has(s.function.name) && initialToolNames.has(s.function.name)
				&& (!OPTIONAL_BUILTIN_TOOLS.has(s.function.name) || activeOptionalNames.has(s.function.name))).map(compact),
			...(canExecuteMcp(m) ? deferredTools!.activeSchemas() : []),
		];
		schemaCache.set(m, built);
		return built;
	};
	/** Tokens the tool block costs on every request (part of the fill estimate). */
	const toolSchemaTokens = () => {
		const m = mode;
		let n = toolTokenCache.get(m);
		if (n === undefined) {
			n = Math.ceil(JSON.stringify(schemasFor(m)).length / 4);
			toolTokenCache.set(m, n);
		}
		return n;
	};
	const toolTokenCache = new Map<Mode, number>();

	/** Durable run record of everything this run did. */
	const ledger = new ActivityLedger();
	/** Step index of the last compaction, for the cooldown. */
	let lastCompactionStep = -Infinity;

	// Tools the current mode is permitted to invoke (ask/plan = read-only,
	// plan additionally gets write_plan, agent gets everything).
	const allowedNamesFor = () =>
		new Set(
			toolsForMode(mode)
				.map((t) => t.schema.function.name)
				.filter((n) => initialToolNames.has(n) && !disabledToolNames.has(n)),
		);

	const serverStates = () => (!chatOnly && typeof mcpManager.status === "function" ? mcpManager.status() : []).map(s => ({ name: s.name, state: s.connected ? "connected" : s.error ? "failed" : "disconnected" }));
	const capabilityText = () => {
		if (chatOnly) return chatOnlyCapabilities;
		const servers = serverStates();
		return `<capabilities>\nBuilt-in tools currently available: ${[...allowedNamesFor()].sort().join(", ")}.\nDisabled by settings: ${[...disabledToolNames].sort().join(", ") || "none"}.\nOther built-ins remain restricted by the selected mode and the run permission ceiling.\nMCP execution: ${canExecuteMcp(mode) ? "enabled" : "unavailable in this mode"}.\nConnected MCP namespaces: ${[...new Set(mcpSchemas.map(s => s.function.name.split("__")[1]))].sort().join(", ") || "none"}.\nMCP servers: ${servers.map(s => `${s.name}=${s.state}`).join(", ") || "none configured"}.\nMCP schemas: ${deferredTools?.isDeferred ? 'deferred; search ReadContext id="mcp" and read a schema to activate it' : "loaded"}.\nA namespace absent from this inventory is unavailable. Do not retry guessed names. ReadContext id="capabilities" refreshes this inventory after configuration or connection changes.\n</capabilities>`;
	};
	let baseUserInfo = cursorCtx.userInfo;
	const unavailableCapabilities = new Set<string>();
	let registryFingerprint = JSON.stringify([mcpSchemas, serverStates()]);
	const refreshCapabilities = () => {
		const next = readMcpSchemas();
		const fingerprint = JSON.stringify([next, serverStates()]);
		if (fingerprint === registryFingerprint) return;
		const active = new Set(deferredTools?.activeSchemas().map(s => s.function.name));
		mcpSchemas = next;
		registryFingerprint = fingerprint;
		unavailableCapabilities.clear();
		deferredTools = new DeferredToolSchemas(archive, next, active);
		schemaCache.clear();
		toolTokenCache.clear();
		system = makeSystem();
		cursorCtx = { ...cursorCtx, userInfo: `${baseUserInfo}\n\n${capabilityText()}`.trim() };
		pushSystemNote(`Tool registry changed.\n${capabilityText()}`);
	};
	cursorCtx = { ...cursorCtx, userInfo: `${baseUserInfo}\n\n${capabilityText()}`.trim() };
	const previousContext = [...history].reverse().find((s) => s.kind === "user" && !s.synthetic && s.context);
	if (enableWorkspaceContext !== false) for (const rule of await scopedInstructionsForPaths([])) instructionFingerprints.add(rule.fingerprint);
	pushHistory({ kind: "user", text: prompt,
		attachments: attachments?.length ? attachments.map(a => ({ ...a })) : undefined,
		context: snapshotUserContext({ ...cursorCtx, timestamp: runTimestamp, reminder: mode === "multitask" ? MULTITASK_REMINDER : mode === "project" ? PROJECT_REMINDER : undefined }, previousContext?.kind === "user" ? previousContext.context : undefined),
	});
	if (previousContext?.kind === "user" && previousContext.context) {
		if (previousContext.context.userInfo !== cursorCtx.userInfo) {
			pushSystemNote("The workspace and rule snapshot attached to the latest user turn replaces earlier environment snapshots. Instructions in the user's conversation remain applicable until explicitly superseded.");
		}
		if (previousContext.context.openFiles && !cursorCtx.openFiles) {
			pushSystemNote("No editor context is supplied for this turn; earlier editor snapshots are historical.");
		}
	}
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
	// Calibrate the character estimate from actual provider usage without using
	// stale occupancy from before compaction to trigger another summary.
	let promptTokenRatio = 1;
	const responseTokens = responseTokenReservation({ model, apiBaseUrl, maxTokens, anthropic, oauthKind, modelParams });

	try {
		await opts.onRunEvent?.({ type: "run-start", at: Date.now(), data: { runId: opts.runId ?? shellSessionKey, model, mode, workspaceRoot: getWorkspaceRoot() } });
		await onHook?.("sessionStart", { runId: opts.runId ?? shellSessionKey });
		if (opts.goal) pushSystemNote(`Active goal: ${opts.goal.objective}\nGoal status: ${opts.goal.status}. ${opts.goal.tokenBudget ? `Token budget: ${opts.goal.tokenBudget}; used: ${tokensUsed}.` : ""}`);
		let finalText = "";
		let planWritten = false;
		let planNudgeCount = 0;
		const MAX_PLAN_NUDGES = 1;
		// Bound recovery nudges when the model keeps returning without tools.
		let consecutiveTextTurns = 0;
		const CONSECUTIVE_TEXT_LIMIT = 3;
		// Hard cap on total nudge injections per run to prevent infinite re-nudge.
		let nudgeCount = 0;
		const MAX_NUDGES = 3;
		let todoNudged = false;
		const retrievalProgress = new RetrievalProgress();

		// Feed already-finished (but unreported) background subagent results into the
		// conversation, so the model always knows what has completed. Returns count.
		const flushSettledBg = (): number => {
			const done = background.drain();
			if (done.length) {
				retrievalProgress.reset();
				pushSystemNote(
					`Background subagent${done.length > 1 ? "s" : ""} finished — results below.\n\n${done.map((v) => `### ${v.title} (task ${v.id})\n${v.text}`).join("\n\n")}`,
				);
			}
			return done.length;
		};

		const bgPending = () => background.pending;

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

		/** Yield only when the parent has no useful tool work; deliver any ready child. */
		const awaitPendingBg = async (): Promise<boolean> => {
			if (!bgPending()) return false;
			if (flushSettledBg()) return true;
			emit({ type: "shell-notify", message: `Waiting for a result from ${background.active} background task(s)…` });
			await raceAbort(background.waitForNext());
			if (signal.aborted) background.cancelAll();
			flushSettledBg();
			return true;
		};

		// Summarize only the older working context; an earlier summary already lives
		// there. Sending it separately as well would pay for and summarize it twice.
		const summarizeSteps = async (steps: Step[]): Promise<string> => {
			const sys =
				"Summarize this coding session for the next working turn. Preserve user intent, constraints, " +
				"decisions, changed file paths, test outcomes, errors, and unfinished work. Distinguish observed " +
				"facts from assumptions. Keep archive references when relevant. Merge any existing summary once. " +
				"Use concise bullets; omit narration, reasoning traces, and file bodies. Do not invent details.";
			const summaryModel = subagentModel && (!availableModels?.length || availableModels.some(m => m.toLowerCase() === subagentModel.toLowerCase())) ? subagentModel : model;
			const summaryConfig = summaryModel === model ? { contextTokens, modelParams } : opts.resolveModelOptions?.(summaryModel) ?? {};
			const summaryMaxTokens = 1536;
			const summaryBudget = summaryConfig.contextTokens && summaryConfig.contextTokens > 0
				? Math.floor((summaryConfig.contextTokens - summaryMaxTokens - 1024) / promptTokenRatio) - Math.ceil(sys.length / 4)
				: 24000;
			const transcript = clip(stepsToTranscript(steps), Math.max(256, Math.min(24000, summaryBudget) * 4));
			let text = "";
			for await (const ev of streamChat({
				apiBaseUrl,
				apiKey,
				model: summaryModel,
				apiKeyPool: opts.apiKeyPool,
				messages: [
					{ role: "system", content: sys },
					{ role: "user", content: transcript },
				],
				maxTokens: summaryMaxTokens,
				modelParams: summaryConfig.modelParams,
				anthropic,
				oauthKind,
				signal,
				maxRetries: 2,
				promptCacheKey: `${opts.promptCacheKey ?? shellSessionKey}/summary`,
			})) {
				if (ev.type === "text-delta") text += ev.text;
				if (ev.type === "usage") {
					// Compression is billed too; include it in run usage without
					// confusing its small prompt with the active context occupancy.
					emit({ ...ev, type: "usage", model: ev.model ?? summaryModel, source: "summary", promptTokens: ev.promptTokens ?? 0, completionTokens: ev.completionTokens ?? 0, totalTokens: lastPrompt + lastCompletion });
				}
			}
			if (!text.trim()) throw new Error("empty summary");
			return text.trim();
		};

		const stepLimit = maxSteps && maxSteps > 0 ? maxSteps : MAX_STEPS;
		// Hard cap: even with autoContinue, never exceed this absolute maximum
		// to prevent infinite loops (e.g. stuck in nudge echo chamber).
		const HARD_CAP = Math.max(stepLimit, MAX_STEPS) * 2;
		const canContinueAt = (step: number) => !signal.aborted && !budgetExhausted()
			&& step < HARD_CAP && (autoContinue || step < stepLimit);
		const consumeSteering = async (nextStep: number): Promise<boolean> => {
			if (!canContinueAt(nextStep)) return false;
			const messages = await opts.drainSteering?.() ?? [];
			let consumed = false;
			for (const steering of messages) {
				// A durable host mailbox may need to flush storage before returning.
				// Leave unconsumed entries pending if Stop or a shared budget wins.
				if (!canContinueAt(nextStep)) break;
				pushHistory({ kind: "user", text: steering });
				await opts.onRunEvent?.({ type: "steering", at: Date.now(), data: { text: steering, runId: opts.runId ?? shellSessionKey } });
				consumed = true;
			}
			if (consumed) {
				consecutiveTextTurns = 0;
				retrievalProgress.reset();
			}
			return consumed;
		};
		let hitStepLimit = false;
		for (let step = 0; ; step++) {
			if (budgetExhausted()) {
				if (opts.goal) opts.goal.status = "budgetLimited";
				opts.onGoalStatus?.("budgetLimited");
				finalText = opts.goal?.tokenBudget ? `Paused at the goal token budget (${tokensUsed}/${opts.goal.tokenBudget}). Completed work is retained.` : "Paused at the parent goal token budget. Completed work is retained.";
				for (const active of activeAgents.values()) active.abort.abort();
				pushSystemNote(finalText);
				break;
			}
			if (step >= HARD_CAP || (!autoContinue && step >= stepLimit)) {
				hitStepLimit = true;
				break;
			}
			if (signal.aborted) {
				emitSettled("cancelled");
				return;
			}
			await consumeSteering(step);
			if (signal.aborted) {
				emitSettled("cancelled");
				return;
			}
			if (budgetExhausted()) continue;

			// Any background subagents that finished while the model was busy? Report
			// them now so it never reasons about "still running" work that's done.
			flushSettledBg();
			refreshCapabilities();

			// Refresh mutable workspace context before accounting for it in the budget.
			if (!isSubagent && enableWorkspaceContext !== false && step > 0 && step % 6 === 0) {
				try {
					const fresh = await buildOpenFilesBlock();
					if (fresh !== cursorCtx.openFiles) {
						cursorCtx = { ...cursorCtx, openFiles: fresh };
						pushSystemNote(`Editor context updated:\n${fresh || "No open editor context is currently available."}`);
					}
				} catch { /* context is best-effort */ }
			}
			const limitedContext = !!contextTokens && contextTokens > 0;
			const budget = limitedContext
				? Math.max(0, contextTokens! - responseTokens - 1024)
				: 0;
			const fittingBudget = Math.floor(budget / promptTokenRatio);
			const overheadTokens = Math.ceil(system.length / 4) + toolSchemaTokens() + 128;
			const latestUser = [...history].reverse().find(s => s.kind === "user" && !s.synthetic);
			const requiredContextTokens = latestUser?.kind === "user" && latestUser.context ? stepsTokens([{ kind: "user", text: "", context: latestUser.context }]) : 0;
			if (limitedContext && fittingBudget <= overheadTokens + requiredContextTokens + 64) {
				throw new Error("The context window is too small for the instructions, tools, and response limit. Increase the context window or reduce the response limit or workspace instructions.");
			}

			// Keep completed tool exchanges verbatim while the prompt fits. Rewriting
			// old results on every turn loses findings and invalidates cached prefixes.
			economizeHistory(history);
			let modelHistory = history;
			let contextReduced = false;
			if (limitedContext && stepsTokens(modelHistory) + overheadTokens > fittingBudget) {
				modelHistory = archive.prepareSteps(history);
				contextReduced = true;
			}
			const usedEst = stepsTokens(modelHistory) + overheadTokens;
			const cooledDown = step - lastCompactionStep >= COMPACT_COOLDOWN_STEPS;
			const shouldCompact = limitedContext && cooledDown && (
				usedEst >= fittingBudget * COMPACT_AT_FILL ||
				(usedEst >= fittingBudget * COMPACT_SOFT_FILL && isCompactionBoundary(modelHistory))
			);
			if (shouldCompact) {
				const keepTokens = Math.min(24000, Math.floor((fittingBudget - overheadTokens) * COMPACT_KEEP_FRAC));
				const { prefix, tail } = splitForCompaction(modelHistory, keepTokens);
				// Anchors may occur in both pieces. Count only what actually leaves the
				// prompt, and leave enough room for the summary itself to be worthwhile.
				const gain = stepsTokens(modelHistory) - stepsTokens(tail);
				if (prefix.length >= 2 && gain >= Math.max(2048, fittingBudget * COMPACT_MIN_GAIN_FRAC)) {
					lastCompactionStep = step; // Cool down failed summaries too.
					onHook?.("preCompact", { dropped: String(prefix.length), reason: "auto-summarize" });
					emit({ type: "compaction", status: "running" });
					try {
						const summary = await summarizeSteps(prefix);
						history.splice(0, history.length, {
							kind: "user",
							synthetic: true,
							text: `Earlier conversation summary (verify details when needed):\n${summary}\n\nFull transcript: ReadContext {"id":"history"}; use pattern or line ranges to recover details.`,
						}, ...tail, {
							kind: "user", synthetic: true,
							text: `Current context restored after compaction (supersedes older environment snapshots):\n${cursorCtx.userInfo}\n${cursorCtx.openFiles}\n\n${ledger.render({ request: currentRequestText(history), todos: toolCtx.todos })}`,
						});
						modelHistory = history;
						contextReduced = true;
						emit({ type: "compaction", status: "done", summary });
						await onHook?.("postCompact", { summary }, undefined, signal);
					} catch {
						emit({ type: "compaction", status: "failed" });
					}
				}
			}
			// Group call/results even without a configured limit: tool execution can
			// append mode or background notes before all siblings have settled.
			const fitted = limitedContext
				? fitStepsToBudget(modelHistory, overheadTokens, fittingBudget)
				: fitStepsToBudget(modelHistory, 0, Number.MAX_SAFE_INTEGER);
			if (!fitted.some((s) => s.kind === "user" && !s.synthetic)) {
				throw new Error("The current request cannot fit in the context window. Increase the context window or reduce the attached context.");
			}
			if (fitted.length < modelHistory.length) {
				onHook?.("preCompact", { dropped: String(modelHistory.length - fitted.length) });
			}
			if (contextReduced || fitted.length !== history.length || fitted.some((entry, index) => entry !== history[index])) {
				// Freeze the exact working prefix sent below, including emergency budget
				// fitting. Later turns and restored chats append to it instead of bringing
				// back full originals that would immediately need rewriting again.
				history.splice(0, history.length, ...fitted);
				if (opts.contextState) saveContext(persistedHistory, history, opts.contextState);
			}
			const messages = buildMessages(system, fitted);
			const requestTokenEstimate = stepsTokens(fitted) + overheadTokens;

			let assistantText = "";
			let thinking = "";
			let responsesReasoning: ResponsesReasoning | undefined;
			let chatReasoning: ChatReasoning | undefined;
			let finishReason = "";
			const calls: ToolCall[] = [];
			// Map provider stream index → call id, so streamed args route to the
			// already-announced tool card in the UI.
			const callIdByIndex = new Map<number, string>();
			const argsByIndex = new Map<number, string>();

			const activeTools = schemasFor(mode);

			// Persist received content even when the stream throws on Stop or disconnect.
			let streamCompleted = false;
			try {
				for await (const ev of streamChat({
					apiBaseUrl,
					apiKey,
					model,
					apiKeyPool: opts.apiKeyPool,
					messages,
					tools: activeTools,
					maxTokens,
					promptCacheKey: opts.promptCacheKey ?? shellSessionKey,
					sampling,
					modelParams,
					anthropic,
					oauthKind,
					signal,
					onRetry: (attempt, max, delayMs, error) => emit({ type: "retry", attempt, max, delayMs, error }),
				})) {
					if (chatOnly && (ev.type === "tool-call" || ev.type === "tool-call-start" || ev.type === "tool-call-args-delta")) {
						throw new Error("This chat-only provider returned an unsupported tool call. No action was executed.");
					}
					if (ev.type === "text-delta") {
						assistantText += ev.text;
						emit({ type: "text-delta", text: ev.text });
					} else if (ev.type === "thinking-delta") {
						thinking += ev.text;
						emit({ type: "thinking-delta", text: ev.text });
					} else if (ev.type === "responses-reasoning") {
						// The provider emits complete opaque state after validating the
						// terminal response. Keep it for tool continuations, outside the UI.
						responsesReasoning = ev.reasoning;
					} else if (ev.type === "chat-reasoning") {
						chatReasoning = ev.reasoning;
					} else if (ev.type === "tool-call-start") {
						// Surface the tool card the moment the model commits to a call.
						// No startedAt yet — countdown begins when execute actually starts.
						callIdByIndex.set(ev.index, ev.id);
						argsByIndex.set(ev.index, "");
						const name = resolveToolName(ev.name, [...Object.keys(TOOLS), ...mcpSchemas.map(s => s.function.name)]);
						const tMs = toolTimeoutMs(name);
						emit({
							type: "tool-call-started",
							callId: ev.id,
							name,
							input: {},
							timeoutMs: tMs > 0 ? tMs : undefined,
						});
					} else if (ev.type === "tool-call-args-delta") {
						const id = callIdByIndex.get(ev.index);
						const acc = (argsByIndex.get(ev.index) ?? "") + ev.delta;
						argsByIndex.set(ev.index, acc);
						if (id) emit({ type: "tool-call-args", callId: id, argsText: acc });
					} else if (ev.type === "tool-call") {
						calls.push({ ...ev.call, name: resolveToolName(ev.call.name, [...Object.keys(TOOLS), ...mcpSchemas.map(s => s.function.name)]) });
					} else if (ev.type === "usage") {
						lastPrompt = ev.promptTokensTotal ?? ev.promptTokens ?? lastPrompt;
						if (lastPrompt && requestTokenEstimate > 0) {
							promptTokenRatio = Math.max(1, lastPrompt / requestTokenEstimate);
						}
						lastCompletion = ev.completionTokensTotal ?? ev.completionTokens ?? lastCompletion;
						// Live-update the ring after every step. prompt/completion carry
						// this step's delta (usage tracking accumulates them); totalTokens
						// is the current context occupancy.
						emit({ ...ev, type: "usage", model: ev.model ?? model, source: "parent", promptTokens: ev.promptTokens ?? 0, completionTokens: ev.completionTokens ?? 0, totalTokens: lastPrompt + lastCompletion });
					} else if (ev.type === "done") {
						finishReason = ev.finishReason || "";
					}
				}

				streamCompleted = true;
			} finally {
				// Partial argument deltas are UI previews, never executable tool calls.
				// Complete calls receive a cancellation result in cleanup if unexecuted.
				if (streamCompleted || assistantText || thinking || calls.length) {
					pushHistory({
						kind: "assistant", text: assistantText, calls,
						...(thinking ? { thinking } : {}),
						...(responsesReasoning ? { responsesReasoning } : {}),
						...(chatReasoning ? { chatReasoning } : {}),
					});
				}
			}

			if (!calls.length) {
				// A follow-up may arrive while the response is streaming. Consume it
				// before treating this answer as final, without cancelling the request.
				if (await consumeSteering(step + 1)) continue;
				if (signal.aborted || budgetExhausted()) continue;
				consecutiveTextTurns++;
				// Background work must settle before the model can give its final answer.
				if (bgPending()) {
					await awaitPendingBg();
					if (signal.aborted) {
						emitSettled("cancelled");
						return;
					}
					consecutiveTextTurns = 0;
					continue;
				}
				const canNudge = nudgeCount < MAX_NUDGES && consecutiveTextTurns < CONSECUTIVE_TEXT_LIMIT;
				// Recover only when there is evidence the response is unfinished.
				if (canNudge && isAgentic() && /length|max_tokens|max_output_tokens/i.test(finishReason)) {
					nudgeCount++;
					pushSystemNote(
						"Your previous response was cut off because it hit the output-token limit. Continue exactly where you left off; re-issue any tool call that was truncated.",
					);
					continue;
				}
				if (canNudge && mode === "plan" && !planWritten && planNudgeCount < MAX_PLAN_NUDGES) {
					planNudgeCount++;
					nudgeCount++;
					pushSystemNote(
						"You are in PLAN MODE and have not written the plan yet. Call the WritePlan tool now with a title and the complete Markdown plan. Do not respond with the plan as plain text — it must be saved via WritePlan.",
					);
					continue;
				}
				const incompleteTodos = toolCtx.todos.filter((t) => t.status === "pending" || t.status === "in_progress");
				if (canNudge && !todoNudged && !retrievalProgress.wrapUpRequested && isAgentic() && incompleteTodos.length > 0) {
					todoNudged = true;
					nudgeCount++;
					pushSystemNote(
						`You have ${incompleteTodos.length} incomplete todo(s). Consult task_state or TodoRead if needed. ` +
						"Continue any remaining work. If it is complete, update the todo list; if you are blocked, explain what is needed.",
					);
					continue;
				}
				if (canNudge && isAgentic() && !assistantText.trim() && thinking.trim()) {
					nudgeCount++;
					pushSystemNote(
						"You produced only internal reasoning with no answer or tool calls. Continue working on the task now — make the necessary tool calls, or reply with your final answer if fully finished.",
					);
					continue;
				}
				const prev = history[history.length - 2];
				if (canNudge && isAgentic() && !assistantText.trim() && !thinking.trim() && prev?.kind === "tool-result") {
					nudgeCount++;
					pushSystemNote(
						"If you need to make more tool calls to complete the task, please do so now. If you are fully finished, reply normally without calling any tools.",
					);
					continue;
				}
				// A normal answer ends the run, even if the task did not need a todo list.
				finalText = assistantText;
				break;
			} else {
				consecutiveTextTurns = 0;
			}

			let deferScopedMutations = false;
			const parsed = calls.map((call) => {
				let input: any = {};
				let badArgs = "";
				const resolvedName = resolveToolName(call.name, [...Object.keys(TOOLS), ...mcpSchemas.map(s => s.function.name)]);
				try {
					input = normalizeToolPaths(resolvedName, JSON.parse(call.arguments || "{}"), getWorkspaceRoot());
					const schema = Object.hasOwn(TOOLS, resolvedName) ? TOOLS[resolvedName].schema : mcpSchemas.find(s => s.function.name === resolvedName);
					badArgs = validateToolInput(schema, input) ?? "";
					if (!schema) badArgs += ` Available tool names: ${activeTools.map(tool => tool.function.name).join(", ")}. Copy an exact name from this list without adding a suffix or namespace.`;
				} catch {
					// Truncated/invalid args JSON (common on very large edits). Executing
					// with {} would call tools with missing params — fail the call instead.
					badArgs = "Arguments must be complete, valid JSON. Reissue the complete call.";
				}
				// MCP tools share CallMcpTool budget when no per-name override.
				const tMs = resolvedName.startsWith("mcp__")
					? toolTimeoutMs("CallMcpTool")
					: toolTimeoutMs(resolvedName);
				// Shell foreground expiry backgrounds the command; it is not the tool's
				// hard timeout. Keep the outer safety budget so cleanup can return smoothly.
				let timeoutMs = tMs > 0 ? tMs : undefined;
				// Task: no outer timeout — nested tool calls already time out individually.
				// Announce card; startedAt set when exec actually begins.
				emit({
					type: "tool-call-started",
					callId: call.id,
					name: resolvedName,
					input,
					timeoutMs,
				});
				return { call, input, badArgs, timeoutMs, resolvedName };
			});

			const results = new Array<{ status: "completed" | "error"; output: string; diff?: string; startLine?: number; endLine?: number; outcome?: ToolOutcome; image?: { mime: string; base64: string } }>(parsed.length);
			const completedUi = new Set<number>();
			const recordedResults = new Map<number, Step>();
			const finishUi = (i: number) => {
				if (completedUi.has(i) || !results[i]) return;
				completedUi.add(i);
				const { call, resolvedName } = parsed[i];
				const r = results[i];
				// Persist each observation before announcing it. A stopped sibling or
				// extension reload must not leave visible results out of model history.
				const resultStep: Step = { kind: "tool-result", callId: call.id, name: resolvedName, output: r.output, status: r.status, outcome: r.outcome, image: r.image };
				recordedResults.set(i, resultStep);
				// Siblings may settle out of order. Order this unsent batch by call
				// index while leaving the entire previously requested prefix intact.
				const nextIndex = [...recordedResults.keys()].filter(index => index > i).sort((a, b) => a - b)[0];
				const nextResult = recordedResults.get(nextIndex);
				if (nextResult) {
					history.splice(history.indexOf(nextResult), 0, resultStep);
					persistedHistory.splice(persistedHistory.indexOf(nextResult), 0, resultStep);
				} else pushHistory(resultStep);
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
					outcome: r.outcome,
				});
			};

			const exec = async (i: number) => {
				const { call, input, badArgs, resolvedName } = parsed[i];
				if (budgetExhausted()) { results[i] = { status: "error", output: "error: goal token budget exhausted before tool execution; no action executed" }; return; }
				if (signal.aborted) {
					results[i] = { status: "error", output: "error: cancelled before tool execution" };
					return;
				}
				if (badArgs) {
					results[i] = {
						status: "error",
						output: `error: invalid tool call; nothing was executed. ${badArgs}`,
					};
					finishUi(i);
					return;
				}
				for (const candidate of [input.path, input.target_notebook, input.downloadPath, input.working_directory, input.target_directory, ...(Array.isArray(input.paths) ? input.paths : []), ...(Array.isArray(input.target_directories) ? input.target_directories : [])]) {
					if (typeof candidate === "string") {
						try { assertExecutionPath(candidate); }
						catch (error) { results[i] = { status: "error", output: `error: ${error instanceof Error ? error.message : String(error)}` }; return; }
					}
				}
				if (enableWorkspaceContext !== false) {
					const paths = [input.path, input.target_notebook, input.downloadPath, input.working_directory, ...(Array.isArray(input.paths) ? input.paths : [])].filter((p): p is string => typeof p === "string");
					const discovered = (await scopedInstructionsForPaths(paths)).filter(rule => !instructionFingerprints.has(rule.fingerprint));
					if (discovered.length) {
						deferScopedMutations = true;
						for (const rule of discovered) instructionFingerprints.add(rule.fingerprint);
						const instructions = renderScopedInstructions(discovered);
						baseUserInfo += `\n${instructions}`;
						pushSystemNote(`New applicable repository instructions; preserve their file scope:\n${instructions}`);
						cursorCtx = { ...cursorCtx, userInfo: `${cursorCtx.userInfo}\n${instructions}` };
						if (TOOLS[resolvedName]?.mutating) {
							results[i] = { status: "error", output: `No action executed. Newly discovered scoped instructions must be considered before retrying:\n${instructions}` };
							return;
						}
					}
				}
				if (deferScopedMutations && TOOLS[resolvedName]?.mutating) { results[i] = { status: "error", output: "No action executed. Consider the newly supplied scoped instructions and retry this action in the next turn." }; return; }
				const preToolVeto = await onHook?.("preToolUse", { tool: resolvedName, tool_input: JSON.stringify(input) }, resolvedName, signal);
				if (preToolVeto) { results[i] = { status: "error", output: `blocked by hook: ${preToolVeto}` }; return; }
				await opts.onRunEvent?.({ type: "tool-intent", at: Date.now(), data: { callId: call.id, name: resolvedName, input } });
				// MCP tool dispatch (same hard timeout + countdown as built-ins).
				if (resolvedName.startsWith("mcp__") || resolvedName === "CallMcpTool") {
					const mcpName = resolvedName === "CallMcpTool" ? `mcp__${String(input.server ?? "").trim()}__${String(input.toolName ?? "").trim()}` : resolvedName;
					const mcpInput = resolvedName === "CallMcpTool" ? input.arguments ?? {} : input;
					if (resolvedName === "CallMcpTool" && (!input.server || !input.toolName)) {
						results[i] = { status: "error", output: "error: CallMcpTool requires server and toolName" };
						return;
					}
					if (!canExecuteMcp(mode)) {
						// MCP tools may mutate; only allow in agentic modes. Multitask is a
						// coordinator and must delegate MCP work to subagents.
						results[i] = { status: "error", output: `MCP tools not allowed in ${mode} mode` };
						return;
					}
					const actualMcpSchema = mcpSchemas.find(s => s.function.name === mcpName);
					if (!actualMcpSchema) {
						const namespace = mcpName.split("__")[1];
						const key = mcpSchemas.some(s => s.function.name.startsWith(`mcp__${namespace}__`)) ? mcpName : `namespace ${namespace}`;
						const repeated = unavailableCapabilities.has(key);
						unavailableCapabilities.add(key);
						results[i] = { status: "error", output: repeated
							? `error: ${key} remains unavailable; the registry has not changed. Choose an available capability instead of retrying names.`
							: `error: ${mcpName} is unavailable in the current tool registry. Do not retry guessed names. Use ReadContext id="capabilities" if configuration has changed, or choose an available tool.` };
						return;
					}
					const invalidMcpInput = validateToolInput(actualMcpSchema, mcpInput);
					if (invalidMcpInput) {
						results[i] = { status: "error", output: `error: invalid MCP arguments; nothing was executed. ${invalidMcpInput}` };
						return;
					}
					// Approval policy decides silently (allow/deny) or prompts (ask/review).
					if (approve) {
						const veto = await onHook?.("permissionRequest", { tool: mcpName, tool_input: JSON.stringify(mcpInput) }, mcpName, signal);
						if (veto) {
							await opts.onRunEvent?.({ type: "approval", at: Date.now(), data: { callId: call.id, name: mcpName, approved: false, reason: "permission-hook" } });
							results[i] = { status: "error", output: `blocked by permission hook: ${veto}` }; return;
						}
						const approval = await approve(mcpName, mcpInput, call.id);
						await opts.onRunEvent?.({ type: "approval", at: Date.now(), data: { callId: call.id, name: mcpName, approved: approval === true } });
						if (approval !== true) {
							results[i] = { status: "error", output: `user denied ${call.name}` };
							return;
						}
					}
					// beforeMCPExecution hook (may veto).
					const mcpVeto = await onHook?.("beforeMcp", { tool: mcpName, tool_input: JSON.stringify(mcpInput) }, mcpName, signal);
					if (mcpVeto) {
						results[i] = { status: "error", output: `blocked by hook: ${mcpVeto}` };
						return;
					}
					const limitMs = parsed[i].timeoutMs ?? toolTimeoutMs("CallMcpTool");
					const toolAc = new AbortController();
					const killTool = () => { try { toolAc.abort(); } catch { /* ignore */ } };
					if (registerSubagentAbort) registerSubagentAbort(call.id, () => killTool());
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
							Promise.resolve().then(() => { toolAc.signal.throwIfAborted(); return mcpManager.callToolDetailed(mcpName, mcpInput, toolAc.signal); }),
							limitMs,
							call.name,
							() => {
								killTool();
								results[i] = {
									status: "error",
									output: `error: timeout: ${call.name} exceeded ${Math.round((limitMs || 0) / 1000)}s. MCP cancellation was requested; the server may already have completed the action.`,
								};
								finishUi(i);
							},
							toolAc.signal,
						);
						if (completedUi.has(i)) return;
						const image = firstMcpImage(out.content);
						const imageCount = out.content.filter(content => content.type === "image" || (content.type === "resource" && "blob" in content.resource && content.resource.mimeType?.startsWith("image/"))).length;
						const omittedImages = imageCount - (image ? 1 : 0);
						results[i] = { status: out.isError ? "error" : "completed", output: formatMcpToolResult(out) + (omittedImages > 0 ? `\n${omittedImages} additional, unsupported, malformed, or oversized image(s) were not sent to the model.` : ""), image, outcome: { status: out.isError ? "failed" : "completed" } };
						finishUi(i);
					} catch (e) {
						const msg = e instanceof Error ? e.message : String(e);
						logError("tool.mcp", e, { tool: call.name, callId: call.id });
						if (completedUi.has(i)) return;
						results[i] = {
							status: "error",
							output: msg.startsWith("aborted:") || signal.aborted ? "error: cancelled; MCP cancellation was requested, but the server may already have completed the action." : msg.startsWith("timeout:")
								? `error: timeout: ${call.name} exceeded ${Math.round((limitMs || 0) / 1000)}s. MCP cancellation was requested; the server may already have completed the action.`
								: `error: ${msg}`,
						};
						finishUi(i);
					} finally {
						signal.removeEventListener("abort", onParentAbort);
					}
					return;
				}
				let tool = TOOLS[resolvedName];
				if (!tool || disabledToolNames.has(resolvedName)) {
					results[i] = { status: "error", output: `unknown or disabled tool: ${call.name}` };
					return;
				}
				// Multitask/project are coordinators: they can read/search/manage todos but
				// must never mutate files or the shell — delegate that to a subagent.
				if (isCoordinator() && !MULTITASK_TOOLS.has(resolvedName)) {
					results[i] = {
						status: "error",
						output: `tool ${resolvedName} not allowed in ${mode} mode — delegate file/shell edits to a background subagent with the Task tool.`,
					};
					return;
				}
				if (!allowedNamesFor().has(resolvedName)) {
					results[i] = { status: "error", output: `tool ${resolvedName} not allowed in ${mode} mode` };
					return;
				}
				// Approval gate: every policy-covered action consults the approver, which
				// resolves the per-type policy (allow silently / ask / deny) itself.
				const isEditTool = resolvedName === "WritePlan" || EDIT_TOOLS.has(resolvedName) || (resolvedName === "FetchMcpResource" && !!input.downloadPath);
				// Per-call action type: also gates ungated tools (e.g. Read) when they
				// target paths outside the workspace.
				const needsApproval = actionTypeForCall(resolvedName, input, getWorkspaceRoot()) !== undefined;
				if (needsApproval && approve) {
					const veto = await onHook?.("permissionRequest", { tool: resolvedName, tool_input: JSON.stringify(input) }, resolvedName, signal);
					if (veto) { results[i] = { status: "error", output: `blocked by permission hook: ${veto}` }; return; }
					const approval = await approve(resolvedName, input, call.id);
					await opts.onRunEvent?.({ type: "approval", at: Date.now(), data: { callId: call.id, approved: approval === true } });
					if (approval !== true) {
						const denied = approval && typeof approval === "object"
							? `user denied/blocked "${approval.blockedSubject}"`
							: `user denied ${resolvedName}`;
						results[i] = { status: "error", output: `${denied}; try a different approach or ask the user` };
						return;
					}
				}
				if (signal.aborted) {
					results[i] = { status: "error", output: "error: cancelled before tool execution" };
					return;
				}
				if (resolvedName === "FetchMcpResource") {
					const veto = await onHook?.("beforeMcp", { server: String(input.server ?? ""), uri: String(input.uri ?? ""), tool_input: JSON.stringify(input) }, resolvedName, signal);
					if (veto) { results[i] = { status: "error", output: `blocked by hook: ${veto}` }; return; }
				}
				if (isEditTool && resolvedName !== "FetchMcpResource") {
					const nativeTool = resolvedName === "StrReplace" ? "Edit" : resolvedName === "EditNotebook" ? "NotebookEdit" : resolvedName === "Delete" ? "Delete" : "Write";
					const editPath = String(input.path ?? input.target_notebook ?? input.downloadPath ?? (resolvedName === "WritePlan" ? planRelativePath(input.title) : ""));
					const nativeInput = { ...input, file_path: editPath,
						...(resolvedName === "Write" ? { content: input.contents } : {}),
						...(resolvedName === "WritePlan" ? { content: `# ${String(input.title || "Plan").trim()}\n\n${String(input.content || "").trim()}\n` } : {}),
						...(resolvedName === "EditNotebook" ? { notebook_path: editPath, new_source: input.new_string } : {}),
					};
					const veto = await onHook?.("beforeEdit", { path: editPath, tool_input: JSON.stringify(nativeInput) }, nativeTool, signal);
					if (veto) { results[i] = { status: "error", output: `blocked by hook: ${veto}` }; return; }
				}
				// beforeShell hook (may veto).
				if ((resolvedName === "Shell" || resolvedName === "RunChecks") && onBeforeShell) {
					const veto = await onBeforeShell(String(input?.command ?? ""), signal);
					if (veto) {
						results[i] = { status: "error", output: `blocked by hook: ${veto}` };
						return;
					}
				}
				// beforeReadFile hook (may veto).
				if (resolvedName === "Read") {
					const veto = await onHook?.("beforeReadFile", { path: String(input?.path ?? "") }, "Read", signal);
					if (veto) {
						results[i] = { status: "error", output: `blocked by hook: ${veto}` };
						return;
					}
				}
				try {
					// Per-tool hard timeout + linked abort. On timeout: kill immediately
					// and settle UI — never leave the card spinning "Working".
					const limitMs = parsed[i].timeoutMs ?? toolTimeoutMs(resolvedName);
					const toolAc = new AbortController();
					const killTool = (reason?: Error) => {
						try { toolAc.abort(reason); } catch { /* ignore */ }
					};
					// Register so UI countdown-0 / cancelSubagent can kill any tool.
					if (registerSubagentAbort) {
						registerSubagentAbort(call.id, () => killTool());
					}
					// Countdown clock starts now (not when the card was announced).
					emit({
						type: "tool-call-started",
						callId: call.id,
						name: resolvedName,
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
							Promise.resolve().then(() => { toolAc.signal.throwIfAborted(); return tool.execute(input, toolAc.signal, call.id, toolCtx); }),
							limitMs,
							resolvedName,
							() => {
								timedOut = true;
								killTool(Object.assign(new Error("timeout: tool deadline exceeded"), { name: "TimeoutError" }));
								// Immediate UI settle on timeout — don't wait for tool cleanup.
								{
									results[i] = {
										status: "error",
										outcome: failedOutcome(call.id, "timed_out"),
										output: failureText(call.id, `error: timeout: ${resolvedName} exceeded ${Math.round((limitMs || 0) / 1000)}s. Tool aborted - retry with a narrower scope or shorter command.`),
									};
								}
								finishUi(i);
							},
							// Also settle when UI cancelSubagent aborts (countdown-0), not only wall timer.
							toolAc.signal,
						);
					} catch (e) {
						const msg = e instanceof Error ? e.message : String(e);
						logError("tool.execute", e, { tool: resolvedName, callId: call.id });
						const wasAborted = toolAc.signal.aborted;
						try { toolAc.abort(); } catch { /* ignore */ }
						const isTo = timedOut || msg.startsWith("timeout:");
						const cancelled = !isTo && (wasAborted || signal.aborted || msg.startsWith("aborted:"));
						{
							r = {
								outcome: failedOutcome(call.id, cancelled ? "aborted" : isTo ? "timed_out" : "failed"),
								output: failureText(call.id, cancelled ? "error: cancelled" : isTo
									? `error: timeout: ${resolvedName} exceeded ${Math.round((limitMs || 0) / 1000)}s. Tool aborted - retry with a narrower scope or shorter command.`
									: `error: ${msg}`),
							};
						}
					} finally {
						signal.removeEventListener("abort", onParentAbort);
					}
					// Timeout path already set results + finishUi; don't overwrite with a late success.
					if (timedOut || completedUi.has(i)) {
						if (!results[i]) {
							{
								results[i] = {
									status: "error",
									outcome: failedOutcome(call.id, "timed_out"),
									output: failureText(call.id, `error: timeout: ${resolvedName} exceeded ${Math.round((limitMs || 0) / 1000)}s. Tool aborted - retry with a narrower scope or shorter command.`),
								};
							}
						}
						finishUi(i);
						return;
					}
					const status: "completed" | "error" = (r.output.startsWith("error:") || (r.outcome && ["failed", "aborted", "timed_out"].includes(r.outcome.status))) ? "error" : "completed";
					results[i] = { status, output: r.output, diff: r.diff, startLine: r.startLine, endLine: r.endLine, outcome: r.outcome, image: r.image };
					if (status === "completed" && isEditTool) toolCtx.verification!.changedFile(String(input.path ?? input.target_notebook ?? input.downloadPath ?? "plan"));
					if (resolvedName === "Shell" && /\b(test|pytest|vitest|jest|lint|tsc|typecheck|check|build|verify)\b/i.test(String(input.command))) toolCtx.verification!.check(String(input.command), r.outcome);
					if (resolvedName === "AwaitShell" || resolvedName === "WriteStdin") toolCtx.verification!.settle(r.outcome);
					// afterEdit hook on successful edits.
					if (status === "completed" && isEditTool && onAfterEdit) {
						onAfterEdit(String(input?.path ?? input?.target_notebook ?? input?.downloadPath ?? (resolvedName === "WritePlan" ? planRelativePath(input.title) : "")));
					}
					// Immediate UI settle (especially on timeout) — do not wait for siblings.
					finishUi(i);
				} catch (e) {
					logError("tool.lifecycle", e, { tool: resolvedName, callId: call.id });
					results[i] = { status: "error", output: `error: ${e instanceof Error ? e.message : String(e)}` };
					finishUi(i);
				}
			};

			// Early-exit paths inside exec that set results without finishUi.
			const wrapExec = async (i: number) => {
				try {
					await exec(i);
					await opts.onRunEvent?.({ type: "tool-result", at: Date.now(), data: { callId: parsed[i].call.id, name: parsed[i].resolvedName, result: results[i] } });
					await onHook?.("postToolUse", { tool: parsed[i].resolvedName, tool_input: JSON.stringify(parsed[i].input), tool_result: JSON.stringify(results[i]) }, parsed[i].resolvedName, signal);
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
				const resolvedName = parsed[i].resolvedName;
				const r = results[i] ?? { status: "error" as const, output: "error: tool produced no result" };
				if (resolvedName === "WritePlan" && r.status === "completed") {
					planWritten = true;
				}
				// Keep a bounded recovery ledger for compaction; ordinary requests
				// retain their original tool results without a changing state suffix.
				ledger.record(resolvedName, parsed[i].input, r.status, r.output, r.outcome);
				finishUi(i);
			}
			// Complete the entire tool exchange before inserting user messages.
			// New direction also supersedes the repeated-retrieval recovery state.
			if (await consumeSteering(step + 1)) continue;
			if (signal.aborted || budgetExhausted()) continue;
			const retrievalState = retrievalProgress.observe(parsed.map((item, i) => ({
				name: item.resolvedName, input: item.input, ...results[i],
			})));
			if (retrievalState === "recover") {
				pushSystemNote("Repeated searches and reads are returning the same results without new evidence. Use the findings already in this conversation to take the next concrete step. Make the authorized change or answer the request; if a specific fact is still missing, inspect only that fact with a different targeted probe. Do not repeat unchanged searches or reads.");
			} else if (retrievalState === "wrap-up") {
				pushSystemNote("The investigation is still repeating unchanged results after a recovery reminder. Stop repeating those probes. Use the established evidence to finish the authorized work, or give a concise account of the findings and the exact blocker. An open todo is not a reason to continue the same searches.");
			} else if (retrievalState === "pause") {
				// Active children can still supply useful evidence; wait for their next
				// report instead of ending their work because the parent kept searching.
				if (bgPending()) {
					await awaitPendingBg();
					retrievalProgress.reset();
					continue;
				}
				pushSystemNote("The run was paused after repeated unchanged retrieval results. The task remains incomplete; retain these findings and change approach when resuming.");
				finalText = "I paused because repeated searches and reads returned no new information. The task is still incomplete; the existing findings and tool results are retained for the next message.";
				pushHistory({ kind: "assistant", text: finalText, calls: [] });
				emit({ type: "text-delta", text: finalText });
				break;
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
		while (bgPending()) {
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
		emit({ type: "verification", summary: toolCtx.verification!.snapshot() });
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
		// Append missing outcomes without rewriting any already-sent history.
		// This also preserves a complete call emitted just before a stream abort.
		const unanswered = new Map<string, ToolCall>();
		for (const step of persistedHistory.slice(runStart)) {
			if (step.kind === "assistant") for (const call of step.calls) unanswered.set(call.id, call);
			else if (step.kind === "tool-result") unanswered.delete(step.callId);
		}
		for (const call of unanswered.values()) {
			pushHistory({ kind: "tool-result", callId: call.id, name: call.name, status: "error", output: "error: run interrupted before a result was recorded; completion is unconfirmed. Verify the current state before retrying any action." });
		}
		if (signal.aborted) pushSystemNote("The user stopped the previous run. Earlier tool calls and results retain the observations and outcomes already recorded; the last assistant response may be incomplete. Continue from that evidence when requested, checking only unfinished or potentially changed work.");
		if (opts.contextState) opts.contextState.todos = toolCtx.todos.map((todo) => ({ ...todo }));
		// The run owns its children, including error exits.
		background.cancelAll();
		for (const active of activeAgents.values()) active.abort.abort();
		await Promise.allSettled([...activeAgents.values()].map(active => active.promise));
		const cancelled = background.drain();
		if (cancelled.length) pushSystemNote(cancelled.map(v => `Task ${v.id} (${v.title}): ${v.text}`).join("\n"));
		// Guarantee a terminal status even if the loop exited without one.
		if (!settledEmitted) emitSettled(signal.aborted ? "cancelled" : "finished");
		// Tear down this run's persistent shell session.
		try { await disposeShellSession(shellSessionKey); } catch (error) {
			logError("agent.shell-cleanup", error);
			emit({ type: "error", message: `Process cleanup incomplete: ${error instanceof Error ? error.message : String(error)}` });
		}
		await disposeBrowserSession(shellSessionKey);
		await onHook?.(signal.aborted ? "interrupt" : "sessionEnd", { runId: opts.runId ?? shellSessionKey });
		await opts.onRunEvent?.({ type: "run-end", at: Date.now(), data: { runId: opts.runId ?? shellSessionKey, interrupted: signal.aborted } });
	}
}
