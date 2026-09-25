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

describe("tool events across steering turns", () => {
  it.each([false, true])("keeps late arguments, start details, progress and completion in the owning turn (new response: %s)", (response) => {
    const started = applyEvent([], { type: "tool-call-started", callId: "old-shell", name: "Shell", input: { command: "npm test" } });
    const source = withSteering(started, response);
    const before = structuredClone(source);
    let updated = applyEvent(source, { type: "tool-call-args", callId: "old-shell", argsText: '{"command":"npm test -- --run"}' });
    updated = applyEvent(updated, { type: "tool-call-started", callId: "old-shell", name: "Shell", input: { cwd: "project" }, startedAt: 123, timeoutMs: 5000 });
    updated = applyEvent(updated, { type: "tool-call-progress", callId: "old-shell", text: "Running 12 tests" });
    expect(toolAt(updated)).toMatchObject({ status: "running", input: { command: "npm test -- --run", cwd: "project" }, result: "Running 12 tests", startedAt: 123, timeoutMs: 5000 });

    updated = applyEvent(updated, { type: "tool-call-completed", callId: "old-shell", name: "Shell", status: "completed", result: "12 tests passed", outcome: { status: "completed", exitCode: 0 } });
    expect(toolAt(updated)).toMatchObject({ status: "completed", result: "12 tests passed", outcome: { exitCode: 0 } });
    expect(updated).toHaveLength(source.length);
    expect(updated[0]).not.toBe(source[0]);
    for (let index = 1; index < source.length; index++) expect(updated[index]).toBe(source[index]);
    expect(source).toEqual(before);

    expect(applyEvent(updated, { type: "tool-call-progress", callId: "old-shell", text: "Late partial output" })).toBe(updated);
    expect(applyEvent(updated, { type: "tool-call-started", callId: "old-shell", name: "Shell", input: { command: "must not run again" } })).toBe(updated);
    expect(applyEvent(updated, { type: "tool-call-completed", callId: "unknown", name: "Shell", status: "completed", result: "Unknown" })).toBe(updated);
  });

  it("finishes background subagent work in its original turn after guidance and a newer assistant response", () => {
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
    expect(updated).toHaveLength(3);
    expect(updated[1]).toBe(source[1]);
    expect(updated[2]).toBe(source[2]);
    expect(source).toEqual(before);
    expect(applyEvent(updated, { type: "subagent-event", callId: "background", event: { type: "run-status", status: "running" } })).toBe(updated);
  });

  it("keeps the newest matching call as the fast path and leaves older calls untouched", () => {
    let turns = applyEvent([], { type: "tool-call-started", callId: "older", name: "Read", input: { path: "src/old.ts" } });
    turns = withSteering(turns);
    turns = applyEvent(turns, { type: "tool-call-started", callId: "newer", name: "Read", input: { path: "src/new.ts" } });
    const newestBlocks = (turns[2] as AssistantTurn).blocks;
    const updated = applyEvent(turns, { type: "tool-call-completed", callId: "newer", name: "Read", status: "completed", result: "New contents" });
    expect(updated[0]).toBe(turns[0]);
    expect(updated[1]).toBe(turns[1]);
    expect((updated[2] as AssistantTurn).blocks[0]).toBe(newestBlocks[0]);
    expect(toolAt(updated, 2, 1)).toMatchObject({ callId: "newer", status: "completed", result: "New contents" });
    expect(toolAt(turns, 2, 1).status).toBe("running");
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

  it("retains steering boundaries through saved history and stops at an ordinary user turn", () => {
    const earlier = applyEvent([{ role: "user", text: "First task" }], { type: "tool-call-started", callId: "background", name: "Shell", input: { command: "npm test" } });
    const restored: Turn[] = JSON.parse(JSON.stringify(withSteering(earlier)));
    expect(restored[2]).toEqual({ role: "user", text: "Preserve the existing shortcuts", steering: true });
    const continued = applyEvent(restored, { type: "tool-call-progress", callId: "background", text: "Still working" });
    expect(toolAt(continued, 1).result).toBe("Still working");
    const nextRun: Turn[] = [...continued, { role: "user", text: "A different task" }];
    expect(applyEvent(nextRun, { type: "tool-call-progress", callId: "background", text: "Late output from the previous run" })).toBe(nextRun);
  });
});
