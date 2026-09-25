/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { ToolSchema, Mode } from "../types";
import type { ToolOutcome } from "../toolOutcome";
import { TOOL_SPECS } from "./schemas";

export interface ToolResult {
  output: string;
  outcome?: ToolOutcome;
  diff?: string;
  startLine?: number;
  endLine?: number;
  /** An image the tool returns (e.g. Read on a PNG), forwarded to the model. */
  image?: { mime: string; base64: string };
}

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
}

/** Per-run context so concurrent agent runs don't clobber each other's hooks. */
export interface ToolContext {
  agentControl?: (request: import("../collaborationState").AgentControlRequest, signal?: AbortSignal) => Promise<string>;
  verification?: import("../verification").VerificationLedger;
  getGoal?: () => unknown;
  updateGoal?: (status: "active" | "paused" | "blocked" | "complete") => string;
  /** Todo state owned by this run, never shared across conversations. */
  todos: TodoItem[];
  changeOwner?: import("../../stores/pendingChanges").ChangeOwner;
  /** Guard a resource download once its contents are available. */
  beforeResourceWrite?: (path: string, content: string, signal?: AbortSignal) => Promise<string | undefined | void>;
  /** Read an archived result or transcript belonging to this conversation. */
  readContext?: (input: { id: string; start_line?: number; end_line?: number; start_column?: number; pattern?: string }) => string;
  runSubagent?: SubagentRunner;
  askUser?: QuestionAsker;
  /** Switch the active mode mid-run (used by the SwitchMode tool). */
  switchMode?: (mode: Mode) => string;
  /** Current active mode (mutable across the run); read by tools for gating. */
  getMode?: () => Mode;
  /** Key identifying this run's shell session (standalone cd persists within this run). */
  shellSessionKey?: string;
  /** Stable conversation owner; completed jobs remain readable across runs by this owner only. */
  shellOwnerKey?: string;
  /** Emit a notify_on_output match to the UI (set by the loop). */
  emitShellNotify?: (text: string) => void;
  /** Stream partial output for a running tool call (live terminal output). */
  emitToolProgress?: (callId: string, text: string) => void;
  /** Preserve the latest job metadata even if an outer timeout settles before execute returns. */
  recordToolOutcome?: (callId: string, outcome: ToolOutcome) => void;
}

export interface Tool {
  schema: ToolSchema;
  mutating: boolean;
  execute(input: any, abortSignal?: AbortSignal, callId?: string, ctx?: ToolContext): Promise<ToolResult>;
}

/** Extra schema-defined options threaded through to a subagent run. */
export interface SubagentOptions {
  /** Model slug to run the subagent with. */
  model?: string;
  /** Run detached in the background (returns immediately with a handle note). */
  runInBackground?: boolean;
  /** Human-friendly title shown in the UI. */
  description?: string;
  /** File paths (images/videos) to attach to the subagent's context. */
  fileAttachments?: string[];
  /** Resume the saved history of a collaborator belonging to this conversation. */
  resume?: string;
  /** Legacy input; the current runner does not support resuming/interruption. */
  interrupt?: boolean;
  fork?: boolean;
}

/** Injected by the agent loop (avoids a circular import with loop.ts). */
export type SubagentRunner = (
  prompt: string,
  readonly: boolean,
  subagentName?: string,
  signal?: AbortSignal,
  callId?: string,
  opts?: SubagentOptions
) => Promise<string>;

/** Structured input kinds supported by the AskQuestion chat UI. */
export type AskQuestionType = "choices" | "text" | "textArea" | "number" | "date";

export interface AskQuestionItem {
  question: string;
  options?: string[];
  multiple?: boolean;
  /** Input kind. "choices" (default) keeps the multiple-choice UI. */
  type?: AskQuestionType;
  /** The user must answer before proceeding (default false). */
  required?: boolean;
  /** Placeholder for free-form fields (text/textArea/number/date). */
  placeholder?: string;
}
export type QuestionAsker = (
  callId: string,
  header: string | undefined,
  questions: AskQuestionItem[],
  signal?: AbortSignal
) => Promise<Record<string, string[]>>;

/**
 * Build a Tool. The name/description/parameters always come from the spec in
 * `schemas.ts` (single source of truth) — handler files only provide the name
 * + behaviour, never their own schema.
 */
export function defineTool(name: string, mutating: boolean, execute: Tool["execute"]): Tool {
  const s = TOOL_SPECS[name];
  if (!s) {
    throw new Error(`No tool spec for "${name}" (add it to schemas.ts)`);
  }
  return {
    mutating,
    schema: { type: "function", function: { name: s.name, description: s.description, parameters: s.parameters } },
    execute,
  };
}
