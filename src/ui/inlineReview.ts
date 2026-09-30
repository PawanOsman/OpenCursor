/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as vscode from "vscode";
import { computeHunks, pendingChanges, type ChangeScope, type PendingChange } from "../stores/pendingChanges";
import { safePath } from "../context/workspaceUtils";
import { createHash } from "node:crypto";

const SCHEME = "ocursor-inline-original";
const ORIGINALS = new Map<string, string>();
const originalsChanged = new vscode.EventEmitter<vscode.Uri>();

interface DiffEntry { path: string; scope?: ChangeScope; snapshotId?: string }
function snapshotId(change: PendingChange): string {
  return createHash("sha256").update(JSON.stringify([change.before, change.after, change.owner])).digest("hex");
}
function beforeUriFor(entry: DiffEntry, side = "before"): vscode.Uri {
  // Build via `from` rather than `parse`: a path like `/workspace/lib/a.ts`
  // would otherwise be parsed as an authority ("//workspace").
  const p = entry.path.replace(/\\/g, "/");
  const query = new URLSearchParams({ side, ...(entry.scope ? { conversation: entry.scope.conversationId, snapshot: entry.snapshotId! } : { overview: "all-pending" }) }).toString();
  return vscode.Uri.from({ scheme: SCHEME, path: p.startsWith("/") ? p : `/${p}`, query });
}

function fileUriFor(relPath: string): vscode.Uri | undefined {
  try {
    return vscode.Uri.file(safePath(relPath));
  } catch {
    return undefined;
  }
}

/**
 * VS Code's own diff editor is the only way to get real full-width
 * inserted/deleted rows — the extension API has no view-zone/line-widget
 * capability, so decorations can never add rows to a document. Forcing
 * `renderSideBySide: false` turns it into the single-column inline diff.
 */
const INLINE_SETTINGS: Record<string, boolean> = {
  renderSideBySide: false,
};
let settingApplied = false;
const previousValues = new Map<string, boolean | undefined>();

async function applyInlineDiffSetting() {
  if (settingApplied) return;
  settingApplied = true;
  const cfg = vscode.workspace.getConfiguration("diffEditor");
  for (const [key, value] of Object.entries(INLINE_SETTINGS)) {
    previousValues.set(key, cfg.inspect<boolean>(key)?.workspaceValue);
    if (cfg.get<boolean>(key) === value) continue;
    try {
      await cfg.update(key, value, vscode.ConfigurationTarget.Workspace);
    } catch {
      // No workspace to write to (single loose file) — the diff still opens, just unstyled.
    }
  }
}

async function restoreInlineDiffSetting() {
  if (!settingApplied) return;
  settingApplied = false;
  const cfg = vscode.workspace.getConfiguration("diffEditor");
  for (const [key, previous] of previousValues) {
    try {
      await cfg.update(key, previous, vscode.ConfigurationTarget.Workspace);
    } catch {
      // best-effort
    }
  }
  previousValues.clear();
}

/** Push the latest "before" text into an already-open diff without touching tabs. */
function changeForDiff(entry: DiffEntry) {
  return entry.scope ? pendingChanges.snapshots(entry.path, entry.scope).find(change => snapshotId(change) === entry.snapshotId) : pendingChanges.get(entry.path);
}
function refreshOriginal(entry: DiffEntry) {
  const change = changeForDiff(entry);
  if (!change) return false;
  const before = beforeUriFor(entry);
  ORIGINALS.set(before.toString(), change.before);
  originalsChanged.fire(before);
  if (entry.scope) {
    const after = beforeUriFor(entry, "after");
    ORIGINALS.set(after.toString(), change.after);
    originalsChanged.fire(after);
  }
  return true;
}

/** Open the inline diff for a tracked change. Only ever called from an explicit user action. */
async function showInlineDiff(relPath: string, preserveFocus = true, scope?: ChangeScope) {
  const fileUri = fileUriFor(relPath);
  if (!fileUri) return;
  const entry: DiffEntry = { path: fileUri.fsPath, scope: scope ? { ...scope } : undefined };
  let label = "all pending changes";
  if (scope) {
    const snapshots = pendingChanges.snapshots(entry.path, scope);
    if (!snapshots.length) return;
    const selected = snapshots.length === 1 ? { change: snapshots[0], index: 0 } : await vscode.window.showQuickPick(snapshots.map((change, index) => ({
      label: `Edit ${index + 1}`, description: `Chat ${scope.conversationId.slice(0, 8)}${change.owner?.turnIndex === undefined ? "" : ` · turn ${change.owner.turnIndex + 1}`}`,
      detail: change.owner?.runId ? `Run ${change.owner.runId}` : undefined, change, index,
    })), { placeHolder: "Choose this conversation's edit to review" });
    if (!selected) return;
    entry.snapshotId = snapshotId(selected.change);
    label = `chat ${scope.conversationId.slice(0, 8)} · edit ${selected.index + 1}${selected.change.owner?.turnIndex === undefined ? "" : ` · turn ${selected.change.owner.turnIndex + 1}`}`;
  }
  if (!refreshOriginal(entry)) return;
  const before = beforeUriFor(entry);
  await applyInlineDiffSetting();
  await vscode.commands.executeCommand(
    "vscode.diff",
    before,
    scope ? beforeUriFor(entry, "after") : fileUri,
    `${relPath.split(/[\\/]/).pop()} (${label})`,
    { preserveFocus, preview: false, viewColumn: vscode.ViewColumn.Active }
  );
  openDiffs.set(before.toString(), entry);
}

/** Close any inline-diff tab we opened for `relPath`. */
async function closeInlineDiff(entry: DiffEntry) {
  const target = beforeUriFor(entry).toString();
  const doomed: vscode.Tab[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (input instanceof vscode.TabInputTextDiff && input.original.toString() === target) doomed.push(tab);
    }
  }
  if (doomed.length) await vscode.window.tabGroups.close(doomed, true);
  ORIGINALS.delete(target);
  ORIGINALS.delete(beforeUriFor(entry, "after").toString());
}

/**
 * Changed-line highlight for when the file is opened as a normal editor rather
 * than through the inline diff (the diff editor draws its own colours).
 */
const addedDecoration = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: new vscode.ThemeColor("diffEditor.insertedLineBackground"),
  overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.addedForeground"),
  overviewRulerLane: vscode.OverviewRulerLane.Left,
  borderColor: new vscode.ThemeColor("diffEditor.insertedTextBorder"),
  borderWidth: "0 0 0 2px",
  borderStyle: "solid",
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});

/** Map an open editor to the pending change (if any) covering its document. */
function changeForEditor(editor: vscode.TextEditor) {
  const target = editor.document.uri.fsPath;
  for (const change of pendingChanges.list()) {
    const uri = fileUriFor(change.path);
    if (uri && uri.fsPath === target) return change;
  }
  return undefined;
}

function refreshEditor(editor: vscode.TextEditor) {
  const change = changeForEditor(editor);
  if (!change || change.previewOnly) {
    editor.setDecorations(addedDecoration, []);
    return;
  }
  // Diff against the live document text so highlights stay correct if the user
  // keeps typing after the agent's edit.
  const hunks = computeHunks(change.before, editor.document.getText());
  const lastLine = Math.max(editor.document.lineCount - 1, 0);
  const added: vscode.Range[] = [];
  for (const h of hunks) {
    if (!h.afterLines.length) continue;
    const start = Math.min(h.startLine, lastLine);
    const end = Math.min(h.endLine, lastLine);
    added.push(new vscode.Range(start, 0, end, editor.document.lineAt(end).text.length));
  }
  editor.setDecorations(addedDecoration, added);
}

let refreshTimer: NodeJS.Timeout | undefined;
/** Paths we currently have an inline-diff tab open for. */
const openDiffs = new Map<string, DiffEntry>();

/**
 * Never opens or focuses anything. Agent edits only refresh the content of
 * diffs the user opened themselves, close ones whose change is gone, and
 * repaint changed-line highlights in already-visible editors.
 */
async function sync() {
  const live = new Set(pendingChanges.list().map((c) => c.path));

  for (const [key, entry] of [...openDiffs]) {
    if (!changeForDiff(entry)) {
      openDiffs.delete(key);
      await closeInlineDiff(entry);
    } else {
      // Update the virtual "before" document in place — no vscode.diff call,
      // so an edit can never pull the editor onto a diff tab.
      refreshOriginal(entry);
    }
  }
  if (!live.size) await restoreInlineDiffSetting();

  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document.uri.scheme === "file") refreshEditor(editor);
  }
}

function scheduleSync() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void sync(), 80);
}

/** Register the inline diff view, its virtual original-content provider, and highlights. */
export function registerInlineReview(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
      onDidChange: originalsChanged.event,
      provideTextDocumentContent: (uri) => ORIGINALS.get(uri.toString()) ?? "",
    }),
    vscode.commands.registerCommand("ocursor.viewDiff", async (path: string, scope?: ChangeScope) => {
      await showInlineDiff(path, false, scope);
    }),
    addedDecoration,
    originalsChanged,
    { dispose: () => refreshTimer && clearTimeout(refreshTimer) },
    { dispose: () => void restoreInlineDiffSetting() },
    { dispose: pendingChanges.onChange(scheduleSync) },
    vscode.window.onDidChangeVisibleTextEditors(() => {
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.uri.scheme === "file") refreshEditor(editor);
      }
    }),
    // Typing only refreshes highlights — re-opening diff tabs on every keystroke
    // would thrash the editor.
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.scheme !== "file") return;
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document === e.document) scheduleSync();
      }
    })
  );
  scheduleSync();
}
