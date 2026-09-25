/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { writeTodos as todoWriteHandler, readTodos as todoReadHandler } from "./todoState";
import type { TodoItem, ToolContext } from "./types";
/**
 * PROOF tests — simulates exactly what Mimo V2.5 sends to TodoWrite.
 * Every test MUST pass or the extension is broken.
 */
import { describe, it, expect } from "vitest";





// State changes run through the production todo implementation.


// ============================================================
// MIMO V2.5 ACTUAL PAYLOADS — these are what the model sends
// ============================================================

describe("PROOF: Mimo V2.5 TodoWrite payloads", () => {
  it("Mimo call #1: create todos WITHOUT id (merge=false)", () => {
    const ctx: ToolContext = { todos: [] } as unknown as ToolContext;
    // This is EXACTLY what Mimo sends — no id field
    const r = todoWriteHandler({
      todos: [
        { content: "Explore nuxil-chat codebase", status: "in_progress" },
        { content: "Fetch key Claude Code issues", status: "pending" },
        { content: "Propose improvements", status: "pending" },
      ],
      merge: false,
    }, ctx);

    // MUST have 3 items
    expect(ctx.todos.length).toBe(3);
    // MUST show [~] for in_progress
    expect(r.output).toContain("[~] Explore nuxil-chat codebase");
    // MUST show [ ] for pending
    expect(r.output).toContain("[ ] Fetch key Claude Code issues");
    expect(r.output).toContain("[ ] Propose improvements");
    // MUST NOT be "(no todos)"
    expect(r.output).not.toBe("(no todos)");
    // MUST NOT start with "error:"
    expect(r.output.startsWith("error:")).toBe(false);
    // MUST NOT be empty
    expect(r.output.trim().length).toBeGreaterThan(0);
  });

  it("Mimo call #2: mark item completed WITHOUT id (merge=true)", () => {
    const ctx: ToolContext = {
      todos: [
        { content: "Explore nuxil-chat codebase", status: "in_progress" },
        { content: "Fetch key Claude Code issues", status: "pending" },
        { content: "Propose improvements", status: "pending" },
      ],
    } as unknown as ToolContext;
    // Mimo sends completed status WITHOUT id
    const r = todoWriteHandler({
      todos: [{ content: "Explore nuxil-chat codebase", status: "completed" }],
      merge: true,
    }, ctx);

    // MUST have at least 1 item
    expect(ctx.todos.length).toBeGreaterThanOrEqual(1);
    // MUST NOT be "(no todos)"
    expect(r.output).not.toBe("(no todos)");
    // MUST NOT start with "error:"
    expect(r.output.startsWith("error:")).toBe(false);
  });

  it("Mimo call #3: empty todos array (merge=false) — preserves list", () => {
    const ctx: ToolContext = {
      todos: [
        { content: "Task A", status: "in_progress" },
        { content: "Task B", status: "pending" },
      ],
    } as unknown as ToolContext;
    const r = todoWriteHandler({ todos: [], merge: false }, ctx);

    // MUST preserve existing 2 items
    expect(ctx.todos.length).toBe(2);
    expect(r.output).not.toBe("(no todos)");
    expect(r.output.startsWith("error:")).toBe(false);
  });

  it("Mimo call #4: empty todos array (merge=true) — preserves list", () => {
    const ctx: ToolContext = {
      todos: [{ content: "Task A", status: "pending" }],
    } as unknown as ToolContext;
    const r = todoWriteHandler({ todos: [], merge: true }, ctx);
    expect(ctx.todos.length).toBe(1);
    expect(r.output.startsWith("error:")).toBe(false);
  });

  it("Mimo call #5: null/undefined input — preserves list", () => {
    const ctx: ToolContext = {
      todos: [{ content: "Task A", status: "pending" }],
    } as unknown as ToolContext;
    const r1 = todoWriteHandler(null, ctx);
    const r2 = todoWriteHandler(undefined, ctx);
    expect(ctx.todos.length).toBe(1);
    expect(r1.output.startsWith("error:")).toBe(false);
    expect(r2.output.startsWith("error:")).toBe(false);
  });

  it("Mimo call #6: missing merge field — preserves list", () => {
    const ctx: ToolContext = {
      todos: [{ content: "Task A", status: "pending" }],
    } as unknown as ToolContext;
    const r = todoWriteHandler({ todos: [] }, ctx);
    // No merge field → treated as falsy → empty array → preserved
    expect(ctx.todos.length).toBe(1);
    expect(r.output.startsWith("error:")).toBe(false);
  });

  it("Mimo call #7: mixed items with and without id", () => {
    const ctx: ToolContext = { todos: [] } as unknown as ToolContext;
    const r = todoWriteHandler({
      todos: [
        { content: "With ID", status: "pending", id: "real_id" },
        { content: "Without ID", status: "in_progress" },
        { id: "no-content", status: "pending" },
      ],
      merge: false,
    }, ctx);

    // Keep meaningful tasks and ask for the missing description.
    expect(ctx.todos.length).toBe(2);
    expect(r.output).toContain("[ ] With ID");
    expect(r.output).toContain("[~] Without ID");
    expect(r.output).toContain("Skipped 1 invalid task entry");
    expect(r.output.startsWith("error:")).toBe(false);
  });

  it("Mimo call #8: full lifecycle — create → mark progress → complete", () => {
    const ctx: ToolContext = { todos: [] } as unknown as ToolContext;

    // Step 1: Create 3 todos (no id)
    todoWriteHandler({
      todos: [
        { content: "Task 1", status: "pending" },
        { content: "Task 2", status: "pending" },
        { content: "Task 3", status: "pending" },
      ],
      merge: false,
    }, ctx);
    expect(ctx.todos.length).toBe(3);

    // Step 2: Mark task 1 in_progress (no id)
    todoWriteHandler({
      todos: [{ content: "Task 1", status: "in_progress" }],
      merge: true,
    }, ctx);
    // Should have 3+ items (original 3 + maybe a new one from merge)
    expect(ctx.todos.length).toBeGreaterThanOrEqual(3);

    // Step 3: Mark task 1 completed (no id)
    const r3 = todoWriteHandler({
      todos: [{ content: "Task 1", status: "completed" }],
      merge: true,
    }, ctx);
    expect(ctx.todos.length).toBeGreaterThanOrEqual(3);
    expect(r3.output.startsWith("error:")).toBe(false);
    expect(r3.output).not.toBe("(no todos)");

    // Step 4: Check remaining open items
    const open = ctx.todos.filter((t) => t.status === "pending" || t.status === "in_progress");
    expect(open.length).toBeGreaterThanOrEqual(2);
  });
});

describe("PROOF: output never causes red X", () => {
  const ctx: ToolContext = { todos: [] } as unknown as ToolContext;
  const inputs = [
    null,
    undefined,
    {},
    { todos: null },
    { todos: undefined },
    { todos: "string" },
    { todos: 42 },
    { todos: [] },
    { todos: [null] },
    { todos: [{}] },
    { todos: [{ content: "A" }] },
    { todos: [{ content: "A", status: "bad" }] },
    { merge: true },
    { merge: false },
    { todos: [{ content: "A", status: "pending" }], merge: "yes" },
    { todos: [{ content: "A", status: "pending" }], merge: 1 },
    { todos: [{ content: "A", status: "pending" }], merge: 0 },
  ];

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    it(`input #${i} → never "error:"`, () => {
      const r = todoWriteHandler(input, { todos: [] });
      expect(r.output.startsWith("error:")).toBe(false);
    });
  }
});

describe("PROOF: TodoRead always works", () => {


  it("returns list for items without id", () => {
    const ctx: ToolContext = {
      todos: [
        { content: "Task A", status: "pending" } as any,
        { content: "Task B", status: "completed" } as any,
      ],
    } as unknown as ToolContext;
    const r = todoReadHandler(ctx);
    expect(r.output).toContain("- [pending] Task A");
    expect(r.output).toContain("- [completed] Task B");
  });

  it("handles null ctx", () => {
    expect(todoReadHandler(null as any).output).toBe("error: todo context unavailable");
  });
});
