/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, expect, it, vi } from "vitest";
const host = vi.hoisted(() => ({ commands: new Map<string, (...args: any[]) => any>(), provider: undefined as any, tabs: [] as any[], close: vi.fn(async () => true), execute: vi.fn(async (..._args: any[]) => undefined), pick: vi.fn(async (items: any[]) => items.at(-1)) }));
vi.mock("vscode", () => {
  class Uri {
    constructor(readonly scheme: string, readonly path: string, readonly query = "") {}
    get fsPath() { return this.path; }
    toString() { return `${this.scheme}:${this.path}?${this.query}`; }
    static from(value: any) { return new Uri(value.scheme, value.path, value.query); }
    static file(value: string) { return new Uri("file", value); }
  }
  class EventEmitter { event = () => ({ dispose() {} }); fire() {} dispose() {} }
  class TabInputTextDiff { constructor(readonly original: Uri, readonly modified: Uri) {} }
  return { Uri, EventEmitter, TabInputTextDiff, ThemeColor: class {}, OverviewRulerLane: {}, DecorationRangeBehavior: {}, ViewColumn: {}, ConfigurationTarget: {},
    workspace: { textDocuments: [], workspaceFolders: [], getConfiguration: () => ({ inspect: () => ({}), get: () => false, update: async () => {} }), registerTextDocumentContentProvider: (_scheme: string, provider: any) => { host.provider = provider; return { dispose() {} }; }, onDidChangeTextDocument: () => ({ dispose() {} }) },
    commands: { registerCommand: (name: string, callback: any) => { host.commands.set(name, callback); return { dispose() {} }; }, executeCommand: host.execute },
    window: { visibleTextEditors: [], tabGroups: { all: [{ tabs: host.tabs }], close: host.close }, createTextEditorDecorationType: () => ({ dispose() {} }), onDidChangeVisibleTextEditors: () => ({ dispose() {} }), showQuickPick: host.pick },
  };
});
vi.mock("../context/workspaceUtils", () => ({ safePath: (value: string) => value }));
import * as vscode from "vscode";
import { pendingChanges } from "../stores/pendingChanges";
import { registerInlineReview } from "./inlineReview";

const subscriptions: Array<{ dispose(): unknown }> = [];
afterEach(() => { for (const subscription of subscriptions.splice(0)) subscription.dispose(); pendingChanges.acceptAll(); host.tabs.length = 0; host.execute.mockClear(); host.close.mockClear(); vi.useRealTimers(); });

it("isolates A/B/A snapshots and closes only the accepted conversation's native diff", async () => {
  vi.useFakeTimers();
  registerInlineReview({ subscriptions } as any);
  const file = "C:/fixture/provenance.txt", a = { conversationId: "chat-a", turnIndex: 0 }, b = { conversationId: "chat-b", turnIndex: 0 };
  pendingChanges.record(file, "start", "A1", true, a);
  pendingChanges.record(file, "A1", "A1\nB1", true, b);
  pendingChanges.record(file, "A1\nB1", "A2\nB1", true, { ...a, turnIndex: 2 });
  const snapshots = pendingChanges.snapshots(file, a);
  expect(snapshots.map(row => [row.before, row.after])).toEqual([["start", "A1"], ["A1\nB1", "A2\nB1"]]);
  snapshots[0].owner!.conversationId = "tampered";
  expect(pendingChanges.snapshots(file, a)).toHaveLength(2);
  await host.commands.get("ocursor.viewDiff")!(file, a);
  await host.commands.get("ocursor.viewDiff")!(file, b);
  const calls = host.execute.mock.calls;
  const aBefore = calls[0][1], aAfter = calls[0][2], bBefore = calls[1][1], bAfter = calls[1][2];
  expect(aBefore.toString()).not.toBe(bBefore.toString());
  expect(aAfter.scheme).toBe("ocursor-inline-original");
  expect(calls[0][3]).toContain("chat chat-a · edit 2 · turn 3");
  expect(host.provider.provideTextDocumentContent(aBefore)).toBe("A1\nB1");
  expect(host.provider.provideTextDocumentContent(aAfter)).toBe("A2\nB1");
  expect(host.provider.provideTextDocumentContent(bAfter)).toBe("A1\nB1");
  const aTab = { input: new vscode.TabInputTextDiff(aBefore, aAfter) }, bTab = { input: new vscode.TabInputTextDiff(bBefore, bAfter) };
  host.tabs.push(aTab, bTab);
  pendingChanges.accept(file, a);
  await vi.advanceTimersByTimeAsync(100);
  expect(host.close).toHaveBeenCalledWith([aTab], true);
  expect(pendingChanges.get(file, b)?.after).toBe("A1\nB1");
  expect(host.provider.provideTextDocumentContent(bAfter)).toBe("A1\nB1");
  expect(host.provider.provideTextDocumentContent(aAfter)).toBe("");
});

it("labels standalone file reviews as an aggregate and retains the live file document", async () => {
  vi.useFakeTimers(); registerInlineReview({ subscriptions } as any);
  const file = "C:/fixture/overview.txt";
  pendingChanges.record(file, "before", "after", true, { conversationId: "chat" });
  await host.commands.get("ocursor.viewDiff")!(file);
  const call = host.execute.mock.calls[0];
  expect(call[2].scheme).toBe("file");
  expect(call[3]).toContain("all pending changes");
  expect(host.provider.provideTextDocumentContent(call[1])).toBe("before");
});
