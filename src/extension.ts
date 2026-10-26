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
import { setIndexStorageDir, setEmbedAccelerator } from './agent/semanticIndex';
import { listEmbedAccelerators } from './agent/embedAccelerators';
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

const TODO_COMMENT = /(?:\/\/|#|\/\*|\*|<!--)\s*TODO\b/;

/**
 * Zero-based lines below maxLines that hold a TODO comment. CodeLens runs on
 * every edit of every open file, so jump between "TODO" occurrences instead of
 * materialising and regex-testing each of up to 20k lines.
 */
export function todoCommentLines(text: string, maxLines: number, cancelled: () => boolean = () => false): number[] {
  const lines: number[] = [];
  let line = 0, lineStart = 0;
  let at = text.indexOf('TODO');
  while (at >= 0 && !cancelled()) {
    let newline = text.indexOf('\n', lineStart);
    while (newline >= 0 && newline < at) {
      line++;
      lineStart = newline + 1;
      newline = text.indexOf('\n', lineStart);
    }
    if (line >= maxLines) break;
    const lineEnd = newline < 0 ? text.length : newline;
    if (TODO_COMMENT.test(text.slice(lineStart, lineEnd))) lines.push(line);
    at = text.indexOf('TODO', lineEnd);
  }
  return lines;
}

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
  // Embedding device: CPU unless the user picked a GPU. GPUs are only probed
  // (a short PowerShell/nvidia-smi call) when one is selected, to label it.
  const syncEmbedAccelerator = () => {
    const id = featureStore.get().embedAccelerator || "cpu";
    if (id === "cpu") { setEmbedAccelerator("cpu"); return; }
    void listEmbedAccelerators()
      .then((list) => setEmbedAccelerator(id, list.find((a) => a.id === id)?.name))
      .catch((error) => logError("startup.embed-accelerator", error));
  };
  syncEmbedAccelerator();
  context.subscriptions.push(featureStore.onDidChange(syncEmbedAccelerator));
  applyEmbedModel(featureStore.get().embedModel || "minilm")
    .catch((error) => logError("startup.embed-model", error))
    .finally(() => initIndexWatch(context, featureStore));

  configureMcpAuthentication(context);

  // llama.cpp local models: detect install, then auto-load flagged models.
  // Probing spawns up to two processes, so skip it until a model is configured;
  // the settings panel probes on open and models added later trigger the probe.
  initLlamacpp(context);
  let llamaProbed = false;
  const probeLlamacpp = (autoLoad: boolean) => {
    if (llamaProbed || !featureStore.get().llamacppModels.length) return;
    llamaProbed = true;
    void checkInstalled().then(() => {
      if (!autoLoad) return;
      const f = featureStore.get();
      for (const m of f.llamacppModels) {
        if (m.autoLoad) void loadModel(m, f.llamacppConfig).catch((error) => logError("startup.llamacpp-load", error, { model: m.id }));
      }
    }).catch((error) => logError("startup.llamacpp-check", error));
  };
  probeLlamacpp(true);
  if (!llamaProbed) context.subscriptions.push(featureStore.onDidChange(() => probeLlamacpp(false)));

  const sidebarProvider = new SidebarProvider(context, settingsManager, featureStore);
  activeSidebar = sidebarProvider;
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebarProvider, {
      // Keep the chat webview (and any in-flight agent run's UI state) alive when
      // hidden/collapsed or switched away, so reopening never resets to a blank chat.
      webviewOptions: { retainContextWhenHidden: true },
    })

  );

  // Connect plugin and configured MCP servers in the background. The command
  // registers synchronously; the reconcile spawns and initialises every enabled
  // server (up to 15 s each) and must not hold activation open, because VS Code
  // cannot resolve the chat view until activate() returns. The agent re-reads
  // MCP tools every step, so servers that finish later are picked up.
  void registerPluginManagement(context, featureStore)
    .catch((error) => logError("startup.plugins", error))
    .then(() => mcpManager.sync(featureStore.get().mcpServers))
    .catch((error) => logError("startup.mcp", error));

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
        return todoCommentLines(document.getText(), 20_000, () => token.isCancellationRequested).map((line) =>
          new vscode.CodeLens(new vscode.Range(line, 0, line, 0), { title: 'Implement with OpenCursor', command: 'ocursor.implementTodo', arguments: [document.uri, line] }));
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
