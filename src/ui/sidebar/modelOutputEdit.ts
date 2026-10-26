/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { Step } from "../../agent/types";
import type { ContextState } from "../../agent/contextState";
import { saveContext } from "../../agent/contextState";
import type { Turn } from "../../shared/turns";

export interface ModelOutputEdit {
  turnIndex: number;
  blockIndex: number;
  /** `steering`: the user's own mid-run update, stored as a user step in the history. */
  kind: "text" | "thinking" | "steering";
  /** The block text the user started from; a mismatch means the transcript moved on. */
  previousText: string;
  text: string;
}

export interface ModelOutputEditResult {
  turns: Turn[];
  steps: Step[];
  contextState?: ContextState;
  /** False when the original output is no longer in the model history (e.g. summarized). */
  historyUpdated: boolean;
}

type AssistantStep = Extract<Step, { kind: "assistant" }>;
/** Steering stays inside its turn (a SteeringBlock), so it is not a request boundary. */
const isRequest = (step: Step) => step.kind === "user" && !step.synthetic && !step.steering;
const field = (kind: "text" | "thinking") => (step: AssistantStep) => (kind === "text" ? step.text : step.thinking) ?? "";
const isSteering = (step: Step): step is Extract<Step, { kind: "user" }> => step.kind === "user" && !!step.steering;

/** Steps produced in reply to the turn's user request, when turns and requests still align. */
function segmentFor(turns: Turn[], steps: Step[], turnIndex: number): [number, number] | undefined {
  const requestsBefore = turns.slice(0, turnIndex).filter((turn) => turn.role === "user").length;
  if (turns.filter((turn) => turn.role === "user").length !== steps.filter(isRequest).length) return undefined;
  let start = requestsBefore === 0 ? 0 : -1;
  let seen = 0;
  for (let i = 0; i < steps.length && start < 0; i++) if (isRequest(steps[i]) && ++seen === requestsBefore) start = i + 1;
  if (start < 0) return undefined;
  let end = start;
  while (end < steps.length && !isRequest(steps[end])) end++;
  return [start, end];
}

/**
 * Find the assistant step(s) whose `kind` output rendered as this block. A UI
 * block may join consecutive responses (no tool between), so match a run of
 * steps whose outputs concatenate to the block text. Prefer the turn's own
 * segment and the block's ordinal; fall back to the most recent exact match.
 */
function locate(turns: Turn[], steps: Step[], edit: ModelOutputEdit): { indexes: number[]; partial?: boolean } | undefined {
  if (edit.kind === "steering") {
    const index = locateSteering(turns, steps, edit);
    return index >= 0 ? { indexes: [index] } : undefined;
  }
  const get = field(edit.kind);
  const turn = turns[edit.turnIndex];
  if (turn.role !== "assistant") return undefined;
  const ordinal = turn.blocks.slice(0, edit.blockIndex).filter((block) => block.kind === edit.kind).length;
  const runsIn = (from: number, to: number): number[][] => {
    const assistant = [] as number[];
    for (let i = from; i < to; i++) if (steps[i].kind === "assistant" && get(steps[i] as AssistantStep)) assistant.push(i);
    const runs: number[][] = [];
    for (let a = 0; a < assistant.length; a++) {
      let joined = "";
      for (let b = a; b < assistant.length; b++) {
        joined += get(steps[assistant[b]] as AssistantStep);
        if (joined === edit.previousText) { runs.push(assistant.slice(a, b + 1)); break; }
        if (!edit.previousText.startsWith(joined)) break;
      }
    }
    return runs;
  };
  // Interleaved reasoning can render one response's output as several blocks.
  const containing = (from: number, to: number) => {
    for (let i = to - 1; i >= from; i--) {
      if (steps[i].kind === "assistant" && edit.previousText && get(steps[i] as AssistantStep).includes(edit.previousText)) return i;
    }
    return -1;
  };
  const segment = segmentFor(turns, steps, edit.turnIndex);
  if (segment) {
    const runs = runsIn(segment[0], segment[1]);
    if (runs.length) return { indexes: runs[Math.min(ordinal, runs.length - 1)] };
    const index = containing(segment[0], segment[1]);
    if (index >= 0) return { indexes: [index], partial: true };
  }
  const runs = runsIn(0, steps.length);
  if (runs.length) return { indexes: runs[runs.length - 1] };
  const index = containing(0, steps.length);
  return index >= 0 ? { indexes: [index], partial: true } : undefined;
}

/** The steering step for this note: the turn's Nth steering step, else the latest with the same text. */
function locateSteering(turns: Turn[], steps: Step[], edit: ModelOutputEdit): number {
  const turn = turns[edit.turnIndex];
  if (turn.role !== "assistant") return -1;
  const ordinal = turn.blocks.slice(0, edit.blockIndex).filter((block) => block.kind === "steering").length;
  const segment = segmentFor(turns, steps, edit.turnIndex);
  if (segment) {
    const inTurn = [] as number[];
    for (let i = segment[0]; i < segment[1]; i++) if (isSteering(steps[i])) inTurn.push(i);
    const index = inTurn[ordinal];
    if (index !== undefined && (steps[index] as Extract<Step, { kind: "user" }>).text === edit.previousText) return index;
  }
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (isSteering(step) && step.text === edit.previousText) return i;
  }
  return -1;
}

/** The step without provider-signed or encrypted replay state. */
function unsigned(step: AssistantStep): AssistantStep {
  const next: AssistantStep = { ...step, calls: step.calls.map(({ thoughtSignature: _signature, ...call }) => call) };
  delete next.responsesReasoning;
  return next;
}

/** Same step after the edit, as the provider should receive it. */
function editedStep(step: AssistantStep, kind: "text" | "thinking", text: string): AssistantStep {
  if (kind === "text") {
    // Text is replayed as ordinary assistant content; signed state for this
    // response is removed by the caller (see applyModelOutputEdit).
    return { ...step, text };
  }
  // Edited reasoning is no longer what the provider signed or encrypted:
  //  - Anthropic: display thinking is never replayed (no signed blocks are
  //    stored), so only the local copy changes.
  //  - OpenAI Responses: encrypted reasoning items cannot be edited; omit them
  //    (calls carry no server item ids, so the request stays valid).
  //  - Google Gemini: drop thought signatures; unsigned calls are sent as text.
  //  - Chat Completions `reasoning_content` is unsigned plain text: replay the
  //    edited text when it was the same reasoning, otherwise omit it.
  const next: AssistantStep = { ...unsigned(step), thinking: text };
  if (step.chatReasoning && step.chatReasoning.content === (step.thinking ?? "")) next.chatReasoning = { ...step.chatReasoning, content: text };
  else delete next.chatReasoning;
  return next;
}

/** Apply a user edit of model output to the rendered turns and to the replayed model history. */
export function applyModelOutputEdit(turns: Turn[], steps: Step[], contextState: ContextState | undefined, edit: ModelOutputEdit): ModelOutputEditResult {
  const turn = turns[edit.turnIndex];
  if (!turn || turn.role !== "assistant") throw new Error("Only assistant responses can be edited.");
  const block = turn.blocks[edit.blockIndex];
  if (!block || block.kind !== edit.kind) throw new Error("Only assistant text, thinking and your steering updates can be edited.");
  if (block.text !== edit.previousText) throw new Error("This response changed while you were editing it. Reopen the editor and try again.");
  const isFinal = edit.kind === "text" && !turn.blocks.slice(edit.blockIndex + 1).some((later) => later.kind === "text");
  const nextTurns = turns.slice();
  nextTurns[edit.turnIndex] = {
    ...turn,
    blocks: turn.blocks.map((item, index) => index === edit.blockIndex ? { ...item, text: edit.text } as typeof item : item),
    // The saved final answer would otherwise keep presenting the old text.
    ...(isFinal ? { finalText: undefined } : {}),
  };

  const found = locate(turns, steps, edit);
  if (!found) return { turns: nextTurns, steps, contextState, historyUpdated: false };
  const { indexes } = found;
  const nextSteps = steps.slice();
  indexes.forEach((index, position) => {
    if (edit.kind === "steering") {
      nextSteps[index] = { ...(steps[index] as Extract<Step, { kind: "user" }>), text: edit.text };
      return;
    }
    const step = steps[index] as AssistantStep;
    let text = position === 0 ? edit.text : ""; // a joined block keeps its whole edited text in the first response
    if (found.partial) {
      const current = field(edit.kind)(step), at = current.indexOf(edit.previousText);
      text = current.slice(0, at) + edit.text + current.slice(at + edit.previousText.length);
    }
    nextSteps[index] = editedStep(step, edit.kind, text);
  });
  // Provider signatures bind reasoning to the exact conversation prefix (e.g.
  // Anthropic thinking: "keep the history append-only, or strip the thinking
  // blocks from the edited turn on"). Once output at step N changed, no later
  // signed or encrypted state is valid either: strip it from N onward, keep it
  // before N. Unsigned text (including chat `reasoning_content`) is unaffected.
  const firstEdited = Math.min(...indexes);
  for (let index = firstEdited; index < nextSteps.length; index++) {
    const step = nextSteps[index];
    if (step.kind === "assistant" && (step.responsesReasoning || step.calls.some((call) => call.thoughtSignature))) nextSteps[index] = unsigned(step);
  }
  const changed = steps.map((_step, index) => index).filter((index) => nextSteps[index] !== steps[index]);

  let nextState = contextState;
  const checkpoint = contextState?.checkpoint;
  if (checkpoint && changed.some((index) => index < checkpoint.throughStep)) {
    // The checkpoint is what the provider actually receives for that prefix.
    // Edit its copies too; if a step was summarized away, drop the checkpoint so
    // the edited full history is refitted (todos are preserved).
    const keys = new Map(changed.map((index) => [JSON.stringify(steps[index]), nextSteps[index]] as const));
    let replaced = 0;
    const checkpointSteps = checkpoint.steps.map((step) => {
      const next = keys.get(JSON.stringify(step));
      if (!next) return step;
      replaced++;
      return next;
    });
    nextState = { ...contextState };
    if (replaced >= changed.filter((index) => index < checkpoint.throughStep).length) saveContext(nextSteps.slice(0, checkpoint.throughStep), checkpointSteps, nextState);
    else nextState.checkpoint = undefined;
  }
  return { turns: nextTurns, steps: nextSteps, contextState: nextState, historyUpdated: true };
}
