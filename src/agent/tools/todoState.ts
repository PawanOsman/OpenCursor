/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { ToolContext, ToolResult, TodoItem } from "./types";
import { todoDescription } from "../../shared/todoPresentation";

/** Production todo state transitions, shared by tools and unit tests. */
export function writeTodos(input: any, ctx?: Pick<ToolContext, "todos">): ToolResult {
  try {
    if (!ctx) return { output: "error: todo context unavailable" };
    if (!Array.isArray(ctx.todos)) ctx.todos = [];

    // CRITICAL: Normalize incoming items. Models (Mimo, deepseek) send strings
    // instead of objects, or objects missing fields, or use wrong field names.
    // Accept 'todos', 'tasks', 'items', or any array field.
    const raw: any[] = Array.isArray(input?.todos) ? input.todos
      : Array.isArray(input?.tasks) ? input.tasks
      : Array.isArray(input?.items) ? input.items
      : Array.isArray(input) ? input
      : [];
    const usedIds = new Set(ctx.todos.map((todo, i) => todo.id || `auto_${i}`));
    const idFor = (id: unknown, content: unknown, index: number): string => {
      if (id) { usedIds.add(String(id)); return String(id); }
      if (input?.merge && content !== undefined) {
        const matches = ctx.todos.map((todo, i) => ({ todo, i })).filter(({ todo }) => todo.content === String(content));
        if (matches.length === 1) return matches[0].todo.id || `auto_${matches[0].i}`;
      }
      let candidate = `auto_${index}`;
      if (input?.merge) while (usedIds.has(candidate)) candidate = `auto_${++index}`;
      usedIds.add(candidate);
      return candidate;
    };
    type TodoUpdate = Partial<TodoItem> & { id: string };
    const incoming: TodoUpdate[] = raw.map((t, i): TodoUpdate | null => {
      if (typeof t === "string") {
        const content = todoDescription(t);
        return content ? { id: idFor(undefined, content, i), content, status: "pending" as const } : null;
      }
      if (t && typeof t === "object") {
        const content = todoDescription(t);
        if (!content && !t.id) return null;
        return {
          id: idFor(t.id, content, i),
          // Omitted fields must stay absent until merged with the existing item.
          ...(content != null ? { content: String(content) } : {}),
          ...(t.status !== undefined ? {
            status: (["pending", "in_progress", "completed", "cancelled"].includes(t.status) ? t.status : "pending") as TodoItem["status"],
          } : {}),
        };
      }
      return null;
    }).filter((t): t is TodoUpdate => t !== null);
    const previous = new Map(ctx.todos.map((t, i) => [t.id || `auto_${i}`, t]));
    let missing = 0;
    const resolved = incoming.flatMap((update): TodoItem[] => {
      const existing = previous.get(update.id);
      const content = update.content || todoDescription(existing);
      if (!content) { missing++; return []; }
      const item: TodoItem = { status: "pending", ...(input?.merge || !update.content ? existing : undefined), ...update, content };
      previous.set(item.id, item);
      return [item];
    });

    if (raw.length === 0 && ctx.todos.length === 0) {
      // Do not invent work or trigger continuation nudges for an empty payload.
      return { output: "(no todos)" };
    }

    if (input?.merge) {
      const byId = new Map(ctx.todos.map((t) => [t.id || `auto_${ctx.todos.indexOf(t)}`, t]));
      for (const t of resolved) {
        byId.set(t.id, t);
      }
      ctx.todos = [...byId.values()];
    } else if (resolved.length > 0) {
      ctx.todos = resolved;
    }

    const render = ctx.todos
      .map((t) => {
        const mark =
          t.status === "completed" ? "[x]" : t.status === "in_progress" ? "[~]" : t.status === "cancelled" ? "[-]" : "[ ]";
        return `${mark} ${todoDescription(t) || "Task description unavailable"}`;
      })
      .join("\n");
    const skipped = missing + raw.length - incoming.length;
    const guidance = skipped ? `\nSkipped ${skipped} invalid task ${skipped === 1 ? "entry" : "entries"}. Provide a non-empty content string for new tasks, or the exact existing id for status-only updates.` : "";
    return { output: (render || "(no todos)") + guidance };
  } catch (e) {
    return { output: `error: unable to update todos: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export function readTodos(ctx?: Pick<ToolContext, "todos">): ToolResult {
  if (!ctx) return { output: "error: todo context unavailable" };
  if (!Array.isArray(ctx.todos) || !ctx.todos.length) {
    return {
      output: "(no todos)",
    };
  }
  return { output: ctx.todos.map((t) => `- [${t.status}] ${todoDescription(t) || "Task description unavailable"}`).join("\n") };
}
