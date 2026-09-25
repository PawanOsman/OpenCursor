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
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { vscode } from "../shared/vscode";
import { setMotionPreference } from "../shared/motionPreference";
import type { Attachment, InMessage, OutMessage, UiPrefs } from "./types";

vi.mock("../shared/vscode", () => ({ vscode: { postMessage: vi.fn() } }));

let root: Root, container: HTMLDivElement;
const sharedKey = "\u0000shared";
const attachment: Attachment = { id: "notes", name: "notes.txt", mime: "text/plain", kind: "text", data: "Preserve this attachment" };
const markdown = '# Saved heading\n\n**Saved formatting**\n\n```\nconsole.log("restored");\n```';
const uiPrefs: UiPrefs = { chatTextSize: "default", motion: "reduced", submitWithCtrlEnter: false, maxTabCount: 0, completionSound: false, perTabDrafts: false };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setMotionPreference("reduced");
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.scrollTo = vi.fn();
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<App />));
  vi.mocked(vscode.postMessage).mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setMotionPreference("full");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function message(data: InMessage) {
  act(() => window.dispatchEvent(new MessageEvent("message", { data })));
}

function initial(extra: Partial<Extract<InMessage, { type: "initialState" }>> = {}) {
  message({ type: "initialState", mode: "agent", selectedModel: "", turns: [], personas: [], activePersonaId: "default", hasProviders: true, runningConvIds: [], uiPrefs, ...extra });
}

const editor = () => container.querySelector<HTMLElement>(".composer .editor")!;
const savedDraftWrites = () => vi.mocked(vscode.postMessage).mock.calls
  .map(([value]) => value as OutMessage)
  .filter((value): value is Extract<OutMessage, { type: "updateChatWorkspace" }> => value.type === "updateChatWorkspace" && value.state.drafts != null);

it.each([
  ["shared", false, sharedKey],
  ["per-tab", true, ""],
] as const)("renders a restored %s new-chat draft before typing without losing its attachment", (_name, perTabDrafts, key) => {
  initial({ uiPrefs: { ...uiPrefs, perTabDrafts }, workspaceState: { openTabs: [], drafts: { [key]: { text: markdown, attachments: [attachment] } } } });

  expect(editor().querySelector("h1")?.textContent).toBe("Saved heading");
  expect(editor().querySelector("strong")?.textContent).toBe("Saved formatting");
  expect(editor().querySelector("pre code")?.textContent).toBe('console.log("restored");');
  expect(editor().querySelector(".composer-code-header")?.textContent).toContain("Auto");
  expect(container.querySelector(".attach-chip")?.getAttribute("title")).toBe("notes.txt");
  expect(savedDraftWrites().every(write => write.state.drafts?.[key]?.attachments[0]?.id === attachment.id)).toBe(true);
  expect(vi.mocked(vscode.postMessage).mock.calls.some(([value]) => (value as OutMessage).type === "sendMessage")).toBe(false);
});

it("restores an existing conversation snapshot and keeps each tab's Markdown and attachments", () => {
  initial({ activeId: "A", uiPrefs: { ...uiPrefs, perTabDrafts: true }, workspaceState: { openTabs: ["A", "B"], drafts: {
    A: { text: markdown, attachments: [attachment] },
    B: { text: "## Other draft\n\n> Quoted instructions", attachments: [] },
  } } });
  expect(editor().querySelector("h1")?.textContent).toBe("Saved heading");
  expect(container.querySelectorAll(".attach-chip")).toHaveLength(1);

  message({ type: "loadConversation", activeId: "B", turns: [], running: false });
  expect(editor().querySelector("h2")?.textContent).toBe("Other draft");
  expect(editor().querySelector("blockquote")?.textContent).toBe("Quoted instructions");
  expect(container.querySelector(".attach-chip")).toBeNull();

  message({ type: "loadConversation", activeId: "A", turns: [], running: false });
  expect(editor().querySelector("h1")?.textContent).toBe("Saved heading");
  expect(editor().querySelector("pre code")?.textContent).toBe('console.log("restored");');
  expect(container.querySelector(".attach-chip")?.getAttribute("title")).toBe("notes.txt");
});

it("keeps the caret and undo history when a local draft returns through an unrelated host update", () => {
  initial({ workspaceState: { openTabs: [], drafts: { [sharedKey]: { text: markdown, attachments: [] } } } });
  const code = editor().querySelector("pre code")!;
  const text = code.firstChild!;
  act(() => {
    editor().focus();
    const range = document.createRange();
    range.setStart(text, text.textContent!.length);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { files: [], items: [], getData: (type: string) => type === "text/plain" ? " // local" : "" } });
    editor().dispatchEvent(paste);
  });
  expect(editor().querySelector("pre code")?.textContent).toBe('console.log("restored"); // local');
  const anchor = window.getSelection()!.anchorNode;
  const offset = window.getSelection()!.anchorOffset;

  message({ type: "modelSelected", model: "test-model" });
  expect(window.getSelection()!.anchorNode).toBe(anchor);
  expect(window.getSelection()!.anchorOffset).toBe(offset);
  act(() => editor().dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true })));
  expect(editor().querySelector("pre code")?.textContent).toBe('console.log("restored");');
});
