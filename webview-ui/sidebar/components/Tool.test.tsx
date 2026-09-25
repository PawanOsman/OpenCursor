/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolCard, TaskActivityContext } from "./Tool";
import { vscode } from "../../shared/vscode";
import type { ToolBlock } from "../types";

vi.mock("../../shared/vscode", () => ({ vscode: { postMessage: vi.fn() } }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Restored tool display", () => {
  it("distinguishes task states and does not mark an unfinished list as complete", () => {
    act(() => root.render(<ToolCard block={{ kind: "tool", name: "TodoWrite", callId: "todos", status: "completed", input: {}, result: "[ ] Pending task\n[~] Active task\n[x] Finished task\n[-] Cancelled task" }} />));
    expect([...container.querySelectorAll(".todo-mark")].map(mark => mark.getAttribute("aria-label"))).toEqual(["Pending", "Started, unfinished", "Completed", "Cancelled"]);
    expect(container.querySelector(".todo-count")?.textContent).toBe("1/4 completed");
    expect(container.querySelector(".todo-header .ok-icon")).toBeNull();
    expect(container.querySelector(".todo-item.pending svg")?.getAttribute("fill")).toBe("none");
  });

  it("keeps existing task rows when another task is inserted or their status changes", () => {
    const block: ToolBlock = { kind: "tool", name: "TodoWrite", callId: "todos", status: "completed", input: {}, result: "[ ] Inspect routing" };
    act(() => root.render(<ToolCard block={block} />));
    const row = container.querySelector(".todo-item");
    act(() => root.render(<ToolCard block={{ ...block, result: "[ ] Another task\n[x] Inspect routing" }} />));
    expect(container.querySelector(".todo-item.completed")).toBe(row);
  });

  it("switches unfinished task presentation when the run stops and resumes", () => {
    const block: ToolBlock = { kind: "tool", name: "TodoWrite", callId: "todos", status: "completed", input: {}, result: "[~] Inspect routing" };
    const render = (running: boolean) => act(() => root.render(<TaskActivityContext.Provider value={running}><ToolCard block={block} /></TaskActivityContext.Provider>));
    render(true);
    const row = container.querySelector(".todo-item");
    expect(container.querySelector(".todo-mark")?.getAttribute("aria-label")).toBe("In progress");
    render(false);
    expect(container.querySelector(".todo-item.unfinished")).toBe(row);
    expect(container.querySelector(".todo-mark")?.getAttribute("aria-label")).toBe("Started, unfinished");
    render(true);
    expect(container.querySelector(".todo-item")).toBe(row);
    expect(container.querySelector(".todo-item.unfinished")).toBeNull();
    expect(block.result).toBe("[~] Inspect routing");
  });

  it("gives older nameless task records an honest missing-description label", () => {
    act(() => root.render(<ToolCard block={{ kind: "tool", name: "TodoRead", callId: "todos", status: "completed", input: {}, result: "- [completed] unnamed" }} />));
    expect(container.querySelector(".todo-text")?.textContent).toBe("Task description unavailable");
  });

  it.each([undefined, null, 42, {}, "", "   "])("keeps a tool with invalid name %j visible", (name) => {
    const block = { kind: "tool", name, callId: "restored-tool", status: "completed", result: "Saved output" } as unknown as ToolBlock;
    act(() => root.render(<ToolCard block={block} />));
    const header = container.querySelector<HTMLElement>(".tool-card-header")!;
    expect(header.getAttribute("aria-label")).toBe("Tool");
    expect(container.querySelector(".label")?.textContent).toBe("Tool");
    act(() => header.click());
    expect(container.querySelector(".tool-result")?.textContent).toBe("Saved output");
  });

  it("keeps incomplete nested tool records from breaking a restored subagent", () => {
    const child = { kind: "tool", callId: "restored-child", status: "completed" } as ToolBlock;
    act(() => root.render(<ToolCard block={{ kind: "tool", name: "Task", callId: "restored-agent", status: "running", input: {}, subBlocks: [child] }} />));
    expect(container.querySelector(".step-label")?.textContent).toBe("Tool");
  });

  it("preserves valid MCP tool labels", () => {
    act(() => root.render(<ToolCard block={{ kind: "tool", name: "mcp__workspace__search_files", callId: "mcp-1", status: "completed", input: {} }} />));
    expect(container.querySelector(".label")?.textContent).toBe("workspace · search files");
    expect(container.querySelector(".badge")?.textContent).toBe("workspace");
  });
});

describe("Tool keyboard interaction", () => {
  it.each(["Enter", " "])("opens the exact read range with %s", (key) => {
    act(() => root.render(<ToolCard block={{ kind: "tool", name: "Read", callId: "read-1", status: "completed", input: { path: "src/main.ts" }, startLine: 7, endLine: 20 }} />));
    const row = container.querySelector<HTMLElement>(".read-line")!;
    act(() => row.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
    expect(vscode.postMessage).toHaveBeenCalledOnce();
    expect(vscode.postMessage).toHaveBeenCalledWith({ type: "openFile", path: "src/main.ts", startLine: 7, endLine: 20 });
  });

  it("does not activate a read row when its stop control receives a key", () => {
    act(() => root.render(<ToolCard block={{ kind: "tool", name: "Read", callId: "read-1", status: "running", input: { path: "src/main.ts" } }} />));
    const stop = container.querySelector<HTMLButtonElement>(".spinner-stop")!;
    act(() => stop.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(vscode.postMessage).not.toHaveBeenCalled();
    act(() => stop.click());
    expect(vscode.postMessage).toHaveBeenCalledOnce();
    expect(vscode.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "openFile" }));
  });

  it("opens a completed subagent with the keyboard", () => {
    const onOpen = vi.fn();
    act(() => root.render(<ToolCard onOpenSubagent={onOpen} block={{ kind: "tool", name: "Task", callId: "task-1", status: "completed", subStatus: "finished", input: { description: "Inspect routing" } }} />));
    act(() => container.querySelector(".subagent-card")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith("task-1");
  });

  it("expands and collapses a plan with the keyboard", () => {
    act(() => root.render(<ToolCard block={{ kind: "tool", name: "WritePlan", callId: "plan-1", status: "completed", input: { title: "Routing plan", content: "Inspect the route handlers." } }} />));
    const header = container.querySelector<HTMLElement>(".plan-header")!;
    expect(header.getAttribute("aria-expanded")).toBe("false");
    act(() => header.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true })));
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".plan-body")?.textContent).toContain("Inspect the route handlers.");
    act(() => header.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(header.getAttribute("aria-expanded")).toBe("false");
  });
});

function renderQuestions(questions: Array<Record<string, unknown>>) {
  act(() => root.render(<ToolCard block={{
    kind: "tool", name: "AskQuestion", callId: "question-1", status: "running",
    input: { questions },
  }} />));
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

function click(label: string) {
  act(() => button(label).click());
}

function field(): HTMLInputElement | HTMLTextAreaElement {
  const input = container.querySelector("input, textarea");
  if (!input) throw new Error("Missing answer field");
  return input as HTMLInputElement | HTMLTextAreaElement;
}

function type(value: string) {
  const input = field();
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function expectAnswers(answers: Record<string, string[]>) {
  expect(vscode.postMessage).toHaveBeenCalledOnce();
  expect(vscode.postMessage).toHaveBeenCalledWith({
    type: "answerQuestion", callId: "question-1", answers,
  });
}

describe("AskQuestion production form", () => {
  it("keeps invalid calendar dates from being submitted and accepts a valid leap day", () => {
    renderQuestions([{ prompt: "Release date", type: "date", required: true }]);
    expect(field().type).toBe("text");
    type("2026-02-29");
    expect(button("Submit").disabled).toBe(true);
    expect(field().getAttribute("aria-invalid")).toBe("true");
    act(() => field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(vscode.postMessage).not.toHaveBeenCalled();
    type("2028-02-29");
    expect(button("Submit").disabled).toBe(false);
    click("Submit");
    expectAnswers({ "0": ["2028-02-29"] });
  });

  it.each([
    ["text", "release"], ["textArea", "first line\nsecond line"],
    ["number", "42"], ["date", "2026-09-07"],
  ])("submits a typed %s answer", (typeName, value) => {
    renderQuestions([{ prompt: "Your answer", type: typeName }]);
    type(value);
    click("Submit");
    expectAnswers({ "0": [value] });
    expect(container.querySelector(".qc-a")?.textContent).toBe(value);
  });

  it.each(["text", "textArea", "number", "date"])("requires an answer for %s", (typeName) => {
    renderQuestions([{ prompt: "Required", type: typeName, required: true }]);
    expect(button("Submit").disabled).toBe(true);
    expect(container.querySelector(".qc-skip")).toBeNull();
    click("Submit");
    act(() => field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(vscode.postMessage).not.toHaveBeenCalled();
    type(typeName === "number" ? "0" : typeName === "date" ? "2026-09-07" : "answer");
    expect(button("Submit").disabled).toBe(false);
    click("Submit");
    expect(vscode.postMessage).toHaveBeenCalledOnce();
  });

  it("blocks Continue and Enter for a required blank field", () => {
    renderQuestions([{ prompt: "Required", type: "text", required: true }, { prompt: "Next", type: "text" }]);
    type("   ");
    click("Continue");
    act(() => field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(container.querySelector(".qc-step")?.textContent).toBe("1 of 2");
    expect(vscode.postMessage).not.toHaveBeenCalled();
  });

  it("preserves earlier answers and edits after going Back", () => {
    renderQuestions([{ prompt: "Name", type: "text" }, { prompt: "Count", type: "number" }]);
    type("old");
    click("Continue");
    type("42");
    click("Back");
    type("new");
    click("Continue");
    click("Submit");
    expectAnswers({ "0": ["new"], "1": ["42"] });
  });

  it("does not submit an old answer after it is cleared", () => {
    renderQuestions([{ prompt: "Name", type: "text" }, { prompt: "Count", type: "number" }]);
    type("old");
    click("Continue");
    click("Back");
    type("");
    click("Continue");
    click("Submit");
    expectAnswers({ "0": [], "1": [] });
  });

  it("keeps Other answers working and validates required choices", () => {
    renderQuestions([{ prompt: "Choose", options: ["One", "Two"], required: true }]);
    expect(button("Submit").disabled).toBe(true);
    act(() => container.querySelector<HTMLButtonElement>(".qc-option-custom")!.click());
    expect(button("Submit").disabled).toBe(true);
    type("Three");
    click("Submit");
    expectAnswers({ "0": ["Three"] });
  });

  it("submits multiple choices together with Other", () => {
    renderQuestions([{ prompt: "Choose", options: ["One", "Two"], multiple: true }]);
    act(() => container.querySelector<HTMLButtonElement>(".qc-option")!.click());
    act(() => container.querySelector<HTMLButtonElement>(".qc-option-custom")!.click());
    type("Three");
    click("Submit");
    expectAnswers({ "0": ["One", "Three"] });
  });

  it("skips an optional answer without sending its draft", () => {
    renderQuestions([{ prompt: "Optional", type: "text" }]);
    type("draft");
    click("Skip");
    expectAnswers({ "0": [] });
  });

  it("does not duplicate an option when Other repeats it", () => {
    renderQuestions([{ prompt: "Choose", options: ["One", "Two"], multiple: true }]);
    act(() => container.querySelector<HTMLButtonElement>(".qc-option")!.click());
    act(() => container.querySelector<HTMLButtonElement>(".qc-option-custom")!.click());
    type("One");
    click("Submit");
    expectAnswers({ "0": ["One"] });
  });
});
