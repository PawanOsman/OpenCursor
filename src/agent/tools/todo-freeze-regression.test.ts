/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { parseTodos } from "../../shared/todoPresentation";
import { writeTodos as todoWriteHandler } from "./todoState";
import type { TodoItem, ToolContext } from "./types";
/**
 * TODO FREEZE REGRESSION TESTS
 *
 * Tests the EXACT scenarios that caused the todo freeze bug — where the UI
 * would show "(no todos)" or a red error, freezing the todo panel even though
 * the model DID provide data.
 *
 * Root cause: Deepseek/Mimo send malformed TodoWrite inputs (string arrays,
 * wrong field names, nulls, bare arrays). The old handler only checked
 * `input.todos` and returned "error:" or "(no todos)" for anything else,
 * causing the UI parser to produce an empty list and freeze.
 *
 * These tests simulate the COMPLETE flow: model input -> handler -> parseTodos -> UI state.
 */
import { describe, it, expect } from "vitest";

// ==================== TYPES ====================





// State changes run through the production todo implementation.



// State changes run through the production todo implementation.



// ==================== HELPER ====================

function simulateFullFlow(input: any, existingTodos: TodoItem[] = []) {
  const ctx: ToolContext = { todos: [...existingTodos] };
  const result = todoWriteHandler(input, ctx);
  const uiItems = parseTodos(result.output);
  return { handlerOutput: result.output, uiItems, ctx };
}

function hasErrorPrefix(output: string): boolean {
  return output.startsWith("error:") || output.startsWith("ERROR:");
}

// ==================== SCENARIOS ====================

describe("FREEZE REGRESSION: 15 exact scenarios that caused the todo freeze", () => {
  // ------------------------------------------------------------------
  // Scenario 1: Deepseek sends TodoWrite with string array
  // Input: {todos: ["task1", "task2"], merge: false}
  // ------------------------------------------------------------------
  it("S1: string array {todos: ['task1','task2'], merge: false}", () => {
    const { handlerOutput, uiItems, ctx } = simulateFullFlow({
      todos: ["task1", "task2"],
      merge: false,
    });

    // Handler must NOT produce an error
    expect(hasErrorPrefix(handlerOutput)).toBe(false);
    // Handler must NOT produce "(no todos)" — items WERE provided
    expect(handlerOutput).not.toBe("(no todos)");
    // ctx.todos must have 2 items
    expect(ctx.todos.length).toBe(2);
    expect(ctx.todos[0].content).toBe("task1");
    expect(ctx.todos[0].status).toBe("pending");
    expect(ctx.todos[1].content).toBe("task2");
    expect(ctx.todos[1].status).toBe("pending");
    // parseTodos must recover the items
    expect(uiItems.length).toBe(2);
    expect(uiItems[0].content).toBe("task1");
    expect(uiItems[1].content).toBe("task2");
    // Rendered output contains checkbox format
    expect(handlerOutput).toContain("[ ] task1");
    expect(handlerOutput).toContain("[ ] task2");
  });

  // ------------------------------------------------------------------
  // Scenario 2: Deepseek sends TodoWrite with tasks field (wrong name)
  // Input: {tasks: ["task1"], merge: false}
  // ------------------------------------------------------------------
  it("S2: wrong field {tasks: ['task1'], merge: false}", () => {
    const { handlerOutput, uiItems, ctx } = simulateFullFlow({
      tasks: ["task1"],
      merge: false,
    });

    expect(hasErrorPrefix(handlerOutput)).toBe(false);
    expect(handlerOutput).not.toBe("(no todos)");
    expect(ctx.todos.length).toBe(1);
    expect(ctx.todos[0].content).toBe("task1");
    expect(uiItems.length).toBe(1);
    expect(uiItems[0].status).toBe("pending");
  });

  // ------------------------------------------------------------------
  // Scenario 3: Deepseek sends TodoWrite with items field (wrong name)
  // Input: {items: ["task1"], merge: false}
  // ------------------------------------------------------------------
  it("S3: wrong field {items: ['task1'], merge: false}", () => {
    const { handlerOutput, uiItems, ctx } = simulateFullFlow({
      items: ["task1"],
      merge: false,
    });

    expect(hasErrorPrefix(handlerOutput)).toBe(false);
    expect(handlerOutput).not.toBe("(no todos)");
    expect(ctx.todos.length).toBe(1);
    expect(ctx.todos[0].content).toBe("task1");
    expect(uiItems.length).toBe(1);
  });

  // ------------------------------------------------------------------
  // Scenario 4: Deepseek sends bare array (no wrapping object)
  // Input: ["task1", "task2"]
  // ------------------------------------------------------------------
  it("S4: bare array ['task1','task2']", () => {
    const { handlerOutput, uiItems, ctx } = simulateFullFlow(["task1", "task2"]);

    expect(hasErrorPrefix(handlerOutput)).toBe(false);
    expect(handlerOutput).not.toBe("(no todos)");
    expect(ctx.todos.length).toBe(2);
    expect(ctx.todos[0].content).toBe("task1");
    expect(ctx.todos[1].content).toBe("task2");
    expect(uiItems.length).toBe(2);
  });

  // ------------------------------------------------------------------
  // Scenario 5: Deepseek sends TodoWrite with empty object
  // Input: {}
  // ------------------------------------------------------------------
  it("S5: empty object {}", () => {
    const { handlerOutput, ctx } = simulateFullFlow({});

    // No items were provided, no existing items — should get guidance message
    expect(ctx.todos.length).toBe(0);
    // The message is NOT prefixed with "error:" (avoids red X in UI)
    expect(hasErrorPrefix(handlerOutput)).toBe(false);
    // Empty malformed payloads must not invent work or force another turn.
    expect(handlerOutput).toBe("(no todos)");
    // Empty output produces no task rows.
    const uiItems = parseTodos(handlerOutput);
    expect(uiItems.length).toBe(0);
  });

  // ------------------------------------------------------------------
  // Scenario 6: Deepseek sends TodoWrite with null todos
  // Input: {todos: null, merge: false}
  // ------------------------------------------------------------------
  it("S6: null todos {todos: null, merge: false}", () => {
    const { handlerOutput, ctx } = simulateFullFlow({ todos: null, merge: false });

    expect(ctx.todos.length).toBe(0);
    expect(hasErrorPrefix(handlerOutput)).toBe(false);
    expect(handlerOutput).toBe("(no todos)");
  });

  // ------------------------------------------------------------------
  // Scenario 7: Deepseek sends TodoWrite with todos as string
  // Input: {todos: "single task", merge: false}
  // ------------------------------------------------------------------
  it("S7: string todos {todos: 'single task', merge: false}", () => {
    const { handlerOutput, ctx } = simulateFullFlow({ todos: "single task", merge: false });

    // "single task" is not an array — falls through to empty raw[]
    expect(ctx.todos.length).toBe(0);
    expect(hasErrorPrefix(handlerOutput)).toBe(false);
    expect(handlerOutput).toBe("(no todos)");
  });

  // ------------------------------------------------------------------
  // Scenario 8: Deepseek sends TodoWrite with todos as number
  // Input: {todos: 42, merge: false}
  // ------------------------------------------------------------------
  it("S8: number todos {todos: 42, merge: false}", () => {
    const { handlerOutput, ctx } = simulateFullFlow({ todos: 42, merge: false });

    expect(ctx.todos.length).toBe(0);
    expect(hasErrorPrefix(handlerOutput)).toBe(false);
    expect(handlerOutput).toBe("(no todos)");
  });

  // ------------------------------------------------------------------
  // Scenario 9: Deepseek sends TodoWrite with objects missing all fields
  // Input: {todos: [{}], merge: false}
  // ------------------------------------------------------------------
  it("S9: empty object in array {todos: [{}], merge: false}", () => {
    const { handlerOutput, uiItems, ctx } = simulateFullFlow({
      todos: [{}],
      merge: false,
    });

    expect(hasErrorPrefix(handlerOutput)).toBe(false);
    expect(handlerOutput).toContain("Skipped 1 invalid task entry");
    expect(ctx.todos).toHaveLength(0);
    expect(uiItems).toHaveLength(0);
  });

  // ------------------------------------------------------------------
  // Scenario 10: Deepseek sends TodoWrite with mixed types
  // Input: {todos: ["task1", null, {content: "task2"}, 42], merge: false}
  // ------------------------------------------------------------------
  it("S10: mixed types {todos: ['task1', null, {content:'task2'}, 42], merge: false}", () => {
    const { handlerOutput, uiItems, ctx } = simulateFullFlow({
      todos: ["task1", null, { content: "task2" }, 42],
      merge: false,
    });

    expect(hasErrorPrefix(handlerOutput)).toBe(false);
    expect(handlerOutput).not.toBe("(no todos)");
    // "task1" -> string conversion, null -> filtered, {content:"task2"} -> object, 42 -> filtered
    expect(ctx.todos.length).toBe(2);
    expect(ctx.todos[0].content).toBe("task1");
    expect(ctx.todos[0].status).toBe("pending");
    expect(ctx.todos[1].content).toBe("task2");
    expect(ctx.todos[1].status).toBe("pending");
    // parseTodos recovers both
    expect(uiItems.length).toBe(2);
    expect(uiItems[0].content).toBe("task1");
    expect(uiItems[1].content).toBe("task2");
  });

  // ------------------------------------------------------------------
  // Scenario 11: Model creates 5 todos then marks all completed in sequence
  // ------------------------------------------------------------------
  it("S11: create 5 → mark all completed sequentially (merge by id)", () => {
    const ctx: ToolContext = { todos: [] };

    // Step 1: Create 5 todos with explicit ids (realistic for structured input)
    const r1 = todoWriteHandler(
      { todos: [
        { id: "t1", content: "A", status: "pending" },
        { id: "t2", content: "B", status: "pending" },
        { id: "t3", content: "C", status: "pending" },
        { id: "t4", content: "D", status: "pending" },
        { id: "t5", content: "E", status: "pending" },
      ], merge: false },
      ctx,
    );
    expect(ctx.todos.length).toBe(5);
    expect(parseTodos(r1.output).length).toBe(5);
    expect(parseTodos(r1.output).every((t) => t.status === "pending")).toBe(true);

    // Step 2: Mark A completed (merge by id)
    const r2 = todoWriteHandler(
      { todos: [{ id: "t1", content: "A", status: "completed" }], merge: true },
      ctx,
    );
    expect(ctx.todos.length).toBe(5);
    const items2 = parseTodos(r2.output);
    expect(items2.filter((t) => t.status === "completed").length).toBe(1);
    expect(items2.find((t) => t.content === "A")?.status).toBe("completed");

    // Step 3: Mark B completed
    const r3 = todoWriteHandler(
      { todos: [{ id: "t2", content: "B", status: "completed" }], merge: true },
      ctx,
    );
    expect(ctx.todos.length).toBe(5);
    const items3 = parseTodos(r3.output);
    expect(items3.filter((t) => t.status === "completed").length).toBe(2);

    // Step 4: Mark C completed
    const r4 = todoWriteHandler(
      { todos: [{ id: "t3", content: "C", status: "completed" }], merge: true },
      ctx,
    );
    expect(ctx.todos.length).toBe(5);
    const items4 = parseTodos(r4.output);
    expect(items4.filter((t) => t.status === "completed").length).toBe(3);

    // Step 5: Mark D completed
    const r5 = todoWriteHandler(
      { todos: [{ id: "t4", content: "D", status: "completed" }], merge: true },
      ctx,
    );
    expect(ctx.todos.length).toBe(5);
    const items5 = parseTodos(r5.output);
    expect(items5.filter((t) => t.status === "completed").length).toBe(4);

    // Step 6: Mark E completed — all done
    const r6 = todoWriteHandler(
      { todos: [{ id: "t5", content: "E", status: "completed" }], merge: true },
      ctx,
    );
    expect(ctx.todos.length).toBe(5);
    expect(ctx.todos.every((t) => t.status === "completed")).toBe(true);
    const items6 = parseTodos(r6.output);
    expect(items6.every((t) => t.status === "completed")).toBe(true);

    // No step produced an error
    [r1, r2, r3, r4, r5, r6].forEach((r) => {
      expect(hasErrorPrefix(r.output)).toBe(false);
    });
  });

  // ------------------------------------------------------------------
  // Scenario 12: Model creates todos, marks some progress, then produces
  // text without tools (should NOT break the todo panel)
  // ------------------------------------------------------------------
  it("S12: create → partial progress → no tool call (should preserve)", () => {
    const ctx: ToolContext = { todos: [] };

    // Step 1: Create todos
    const r1 = todoWriteHandler(
      { todos: ["Task 1", "Task 2", "Task 3"], merge: false },
      ctx,
    );
    expect(ctx.todos.length).toBe(3);
    expect(parseTodos(r1.output).length).toBe(3);

    // Step 2: Mark one in progress
    const r2 = todoWriteHandler(
      { todos: [{ content: "Task 1", status: "in_progress" }], merge: true },
      ctx,
    );
    expect(ctx.todos.length).toBe(3);
    expect(parseTodos(r2.output).find((t) => t.content === "Task 1")?.status).toBe("in_progress");

    // Step 3: Model produces text without calling TodoWrite
    // This simulates the agent continuing to work without updating todos.
    // The key assertion: ctx.todos is UNCHANGED — not cleared, not frozen.
    expect(ctx.todos.length).toBe(3);
    expect(ctx.todos[0].status).toBe("in_progress");
    expect(ctx.todos[1].status).toBe("pending");
    expect(ctx.todos[2].status).toBe("pending");

    // The existing todos can still be read and rendered
    const stillRendered = ctx.todos
      .map((t) => {
        const mark = t.status === "completed" ? "[x]" : t.status === "in_progress" ? "[~]" : "[ ]";
        return `${mark} ${t.content}`;
      })
      .join("\n");
    const uiItems = parseTodos(stillRendered);
    expect(uiItems.length).toBe(3);
  });

  // ------------------------------------------------------------------
  // Scenario 13: Model calls TodoWrite with merge=true and empty array
  // (should preserve existing todos)
  // ------------------------------------------------------------------
  it("S13: merge=true + empty array → preserves existing", () => {
    const existing: TodoItem[] = [
      { id: "1", content: "Keep me", status: "pending" },
      { id: "2", content: "Me too", status: "in_progress" },
    ];
    const { handlerOutput, uiItems, ctx } = simulateFullFlow(
      { todos: [], merge: true },
      existing,
    );

    expect(hasErrorPrefix(handlerOutput)).toBe(false);
    // Existing todos preserved (incoming is empty, merge does nothing)
    expect(ctx.todos.length).toBe(2);
    expect(ctx.todos[0].content).toBe("Keep me");
    expect(ctx.todos[1].content).toBe("Me too");
    // parseTodos recovers the preserved state
    expect(uiItems.length).toBe(2);
    expect(uiItems[0].status).toBe("pending");
    expect(uiItems[1].status).toBe("in_progress");
  });

  // ------------------------------------------------------------------
  // Scenario 14: Model calls TodoWrite with merge=false and empty array
  // (should preserve existing — empty incoming means no replacement)
  // ------------------------------------------------------------------
  it("S14: merge=false + empty array → preserves existing", () => {
    const existing: TodoItem[] = [
      { id: "1", content: "Keep me", status: "completed" },
    ];
    const { handlerOutput, uiItems, ctx } = simulateFullFlow(
      { todos: [], merge: false },
      existing,
    );

    expect(hasErrorPrefix(handlerOutput)).toBe(false);
    // incoming.length === 0, so the "else if (incoming.length > 0)" branch is skipped
    // ctx.todos stays as existing
    expect(ctx.todos.length).toBe(1);
    expect(ctx.todos[0].content).toBe("Keep me");
    expect(ctx.todos[0].status).toBe("completed");
    // parseTodos recovers it
    expect(uiItems.length).toBe(1);
    expect(uiItems[0].status).toBe("completed");
  });

  // ------------------------------------------------------------------
  // Scenario 15: Full lifecycle — create → in_progress → completed → verify
  // ------------------------------------------------------------------
  it("S15: full lifecycle create → in_progress → completed → verify", () => {
    const ctx: ToolContext = { todos: [] };

    // ---- Phase 1: Create ----
    const create = todoWriteHandler(
      {
        todos: [
          { content: "Read codebase", status: "pending" },
          { content: "Write tests", status: "pending" },
          { content: "Ship feature", status: "pending" },
        ],
        merge: false,
      },
      ctx,
    );
    expect(hasErrorPrefix(create.output)).toBe(false);
    expect(ctx.todos.length).toBe(3);
    const created = parseTodos(create.output);
    expect(created.length).toBe(3);
    expect(created.every((t) => t.status === "pending")).toBe(true);

    // ---- Phase 2: Start first task ----
    const start = todoWriteHandler(
      { todos: [{ content: "Read codebase", status: "in_progress" }], merge: true },
      ctx,
    );
    expect(hasErrorPrefix(start.output)).toBe(false);
    expect(ctx.todos.length).toBe(3); // count unchanged
    const afterStart = parseTodos(start.output);
    expect(afterStart.find((t) => t.content === "Read codebase")?.status).toBe("in_progress");
    expect(afterStart.filter((t) => t.status === "pending").length).toBe(2);

    // ---- Phase 3: Complete first task, start second ----
    const mid = todoWriteHandler(
      {
        todos: [
          { content: "Read codebase", status: "completed" },
          { content: "Write tests", status: "in_progress" },
        ],
        merge: true,
      },
      ctx,
    );
    expect(hasErrorPrefix(mid.output)).toBe(false);
    expect(ctx.todos.length).toBe(3);
    const afterMid = parseTodos(mid.output);
    expect(afterMid.find((t) => t.content === "Read codebase")?.status).toBe("completed");
    expect(afterMid.find((t) => t.content === "Write tests")?.status).toBe("in_progress");
    expect(afterMid.find((t) => t.content === "Ship feature")?.status).toBe("pending");

    // ---- Phase 4: Complete all ----
    const done = todoWriteHandler(
      {
        todos: [
          { content: "Read codebase", status: "completed" },
          { content: "Write tests", status: "completed" },
          { content: "Ship feature", status: "completed" },
        ],
        merge: true,
      },
      ctx,
    );
    expect(hasErrorPrefix(done.output)).toBe(false);
    expect(ctx.todos.length).toBe(3);
    expect(ctx.todos.every((t) => t.status === "completed")).toBe(true);
    const afterDone = parseTodos(done.output);
    expect(afterDone.length).toBe(3);
    expect(afterDone.every((t) => t.status === "completed")).toBe(true);

    // ---- Verify: no "(no todos)" at any step ----
    [create, start, mid, done].forEach((r) => {
      expect(r.output).not.toBe("(no todos)");
    });
  });
});

// ==================== EDGE CASES (bonus coverage) ====================

describe("FREEZE REGRESSION: edge cases that also freeze the panel", () => {
  it("merge=true + string 'true' (deepseek sends merge as string)", () => {
    const existing: TodoItem[] = [
      { id: "1", content: "Existing", status: "pending" },
    ];
    const { handlerOutput, ctx } = simulateFullFlow(
      { todos: [{ content: "New task", status: "in_progress" }], merge: "true" },
      existing,
    );

    expect(hasErrorPrefix(handlerOutput)).toBe(false);
    // "true" is truthy → merge path is taken
    expect(ctx.todos.length).toBe(2);
  });

  it("merge=1 (number, deepseek sometimes does this)", () => {
    const existing: TodoItem[] = [
      { id: "1", content: "Existing", status: "pending" },
    ];
    const { ctx } = simulateFullFlow(
      { todos: [{ content: "New", status: "pending" }], merge: 1 },
      existing,
    );
    expect(ctx.todos.length).toBe(2);
  });

  it("object with .text instead of .content", () => {
    const { handlerOutput, ctx } = simulateFullFlow({
      todos: [{ text: "Via text field", status: "pending" }],
      merge: false,
    });
    expect(hasErrorPrefix(handlerOutput)).toBe(false);
    expect(ctx.todos.length).toBe(1);
    expect(ctx.todos[0].content).toBe("Via text field");
  });

  it("object with .title instead of .content", () => {
    const { ctx } = simulateFullFlow({
      todos: [{ title: "Via title field", status: "pending" }],
      merge: false,
    });
    expect(ctx.todos.length).toBe(1);
    expect(ctx.todos[0].content).toBe("Via title field");
  });

  it("object with .name instead of .content", () => {
    const { ctx } = simulateFullFlow({
      todos: [{ name: "Via name field", status: "pending" }],
      merge: false,
    });
    expect(ctx.todos.length).toBe(1);
    expect(ctx.todos[0].content).toBe("Via name field");
  });

  it("mixed strings and objects in same array", () => {
    const { handlerOutput, uiItems, ctx } = simulateFullFlow({
      todos: ["string task", { content: "object task", status: "completed" }],
      merge: false,
    });
    expect(hasErrorPrefix(handlerOutput)).toBe(false);
    expect(handlerOutput).not.toBe("(no todos)");
    expect(ctx.todos.length).toBe(2);
    expect(ctx.todos[0].content).toBe("string task");
    expect(ctx.todos[0].status).toBe("pending");
    expect(ctx.todos[1].content).toBe("object task");
    expect(ctx.todos[1].status).toBe("completed");
    expect(uiItems.length).toBe(2);
    expect(uiItems[0].status).toBe("pending");
    expect(uiItems[1].status).toBe("completed");
  });

  it("ctx.todos is not an array (initializes to [])", () => {
    const badCtx = { todos: "not an array" } as any;
    const result = todoWriteHandler({ todos: ["task1"], merge: false }, badCtx);
    expect(hasErrorPrefix(result.output)).toBe(false);
    expect(result.output).toContain("[ ] task1");
  });

  it("single string as todos (not wrapped in array)", () => {
    // Deepseek sometimes sends: {todos: "single task"}
    const { handlerOutput, ctx } = simulateFullFlow({ todos: "single task" });
    expect(ctx.todos.length).toBe(0);
    expect(hasErrorPrefix(handlerOutput)).toBe(false);
    expect(handlerOutput).toBe("(no todos)");
  });

  it("null input entirely", () => {
    const { handlerOutput, ctx } = simulateFullFlow(null);
    expect(ctx.todos.length).toBe(0);
    expect(hasErrorPrefix(handlerOutput)).toBe(false);
    expect(handlerOutput).toBe("(no todos)");
  });

  it("undefined input entirely", () => {
    const { handlerOutput, ctx } = simulateFullFlow(undefined);
    expect(ctx.todos.length).toBe(0);
    expect(hasErrorPrefix(handlerOutput)).toBe(false);
    expect(handlerOutput).toBe("(no todos)");
  });

  it("parseTodos: handler error message produces empty UI list (not freeze)", () => {
    const guidance = "TodoWrite requires items. Call again with: todos=[{content:'Task 1',status:'pending'}]";
    const uiItems = parseTodos(guidance);
    // No checkbox pattern in guidance → empty list (correct: shows nothing, not freeze)
    expect(uiItems.length).toBe(0);
  });

  it("parseTodos: multi-line output with mixed statuses", () => {
    const output = "[ ] Pending task\n[~] Active task\n[x] Done task\n[-] Cancelled task";
    const uiItems = parseTodos(output);
    expect(uiItems.length).toBe(4);
    expect(uiItems[0]).toEqual({ status: "pending", content: "Pending task" });
    expect(uiItems[1]).toEqual({ status: "in_progress", content: "Active task" });
    expect(uiItems[2]).toEqual({ status: "completed", content: "Done task" });
    expect(uiItems[3]).toEqual({ status: "cancelled", content: "Cancelled task" });
  });

  it("parseTodos: TodoRead format '- [status] content'", () => {
    const output = "- [pending] Task A\n- [completed] Task B";
    const uiItems = parseTodos(output);
    expect(uiItems.length).toBe(2);
    expect(uiItems[0].status).toBe("pending");
    expect(uiItems[1].status).toBe("completed");
  });
});
