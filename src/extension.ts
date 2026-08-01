/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as vscode from 'vscode';
import { SettingsManager } from './stores/settingsManager';
import { SidebarProvider } from './ui/sidebarProvider';
import { registerInlineReview } from './ui/inlineReview';
import { SettingsPanel } from './ui/settingsPanel';
import { FeatureStore } from './stores/featureStore';
import { setToolTimeoutOverrides } from './agent/tools/shared';
import { mcpManager } from './integrations/mcpClient';
import { setIndexStorageDir } from './agent/semanticIndex';
import { setDocsStorageDir, setDocSourcesProvider } from './agent/docsIndex';
import { initIndexWatch } from './agent/indexWatch';
import { initLlamacpp, checkInstalled, loadModel, disposeLlamacpp } from './agent/llamacpp';
import { initOAuth } from './agent/oauth';
import { initUsage } from './stores/usageStore';
import { initModelRegistry, applyEmbedModel } from './stores/modelRegistry';
import { initRuntimeDeps } from './runtimeDeps';
import { initLog, logError } from './logging';

import { IpcSocketServer } from './bridge/socketServer';

let ipcServer: IpcSocketServer | undefined;

export function activate(context: vscode.ExtensionContext) {
  const log = initLog(context);
  log.appendLine(`[${new Date().toISOString()}] OpenCursor activated`);

  // Heavy native deps (onnxruntime, sharp, transformers) are not shipped in the
  // VSIX; they are downloaded to globalStorage on first use.
  initRuntimeDeps(context.globalStorageUri.fsPath);

  const settingsManager = new SettingsManager(context);
  const featureStore = new FeatureStore(context);
  const syncToolTimeouts = () => setToolTimeoutOverrides(featureStore.get().toolTimeoutsSec);
  syncToolTimeouts();
  context.subscriptions.push(featureStore.onDidChange(syncToolTimeouts));
  initOAuth(context);
  initUsage(context);
  // Prefetch the provider-grouped model list so every UI (settings, pickers)
  // renders instantly from the backend cache.
  initModelRegistry(featureStore, settingsManager);

  // Local semantic index: vectors in globalStorage; warm disk + incremental sync.
  setIndexStorageDir(context.globalStorageUri.fsPath);
  setDocsStorageDir(context.globalStorageUri.fsPath);
  setDocSourcesProvider(() => featureStore.get().docSources ?? []);
  applyEmbedModel(featureStore.get().embedModel || "minilm")
    .catch((error) => logError("startup.embed-model", error))
    .finally(() => initIndexWatch(context, featureStore));

  // Connect any enabled MCP servers in the background.
  void mcpManager.sync(featureStore.get().mcpServers).catch((error) => logError("startup.mcp", error));

  // llama.cpp local models: detect install, then auto-load flagged models.
  initLlamacpp(context);
  void checkInstalled().then(() => {
    const f = featureStore.get();
    for (const m of f.llamacppModels) {
      if (m.autoLoad) void loadModel(m, f.llamacppConfig).catch((error) => logError("startup.llamacpp-load", error, { model: m.id }));
    }
  }).catch((error) => logError("startup.llamacpp-check", error));

  const sidebarProvider = new SidebarProvider(context, settingsManager, featureStore);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebarProvider, {
      // Keep the chat webview (and any in-flight agent run's UI state) alive when
      // hidden/collapsed or switched away, so reopening never resets to a blank chat.
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Start IPC server for CLI bridge
  try {
    ipcServer = new IpcSocketServer({
      onSubmitPrompt: (data) => sidebarProvider.postMessageToSession(data.prompt, data.mode, data.model),
      onResolveApproval: (_reqId, _approve) => {},
      onAnswerQuestion: (_callId, _answers) => {},
      onCancelRun: () => {},
    });
    ipcServer.start();
    context.subscriptions.push({ dispose: () => ipcServer?.stop() });
  } catch (e) {
    logError("startup.ipc-server", e);
  }

  // Inline diff view for agent edits + changed-line decorations (no git needed).
  registerInlineReview(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('ocursor.openSettings', (section?: string) => {
      SettingsPanel.createOrShow(context, settingsManager, featureStore, section);
    })
  );

  // Ctrl+L: add the current selection (or file) to chat as a mention.
  context.subscriptions.push(
    vscode.commands.registerCommand('ocursor.addToChat', () => sidebarProvider.addSelectionToChat())
  );

  context.subscriptions.push({ dispose: () => mcpManager.disposeAll() });
  context.subscriptions.push({ dispose: () => disposeLlamacpp() });
}

export function deactivate() {
  mcpManager.disposeAll();
  disposeLlamacpp();
  ipcServer?.stop();
}
