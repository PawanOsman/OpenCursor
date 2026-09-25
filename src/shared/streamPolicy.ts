/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// Per-tool streaming policy.
//
// Not every tool benefits from streaming its arguments to the UI. Streaming is
// only worth its cost when the partial value is *readable progress* for a human
// (file contents being written, a command being composed). For everything else
// the args are a short blob that appears fully formed a few hundred ms later,
// so streaming them just burns postMessage + JSON.parse + React renders.
//
// Shared by the extension host (emit side) and the webview (render side) so both
// agree on what is live.

/** How a tool's arguments should reach the UI while the model is emitting them. */
export type ArgStreamMode =
  /** Stream partial args continuously — user reads the content as it is written. */
  | "live"
  /** Send at most one partial update so the card can show a title/path early. */
  | "once"
  /** No partial args; the card renders when the call is complete. */
  | "off";

export interface ToolStreamPolicy {
  args: ArgStreamMode;
  /**
   * Coalescing interval (ms) for this tool's arg deltas. Higher = fewer frames.
   * Only meaningful for "live".
   */
  intervalMs: number;
  /**
   * Max characters of argsText forwarded to the UI. Long file writes are clipped
   * because the card only shows a tail preview anyway.
   */
  maxChars: number;
}

const LIVE_WRITE: ToolStreamPolicy = { args: "live", intervalMs: 64, maxChars: 24_000 };
const LIVE_CMD: ToolStreamPolicy = { args: "live", intervalMs: 80, maxChars: 4_000 };
const TITLE_ONLY: ToolStreamPolicy = { args: "once", intervalMs: 120, maxChars: 2_000 };
const NO_STREAM: ToolStreamPolicy = { args: "off", intervalMs: 0, maxChars: 0 };

/**
 * Tool name → policy. Both PascalCase names and snake_case aliases are
 * listed because providers emit either depending on the schema in use.
 */
const POLICIES: Record<string, ToolStreamPolicy> = {
  // Writes: the streamed body IS the value — user watches code appear.
  Write: LIVE_WRITE,
  write: LIVE_WRITE,
  StrReplace: LIVE_WRITE,
  edit_file: LIVE_WRITE,
  search_replace: LIVE_WRITE,
  EditNotebook: LIVE_WRITE,

  // Shell: the command is short but reading it early matters (approval prompts).
  Shell: LIVE_CMD,
  run_terminal: LIVE_CMD,
  run_terminal_cmd: LIVE_CMD,

  // Long-form prose args worth watching.
  Task: LIVE_CMD,
  task: LIVE_CMD,
  AskQuestion: LIVE_CMD,
  ask_question: LIVE_CMD,
  TodoWrite: LIVE_CMD,
  todo_write: LIVE_CMD,
  WritePlan: LIVE_WRITE,
  write_plan: LIVE_WRITE,

  // Read-only lookups: args are a path/pattern. One early update gives the card
  // its title; further deltas add nothing a user can perceive.
  Read: TITLE_ONLY,
  read_file: TITLE_ONLY,
  Grep: TITLE_ONLY,
  grep: TITLE_ONLY,
  Glob: TITLE_ONLY,
  glob: TITLE_ONLY,
  FileSearch: TITLE_ONLY,
  file_search: TITLE_ONLY,
  SemanticSearch: TITLE_ONLY,
  codebase_search: TITLE_ONLY,
  SearchDocs: TITLE_ONLY,
  ListDir: TITLE_ONLY,
  list_dir: TITLE_ONLY,
  WebSearch: TITLE_ONLY,
  web_search: TITLE_ONLY,
  WebFetch: TITLE_ONLY,
  web_fetch: TITLE_ONLY,
  Delete: TITLE_ONLY,
  delete_file: TITLE_ONLY,

  // Zero-arg or trivial tools: nothing to preview.
  TodoRead: NO_STREAM,
  todo_read: NO_STREAM,
  ReadLints: NO_STREAM,
  read_lints: NO_STREAM,
  AwaitShell: NO_STREAM,
  SwitchMode: NO_STREAM,
};

/** Default for unknown/MCP tools: one early update, no continuous stream. */
const DEFAULT_POLICY: ToolStreamPolicy = TITLE_ONLY;

export function streamPolicyFor(toolName: string | undefined): ToolStreamPolicy {
  if (!toolName) return DEFAULT_POLICY;
  return POLICIES[toolName] ?? DEFAULT_POLICY;
}

/** Coalescing interval for plain assistant text (fast, it is the primary signal). */
export const TEXT_INTERVAL_MS = 40;
/** Reasoning traces are secondary — batch harder to leave frames for text. */
export const THINKING_INTERVAL_MS = 96;
/** Subagent output renders in a collapsed panel; batch hardest of all. */
export const SUBAGENT_INTERVAL_MS = 128;

/**
 * Clip a partial tool-args JSON string for UI preview.
 *
 * The webview parses partial args leniently (`parsePartialArgs`), so a clipped
 * string still yields the leading fields (path, command, …). Keeping the head is
 * what matters; the tail of a huge `content` field is re-sent on completion.
 */
export function clipArgsText(argsText: string, maxChars: number): string {
  if (maxChars <= 0 || argsText.length <= maxChars) return argsText;
  return argsText.slice(0, maxChars);
}
