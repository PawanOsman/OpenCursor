/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { restoreTurns } from "./chatSession";
import { applyEvent, closeTrailingThinking, forceSettleOpenWork, type AssistantTurn, type Turn } from "./turns";

afterEach(() => vi.restoreAllMocks());

function clock() {
  const now = vi.spyOn(Date, "now").mockReturnValue(1000);
  return (time: number) => now.mockReturnValue(time);
}

function assistant(turns: Turn[], index = turns.length - 1): AssistantTurn {
  return turns[index] as AssistantTurn;
}

describe("assistant run timing", () => {
  it("starts before the first token and retains one start through streamed blocks", () => {
    const at = clock();
    let turns = applyEvent([{ role: "user", text: "Fix it" }], { type: "run-status", status: "running" });
    expect(assistant(turns)).toEqual({ role: "assistant", blocks: [], startedAt: 1000 });
    at(2000);
    turns = applyEvent(turns, { type: "run-status", status: "running" });
    turns = applyEvent(turns, { type: "thinking-delta", text: "Inspect" });
    at(3000);
    turns = applyEvent(turns, { type: "text-delta", text: "Checking the file" });
    turns = applyEvent(turns, { type: "tool-call-started", callId: "read", name: "Read", input: { path: "app.ts" } });
    expect(assistant(turns).startedAt).toBe(1000);
    expect(assistant(turns).endedAt).toBeUndefined();
  });

  it.each(["finished", "cancelled", "error"] as const)("freezes elapsed time on %s and ignores duplicate terminal statuses", (status) => {
    const at = clock();
    let turns = applyEvent([], { type: "run-status", status: "running" });
    turns = applyEvent(turns, { type: "thinking-delta", text: "Checking" });
    at(6500);
    turns = applyEvent(turns, { type: "run-status", status });
    expect(assistant(turns)).toMatchObject({ startedAt: 1000, endedAt: 6500, durationMs: 5500 });
    expect(assistant(turns).blocks[0]).toMatchObject({ kind: "thinking", endedAt: 6500 });
    at(9000);
    expect(applyEvent(turns, { type: "run-status", status })).toBe(turns);
    expect(forceSettleOpenWork(turns, "cancelled")).toEqual(turns);
  });

  it("persists the final reply after finished and verification events without losing timing", () => {
    const at = clock();
    let turns = applyEvent([], { type: "run-status", status: "running" });
    turns = applyEvent(turns, { type: "text-delta", text: "Checking. Done." });
    at(5000);
    turns = applyEvent(turns, { type: "run-status", status: "finished" });
    turns = applyEvent(turns, { type: "verification", summary: { status: "untested", revision: 0, changedPaths: [], checks: [] } });
    turns = applyEvent(turns, { type: "run-result", text: "Done.", durationMs: 4000 });
    expect(assistant(turns)).toMatchObject({ startedAt: 1000, endedAt: 5000, durationMs: 4000, finalText: "Done." });
    at(1000000);
    const restored = restoreTurns(JSON.parse(JSON.stringify(turns)), false);
    expect(restored).toEqual(turns);
    expect(assistant(restored).blocks[0]).toEqual({ kind: "text", text: "Checking. Done." });
  });

  it("settles steering segments independently and leaves old timing intact when background work completes", () => {
    const at = clock();
    let turns = applyEvent([{ role: "user", text: "Fix it" }], { type: "run-status", status: "running" });
    turns = applyEvent(turns, { type: "tool-call-started", callId: "bg", name: "Task", input: {} });
    at(4000);
    turns = applyEvent(turns, { type: "user-steering", text: "Keep the API" });
    expect(assistant(turns, 1)).toMatchObject({ startedAt: 1000, endedAt: 4000, durationMs: 3000 });
    at(4500);
    turns = applyEvent(turns, { type: "text-delta", text: "I will. Done." });
    turns = applyEvent(turns, { type: "tool-call-completed", callId: "bg", name: "Task", status: "completed", result: "Done" });
    at(8000);
    turns = applyEvent(turns, { type: "run-status", status: "finished" });
    turns = applyEvent(turns, { type: "run-result", text: "Done.", durationMs: 7000 });
    expect(assistant(turns, 1)).toMatchObject({ startedAt: 1000, endedAt: 4000, durationMs: 3000 });
    expect(assistant(turns)).toMatchObject({ startedAt: 4500, endedAt: 8000, durationMs: 3500, finalText: "Done." });
  });

  it("preserves timing through thinking closure and emergency cleanup of nested work", () => {
    const at = clock();
    let turns = applyEvent([], { type: "run-status", status: "running" });
    turns = applyEvent(turns, { type: "tool-call-started", callId: "bg", name: "Task", input: {} });
    turns = applyEvent(turns, { type: "subagent-event", callId: "bg", event: { type: "thinking-delta", text: "Child work" } });
    turns = applyEvent(turns, { type: "thinking-delta", text: "Parent work" });
    at(4000);
    turns = closeTrailingThinking(turns);
    expect(assistant(turns).startedAt).toBe(1000);
    turns = forceSettleOpenWork(turns, "error");
    expect(assistant(turns)).toMatchObject({ startedAt: 1000, endedAt: 4000, durationMs: 3000 });
    expect(assistant(turns).blocks[0]).toMatchObject({ status: "error", subStatus: "error", subBlocks: [{ endedAt: 4000 }] });
  });

  it("keeps legacy history untimed until a real run starts and rejects invalid result durations", () => {
    const at = clock();
    const old: Turn[] = [{ role: "assistant", blocks: [{ kind: "text", text: "Old response" }] }];
    expect(restoreTurns(old, false)).toEqual(old);
    let turns = applyEvent(old, { type: "run-status", status: "running" });
    at(2000);
    turns = applyEvent(turns, { type: "run-result", text: "Complete", durationMs: Number.NaN });
    expect(assistant(turns)).toMatchObject({ startedAt: 1000, endedAt: 2000, durationMs: 1000 });
    at(5000);
    const next = applyEvent(turns, { type: "run-status", status: "running" });
    expect(next).toHaveLength(2);
    expect(next[0]).toBe(turns[0]);
    expect(assistant(next)).toMatchObject({ startedAt: 5000, blocks: [] });
  });
});
