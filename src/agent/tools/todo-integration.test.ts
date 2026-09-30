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
 * INTEGRATION TESTS — simulates the COMPLETE flow from model input to UI render.
 * Tests what deepseek-v4-flash ACTUALLY sends, not what we expect.
 */
import { describe, it, expect } from "vitest";

// ---- Types ----



// State changes run through the production todo implementation.


// State changes run through the production todo implementation.


// ---- Full integration: handler → parseTodos → UI ----
function simulateFullFlow(input: any): { handlerOutput: string; uiItems: { status: string; content: string }[]; ctx: ToolContext } {
  const ctx: ToolContext = { todos: [] };
  const result = todoWriteHandler(input, ctx);
  const uiItems = parseTodos(result.output);
  return { handlerOutput: result.output, uiItems, ctx };
}

// ==================== TESTS ====================

describe("INTEGRATION: deepseek-v4-flash actual inputs", () => {
  it("deepseek sends todos: [] (empty array) → no invented todos", () => {
    const { handlerOutput, uiItems } = simulateFullFlow({ todos: [], merge: false });
    expect(handlerOutput).toBe("(no todos)");
    expect(uiItems.length).toBe(0);
  });

  it("deepseek sends todos: ['task1', 'task2'] (strings) → renders correctly", () => {
    const { handlerOutput, uiItems, ctx } = simulateFullFlow({ todos: ["Explore codebase", "Analyze issues", "Write proposal"], merge: false });
    expect(ctx.todos.length).toBe(3);
    expect(handlerOutput).toContain("[ ] Explore codebase");
    expect(handlerOutput).toContain("[ ] Analyze issues");
    expect(handlerOutput).toContain("[ ] Write proposal");
    expect(uiItems.length).toBe(3);
    expect(uiItems[0].content).toBe("Explore codebase");
  });

  it("deepseek sends tasks: ['a', 'b'] (wrong field name) → works", () => {
    const { handlerOutput, ctx } = simulateFullFlow({ tasks: ["Task A", "Task B"], merge: false });
    expect(ctx.todos.length).toBe(2);
    expect(handlerOutput).toContain("[ ] Task A");
  });

  it("deepseek sends items: ['x'] (wrong field name) → works", () => {
    const { ctx } = simulateFullFlow({ items: ["Item X"], merge: false });
    expect(ctx.todos.length).toBe(1);
  });

  it("deepseek sends bare array (no field name) → works", () => {
    const { ctx } = simulateFullFlow(["Task A", "Task B"]);
    expect(ctx.todos.length).toBe(2);
  });

  it("deepseek sends merge: 'true' (string instead of boolean) → merge mode", () => {
    const ctx: ToolContext = { todos: [{ id: "1", content: "Existing", status: "pending" }] };
    const r = todoWriteHandler({ todos: [{ content: "New task", status: "in_progress" }], merge: "true" }, ctx);
    expect(ctx.todos.length).toBe(2);
  });

  it("deepseek sends merge: 1 (number) → merge mode", () => {
    const ctx: ToolContext = { todos: [{ id: "1", content: "Existing", status: "pending" }] };
    const r = todoWriteHandler({ todos: [{ content: "New task", status: "pending" }], merge: 1 }, ctx);
    expect(ctx.todos.length).toBe(2);
  });
});

describe("INTEGRATION: malformed inputs that cause (no todos)", () => {
  it("input is null → no invented todos", () => {
    const { handlerOutput } = simulateFullFlow(null);
    expect(handlerOutput).toBe("(no todos)");
  });

  it("input is undefined → no invented todos", () => {
    const { handlerOutput } = simulateFullFlow(undefined);
    expect(handlerOutput).toBe("(no todos)");
  });

  it("input is empty object → no invented todos", () => {
    const { handlerOutput } = simulateFullFlow({});
    expect(handlerOutput).toBe("(no todos)");
  });

  it("input.todos is null → no invented todos", () => {
    const { handlerOutput } = simulateFullFlow({ todos: null, merge: false });
    expect(handlerOutput).toBe("(no todos)");
  });

  it("input.todos is string → no invented todos (not array)", () => {
    const { handlerOutput } = simulateFullFlow({ todos: "not an array", merge: false });
    expect(handlerOutput).toBe("(no todos)");
  });

  it("input.todos is number → no invented todos (not array)", () => {
    const { handlerOutput } = simulateFullFlow({ todos: 42, merge: false });
    expect(handlerOutput).toBe("(no todos)");
  });

  it("input.todos is boolean → no invented todos (not array)", () => {
    const { handlerOutput } = simulateFullFlow({ todos: true, merge: false });
    expect(handlerOutput).toBe("(no todos)");
  });

  it("input.todos is object (not array) → no invented todos", () => {
    const { handlerOutput } = simulateFullFlow({ todos: { task: "A" }, merge: false });
    expect(handlerOutput).toBe("(no todos)");
  });

  it("input has no todos/tasks/items fields → no invented todos", () => {
    const { handlerOutput } = simulateFullFlow({ merge: false, other: "data" });
    expect(handlerOutput).toBe("(no todos)");
  });
});

describe("INTEGRATION: mixed valid/invalid items", () => {
  it("array with null + strings → strings survive, nulls filtered", () => {
    const { ctx } = simulateFullFlow({ todos: [null, "Task A", undefined, "Task B"], merge: false });
    expect(ctx.todos.length).toBe(2);
    expect(ctx.todos[0].content).toBe("Task A");
  });

  it("array with objects missing content does not invent work", () => {
    const { ctx } = simulateFullFlow({ todos: [{ id: "1", status: "pending" }], merge: false });
    expect(ctx.todos.length).toBe(0);
  });

  it("array with objects missing status → defaults to 'pending'", () => {
    const { ctx } = simulateFullFlow({ todos: [{ id: "1", content: "Task" }], merge: false });
    expect(ctx.todos[0].status).toBe("pending");
  });

  it("array with objects missing id → auto-generates id", () => {
    const { ctx } = simulateFullFlow({ todos: [{ content: "Task", status: "pending" }], merge: false });
    expect(ctx.todos[0].id).toMatch(/^auto_/);
  });

  it("array with invalid status → defaults to 'pending'", () => {
    const { ctx } = simulateFullFlow({ todos: [{ content: "Task", status: "invalid" }], merge: false });
    expect(ctx.todos[0].status).toBe("pending");
  });

  it("array with all nulls → no invented todos (nothing survives filter)", () => {
    const { handlerOutput } = simulateFullFlow({ todos: [null, null, null], merge: false });
    expect(handlerOutput).toContain("(no todos)");
    expect(handlerOutput).toContain("Skipped 3 invalid task entries");
  });
});

describe("INTEGRATION: parseTodos matches handler output", () => {
  it("handler output '[ ] Task' → parseTodos returns 1 item", () => {
    const { handlerOutput, uiItems } = simulateFullFlow({ todos: ["Task"], merge: false });
    expect(uiItems.length).toBe(1);
    expect(uiItems[0].status).toBe("pending");
    expect(uiItems[0].content).toBe("Task");
  });

  it("handler output '[x] Done' → parseTodos returns completed", () => {
    const { handlerOutput, uiItems } = simulateFullFlow({ todos: [{ content: "Done", status: "completed" }], merge: false });
    expect(uiItems.length).toBe(1);
    expect(uiItems[0].status).toBe("completed");
  });

  it("handler output '[~] Active' → parseTodos returns in_progress", () => {
    const { handlerOutput, uiItems } = simulateFullFlow({ todos: [{ content: "Active", status: "in_progress" }], merge: false });
    expect(uiItems.length).toBe(1);
    expect(uiItems[0].status).toBe("in_progress");
  });

  it("handler output '[-] Skip' → parseTodos returns cancelled", () => {
    const { handlerOutput, uiItems } = simulateFullFlow({ todos: [{ content: "Skip", status: "cancelled" }], merge: false });
    expect(uiItems.length).toBe(1);
    expect(uiItems[0].status).toBe("cancelled");
  });

  it("handler output '(no todos)' → parseTodos returns empty (shows fallback)", () => {
    const uiItems = parseTodos("(no todos)");
    expect(uiItems.length).toBe(0);
  });

  it("handler output 'ERROR: ...' → parseTodos returns empty (shows fallback)", () => {
    const uiItems = parseTodos("ERROR: You called TodoWrite with an empty list.");
    expect(uiItems.length).toBe(0);
  });
});

describe("INTEGRATION: realistic deepseek multi-step flow", () => {
  it("create → mark progress → complete → final", () => {
    const ctx: ToolContext = { todos: [] };

    // Step 1: Create 3 todos (deepseek style — strings)
    const r1 = todoWriteHandler({ todos: ["Explore codebase", "Analyze issues", "Write proposal"], merge: false }, ctx);
    expect(ctx.todos.length).toBe(3);
    expect(parseTodos(r1.output).length).toBe(3);

    // Step 2: Mark first as in_progress (merge)
    const r2 = todoWriteHandler({ todos: [{ content: "Explore codebase", status: "in_progress" }], merge: true }, ctx);
    expect(ctx.todos.length).toBe(3);
    const items2 = parseTodos(r2.output);
    expect(items2.find((i) => i.content === "Explore codebase")?.status).toBe("in_progress");

    // Step 3: Mark first as completed (merge)
    const r3 = todoWriteHandler({ todos: [{ content: "Explore codebase", status: "completed" }], merge: true }, ctx);
    expect(ctx.todos.length).toBe(3);
    const items3 = parseTodos(r3.output);
    expect(items3.find((i) => i.content === "Explore codebase")?.status).toBe("completed");
    expect(items3.filter((i) => i.status === "pending").length).toBe(2);

    // Step 4: All done
    const r4 = todoWriteHandler({ todos: [
      { content: "Explore codebase", status: "completed" },
      { content: "Analyze issues", status: "completed" },
      { content: "Write proposal", status: "completed" },
    ], merge: true }, ctx);
    expect(ctx.todos.every((t) => t.status === "completed")).toBe(true);
  });
});
