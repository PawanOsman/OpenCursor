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
 * REAL API PIPELINE TESTS — calls the actual Verboo API, parses the real
 * model response, feeds through handler, verifies UI render.
 *
 * Tests with 50+ tasks to prove the system handles large todolists.
 *
 * Requires: .env with VERBOO_API_KEY and VERBOO_BASE_URL
 * Run: npx vitest run src/agent/tools/real-api-pipeline.test.ts
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ---- Load .env ----
function loadEnv() {
  const envPath = path.resolve(__dirname, "../../../.env");
  if (!fs.existsSync(envPath)) return {};
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) env[t.slice(0, i)] = t.slice(i + 1);
  }
  return env;
}

const ENV = loadEnv();
const API_KEY = ENV.VERBOO_API_KEY || "";
const BASE_URL = ENV.VERBOO_BASE_URL || "";
const hasAPI = process.env.OPENCURSOR_LIVE_TESTS === "1" && API_KEY && BASE_URL && API_KEY.startsWith("vbk_");

// ---- Real API call ----
async function callRealAPI(prompt: string, model = "glm-4.7-flash"): Promise<{
  toolCalls: Array<{ name: string; arguments: any }>;
  content: string;
  error?: string;
}> {
  const toolSchema = {
    type: "function" as const,
    function: {
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
    },
  };

  try {
    const endpoint = BASE_URL.endsWith("/v1") ? `${BASE_URL}/chat/completions` : `${BASE_URL}/v1/chat/completions`;
    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "You are a coding assistant. Use TodoWrite tool to create task lists for complex tasks. Create detailed, specific tasks.",
          },
          { role: "user", content: prompt },
        ],
        tools: [toolSchema],
        tool_choice: "auto",
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!r.ok) {
      const body = await r.text().catch(() => "");
      return { toolCalls: [], content: "", error: `HTTP ${r.status}: ${body.slice(0, 200)}` };
    }

    const data: any = await r.json();
    const choice = data.choices?.[0];
    const msg = choice?.message;

    return {
      toolCalls: (msg?.tool_calls || []).map((tc: any) => ({
        name: tc.function?.name || "",
        arguments: JSON.parse(tc.function?.arguments || "{}"),
      })),
      content: msg?.content || "",
    };
  } catch (e: any) {
    return { toolCalls: [], content: "", error: String(e?.message || e) };
  }
}

// State changes run through the production todo implementation.





// State changes run through the production todo implementation.


// ==================== TESTS ====================

const describeIfApi = hasAPI ? describe : describe.skip;

describeIfApi("REAL API PIPELINE: model → handler → UI", () => {
  it("Portuguese prompt: create 5+ todos for code analysis", async () => {
    const result = await callRealAPI(
      "Crie uma lista de tarefas detalhada com pelo menos 5 itens para analisar as issues do repositório anthropics/claude-code e propor melhorias para a extensão OpenCursor. Cada tarefa deve ser específica e acionável.",
    );

    if (result.error) throw new Error(`Live API evaluation inconclusive: ${result.error}`);

    // Verify model called TodoWrite (or responded with text — model behavior varies)
    if (result.toolCalls.length === 0) {
      throw new Error("Model responded with text instead of TodoWrite — skipping handler test".replace(/skipping.*$/, "required model behavior was missing"));
    }
    const todoCall = result.toolCalls.find((tc) => tc.name === "TodoWrite");
    if (!todoCall) {
      throw new Error("Model called other tools but not TodoWrite — skipping".replace(/skipping.*$/, "required model behavior was missing"));
    }

    // Feed through handler
    const ctx: ToolContext = { todos: [] };
    console.log("  TodoWrite arguments:", JSON.stringify(todoCall!.arguments).slice(0, 500));
    const handlerResult = todoWriteHandler(todoCall!.arguments, ctx);
    console.log("  Handler output:", handlerResult.output.slice(0, 200));
    console.log("  ctx.todos:", ctx.todos.length, "items");

    // Handler output must NOT start with "error:"
    expect(handlerResult.output.startsWith("error:")).toBe(false);

    // Model should have created at least 1 todo (placeholder if args empty)
    expect(ctx.todos.length).toBeGreaterThanOrEqual(1);

    // UI parseTodos must recover all items
    const uiItems = parseTodos(handlerResult.output);
    expect(uiItems.length).toBe(ctx.todos.length);

    console.log(`✓ Model created ${ctx.todos.length} todos via real API`);
  }, 90000);

  it("English prompt: create 10+ todos for feature implementation", async () => {
    const result = await callRealAPI(
      "I need to implement a form rendering system in a VS Code extension. Create a detailed todo list with at least 10 specific tasks covering: schema design, component implementation, input validation, error handling, testing, documentation, deployment, and monitoring. Each task should be specific and actionable.",
    );

    if (result.error) throw new Error(`Live API evaluation inconclusive: ${result.error}`);

    if (result.toolCalls.length === 0) {
      throw new Error("Model responded with text — skipping".replace(/skipping.*$/, "required model behavior was missing"));
    }
    const todoCall = result.toolCalls.find((tc) => tc.name === "TodoWrite");
    if (!todoCall) {
      throw new Error("Model called other tools but not TodoWrite — skipping".replace(/skipping.*$/, "required model behavior was missing"));
    }

    const ctx: ToolContext = { todos: [] };
    const handlerResult = todoWriteHandler(todoCall.arguments, ctx);

    expect(handlerResult.output.startsWith("error:")).toBe(false);
    expect(ctx.todos.length).toBeGreaterThanOrEqual(1);

    const uiItems = parseTodos(handlerResult.output);
    expect(uiItems.length).toBe(ctx.todos.length);

    console.log(`✓ Model created ${ctx.todos.length} todos via real API`);
  }, 90000);

  it("model creates todos with merge=true to update progress", async () => {
    const result = await callRealAPI(
      "Create a todo list with 3 tasks. Then mark the first task as in_progress using merge=true.",
    );

    if (result.error) throw new Error(`Live API evaluation inconclusive: ${result.error}`);

    if (result.toolCalls.length === 0) {
      throw new Error("Model responded with text — skipping".replace(/skipping.*$/, "required model behavior was missing"));
    }

    // Process all tool calls in sequence
    const ctx: ToolContext = { todos: [] };
    for (const tc of result.toolCalls) {
      if (tc.name === "TodoWrite") {
        const r = todoWriteHandler(tc.arguments, ctx);
        expect(r.output.startsWith("error:")).toBe(false);
      }
    }

    // Should have at least 1 todo
    if (ctx.todos.length === 0) {
      throw new Error("Model didn't create todos — skipping assertions".replace(/skipping.*$/, "required model behavior was missing"));
    }
    // At least one should be in_progress or completed
    const progressItems = ctx.todos.filter((t) => t.status !== "pending");
    expect(progressItems.length).toBeGreaterThanOrEqual(1);

    const uiItems = parseTodos(todoWriteHandler({ todos: ctx.todos, merge: true }, ctx).output);
    expect(uiItems.length).toBe(ctx.todos.length);

    console.log(`✓ Model created ${ctx.todos.length} todos with progress updates`);
  }, 90000);

  it("handler NEVER returns error: prefix for valid model input", async () => {
    const result = await callRealAPI(
      "Create a simple todo list with 2 tasks.",
    );

    if (result.error) throw new Error(`Live API evaluation inconclusive: ${result.error}`);

    const ctx: ToolContext = { todos: [] };
    for (const tc of result.toolCalls) {
      if (tc.name === "TodoWrite") {
        const r = todoWriteHandler(tc.arguments, ctx);
        // CRITICAL: must never start with "error:" — causes red X in UI
        expect(r.output.startsWith("error:")).toBe(false);
        // CRITICAL: must not be "(no todos)" when items were provided
        if (tc.arguments.todos && tc.arguments.todos.length > 0) {
          expect(r.output).not.toBe("(no todos)");
        }
      }
    }

    console.log(`✓ Handler processed ${result.toolCalls.length} tool calls without errors`);
  }, 90000);
});

describeIfApi("REAL API PIPELINE: 50+ task stress test", () => {
  it("model creates 50+ todos — handler processes all", async () => {
    // Use a prompt that specifically asks for many tasks
    const result = await callRealAPI(
      "Create an extremely detailed todo list with AT LEAST 50 specific tasks for analyzing the anthropics/claude-code repository. Break down each major area (architecture, tools, testing, deployment, security, performance, UX, documentation, CI/CD, monitoring) into at least 5 subtasks each. Be very specific.",
    );

    if (result.error) throw new Error(`Live API evaluation inconclusive: ${result.error}`);

    if (result.toolCalls.length === 0) {
      throw new Error("Model responded with text — skipping (50+ task test needs TodoWrite)".replace(/skipping.*$/, "required model behavior was missing"));
    }
    const todoCall = result.toolCalls.find((tc) => tc.name === "TodoWrite");
    if (!todoCall) {
      throw new Error("Model didn't call TodoWrite for 50+ tasks — skipping".replace(/skipping.*$/, "required model behavior was missing"));
    }

    const ctx: ToolContext = { todos: [] };
    const handlerResult = todoWriteHandler(todoCall!.arguments, ctx);

    expect(handlerResult.output.startsWith("error:")).toBe(false);
    console.log(`✓ Model created ${ctx.todos.length} todos (target: 50+)`);

    // Verify ALL items are valid
    for (let i = 0; i < ctx.todos.length; i++) {
      const item = ctx.todos[i];
      expect(item.content.length).toBeGreaterThan(0);
      expect(["pending", "in_progress", "completed", "cancelled"]).toContain(item.status);
    }

    // UI parseTodos must recover ALL items
    const uiItems = parseTodos(handlerResult.output);
    expect(uiItems.length).toBe(ctx.todos.length);

    // Verify render output has correct format
    for (const item of ctx.todos) {
      expect(handlerResult.output).toContain(`[ ] ${item.content}`);
    }

    // Mark half as completed — verify merge works
    const half = Math.floor(ctx.todos.length / 2);
    for (let i = 0; i < half; i++) {
      todoWriteHandler({ todos: [{ id: ctx.todos[i].id, status: "completed" }], merge: true }, ctx);
    }

    const completedCount = ctx.todos.filter((t) => t.status === "completed").length;
    expect(completedCount).toBe(half);

    // Verify UI still shows all items
    const finalUi = parseTodos(todoWriteHandler({ todos: ctx.todos, merge: true }, ctx).output);
    expect(finalUi.length).toBe(ctx.todos.length);

    console.log(`✓ Handler processed ${ctx.todos.length} todos, marked ${half} as completed`);
  }, 120000);
});

describe("PIPELINE: simulate full model response with 50 tasks", () => {
  it("simulate deepseek sending 50-item todo list — full pipeline", () => {
    // Simulate what deepseek-v4-flash ACTUALLY sends
    const modelResponse = {
      todos: Array.from({ length: 50 }, (_, i) => ({
        id: `task_${i + 1}`,
        content: `Task ${i + 1}: ${[
          "Clone and explore repository structure",
          "Read README and documentation",
          "Identify core architecture patterns",
          "Map tool dependencies",
          "Analyze streaming implementation",
          "Review error handling",
          "Check test coverage",
          "Review security practices",
          "Analyze performance bottlenecks",
          "Review UI components",
        ][i % 10]} ${Math.floor(i / 10) + 1}`,
        status: "pending" as const,
      })),
      merge: false,
    };

    // Feed through handler
    const ctx: ToolContext = { todos: [] };
    const handlerResult = todoWriteHandler(modelResponse, ctx);

    // Verify
    expect(handlerResult.output.startsWith("error:")).toBe(false);
    expect(ctx.todos.length).toBe(50);

    // UI parseTodos must recover all 50 items
    const uiItems = parseTodos(handlerResult.output);
    expect(uiItems.length).toBe(50);

    // Mark 25 as completed
    for (let i = 0; i < 25; i++) {
      todoWriteHandler({ todos: [{ id: `task_${i + 1}`, status: "completed" }], merge: true }, ctx);
    }
    expect(ctx.todos.filter((t) => t.status === "completed").length).toBe(25);

    // Mark 10 as in_progress
    for (let i = 25; i < 35; i++) {
      todoWriteHandler({ todos: [{ id: `task_${i + 1}`, status: "in_progress" }], merge: true }, ctx);
    }
    expect(ctx.todos.filter((t) => t.status === "in_progress").length).toBe(10);

    // Final UI state
    const finalUi = parseTodos(todoWriteHandler({ todos: ctx.todos, merge: true }, ctx).output);
    expect(finalUi.length).toBe(50);
    expect(finalUi.filter((i) => i.status === "completed").length).toBe(25);
    expect(finalUi.filter((i) => i.status === "in_progress").length).toBe(10);
    expect(finalUi.filter((i) => i.status === "pending").length).toBe(15);

    console.log(`✓ Full pipeline: 50 todos created, 25 completed, 10 in_progress, 15 pending`);
  });

  it("simulate deepseek sending strings (malformed) — handler recovers", () => {
    const modelResponse = {
      todos: Array.from({ length: 50 }, (_, i) => `Task ${i + 1}`),
      merge: false,
    };

    const ctx: ToolContext = { todos: [] };
    const handlerResult = todoWriteHandler(modelResponse, ctx);

    expect(handlerResult.output.startsWith("error:")).toBe(false);
    expect(ctx.todos.length).toBe(50);

    // Each string should be converted to a TodoItem
    for (const item of ctx.todos) {
      expect(item.content.startsWith("Task ")).toBe(true);
      expect(item.status).toBe("pending");
    }
  });

  it("simulate deepseek sending wrong field name — handler recovers", () => {
    const modelResponse = {
      tasks: Array.from({ length: 50 }, (_, i) => ({ content: `Task ${i + 1}`, status: "pending" })),
      merge: false,
    };

    const ctx: ToolContext = { todos: [] };
    const handlerResult = todoWriteHandler(modelResponse, ctx);

    expect(handlerResult.output.startsWith("error:")).toBe(false);
    expect(ctx.todos.length).toBe(50);
  });

  it("simulate proxy stripping args — handler does not invent tasks", () => {
    const modelResponse = {}; // Empty object (proxy stripped args)

    const ctx: ToolContext = { todos: [] };
    const handlerResult = todoWriteHandler(modelResponse, ctx);

    expect(handlerResult.output.startsWith("error:")).toBe(false);
    // Missing provider arguments cannot create work that was never requested.
    expect(ctx.todos.length).toBe(0);
    expect(handlerResult.output).toBe("(no todos)");
  });
});
