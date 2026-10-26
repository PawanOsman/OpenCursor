/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it } from "vitest";
import { restoreContext, saveContext, type ContextState } from "./contextState";
import type { Step } from "./types";

describe("saved working context", () => {
  const user = (text: string): Step => ({ kind: "user", text });
  const summary: Step = { kind: "user", synthetic: true, text: "Earlier decisions" };

  it("restores a serialized summary plus new work while preserving raw history", () => {
    const history = [user("Original request"), user("Detailed context"), user("Current request")];
    const original = structuredClone(history);
    const state: ContextState = {};
    saveContext(history, [summary, history[0], history[2]], state);
    history.push(user("New work"));
    const reloaded = JSON.parse(JSON.stringify(state)) as ContextState;
    expect(restoreContext(history, reloaded)).toEqual([summary, original[0], original[2], user("New work")]);
    expect(history.slice(0, 3)).toEqual(original);
  });

  it("discards checkpoints when covered history was edited or truncated", () => {
    for (const alter of [(history: Step[]) => history.pop(), (history: Step[]) => { history[0] = user("Edited request"); }]) {
      const history = [user("Original request"), user("Context")];
      const state: ContextState = {};
      saveContext(history, [summary], state);
      alter(history);
      expect(restoreContext(history, state)).toEqual(history);
      expect(state.checkpoint).toBeUndefined();
    }
  });

  it("replaces old snapshots without duplicating their tail", () => {
    const history = [user("Original request")];
    const state: ContextState = {};
    saveContext(history, [summary], state);
    history.push(user("More work"));
    const newer: Step = { ...summary, text: "Merged decisions" };
    saveContext(history, [newer, history[1]], state);
    expect(restoreContext(history, state)).toEqual([newer, history[1]]);
    expect(JSON.stringify(state)).not.toContain("Earlier decisions");
  });

  it("extends the checkpoint digest across appends and recomputes it after a replaced step", () => {
    const history = [user("Original request")];
    const state: ContextState = {};
    for (let i = 0; i < 5; i++) {
      history.push(user(`Step ${i}`));
      saveContext(history, [summary], state);
      // A serialized copy (fresh objects, no cache) must accept the incremental digest.
      expect(restoreContext(structuredClone(history), structuredClone(state))).toEqual([summary]);
    }
    history[1] = user("Edited step");
    saveContext(history, [summary], state);
    expect(restoreContext(structuredClone(history), structuredClone(state))).toEqual([summary]);
    history.splice(1, 1);
    saveContext(history, [summary], state);
    expect(restoreContext(structuredClone(history), structuredClone(state))).toEqual([summary]);
    const stale = structuredClone(state);
    history.push(user("Later"));
    history[0] = user("Changed origin");
    expect(restoreContext(history, stale)).toEqual(history);
  });
});
