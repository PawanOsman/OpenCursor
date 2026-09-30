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
 * Comprehensive unit tests for TodoWrite/TodoRead handlers and agent loop.
 * Covers ALL edge cases discovered during the freeze investigation.
 */
import { describe, it, expect } from "vitest";

// ---- Loop simulation ----

const CONSECUTIVE_TEXT_LIMIT = 2;

// ==================== TESTS ====================

describe("TodoWrite — happy path", () => {
  it("creates todos with merge=false", () => {
    const ctx: ToolContext = { todos: [] };
    const r = todoWriteHandler({ todos: [{ id: "1", content: "Fix bug", status: "pending" }], merge: false }, ctx);
    expect(ctx.todos).toHaveLength(1);
    expect(r.output).toBe("[ ] Fix bug");
  });

  it("replaces entire list with merge=false", () => {
    const ctx: ToolContext = { todos: [{ id: "1", content: "Old", status: "pending" }] };
    todoWriteHandler({ todos: [{ id: "2", content: "New", status: "in_progress" }], merge: false }, ctx);
    expect(ctx.todos).toHaveLength(1);
    expect(ctx.todos[0].id).toBe("2");
  });

  it("merges by id with merge=true", () => {
    const ctx: ToolContext = { todos: [{ id: "1", content: "A", status: "pending" }, { id: "2", content: "B", status: "pending" }] };
    todoWriteHandler({ todos: [{ id: "1", status: "completed" }], merge: true }, ctx);
    expect(ctx.todos.find((t) => t.id === "1")!.status).toBe("completed");
    expect(ctx.todos.find((t) => t.id === "1")!.content).toBe("A");
    expect(ctx.todos.find((t) => t.id === "2")!.status).toBe("pending");
  });

  it("adds new item with merge=true", () => {
    const ctx: ToolContext = { todos: [{ id: "1", content: "A", status: "pending" }] };
    todoWriteHandler({ todos: [{ id: "2", content: "B", status: "pending" }], merge: true }, ctx);
    expect(ctx.todos).toHaveLength(2);
  });

  it("outputs correct marks for all statuses", () => {
    const ctx: ToolContext = { todos: [] };
    todoWriteHandler({
      todos: [
        { id: "1", content: "Done", status: "completed" },
        { id: "2", content: "Active", status: "in_progress" },
        { id: "3", content: "Skip", status: "cancelled" },
        { id: "4", content: "Wait", status: "pending" },
      ],
      merge: false,
    }, ctx);
    const r = todoWriteHandler({ todos: ctx.todos, merge: true }, ctx);
    expect(r.output).toContain("[x] Done");
    expect(r.output).toContain("[~] Active");
    expect(r.output).toContain("[-] Skip");
    expect(r.output).toContain("[ ] Wait");
  });

  it("preserves list when merge=true with empty array", () => {
    const ctx: ToolContext = { todos: [{ id: "1", content: "A", status: "pending" }] };
    todoWriteHandler({ todos: [], merge: true }, ctx);
    expect(ctx.todos).toHaveLength(1);
  });

  it("preserves list when merge=false with empty array", () => {
    const ctx: ToolContext = { todos: [{ id: "1", content: "A", status: "pending" }] };
    todoWriteHandler({ todos: [], merge: false }, ctx);
    expect(ctx.todos).toHaveLength(1);
  });

  it("returns (no todos) for empty list", () => {
    const ctx: ToolContext = { todos: [] };
    const r = todoWriteHandler({ todos: [], merge: true }, ctx);
    expect(r.output).toBe("(no todos)");
  });
});

describe("TodoWrite — defensive input validation", () => {
  it("handles null input", () => {
    const ctx: ToolContext = { todos: [{ id: "1", content: "A", status: "pending" }] };
    const r = todoWriteHandler(null, ctx);
    // Should NOT throw, should preserve list
    expect(ctx.todos).toHaveLength(1);
    expect(r.output).toContain("[ ] A");
  });

  it("handles undefined input", () => {
    const ctx: ToolContext = { todos: [{ id: "1", content: "A", status: "pending" }] };
    const r = todoWriteHandler(undefined, ctx);
    expect(ctx.todos).toHaveLength(1);
  });

  it("handles input.todos being a string", () => {
    const ctx: ToolContext = { todos: [] };
    const r = todoWriteHandler({ todos: "not an array", merge: false }, ctx);
    expect(r.output).toBe("(no todos)");
  });

  it("handles input.todos being a number", () => {
    const ctx: ToolContext = { todos: [] };
    const r = todoWriteHandler({ todos: 42, merge: false }, ctx);
    expect(r.output).toBe("(no todos)");
  });

  it("handles input.todos being null", () => {
    const ctx: ToolContext = { todos: [] };
    const r = todoWriteHandler({ todos: null, merge: false }, ctx);
    expect(r.output).toBe("(no todos)");
  });

  it("handles items without id", () => {
    const ctx: ToolContext = { todos: [] };
    todoWriteHandler({ todos: [{ content: "No ID", status: "pending" }], merge: false }, ctx);
    // Incoming tasks receive stable generated ids.
    expect(ctx.todos).toHaveLength(1);
    expect(ctx.todos[0].id).toMatch(/^auto_/);
  });

  it("handles items without content", () => {
    const ctx: ToolContext = { todos: [] };
    todoWriteHandler({ todos: [{ id: "1", status: "pending" }], merge: false }, ctx);
    expect(ctx.todos).toHaveLength(0);
  });

  it("handles items with null content", () => {
    const ctx: ToolContext = { todos: [] };
    todoWriteHandler({ todos: [{ id: "1", content: null, status: "pending" }], merge: false }, ctx);
    const r = todoWriteHandler({ todos: ctx.todos, merge: true }, ctx);
    expect(r.output).toBe("(no todos)");
  });

  it("handles items with wrong status", () => {
    const ctx: ToolContext = { todos: [] };
    todoWriteHandler({ todos: [{ id: "1", content: "Test", status: "invalid" }], merge: false }, ctx);
    const r = todoWriteHandler({ todos: ctx.todos, merge: true }, ctx);
    // Invalid status defaults to [ ] (pending)
    expect(r.output).toContain("[ ] Test");
  });

  it("handles ctx.todos being null (defensive reset)", () => {
    const ctx = { todos: null } as any;
    const r = todoWriteHandler({ todos: [{ id: "1", content: "A", status: "pending" }], merge: false }, ctx);
    expect(ctx.todos).toHaveLength(1);
    expect(r.output).toContain("[ ] A");
  });

  it("handles ctx.todos being undefined (defensive reset)", () => {
    const ctx = { todos: undefined } as any;
    const r = todoWriteHandler({ todos: [{ id: "1", content: "A", status: "pending" }], merge: false }, ctx);
    expect(ctx.todos).toHaveLength(1);
  });

  it("handles merge with items missing id (preserves the new task)", () => {
    const ctx: ToolContext = { todos: [{ id: "1", content: "A", status: "pending" }] };
    todoWriteHandler({ todos: [{ id: "1", status: "completed" }, { content: "No ID", status: "pending" }], merge: true }, ctx);
    expect(ctx.todos).toHaveLength(2); // existing plus normalized incoming
    expect(ctx.todos[0].status).toBe("completed");
  });

  it("never returns error: prefix (prevents red X in UI)", () => {
    const ctx: ToolContext = { todos: [] };
    const inputs = [
      null,
      undefined,
      {},
      { todos: null },
      { todos: "string" },
      { todos: 42 },
      { todos: [] },
      { todos: [null] },
      { todos: [{}] },
      { todos: [{ id: "1" }] },
      { merge: true },
      { merge: false },
    ];
    for (const input of inputs) {
      const r = todoWriteHandler(input, ctx);
      expect(r.output.startsWith("error:")).toBe(false);
    }
  });
});

describe("TodoWrite — race condition safety", () => {
  it("two sequential TodoWrite calls don't clobber", () => {
    const ctx: ToolContext = { todos: [] };
    todoWriteHandler({ todos: [{ id: "1", content: "A", status: "pending" }], merge: false }, ctx);
    todoWriteHandler({ todos: [{ id: "2", content: "B", status: "pending" }], merge: false }, ctx);
    expect(ctx.todos).toHaveLength(1);
    expect(ctx.todos[0].id).toBe("2");
  });

  it("merge=true preserves previous items", () => {
    const ctx: ToolContext = { todos: [] };
    todoWriteHandler({ todos: [{ id: "1", content: "A", status: "pending" }, { id: "2", content: "B", status: "pending" }], merge: false }, ctx);
    todoWriteHandler({ todos: [{ id: "1", status: "completed" }], merge: true }, ctx);
    todoWriteHandler({ todos: [{ id: "2", status: "completed" }], merge: true }, ctx);
    expect(ctx.todos).toHaveLength(2);
    expect(ctx.todos.every((t) => t.status === "completed")).toBe(true);
  });
});

describe("TodoRead handler", () => {
  it("returns (no todos) for empty list", () => {
    expect(todoReadHandler({ todos: [] }).output).toBe("(no todos)");
  });

  it("returns full list with status markers", () => {
    const ctx: ToolContext = { todos: [
      { id: "1", content: "A", status: "completed" },
      { id: "2", content: "B", status: "pending" },
    ]};
    const r = todoReadHandler(ctx);
    expect(r.output).toContain("- [completed] A");
    expect(r.output).toContain("- [pending] B");
  });

  it("handles null ctx", () => {
    const r = todoReadHandler(null as any);
    expect(r.output).toBe("error: todo context unavailable");
  });

  it("handles ctx.todos being null", () => {
    const r = todoReadHandler({ todos: null } as any);
    expect(r.output).toBe("(no todos)");
  });
});
