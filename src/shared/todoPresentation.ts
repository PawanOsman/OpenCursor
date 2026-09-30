/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

/** Recover descriptions from the common task payload formats. */
export function todoDescription(item: unknown): string | undefined {
  const candidates = typeof item === "string" ? [item] : item && typeof item === "object"
    ? ["content", "text", "title", "name", "description", "task", "label"].map(key => (item as Record<string, unknown>)[key]) : [];
  for (const value of candidates) {
    if (typeof value !== "string") continue;
    const text = value.replace(/\s+/g, " ").trim();
    if (text && text.toLowerCase() !== "unnamed") return text;
  }
  return undefined;
}

/** Parse the production TodoWrite/TodoRead display format. */
export function parseTodos(output: string): { status: string; content: string }[] {
  const items: { status: string; content: string }[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    let m = line.match(/^\[(x| |~|-)\]\s+(.*)$/);
    if (m) {
      const map: Record<string, string> = { x: "completed", " ": "pending", "~": "in_progress", "-": "cancelled" };
      items.push({ status: map[m[1]] || "pending", content: todoDescription(m[2]) || "Task description unavailable" });
      continue;
    }
    m = line.match(/^-\s*\[(\w+)\]\s+(.*)$/);
    if (m) {
      items.push({ status: ["pending", "in_progress", "completed", "cancelled"].includes(m[1]) ? m[1] : "pending", content: todoDescription(m[2]) || "Task description unavailable" });
    }
  }
  return items;
}
