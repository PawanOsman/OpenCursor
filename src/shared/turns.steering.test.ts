/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it } from "vitest";
import { applyEvent, type AssistantTurn, type ToolBlock, type Turn } from "./turns";

function toolAt(turns: Turn[], turnIndex = 0, blockIndex = 0): ToolBlock {
  return (turns[turnIndex] as AssistantTurn).blocks[blockIndex] as ToolBlock;
}

function withSteering(turns: Turn[], response = true): Turn[] {
  const steered = applyEvent(turns, { type: "user-steering", text: "Preserve the existing shortcuts" });
  return response ? applyEvent(steered, { type: "text-delta", text: "I will keep the shortcuts while updating the component." }) : steered;
}

describe("steering inside a running turn", () => {
  it("adds the guidance to the open response instead of starting a new turn", () => {
    let turns = applyEvent([{ role: "user", text: "Update the component" }], { type: "thinking-delta", text: "Planning" });
    turns = applyEvent(turns, { type: "tool-call-started", callId: "read", name: "Read", input: { path: "a.ts" } });
    const steered = withSteering(turns);
    expect(steered).toHaveLength(2);
    const turn = steered[1] as AssistantTurn;
    expect(turn.endedAt).toBeUndefined();
    expect(turn.blocks.map(block => block.kind)).toEqual(["thinking", "tool", "steering", "text"]);
    expect(turn.blocks[2]).toMatchObject({ kind: "steering", text: "Preserve the existing shortcuts" });
    // Text after the guidance is a new paragraph, not glued onto earlier output.
    expect(turn.blocks[3]).toEqual({ kind: "text", text: "I will keep the shortcuts while updating the component." });
  });

  it("closes open thinking before the guidance", () => {
    const turns = withSteering(applyEvent([], { type: "thinking-delta", text: "Still thinking" }), false);
    const [thinking, steering] = (turns[0] as AssistantTurn).blocks;
    expect(thinking).toMatchObject({ kind: "thinking", endedAt: expect.any(Number) });
    expect(steering.kind).toBe("steering");
  });

  it("opens a response when guidance arrives before any output", () => {
    const turns = withSteering([{ role: "user", text: "Start" }], false);
    expect(turns).toHaveLength(2);
    expect(turns[1]).toMatchObject({ role: "assistant", startedAt: expect.any(Number), blocks: [{ kind: "steering" }] });
  });
});

describe("tool events across steering", () => {
  it.each([false, true])("keeps late arguments, start details, progress and completion on the tool (new response: %s)", (response) => {
    const started = applyEvent([], { type: "tool-call-started", callId: "old-shell", name: "Shell", input: { command: "npm test" } });
    const source = withSteering(started, response);
    const before = structuredClone(source);
    let updated = applyEvent(source, { type: "tool-call-args", callId: "old-shell", argsText: '{"command":"npm test -- --run"}' });
    updated = applyEvent(updated, { type: "tool-call-started", callId: "old-shell", name: "Shell", input: { cwd: "project" }, startedAt: 123, timeoutMs: 5000 });
    updated = applyEvent(updated, { type: "tool-call-progress", callId: "old-shell", text: "Running 12 tests" });
    expect(toolAt(updated)).toMatchObject({ status: "running", input: { command: "npm test -- --run", cwd: "project" }, result: "Running 12 tests", startedAt: 123, timeoutMs: 5000 });

    updated = applyEvent(updated, { type: "tool-call-completed", callId: "old-shell", name: "Shell", status: "completed", result: "12 tests passed", outcome: { status: "completed", exitCode: 0 } });
    expect(toolAt(updated)).toMatchObject({ status: "completed", result: "12 tests passed", outcome: { exitCode: 0 } });
    expect(updated).toHaveLength(1);
    expect(source).toEqual(before);

    expect(applyEvent(updated, { type: "tool-call-progress", callId: "old-shell", text: "Late partial output" })).toBe(updated);
    expect(applyEvent(updated, { type: "tool-call-started", callId: "old-shell", name: "Shell", input: { command: "must not run again" } })).toBe(updated);
    expect(applyEvent(updated, { type: "tool-call-completed", callId: "unknown", name: "Shell", status: "completed", result: "Unknown" })).toBe(updated);
  });

  it("finishes background subagent work after guidance and a newer assistant response", () => {
    let turns = applyEvent([], { type: "tool-call-started", callId: "background", name: "Task", input: { description: "Check compatibility" } });
    turns = applyEvent(turns, { type: "tool-call-completed", callId: "background", name: "Task", status: "completed", result: "Started background work" });
    turns = applyEvent(turns, { type: "subagent-event", callId: "background", event: { type: "run-status", status: "running" } });
    turns = applyEvent(turns, { type: "subagent-event", callId: "background", event: { type: "tool-call-started", callId: "child-test", name: "Shell", input: { command: "npm test" } } });
    const source = withSteering(turns);
    const before = structuredClone(source);
    let updated = applyEvent(source, { type: "subagent-event", callId: "background", event: { type: "tool-call-completed", callId: "child-test", name: "Shell", status: "completed", result: "Compatible" } });
    updated = applyEvent(updated, { type: "subagent-event", callId: "background", event: { type: "text-delta", text: "All shortcuts remain compatible." } });
    updated = applyEvent(updated, { type: "subagent-event", callId: "background", event: { type: "run-status", status: "finished" } });
    expect(toolAt(updated)).toMatchObject({ status: "completed", subStatus: "finished", subBlocks: [
      { kind: "tool", callId: "child-test", status: "completed", result: "Compatible" },
      { kind: "text", text: "All shortcuts remain compatible." },
    ] });
    expect(updated).toHaveLength(1);
    expect((updated[0] as AssistantTurn).blocks.slice(1)).toEqual((source[0] as AssistantTurn).blocks.slice(1));
    expect(source).toEqual(before);
    expect(applyEvent(updated, { type: "subagent-event", callId: "background", event: { type: "run-status", status: "running" } })).toBe(updated);
  });

  it("starts a fresh tool when a later run reuses a provider call ID", () => {
    let earlier = applyEvent([{ role: "user", text: "First task" }], { type: "tool-call-started", callId: "call_0", name: "Read", input: { path: "first.ts" } });
    earlier = applyEvent(earlier, { type: "tool-call-completed", callId: "call_0", name: "Read", status: "completed", result: "First contents" });
    earlier = withSteering(earlier);
    const nextRun: Turn[] = [...earlier, { role: "user", text: "Second task" }];
    const before = structuredClone(nextRun);
    let updated = applyEvent(nextRun, { type: "text-delta", text: "Checking the second file." });
    updated = applyEvent(updated, { type: "tool-call-started", callId: "call_0", name: "Read", input: { path: "second.ts" } });
    expect(toolAt(updated, updated.length - 1, 1)).toMatchObject({ callId: "call_0", status: "running", input: { path: "second.ts" } });
    updated = applyEvent(updated, { type: "tool-call-completed", callId: "call_0", name: "Read", status: "completed", result: "Second contents" });
    expect(toolAt(updated, updated.length - 1, 1)).toMatchObject({ status: "completed", result: "Second contents" });
    expect(toolAt(updated, 1)).toMatchObject({ status: "completed", result: "First contents", input: { path: "first.ts" } });
    for (let index = 0; index < nextRun.length; index++) expect(updated[index]).toBe(nextRun[index]);
    expect(nextRun).toEqual(before);
  });
});

describe("conversations saved with legacy steering turns", () => {
  const legacy = (): Turn[] => [
    { role: "user", text: "First task" },
    { role: "assistant", blocks: [{ kind: "tool", callId: "background", name: "Shell", input: { command: "npm test" }, status: "running" }], startedAt: 1, endedAt: 2, durationMs: 1 },
    { role: "user", text: "Preserve the existing shortcuts", steering: true },
    { role: "assistant", blocks: [{ kind: "text", text: "I will keep the shortcuts." }], startedAt: 3 },
  ];

  it("still routes late tool output across a saved steering boundary and stops at an ordinary user turn", () => {
    const restored: Turn[] = JSON.parse(JSON.stringify(legacy()));
    const continued = applyEvent(restored, { type: "tool-call-progress", callId: "background", text: "Still working" });
    expect(toolAt(continued, 1).result).toBe("Still working");
    const nextRun: Turn[] = [...continued, { role: "user", text: "A different task" }];
    expect(applyEvent(nextRun, { type: "tool-call-progress", callId: "background", text: "Late output from the previous run" })).toBe(nextRun);
  });

  it("adds new guidance inline after legacy turns", () => {
    const turns = withSteering(legacy(), false);
    expect(turns).toHaveLength(4);
    const blocks = (turns[3] as AssistantTurn).blocks;
    expect(blocks[blocks.length - 1]).toMatchObject({ kind: "steering", text: "Preserve the existing shortcuts" });
  });
});
