/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { AssistantBlock, AssistantTurn } from "./types";

const isNotice = (block: AssistantBlock) => block.kind === "verification" || block.kind === "error" && !block.retrying || block.kind === "max-steps";

/** Keep the final reply and actionable notices outside folded work history. */
export function splitWork(turn: AssistantTurn, running: boolean): { activity: AssistantBlock[]; conclusion: AssistantBlock[] } {
  if (running) return { activity: turn.blocks, conclusion: [] };
  let boundary = turn.blocks.length;
  while (boundary > 0 && (turn.blocks[boundary - 1].kind === "text" || isNotice(turn.blocks[boundary - 1]))) boundary--;
  let activity = turn.blocks.slice(0, boundary);
  let conclusion = turn.blocks.slice(boundary);
  const finalText = turn.finalText?.trim();
  if (finalText) {
    let finalIndex = turn.blocks.length - 1;
    while (finalIndex >= 0 && turn.blocks[finalIndex].kind !== "text") finalIndex--;
    const block = turn.blocks[finalIndex];
    if (finalIndex >= boundary && block?.kind === "text" && block.text.trimEnd().endsWith(finalText)) {
      const prefix = block.text.trimEnd().slice(0, -finalText.length).trimEnd();
      activity = [...turn.blocks.slice(0, finalIndex), ...(prefix ? [{ kind: "text" as const, text: prefix }] : [])];
      conclusion = [{ kind: "text", text: finalText }, ...turn.blocks.slice(finalIndex + 1)];
    } else {
      // Some terminal notices arrive only in the result, without text deltas.
      activity = turn.blocks;
      conclusion = [{ kind: "text", text: finalText }];
    }
  }
  // Recovery and evidence should remain available even if later work follows.
  conclusion = [...activity.filter(isNotice), ...conclusion];
  activity = activity.filter(block => !isNotice(block));
  return { activity, conclusion };
}

export function hasLiveWork(blocks: AssistantBlock[]): boolean {
  return blocks.some(block => block.kind === "tool" && (block.status === "running" || block.subStatus === "running" || hasLiveWork(block.subBlocks ?? [])));
}
