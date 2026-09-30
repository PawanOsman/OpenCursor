/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it } from "vitest";
import { currentRequestText, lastRealUserIndex, stepsTokens } from "./contextEconomy";
import { buildMessages, fitStepsToBudget, splitForCompaction } from "./messages";
import type { Step } from "./types";

function exchange(id: string, output: string, name = "Read", args = '{"path":"src/app.ts"}'): Step[] {
  return [
    { kind: "assistant", text: "", calls: [{ id, name, arguments: args }] },
    { kind: "tool-result", callId: id, name, output, status: "completed" },
  ];
}

function expectCompleteExchanges(steps: Step[]): void {
  let outstanding = new Set<string>();
  for (const message of buildMessages("system", steps)) {
    if (message.role === "tool") {
      expect(outstanding.has(message.tool_call_id)).toBe(true);
      outstanding.delete(message.tool_call_id);
    } else {
      expect(outstanding.size).toBe(0);
      if (message.role === "assistant") outstanding = new Set(message.tool_calls?.map((call) => call.id));
    }
  }
  expect(outstanding.size).toBe(0);
}

describe("context budget fitting", () => {
  it("counts preserved Chat reasoning once and keeps it intact when removing display thinking", () => {
    const base: Step = { kind: "assistant", text: "Answer", calls: [] };
    const content = "Exact provider reasoning ".repeat(100);
    const steps: Step[] = [{ kind: "user", text: "Inspect the project" }, { ...base, thinking: content,
      chatReasoning: { endpoint: "https://api.deepseek.com/v1", model: "deepseek-flash", content } }];
    expect(stepsTokens([steps[1]]) - stepsTokens([base])).toBe(content.length / 4);
    const original = structuredClone(steps);
    const fitted = fitStepsToBudget(steps, 0, 10000);
    expect(fitted[1]).toMatchObject({ chatReasoning: { content } });
    expect(fitted[1]).not.toHaveProperty("thinking", content);
    expect(steps).toEqual(original);
    expect(buildMessages("System", fitted)[2]).toMatchObject({ chatReasoning: { content } });
  });

  it("drops signatures when emergency fitting rewrites historical call arguments", () => {
    const steps: Step[] = [{ kind: "user", text: "Read the file" },
      { kind: "assistant", text: "", calls: [{ id: "signed-call", name: "Read", arguments: JSON.stringify({ path: "x".repeat(8000) }), thoughtSignature: "original-signature" }] },
      { kind: "tool-result", callId: "signed-call", name: "Read", output: "contents", status: "completed" }];
    const original = structuredClone(steps);
    const fitted = fitStepsToBudget(steps, 0, 400);
    const assistant = fitted.find((step) => step.kind === "assistant");
    expect(assistant?.kind).toBe("assistant");
    if (assistant?.kind === "assistant") {
      expect(assistant.calls[0].arguments).toContain("_context_omitted");
      expect(assistant.calls[0].thoughtSignature).toBeUndefined();
    }
    expect(steps).toEqual(original);
  });

  it("returns no steps when request overhead exhausts the budget", () => {
    const steps: Step[] = [{ kind: "user", text: "Fix the failure" }];
    expect(fitStepsToBudget(steps, 100, 100)).toEqual([]);
    expect(fitStepsToBudget(steps, 200, 100)).toEqual([]);
  });

  it("preserves all content that fits and strips thinking only on a copy", () => {
    const steps: Step[] = [
      { kind: "user", text: "Fix the failure" },
      { kind: "assistant", text: "Let me inspect it.", thinking: "private reasoning", calls: [] },
      ...exchange("read", "full file content"),
    ];
    const original = structuredClone(steps);
    const fitted = fitStepsToBudget(steps, 80, 1000);
    expect(steps).toEqual(original);
    expect(fitted).toHaveLength(steps.length);
    expect(fitted[1]).not.toHaveProperty("thinking", "private reasoning");
    expect(fitted.at(-1)).toEqual(steps.at(-1));
    expectCompleteExchanges(fitted);
  });

  it("keeps recent observations ahead of older edit payloads and assistant prose", () => {
    const recent = exchange("recent", "The new check failed at src/app.ts:5. " + "details ".repeat(40));
    const steps: Step[] = [
      { kind: "user", text: "Fix this project" },
      ...exchange("old-write", "Wrote the file", "Write", JSON.stringify({ contents: "old payload ".repeat(160) })),
      { kind: "assistant", text: "old conclusions ".repeat(50), calls: [] },
      ...recent,
    ];
    const budget = stepsTokens([steps[0], ...recent]) + 10;
    const fitted = fitStepsToBudget(steps, 0, budget);
    expect(fitted).toEqual([steps[0], ...recent]);
    expect(stepsTokens(fitted)).toBeLessThanOrEqual(budget);
  });

  it("shortens an oversized latest parallel exchange without losing any result or corrupting JSON", () => {
    const steps: Step[] = [
      { kind: "user", text: "Inspect both files" },
      {
        kind: "assistant", text: "Inspecting", calls: [
          { id: "first", name: "Read", arguments: JSON.stringify({ path: "a".repeat(7000) }) },
          { id: "second", name: "Read", arguments: '{"path":"second.ts"}' },
        ],
      },
      { kind: "tool-result", callId: "first", name: "Read", output: "A".repeat(20_000), status: "completed" },
      { kind: "tool-result", callId: "second", name: "Read", output: "B".repeat(20_000), status: "completed" },
    ];
    const original = structuredClone(steps);
    const fitted = fitStepsToBudget(steps, 75, 400);
    expect(stepsTokens(fitted) + 75).toBeLessThanOrEqual(400);
    expect(fitted.filter((s) => s.kind === "tool-result").map((s) => s.callId)).toEqual(["first", "second"]);
    for (const s of fitted) {
      if (s.kind === "assistant") for (const call of s.calls) expect(() => JSON.parse(call.arguments)).not.toThrow();
      if (s.kind === "tool-result") expect(s.output).toContain("[omitted]");
    }
    expect(steps).toEqual(original);
    expectCompleteExchanges(fitted);
  });

  it("shares a small window between oversized original/current requests and the latest result", () => {
    const steps: Step[] = [
      { kind: "user", text: "Original request: " + "context ".repeat(3000) + " preserve original constraint" },
      { kind: "assistant", text: "Previous answer", calls: [] },
      { kind: "user", text: "Current request: " + "details ".repeat(3000) + " preserve current constraint" },
      ...exchange("last", "Observation: " + "output ".repeat(3000)),
    ];
    const original = structuredClone(steps);
    const fitted = fitStepsToBudget(steps, 100, 700);
    expect(stepsTokens(fitted) + 100).toBeLessThanOrEqual(700);
    const users = fitted.filter((s) => s.kind === "user");
    expect(users).toHaveLength(2);
    expect(users[0].text).toContain("Original request:");
    expect(users[0].text).toContain("preserve original constraint");
    expect(users[1].text).toContain("Current request:");
    expect(users[1].text).toContain("preserve current constraint");
    expect(users.every((s) => s.text.includes("[omitted]"))).toBe(true);
    expect(fitted.at(-1)?.kind).toBe("tool-result");
    expect(steps).toEqual(original);
    expectCompleteExchanges(fitted);
  });

  it("counts and shortens attached text without mutating the attachment", () => {
    const steps: Step[] = [{
      kind: "user", text: "Review this attachment", attachments: [{
        id: "attached", name: "app.ts", mime: "text/plain", kind: "text", data: "line\n".repeat(6000),
      }],
    }, ...exchange("last", "The attachment contains a failure")];
    const original = structuredClone(steps);
    const fitted = fitStepsToBudget(steps, 50, 300);
    expect(stepsTokens(fitted) + 50).toBeLessThanOrEqual(300);
    expect(fitted[0].kind === "user" && fitted[0].attachments?.[0].data).toContain("[omitted]");
    expect(steps).toEqual(original);
    expectCompleteExchanges(fitted);
  });

  it("preserves images when text can be shortened enough, and marks their omission otherwise", () => {
    const steps: Step[] = [{
      kind: "user", text: "Inspect this image " + "extra context ".repeat(2000), attachments: [{
        id: "image", name: "error.png", mime: "image/png", kind: "image", data: "data:image/png;base64,abc",
      }],
    }];
    const withImage = fitStepsToBudget(steps, 0, 1600);
    expect(stepsTokens(withImage)).toBeLessThanOrEqual(1600);
    expect(withImage[0].kind === "user" && withImage[0].attachments).toHaveLength(1);
    const withoutImage = fitStepsToBudget(steps, 0, 300);
    expect(stepsTokens(withoutImage)).toBeLessThanOrEqual(300);
    expect(withoutImage[0].kind === "user" && withoutImage[0].attachments).toHaveLength(0);
    expect(withoutImage[0].kind === "user" && withoutImage[0].text).toContain("Image attachment error.png omitted");
  });

  it("repairs an interleaved system note while retaining a complete tool exchange", () => {
    const [call, result] = exchange("todo", "No todos exist", "TodoRead", "{}");
    const note: Step = { kind: "user", synthetic: true, text: "Create tasks if useful" };
    const fitted = fitStepsToBudget([{ kind: "user", text: "Fix it" }, call, note, result], 0, 1000);
    expect(fitted).toEqual([{ kind: "user", text: "Fix it" }, call, result, note]);
    expectCompleteExchanges(fitted);
  });

  it("never forwards orphan results or unanswered historical calls", () => {
    const steps: Step[] = [
      { kind: "user", text: "Continue after the interruption" },
      { kind: "tool-result", callId: "missing", name: "Read", output: "orphan", status: "completed" },
      { kind: "assistant", text: "An interrupted request", calls: [{ id: "pending", name: "Read", arguments: "{}" }] },
    ];
    const fitted = fitStepsToBudget(steps, 0, 1000);
    expect(fitted).toEqual([steps[0], { kind: "assistant", text: "An interrupted request", calls: [] }]);
    expectCompleteExchanges(fitted);
  });

  it("stays within every tested budget without partial call groups", () => {
    const steps: Step[] = [
      { kind: "user", text: "Original request" },
      ...exchange("first", "older content ".repeat(500)),
      { kind: "user", text: "Current request" },
      ...exchange("last", "recent content ".repeat(500)),
    ];
    for (const budget of [1, 7, 20, 50, 100, 200, 500, 1000, 2000]) {
      const fitted = fitStepsToBudget(steps, 0, budget);
      expect(stepsTokens(fitted)).toBeLessThanOrEqual(budget);
      expectCompleteExchanges(fitted);
    }
  });
});

describe("compaction boundaries", () => {
  it("compacts a long single-turn run and keeps the real request plus recent complete observations", () => {
    const request: Step = { kind: "user", text: "Fix the failing build and run its tests" };
    const steps = [request, ...Array.from({ length: 12 }, (_, i) => exchange(`read-${i}`, `file-${i} ` + "code ".repeat(100))).flat()];
    const original = structuredClone(steps);
    const { prefix, tail } = splitForCompaction(steps, 400);
    expect(prefix.length).toBeGreaterThan(10);
    expect(tail[0]).toEqual(request);
    expect(currentRequestText(tail)).toBe(request.text);
    expect(tail.at(-1)).toEqual(steps.at(-1));
    expect(stepsTokens(tail)).toBeLessThanOrEqual(400);
    expectCompleteExchanges(prefix);
    expectCompleteExchanges(tail);
    expect(steps).toEqual(original);
  });

  it("pins both the original and current requests when the recent window crosses them", () => {
    const original: Step = { kind: "user", text: "Fix the project" };
    const current: Step = { kind: "user", text: "Keep the public API unchanged" };
    const steps: Step[] = [
      original, ...exchange("old", "old context ".repeat(200)), current,
      ...Array.from({ length: 8 }, (_, i) => exchange(`read-${i}`, "contents ".repeat(100))).flat(),
      { kind: "user", synthetic: true, text: "Background tests completed" },
    ];
    const { prefix, tail } = splitForCompaction(steps, 300);
    expect(prefix).toContain(original);
    expect(prefix).toContain(current);
    expect(tail.slice(0, 2)).toEqual([original, current]);
    expect(currentRequestText(tail)).toBe(current.text);
    expect(tail.some((s) => s.kind === "tool-result" && s.callId === "read-7")).toBe(true);
    expectCompleteExchanges(prefix);
    expectCompleteExchanges(tail);
  });

  it("retains an indivisible latest exchange even when it exceeds the tail target", () => {
    const steps: Step[] = [
      { kind: "user", text: "Fix this failure" },
      ...exchange("old", "old content ".repeat(1000)),
      ...exchange("latest", "latest content ".repeat(1000)),
    ];
    const { prefix, tail } = splitForCompaction(steps, 100);
    expect(prefix.some((s) => s.kind === "tool-result" && s.callId === "old")).toBe(true);
    expect(tail.some((s) => s.kind === "tool-result" && s.callId === "latest")).toBe(true);
    expectCompleteExchanges(prefix);
    expectCompleteExchanges(tail);
    const fitted = fitStepsToBudget(tail, 0, 200);
    expect(stepsTokens(fitted)).toBeLessThanOrEqual(200);
    expectCompleteExchanges(fitted);
  });

  it("does not treat assistant-only history as the live user request", () => {
    const steps: Step[] = [{ kind: "assistant", text: "previous output", calls: [] }];
    expect(lastRealUserIndex(steps)).toBe(-1);
    expect(currentRequestText(steps)).toBe("");
  });
});
