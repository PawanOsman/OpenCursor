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
import { Composer, type ComposerDraft } from "./Composer";
import { setMotionPreference } from "../../shared/motionPreference";
import type { ModelDef } from "../types";
import { vscode } from "../../shared/vscode";

vi.mock("../../shared/vscode", () => ({ vscode: { postMessage: vi.fn() } }));
let root: Root, container: HTMLDivElement;
const submit = vi.fn(), draftChanged = vi.fn();
const mention = 'Before <attached type="file" title="file.ts" content="src/file.ts" /> after';
const props = { mode: "agent" as const, onMode: vi.fn(), models: [], modelList: [], selectedModel: "", onSelectModel: vi.fn(), onSaveModelOptions: vi.fn(), onResetModelOptions: vi.fn(), isRunning: false, onSubmit: submit, onCancel: vi.fn(), onTabDraft: draftChanged };
beforeEach(() => {
  setMotionPreference("reduced");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  vi.clearAllMocks(); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); setMotionPreference("full"); vi.useRealTimers(); vi.unstubAllGlobals(); });
const editor = () => container.querySelector('.editor') as HTMLElement;
const remove = () => container.querySelector('.mention-x') as HTMLButtonElement;
function key(target: HTMLElement, key: string, extra: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, keyCode: key === "Enter" ? 13 : 0, bubbles: true, cancelable: true, ...extra });
  act(() => { target.focus(); target.dispatchEvent(event); });
  return event;
}
function lastDraft(): ComposerDraft { return draftChanged.mock.calls[draftChanged.mock.calls.length - 1][0]; }

it("previews attached images without submitting or removing them, and keeps removal separate", () => {
  const image = { id: "image", name: "diagram.png", mime: "image/png", kind: "image" as const, data: "data:image/png;base64,a" };
  act(() => root.render(<Composer {...props} initialText="Check this diagram" initialAttachments={[image]} />));
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Preview image diagram.png"]')!;
  act(() => { trigger.focus(); trigger.click(); });
  expect(document.querySelector('[role="dialog"][aria-label="Image preview"]')).not.toBeNull();
  expect(container.querySelectorAll(".attach-chip")).toHaveLength(1);
  expect(submit).not.toHaveBeenCalled();
  key(document.activeElement as HTMLElement, "Escape");
  expect(document.querySelector('[role="dialog"][aria-label="Image preview"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(editor().textContent).toBe("Check this diagram");
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Remove diagram.png"]')!.click());
  expect(container.querySelector(".attach-chip")).toBeNull();
  expect(document.querySelector('[role="dialog"][aria-label="Image preview"]')).toBeNull();
  expect(lastDraft().attachments).toEqual([]);
  expect(submit).not.toHaveBeenCalled();
});

it("keeps the Stop control clickable and its animation nodes stable during run updates", () => {
  act(() => root.render(<Composer {...props} />));
  const button = container.querySelector<HTMLButtonElement>('.send-btn')!;
  const ring = button.querySelector('.composer-stop-ring');
  const square = button.querySelector('.composer-stop-square');
  expect(button.disabled).toBe(true);
  expect(ring).not.toBeNull();
  expect(square).not.toBeNull();
  expect(ring?.parentElement?.getAttribute('aria-hidden')).toBe('true');

  act(() => root.render(<Composer {...props} isRunning usedTokens={100} />));
  expect(button.getAttribute('aria-label')).toBe('Stop');
  expect(button.classList.contains('stop')).toBe(true);
  expect(button.disabled).toBe(false);
  act(() => button.click());
  expect(props.onCancel).toHaveBeenCalledTimes(1);
  expect(submit).not.toHaveBeenCalled();

  act(() => root.render(<Composer {...props} isRunning usedTokens={200} />));
  expect(button.querySelector('.composer-stop-ring')).toBe(ring);
  expect(button.querySelector('.composer-stop-square')).toBe(square);
  act(() => root.render(<Composer {...props} usedTokens={200} />));
  expect(button.getAttribute('aria-label')).toBe('Send');
  expect(button.classList.contains('stop')).toBe(false);
  expect(button.disabled).toBe(true);
});

it("switches from Stop to Queue message while typing without cancelling the active run", () => {
  act(() => root.render(<Composer {...props} isRunning />));
  const button = container.querySelector<HTMLButtonElement>('.send-btn')!;
  const ring = button.querySelector('.composer-stop-ring');
  act(() => {
    editor().textContent = 'Use the existing helper';
    editor().dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(button.getAttribute('aria-label')).toBe('Queue message');
  expect(button.classList.contains('stop')).toBe(false);
  expect(button.disabled).toBe(false);
  act(() => button.click());
  expect(submit).toHaveBeenCalledWith('Use the existing helper', []);
  expect(props.onCancel).not.toHaveBeenCalled();
  expect(button.getAttribute('aria-label')).toBe('Stop');
  expect(button.querySelector('.composer-stop-ring')).toBe(ring);
});

it("keeps edit resends separate from the running Stop control", () => {
  act(() => root.render(<Composer {...props} isRunning editing initialText="Revised request" />));
  const button = container.querySelector<HTMLButtonElement>('.send-btn')!;
  expect(button.getAttribute('aria-label')).toBe('Resend');
  expect(button.classList.contains('stop')).toBe(false);
  act(() => button.click());
  expect(submit).toHaveBeenCalledWith('Revised request', []);
  expect(props.onCancel).not.toHaveBeenCalled();
});

it("removes mentions with Enter and Space without submitting, preserving text and undo drafts", () => {
  act(() => root.render(<Composer {...props} initialText={mention} />));
  expect(remove().tagName).toBe("BUTTON");
  expect(remove().type).toBe("button");
  expect(remove().tabIndex).toBe(0);
  expect(remove().getAttribute("aria-label")).toBe("Remove mention file.ts");
  expect(remove().previousElementSibling?.className).toBe("mention-label");
  expect(key(remove(), "Enter").defaultPrevented).toBe(true);
  expect(remove()).toBeNull(); expect(submit).not.toHaveBeenCalled();
  expect(lastDraft().text).not.toContain("<attached"); expect(lastDraft().text).toContain("Before"); expect(lastDraft().text).toContain("after");
  expect(document.activeElement).toBe(editor());
  key(editor(), "z", { ctrlKey: true });
  expect(remove()).not.toBeNull(); expect(lastDraft().text).toContain('<attached type="file"');
  expect(key(remove(), " ").defaultPrevented).toBe(true);
  expect(remove()).toBeNull(); expect(submit).not.toHaveBeenCalled();
  expect(lastDraft().text).not.toContain("<attached");
});

it("retains removal after tab draft restoration and document undo/redo", () => {
  act(() => root.render(<Composer {...props} focusKey="first" />));
  act(() => root.render(<Composer {...props} focusKey="second" tabDraft={{ text: mention, attachments: [] }} />));
  expect(key(remove(), "Tab").defaultPrevented).toBe(false);
  act(() => remove().click());
  expect(remove()).toBeNull(); expect(submit).not.toHaveBeenCalled();
  key(editor(), "z", { ctrlKey: true });
  expect(remove()?.getAttribute("aria-label")).toBe("Remove mention file.ts");
  key(remove(), "z", { ctrlKey: true, shiftKey: true });
  expect(remove()).toBeNull(); expect(lastDraft().text).not.toContain("<attached");
  key(editor(), "z", { ctrlKey: true });
  key(remove(), "Enter");
  expect(remove()).toBeNull(); expect(submit).not.toHaveBeenCalled();
});

it("does not reopen portal menus or swallow model-search Space and child actions", () => {
  const model: ModelDef = { id: "example", name: "Example model", kind: "openai", options: [{ key: "effort", label: "Effort", type: "select", value: "low", values: ["low", "high"] }] };
  act(() => root.render(<Composer {...props} modelList={[model]} />));
  key(container.querySelector('[aria-label="Choose mode"]') as HTMLElement, "Enter");
  key(document.querySelector('.mode-item') as HTMLElement, "Enter");
  expect(props.onMode).toHaveBeenCalledTimes(1); expect(document.querySelector('.mode-dropdown')).toBeNull();
  const trigger = container.querySelector('[aria-label="Choose model"]') as HTMLElement;
  key(trigger, "Enter");
  const search = document.querySelector('[placeholder="Search models"]') as HTMLElement;
  expect(key(search, " ").defaultPrevented).toBe(false);
  expect(document.querySelector('.model-picker')).not.toBeNull();
  const edit = document.querySelector('[title="Edit options"]') as HTMLButtonElement;
  key(edit, "Enter");
  expect(props.onSelectModel).not.toHaveBeenCalled(); expect(document.querySelector('.model-picker')).not.toBeNull();
  key(document.querySelector('[aria-label="Select Example model"]') as HTMLElement, " ");
  expect(props.onSelectModel).toHaveBeenCalledWith("example"); expect(document.querySelector('.model-picker')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("focuses model search and restores its trigger without scrolling on first open, reopen and options return", () => {
  const model: ModelDef = { id: "example", name: "Example model", kind: "openai", options: [{ key: "effort", label: "Effort", type: "select", value: "low", values: ["low", "high"] }] };
  act(() => root.render(<Composer {...props} modelList={[model]} />));
  const focus = vi.spyOn(HTMLElement.prototype, "focus");
  try {
    const trigger = container.querySelector('[aria-label="Choose model"]') as HTMLElement;
    const expectSearchFocus = () => {
      expect(document.activeElement).toBe(document.querySelector('[placeholder="Search models"]'));
      expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    };
    act(() => trigger.click());
    expectSearchFocus();
    key(document.activeElement as HTMLElement, "Escape");
    expect(document.activeElement).toBe(trigger);
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    act(() => trigger.click());
    expectSearchFocus();
    act(() => (document.querySelector('[title="Edit options"]') as HTMLButtonElement).click());
    act(() => (document.querySelector('.mp-back') as HTMLButtonElement).click());
    expectSearchFocus();
    act(() => (document.querySelector('[aria-label="Select Example model"]') as HTMLElement).click());
    expect(document.activeElement).toBe(trigger);
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
  } finally { focus.mockRestore(); }
});

it("changes thinking, adaptive, toggle and choice options from the keyboard without closing the picker", () => {
  const model: ModelDef = { id: "example", name: "Example model", kind: "openai", options: [
    { key: "thinking", label: "Thinking", type: "select", value: "adaptive", values: ["disabled", "adaptive", "enabled"] },
    { key: "cache", label: "Cache", type: "toggle", value: "false" },
    { key: "effort", label: "Effort", type: "select", value: "low", values: ["low", "high"] },
  ] };
  act(() => root.render(<Composer {...props} modelList={[model]} />));
  const trigger = container.querySelector('[aria-label="Choose model"]') as HTMLElement;
  key(trigger, "Enter");
  act(() => (document.querySelector('[title="Edit options"]') as HTMLButtonElement).click());
  for (const [label, optionKey, value] of [["Thinking", "thinking", "disabled"], ["Adaptive thinking", "thinking", "enabled"], ["Cache", "cache", "true"], ["Effort: High", "effort", "high"]]) {
    const control = document.querySelector(`[aria-label="${label}"]`) as HTMLElement;
    expect(control.tabIndex).toBe(0);
    key(control, " ");
    const calls = props.onSaveModelOptions.mock.calls as unknown as Array<[string, ModelDef["options"]]>;
    expect(calls[calls.length - 1][1].find(option => option.key === optionKey)?.value).toBe(value);
    expect(document.querySelector('.model-picker')).not.toBeNull();
  }
  key(document.querySelector('[aria-label="Cache"]') as HTMLElement, "Escape");
  expect(document.querySelector('.model-picker')).toBeNull(); expect(document.activeElement).toBe(trigger);
});

it("shows context usage separately from the compact model label and opens it with keyboard focus", () => {
  const model: ModelDef = { id: "example", name: "Example model", kind: "openai", options: [
    { key: "reasoning_effort", label: "Reasoning effort", type: "select", value: "high", values: ["low", "high"] },
    { key: "max_context", label: "Context budget", type: "select", value: "200k", values: ["200k"] },
  ] };
  act(() => root.render(<Composer {...props} modelList={[model]} selectedModel="example" usedTokens={50000} />));
  const modelTrigger = container.querySelector('.model-select')!;
  expect(modelTrigger.closest('.right')).not.toBeNull();
  expect(modelTrigger.textContent).toContain("High");
  expect(modelTrigger.textContent).not.toContain("200k");
  const context = container.querySelector('.ctx-ring') as HTMLButtonElement;
  act(() => context.focus());
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("25% used (75% left)");
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("50k / 200k tokens used");
  key(context, "Escape");
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
});

it("saves Speed choices with their cost hint and shows Fast in the compact model label", () => {
  const description = "Fast processing uses extra credits or higher API rates. Availability depends on your account and provider.";
  const initialModel: ModelDef = { id: "example", name: "Example model", kind: "openai", options: [
    { key: "reasoning_effort", label: "Reasoning effort", type: "select", value: "high", values: ["low", "high"] },
    { key: "speed", label: "Speed", type: "select", value: "standard", values: ["standard", "fast"], description },
  ] };
  function Fixture() {
    const [model, setModel] = React.useState(initialModel);
    return <Composer {...props} modelList={[model]} selectedModel={model.id} onSaveModelOptions={(id, options) => {
      props.onSaveModelOptions(id, options);
      setModel(previous => ({ ...previous, options }));
    }} />;
  }
  act(() => root.render(<Fixture />));
  const trigger = container.querySelector('[aria-label="Choose model"]') as HTMLElement;
  expect(trigger.textContent).toContain("High");
  expect(trigger.textContent).not.toContain("Standard");
  expect(trigger.textContent).not.toContain("Fast");
  key(trigger, "Enter");
  act(() => (document.querySelector('[title="Edit options"]') as HTMLButtonElement).click());
  const fast = document.querySelector('[aria-label="Speed: Fast"]') as HTMLElement;
  const standard = document.querySelector('[aria-label="Speed: Standard"]') as HTMLElement;
  expect(standard.getAttribute("aria-pressed")).toBe("true");
  expect(fast.getAttribute("aria-pressed")).toBe("false");
  expect(document.getElementById(fast.getAttribute("aria-describedby")!)?.textContent).toBe(description);
  key(fast, " ");
  expect(props.onSaveModelOptions).toHaveBeenLastCalledWith("example", [initialModel.options[0], { ...initialModel.options[1], value: "fast" }]);
  expect(fast.getAttribute("aria-pressed")).toBe("true");
  expect(trigger.textContent).toContain("High · Fast");
  expect(document.querySelector('.model-picker')).not.toBeNull();
  key(standard, "Enter");
  expect(props.onSaveModelOptions).toHaveBeenLastCalledWith("example", initialModel.options);
  expect(trigger.textContent).not.toContain("Fast");
  expect(trigger.textContent).not.toContain("Standard");
  expect(submit).not.toHaveBeenCalled();
});

it("only exposes Speed for models whose supplied options include it", () => {
  const model: ModelDef = { id: "example", name: "Example model", kind: "openai", options: [
    { key: "reasoning_effort", label: "Reasoning effort", type: "select", value: "high", values: ["low", "high"] },
  ] };
  act(() => root.render(<Composer {...props} modelList={[model]} selectedModel="example" />));
  const trigger = container.querySelector('[aria-label="Choose model"]') as HTMLElement;
  expect(trigger.textContent).toContain("High");
  key(trigger, "Enter");
  act(() => (document.querySelector('[title="Edit options"]') as HTMLButtonElement).click());
  expect(document.querySelector('[aria-label="Reasoning effort: High"]')?.getAttribute("aria-pressed")).toBe("true");
  expect(document.querySelector('[aria-label="Speed: Fast"]')).toBeNull();
  expect(document.querySelector('.mo-description')).toBeNull();
  expect(props.onSaveModelOptions).not.toHaveBeenCalled();
});

it("keeps the model picker available in edit composers without approval controls", () => {
  act(() => root.render(<Composer {...props} editing initialText="Edit this" />));
  expect(container.querySelector('.composer-approval-trigger')).toBeNull();
  expect(container.querySelector('[aria-label="Choose model"]')).not.toBeNull();
});

it("navigates chat modes with arrows, Home/End and typeahead, then restores focus without scrolling", () => {
  act(() => root.render(<Composer {...props} />));
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Choose mode"]')!;
  const focus = vi.spyOn(HTMLElement.prototype, "focus");
  try {
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.type).toBe("button");
    key(trigger, "ArrowDown");
    const menu = document.querySelector('[role="menu"][aria-label="Chat mode"]')!;
    expect(menu.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.textContent).toBe("Agent");
    expect(document.activeElement?.getAttribute("aria-checked")).toBe("true");
    key(document.activeElement as HTMLElement, "ArrowDown");
    expect(document.activeElement?.textContent).toBe("Plan");
    key(document.activeElement as HTMLElement, "End");
    expect(document.activeElement?.textContent).toBe("Ask");
    key(document.activeElement as HTMLElement, "ArrowDown");
    expect(document.activeElement?.textContent).toBe("Agent");
    key(document.activeElement as HTMLElement, "p");
    expect(document.activeElement?.textContent).toBe("Plan");
    key(document.activeElement as HTMLElement, "Home");
    expect(document.activeElement?.textContent).toBe("Agent");
    key(document.activeElement as HTMLElement, "Enter");
    expect(props.onMode).toHaveBeenCalledWith("agent");
    expect(document.querySelector('.mode-dropdown')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    key(trigger, " ");
    key(document.activeElement as HTMLElement, "Escape");
    expect(document.querySelector('.mode-dropdown')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(submit).not.toHaveBeenCalled();
  } finally { focus.mockRestore(); }
});

it("supports keyboard multi-select teams and preserves the open menu after each toggle", () => {
  const onTeams = vi.fn();
  const teams = [
    { id: "build", name: "Build", description: "", members: ["Builder"] },
    { id: "review", name: "Review", description: "", members: ["Reviewer"] },
  ];
  function Fixture() {
    const [selected, setSelected] = React.useState(["build"]);
    return <Composer {...props} mode="project" teams={teams} activeTeamIds={selected} onTeams={ids => { setSelected(ids); onTeams(ids); }} />;
  }
  act(() => root.render(<Fixture />));
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Choose teams"]')!;
  expect(trigger.tagName).toBe("BUTTON");
  key(trigger, "Enter");
  expect(document.activeElement?.getAttribute("role")).toBe("menuitemcheckbox");
  expect(document.activeElement?.getAttribute("aria-checked")).toBe("true");
  key(document.activeElement as HTMLElement, "ArrowDown");
  expect(document.activeElement?.textContent).toContain("Review");
  key(document.activeElement as HTMLElement, " ");
  expect(onTeams).toHaveBeenLastCalledWith(["build", "review"]);
  expect(document.activeElement?.getAttribute("aria-checked")).toBe("true");
  expect(document.querySelector('.team-dropdown')).not.toBeNull();
  expect(trigger.textContent).toBe("2 teams");
  key(document.activeElement as HTMLElement, "Home");
  key(document.activeElement as HTMLElement, "Enter");
  expect(onTeams).toHaveBeenLastCalledWith(["review"]);
  expect(document.activeElement?.getAttribute("aria-checked")).toBe("false");
  key(document.activeElement as HTMLElement, "Escape");
  expect(document.querySelector('.team-dropdown')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(submit).not.toHaveBeenCalled();
});

it("keeps team focus valid when teams disappear and lets Tab leave an empty menu", () => {
  const teams = [
    { id: "build", name: "Build", description: "", members: [] },
    { id: "review", name: "Review", description: "", members: [] },
  ];
  act(() => root.render(<Composer {...props} mode="project" teams={teams} />));
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Choose teams"]')!;
  key(trigger, "End");
  expect(document.activeElement?.textContent).toContain("Review");
  act(() => root.render(<Composer {...props} mode="project" teams={teams.slice(0, 1)} />));
  expect(document.activeElement?.textContent).toContain("Build");
  act(() => root.render(<Composer {...props} mode="project" teams={[]} />));
  expect(document.activeElement).toBe(trigger);
  expect(document.querySelector('.team-dropdown')?.textContent).toBe("No teams configured");
  key(trigger, "Escape");
  expect(document.querySelector('.team-dropdown')).toBeNull();
  key(trigger, "Enter");
  expect(key(trigger, "Tab").defaultPrevented).toBe(false);
  expect(document.querySelector('.team-dropdown')).toBeNull();
});

it.each(['mode', 'teams'] as const)("retains the closing %s menu without accepting actions and supports immediate reopening", picker => {
  setMotionPreference("full");
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const onTeams = vi.fn();
  act(() => root.render(<Composer {...props} mode="project" teams={[{ id: 'build', name: 'Build', description: '', members: [] }]} onTeams={onTeams} />));
  const trigger = container.querySelector<HTMLButtonElement>(picker === 'mode' ? '[aria-label="Choose mode"]' : '[aria-label="Choose teams"]')!;
  const selector = picker === 'mode' ? '.mode-dropdown:not(.team-dropdown)' : '.team-dropdown';
  key(trigger, 'Enter');
  const menu = document.querySelector<HTMLElement>(selector)!;
  const item = menu.querySelector<HTMLElement>('[role^="menuitem"]')!;
  expect(menu.dataset.state).toBe('open');
  expect(menu.dataset.side).toBe('bottom');
  key(item, 'Escape');
  expect(menu.dataset.state).toBe('closing');
  expect(menu.hasAttribute('inert')).toBe(true);
  expect(menu.getAttribute('aria-hidden')).toBe('true');
  expect(menu.style.pointerEvents).toBe('none');
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger);
  act(() => item.click());
  expect(props.onMode).not.toHaveBeenCalled();
  expect(onTeams).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(60));
  key(trigger, 'Enter');
  expect(document.querySelector(selector)).toBe(menu);
  expect(menu.hasAttribute('inert')).toBe(false);
  expect(menu.dataset.state).toBe('open');
  act(() => vi.advanceTimersByTime(120));
  expect(document.querySelector(selector)).toBe(menu);
  key(document.activeElement as HTMLElement, 'Escape');
  act(() => vi.advanceTimersByTime(120));
  expect(document.querySelector(selector)).toBeNull();
});

it("preserves the model options view during exit and blocks hidden actions", () => {
  setMotionPreference("full");
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const model: ModelDef = { id: 'example', name: 'Example model', kind: 'openai', options: [{ key: 'effort', label: 'Effort', type: 'select', value: 'low', values: ['low', 'high'] }] };
  act(() => root.render(<Composer {...props} modelList={[model]} />));
  const trigger = container.querySelector<HTMLElement>('[aria-label="Choose model"]')!;
  key(trigger, 'Enter');
  const menu = document.querySelector<HTMLElement>('.model-picker')!;
  act(() => menu.querySelector<HTMLButtonElement>('[title="Edit options"]')!.click());
  const body = menu.querySelector('.model-picker-view');
  const option = menu.querySelector<HTMLElement>('[aria-label="Effort: High"]')!;
  key(option, 'Escape');
  expect(menu.dataset.state).toBe('closing');
  expect(menu.hasAttribute('inert')).toBe(true);
  expect(menu.getAttribute('aria-hidden')).toBe('true');
  expect(menu.style.pointerEvents).toBe('none');
  expect(menu.querySelector('.model-picker-view')).toBe(body);
  expect(menu.querySelector('.mp-head-title')?.textContent).toBe('Example model');
  expect(document.activeElement).toBe(trigger);
  act(() => option.click());
  expect(props.onSaveModelOptions).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(120));
  expect(document.querySelector('.model-picker')).toBeNull();
  key(trigger, 'Enter');
  expect(document.querySelector('.mp-back')).toBeNull();
  expect(document.activeElement).toBe(document.querySelector('[placeholder="Search models"]'));
});

function pasteMarkdown(text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { items: [], getData: (type: string) => type === 'text/plain' ? text : '' } });
  act(() => { editor().focus(); editor().dispatchEvent(event); });
}
function caretAtEnd(element: Element) {
  act(() => {
    editor().focus();
    const range = document.createRange(); range.selectNodeContents(element); range.collapse(false);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
}

it.each([false, true])('renders Markdown directly in the composer (editing=%s) and sends its structure', editing => {
  const text = '# Heading\n\nA **strong** prompt\n\n- First\n- Second\n\n> Quote\n\n```\nconsole.log("test");\n```';
  act(() => root.render(<Composer {...props} editing initialText={text} />));
  expect(editor().querySelector('h1')?.textContent).toBe('Heading');
  expect(editor().querySelector('strong')?.textContent).toBe('strong');
  expect(editor().querySelectorAll('li')).toHaveLength(2);
  expect(editor().querySelector('blockquote')?.textContent).toBe('Quote');
  expect(editor().querySelector('pre code')?.textContent).toBe('console.log("test");');
  expect(editor().querySelector('.code-language-trigger')?.textContent).toContain('Auto (JavaScript)');
  act(() => container.querySelector<HTMLButtonElement>('.send-btn')!.click());
  const sent = submit.mock.calls[0][0];
  expect(sent).toContain('# Heading'); expect(sent).toContain('**strong**'); expect(sent).toContain('> Quote');
  expect(sent).toContain('```\nconsole.log("test");\n```');
});

it('pastes a complete Markdown prompt immediately and keeps Auto separate from an explicit language choice', () => {
  act(() => root.render(<Composer {...props} />));
  pasteMarkdown('# Task\n\n```\nconsole.log("test");\n```');
  expect(editor().querySelector('h1')?.textContent).toBe('Task');
  expect(vscode.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'resolvePastedCode' }));
  const trigger = editor().querySelector<HTMLButtonElement>('.code-language-trigger')!;
  act(() => trigger.click());
  const plain = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(el => el.textContent === 'Plain text')!;
  act(() => plain.click());
  expect(trigger.textContent).toBe('Plain text');
  expect(lastDraft().text).toContain('```plaintext\n');
  key(editor(), 'z', { ctrlKey: true });
  expect(trigger.textContent).toContain('Auto (JavaScript)');
  expect(lastDraft().text).toContain('```\n');
});

it('inserts literal content inside a code block and keeps Enter from sending', () => {
  act(() => root.render(<Composer {...props} initialText={'```\nconsole.log("test");\n```'} />));
  caretAtEnd(editor().querySelector('pre code')!);
  pasteMarkdown('\n# still code\nhttps://example.com');
  expect(editor().querySelector('h1')).toBeNull();
  expect(editor().querySelector('.mention')).toBeNull();
  expect(editor().querySelector('pre code')?.textContent).toContain('# still code\nhttps://example.com');
  key(editor(), 'Enter');
  expect(submit).not.toHaveBeenCalled();
  expect(editor().querySelector('pre code')?.textContent).toMatch(/\n$/);
});

it.each([{ isComposing: true }, { keyCode: 229 }])('does not submit while IME composition confirms a character (%j)', modifiers => {
  act(() => root.render(<Composer {...props} initialText="مرحبا" />));
  key(editor(), 'Enter', modifiers);
  expect(submit).not.toHaveBeenCalled();
  expect(editor().querySelector('p')?.getAttribute('dir')).toBe('auto');
});

it.each([{}, { ctrlKey: true }, { metaKey: true }])('sends prose exactly once with Enter (%j)', modifiers => {
  act(() => root.render(<Composer {...props} initialText="Send this request" />));
  expect(key(editor(), 'Enter', modifiers).defaultPrevented).toBe(true);
  expect(submit).toHaveBeenCalledTimes(1);
  expect(submit).toHaveBeenCalledWith('Send this request', []);
  expect(editor().textContent).toBe('');
});

it.each([{ ctrlKey: true }, { metaKey: true }])('respects the modified-Enter preference (%j)', modifiers => {
  act(() => root.render(<Composer {...props} initialText="First line" submitWithCtrlEnter />));
  caretAtEnd(editor().querySelector('p')!);
  key(editor(), 'Enter');
  expect(submit).not.toHaveBeenCalled();
  expect(editor().querySelectorAll('p')).toHaveLength(2);
  key(editor(), 'Enter', modifiers);
  expect(submit).toHaveBeenCalledTimes(1);
  expect(submit).toHaveBeenCalledWith('First line', []);
});

it('sends from a code block when modified-Enter submission is configured', () => {
  act(() => root.render(<Composer {...props} initialText={'```js\nconsole.log("test");\n```'} submitWithCtrlEnter />));
  caretAtEnd(editor().querySelector('pre code')!);
  key(editor(), 'Enter', { ctrlKey: true });
  expect(submit).toHaveBeenCalledTimes(1);
  expect(submit.mock.calls[0][0]).toContain('console.log("test");');
});

it('keeps Shift+Enter for newlines without sending', () => {
  act(() => root.render(<Composer {...props} initialText="First line" />));
  caretAtEnd(editor().querySelector('p')!);
  key(editor(), 'Enter', { shiftKey: true });
  expect(submit).not.toHaveBeenCalled();
  expect(editor().querySelectorAll('p')).toHaveLength(2);
});

it('uses the latest submit handler when a follow-up is queued during a run', () => {
  const queue = vi.fn();
  act(() => root.render(<Composer {...props} initialText="Follow up" />));
  act(() => root.render(<Composer {...props} initialText="Follow up" isRunning onSubmit={queue} />));
  key(editor(), 'Enter');
  expect(queue).toHaveBeenCalledTimes(1);
  expect(queue).toHaveBeenCalledWith('Follow up', []);
  expect(submit).not.toHaveBeenCalled();
  expect(props.onCancel).not.toHaveBeenCalled();
});

it('runs the next queued request on Enter with an empty composer', () => {
  const next = vi.fn();
  act(() => root.render(<Composer {...props} queuedCount={1} onRunNextQueued={next} />));
  key(editor(), 'Enter');
  expect(next).toHaveBeenCalledTimes(1);
  expect(submit).not.toHaveBeenCalled();
});

it.each([false, true])('hides the placeholder for an empty code block without enabling an empty send (editing=%s)', editing => {
  act(() => root.render(<Composer {...props} editing initialText={'```\n\n```'} />));
  expect(editor().querySelector('.composer-code-block')).not.toBeNull();
  expect(editor().classList.contains('empty')).toBe(false);
  expect(container.querySelector<HTMLButtonElement>('.send-btn')!.disabled).toBe(true);
});

it('restores the placeholder only when all document structure is removed', () => {
  act(() => root.render(<Composer {...props} />));
  expect(editor().classList.contains('empty')).toBe(true);
  pasteMarkdown('```\n\n```');
  expect(editor().classList.contains('empty')).toBe(false);
  key(editor(), 'z', { ctrlKey: true });
  expect(editor().classList.contains('empty')).toBe(true);
  key(editor(), 'z', { ctrlKey: true, shiftKey: true });
  expect(editor().classList.contains('empty')).toBe(false);
});

it.each(['##', '>', '- ', '---'])('hides the placeholder for empty Markdown structure: %s', initialText => {
  act(() => root.render(<Composer {...props} initialText={initialText} />));
  expect(editor().classList.contains('empty')).toBe(false);
});

it('hides the placeholder while an attachment is present and restores it after removal', () => {
  const image = { id: 'image', name: 'diagram.png', mime: 'image/png', kind: 'image' as const, data: 'data:image/png;base64,a' };
  act(() => root.render(<Composer {...props} initialAttachments={[image]} />));
  expect(editor().classList.contains('empty')).toBe(false);
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Remove diagram.png"]')!.click());
  expect(editor().classList.contains('empty')).toBe(true);
});

const restoredMarkdown = '# Saved prompt\n\n**Keep formatting**\n\n```\nconsole.log("restored");\n```';
function expectRestoredMarkdown() {
  expect(editor().querySelector('h1')?.textContent).toBe('Saved prompt');
  expect(editor().querySelector('strong')?.textContent).toBe('Keep formatting');
  expect(editor().querySelector('pre code')?.textContent).toBe('console.log("restored");');
  expect(editor().querySelector('.code-language-trigger')?.textContent).toBe('Auto (JavaScript)');
  expect(editor().classList.contains('empty')).toBe(false);
}

it.each([false, true])('renders a saved Markdown draft without typing (delayed=%s)', delayed => {
  const attachment = { id: 'saved-file', name: 'notes.txt', mime: 'text/plain', kind: 'text' as const, data: 'Saved notes' };
  const saved = { text: restoredMarkdown, attachments: [attachment] };
  if (delayed) act(() => root.render(<Composer {...props} focusKey="new" />));
  act(() => root.render(<Composer {...props} focusKey="new" tabDraft={saved} />));
  expectRestoredMarkdown();
  expect(container.querySelector('.attach-chip')?.getAttribute('title')).toBe('notes.txt');
  expect(lastDraft().text).toContain('# Saved prompt');
  expect(lastDraft().attachments).toEqual([attachment]);
});

it('keeps the caret, editable nodes, and undo when the parent echoes the current Markdown draft', () => {
  act(() => root.render(<Composer {...props} focusKey="new" />));
  pasteMarkdown(restoredMarkdown);
  const heading = editor().querySelector('h1')!;
  caretAtEnd(heading);
  const selection = window.getSelection()!;
  const anchor = selection.anchorNode, offset = selection.anchorOffset;
  const saved = structuredClone(lastDraft());
  act(() => root.render(<Composer {...props} focusKey="new" tabDraft={saved} />));
  expect(editor().querySelector('h1')).toBe(heading);
  expect(selection.anchorNode).toBe(anchor); expect(selection.anchorOffset).toBe(offset);
  key(editor(), 'z', { ctrlKey: true });
  expect(editor().querySelector('h1')).toBeNull();
  expect(editor().classList.contains('empty')).toBe(true);
});

it('restores different drafts and clears a missing draft while staying on the same chat', () => {
  act(() => root.render(<Composer {...props} focusKey="same" tabDraft={{ text: restoredMarkdown, attachments: [] }} />));
  expectRestoredMarkdown();
  act(() => root.render(<Composer {...props} focusKey="same" tabDraft={{ text: '## Other saved draft', attachments: [] }} />));
  expect(editor().querySelector('h2')?.textContent).toBe('Other saved draft');
  act(() => root.render(<Composer {...props} focusKey="same" tabDraft={null} />));
  expect(editor().classList.contains('empty')).toBe(true);
});
