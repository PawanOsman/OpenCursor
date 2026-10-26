/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it } from "vitest";
import { applyModelOutputEdit } from "./modelOutputEdit";
import { buildMessages } from "../../agent/messages";
import { restoreContext, saveContext, type ContextState } from "../../agent/contextState";
import type { Step } from "../../agent/types";
import type { Turn } from "../../shared/turns";

const reasoning = (id: string) => ({ model: "gpt", provider: "openai" as const, items: [{ type: "reasoning" as const, id, summary: [], encrypted_content: `enc-${id}` }] });
function fixture() {
  const steps: Step[] = [
    { kind: "user", text: "first" },
    { kind: "assistant", text: "Answer one", thinking: "plan one", calls: [{ id: "c1", name: "Read", arguments: "{}", thoughtSignature: "sig-1" }], responsesReasoning: reasoning("r1") },
    { kind: "tool-result", callId: "c1", name: "Read", output: "file", status: "completed" },
    { kind: "assistant", text: "Done one", calls: [], responsesReasoning: reasoning("r1b") },
    { kind: "user", text: "second" },
    { kind: "assistant", text: "Answer two", thinking: "plan two", calls: [{ id: "c2", name: "Read", arguments: "{}", thoughtSignature: "sig-2" }], responsesReasoning: reasoning("r2"),
      chatReasoning: { endpoint: "https://api.example.test", model: "m", content: "plan two" } },
    { kind: "tool-result", callId: "c2", name: "Read", output: "file", status: "completed" },
    { kind: "assistant", text: "Done two", calls: [{ id: "c3", name: "Read", arguments: "{}", thoughtSignature: "sig-3" }], responsesReasoning: reasoning("r3") },
    { kind: "tool-result", callId: "c3", name: "Read", output: "file", status: "completed" },
  ];
  const tool = (callId: string) => ({ kind: "tool" as const, callId, name: "Read", input: {}, status: "completed" as const, result: "file" });
  const turns: Turn[] = [
    { role: "user", text: "first" },
    { role: "assistant", blocks: [{ kind: "thinking", text: "plan one" }, { kind: "text", text: "Answer one" }, tool("c1"), { kind: "text", text: "Done one" }] },
    { role: "user", text: "second" },
    { role: "assistant", blocks: [{ kind: "thinking", text: "plan two" }, { kind: "text", text: "Answer two" }, tool("c2"), { kind: "text", text: "Done two" }, tool("c3")], finalText: "Done two" },
  ];
  return { steps, turns };
}
type AssistantStep = Extract<Step, { kind: "assistant" }>;
const at = (steps: Step[], index: number) => steps[index] as AssistantStep;

describe("editing model output", () => {
  it("edits the replayed text and strips signed state from the edited turn onward only", () => {
    const { steps, turns } = fixture();
    const result = applyModelOutputEdit(turns, steps, undefined, { turnIndex: 3, blockIndex: 1, kind: "text", previousText: "Answer two", text: "Edited two" });
    expect(result.historyUpdated).toBe(true);
    expect((result.turns[3] as any).blocks[1].text).toBe("Edited two");
    expect(at(result.steps, 5).text).toBe("Edited two");
    expect(at(result.steps, 5).responsesReasoning).toBeUndefined();
    expect(at(result.steps, 5).calls[0].thoughtSignature).toBeUndefined();
    expect(at(result.steps, 7).responsesReasoning).toBeUndefined();
    expect(at(result.steps, 7).calls[0].thoughtSignature).toBeUndefined();
    // Earlier turns keep their genuine provider state.
    expect(at(result.steps, 1).responsesReasoning).toEqual(reasoning("r1"));
    expect(at(result.steps, 1).calls[0].thoughtSignature).toBe("sig-1");
    expect(at(result.steps, 3).responsesReasoning).toEqual(reasoning("r1b"));
    // The next model request uses the edited text.
    const wire = buildMessages("system", result.steps);
    expect(wire.some((message) => message.role === "assistant" && message.content === "Edited two")).toBe(true);
    expect(wire.some((message) => message.role === "assistant" && message.content === "Answer two")).toBe(false);
    expect(wire.filter((message) => message.role === "assistant" && message.responsesReasoning)).toHaveLength(2);
    expect(steps[5]).toMatchObject({ text: "Answer two", responsesReasoning: reasoning("r2") }); // input untouched
  });

  it("edits reasoning, drops encrypted/signed state and rewrites unsigned reasoning_content", () => {
    const { steps, turns } = fixture();
    const result = applyModelOutputEdit(turns, steps, undefined, { turnIndex: 3, blockIndex: 0, kind: "thinking", previousText: "plan two", text: "better plan" });
    const edited = at(result.steps, 5);
    expect(edited.thinking).toBe("better plan");
    expect(edited.responsesReasoning).toBeUndefined();
    expect(edited.chatReasoning?.content).toBe("better plan");
    expect(edited.calls.every((call) => !call.thoughtSignature)).toBe(true);
    expect(at(result.steps, 1).calls[0].thoughtSignature).toBe("sig-1");
    expect(buildMessages("system", result.steps).find((message) => message.role === "assistant" && message.content === "Answer two")).toMatchObject({ chatReasoning: { content: "better plan" } });
  });

  it("an edit in an earlier turn invalidates signatures in all later turns", () => {
    const { steps, turns } = fixture();
    const result = applyModelOutputEdit(turns, steps, undefined, { turnIndex: 1, blockIndex: 3, kind: "text", previousText: "Done one", text: "Edited" });
    expect(at(result.steps, 1).responsesReasoning).toEqual(reasoning("r1"));
    expect(at(result.steps, 1).calls[0].thoughtSignature).toBe("sig-1");
    for (const index of [3, 5, 7]) expect(at(result.steps, index).responsesReasoning).toBeUndefined();
    expect(at(result.steps, 5).calls[0].thoughtSignature).toBeUndefined();
  });

  it("keeps a compaction checkpoint consistent with the edited history", () => {
    const { steps, turns } = fixture();
    const state: ContextState = { todos: [{ id: "t", content: "keep", status: "pending" } as any] };
    saveContext(steps.slice(0, 6), steps.slice(0, 6), state);
    const result = applyModelOutputEdit(turns, steps, state, { turnIndex: 3, blockIndex: 1, kind: "text", previousText: "Answer two", text: "Edited two" });
    const restored = restoreContext(result.steps, structuredClone(result.contextState));
    expect(at(restored, 5).text).toBe("Edited two");
    expect(result.contextState?.checkpoint).toBeDefined();
    expect(result.contextState?.todos).toHaveLength(1);
  });

  it("rejects stale edits and non-output blocks", () => {
    const { steps, turns } = fixture();
    expect(() => applyModelOutputEdit(turns, steps, undefined, { turnIndex: 3, blockIndex: 1, kind: "text", previousText: "old", text: "x" })).toThrow("changed");
    expect(() => applyModelOutputEdit(turns, steps, undefined, { turnIndex: 3, blockIndex: 2, kind: "text", previousText: "", text: "x" })).toThrow();
    expect(() => applyModelOutputEdit(turns, steps, undefined, { turnIndex: 2, blockIndex: 0, kind: "text", previousText: "", text: "x" })).toThrow();
  });
});
