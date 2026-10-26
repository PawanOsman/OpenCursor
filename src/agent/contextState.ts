/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { createHash, type Hash } from "node:crypto";
import type { Step } from "./types";
import type { TodoItem } from "./tools/types";

/** Saved working context, separate from the lossless chat transcript. */
export interface ContextState {
  agents?: import("./collaborationState").Collaborator[];
  checkpoint?: {
    version: 1;
    throughStep: number;
    prefixDigest: string;
    steps: Step[];
  };
  todos?: TodoItem[];
}

function prefixDigest(history: Step[], count: number): string {
  const hash = createHash("sha256");
  for (let i = 0; i < count; i++) hash.update(JSON.stringify(history[i])).update("\n");
  return hash.digest("hex");
}

/**
 * Running digest per transcript array. The lossless transcript only grows and
 * steps are replaced rather than mutated, so a checkpoint saved on every step of
 * a long run extends the previous hash instead of re-serializing every earlier
 * step (with its full tool output and images) again.
 */
const runningDigests = new WeakMap<Step[], { steps: Step[]; hash: Hash }>();

function extendDigest(history: Step[], count: number): string {
  const cached = runningDigests.get(history);
  let reuse = !!cached && cached.steps.length <= count;
  // Any replaced, inserted or removed step invalidates the running hash.
  for (let i = 0; reuse && i < cached!.steps.length; i++) reuse = cached!.steps[i] === history[i];
  const steps = reuse ? cached!.steps : [];
  const hash = reuse ? cached!.hash : createHash("sha256");
  for (let i = steps.length; i < count; i++) {
    hash.update(JSON.stringify(history[i])).update("\n");
    steps.push(history[i]);
  }
  runningDigests.set(history, { steps, hash });
  return hash.copy().digest("hex");
}

/** A retry, edited request or truncated transcript invalidates an old summary. */
export function restoreContext(history: Step[], state?: ContextState): Step[] {
  const saved = state?.checkpoint;
  if (!saved || saved.version !== 1 || !Number.isSafeInteger(saved.throughStep) || saved.throughStep < 1 ||
      saved.throughStep > history.length || !Array.isArray(saved.steps) ||
      saved.prefixDigest !== prefixDigest(history, saved.throughStep)) {
    if (state && saved) {
      state.checkpoint = undefined;
      state.todos = undefined;
    }
    return [...history];
  }
  return [...saved.steps, ...history.slice(saved.throughStep)];
}

/** Replace the previous checkpoint; never retain a chain of context snapshots. */
export function saveContext(history: Step[], steps: Step[], state: ContextState): void {
  state.checkpoint = {
    version: 1,
    throughStep: history.length,
    prefixDigest: extendDigest(history, history.length),
    steps: [...steps],
  };
}
