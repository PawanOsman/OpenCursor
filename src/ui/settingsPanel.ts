/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as vscode from "vscode";
import { SettingsManager, Settings, DEFAULT_SETTINGS } from "../stores/settingsManager";
import { listModels } from "../agent/provider";
import { renderWebviewHtml } from "./webviewHtml";
import { FeatureStore, MODEL_CATALOG, getProviderApiKeys } from "../stores/featureStore";
import { ProviderKeyStore, type ProviderKeyAction } from "../stores/providerKeys";
import { PROVIDER_PRESETS } from "../shared/providerCatalog";
import { listRules, listSkills } from "../context/workspaceContext";
import { mcpManager } from "../integrations/mcpClient";
import { BUILTIN_PERSONAS } from "../agent/personas";
import { getStatus, onIndexStatus, buildIndex, deleteIndex, warmIndex, EMBED_MODELS } from "../agent/semanticIndex";
import { indexDocSource, cancelDocIndex, deleteDocIndex, onDocsStatus, getDocsStatus, getDocLogs, type DocSource } from "../agent/docsIndex";
import { createDocsPageSelector } from "../agent/docsPlanner";
import { createDocPolicy } from "../agent/docsDiscovery";
import { docIndexSettingsChanged, normalizeDocSourceSettings } from "../shared/docSourceSettings";
import { getWorkspaceRoot } from "../context/workspaceUtils";
import * as llama from "../agent/llamacpp";
import type { LlamacppModel } from "../agent/llamacpp";
import * as ollama from "../agent/ollama";
import { readLocalHardware, estimateModelFit } from "../agent/localRuntime";
import * as oauth from "../agent/oauth";
import { getUsage, resetUsage, flushUsage, onUsageChanged } from "../stores/usageStore";
import { listExternalHooks, saveExternalHook, deleteExternalHook } from "../integrations/externalHooks";
import { getAllModels, onAllModels, refreshAllModels, applyEmbedModel } from "../stores/modelRegistry";

export class SettingsPanel {
  public static currentPanel: SettingsPanel | undefined;
  public static readonly viewType = "ocursor.settingsPanel";
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _resettingUsage = false;
  private readonly _resettingQuota = new Set<string>();
  private readonly _quotaReads = new Map<string, Promise<oauth.OAuthUsage>>();
  private readonly _lifetime = new AbortController();
  private readonly _modelDownloads = new Map<string, AbortController>();
  private readonly _providerKeys: ProviderKeyStore;
  private _docJob?: Promise<void>;
  private _docChanges: Promise<void> = Promise.resolve();

  public static createOrShow(context: vscode.ExtensionContext, settingsManager: SettingsManager, featureStore: FeatureStore, section?: string) {
    const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

    if (SettingsPanel.currentPanel) {
      SettingsPanel.currentPanel._panel.reveal(column);
      if (section) {
        SettingsPanel.currentPanel._panel.webview.postMessage({ type: "navigate", section });
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      SettingsPanel.viewType,
      "OpenCursor Settings",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [context.extensionUri],
        retainContextWhenHidden: true,
      }
    );

    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "icon.png");
    SettingsPanel.currentPanel = new SettingsPanel(panel, context, settingsManager, featureStore);
    SettingsPanel.currentPanel._pendingSection = section;
  }

  private _pendingSection?: string;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly settingsManager: SettingsManager,
    private readonly featureStore: FeatureStore
  ) {
    this._panel = panel;
    this._providerKeys = new ProviderKeyStore(featureStore, settingsManager);
    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Push registry updates (models are prefetched at activation, so the
    // panel shows the full list immediately — no per-page fetch/wait).
    this._disposables.push({
      dispose: onAllModels((d) => this._panel.webview.postMessage({ type: "modelsFetched", models: d.models, modelList: d.modelList })),
    });

    // Stream codebase index progress to the webview.
    this._disposables.push({
      dispose: onIndexStatus((s) => this._panel.webview.postMessage({ type: "indexStatus", status: s })),
    });

    // Stream external-docs indexing progress to the webview.
    this._disposables.push({
      dispose: onDocsStatus((s) => this._panel.webview.postMessage({ type: "docsStatus", status: s })),
    });

    // Stream llama.cpp server status (load/unload) to the webview.
    this._disposables.push(
      llama.onLlamacppStatus((s) => this._panel.webview.postMessage({ type: "llamacppStatus", status: s }))
    );

    // Stream Ollama daemon/model status (pull progress) to the webview.
    this._disposables.push(
      ollama.onOllamaStatus((s) => this._panel.webview.postMessage({ type: "ollamaStatus", status: s }))
    );

    // Stream OAuth account status (login/connect/disconnect) to the webview.
    this._disposables.push(
      oauth.onOAuthStatus((s) => this._panel.webview.postMessage({ type: "oauthStatus", status: s }))
    );

    this._disposables.push({
      dispose: onUsageChanged((usage) => this._panel.webview.postMessage({ type: "usageData", usage })),
    });

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case "managePlugins":
            await vscode.commands.executeCommand("ocursor.managePlugins");
            await this._sendFeatures();
            break;
          case "browserSettings":
            await vscode.commands.executeCommand("workbench.action.openSettings", "ocursor.browserExecutablePath");
            break;
          case "getSettings": {
            await this._sendSettingsToWebview();
            // Models are already loaded in the backend registry: push instantly.
            const all = getAllModels();
            if (all) this._panel.webview.postMessage({ type: "modelsFetched", models: all.models, modelList: all.modelList });
            else void refreshAllModels();
            if (this._pendingSection) {
              this._panel.webview.postMessage({ type: "navigate", section: this._pendingSection });
              this._pendingSection = undefined;
            }
            break;
          }
          case "saveSettings":
            try {
              const settings: Settings = message.settings;
              await this.settingsManager.saveSettings(settings);
              if (message.apiKey !== undefined) {
                if (message.apiKey.trim() === "") {
                  await this.settingsManager.deleteApiKey();
                } else {
                  await this.settingsManager.saveApiKey(message.apiKey);
                }
              }
              this.featureStore.notifyChanged();
              vscode.window.showInformationMessage("OpenCursor: Settings saved successfully.");
              this._panel.webview.postMessage({ type: "saveSuccess" });
            } catch (err: any) {
              vscode.window.showErrorMessage(`OpenCursor: Failed to save settings: ${err.message}`);
            }
            break;
          case "fetchModels":
            await this._handleFetchModels(message.apiBaseUrl, message.apiKey, message.anthropic, message.providerId, message.requestId, message.keyId, message.providerKind);
            break;
          case "fetchAllModels": {
            // Serve from the backend registry (cached); refresh in the background.
            const cached = getAllModels();
            if (cached) this._panel.webview.postMessage({ type: "modelsFetched", models: cached.models, modelList: cached.modelList });
            void refreshAllModels();
            break;
          }
          // ---- Rules / Skills files ----
          case "openWorkspaceFile": {
            try {
              const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(String(message.path)));
              await vscode.window.showTextDocument(doc, { preview: false });
            } catch (e: any) {
              vscode.window.showErrorMessage(`OpenCursor: could not open file: ${e?.message || e}`);
            }
            break;
          }
          case "createRule": {
            const root = getWorkspaceRoot();
            if (!root) { vscode.window.showErrorMessage("OpenCursor: open a workspace first."); break; }
            const name = await vscode.window.showInputBox({ prompt: "Rule name", placeHolder: "my-rule" });
            if (!name) break;
            const slug = name.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "") || "rule";
            const dir = vscode.Uri.file(`${root}/.cursor/rules`);
            const file = vscode.Uri.joinPath(dir, `${slug}.md`);
            await vscode.workspace.fs.createDirectory(dir);
            try {
              await vscode.workspace.fs.stat(file); // exists → just open
            } catch {
              const tpl = `---\ndescription: \nglobs: \nalwaysApply: false\n---\n\n# ${name.trim()}\n\nWrite the rule content here.\n`;
              await vscode.workspace.fs.writeFile(file, Buffer.from(tpl, "utf8"));
            }
            await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file), { preview: false });
            await this._sendFeatures();
            break;
          }
          case "createSkill": {
            const root = getWorkspaceRoot();
            if (!root) { vscode.window.showErrorMessage("OpenCursor: open a workspace first."); break; }
            const name = await vscode.window.showInputBox({ prompt: "Skill name", placeHolder: "my-skill" });
            if (!name) break;
            const slug = name.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "") || "skill";
            const dir = vscode.Uri.file(`${root}/.cursor/skills/${slug}`);
            const file = vscode.Uri.joinPath(dir, "SKILL.md");
            await vscode.workspace.fs.createDirectory(dir);
            try {
              await vscode.workspace.fs.stat(file);
            } catch {
              const tpl = `---\ndescription: Describe when the agent should use this skill.\n---\n\n# ${name.trim()}\n\nInstructions for the agent.\n`;
              await vscode.workspace.fs.writeFile(file, Buffer.from(tpl, "utf8"));
            }
            await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file), { preview: false });
            await this._sendFeatures();
            break;
          }
          case "deleteRule": {
            const ok = await vscode.window.showWarningMessage(`Delete rule "${message.name}"?`, { modal: true }, "Delete");
            if (ok !== "Delete") break;
            try {
              await vscode.workspace.fs.delete(vscode.Uri.file(String(message.path)), { useTrash: true });
            } catch (e: any) {
              vscode.window.showErrorMessage(`OpenCursor: could not delete rule: ${e?.message || e}`);
            }
            await this._sendFeatures();
            break;
          }
          case "deleteSkill": {
            const ok = await vscode.window.showWarningMessage(`Delete skill "${message.name}"?`, { modal: true }, "Delete");
            if (ok !== "Delete") break;
            try {
              // message.path points at SKILL.md — delete the whole skill folder.
              const dir = vscode.Uri.joinPath(vscode.Uri.file(String(message.path)), "..");
              await vscode.workspace.fs.delete(dir, { recursive: true, useTrash: true });
            } catch (e: any) {
              vscode.window.showErrorMessage(`OpenCursor: could not delete skill: ${e?.message || e}`);
            }
            await this._sendFeatures();
            break;
          }
          case "openUrl":
            if (message.url) await vscode.env.openExternal(vscode.Uri.parse(String(message.url)));
            break;
          case "openVsCodeSettings":
            await vscode.commands.executeCommand("workbench.action.openSettings", message.query || "");
            break;
          case "openKeyboardShortcuts":
            await vscode.commands.executeCommand("workbench.action.openGlobalKeybindings");
            break;
          case "openEditorSettings":
            await vscode.commands.executeCommand("workbench.action.openSettings", "@id:editor.fontSize @id:editor.fontFamily @id:editor.formatOnSave @id:editor.minimap.enabled @id:files.autoSave");
            break;
          // TEMPORARY: dev-only full reset. Remove before publishing.
          case "resetStorage":
            await this._resetStorage();
            break;
          case "providerKeyAction":
            await this._handleProviderKeyAction(message);
            break;
          case "saveProviderKey":
            await this._providerKeys.saveLegacy(message.providerId, message.apiKey ?? "");
            this.featureStore.notifyChanged();
            await this._sendFeatures();
            break;
          case "getFeatures":
            await this._sendFeatures();
            break;
          case "saveFeatures":
            await this._providerKeys.saveFeatures(message.features);
            // Re-sync MCP connections if servers changed.
            await mcpManager.sync(this.featureStore.get().mcpServers);
            await this._sendFeatures();
            break;
          case "getExternalHooks":
            try {
              this._panel.webview.postMessage({ type: "externalHooks", hooks: listExternalHooks() });
            } catch (e: any) {
              this._panel.webview.postMessage({ type: "externalHooks", hooks: [], error: String(e?.message || e) });
            }
            break;
          case "saveExternalHook":
            try {
              saveExternalHook(message.source, message.hook);
              this._panel.webview.postMessage({ type: "externalHooks", hooks: listExternalHooks() });
            } catch (e: any) {
              this._panel.webview.postMessage({ type: "externalHooks", hooks: listExternalHooks(), error: String(e?.message || e) });
            }
            break;
          case "deleteExternalHook":
            try {
              deleteExternalHook(message.source, message.ref);
            } catch { /* ignore */ }
            this._panel.webview.postMessage({ type: "externalHooks", hooks: listExternalHooks() });
            break;
          case "syncMcp":
            await mcpManager.sync(this.featureStore.get().mcpServers);
            await this._sendFeatures();
            break;
          case "mcpLogin":
          case "mcpLogout":
            try {
              if (message.type === "mcpLogin") await mcpManager.login(String(message.name));
              else await mcpManager.logout(String(message.name));
            } catch (error) { this._panel.webview.postMessage({ type: "mcpAuthError", error: String(error) }); }
            await this._sendFeatures();
            break;
          case "getIndexStatus":
            await warmIndex(getWorkspaceRoot());
            this._panel.webview.postMessage({ type: "indexStatus", status: getStatus(getWorkspaceRoot()), models: EMBED_MODELS });
            this._sendDocs();
            break;
          case "addDoc":
          case "editDoc":
          case "reindexDoc":
          case "removeDoc":
            this._docChanges = this._docChanges.then(() => this._handleDocAction(message));
            await this._docChanges;
            break;
          case "cancelDocIndex":
            if (typeof message.id === "string") cancelDocIndex(message.id);
            break;
          case "getDocLogs":
            this._panel.webview.postMessage({ type: "docLogs", id: message.id, lines: getDocLogs(message.id) });
            break;
          case "openExternal":
            if (/^https?:\/\//.test(message.url || "")) await vscode.env.openExternal(vscode.Uri.parse(message.url));
            break;
          case "openCursorignore": {
            const root = getWorkspaceRoot();
            const uri = vscode.Uri.file(`${root}/.cursorignore`);
            try {
              await vscode.workspace.fs.stat(uri);
            } catch {
              await vscode.workspace.fs.writeFile(uri, Buffer.from("# Files to exclude from indexing (gitignore syntax)\n"));
            }
            await vscode.window.showTextDocument(uri);
            break;
          }
          case "syncIndex":
            if (this.featureStore.get().indexingEnabled === false) break;
            buildIndex(getWorkspaceRoot()).catch(() => {});
            break;
          case "deleteIndex":
            await deleteIndex(getWorkspaceRoot());
            break;
          case "setEmbedModel": {
            const f = this.featureStore.get();
            await this.featureStore.set({ ...f, embedModel: message.modelId });
            await applyEmbedModel(message.modelId);
            this._panel.webview.postMessage({ type: "indexStatus", status: getStatus(getWorkspaceRoot()), models: EMBED_MODELS });
            if (f.indexingEnabled !== false) buildIndex(getWorkspaceRoot()).catch(() => {});
            break;
          }
          case "localHardwareGet": {
            const hardware = await readLocalHardware(this.context.globalStorageUri.fsPath);
            const fits = Object.fromEntries(this.featureStore.get().llamacppModels.map(model => [model.id, estimateModelFit(model.sizeBytes, hardware)]));
            this._panel.webview.postMessage({ type: "localHardware", hardware, fits });
            break;
          }
          case "llamacppGet":
            await llama.checkInstalled();
            this._panel.webview.postMessage({ type: "llamacppStatus", status: llama.getStatus() });
            await this._sendFeatures();
            break;
          case "llamacppInstall":
            await llama.installLlamacpp();
            break;
          case "llamacppSearch": {
            try {
              const results = await llama.searchGguf(message.query, 20);
              this._panel.webview.postMessage({ type: "llamacppSearchResults", results });
            } catch (err: any) {
              this._panel.webview.postMessage({ type: "llamacppSearchResults", results: [], error: String(err?.message || err) });
            }
            break;
          }
          case "llamacppRepoFiles": {
            try {
              const files = await llama.listRepoGgufFiles(message.repo);
              this._panel.webview.postMessage({ type: "llamacppRepoFiles", repo: message.repo, files });
            } catch (err: any) {
              this._panel.webview.postMessage({ type: "llamacppRepoFiles", repo: message.repo, files: [], error: String(err?.message || err) });
            }
            break;
          }
          case "llamacppCancelDownload":
            this._modelDownloads.get(String(message.id))?.abort(new Error("Download cancelled. Download again to resume."));
            break;
          case "llamacppDownload": {
            const id = `${message.repo}/${message.file}`;
            if (this._modelDownloads.has(id)) break;
            const controller = new AbortController();
            this._modelDownloads.set(id, controller);
            try {
              const model = await llama.downloadGguf(message.repo, message.file, (received, total) => {
                this._panel.webview.postMessage({ type: "llamacppDownloadProgress", id, received, total });
              }, AbortSignal.any([controller.signal, this._lifetime.signal]), { sha256: message.sha256, sizeBytes: message.sizeBytes });
              await this._addLlamacppModel(model);
              this._panel.webview.postMessage({ type: "llamacppDownloadDone", id: model.id });
            } catch (err: any) {
              this._panel.webview.postMessage({ type: "llamacppDownloadDone", id, error: String(err?.message || err) });
            } finally { this._modelDownloads.delete(id); }
            break;
          }
          case "llamacppImport": {
            const src = await llama.pickLocalGguf();
            if (src) {
              try { const model = await llama.importGguf(src); await this._addLlamacppModel(model); }
              catch (error) { this._panel.webview.postMessage({ type: "localModelError", error: String(error) }); }
            }
            break;
          }
          case "llamacppLoad": {
            const f = this.featureStore.get();
            const m = f.llamacppModels.find((x) => x.id === message.id);
            if (m) llama.loadModel(m, f.llamacppConfig).catch(() => {});
            break;
          }
          case "llamacppSetContextLength": {
            const ctx = Math.max(512, Number(message.value) || 65536);
            const f = this.featureStore.get();
            await this.featureStore.set({ llamacppContextLength: ctx, llamacppConfig: { ...f.llamacppConfig, ctxSize: ctx } });
            await this._sendFeatures();
            break;
          }
          case "llamacppSetConfig":
            // Replace the global llama-server launch config.
            await this.featureStore.set({ llamacppConfig: { ...this.featureStore.get().llamacppConfig, ...(message.config || {}) } });
            await this._sendFeatures();
            break;
          case "llamacppSetModelConfig": {
            const models = this.featureStore.get().llamacppModels.map((m) =>
              m.id === message.id
                ? {
                    ...m,
                    useCustomConfig: message.useCustomConfig ?? m.useCustomConfig,
                    contextLength: message.contextLength ?? m.contextLength,
                    config: message.config !== undefined ? message.config : m.config,
                  }
                : m
            );
            await this.featureStore.set({ llamacppModels: models });
            await this._sendFeatures();
            break;
          }
          case "llamacppUnload":
            await llama.unloadModel(message.id);
            break;
          case "llamacppSetAutoLoad": {
            const models = this.featureStore.get().llamacppModels.map((m) =>
              m.id === message.id ? { ...m, autoLoad: !!message.autoLoad } : m
            );
            await this.featureStore.set({ llamacppModels: models });
            await this._sendFeatures();
            break;
          }
          case "llamacppRemove": {
            const m = this.featureStore.get().llamacppModels.find((x) => x.id === message.id);
            try {
              if (m) await llama.deleteGgufFile(m);
              await this._removeLlamacppModel(message.id);
            } catch (error) { this._panel.webview.postMessage({ type: "localModelError", error: String(error) }); }
            break;
          }

          // ---- Usage & Quota ----
          case "getUsage":
            try {
              await flushUsage();
              this._panel.webview.postMessage({ type: "usageData", usage: getUsage() });
              this._usageActionResult(message.requestId, "refresh", "success");
            } catch (error) {
              this._usageActionResult(message.requestId, "refresh", "error", error);
            }
            break;
          case "resetUsage":
            await this._resetUsage(message.requestId);
            break;

          // ---- OAuth accounts (Claude Code / Codex) ----
          case "oauthGet":
            this._panel.webview.postMessage({ type: "oauthStatus", status: oauth.getStatus() });
            break;
          case "oauthLogin":
            oauth.login(message.kind, message.options).catch((error) => this._postOAuthError(message.kind, error));
            break;
          case "oauthOpenLogin":
            oauth.openLoginInBrowser(message.kind).catch((error) => this._postOAuthError(message.kind, error));
            break;
          case "oauthCopyLogin": {
            const status = oauth.getStatus();
            if (status.pending !== message.kind || !status.authorizationUrl) {
              this._postOAuthError(message.kind, new Error("No login in progress — click Add account first."));
              break;
            }
            try {
              // Copy the host's active URL, never a URL supplied by the webview.
              await vscode.env.clipboard.writeText(status.authorizationUrl);
              this._panel.webview.postMessage({ type: "oauthLinkCopied", kind: status.pending, authorizationUrl: status.authorizationUrl });
            } catch (error) {
              this._postOAuthError(message.kind, error);
            }
            break;
          }
          case "oauthCancel":
            oauth.cancelLogin(message.kind);
            break;
          case "oauthManualCallback": {
            const authorizationUrl = oauth.getStatus().authorizationUrl;
            try {
              await oauth.completeManual(message.kind, message.url);
            } catch (error) {
              const current = oauth.getStatus();
              // A cancelled/replaced exchange must not overwrite a newer login.
              // A failed exchange may already have cleared its URL and saved its error.
              if (current.authorizationUrl === authorizationUrl || (!current.authorizationUrl && current.errors[message.kind as oauth.OAuthKind])) {
                this._postOAuthError(message.kind, error);
              }
            }
            break;
          }
          case "oauthDisconnect":
            await oauth.disconnect(message.id);
            this.featureStore.notifyChanged();
            break;
          case "oauthSetEnabled":
            await oauth.setAccountEnabled(message.id, message.enabled);
            this.featureStore.notifyChanged();
            break;
          case "oauthSetBalance":
            await oauth.setBalanceStrategy(message.strategy, message.kind);
            break;
          case "oauthLimits":
            await this._sendAccountLimits(message.id, message.requestId);
            break;
          case "oauthResetCredit":
            await this._resetAccountQuota(message.id, message.requestId);
            break;

          // ---- Ollama ----
          case "ollamaGet": {
            await ollama.checkInstalled();
            this._panel.webview.postMessage({ type: "ollamaStatus", status: ollama.getStatus() });
            await this._sendOllamaModels();
            break;
          }
          case "ollamaSetEndpoint": {
            try {
              ollama.setOllamaHost(String(message.endpoint));
              await this.context.globalState.update("ocursor.ollamaEndpoint", ollama.getStatus().endpoint);
              await ollama.refreshStatus(); await this._sendOllamaModels();
            } catch (error) { this._panel.webview.postMessage({ type: "localModelError", error: String(error) }); }
            break;
          }
          case "ollamaLoad":
          case "ollamaUnload":
            void ollama.setModelLoaded(String(message.name), message.type === "ollamaLoad", Number(message.contextLength ?? 8192), Number(message.keepAliveMinutes ?? 5))
              .catch(error => this._panel.webview.postMessage({ type: "localModelError", error: String(error) }));
            break;
          case "ollamaInspect":
            void ollama.inspectModel(String(message.name)).catch(error => this._panel.webview.postMessage({ type: "localModelError", error: String(error) }));
            break;
          case "ollamaInstall":
            await ollama.installOllama();
            break;
          case "ollamaPull": {
            ollama
              .pullModel(String(message.name))
              .then(() => this._sendOllamaModels())
              .catch(() => {});
            break;
          }
          case "ollamaCancelPull":
            ollama.cancelPull(String(message.name));
            break;
          case "ollamaRemove":
            await ollama.deleteModel(String(message.name)).catch(error => this._panel.webview.postMessage({ type: "localModelError", error: String(error) }));
            await this._sendOllamaModels();
            break;
          case "ollamaRefresh":
            await this._sendOllamaModels();
            break;
          case "ollamaSearch": {
            try {
              const results = await ollama.searchLibrary(String(message.query));
              this._panel.webview.postMessage({ type: "ollamaSearchResults", results });
            } catch (err: any) {
              this._panel.webview.postMessage({ type: "ollamaSearchResults", results: [], error: String(err?.message || err) });
            }
            break;
          }
          case "ollamaTags": {
            try {
              const tags = await ollama.listLibraryTags(String(message.name));
              this._panel.webview.postMessage({ type: "ollamaTags", name: message.name, tags });
            } catch (err: any) {
              this._panel.webview.postMessage({ type: "ollamaTags", name: message.name, tags: [], error: String(err?.message || err) });
            }
            break;
          }
        }
      },
      null,
      this._disposables
    );
  }

  private _usageActionResult(requestId: unknown, action: "refresh" | "reset", status: "success" | "cancelled" | "error", error?: unknown) {
    this._panel.webview.postMessage({ type: "usageActionResult", requestId, action, status,
      ...(error ? { error: String((error as Error)?.message || error) } : {}),
    });
  }

  private async _resetUsage(requestId: unknown) {
    if (this._resettingUsage) {
      this._usageActionResult(requestId, "reset", "error", "A usage reset is already awaiting confirmation or being saved.");
      return;
    }
    this._resettingUsage = true;
    try {
      const choice = await vscode.window.showWarningMessage("Reset all recorded token usage?", {
        modal: true, detail: "This clears locally recorded token usage. Your account quota and reset credits are unchanged.",
      }, "Reset Usage");
      if (choice !== "Reset Usage" || this._lifetime.signal.aborted) {
        this._usageActionResult(requestId, "reset", "cancelled");
        return;
      }
      await resetUsage();
      this._panel.webview.postMessage({ type: "usageData", usage: getUsage() });
      this._usageActionResult(requestId, "reset", "success");
    } catch (error) {
      this._usageActionResult(requestId, "reset", "error", error);
    } finally {
      this._resettingUsage = false;
    }
  }

  private _accountLimits(id: string): Promise<oauth.OAuthUsage> {
    const pending = this._quotaReads.get(id);
    if (pending) return pending;
    const read = oauth.getAccountLimits(id, this._lifetime.signal).finally(() => {
      if (this._quotaReads.get(id) === read) this._quotaReads.delete(id);
    });
    this._quotaReads.set(id, read);
    return read;
  }

  private async _sendAccountLimits(id: string, requestId?: string) {
    try {
      const usage = await this._accountLimits(id);
      this._panel.webview.postMessage({ type: "oauthLimits", id, requestId, limits: usage.limits, resetCredits: usage.resetCredits });
    } catch (error) {
      this._panel.webview.postMessage({ type: "oauthLimits", id, requestId, error: String((error as Error)?.message || error) });
    }
  }

  private async _resetAccountQuota(id: string, requestId?: string) {
    if (this._resettingQuota.has(id)) {
      this._panel.webview.postMessage({ type: "oauthResetResult", id, requestId, ok: false, message: "A quota reset is already in progress. Refresh limits before trying again." });
      await this._sendAccountLimits(id, requestId);
      return;
    }
    this._resettingQuota.add(id);
    try {
      const result = await oauth.consumeCodexResetCredit(id, this._lifetime.signal);
      this._panel.webview.postMessage({ type: "oauthResetResult", id, requestId, ok: result.ok, message: result.message });
    } catch (error) {
      this._panel.webview.postMessage({ type: "oauthResetResult", id, requestId, ok: false, message: String((error as Error)?.message || error) });
    } finally {
      // Discard any pre-reset quota read; it cannot confirm the reset's outcome.
      this._quotaReads.delete(id);
      try { await this._sendAccountLimits(id, requestId); }
      finally { this._resettingQuota.delete(id); }
    }
  }

  private async _handleFetchModels(apiBaseUrl: string, apiKey: string, anthropic?: boolean, providerId?: string, requestId?: string, keyId?: string, providerKind?: string) {
    try {
      let key = apiKey;
      if (key === "●●●●●●●●" || key === undefined) {
        if (!providerId) key = (await this.settingsManager.getApiKey()) || "";
        else {
          const provider = this.featureStore.get().providers.find(item => item.id === providerId);
          const candidates = provider ? getProviderApiKeys(provider).filter(item => keyId ? item.id === keyId : item.enabled !== false) : [];
          if (keyId && !candidates.length) throw new Error("API key not found for this provider.");
          key = "";
          for (const candidate of candidates) {
            key = (await this.settingsManager.getProviderKey(candidate.id)) || "";
            if (key) break;
          }
        }
      }
      const configured = this.featureStore.get().providers.find(item => item.id === providerId);
      const kind = configured?.kind ?? (providerId === `popular:${providerKind}` ? providerKind : undefined);
      const preset = kind && Object.prototype.hasOwnProperty.call(PROVIDER_PRESETS, kind) ? PROVIDER_PRESETS[kind as keyof typeof PROVIDER_PRESETS] : undefined;
      let verified = true;
      const models = await listModels(apiBaseUrl, key, anthropic, {
        providerAdapterId: preset?.protocol === "adapter" ? preset.adapterId : undefined,
        onVerification: value => { verified = value; }, signal: AbortSignal.timeout(30_000),
      });
      this._panel.webview.postMessage({ type: "modelsFetched", models: models.map((m) => m.id), providerId, ...(requestId ? { requestId } : {}), ...(!verified ? { verified: false } : {}) });
    } catch (err: any) {
      this._panel.webview.postMessage({ type: "modelsFetched", models: [], providerId, ...(requestId ? { requestId } : {}), error: String(err?.message || err) });
    }
  }

  /**
   * TEMPORARY (dev-only): wipe all persisted extension state so the extension
   * behaves like a fresh install, then reload the window. Remove before publishing.
   */
  private async _resetStorage() {
    const confirm = await vscode.window.showWarningMessage(
      "Reset ALL OpenCursor storage (settings, API keys, providers, conversations, models, MCP servers)?",
      { modal: true },
      "Reset"
    );
    if (confirm !== "Reset") return;

    // Delete provider API keys (need ids before clearing globalState) + the main key.
    const features = this.featureStore.get();
    const providerKeys = new Set(features.providers.flatMap(provider => [provider.id, ...getProviderApiKeys(provider).map(key => key.id)]));
    await Promise.all([...providerKeys].map(id => this.settingsManager.deleteProviderKey(id)));
    await this.settingsManager.deleteApiKey();

    // Delete OAuth account secrets, then every globalState key.
    const oauthIds = this.context.globalState.get<string[]>("ocursor.oauth.accountIds", []) ?? [];
    await Promise.all(oauthIds.map((id) => this.context.secrets.delete(`ocursor.oauth.acct.${id}`)));
    for (const key of this.context.globalState.keys()) {
      await this.context.globalState.update(key, undefined);
    }

    // Remove all ocursor.* config overrides (undefined reverts to default).
    const config = vscode.workspace.getConfiguration("ocursor");
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      try { await config.update(key, undefined, vscode.ConfigurationTarget.Global); } catch { /* not writable */ }
    }

    await vscode.commands.executeCommand("workbench.action.reloadWindow");
  }

  /**
   * Register a downloaded/imported GGUF. Local models are served directly by the
   * extension's own llama-server on demand — no provider entry or enabledModels
   * gating needed; they always appear in the picker.
   */
  private async _addLlamacppModel(model: LlamacppModel) {
    const f = this.featureStore.get();
    const llamacppModels = [...f.llamacppModels.filter((m) => m.id !== model.id), model];
    await this.featureStore.set({ llamacppModels });
    await this._sendFeatures();
  }

  private _postOAuthError(kind: oauth.OAuthKind, error: unknown) {
    const status = oauth.getStatus();
    this._panel.webview.postMessage({
      type: "oauthStatus",
      status: { ...status, errors: { ...status.errors, [kind]: String((error as Error)?.message || error) } },
    });
  }

  private async _sendOllamaModels() {
    let models: ollama.OllamaModel[] = [];
    try {
      models = await ollama.listModels();
    } catch (error) {
      this._panel.webview.postMessage({ type: "localModelError", error: String(error) });
    }
    this._panel.webview.postMessage({ type: "ollamaModels", models });
  }

  private async _removeLlamacppModel(id: string) {
    const f = this.featureStore.get();
    await this.featureStore.set({
      llamacppModels: f.llamacppModels.filter((m) => m.id !== id),
    });
    await this._sendFeatures();
  }

  /** Index a doc source in the background; persist result or error on the doc. */
  private _indexDoc(doc: DocSource) {
    if (this._docJob || getDocsStatus().indexing) return;
    const update = async (patch: Partial<DocSource>) => {
      const cur = this.featureStore.get().docSources ?? [];
      if (!cur.some((d) => d.id === doc.id)) return;
      await this.featureStore.set({ docSources: cur.map((d) => (d.id === doc.id ? { ...d, ...patch } : d)) });
      this._sendDocs();
    };
    this._docJob = (async () => {
      try {
        const result = await indexDocSource(doc, { selectPages: createDocsPageSelector(this.settingsManager, this.featureStore) });
        await update({ pages: result.pages, chunks: result.chunks, indexedAt: Date.now(), error: undefined,
          resolvedScope: result.scope, stopReason: result.stopReason, selected: result.selected });
      } catch (error) {
        if ((error as Error)?.name === "AbortError") return;
        await update({ error: String((error as Error)?.message || error) });
      }
    })().catch((error) => {
      this._panel.webview.postMessage({ type: "docActionResult", ok: false, error: `Could not save the documentation result: ${String((error as Error)?.message || error)}` });
    }).finally(() => { this._docJob = undefined; this._sendDocs(); });
  }

  private async _handleDocAction(message: Record<string, unknown>) {
    try {
      if (this._docJob || getDocsStatus().indexing) throw new Error("Wait for the current documentation index to finish, or cancel it first.");
      const cur = this.featureStore.get().docSources ?? [];
      if (message.type === "addDoc") {
        const doc: DocSource = { id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, ...normalizeDocSourceSettings(message) };
        createDocPolicy(doc.url, doc);
        await this.featureStore.set({ docSources: [...cur, doc] });
        this._sendDocs();
        this._indexDoc(doc);
      } else {
        const doc = cur.find((entry) => entry.id === message.id);
        if (!doc) throw new Error("This documentation source no longer exists.");
        if (message.type === "editDoc") {
          const next = { ...doc, ...normalizeDocSourceSettings({ ...doc, ...message }) };
          createDocPolicy(next.url, next);
          const changed = docIndexSettingsChanged(doc, next);
          await this.featureStore.set({ docSources: cur.map((entry) => entry.id === doc.id ? next : entry) });
          this._sendDocs();
          if (changed) this._indexDoc(next);
        } else if (message.type === "reindexDoc") this._indexDoc({ ...doc, ...normalizeDocSourceSettings(doc) });
        else if (message.type === "removeDoc") {
          await deleteDocIndex(doc.id);
          await this.featureStore.set({ docSources: (this.featureStore.get().docSources ?? []).filter((entry) => entry.id !== doc.id) });
          this._sendDocs();
        }
      }
      this._panel.webview.postMessage({ type: "docActionResult", requestId: message.requestId, ok: true });
    } catch (error) {
      this._panel.webview.postMessage({ type: "docActionResult", requestId: message.requestId, ok: false, error: String((error as Error)?.message || error) });
    }
  }

  private _sendDocs() {
    this._panel.webview.postMessage({
      type: "docSources",
      docs: this.featureStore.get().docSources ?? [],
      status: getDocsStatus(),
    });
  }

  private async _handleProviderKeyAction(message: ProviderKeyAction & { requestId?: unknown }) {
    try {
      if (typeof message.requestId !== "string" || !message.requestId) throw new Error("Missing API key action request id.");
      const provider = await this._providerKeys.action(message);
      // The committed action remains successful if a separate settings refresh fails.
      await this._sendFeatures().catch(() => undefined);
      this._panel.webview.postMessage({ type: "providerKeyActionResult", requestId: message.requestId, ok: true, provider });
    } catch (error) {
      this._panel.webview.postMessage({ type: "providerKeyActionResult", requestId: message.requestId, ok: false,
        error: String((error as Error).message || "Could not save API key changes.") });
    }
  }

  private async _sendFeatures() {
    const [rules, skills] = await Promise.all([listRules(), listSkills()]);
    const features = this.featureStore.get();
    // Annotate each provider with whether a key is stored (never expose the key).
    const providers = await Promise.all(
      features.providers.map(p => this._providerKeys.annotate(p))
    );
    this._panel.webview.postMessage({
      type: "features",
      features: { ...features, providers },
      mcpStatus: mcpManager.status(),
      rules,
      skills,
      builtinPersonas: BUILTIN_PERSONAS,
      modelCatalog: MODEL_CATALOG,
    });
  }

  private async _sendSettingsToWebview() {
    const settings = this.settingsManager.getSettings();
    const apiKey = await this.settingsManager.getApiKey();
    this._panel.webview.postMessage({
      type: "loadSettings",
      settings,
      apiKey: apiKey ? "●●●●●●●●" : "",
    });
  }

  public dispose() {
    this._lifetime.abort();
    SettingsPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    return renderWebviewHtml(webview, this.context.extensionUri, "settings", "OpenCursor Settings");
  }
}
