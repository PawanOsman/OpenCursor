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
import { App } from "./App";
import { vscode } from "../shared/vscode";
import * as workPresentation from "./workPresentation";

vi.mock("../shared/vscode", () => ({ vscode: { postMessage: vi.fn() } }));
vi.mock("./components/Composer", () => ({
  KIND_SVG: {}, applyFileIconTo: vi.fn(),
  Composer: (props: any) => <div data-testid="composer" data-running={props.isRunning}><button data-testid="send" onClick={() => props.onSubmit("queued-A", [])}>Send fixture</button><button data-testid="agent" onClick={() => props.onMode("agent")}>Agent mode</button></div>,
}));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.scrollTo = vi.fn();
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<App />));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function message(data: any) { act(() => window.dispatchEvent(new MessageEvent("message", { data }))); }
function initial(extra: any = {}) { message({ type: "initialState", activeId: "A", mode: "ask", selectedModel: "api::model-A", turns: [{ role: "user", text: "Task A" }], personas: [], activePersonaId: "default", hasProviders: true, runningConvIds: ["A"], uiPrefs: { motion: "reduced" }, ...extra }); }
function queuedMenu(index = 0) {
  act(() => container.querySelectorAll<HTMLButtonElement>('[aria-label="More queued message actions"]')[index].click());
  return document.querySelector<HTMLElement>('[role="menu"]:not([aria-hidden="true"])')!;
}

describe("transcript resource usage", () => {
  const paint = () => act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });

  it("does not rebuild settled assistant activity when a new response streams", async () => {
    const split = vi.spyOn(workPresentation, "splitWork");
    initial({ turns: [
      { role: "user", text: "Earlier request" },
      { role: "assistant", blocks: [{ kind: "text", text: "Settled response" }], startedAt: 1, endedAt: 2 },
      { role: "user", text: "New request" },
    ] });
    split.mockClear();
    message({ type: "agentEvent", convId: "A", event: { type: "text-delta", text: "New response" } });
    await paint();
    expect(container.textContent).toContain("New response");
    expect(split.mock.calls.some(([turn]) => turn.blocks.some(block => block.kind === "text" && block.text === "Settled response"))).toBe(false);
    expect(split.mock.calls.length).toBeGreaterThan(0);
  });

  it("does not redraw the active transcript for background token deltas", async () => {
    initial();
    message({ type: "loadConversation", activeId: "B", turns: [{ role: "user", text: "Visible chat" }], running: false });
    const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    measure.mockClear();
    for (let i = 0; i < 25; i++) message({ type: "agentEvent", convId: "A", event: { type: "text-delta", text: " background" } });
    await paint();
    expect(measure).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("background");
  });

  it("releases inactive settled transcripts while retaining live background runs", () => {
    initial();
    message({ type: "loadConversation", activeId: "B", turns: [{ role: "user", text: "Visible chat" }], running: false });
    vi.mocked(vscode.postMessage).mockClear();
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(vi.mocked(vscode.postMessage).mock.calls.filter(([msg]) => (msg as any).type === "persistTurns").map(([msg]) => (msg as any).convId)).toEqual(["A", "B"]);

    message({ type: "agentEvent", convId: "A", event: { type: "run-status", status: "finished" } });
    message({ type: "loadConversation", activeId: "C", turns: [{ role: "user", text: "Third chat" }], running: false });
    vi.mocked(vscode.postMessage).mockClear();
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(vi.mocked(vscode.postMessage).mock.calls.filter(([msg]) => (msg as any).type === "persistTurns").map(([msg]) => (msg as any).convId)).toEqual(["C"]);
  });
});

describe("streaming thinking scroll", () => {
  let height: number;
  const show = (text: string, endedAt?: number) => initial({ turns: [
    { role: "user", text: "Task A" },
    { role: "assistant", blocks: [{ kind: "thinking", text, startedAt: 1, endedAt }] },
  ] });
  const body = () => container.querySelector<HTMLDivElement>('.thinking-body')!;
  const toggle = () => act(() => (container.querySelector('.thinking-head') as HTMLElement).click());
  beforeEach(() => {
    height = 600;
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('thinking-body') ? height : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('thinking-body') ? 180 : 0;
    });
  });

  it("follows live text, pauses while reading above, and resumes at the bottom", () => {
    show('First reasoning');
    expect(body().scrollTop).toBe(600);
    height = 800;
    show('First reasoning with more content');
    expect(body().scrollTop).toBe(800);
    act(() => { body().scrollTop = 100; body().dispatchEvent(new Event('scroll')); });
    height = 1000;
    show('First reasoning with even more content');
    expect(body().scrollTop).toBe(100);
    act(() => { body().scrollTop = 820; body().dispatchEvent(new Event('scroll')); });
    height = 1200;
    show('First reasoning continued');
    expect(body().scrollTop).toBe(1200);
  });

  it("reopens live thinking at its latest text without scrolling completed thinking", () => {
    show('Live reasoning');
    toggle();
    expect(body()).toBeNull();
    height = 900;
    show('Live reasoning continued while collapsed');
    expect(body()).toBeNull();
    toggle();
    expect(body().scrollTop).toBe(900);
    show('Completed reasoning', 2000);
    toggle();
    expect(body().scrollTop).toBe(0);
    height = 1100;
    show('Completed reasoning updated', 2000);
    expect(body().scrollTop).toBe(0);
  });
});

it("opens a sent image preview without entering edit mode and closes it when switching chats", () => {
  initial({ runningConvIds: [], turns: [{ role: "user", text: "Check this image", attachments: [
    { id: "image", name: "diagram.png", mime: "image/png", kind: "image", data: "data:image/png;base64,a" },
    { id: "file", name: "notes.txt", mime: "text/plain", kind: "text", data: "Notes" },
  ] }] });
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Preview image diagram.png"]')!;
  vi.mocked(vscode.postMessage).mockClear();
  act(() => { trigger.focus(); trigger.click(); });
  expect(document.querySelector('[role="dialog"][aria-label="Image preview"]')).not.toBeNull();
  expect(container.querySelector(".msg.user .bubble")?.textContent).toContain("Check this image");
  expect(container.querySelectorAll('[data-testid="composer"]')).toHaveLength(1);
  expect(container.querySelectorAll(".image-attachment-trigger")).toHaveLength(1);
  expect(container.querySelector(".msg-attach-file")?.textContent).toContain("notes.txt");
  expect(vscode.postMessage).not.toHaveBeenCalled();
  message({ type: "loadConversation", activeId: "B", turns: [], running: false });
  expect(document.querySelector('[role="dialog"][aria-label="Image preview"]')).toBeNull();
});

describe("composer changed-file review", () => {
  const changes = [
    { path: "src/existing.ts", existedBefore: true, added: 40, removed: 12 },
    { path: "src/new.ts", existedBefore: false, added: 3, removed: 4 },
  ];
  const reviewButton = () => container.querySelector<HTMLElement>('[aria-label="Changed files"]')!;

  it("summarizes all changed files beside queued messages and expands review on demand", () => {
    initial();
    message({ type: "pendingChanges", changes });
    message({ type: "workflowState", goals: {}, queues: { A: [{ id: "next", text: "Check the public API", createdAt: 1, status: "queued" }] } });

    const tray = container.querySelector(".composer-tray")!;
    expect(tray.querySelector(".review-head")?.textContent).toContain("2 files changed");
    expect(tray.querySelector(".review-head .rv-add")?.textContent).toBe("+43");
    expect(tray.querySelector(".review-head .rv-del")?.textContent).toBe("-16");
    expect(tray.querySelector(".queue-item")?.textContent).toContain("Check the public API");
    expect(container.querySelector(".review-list")).toBeNull();
    expect(container.querySelector(".review-head .review-actions")?.textContent).toContain("Undo AllKeep All");
    expect(reviewButton().getAttribute("aria-expanded")).toBe("false");

    vi.mocked(vscode.postMessage).mockClear();
    act(() => reviewButton().click());
    expect(reviewButton().getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelectorAll(".review-item")).toHaveLength(2);
    expect(container.querySelectorAll(".review-item .rv-tag")).toHaveLength(1);
    expect(container.querySelector(".review-actions")?.textContent).toContain("Undo All");
    expect(container.querySelector(".review-actions")?.textContent).toContain("Keep All");
    expect(vscode.postMessage).not.toHaveBeenCalled();

    act(() => reviewButton().click());
    expect(container.querySelector(".review-list")).toBeNull();
    expect(container.querySelector(".queue-item")?.textContent).toContain("Check the public API");
  });

  it("keeps file diff, individual decisions and bulk decisions connected to the host", () => {
    initial({ runningConvIds: [] });
    message({ type: "pendingChanges", changes });
    act(() => reviewButton().click());
    vi.mocked(vscode.postMessage).mockClear();

    const rows = container.querySelectorAll<HTMLElement>(".review-item");
    const firstFile = rows[0].querySelector<HTMLButtonElement>("button.rv-file")!;
    expect(firstFile.title).toBe("src/existing.ts");
    act(() => firstFile.click());
    act(() => rows[0].querySelector<HTMLButtonElement>('[title="Undo"]')!.click());
    act(() => rows[1].querySelector<HTMLButtonElement>('[title="Keep"]')!.click());
    const bulk = [...container.querySelectorAll<HTMLButtonElement>(".review-actions button")];
    act(() => bulk.find(button => button.textContent === "Undo All")!.click());
    act(() => bulk.find(button => button.textContent === "Keep All")!.click());

    expect(vi.mocked(vscode.postMessage).mock.calls).toEqual([
      [{ type: "diffChange", path: "src/existing.ts" }],
      [{ type: "rejectChange", path: "src/existing.ts" }],
      [{ type: "acceptChange", path: "src/new.ts" }],
      [{ type: "rejectAllChanges" }],
      [{ type: "acceptAllChanges" }],
    ]);
  });

  it("handles unavailable line counts and removes the summary after the host clears changes", () => {
    initial({ runningConvIds: [] });
    message({ type: "pendingChanges", changes: [{ path: "assets/image.png", existedBefore: true }] });
    expect(container.querySelector(".review-head")?.textContent).toContain("1 file changed");
    expect(container.querySelector(".review-head")?.textContent).not.toMatch(/NaN|undefined/);
    message({ type: "pendingChanges", changes: [] });
    expect(container.querySelector(".review-bar")).toBeNull();
    expect(container.querySelector('[data-testid="composer"]')).not.toBeNull();
  });

  it("toggles from the panel and keyboard while bulk actions do not toggle it", () => {
    initial();
    message({ type: "pendingChanges", changes });
    const header = container.querySelector<HTMLElement>(".review-head")!;
    const buttons = container.querySelectorAll<HTMLButtonElement>(".review-actions button");
    act(() => buttons[0].click());
    act(() => buttons[1].click());
    expect(container.querySelector(".review-list")).toBeNull();
    act(() => header.click());
    expect(reviewButton().getAttribute("aria-expanded")).toBe("true");
    act(() => buttons[0].click());
    expect(reviewButton().getAttribute("aria-expanded")).toBe("true");
    for (const key of ["Enter", " "]) {
      act(() => reviewButton().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
    }
    expect(reviewButton().getAttribute("aria-expanded")).toBe("true");
    act(() => header.click());
    expect(reviewButton().getAttribute("aria-expanded")).toBe("false");
  });
});

describe("live conversation activity", () => {
  // Component tests exercise the full transition timing. These tests check the
  // host event wiring with the user's reduced-motion preference applied.
  const start = (extra: any = {}) => initial({
    uiPrefs: { chatTextSize: "default", submitWithCtrlEnter: false, maxTabCount: 0, completionSound: false, perTabDrafts: false, motion: "reduced" },
    ...extra,
  });
  const event = (event: any, convId = "A") => message({ type: "agentEvent", convId, event });
  const paint = () => act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  const expectActivity = (text: string) => {
    const status = container.querySelector('.phase-row .t-think[role="status"]')!;
    expect(status).not.toBeNull();
    expect(status.getAttribute("aria-label")).toBe(text);
    const copies = status.querySelectorAll<HTMLElement>(".t-think-text");
    expect(copies).toHaveLength(1);
    expect(copies[0].textContent).toBe(text);
    expect(copies[0].dataset.text).toBe(text);
    expect(container.querySelectorAll(".phase-row .t-matrix i")).toHaveLength(16);
  };

  it("connects restored activity, thinking, generated text and tool execution to the supplied status effects", async () => {
    start();
    expectActivity("Working");
    message({ type: "runStarted", convId: "A" });
    expectActivity("Thinking");

    event({ type: "thinking-delta", text: "I should inspect the implementation." });
    await paint();
    expectActivity("Thinking");
    event({ type: "text-delta", text: "I will inspect the relevant file." });
    await paint();
    expectActivity("Generating");

    event({ type: "tool-call-started", callId: "activity-read", name: "Read", input: { path: "src/example.ts" } });
    expectActivity("Reading file");
    event({ type: "tool-call-completed", callId: "activity-read", name: "Read", status: "completed", result: "export const example = true;" });
    expectActivity("Planning next moves");
  });

  it.each(["finished", "cancelled", "error"])("removes the animated status when a run is %s", async status => {
    start();
    event({ type: "thinking-delta", text: "Checking the task." });
    await paint();
    expectActivity("Thinking");

    event({ type: "run-status", status });
    expect(container.querySelector(".phase-row")).toBeNull();
    expect(container.querySelector(".t-think")).toBeNull();
    expect(container.querySelector(".t-matrix")).toBeNull();
    expect(container.querySelector('[data-testid="composer"]')?.getAttribute("data-running")).toBe("false");

    // A late streamed event must not create a fresh activity indicator.
    event({ type: "text-delta", text: "A delayed final fragment." });
    await paint();
    expect(container.querySelector(".phase-row")).toBeNull();
  });

  it("does not show activity in idle history or leak a background conversation's phase", async () => {
    start({ runningConvIds: [] });
    expect(container.querySelector(".phase-row")).toBeNull();
    message({ type: "runStarted", convId: "B", turns: [{ role: "user", text: "Background task" }] });
    event({ type: "thinking-delta", text: "Thinking in another conversation." }, "B");
    await paint();
    expect(container.querySelector(".phase-row")).toBeNull();
    expect(container.querySelector('[data-testid="composer"]')?.getAttribute("data-running")).toBe("false");

    message({ type: "loadConversation", activeId: "B", turns: [{ role: "user", text: "Background task" }], running: true });
    expect(container.querySelector(".phase-row .t-think")).not.toBeNull();
    message({ type: "loadConversation", activeId: "A", turns: [{ role: "user", text: "Task A" }], running: false });
    expect(container.querySelector(".phase-row")).toBeNull();
  });

  it("keeps the host's current phase through unrelated usage updates instead of inventing progress", async () => {
    start();
    event({ type: "shell-notify", message: "Waiting for the running test process" });
    await paint();
    expectActivity("Waiting for the running test process");
    event({ type: "usage", totalTokens: 1200 });
    await paint();
    expectActivity("Waiting for the running test process");
  });
});

describe("conversation message actions", () => {
  const attachments = [{ id: "first-file", name: "src/first.ts", kind: "text", mime: "text/plain", data: "export const first = true;" }];
  const history = [
    { role: "user", text: "First request", attachments },
    { role: "assistant", blocks: [{ kind: "text", text: "First response" }] },
    { role: "user", text: "Second request" },
    { role: "assistant", blocks: [{ kind: "text", text: "Second response" }] },
  ];

  it.each(["Resend message", "Retry response"])("%s uses its own request and attachments, not the latest request", (label) => {
    initial({ turns: history, runningConvIds: [] });
    vi.mocked(vscode.postMessage).mockClear();
    act(() => container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
    expect(vscode.postMessage).toHaveBeenCalledWith({ type: "sendMessage", convId: "A", text: "First request", attachments, fromIndex: 0, model: "api::model-A", mode: "ask", revertFiles: false });
    expect(container.querySelectorAll(".msg")).toHaveLength(2);
    expect(container.querySelector(".working-head")?.textContent).toBe("Working");
    expect(container.querySelector('[data-testid="composer"]')?.getAttribute("data-running")).toBe("true");
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Resend message"]')?.disabled).toBe(true);
  });

  it("opens the selected message for editing and resends from its original position", () => {
    initial({ turns: history, runningConvIds: [] });
    act(() => container.querySelectorAll<HTMLButtonElement>('[aria-label="Edit message"]')[1].click());
    expect(container.querySelectorAll(".msg.user.editing")).toHaveLength(1);
    vi.mocked(vscode.postMessage).mockClear();
    act(() => container.querySelector<HTMLButtonElement>('.msg.user.editing [data-testid="send"]')!.click());
    expect(vscode.postMessage).toHaveBeenCalledWith({ type: "sendMessage", convId: "A", text: "queued-A", attachments: undefined, fromIndex: 2, model: "api::model-A", mode: "ask", revertFiles: false });
  });

  it("keeps file-change confirmation before retrying a response", () => {
    initial({ turns: history, runningConvIds: [] });
    message({ type: "pendingChanges", changes: [{ path: "src/first.ts", type: "modified", additions: 2, deletions: 1 }] });
    vi.mocked(vscode.postMessage).mockClear();
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Retry response"]')!.click());
    expect(container.querySelector(".modal-title")?.textContent).toBe("Revert file changes?");
    expect(vscode.postMessage).not.toHaveBeenCalled();
    act(() => container.querySelector<HTMLButtonElement>('.modal-actions .btn-primary')!.click());
    expect(vscode.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "sendMessage", text: "First request", fromIndex: 0, revertFiles: true }));
  });

  it("restores an earlier message as a draft without starting another run", () => {
    initial({ turns: history, runningConvIds: [] });
    vi.mocked(vscode.postMessage).mockClear();
    act(() => container.querySelectorAll<HTMLButtonElement>('[aria-label="Revert to this message"]')[1].click());
    expect(vscode.postMessage).toHaveBeenCalledWith({ type: "revertToMessage", index: 2, revertFiles: false });
    expect(container.querySelectorAll(".msg")).toHaveLength(2);
    expect(vi.mocked(vscode.postMessage).mock.calls.some(([m]) => (m as any).type === "sendMessage")).toBe(false);
  });

  it.each(["Retry response", "Revert to this message"])("disables %s confirmation if another run starts while it is open", (label) => {
    initial({ turns: history, runningConvIds: [] });
    message({ type: "pendingChanges", changes: [{ path: "src/first.ts", type: "modified", additions: 2, deletions: 1 }] });
    act(() => container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
    message({ type: "runStarted", convId: "A" });
    vi.mocked(vscode.postMessage).mockClear();
    const confirm = container.querySelector<HTMLButtonElement>('.modal-actions .btn-primary')!;
    expect(confirm.disabled).toBe(true);
    act(() => confirm.click());
    expect(container.querySelectorAll(".msg")).toHaveLength(4);
    expect(vscode.postMessage).not.toHaveBeenCalled();
  });

  it("allows copying while preventing edits, resend, retry and revert during a run", () => {
    initial({ turns: history });
    vi.mocked(vscode.postMessage).mockClear();
    for (const label of ["Edit message", "Resend message", "Retry response", "Revert to this message"]) {
      const button = container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
      expect(button.disabled).toBe(true);
      act(() => button.click());
    }
    act(() => container.querySelector<HTMLElement>('.msg.user .bubble')!.click());
    expect(container.querySelector(".msg.user.editing")).toBeNull();
    expect([...container.querySelectorAll<HTMLButtonElement>('[aria-label="Copy message"]')].every(button => !button.disabled)).toBe(true);
    expect(vscode.postMessage).not.toHaveBeenCalled();
  });

  it("offers copy without retry for an assistant message that has no preceding request", () => {
    initial({ turns: [{ role: "assistant", blocks: [{ kind: "text", text: "Welcome" }] }], runningConvIds: [] });
    expect(container.querySelector('[aria-label="Copy message"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Retry response"]')).toBeNull();
  });

  it.each(['.msg.user .bubble', '.message-actions [aria-label="Copy message"]'])("stops following streamed output when PageUp is pressed on %s", (selector) => {
    initial({ turns: history });
    const target = container.querySelector<HTMLElement>(selector)!;
    act(() => {
      target.focus();
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", bubbles: true }));
    });
    expect(container.querySelector('[title="Scroll to bottom"]')).not.toBeNull();
    message({ type: "agentEvent", convId: "A", event: { type: "text-delta", text: " More response text." } });
    expect(container.querySelector('[title="Scroll to bottom"]')).not.toBeNull();
  });
});

describe("production chat application lifecycle", () => {
  it("sends queue intents immediately to the host with their original destination and settings", async () => {
    initial();
    act(() => (container.querySelector('[data-testid="send"]') as HTMLButtonElement).click());
    message({ type: "loadConversation", activeId: "B", turns: [{ role: "user", text: "Task B" }], running: false });
    message({ type: "modelSelected", model: "api::model-B" });
    act(() => (container.querySelector('[data-testid="agent"]') as HTMLButtonElement).click());
    message({ type: "agentEvent", convId: "A", event: { type: "run-status", status: "finished" } });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    const sends = vi.mocked(vscode.postMessage).mock.calls.map(([m]) => m as { type: string }).filter((m) => m.type === "sendMessage");
    expect(sends).toEqual([{ type: "sendMessage", convId: "A", text: "queued-A", attachments: undefined, model: "api::model-A", mode: "ask", requestId: expect.any(String) }]);
    expect(container.querySelector(".chat-list")?.textContent ?? container.textContent).not.toContain("queued-A");
  });

  it("keeps a live question answerable when the webview restores a host snapshot", () => {
    initial({ turns: [{ role: "user", text: "Ask me" }, { role: "assistant", blocks: [{ kind: "tool", name: "AskQuestion", callId: "q", status: "running", input: { questions: [{ question: "Choose", options: ["Yes", "No"] }] } }] }] });
    expect(container.querySelectorAll(".qc-option").length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector(".question-card.done")).toBeNull();
  });

  it("restores completed answers from the host after a reload", () => {
    initial({ runningConvIds: [], turns: [{ role: "assistant", blocks: [{ kind: "tool", name: "AskQuestion", callId: "q", status: "completed", input: { questions: [{ question: "Branch" }] }, answers: { "0": ["Keep main"] } }] }] });
    act(() => container.querySelector<HTMLButtonElement>("button.working-head")!.click());
    expect(container.querySelector(".qc-a")?.textContent).toBe("Keep main");
  });

  it("restores host-owned queued requests without submitting or replaying them", () => {
    initial({ runningConvIds: [], workspaceState: { openTabs: ["A"], drafts: { A: { text: "Saved draft", attachments: [] } } } });
    message({ type: "workflowState", goals: {}, queues: { A: [{ id: "unknown", text: "Publish package", createdAt: 1, status: "interrupted", error: "Restarted" }] } });
    expect(container.querySelector(".queue-bar")?.textContent).toContain("Interrupted: Publish package");
    expect(vi.mocked(vscode.postMessage).mock.calls.some(([m]) => (m as any).type === "sendMessage")).toBe(false);
    act(() => (container.querySelector('.queue-actions button') as HTMLButtonElement).click());
    expect(vscode.postMessage).toHaveBeenCalledWith({ type: "queueAction", convId: "A", id: "unknown", action: "run" });
  });

  it("steers the active conversation with the chosen queued message without cancelling or resubmitting", () => {
    initial();
    message({ type: "workflowState", goals: {}, queues: {
      A: [{ id: "first-A", text: "Keep the API compatible", createdAt: 1, status: "queued" }, { id: "second-A", text: "Use the shared helper", createdAt: 2, status: "queued" }],
      B: [{ id: "first-B", text: "Keep the UI compact", createdAt: 3, status: "queued" }],
    } });
    vi.mocked(vscode.postMessage).mockClear();
    const steerButtons = container.querySelectorAll<HTMLButtonElement>('[aria-label="Steer current run with queued message"]');
    expect(steerButtons).toHaveLength(2);
    expect(steerButtons[1].textContent).toBe("Steer");
    act(() => steerButtons[1].click());
    expect(vi.mocked(vscode.postMessage).mock.calls).toEqual([[{ type: "queueAction", convId: "A", id: "second-A", action: "steer" }]]);
    expect(container.querySelectorAll(".queue-item")).toHaveLength(2);

    message({ type: "loadConversation", activeId: "B", turns: [{ role: "user", text: "Task B" }], running: true });
    vi.mocked(vscode.postMessage).mockClear();
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Steer current run with queued message"]')!.click());
    expect(vi.mocked(vscode.postMessage).mock.calls).toEqual([[{ type: "queueAction", convId: "B", id: "first-B", action: "steer" }]]);
  });

  it("shows a new message immediately when only a finished request is awaiting cleanup", () => {
    initial({ runningConvIds: [] });
    message({ type: "workflowState", goals: {}, queues: { A: [{ id: "finished", text: "Task A", status: "running", createdAt: 1 }] } });
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="send"]')!.click());
    expect([...container.querySelectorAll(".msg.user")].pop()?.textContent).toContain("queued-A");
    expect(container.querySelector(".queue-item")).toBeNull();
  });

  it("keeps steering visible and busy until the matching message enters the conversation", () => {
    initial();
    const first = { id: "first", text: "Same instructions", createdAt: 1, status: "queued" };
    const second = { ...first, id: "second", createdAt: 2 };
    message({ type: "workflowState", goals: {}, queues: { A: [first, second] } });
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Steer current run with queued message"]')!.click());
    expect(container.querySelectorAll(".queue-item")).toHaveLength(2);
    expect(container.querySelector('.queue-item[aria-busy="true"] .spinner')).not.toBeNull();
    message({ type: "workflowState", goals: {}, queues: { A: [second] }, steeringQueues: { A: [first] } });
    message({ type: "queueSteeringResult", convId: "A", requestId: "first", accepted: true });
    expect(container.querySelectorAll(".queue-item")[0].getAttribute("aria-busy")).toBe("true");
    message({ type: "agentEvent", convId: "A", event: { type: "user-steering", text: first.text, requestId: "first" } });
    expect(container.querySelectorAll(".queue-item")).toHaveLength(1);
    expect(container.querySelector('.queue-item[aria-busy="true"]')).toBeNull();
    expect([...container.querySelectorAll(".msg.user")].pop()?.textContent).toContain(first.text);
  });

  it("restores steering controls after rejection and restores in-flight steering after reconnect", () => {
    initial();
    const item = { id: "pending", text: "Keep the API", status: "queued", createdAt: 1 };
    message({ type: "workflowState", goals: {}, queues: { A: [item] } });
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Steer current run with queued message"]')!.click());
    message({ type: "queueSteeringResult", convId: "A", requestId: item.id, accepted: false });
    expect(container.querySelector('.queue-item[aria-busy="true"]')).toBeNull();
    expect(container.querySelector('[aria-label="Steer current run with queued message"]')).not.toBeNull();
    message({ type: "workflowState", goals: {}, queues: { A: [] }, steeringQueues: { A: [item] } });
    expect(container.querySelector('.queue-item[aria-busy="true"]')?.textContent).toContain(item.text);
    message({ type: "workflowState", goals: {}, queues: { A: [item] }, steeringQueues: { A: [] } });
    expect(container.querySelector('.queue-item[aria-busy="true"]')).toBeNull();
  });

  it("keeps Send now as a separate interrupt action alongside Steer", () => {
    initial();
    message({ type: "workflowState", goals: {}, queues: { A: [{ id: "next", text: "Change direction", createdAt: 1, status: "queued" }] } });
    expect(container.querySelector('[aria-label="Steer current run with queued message"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Send queued request now"]')).toBeNull();
    const sendNow = queuedMenu().querySelector<HTMLButtonElement>('[aria-label="Send queued request now"]')!;
    expect(sendNow.textContent).toBe("Send now");
    vi.mocked(vscode.postMessage).mockClear();
    act(() => sendNow.click());
    expect(vi.mocked(vscode.postMessage).mock.calls).toEqual([[{ type: "queueAction", convId: "A", id: "next", action: "run" }]]);
  });

  it.each([
    ["Edit message", "edit"],
    ["Move earlier", "up"],
  ])("routes the queued message's %s menu action to its original host request", (label, action) => {
    initial();
    message({ type: "workflowState", goals: {}, queues: { A: [
      { id: "first", text: "First follow-up", createdAt: 1, status: "queued" },
      { id: "second", text: "Second follow-up", createdAt: 2, status: "queued" },
    ] } });
    const menu = queuedMenu(1);
    const command = [...menu.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === label)!;
    expect(command.disabled).toBe(false);
    vi.mocked(vscode.postMessage).mockClear();
    act(() => command.click());
    expect(vi.mocked(vscode.postMessage).mock.calls).toEqual([[{ type: "queueAction", convId: "A", id: "second", action }]]);
  });

  it("removes a queued message directly without starting or steering a run", () => {
    initial();
    message({ type: "workflowState", goals: {}, queues: { A: [{ id: "remove-me", text: "Unneeded follow-up", createdAt: 1, status: "queued" }] } });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    vi.mocked(vscode.postMessage).mockClear();
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Remove queued message"]')!.click());
    expect(vi.mocked(vscode.postMessage).mock.calls).toEqual([[{ type: "queueAction", convId: "A", id: "remove-me", action: "remove" }]]);
  });

  it("renders consumed steering between assistant turns while keeping the run and previous work intact", async () => {
    initial();
    message({ type: "agentEvent", convId: "A", event: { type: "text-delta", text: "I am checking the current implementation." } });
    message({ type: "agentEvent", convId: "A", event: { type: "tool-call-started", callId: "check-before-steer", name: "Shell", input: { command: "npm test" } } });
    message({ type: "agentEvent", convId: "A", event: { type: "tool-call-completed", callId: "check-before-steer", name: "Shell", status: "completed", result: "All tests passed" } });
    const previousAssistant = container.querySelector(".msg.assistant")!;
    const previousContent = previousAssistant.textContent;
    expect(previousContent).toContain("I am checking the current implementation.");
    expect(previousContent).toContain("npm test");

    vi.mocked(vscode.postMessage).mockClear();
    message({ type: "agentEvent", convId: "A", event: { type: "user-steering", text: "Keep the existing keyboard shortcuts." } });
    message({ type: "agentEvent", convId: "A", event: { type: "text-delta", text: "I will preserve those shortcuts as I update the component." } });
    await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });

    const renderedTurns = [...container.querySelectorAll(".msg")];
    expect(renderedTurns.map(turn => turn.classList.contains("user") ? "user" : "assistant")).toEqual(["user", "assistant", "user", "assistant"]);
    expect(renderedTurns[1]).toBe(previousAssistant);
    expect(renderedTurns[1].querySelector(".working-head")?.textContent).toContain("Worked");
    act(() => renderedTurns[1].querySelector<HTMLButtonElement>("button.working-head")!.click());
    expect(renderedTurns[1].textContent).toContain("I am checking the current implementation.");
    expect(renderedTurns[1].textContent).toContain("npm test");
    expect(renderedTurns[1].querySelector(".ok-icon")).not.toBeNull();
    expect(renderedTurns[2].textContent?.trim()).toBe("Keep the existing keyboard shortcuts.");
    expect(renderedTurns[3].textContent).toContain("I will preserve those shortcuts as I update the component.");
    expect(container.querySelector('[data-testid="composer"]')?.getAttribute("data-running")).toBe("true");
    expect(vi.mocked(vscode.postMessage).mock.calls.filter(([m]) => (m as any).type !== "persistTurns")).toEqual([]);
  });

  it("disables Steer for attachments and retains Send now", () => {
    initial();
    message({ type: "workflowState", goals: {}, queues: { A: [{ id: "with-file", text: "Use this file", attachments: [{ type: "file", path: "src/a.ts" }], createdAt: 1, status: "queued" }] } });
    const steer = container.querySelector<HTMLButtonElement>('[aria-label="Steer current run with queued message"]')!;
    expect(steer.disabled).toBe(true);
    expect(steer.title).toContain("Send now");
    expect(steer.title).toContain("attachments");
    expect(queuedMenu().querySelector<HTMLButtonElement>('[aria-label="Send queued request now"]')!.disabled).toBe(false);
    vi.mocked(vscode.postMessage).mockClear();
    act(() => steer.click());
    expect(vscode.postMessage).not.toHaveBeenCalled();
  });

  it.each(["interrupted", "failed"])("keeps %s recovery separate from steering", (status) => {
    initial();
    message({ type: "workflowState", goals: {}, queues: { A: [{ id: "recovery", text: "Reconcile existing work", createdAt: 1, status }] } });
    expect(container.querySelector('[aria-label="Steer current run with queued message"]')).toBeNull();
    const resume = container.querySelector<HTMLButtonElement>('[aria-label="Resume interrupted request"]')!;
    expect(resume.title).toBe("Resume and reconcile completed work");
    vi.mocked(vscode.postMessage).mockClear();
    act(() => resume.click());
    expect(vi.mocked(vscode.postMessage).mock.calls).toEqual([[{ type: "queueAction", convId: "A", id: "recovery", action: "run" }]]);
  });

  it("does not offer Steer when the active conversation is not running", () => {
    initial({ runningConvIds: ["B"] });
    message({ type: "workflowState", goals: {}, queues: { A: [{ id: "next", text: "Continue later", createdAt: 1, status: "queued" }] } });
    expect(container.querySelector('[aria-label="Steer current run with queued message"]')).toBeNull();
    expect(container.querySelector('[aria-label="Send queued request now"]')).not.toBeNull();
  });

  it("renders verification evidence from a restored conversation", () => {
    initial({ runningConvIds: [], turns: [{ role: "assistant", blocks: [{ kind: "verification", summary: { status: "untested", revision: 2, changedPaths: ["src/a.ts"], checks: [{ command: "pnpm test", revision: 1, status: "completed", exitCode: 0, at: 1 }] } }] }] });
    expect(container.querySelector(".verification-card")?.textContent).toContain("Not verified");
    expect(container.querySelector(".verification-card")?.textContent).toContain("before later edits");
  });

  it("hides an empty verification snapshot when an ordinary reply finishes", () => {
    initial();
    message({ type: "agentEvent", convId: "A", event: { type: "text-delta", text: "Hello! How can I help?" } });
    message({ type: "agentEvent", convId: "A", event: { type: "verification", summary: { status: "untested", revision: 0, changedPaths: [], checks: [] } } });
    message({ type: "agentEvent", convId: "A", event: { type: "run-status", status: "finished" } });
    expect(container.querySelector(".verification-card")).toBeNull();
    expect(container.textContent).toContain("Hello! How can I help?");
  });

  it("hides empty verification cards already saved in conversation history", () => {
    initial({ runningConvIds: [], turns: [{ role: "assistant", blocks: [{ kind: "text", text: "Hello!" }, { kind: "verification", summary: { status: "untested", revision: 0, changedPaths: [], checks: [] } }] }] });
    expect(container.querySelector(".verification-card")).toBeNull();
    expect(container.textContent).toContain("Hello!");
  });

  it("keeps the verification reminder when files were changed without checks", () => {
    initial({ runningConvIds: [], turns: [{ role: "assistant", blocks: [{ kind: "verification", summary: { status: "untested", revision: 1, changedPaths: ["src/a.ts"], checks: [] } }] }] });
    expect(container.querySelector(".verification-card")?.textContent).toContain("Not verified");
    expect(container.querySelector(".verification-card")?.textContent).toContain("1 changed file");
  });

  it.each([
    ["checks-passed", "completed", 0, "Checks passed"],
    ["checks-failed", "failed", 1, "Checks failed"],
    ["untested", "running", undefined, "Not verified"],
  ])("keeps %s evidence even when no files were changed", (status, checkStatus, exitCode, label) => {
    initial({ runningConvIds: [], turns: [{ role: "assistant", blocks: [{ kind: "verification", summary: { status, revision: 0, changedPaths: [], checks: [{ command: "pnpm test", revision: 0, status: checkStatus, exitCode, at: 1 }] } }] }] });
    expect(container.querySelector(".verification-card")?.textContent).toContain(label);
    expect(container.querySelector(".verification-card")?.textContent).toContain("pnpm test");
  });
});
