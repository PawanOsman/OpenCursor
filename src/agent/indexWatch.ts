/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// Debounced workspace file watcher → incremental semantic index updates.

import * as vscode from "vscode";
import * as path from "path";
import { applyFileChanges, buildIndex, setIndexingEnabled, warmIndex, isIndexingEnabled, getStatus } from "./semanticIndex";
import { getWorkspaceRoot } from "../context/workspaceUtils";
import { invalidateScanCache, IGNORE_POLICY_FILES } from "./tools/fileScan";
import type { FeatureStore } from "../stores/featureStore";
import { logError } from "../logging";

const DEBOUNCE_MS = 800;
/** Delay the activation build so it never competes with editor/extension startup. */
const STARTUP_BUILD_DELAY_MS = 8_000;
/** Creates/deletes only need the scan cache dropped once per burst. */
const SCAN_INVALIDATE_MS = 300;
const pending = new Map<string, "up" | "del">(); // abs path -> action
let timer: ReturnType<typeof setTimeout> | null = null;
let scanTimer: ReturnType<typeof setTimeout> | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;
let featureStore: FeatureStore | null = null;
let flushing = false;

function scheduleScanInvalidate(): void {
  if (scanTimer) return;
  scanTimer = setTimeout(() => {
    scanTimer = null;
    invalidateScanCache();
  }, SCAN_INVALIDATE_MS);
}

function scheduleFlush(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, DEBOUNCE_MS);
}

async function flush(): Promise<void> {
  if (flushing) {
    scheduleFlush();
    return;
  }
  if (!isIndexingEnabled()) {
    pending.clear();
    return;
  }
  const root = getWorkspaceRoot();
  if (!root || !pending.size) return;
  flushing = true;
  try {
    const batch = new Map(pending);
    pending.clear();
    const policies = [...batch].filter(([abs]) => IGNORE_POLICY_FILES.includes(path.basename(abs)));
    if (policies.length) {
      invalidateScanCache();
      if (getStatus(root).indexing) for (const [abs, action] of policies) pending.set(abs, action);
      else await buildIndex(root);
    }
    for (const [abs] of policies) batch.delete(abs);
    await applyFileChanges(root, batch);
  } catch (error) {
    logError("index.files", error, { root });
  } finally {
    flushing = false;
    if (pending.size) scheduleFlush();
  }
}

function onFs(uri: vscode.Uri, action: "up" | "del"): void {
  if (!isIndexingEnabled()) return;
  if (uri.scheme !== "file") return;
  const root = getWorkspaceRoot();
  if (!root) return;
  const abs = uri.fsPath;
  if (!abs.startsWith(root) && !abs.toLowerCase().startsWith(root.toLowerCase())) return;
  // Skip vendor/build/non-source (upsertFile also filters; early-out saves work).
  const rel = path.relative(root, abs).split(path.sep).join("/");
  if (!rel || rel.startsWith("..")) return;
  if (
    /(^|\/)(node_modules|\.git|dist|out|build|\.next|\.nuxt|\.output|\.turbo|\.cache|coverage|\.venv|venv|__pycache__|target|vendor|Pods|\.gradle|\.idea|\.vscode|bower_components|jspm_packages|\.pnpm-store|\.yarn|site-packages|\.terraform|\.svelte-kit|\.angular|storybook-static)(\/|$)/.test(
      rel,
    )
  ) {
    return;
  }
  pending.set(abs, action);
  scheduleFlush();
}

/** Wire indexing enable flag, warm disk index, incremental sync, file watcher. */
export function initIndexWatch(context: vscode.ExtensionContext, store: FeatureStore): void {
  featureStore = store;
  let lastEnabled = store.get().indexingEnabled !== false;
  setIndexingEnabled(lastEnabled);

  const root = getWorkspaceRoot();
  // Warm the persisted index right away (cheap, no embedding), but hold the
  // build back: loading ONNX during activation is what makes startup crawl.
  void warmIndex(root)
    .then(() => {
      if (!lastEnabled) return;
      startupTimer = setTimeout(() => {
        startupTimer = null;
        if (!isIndexingEnabled()) return;
        void buildIndex(root).catch((error) => logError("index.build", error, { root }));
      }, STARTUP_BUILD_DELAY_MS);
    })
    .catch((error) => logError("index.warm", error, { root }));

  const watcher = vscode.workspace.createFileSystemWatcher("**/*");
  context.subscriptions.push(
    watcher,
    // Creates/deletes change the file set, so the search scan cache must drop —
    // independent of whether semantic indexing is enabled. Coalesced because
    // installs and builds fire thousands of these.
    watcher.onDidCreate((u) => {
      scheduleScanInvalidate();
      onFs(u, "up");
    }),
    watcher.onDidChange((u) => onFs(u, "up")),
    watcher.onDidDelete((u) => {
      scheduleScanInvalidate();
      onFs(u, "del");
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => onFs(doc.uri, "up")),
    store.onDidChange(() => {
      const on = store.get().indexingEnabled !== false;
      if (on === lastEnabled) return;
      lastEnabled = on;
      setIndexingEnabled(on);
      if (on) {
        const root = getWorkspaceRoot();
        void buildIndex(root).catch((error) => logError("index.enable", error, { root }));
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      invalidateScanCache();
      if (!isIndexingEnabled()) return;
      const f = featureStore?.get();
      if (f && f.indexNewFolders === false) return;
      const r = getWorkspaceRoot();
      void warmIndex(r)
        .then(() => buildIndex(r))
        .catch((error) => logError("index.workspace-change", error, { root: r }));
    }),
    {
      dispose: () => {
        if (timer) clearTimeout(timer);
        if (scanTimer) clearTimeout(scanTimer);
        if (startupTimer) clearTimeout(startupTimer);
        timer = scanTimer = startupTimer = null;
        pending.clear();
      },
    },
  );
}
