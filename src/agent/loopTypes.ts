/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { SamplingParams, ModelParams } from "./provider";
import type { OAuthKind } from "./oauth";
import type { AskQuestionItem } from "./tools";
import type { AgentEvent, Attachment, Mode, Step } from "./types";
import type { SubagentDef } from "../stores/featureStore";
import type { TeamDef } from "./teams";
import type { ContextState } from "./contextState";

/** Every input needed to drive a single {@link runAgent} run. */
export interface RunAgentOptions {
	workspaceRoot?: string;
	executionProfile?: import("./execution").ExecutionProfile;
	/** Host capability ceiling, inherited by every child. */
	unavailableTools?: string[];
	runId?: string;
	goal?: { objective: string; status: string; tokenBudget?: number; tokensUsed: number };
	onGoalUsage?: (deltaTokens: number) => void;
	onGoalStatus?: (status: "active" | "paused" | "blocked" | "budgetLimited" | "complete") => void;
	/** Internal parent budget ceiling, shared by concurrently running children. */
	budgetExhausted?: () => boolean;
	drainSteering?: () => string[] | Promise<string[]>;
	onRunEvent?: (event: { type: string; at: number; data?: unknown }) => Promise<void>;
	apiBaseUrl: string;
	apiKey: string;
	/** Live same-provider credential pool, shared by child and summary requests. */
	apiKeyPool?: import("./provider/apiKeyPool").ApiKeyPool;
	model: string;
	mode: Mode;
	prompt: string;
	attachments?: Attachment[];
	history: Step[];
	/** Mutable working-memory checkpoint; persist beside the full transcript. */
	contextState?: ContextState;
	changeOwner?: import("../stores/pendingChanges").ChangeOwner;
	/** Stable conversation key for transports that support prompt cache routing. */
	promptCacheKey?: string;
	/** Conversation owner for retained terminal evidence, shared by parent and children. */
	shellOwnerKey?: string;
	maxTokens?: number;
	/** Max loop steps before pausing (0/undefined = default 200). */
	maxSteps?: number;
	/** Keep going past the step limit instead of pausing. */
	autoContinue?: boolean;
	/** Model context window (tokens). History is trimmed to fit, reserving maxTokens for the reply. */
	contextTokens?: number;
	sampling?: SamplingParams;
	modelParams?: ModelParams;
	anthropic?: boolean;
	/** OAuth account provider (Claude Code / Codex) for this run. */
	oauthKind?: OAuthKind;
	systemPromptOverride?: string;
	extraInstructions?: string;
	enableFileReading: boolean;
	enableTerminalSuggestions: boolean;
	enableWorkspaceContext?: boolean;
	enableWebSearch?: boolean;
	enableWebFetch?: boolean;
	approve?: (toolName: string, input: any, callId?: string) => Promise<boolean | { approved: false; blockedSubject: string }>;
	isSubagent?: boolean;
	/** Read-only parent brief and original user requests for a delegated run. */
	inheritedContext?: { instructions: string; userRequests: string; summary?: string };
	customSubagents?: SubagentDef[];
	/** All configured subagent teams. */
	teams?: TeamDef[];
	/** Teams assigned to this run (Project mode). */
	activeTeamIds?: string[];
	/** Default model for subagents ("" = inherit this run's model). */
	subagentModel?: string;
	/** Model ids selectable for this run's provider; a Task model outside this list is ignored. */
	availableModels?: string[];
	/** Resolve options for a different child/summary model; never inherit incompatible reasoning controls. */
	resolveModelOptions?: (model: string) => Pick<RunAgentOptions, "contextTokens" | "maxTokens" | "modelParams" | "sampling">;
	/** Called when a subagent starts, so the UI can offer a per-subagent stop. */
	registerSubagentAbort?: (callId: string, abort: () => void) => void;
	/** Ask the user clarifying questions via the chat UI (ask_question tool). */
	askUser?: (callId: string, header: string | undefined, questions: AskQuestionItem[], signal?: AbortSignal) => Promise<Record<string, string[]>>;
	onAfterRun?: () => void;
	/** Blocking before-shell hook: resolves with a block reason to veto the command. */
	onBeforeShell?: (command: string, signal?: AbortSignal) => Promise<string | undefined> | void;
	onAfterEdit?: (path: string) => void;
	/**
	 * Generic hook trigger for the remaining events (beforeMcp, beforeReadFile, subagentStop, preCompact).
	 * For blocking "before" events the resolved string (if any) vetoes the action.
	 */
	onHook?: (event: import("../integrations/hooksRunner").TriggerEvent, context: Record<string, string>, tool?: string, signal?: AbortSignal) => Promise<string | undefined> | void;
	signal: AbortSignal;
	emit: (e: AgentEvent) => void;
}
