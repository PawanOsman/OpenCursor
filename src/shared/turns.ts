/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// Conversation turn model + the streaming-event reducer. Shared by the extension
// host (authoritative state, runs in the background) and the webview (pure
// renderer). Keep this DOM/React-free so it can run in the host.

import type { ToolOutcome } from "../agent/toolOutcome";

export type Mode = "agent" | "ask" | "plan" | "multitask" | "project" | "debug";

export type AgentEvent =
  | { type: "user-steering"; text: string; requestId?: string }
  | { type: "verification"; summary: import("../agent/verification").VerificationSnapshot }
  | { type: "text-delta"; text: string }
  | { type: "thinking-delta"; text: string }
  | { type: "tool-call-started"; callId: string; name: string; input: any; timeoutMs?: number; startedAt?: number }
  | { type: "tool-call-args"; callId: string; argsText: string }
  | { type: "tool-call-progress"; callId: string; text: string }
  | {
      type: "tool-call-completed";
      callId: string;
      name: string;
      status: "completed" | "error";
      result: string;
      diff?: string;
      startLine?: number;
      endLine?: number;
      outcome?: ToolOutcome;
    }
  | { type: "run-status"; status: "running" | "finished" | "error" | "cancelled" }
  | { type: "usage"; promptTokens: number; completionTokens: number; totalTokens: number; model?: string; requestId?: string; source?: "parent" | "summary" | "subagent"; cachedReadTokens?: number; cachedWriteTokens?: number; cacheReadInputTokens?: number }
  | { type: "run-result"; text: string; durationMs: number }
  | { type: "subagent-event"; callId: string; event: AgentEvent }
  | { type: "mode-changed"; mode: Mode }
  | { type: "shell-notify"; message: string }
  | { type: "retry"; attempt: number; max: number; delayMs: number; error: string }
  | { type: "compaction"; status: "running" | "done" | "failed"; summary?: string }
  | { type: "max-steps"; steps: number }
  | { type: "error"; message: string };

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  /** Data URL for images, or raw text for text files. */
  data: string;
  kind: "image" | "text";
}

export interface ToolBlock {
  kind: "tool";
  callId: string;
  name: string;
  input: any;
  status: "running" | "completed" | "error";
  result?: string;
  outcome?: ToolOutcome;
  /** Submitted question answers, persisted by the host. */
  answers?: Record<string, string[]>;
  diff?: string;
  startLine?: number;
  endLine?: number;
  /** Hard timeout budget (ms). UI shows countdown; 0/undefined = none. */
  timeoutMs?: number;
  /** Wall-clock start for countdown (ms since epoch). */
  startedAt?: number;
  /** For task (subagent) blocks: the nested read-only sub-chat stream. */
  subBlocks?: AssistantBlock[];
  subStatus?: "running" | "finished" | "error" | "cancelled";
}
export interface TextBlock {
  kind: "text";
  text: string;
}
export interface ThinkingBlock {
  kind: "thinking";
  text: string;
  startedAt?: number;
  endedAt?: number;
}
export interface ErrorBlock {
  kind: "error";
  message: string;
  /** When set, the run is retrying; shows a transient "retrying" notice. */
  retrying?: { attempt: number; max: number };
}
/** Context-compaction marker: earlier conversation was auto-summarized. */
export interface CompactionBlock {
  kind: "compaction";
  status: "running" | "done" | "failed";
  /** The generated summary (once done). */
  summary?: string;
}
/** Run paused at the step limit — chat shows a Continue button. */
export interface MaxStepsBlock {
  kind: "max-steps";
  steps: number;
  /** Set once the user continued (hides the button). */
  resumed?: boolean;
}
export interface VerificationBlock { kind: "verification"; summary: import("../agent/verification").VerificationSnapshot }
export type AssistantBlock = TextBlock | ThinkingBlock | ToolBlock | ErrorBlock | CompactionBlock | MaxStepsBlock | VerificationBlock;

export interface UserTurn {
  role: "user";
  text: string;
  /** Guidance consumed inside the current run rather than a new run boundary. */
  steering?: true;
  attachments?: Attachment[];
  /** Model id this message was sent with (shown on the bubble). */
  model?: string;
  /** Mode this message was sent in. */
  mode?: string;
}

// Mentions live IN the message text as full self-describing tags:
//   <attached type="doc" title="Dodo" content="docs_dodo" />
// The exact same text is stored, edited, and sent to the AI — no translation.
// UI surfaces only *render* the tag (pill in bubbles/composer, @name in titles).
export const MENTION_TAG_RE = /<attached\s+([^>]*?)\/?>/g;

const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const unescAttr = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&amp;/g, "&");

/** Build the <attached /> tag for a mention. */
export function mentionTag(kind: string, name: string, path: string): string {
  return `<attached type="${escAttr(kind)}" title="${escAttr(name)}" content="${escAttr(path)}" />`;
}

function attrsOf(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = unescAttr(m[2]);
  return out;
}

/** Extract mention objects from a message's <attached /> tags. */
export function parseMentionTokens(text: string): { kind: string; name: string; path: string }[] {
  const out: { kind: string; name: string; path: string }[] = [];
  for (const m of text.matchAll(MENTION_TAG_RE)) {
    const a = attrsOf(m[1]);
    out.push({ kind: a.type || "file", name: a.title || a.content || "", path: a.content || "" });
  }
  return out;
}

/**
 * Render <attached /> tags for a UI surface:
 * "html":    inline pill markup inside message bubbles.
 * "display": short plain text "@name" (titles, queue rows, previews).
 * The AI gets the raw text with the tags untouched.
 */
export function renderMentionTokens(text: string, target: "display" | "html" = "display"): string {
  return text.replace(MENTION_TAG_RE, (_s, attrs) => {
    const a = attrsOf(attrs);
    const name = a.title || a.content || "";
    if (target === "html") {
      return `<span class="mention-chip" data-kind="${escAttr(a.type || "file")}" title="${escAttr(a.content || "")}">@${escAttr(name)}</span>`;
    }
    return `@${name}`;
  });
}
export interface AssistantTurn {
  role: "assistant";
  blocks: AssistantBlock[];
  /** Wall-clock boundaries of this assistant segment, in epoch milliseconds. */
  startedAt?: number;
  endedAt?: number;
  /** Elapsed time retained once this segment settles. */
  durationMs?: number;
  /** The concluding reply identified by the agent after its work finishes. */
  finalText?: string;
}
export type Turn = UserTurn | AssistantTurn;

// Best-effort parse of a partial JSON tool-arg string so the tool card can show
// fields (path, content, command…) as they stream. Falls back to the previous
// input when nothing parseable is available yet.
export function parsePartialArgs(argsText: string, prev: unknown): unknown {
  const t = argsText.trim();
  if (!t) return prev ?? {};
  try {
    return JSON.parse(t);
  } catch {
    try {
      let s = t;
      const quotes = (s.match(/(?<!\\)"/g) || []).length;
      if (quotes % 2 === 1) s += '"';
      const opens = (s.match(/\{/g) || []).length;
      const closes = (s.match(/\}/g) || []).length;
      s += "}".repeat(Math.max(0, opens - closes));
      return JSON.parse(s);
    } catch {
      return prev ?? {};
    }
  }
}

/**
 * Merge a later tool-call-started payload over the current input. Later frames
 * can carry extra resolved fields (e.g. the subagent's model) without dropping
 * what the model originally streamed.
 */
function mergeToolInput(prev: any, next: any): any {
  if (!next || !Object.keys(next).length) return prev;
  if (!prev || typeof prev !== "object" || !Object.keys(prev).length) return next;
  return { ...prev, ...next };
}

/** Index of the tool block with `callId`, searched newest-first. */
function findToolIndex(blocks: AssistantBlock[], callId: string): number {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.kind === "tool" && b.callId === callId) return i;
  }
  return -1;
}

// Merge a streaming event into a flat block list (used for both the main turn
// and a subagent's nested sub-chat). Returns a fresh copy.
export function applyToBlocks(blocksIn: AssistantBlock[], ev: AgentEvent): AssistantBlock[] {
  const blocks = [...blocksIn];
  const last = blocks[blocks.length - 1];
  if (ev.type === "text-delta") {
    if (last && last.kind === "thinking" && !last.endedAt) blocks[blocks.length - 1] = { ...last, endedAt: Date.now() };
    const tail = blocks[blocks.length - 1];
    if (tail && tail.kind === "text") blocks[blocks.length - 1] = { kind: "text", text: tail.text + ev.text };
    else blocks.push({ kind: "text", text: ev.text });
  } else if (ev.type === "thinking-delta") {
    if (last && last.kind === "thinking") blocks[blocks.length - 1] = { ...last, text: last.text + ev.text };
    else blocks.push({ kind: "thinking", text: ev.text, startedAt: Date.now() });
    return blocks;
  } else if (ev.type === "tool-call-started") {
    if (last && last.kind === "thinking" && !last.endedAt) blocks[blocks.length - 1] = { ...last, endedAt: Date.now() };
    const existing = blocks.findIndex((b) => b.kind === "tool" && b.callId === ev.callId);
    const timeoutMs = ev.timeoutMs && ev.timeoutMs > 0 ? ev.timeoutMs : undefined;
    const startedAt = ev.startedAt;
    if (existing >= 0) {
      const prev = blocks[existing] as ToolBlock;
      blocks[existing] = {
        ...prev,
        name: ev.name,
        input: mergeToolInput(prev.input, ev.input),
        timeoutMs: timeoutMs ?? prev.timeoutMs,
        startedAt: startedAt ?? prev.startedAt,
      } as AssistantBlock;
    } else {
      blocks.push({
        kind: "tool",
        callId: ev.callId,
        name: ev.name,
        input: ev.input,
        status: "running",
        timeoutMs,
        startedAt,
      });
    }
  } else if (ev.type === "tool-call-args") {
    const i = findToolIndex(blocks, ev.callId);
    if (i < 0) return blocksIn;
    const b = blocks[i] as ToolBlock;
    const input = parsePartialArgs(ev.argsText, b.input);
    if (input === b.input) return blocksIn;
    blocks[i] = { ...b, input };
    return blocks;
  } else if (ev.type === "tool-call-progress") {
    const i = findToolIndex(blocks, ev.callId);
    if (i < 0) return blocksIn;
    const b = blocks[i] as ToolBlock;
    if (b.status !== "running" || b.result === ev.text) return blocksIn;
    blocks[i] = { ...b, result: ev.text };
    return blocks;
  } else if (ev.type === "tool-call-completed") {
    const i = findToolIndex(blocks, ev.callId);
    if (i < 0) return blocksIn;
    const b = blocks[i] as ToolBlock;
    blocks[i] = { ...b, status: ev.status, result: ev.result, diff: ev.diff, startLine: ev.startLine, endLine: ev.endLine, outcome: ev.outcome ?? b.outcome };
    return blocks;
  } else if (ev.type === "retry") {
    const note: ErrorBlock = { kind: "error", message: ev.error, retrying: { attempt: ev.attempt, max: ev.max } };
    if (last && last.kind === "error") blocks[blocks.length - 1] = note;
    else blocks.push(note);
  } else if (ev.type === "error") {
    const note: ErrorBlock = { kind: "error", message: ev.message };
    if (last && last.kind === "error") blocks[blocks.length - 1] = note;
    else blocks.push(note);
  } else if (ev.type === "compaction") {
    const note: CompactionBlock = { kind: "compaction", status: ev.status, summary: ev.summary };
    if (last && last.kind === "compaction" && last.status === "running") blocks[blocks.length - 1] = note;
    else blocks.push(note);
  } else if (ev.type === "max-steps") {
    blocks.push({ kind: "max-steps", steps: ev.steps });
  }
  return blocks;
}

interface ToolLocation {
  turnIndex: number;
  blockIndex: number;
  block: ToolBlock;
}

/** Usually the newest tool; background work can belong to a turn before steering. */
function findTool(turns: Turn[], callId: string): ToolLocation | undefined {
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex--) {
    const turn = turns[turnIndex];
    if (turn.role === "user") {
      if (!turn.steering) break;
      continue;
    }
    for (let blockIndex = turn.blocks.length - 1; blockIndex >= 0; blockIndex--) {
      const block = turn.blocks[blockIndex];
      if (block.kind === "tool" && block.callId === callId) return { turnIndex, blockIndex, block };
    }
  }
  return undefined;
}

/** Copy only the owning turn and block so newer turns and memoized cards stay intact. */
function updateTool(turns: Turn[], location: ToolLocation, block: ToolBlock): Turn[] {
  const list = [...turns];
  const turn = turns[location.turnIndex] as AssistantTurn;
  const blocks = [...turn.blocks];
  blocks[location.blockIndex] = block;
  list[location.turnIndex] = { ...turn, blocks };
  return list;
}

function settleTurn(turn: AssistantTurn, endedAt = Date.now()): AssistantTurn {
  if (turn.startedAt == null || turn.endedAt != null) return turn;
  const end = Math.max(turn.startedAt, endedAt);
  return { ...turn, endedAt: end, durationMs: end - turn.startedAt };
}

function settleTrailingTurn(turns: Turn[]): Turn[] {
  const last = turns[turns.length - 1];
  if (last?.role !== "assistant") return turns;
  const settled = settleTurn(last);
  return settled === last ? turns : [...turns.slice(0, -1), settled];
}

// Apply a streaming agent event to the turns array (immutably).
export function applyEvent(turns: Turn[], ev: AgentEvent): Turn[] {
  if (ev.type === "user-steering") return [...settleTrailingTurn(closeTrailingThinking(turns)), { role: "user", text: ev.text, steering: true }];
  const ensureAssistant = (list: Turn[]): { list: Turn[]; turn: AssistantTurn } => {
    const last = list[list.length - 1];
    if (last && last.role === "assistant") {
      const cloned: AssistantTurn = { ...last, blocks: [...last.blocks] };
      return { list: [...list.slice(0, -1), cloned], turn: cloned };
    }
    const turn: AssistantTurn = { role: "assistant", blocks: [], startedAt: Date.now() };
    return { list: [...list, turn], turn };
  };

  if (ev.type === "run-status") {
    if (ev.status !== "running") return settleTrailingTurn(closeTrailingThinking(turns));
    const last = turns[turns.length - 1];
    if (last?.role === "assistant" && last.startedAt != null && last.endedAt == null) return turns;
    if (last?.role === "assistant" && last.endedAt != null) {
      return [...turns, { role: "assistant", blocks: [], startedAt: Date.now() }];
    }
    const { list, turn } = ensureAssistant(turns);
    turn.startedAt ??= Date.now();
    return list;
  }

  if (ev.type === "run-result") {
    const last = turns[turns.length - 1];
    if (last?.role !== "assistant") return turns;
    const turn = settleTurn(last);
    // A result duration covers the whole run. Steering produces independent
    // assistant segments, so never attribute that total to its final segment.
    const preceding = turns[turns.length - 2];
    const duration = preceding?.role === "user" && preceding.steering
      ? turn.durationMs
      : Number.isFinite(ev.durationMs) && ev.durationMs >= 0
        ? Math.max(turn.durationMs ?? 0, ev.durationMs)
        : turn.durationMs;
    const endedAt = turn.endedAt ?? Date.now();
    return [...turns.slice(0, -1), {
      ...turn,
      ...(duration == null ? {} : { startedAt: endedAt - duration, endedAt, durationMs: duration }),
      finalText: ev.text,
    }];
  }

  const dropRetryNote = (turn: AssistantTurn) => {
    const last = turn.blocks[turn.blocks.length - 1];
    if (last && last.kind === "error" && last.retrying) turn.blocks.pop();
  };

  const closeThinking = (turn: AssistantTurn) => {
    const last = turn.blocks[turn.blocks.length - 1];
    if (last && last.kind === "thinking" && !last.endedAt) turn.blocks[turn.blocks.length - 1] = { ...last, endedAt: Date.now() };
  };

  if (ev.type === "verification") {
    const { list, turn } = ensureAssistant(turns);
    closeThinking(turn);
    const existing = turn.blocks.findIndex((block) => block.kind === "verification");
    const block: VerificationBlock = { kind: "verification", summary: structuredClone(ev.summary) };
    if (existing >= 0) turn.blocks[existing] = block;
    else turn.blocks.push(block);
    return list;
  }

  if (ev.type === "text-delta") {
    const { list, turn } = ensureAssistant(turns);
    dropRetryNote(turn);
    closeThinking(turn);
    const lastBlock = turn.blocks[turn.blocks.length - 1];
    if (lastBlock && lastBlock.kind === "text") {
      turn.blocks[turn.blocks.length - 1] = { kind: "text", text: lastBlock.text + ev.text };
    } else {
      turn.blocks.push({ kind: "text", text: ev.text });
    }
    return list;
  }

  if (ev.type === "thinking-delta") {
    const { list, turn } = ensureAssistant(turns);
    dropRetryNote(turn);
    const lastBlock = turn.blocks[turn.blocks.length - 1];
    if (lastBlock && lastBlock.kind === "thinking") {
      turn.blocks[turn.blocks.length - 1] = { ...lastBlock, text: lastBlock.text + ev.text };
    } else {
      turn.blocks.push({ kind: "thinking", text: ev.text, startedAt: Date.now() });
    }
    return list;
  }

  if (ev.type === "tool-call-started") {
    const existing = findTool(turns, ev.callId);
    const timeoutMs = ev.timeoutMs && ev.timeoutMs > 0 ? ev.timeoutMs : undefined;
    // startedAt only when provided (execute time). Stream preview may omit it.
    const startedAt = ev.startedAt;
    if (existing) {
      const prev = existing.block;
      // Never reopen a settled tool (timeout/cancel may race a late start).
      if (prev.status !== "running") return turns;
      return updateTool(turns, existing, {
        ...prev,
        name: ev.name,
        input: mergeToolInput(prev.input, ev.input),
        status: "running",
        timeoutMs: timeoutMs ?? prev.timeoutMs,
        startedAt: startedAt ?? prev.startedAt,
      });
    }
    const { list, turn } = ensureAssistant(turns);
    closeThinking(turn);
    turn.blocks.push({
      kind: "tool",
      callId: ev.callId,
      name: ev.name,
      input: ev.input,
      status: "running",
      timeoutMs,
      startedAt,
    });
    return list;
  }

  if (ev.type === "tool-call-args") {
    // Index lookup + single splice: map() would allocate a new object for every
    // block on every args frame, defeating memoized tool cards downstream.
    const location = findTool(turns, ev.callId);
    if (!location) return turns;
    const b = location.block;
    const input = parsePartialArgs(ev.argsText, b.input);
    if (input === b.input) return turns;
    return updateTool(turns, location, { ...b, input });
  }

  if (ev.type === "tool-call-progress") {
    const location = findTool(turns, ev.callId);
    if (!location) return turns;
    const prev = location.block;
    // Never overwrite a settled result with a late progress frame.
    if (prev.status !== "running" || prev.result === ev.text) return turns;
    return updateTool(turns, location, { ...prev, result: ev.text });
  }

  if (ev.type === "tool-call-completed") {
    const location = findTool(turns, ev.callId);
    if (!location) return turns;
    const b = location.block;
    // Never reopen a settled tool if a late/duplicate completion races in.
    return updateTool(turns, location,
      b.status !== "running" && b.status === ev.status
        ? {
            ...b,
            result: ev.result ?? b.result,
            diff: ev.diff ?? b.diff,
            startLine: ev.startLine ?? b.startLine,
            endLine: ev.endLine ?? b.endLine,
            outcome: ev.outcome ?? b.outcome,
          }
        : {
            ...b,
            status: ev.status,
            result: ev.result,
            diff: ev.diff,
            startLine: ev.startLine,
            endLine: ev.endLine,
            outcome: ev.outcome ?? b.outcome,
          });
  }

  if (ev.type === "retry") {
    const { list, turn } = ensureAssistant(turns);
    const last = turn.blocks[turn.blocks.length - 1];
    const note = { kind: "error" as const, message: ev.error, retrying: { attempt: ev.attempt, max: ev.max } };
    if (last && last.kind === "error") turn.blocks[turn.blocks.length - 1] = note;
    else turn.blocks.push(note);
    return list;
  }

  if (ev.type === "error") {
    const { list, turn } = ensureAssistant(turns);
    const last = turn.blocks[turn.blocks.length - 1];
    const block = { kind: "error" as const, message: ev.message };
    if (last && last.kind === "error") turn.blocks[turn.blocks.length - 1] = block;
    else turn.blocks.push(block);
    return list;
  }

  if (ev.type === "compaction") {
    const { list, turn } = ensureAssistant(turns);
    const last = turn.blocks[turn.blocks.length - 1];
    const block: CompactionBlock = { kind: "compaction", status: ev.status, summary: ev.summary };
    if (last && last.kind === "compaction" && last.status === "running") turn.blocks[turn.blocks.length - 1] = block;
    else turn.blocks.push(block);
    return list;
  }

  if (ev.type === "max-steps") {
    const { list, turn } = ensureAssistant(turns);
    closeThinking(turn);
    turn.blocks.push({ kind: "max-steps", steps: ev.steps });
    return list;
  }

  if (ev.type === "subagent-event") {
    const location = findTool(turns, ev.callId);
    if (!location) return turns;
    const child = ev.event;
    if (child.type === "run-result") return turns; // summary lands in tool result
    const b = location.block;
    if (child.type === "run-status" && child.status === "running" && b.subStatus && b.subStatus !== "running") return turns;
    return updateTool(turns, location,
      child.type === "run-status"
        ? { ...b, subStatus: child.status }
        : { ...b, subBlocks: applyToBlocks(b.subBlocks ?? [], child) });
  }

  return turns;
}

/** Mark every still-open tool / subagent / thinking block as cancelled or closed. */
export function forceSettleOpenWork(turns: Turn[], reason: "cancelled" | "error" = "cancelled", endedAt = Date.now()): Turn[] {
  const msg = reason === "error" ? "(error)" : "(cancelled)";
  const subSt = reason === "error" ? "error" : "cancelled";
  return turns.map((turn) => {
    if (turn.role !== "assistant") return turn;
    let changed = false;
    const blocks = turn.blocks.map((b) => {
      if (b.kind === "thinking" && !b.endedAt) {
        changed = true;
        return { ...b, endedAt };
      }
      if (b.kind === "tool") {
        let next: ToolBlock = b;
        if (b.status === "running") {
          changed = true;
          // TodoWrite/Read: use "completed" instead of "error" to avoid red X
          const isTodo = b.name === "TodoWrite" || b.name === "TodoRead"
            || b.name === "todo_write" || b.name === "todo_read";
          next = { ...next, status: isTodo ? "completed" as const : "error" as const, result: b.result || (isTodo ? "(todos: cancelled)" : msg) };
        }
        const isTask = b.name === "Task" || b.name === "task";
        if (b.subStatus === "running" || (next.status === "error" && isTask && !b.subStatus)) {
          changed = true;
          next = { ...next, subStatus: subSt as ToolBlock["subStatus"] };
        }
        if (next.subBlocks?.length) {
          const nested = forceSettleOpenWork([{ role: "assistant", blocks: next.subBlocks }], reason, endedAt)[0] as AssistantTurn;
          if (nested.blocks !== next.subBlocks) {
            changed = true;
            next = { ...next, subBlocks: nested.blocks };
          }
        }
        return next;
      }
      if (b.kind === "compaction" && b.status === "running") {
        changed = true;
        return { ...b, status: "failed" as const };
      }
      return b;
    });
    return settleTurn(changed ? { ...turn, blocks } : turn, endedAt);
  });
}

/** Close any still-open trailing thinking block (run settled). */
export function closeTrailingThinking(turns: Turn[]): Turn[] {
  const lt = turns[turns.length - 1];
  if (lt && lt.role === "assistant") {
    const lb = lt.blocks[lt.blocks.length - 1];
    if (lb && lb.kind === "thinking" && !lb.endedAt) {
      const cloned: AssistantTurn = { ...lt, blocks: [...lt.blocks.slice(0, -1), { ...lb, endedAt: Date.now() }] };
      return [...turns.slice(0, -1), cloned];
    }
  }
  return turns;
}

/** Persist question answers in the same host-owned tree as the question card. */
export function setQuestionAnswers(turns: Turn[], callId: string, answers: Record<string, string[]>): Turn[] {
  const update = (blocks: AssistantBlock[]): AssistantBlock[] => blocks.map((block) => {
    if (block.kind !== "tool") return block;
    if (block.callId === callId) return { ...block, answers: Object.fromEntries(Object.entries(answers).map(([id, values]) => [id, [...values]])) };
    return block.subBlocks ? { ...block, subBlocks: update(block.subBlocks) } : block;
  });
  return turns.map((turn) => turn.role === "assistant" ? { ...turn, blocks: update(turn.blocks) } : turn);
}

/** A bounded readable transcript for explicitly attached conversations. */
export function turnsToTranscript(turns: Turn[], maxChars = 6000): string {
  const blockText = (block: AssistantBlock): string => {
    if (block.kind === "text") return block.text;
    if (block.kind === "verification") return `Verification: ${block.summary.status}\n${block.summary.checks.map((check) => `${check.command}: ${check.status} (exit ${check.exitCode ?? "unknown"}, revision ${check.revision})`).join("\n")}`;
    if (block.kind === "tool") return [
      `${block.name}: ${block.result ?? ""}`,
      block.answers ? `Answers: ${JSON.stringify(block.answers)}` : "",
      ...(block.subBlocks?.map(blockText) ?? []),
    ].filter(Boolean).join("\n");
    return "";
  };
  const text = turns.map((turn) => turn.role === "user" ? `User: ${turn.text}` : `Assistant: ${turn.blocks.map(blockText).filter(Boolean).join("\n")}`).join("\n\n");
  if (text.length <= maxChars) return text;
  const marker = "\n[Earlier chat content omitted]\n";
  const head = Math.max(0, Math.floor((maxChars - marker.length) / 3));
  return text.slice(0, head) + marker + text.slice(-(maxChars - marker.length - head));
}
