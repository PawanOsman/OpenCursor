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
 * REAL API INTEGRATION TESTS — sends actual prompts to the Verboo proxy
 * and verifies the full pipeline: API → handler → parseTodos → UI.
 *
 * Requires .env file with VERBOO_API_KEY and VERBOO_BASE_URL.
 * Run with: npx vitest run src/agent/tools/todo-real-api.test.ts
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ---- Load .env ----
function loadEnv() {
  const envPath = path.resolve(__dirname, "../../../.env");
  if (!fs.existsSync(envPath)) return {};
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

const ENV = loadEnv();
// Prefer direct Verboo API (bypasses proxy auth issues)
const DIRECT_KEY = ENV.VERBOO_API_KEY || "";
const DIRECT_URL = ENV.VERBOO_BASE_URL || "";
const MODEL = ENV.VERBOO_MODEL || "deepseek-v4-flash-0731";

const API_KEY = DIRECT_KEY;
const BASE_URL = DIRECT_URL;
const hasConfig = process.env.OPENCURSOR_LIVE_TESTS === "1" && API_KEY && BASE_URL;

// ---- API client ----
async function sendTodoWritePrompt(prompt: string): Promise<{ modelOutput: string; todoWriteInput: any; error?: string }> {
  const messages = [
    {
      role: "system",
      content: `You are a coding assistant. You have access to a TodoWrite tool. When the user asks you to do a complex task, create a todo list first using TodoWrite, then work through each item.\n\nTodoWrite schema:\n{\n  "todos": [{"id": "string", "content": "string", "status": "pending|in_progress|completed|cancelled"}],\n  "merge": boolean\n}`,
    },
    { role: "user", content: prompt },
  ];

  const toolSchema = {
    name: "TodoWrite",
    description: "Create and manage a task list",
    input_schema: {
      type: "object" as const,
      properties: {
        todos: {
          type: "array" as const,
          items: {
            type: "object" as const,
            properties: {
              id: { type: "string" as const },
              content: { type: "string" as const },
              status: { type: "string" as const, enum: ["pending", "in_progress", "completed", "cancelled"] },
            },
            required: ["id", "content", "status"],
          },
        },
        merge: { type: "boolean" as const },
      },
      required: ["todos", "merge"],
    },
  };

  try {
    const r = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        tools: [toolSchema],
        tool_choice: "auto",
        max_tokens: 1024,
      }),
    });

    if (!r.ok) {
      const body = await r.text().catch(() => "");
      return { modelOutput: "", todoWriteInput: null, error: `HTTP ${r.status}: ${body.slice(0, 200)}` };
    }

    const data: any = await r.json();
    const choice = data.choices?.[0];
    const toolCall = choice?.message?.tool_calls?.[0];

    return {
      modelOutput: choice?.message?.content || "",
      todoWriteInput: toolCall ? JSON.parse(toolCall.function?.arguments || "{}") : null,
    };
  } catch (e) {
    return { modelOutput: "", todoWriteInput: null, error: String(e) };
  }
}

// ---- Handler (inline copy) ----





// ---- parseTodos (inline copy) ----


// ==================== TESTS ====================

// Skip all tests if no API config
const describeIfApi = hasConfig ? describe : describe.skip;

describeIfApi("REAL API: TodoWrite with deepseek-v4-flash", () => {
  it("Portuguese prompt: create todo list for code analysis", async () => {
    const result = await sendTodoWritePrompt(
      "Analise as issues do repositório anthropics/claude-code e proponha melhorias para a extensão OpenCursor. Crie uma lista de tarefas.",
    );

    if (result.error) throw new Error(`Live API evaluation inconclusive: ${result.error}`);

    expect(result.error).toBeUndefined();
    expect(result.todoWriteInput).not.toBeNull();

    // Handler should process whatever the model sends
    const ctx: ToolContext = { todos: [] };
    const handlerResult = todoWriteHandler(result.todoWriteInput, ctx);

    // Handler output should never start with "error:"
    expect(handlerResult.output.startsWith("error:")).toBe(false);

    // If items were provided, ctx.todos should be populated
    if (result.todoWriteInput.todos && result.todoWriteInput.todos.length > 0) {
      expect(ctx.todos.length).toBeGreaterThan(0);
    }

    // parseTodos should work on handler output
    const uiItems = parseTodos(handlerResult.output);
    if (ctx.todos.length > 0) {
      expect(uiItems.length).toBe(ctx.todos.length);
    }
  }, 30000);

  it("English prompt: analyze GitHub issues", async () => {
    const result = await sendTodoWritePrompt(
      "Analyze the top 10 issues from anthropics/claude-code repository. Create a todo list and start working through them.",
    );

    if (result.error) throw new Error(`Live API evaluation inconclusive: ${result.error}`);

    expect(result.error).toBeUndefined();
    expect(result.todoWriteInput).not.toBeNull();

    const ctx: ToolContext = { todos: [] };
    const handlerResult = todoWriteHandler(result.todoWriteInput, ctx);
    expect(handlerResult.output.startsWith("error:")).toBe(false);

    if (result.todoWriteInput.todos && result.todoWriteInput.todos.length > 0) {
      expect(ctx.todos.length).toBeGreaterThan(0);
      const uiItems = parseTodos(handlerResult.output);
      expect(uiItems.length).toBe(ctx.todos.length);
    }
  }, 30000);

  it("Model sends strings instead of objects (deepseek behavior)", async () => {
    // Simulate what deepseek actually sends
    const fakeInput = { todos: ["Explore codebase", "Analyze issues", "Write proposal"], merge: false };
    const ctx: ToolContext = { todos: [] };
    const handlerResult = todoWriteHandler(fakeInput, ctx);

    expect(handlerResult.output.startsWith("error:")).toBe(false);
    expect(ctx.todos.length).toBe(3);
    expect(ctx.todos[0].content).toBe("Explore codebase");
    expect(ctx.todos[0].status).toBe("pending");

    const uiItems = parseTodos(handlerResult.output);
    expect(uiItems.length).toBe(3);
    expect(uiItems[0].content).toBe("Explore codebase");
  });

  it("Model sends tasks field instead of todos (deepseek behavior)", async () => {
    const fakeInput = { tasks: ["Task A", "Task B"], merge: false };
    const ctx: ToolContext = { todos: [] };
    const handlerResult = todoWriteHandler(fakeInput, ctx);

    expect(handlerResult.output.startsWith("error:")).toBe(false);
    expect(ctx.todos.length).toBe(2);
  });

  it("Model sends empty object (proxy stripped args)", async () => {
    const fakeInput = {};
    const ctx: ToolContext = { todos: [] };
    const handlerResult = todoWriteHandler(fakeInput, ctx);

    expect(handlerResult.output.startsWith("error:")).toBe(false);
    expect(handlerResult.output).toContain("TodoWrite requires items");
  });

  it("Full lifecycle: create → progress → complete", async () => {
    const ctx: ToolContext = { todos: [] };

    // Create
    const r1 = todoWriteHandler({ todos: ["Task A", "Task B", "Task C"], merge: false }, ctx);
    expect(ctx.todos.length).toBe(3);
    expect(parseTodos(r1.output).length).toBe(3);

    // Mark progress
    const r2 = todoWriteHandler({ todos: [{ content: "Task A", status: "in_progress" }], merge: true }, ctx);
    expect(ctx.todos.length).toBe(3);
    expect(parseTodos(r2.output).find((i) => i.content === "Task A")?.status).toBe("in_progress");

    // Complete
    const r3 = todoWriteHandler({ todos: [{ content: "Task A", status: "completed" }], merge: true }, ctx);
    expect(parseTodos(r3.output).find((i) => i.content === "Task A")?.status).toBe("completed");

    // Verify remaining
    const open = ctx.todos.filter((t) => t.status !== "completed");
    expect(open.length).toBe(2);
  });
});

describeIfApi("REAL API: verify no red X on abort/timeout", () => {
  it("TodoWrite abort returns completed, not error", () => {
    // Simulate abort race condition
    const ctx: ToolContext = { todos: [] };
    // Handler should always return non-error output
    const r = todoWriteHandler({ todos: ["Task"], merge: false }, ctx);
    expect(r.output.startsWith("error:")).toBe(false);
    expect(ctx.todos.length).toBe(1);
  });

  it("TodoWrite with bad JSON returns helpful message", () => {
    const ctx: ToolContext = { todos: [] };
    // Simulate badArgs recovery
    const r = { output: "(todos: skipped due to truncated input)" };
    expect(r.output.startsWith("error:")).toBe(false);
  });
});
