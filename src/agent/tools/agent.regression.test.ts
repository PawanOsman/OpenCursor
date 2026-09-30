/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it, vi } from "vitest";
import { todoWriteTool } from "./agent";
import type { ToolContext } from "./types";

// The production tool imports workspace helpers, but these tests never use editor APIs.
vi.mock("vscode", () => ({}));

function existingTodos(): ToolContext {
  return {
    todos: [
      { id: "implement", content: "Implement the fix", status: "in_progress" },
      { id: "verify", content: "Run regression tests", status: "pending" },
    ],
  };
}

describe("TodoWrite production handler", () => {
  it("preserves descriptions and other items when merging a status update", async () => {
    const ctx = existingTodos();
    const result = await todoWriteTool.execute(
      { merge: true, todos: [{ id: "implement", status: "completed" }] },
      undefined, undefined, ctx,
    );

    expect(ctx.todos).toEqual([
      { id: "implement", content: "Implement the fix", status: "completed" },
      { id: "verify", content: "Run regression tests", status: "pending" },
    ]);
    expect(result.output).toBe("[x] Implement the fix\n[ ] Run regression tests");
  });

  it("preserves progress when merging a description update", async () => {
    const ctx = existingTodos();
    await todoWriteTool.execute(
      { merge: true, todos: [{ id: "implement", content: "Finish the fix" }] },
      undefined, undefined, ctx,
    );

    expect(ctx.todos[0]).toEqual({
      id: "implement", content: "Finish the fix", status: "in_progress",
    });
  });

  it("leaves an existing item intact when an update only identifies it", async () => {
    const ctx = existingTodos();
    const before = structuredClone(ctx.todos);
    await todoWriteTool.execute(
      { merge: true, todos: [{ id: "implement" }] },
      undefined, undefined, ctx,
    );

    expect(ctx.todos).toEqual(before);
  });

  it("defaults new task status and skips merged items without descriptions", async () => {
    const ctx = existingTodos();
    const result = await todoWriteTool.execute(
      { merge: true, todos: [{ id: "new", content: "Document the fix" }, { id: "unknown" }] },
      undefined, undefined, ctx,
    );

    expect(ctx.todos.slice(2)).toEqual([
      { id: "new", content: "Document the fix", status: "pending" },
    ]);
    expect(result.output).toContain("Skipped 1 invalid task entry");
    expect(result.output).not.toContain("unnamed");
  });

  it("replaces the list and supplies defaults without inheriting previous fields", async () => {
    const ctx = existingTodos();
    await todoWriteTool.execute(
      { todos: [{ id: "implement", content: "A replacement task" }] },
      undefined, undefined, ctx,
    );

    expect(ctx.todos).toEqual([
      { id: "implement", content: "A replacement task", status: "pending" },
    ]);
  });

  it.each(["todos", "tasks", "items"])("accepts string tasks from the %s field", async (field) => {
    const ctx: ToolContext = { todos: [] };
    await todoWriteTool.execute({ [field]: ["Read the file", "Verify the fix"] }, undefined, undefined, ctx);

    expect(ctx.todos).toEqual([
      { id: "auto_0", content: "Read the file", status: "pending" },
      { id: "auto_1", content: "Verify the fix", status: "pending" },
    ]);
  });

  it("accepts a bare array of string tasks", async () => {
    const ctx: ToolContext = { todos: [] };
    await todoWriteTool.execute(["Read the file"], undefined, undefined, ctx);

    expect(ctx.todos).toEqual([{ id: "auto_0", content: "Read the file", status: "pending" }]);
  });

  it("normalizes supported aliases and skips malformed or undescribed new tasks", async () => {
    const ctx: ToolContext = { todos: [] };
    const result = await todoWriteTool.execute({
      todos: [
        null,
        42,
        { id: "text", text: "Read", status: "unsupported" },
        { id: "title", title: "Write", status: "in_progress" },
        { id: "name", name: "Verify", status: "completed" },
        { id: "empty" },
      ],
    }, undefined, undefined, ctx);

    expect(ctx.todos).toEqual([
      { id: "text", content: "Read", status: "pending" },
      { id: "title", content: "Write", status: "in_progress" },
      { id: "name", content: "Verify", status: "completed" },
    ]);
    expect(result.output).toContain("Skipped 3 invalid task entries");
    expect(result.output).not.toContain("unnamed");
  });
  it("does not overwrite an explicitly assigned id when normalizing another incoming task", async () => {
    const ctx: ToolContext = { todos: [] };
    await todoWriteTool.execute({ merge: true, todos: [{ id: "auto_1", content: "Explicit" }, { content: "Generated" }] }, undefined, undefined, ctx);
    expect(ctx.todos).toHaveLength(2);
    expect(new Set(ctx.todos.map((todo) => todo.id)).size).toBe(2);
    expect(ctx.todos.map((todo) => todo.content)).toEqual(["Explicit", "Generated"]);
  });
});
