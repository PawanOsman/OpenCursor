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
import { registerGitSync } from './integrations/gitSync';
import { SettingsPanel } from './ui/settingsPanel';
import { FeatureStore } from './stores/featureStore';
import { setToolTimeoutOverrides } from './agent/tools/shared';
import { mcpManager } from './integrations/mcpClient';
import { configureMcpAuthentication } from './integrations/mcpHost';
import { setIndexStorageDir } from './agent/semanticIndex';
import { setDocsStorageDir, setDocSourcesProvider } from './agent/docsIndex';
import { initIndexWatch } from './agent/indexWatch';
import { initLlamacpp, checkInstalled, loadModel, disposeLlamacpp } from './agent/llamacpp';
import { initOAuth } from './agent/oauth';
import { initUsage } from './stores/usageStore';
import { initModelRegistry, applyEmbedModel } from './stores/modelRegistry';
import { initRuntimeDeps } from './runtimeDeps';
import { initLog, logError } from './logging';
import { setOllamaHost } from './agent/ollama';
import { pendingChanges } from './stores/pendingChanges';
import { configureFileMutationStorage } from './stores/fileMutations';
import { workspaceStorageDirectory } from './ui/sidebar/storage';
import * as path from 'node:path';
import { registerPluginManagement } from './ui/pluginCommands';
import { registerRemoteJobs } from './ui/remoteCommands';
import { initHookConsent } from './integrations/hookConsent';

let activeSidebar: SidebarProvider | undefined;

export async function activate(context: vscode.ExtensionContext) {
  registerRemoteJobs(context);
  initHookConsent(context);
  const log = initLog(context);
  log.appendLine(`[${new Date().toISOString()}] OpenCursor activated`);

  // Heavy native deps (onnxruntime, sharp, transformers) are not shipped in the
  // VSIX; they are downloaded to globalStorage on first use.
  initRuntimeDeps(context.globalStorageUri.fsPath);
  // Storage problems must never prevent the chat view and commands from registering.
  try {
    const durableStorage = workspaceStorageDirectory(context);
    if (!durableStorage) throw new Error('No extension storage location is available.');
    await configureFileMutationStorage(path.join(durableStorage, 'mutations'));
    const recovery = await pendingChanges.initialize(path.join(durableStorage, 'mutations'));
    if (recovery.error) {
      logError('startup.pending-edits', new Error(recovery.error), { quarantined: recovery.quarantined });
      void vscode.window.showWarningMessage(recovery.quarantined
        ? `OpenCursor: the pending-edit review journal was unreadable and has been moved to ${recovery.quarantined}. Earlier agent edits can no longer be undone from the review bar; your files were not changed.`
        : `OpenCursor: the pending-edit review journal could not be loaded (${recovery.error}).`);
    }
  } catch (error) {
    logError('startup.storage', error);
    void vscode.window.showWarningMessage(`OpenCursor: edit review storage is unavailable (${error instanceof Error ? error.message : String(error)}). Agent edits will not be tracked for undo in this session.`);
  }

  const settingsManager = new SettingsManager(context);
  const featureStore = new FeatureStore(context);
  const syncToolTimeouts = () => setToolTimeoutOverrides(featureStore.get().toolTimeoutsSec);
  syncToolTimeouts();
  context.subscriptions.push(featureStore.onDidChange(syncToolTimeouts));
  initOAuth(context);
  initUsage(context);
  setOllamaHost(context.globalState.get<string>('ocursor.ollamaEndpoint', 'http://localhost:11434'));
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
  configureMcpAuthentication(context);
  await registerPluginManagement(context, featureStore).catch((error) => logError("startup.plugins", error));
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
  activeSidebar = sidebarProvider;
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebarProvider, {
      // Keep the chat webview (and any in-flight agent run's UI state) alive when
      // hidden/collapsed or switched away, so reopening never resets to a blank chat.
      webviewOptions: { retainContextWhenHidden: true },
    })

  );

  // Inline diff view for agent edits + changed-line decorations (no git needed).
  registerInlineReview(context);

  // Committing in git counts as "keep" — clear those pending reviews.
  registerGitSync(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('ocursor.openSettings', (section?: string) => {
      SettingsPanel.createOrShow(context, settingsManager, featureStore, section);
    })
  );

  // Ctrl+L: add the current selection (or file) to chat as a mention.
  const todoLensesChanged = new vscode.EventEmitter<void>();
  context.subscriptions.push(
    vscode.commands.registerCommand('ocursor.addToChat', () => sidebarProvider.addSelectionToChat()),
    vscode.commands.registerCommand('ocursor.newChat', () => sidebarProvider.newChat()),
    vscode.commands.registerCommand('ocursor.reviewChanges', () => sidebarProvider.startReview()),
    vscode.commands.registerCommand('ocursor.implementTodo', (uri?: vscode.Uri, line?: number) => sidebarProvider.implementTodo(uri, line)),
    todoLensesChanged,
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('ocursor.todoCodeLensEnabled')) todoLensesChanged.fire();
    }),
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, {
      onDidChangeCodeLenses: todoLensesChanged.event,
      provideCodeLenses(document, token) {
        if (!vscode.workspace.getConfiguration('ocursor').get<boolean>('todoCodeLensEnabled', true)) return [];
        const lenses: vscode.CodeLens[] = [];
        for (let line = 0; line < Math.min(document.lineCount, 20_000) && !token.isCancellationRequested; line++) {
          if (!/(?:\/\/|#|\/\*|\*|<!--)\s*TODO\b/.test(document.lineAt(line).text)) continue;
          lenses.push(new vscode.CodeLens(new vscode.Range(line, 0, line, 0), { title: 'Implement with OpenCursor', command: 'ocursor.implementTodo', arguments: [document.uri, line] }));
        }
        return lenses;
      },
    })
  );

  context.subscriptions.push({ dispose: () => mcpManager.disposeAll() });
  context.subscriptions.push({ dispose: () => disposeLlamacpp() });
}

export async function deactivate() {
  await activeSidebar?.dispose();
  activeSidebar = undefined;
  mcpManager.disposeAll();
  await disposeLlamacpp();
  await pendingChanges.flush();
}
