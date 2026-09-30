/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor, AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { SubagentsPanel } from "./SubagentsPanel";
import { EMPTY_FEATURES, type FeatureConfig } from "../features";
import { BUILTIN_TEAM_SUBAGENTS } from "../../../src/agent/teams";

let root: Root, container: HTMLDivElement;
const save = vi.fn();
const preset = BUILTIN_TEAM_SUBAGENTS[0];
function Harness() {
  const [features, setFeatures] = React.useState<FeatureConfig>({ ...EMPTY_FEATURES,
    subagents: [{ ...preset }, { ...preset, id: "custom", name: "Custom agent", builtin: false }],
    teams: [{ id: "test-team", name: "Team", description: "Team", subagentIds: [preset.id, "custom"] }],
  });
  return <SubagentsPanel features={features} setFeatures={patch => { save(patch); setFeatures(current => ({ ...current, ...patch })); }} models={[]} />;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  save.mockClear();
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<Harness />));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const rows = () => [...container.querySelectorAll<HTMLTableRowElement>('[aria-label="Subagents"] tbody tr')];
const click = (element: Element | null) => { expect(element).not.toBeNull(); act(() => (element as HTMLElement).click()); };
function setField(field: HTMLInputElement | HTMLTextAreaElement, text: string) {
  act(() => {
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("edits built-ins in place, resets them, and never offers deletion", () => {
  expect(rows()[0].querySelector('[title="Delete subagent"]')).toBeNull();
  click(rows()[0].querySelector('[title="Edit subagent"]'));
  const dialog = document.querySelector('[role="dialog"]')!;
  setField(dialog.querySelector('input')!, "Updated specialist");
  setField(dialog.querySelector('textarea')!, "Updated instructions");
  click([...dialog.querySelectorAll('button')].find(button => button.textContent === "Save Changes")!);
  expect(save.mock.calls[save.mock.calls.length - 1][0].subagents).toHaveLength(2);
  expect(save.mock.calls[save.mock.calls.length - 1][0].subagents[0]).toMatchObject({ id: preset.id, builtin: true, name: "Updated specialist", prompt: "Updated instructions" });
  expect(rows()[0].textContent).toContain("Updated specialist");
  expect(rows()[0].querySelector('[title="Delete subagent"]')).toBeNull();
  click(rows()[0].querySelector('[title="Reset subagent to defaults"]'));
  expect(save.mock.calls[save.mock.calls.length - 1][0].subagents[0]).toEqual(preset);
  expect(rows()[0].textContent).toContain(preset.name);
});

it("still deletes custom agents and removes only their team membership", () => {
  click(rows()[1].querySelector('[title="Delete subagent"]'));
  const dialog = document.querySelector('[role="dialog"]')!;
  click([...dialog.querySelectorAll('button')].find(button => button.textContent === "Delete")!);
  expect(save.mock.calls[save.mock.calls.length - 1][0].subagents).toEqual([preset]);
  expect(save.mock.calls[save.mock.calls.length - 1][0].teams[0].subagentIds).toEqual([preset.id]);
});
