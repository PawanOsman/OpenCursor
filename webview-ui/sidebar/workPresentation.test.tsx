/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it } from "vitest";
import { splitWork, hasLiveWork } from "./workPresentation";
import type { AssistantTurn, ToolBlock } from "./types";

const tool: ToolBlock = { kind: "tool", callId: "test", name: "Shell", input: {}, status: "completed" };
describe("work and conclusion presentation", () => {
  it("keeps the final response outside work and preserves its preceding commentary", () => {
    const turn: AssistantTurn = { role: "assistant", blocks: [{ kind: "text", text: "I will inspect this." }, tool, { kind: "text", text: "Checking results.\n\nThe fix is ready." }], finalText: "The fix is ready." };
    const { activity, conclusion } = splitWork(turn, false);
    expect(activity).toEqual([turn.blocks[0], tool, { kind: "text", text: "Checking results." }]);
    expect(conclusion).toEqual([{ kind: "text", text: "The fix is ready." }]);
    expect(splitWork(turn, true)).toEqual({ activity: turn.blocks, conclusion: [] });
  });
  it("shows the whole answer in legacy text-only chats", () => {
    const turn: AssistantTurn = { role: "assistant", blocks: [{ kind: "text", text: "Hello!" }] };
    expect(splitWork(turn, false)).toEqual({ activity: [], conclusion: turn.blocks });
  });
  it("shows a concluding notice delivered only in the run result", () => {
    const turn: AssistantTurn = { role: "assistant", blocks: [tool], finalText: "Paused at the token budget. Completed work is retained." };
    expect(splitWork(turn, false)).toEqual({ activity: [tool], conclusion: [{ kind: "text", text: turn.finalText }] });
  });
  it("keeps errors and recovery controls available after collapsing", () => {
    const turn: AssistantTurn = { role: "assistant", blocks: [tool, { kind: "max-steps", steps: 10 }, { kind: "error", message: "Request failed" }] };
    expect(splitWork(turn, false)).toEqual({ activity: [tool], conclusion: turn.blocks.slice(1) });
  });
  it("does not treat progress before the last tool as a final response", () => {
    const turn: AssistantTurn = { role: "assistant", blocks: [{ kind: "text", text: "I will change the file." }, tool] };
    expect(splitWork(turn, false)).toEqual({ activity: turn.blocks, conclusion: [] });
  });
  it("keeps live tools from previous steering segments open", () => {
    expect(hasLiveWork([{ ...tool, subStatus: "running" }])).toBe(true);
    expect(hasLiveWork([tool])).toBe(false);
  });
});
