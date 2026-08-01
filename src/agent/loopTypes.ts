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

/** Every input needed to drive a single {@link runAgent} run. */
export interface RunAgentOptions {
	apiBaseUrl: string;
	apiKey: string;
	model: string;
	mode: Mode;
	prompt: string;
	attachments?: Attachment[];
	history: Step[];
	maxTokens?: number;
	/** Max loop steps before pausing (0/undefined = default 50). */
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
	customSubagents?: SubagentDef[];
	/** All configured subagent teams. */
	teams?: TeamDef[];
	/** Teams assigned to this run (Project mode). */
	activeTeamIds?: string[];
	/** Default model for subagents ("" = inherit this run's model). */
	subagentModel?: string;
	/** Model ids selectable for this run's provider; a Task model outside this list is ignored. */
	availableModels?: string[];
	/** Called when a subagent starts, so the UI can offer a per-subagent stop. */
	registerSubagentAbort?: (callId: string, abort: () => void) => void;
	/** Ask the user clarifying questions via the chat UI (ask_question tool). */
	askUser?: (callId: string, header: string | undefined, questions: AskQuestionItem[], signal?: AbortSignal) => Promise<Record<string, string[]>>;
	onAfterRun?: () => void;
	/** Blocking before-shell hook: resolves with a block reason to veto the command. */
	onBeforeShell?: (command: string) => Promise<string | undefined> | void;
	onAfterEdit?: (path: string) => void;
	/**
	 * Generic hook trigger for the remaining events (beforeMcp, beforeReadFile, subagentStop, preCompact).
	 * For blocking "before" events the resolved string (if any) vetoes the action.
	 */
	onHook?: (event: "beforeMcp" | "beforeReadFile" | "subagentStop" | "preCompact", context: Record<string, string>, tool?: string) => Promise<string | undefined> | void;
	signal: AbortSignal;
	emit: (e: AgentEvent) => void;
	/** Called before each retry attempt. Useful for surfacing wait messages to the user. */
	onRetry?: (attempt: number, max: number, delayMs: number, error: string) => void;
	/** Override the default max retry attempts (default 8). */
	maxRetries?: number;
}
