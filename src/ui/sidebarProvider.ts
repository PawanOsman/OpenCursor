/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as vscode from "vscode";
import { SettingsManager } from "../stores/settingsManager";
import { runAgent } from "../agent/loop";
import { AgentEvent, Mode, Attachment } from "../agent/types";
import { listModels, generateTitle, pickModel } from "../agent/provider";
import { renderWebviewHtml } from "./webviewHtml";
import { ConversationStore, titleFromText } from "../stores/conversationStore";
import { FeatureStore, MODEL_CATALOG, kindMatches, optionsToParams, parseContextLabel, providerEnabled, type ModelDef, type ModelOption, type ProviderConfig } from "../stores/featureStore";
import { effectiveContextLength, ensureLoaded, isRunning, serverUrlFor } from "../agent/llamacpp";
import * as ollama from "../agent/ollama";
import * as oauth from "../agent/oauth";
import { recordUsage } from "../stores/usageStore";
import { DEFAULT_APPROVAL, evaluateApproval, deniedSubject, actionTypeForCall, subjectFor, type ApprovalActionType, type ApprovalMode, type ApprovalPolicy } from "../agent/approvalPolicy";
import { stripModelScope, suggestPattern } from "./sidebar/approvalSuggest";
import type { PendingApproval, RunSession } from "./sidebar/session";
import { runHooks, runBlockingHooks } from "../integrations/hooksRunner";
import { getWorkspaceRoot, safePath } from "../context/workspaceUtils";
import { allPersonas, getPersona } from "../agent/personas";
import { pendingChanges, computeHunks } from "../stores/pendingChanges";
import { applyEvent, closeTrailingThinking, forceSettleOpenWork, parseMentionTokens, renderMentionTokens, type AgentEvent as SharedAgentEvent, type Turn } from "../shared/turns";
import { resolveFileIcon, invalidateFileIconCache } from "./fileIcons";
import {
  searchFilesAndFolders, searchCommits, searchDocSources, searchTerminals,
  searchRules, searchCode, branchDiffItem, resolveMentions, type MentionItem as HostMentionItem,
} from "../context/mentions";
import { getLog, logError } from "../logging";

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "ocursor.chatView";
  private _view?: vscode.WebviewView;
  /** One independent agent run per conversation, so chats run concurrently. */
  private _sessions = new Map<string, RunSession>();
  private _currentMode: Mode = "agent";
  /** Shared debug/log output channel (View → Output → "OpenCursor"). */
  public static get log(): vscode.OutputChannel {
    return getLog();
  }
  private _store: ConversationStore;
  private _activeId?: string;
  /** Persona selected for the next new conversation (overrides the global default). */
  private _pendingPersonaId?: string;
  /** Original ("before") file contents keyed by path, for the diff virtual-doc provider. */
  /** Ids of locally-pulled Ollama models (for routing without a provider entry). */
  private _ollamaModelIds = new Set<string>();
  /** Map fetched model id -> provider id that served it (for exact routing). */
  private _modelProvider = new Map<string, string>();
  /** Map model id -> OAuth provider kind that serves it. */
  private _oauthModelKind = new Map<string, oauth.OAuthKind>();
  /** Last successful provider→ids fetch. Disk-backed so startup paints before network. */
  private _fetchedCache: { providerId: string; ids: string[] }[] | null = null;
  private _fetchInflight: Promise<void> | null = null;
  private static readonly MODELS_CACHE_KEY = "ocursor.modelsFetched.v1";

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly settingsManager: SettingsManager,
    private readonly featureStore: FeatureStore
  ) {
    this._store = new ConversationStore(context);
    const disk = context.globalState.get<{ fetched: { providerId: string; ids: string[] }[] }>(
      SidebarProvider.MODELS_CACHE_KEY,
    );
    if (disk?.fetched?.length) this._fetchedCache = disk.fetched;
  }

  /**
   * Pasted text → @code mention if it matches a region of an open project file
   * (Cursor behavior: copy code in the editor, paste in chat → code pill).
   * ponytail: only scans open documents, not the whole workspace on disk.
   */
  private _resolvePastedCode(text: string): HostMentionItem | undefined {
    const needle = text.replace(/\r\n/g, "\n").trim();
    // Too short to be a meaningful code reference.
    if (needle.length < 8 || !needle.includes("\n") && needle.length < 24) return undefined;
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme !== "file" || doc.isUntitled) continue;
      const idx = doc.getText().replace(/\r\n/g, "\n").indexOf(needle);
      if (idx === -1) continue;
      const rel = vscode.workspace.asRelativePath(doc.uri, false);
      // Outside the workspace (asRelativePath returns the full path unchanged).
      if (rel === doc.uri.fsPath) continue;
      const before = doc.getText().replace(/\r\n/g, "\n").slice(0, idx);
      const start = before.split("\n").length;
      const end = start + needle.split("\n").length - 1;
      return {
        kind: "code",
        path: `${rel}:${start}-${end}`,
        name: `${rel.split("/").pop()}:${start}-${end}`,
        detail: rel,
      };
    }
    return undefined;
  }

  /** Ctrl+L: insert the current editor selection as a @code mention in the composer. */
  public addSelectionToChat() {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return;
    const sel = ed.selection;
    const rel = vscode.workspace.asRelativePath(ed.document.uri, false);
    // Empty selection → mention the whole file.
    const mention: HostMentionItem = sel.isEmpty
      ? { kind: "file", path: rel, name: rel.split("/").pop() || rel }
      : {
          kind: "code",
          path: `${rel}:${sel.start.line + 1}-${sel.end.line + 1}`,
          name: `${rel.split("/").pop()}:${sel.start.line + 1}-${sel.end.line + 1}`,
          detail: rel,
        };
    vscode.commands.executeCommand("ocursor.chatView.focus").then(() => {
      // Small delay so a freshly-created webview is ready to receive it.
      setTimeout(() => this._view?.webview.postMessage({ type: "insertMention", mention }), 100);
    });
  }

  /** Post a message prompt to the active session (used by IPC socket bridge). */
  public async postMessageToSession(prompt: string, mode?: Mode, model?: string) {
    if (mode) this._currentMode = mode;
    await this._handleMessage(prompt, undefined, { model, mode });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Keep the webview's pending-changes bar in sync with the store.
    const sub = pendingChanges.onChange(() => this._sendPendingChanges());
    // Live-refresh personas / provider availability when settings change.
    const cfgSub = this.featureStore.onDidChange(() => {
      this._sendConfigState();
      void this._handleFetchModels();
    });
    // Refresh the picker when OAuth accounts connect/disconnect.
    const oauthSub = oauth.onOAuthStatus(() => {
      this._sendConfigState();
      void this._handleFetchModels();
    });
    // Re-resolve file icons when the user switches icon themes.
    const iconSub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("workbench.iconTheme")) invalidateFileIconCache();
    });
    webviewView.onDidDispose(() => {
      sub();
      cfgSub.dispose();
      oauthSub.dispose();
      iconSub.dispose();
    });

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case "ready":
          await this._sendInitialState();
          break;
        case "sendMessage":
          await this._handleMessage(data.text, data.attachments, {
            fromIndex: data.fromIndex,
            model: data.model,
            mode: data.mode,
            revertFiles: data.revertFiles,
          });
          break;
        case "continueRun":
          // "Continue" button after hitting the step limit. Optionally flips
          // the global Auto Continue setting first.
          if (data.always) await this.featureStore.set({ autoContinue: true });
          await this._handleMessage("Continue", undefined, {});
          break;
        case "revertToMessage": {
          if (this._activeId && this._store.get(this._activeId)) {
            if (data.revertFiles) await pendingChanges.rejectAll();
            this._truncateConversation(this._activeId, data.index);
            this._sendConversations();
          }
          break;
        }
        case "browseAttachments":
          await this._browseAttachments();
          break;
        case "openSettings":
          vscode.commands.executeCommand("ocursor.openSettings", data.section);
          break;
        case "openBrowserTab":
          vscode.commands.executeCommand("simpleBrowser.show", data.url || "https://www.google.com");
          break;
        case "exportConversation": {
          const conv = this._store.get(data.convId || this._activeId || "");
          if (!conv) break;
          const safe = (conv.title || "conversation").replace(/[^\w-]+/g, "_").slice(0, 60);
          const target = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.joinPath(vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(process.cwd()), `${safe}.json`),
            filters: { JSON: ["json"] },
          });
          if (!target) break;
          await vscode.workspace.fs.writeFile(target, Buffer.from(JSON.stringify(conv, null, 2), "utf8"));
          vscode.window.showInformationMessage(`Exported conversation to ${target.fsPath}`);
          break;
        }
        case "newConversation":
          await this._newConversation(data.personaId);
          break;
        case "setPersona":
          await this._setPersona(data.personaId);
          break;
        case "selectConversation":
          await this._selectConversation(data.id);
          break;
        case "deleteConversation":
          await this._deleteConversation(data.id);
          break;
        case "persistTurns": {
          const id = data.convId ?? this._activeId;
          // Host owns turns while a run is live; ignore webview snapshots for it.
          if (id && !this._sessions.has(id)) {
            await this._store.update(id, { turns: data.turns });
            this._sendConversations();
          }
          break;
        }
        case "cancelRun": {
          const id = data.convId ?? this._activeId;
          if (id) this._cancelSession(id);
          break;
        }
        case "cancelSubagent":
          // callId is globally unique; abort tool/subagent and settle the card now.
          for (const [cid, s] of this._sessions) {
            const a = s.subagentAborts.get(data.callId);
            // Fire abort first so withToolTimeout(signal) rejects immediately.
            if (a) {
              try { a(); } catch { /* ignore */ }
              // Keep handler until tool loop observes abort (Delete/Read may still be mid-IO).
              // Re-register a no-op-safe re-fire; delete after settle event below.
            }
            // Mark card settled immediately so spinner stops even if the worker
            // never emits a terminal event (timeout / hung process / missing path).
            let hit = false;
            let toolName = "Tool";
            const timedOut = data.reason === "timeout";
            s.turns = s.turns.map((turn) => {
              if (turn.role !== "assistant") return turn;
              let changed = false;
              const blocks = turn.blocks.map((b) => {
                if (b.kind !== "tool" || b.callId !== data.callId) return b;
                toolName = b.name;
                // Always force-settle on cancel/timeout so EDIT/Delete stop spinning.
                if (b.status === "running" || b.subStatus === "running" || timedOut || data.reason === "user") {
                  hit = true;
                  changed = true;
                  const subStatus =
                    b.name === "Task" || b.name === "task" || b.subStatus
                      ? (timedOut ? ("error" as const) : ("cancelled" as const))
                      : b.subStatus;
                  return {
                    ...b,
                    status: "error" as const,
                    result:
                      b.result ||
                      (timedOut
                        ? `(timeout after ${Math.round((b.timeoutMs || 0) / 1000)}s)`
                        : "(cancelled)"),
                    subStatus,
                  };
                }
                return b;
              });
              return changed ? { ...turn, blocks } : turn;
            });
            if (!hit && !a) continue;
            if (a) s.subagentAborts.delete(data.callId);
            this._persistTurnsNow(cid, s);
            const resultMsg = timedOut
              ? `(timeout after tool budget)`
              : "(cancelled)";
            // Always push completed so webview spinner dies even if turns map missed.
            this._view?.webview.postMessage({
              type: "agentEvent",
              convId: cid,
              event: {
                type: "tool-call-completed",
                callId: data.callId,
                name: toolName,
                status: "error",
                result: resultMsg,
              },
            });
            if (toolName === "Task" || toolName === "task") {
              this._view?.webview.postMessage({
                type: "agentEvent",
                convId: cid,
                event: {
                  type: "subagent-event",
                  callId: data.callId,
                  event: { type: "run-status", status: timedOut ? "error" : "cancelled" },
                },
              });
            }
            break;
          }
          break;
        case "resolveApproval":
          await this._resolveApproval(data);
          break;
        case "answerQuestion": {
          for (const s of this._sessions.values()) {
            const resolve = s.pendingQuestions.get(data.callId);
            if (resolve) {
              s.pendingQuestions.delete(data.callId);
              resolve(data.answers || {});
              break;
            }
          }
          break;
        }
        case "setMode":
          this._currentMode = data.mode;
          break;
        case "setActiveTeams":
          await this.featureStore.set({ activeTeamIds: data.teamIds });
          break;
        case "fetchModels":
          await this._handleFetchModels();
          break;
        case "selectModel":
          const settings = this.settingsManager.getSettings();
          settings.model = data.model;
          await this.settingsManager.saveSettings(settings);
          break;
        case "saveModelOptions": {
          const features = this.featureStore.get();
          await this.featureStore.set({ modelOptions: { ...features.modelOptions, [this._optionsKeyFor(data.modelId)]: data.options as ModelOption[] } });
          await this._handleFetchModels();
          break;
        }
        case "resetModelOptions": {
          const features = this.featureStore.get();
          const next = { ...features.modelOptions };
          delete next[this._optionsKeyFor(data.modelId)];
          delete next[stripModelScope(data.modelId)]; // legacy shared record
          await this.featureStore.set({ modelOptions: next });
          await this._handleFetchModels();
          break;
        }
        case "openFile":
          await this._openFile(data.path, data.startLine, data.endLine);
          break;
        case "getFileIcon": {
          const icon = resolveFileIcon(data.filename);
          this._view?.webview.postMessage({ type: "fileIcon", filename: data.filename, icon });
          break;
        }
        case "searchFiles":
          await this._searchFiles(data.query, data.requestId);
          break;
        case "searchMentions":
          await this._searchMentions(data.kind, data.query, data.requestId);
          break;
        case "openMention":
          await this._openMention(data.kind, data.path);
          break;
        case "resolvePastedCode":
          this._view?.webview.postMessage({
            type: "pasteResolved",
            requestId: data.requestId,
            mention: this._resolvePastedCode(data.text),
          });
          break;
        case "acceptChange":
          pendingChanges.accept(data.path);
          break;
        case "rejectChange":
          await pendingChanges.reject(data.path);
          break;
        case "acceptAllChanges":
          pendingChanges.acceptAll();
          break;
        case "rejectAllChanges":
          await pendingChanges.rejectAll();
          break;
        case "diffChange":
          await this._showDiff(data.path);
          break;
        case "logError":
          SidebarProvider.log.appendLine(`[${new Date().toISOString()}] [webview] ${data.message}`);
          if (data.info) SidebarProvider.log.appendLine(data.info);
          break;
        case "openLog":
          SidebarProvider.log.show(true);
          break;
      }
    });
  }

  private _sendPendingChanges() {
    this._view?.webview.postMessage({
      type: "pendingChanges",
      changes: pendingChanges.list().map((c) => {
        let added = 0;
        let removed = 0;
        for (const h of computeHunks(c.before, c.after)) {
          added += h.afterLines.length;
          removed += h.beforeLines.length;
        }
        return { path: c.path, existedBefore: c.existedBefore, added, removed };
      }),
    });
  }

  /** Open VS Code's native diff between the original and current file contents. */
  private async _showDiff(relPath: string) {
    const change = pendingChanges.list().find((c) => c.path === relPath);
    if (!change) {
      await this._openFile(relPath);
      return;
    }
    try {
      // Single shared diff view (see inlineReview) so a file never ends up with
      // two competing diff tabs.
      await vscode.commands.executeCommand("ocursor.viewDiff", relPath);
    } catch (err: any) {
      vscode.window.showErrorMessage(`OpenCursor: Could not show diff: ${err?.message}`);
    }
  }

  /** Fuzzy file/folder search for @-mentions in the composer. */
  private async _searchFiles(query: string, requestId: number) {
    // Same scorer + scan cache as FileSearch / categorized @-mentions.
    let items: { path: string; name: string; kind: "file" | "folder" }[] = [];
    try {
      const hits = await searchFilesAndFolders(query, 30);
      items = hits
        .filter((h) => h.kind === "file" || h.kind === "folder")
        .map((h) => ({ path: h.path, name: h.name, kind: h.kind as "file" | "folder" }));
    } catch {
      items = [];
    }
    this._view?.webview.postMessage({ type: "fileSearchResults", requestId, items });
  }

  /** Categorized @-mention search (Cursor-style typeahead). */
  private async _searchMentions(kind: string, query: string, requestId: number) {
    let items: HostMentionItem[] = [];
    try {
      switch (kind) {
        case "files":
          items = await searchFilesAndFolders(query);
          break;
        case "code":
          items = await searchCode(query);
          break;
        case "docs":
          items = searchDocSources(this.featureStore.get().docSources ?? [], query);
          break;
        case "git":
          items = await searchCommits(query);
          break;
        case "terminals":
          items = searchTerminals(query);
          break;
        case "rules":
          items = await searchRules(query);
          break;
        case "chats": {
          const q = (query || "").toLowerCase();
          items = this._store
            .list()
            .filter((c) => !q || c.title.toLowerCase().includes(q))
            .slice(0, 15)
            .map((c) => ({ kind: "composer" as const, path: c.id, name: c.title, detail: "past chat" }));
          break;
        }
        case "branch":
          items = [branchDiffItem()];
          break;
        case "link":
          items = /^https?:\/\//.test(query) ? [{ kind: "link", path: query, name: query, detail: "fetch page" }] : [];
          break;
      }
    } catch {
      items = [];
    }
    this._view?.webview.postMessage({ type: "mentionSearchResults", requestId, kind, items });
  }

  /** Click on a mention pill: open/select the mentioned object. */
  private async _openMention(kind: string, p: string) {
    try {
      switch (kind) {
        case "code": {
          const m = /^(.+):(\d+)-(\d+)$/.exec(p);
          if (m) await this._openFile(m[1], Number(m[2]), Number(m[3]));
          else await this._openFile(p);
          break;
        }
        case "folder": {
          const base = vscode.workspace.workspaceFolders?.[0]?.uri;
          if (base) await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.joinPath(base, p));
          break;
        }
        case "terminal": {
          const t = vscode.window.terminals.find((t) => t.name === p);
          t ? t.show() : vscode.window.showWarningMessage(`OpenCursor: terminal "${p}" not found`);
          break;
        }
        case "rule":
          await this._openFile(`.cursor/rules/${p}`);
          break;
        case "composer":
          await this._selectConversation(p);
          break;
        case "doc": {
          const doc = (this.featureStore.get().docSources ?? []).find((d) => d.id === p);
          if (doc) await vscode.env.openExternal(vscode.Uri.parse(doc.url));
          break;
        }
        case "link":
          await vscode.env.openExternal(vscode.Uri.parse(p));
          break;
        case "git": {
          // Show the commit in a readonly virtual doc.
          const { spawn } = await import("child_process");
          const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
          const out = await new Promise<string>((res) => {
            const c = spawn("git", ["show", p], { cwd: root });
            let o = "";
            c.stdout.on("data", (d) => (o += d));
            c.on("error", () => res(""));
            c.on("close", () => res(o));
          });
          if (out) {
            const doc = await vscode.workspace.openTextDocument({ content: out, language: "diff" });
            await vscode.window.showTextDocument(doc, { preview: true });
          }
          break;
        }
        case "branch_diff":
          await vscode.commands.executeCommand("workbench.view.scm");
          break;
        default:
          await this._openFile(p);
      }
    } catch (e: any) {
      SidebarProvider.log.appendLine(`[openMention] ${kind} ${p}: ${e?.message || e}`);
    }
  }

  private async _openFile(relPath: string, startLine?: number, endLine?: number) {
    if (!relPath) {
      return;
    }
    try {
      // Use the same resolver as tools so model-facing `/workspace/...` paths
      // become this workspace on Windows instead of the nonexistent C:\workspace.
      const uri = vscode.Uri.file(safePath(relPath));
      // Race open so a missing/network path cannot hang the extension host forever.
      const doc = await Promise.race([
        vscode.workspace.openTextDocument(uri),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("timed out opening file (path missing or unreachable)")), 5_000),
        ),
      ]);
      const editor = await vscode.window.showTextDocument(doc, { preview: true });
      if (startLine) {
        const s = Math.max(0, startLine - 1);
        const e = Math.max(s, (endLine ?? startLine) - 1);
        const endChar = doc.lineAt(Math.min(e, doc.lineCount - 1)).text.length;
        const range = new vscode.Range(s, 0, Math.min(e, doc.lineCount - 1), endChar);
        editor.selection = new vscode.Selection(range.start, range.end);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
      }
    } catch (err: any) {
      logError("ui.open-file", err, { path: relPath });
      vscode.window.showErrorMessage(`OpenCursor: Could not open ${relPath}: ${err?.message || err}`);
    }
  }

  private async _sendInitialState() {
    const settings = this.settingsManager.getSettings();
    // Resolve active conversation (or leave empty until first message).
    this._activeId = this._store.getActiveId();
    if (this._activeId && !this._store.get(this._activeId)) {
      this._activeId = undefined;
    }
    const active = this._activeId ? this._store.get(this._activeId) : undefined;
    const features = this.featureStore.get();
    this._view?.webview.postMessage({
      type: "initialState",
      mode: this._currentMode,
      selectedModel: settings.model,
      activeId: this._activeId,
      turns: this._turnsFor(this._activeId),
      usedTokens: active?.usedTokens,
      personas: allPersonas(features.customPersonas).map((p) => ({ id: p.id, name: p.name, description: p.description })),
      activePersonaId: active?.personaId ?? features.activePersonaId,
      hasProviders: features.providers.some(providerEnabled) || oauth.hasAnyAccount(),
      teams: this._teamSummaries(features),
      activeTeamIds: features.activeTeamIds ?? [],
      runningConvIds: [...this._sessions.keys()],
      uiPrefs: {
        chatTextSize: features.chatTextSize ?? "default",
        submitWithCtrlEnter: features.submitWithCtrlEnter === true,
        maxTabCount: features.maxTabCount ?? 0,
        completionSound: features.completionSound === true,
      },
    });
    this._sendConversations();
    this._sendPendingChanges();
    // Re-surface any approvals still waiting (webview may have been reloaded).
    for (const session of this._sessions.values()) {
      for (const { info } of session.pendingApprovals.values()) {
        this._view?.webview.postMessage({ type: "approvalRequest", convId: info.convId, request: info });
      }
    }
    await this._handleFetchModels();
  }

  /** Persist a running session's authoritative turns immediately. */
  private _persistTurnsNow(convId: string, session: RunSession) {
    if (session.persistTimer) { clearTimeout(session.persistTimer); session.persistTimer = undefined; }
    void this._store.update(convId, { turns: session.turns });
  }

  /** Throttle persistence of live turns (~1/sec) during a run. */
  private _schedulePersistTurns(convId: string, session: RunSession) {
    if (session.persistTimer) return;
    session.persistTimer = setTimeout(() => {
      session.persistTimer = undefined;
      void this._store.update(convId, { turns: session.turns });
    }, 800);
  }

  /** Authoritative turns for a conversation: live session turns if running, else stored. */
  private _turnsFor(convId?: string): Turn[] {
    if (!convId) return [];
    const live = this._sessions.get(convId);
    if (live) return live.turns;
    return this._store.get(convId)?.turns ?? [];
  }

  /**
   * Drop turns (and the matching model-history steps) at/after `turnIndex` so an
   * edited message can be re-sent as if the later conversation never happened.
   * Turn `turnIndex` (the edited user turn) is removed too — it is re-appended by
   * the caller with the new text/model. Steps align by counting user steps: keep
   * everything before the Nth user step, where N = user turns before `turnIndex`.
   */
  private _truncateConversation(convId: string, turnIndex: number) {
    const conv = this._store.get(convId);
    if (!conv) return;
    const turns = conv.turns.slice(0, turnIndex);
    // Count user turns kept — that's how many user steps to keep.
    const keepUserSteps = turns.filter((t) => t.role === "user").length;
    let seen = 0;
    let cut = conv.steps.length;
    for (let i = 0; i < conv.steps.length; i++) {
      if (conv.steps[i].kind === "user") {
        if (seen === keepUserSteps) { cut = i; break; }
        seen++;
      }
    }
    const steps = conv.steps.slice(0, cut);
    void this._store.update(convId, { turns, steps });
  }

  private _sendConversations() {
    this._view?.webview.postMessage({
      type: "conversations",
      list: this._store.list(),
      activeId: this._activeId,
      runningConvIds: [...this._sessions.keys()],
    });
  }

  private async _newConversation(personaId?: string) {
    const features = this.featureStore.get();
    // sessionEnd for the chat being left, sessionStart for the new one.
    if (this._activeId) runHooks(features.hooks, "sessionEnd", { conversation: this._activeId });
    runHooks(features.hooks, "sessionStart", {});
    this._pendingPersonaId = personaId ?? features.activePersonaId;
    // Only create a fresh record when the active one already has messages.
    const active = this._activeId ? this._store.get(this._activeId) : undefined;
    if (active && active.steps.length === 0) {
      // Active conversation is already empty — reuse it; just set its persona.
      await this._store.update(active.id, { personaId: this._pendingPersonaId });
      this._view?.webview.postMessage({ type: "loadConversation", activeId: this._activeId, turns: [], personaId: this._pendingPersonaId });
      return;
    }
    this._activeId = undefined;
    await this._store.setActiveId(undefined);
    this._view?.webview.postMessage({ type: "loadConversation", activeId: undefined, turns: [], personaId: this._pendingPersonaId });
    this._sendConversations();
  }

  private async _setPersona(personaId: string) {
    const conv = this._activeId ? this._store.get(this._activeId) : undefined;
    if (conv) {
      // Persona is locked once the chat has started.
      if (conv.steps.length > 0) {
        return;
      }
      await this._store.update(this._activeId!, { personaId });
    } else {
      this._pendingPersonaId = personaId;
    }
  }

  private async _selectConversation(id: string) {
    const conv = this._store.get(id);
    if (!conv) {
      return;
    }
    this._activeId = id;
    await this._store.setActiveId(id);
    const features = this.featureStore.get();
    this._view?.webview.postMessage({ type: "loadConversation", activeId: id, turns: this._turnsFor(id), personaId: conv.personaId ?? features.activePersonaId, usedTokens: conv.usedTokens });
    this._sendConversations();
  }

  private async _deleteConversation(id: string) {
    await this._store.delete(id);
    if (this._activeId === id) {
      this._activeId = undefined;
      this._view?.webview.postMessage({ type: "loadConversation", activeId: undefined, turns: [] });
    }
    this._sendConversations();
  }

  /** Team list for the composer's Project-mode picker (member names resolved). */
  private _teamSummaries(features: ReturnType<FeatureStore["get"]>) {
    return (features.teams ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      members: t.subagentIds
        .map((sid) => features.subagents.find((s) => s.id === sid)?.name)
        .filter((n): n is string => !!n),
    }));
  }

  /** Push live persona list + provider availability to the webview. */
  private _sendConfigState() {
    const features = this.featureStore.get();
    const active = this._activeId ? this._store.get(this._activeId) : undefined;
    this._view?.webview.postMessage({
      type: "configState",
      personas: allPersonas(features.customPersonas).map((p) => ({ id: p.id, name: p.name, description: p.description })),
      activePersonaId: active?.personaId ?? features.activePersonaId,
      hasProviders: features.providers.some(providerEnabled) || oauth.hasAnyAccount(),
      teams: this._teamSummaries(features),
      activeTeamIds: features.activeTeamIds ?? [],
      uiPrefs: {
        chatTextSize: features.chatTextSize ?? "default",
        submitWithCtrlEnter: features.submitWithCtrlEnter === true,
        maxTabCount: features.maxTabCount ?? 0,
        completionSound: features.completionSound === true,
      },
    });
  }

  /** Resolve the system prompt for the active conversation's persona. */
  private _personaPromptFor(convId: string | undefined, features: ReturnType<FeatureStore["get"]>): string {
    const personas = allPersonas(features.customPersonas);
    const conv = convId ? this._store.get(convId) : undefined;
    const personaId = conv?.personaId ?? features.activePersonaId;
    return getPersona(personas, personaId).prompt;
  }

  /** Await the user's answers to an ask_question wizard (resolved by the webview). */
  private _askUser(session: RunSession, callId: string, signal?: AbortSignal): Promise<Record<string, string[]>> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        const err = new Error("cancelled");
        err.name = "AbortError";
        reject(err);
        return;
      }
      session.pendingQuestions.set(callId, resolve);
      signal?.addEventListener("abort", () => {
        if (session.pendingQuestions.has(callId)) {
          session.pendingQuestions.delete(callId);
          const err = new Error("cancelled");
          err.name = "AbortError";
          reject(err);
        }
      });
    });
  }

  /** Ask for approval in the chat UI; resolves when the user decides (or the run aborts). */
  private async _approveTool(convId: string, session: RunSession, toolName: string, input: any, callId?: string): Promise<boolean | { approved: false; blockedSubject: string }> {
    const decision = this._evaluatePolicy(toolName, input);
    if (decision === "allow") return true;
    const type = actionTypeForCall(toolName, input, getWorkspaceRoot())!;
    if (decision === "deny") {
      // Report the chained command that actually tripped the rule, not the first
      // one on the line (`git add -A; git commit` must name `git commit`).
      const blocked = deniedSubject(this._approvalPolicy(), toolName, input, getWorkspaceRoot());
      return type === "shell" ? { approved: false, blockedSubject: blocked || subjectFor(type, toolName, input) || toolName } : false;
    }

    const subject = subjectFor(type, toolName, input);
    const detail =
      type === "outside"
        ? `access outside workspace: ${subject}`
        : toolName === "Shell"
          ? `$ ${subject}`
          : toolName === "Delete"
            ? `delete ${subject}`
            : toolName === "StrReplace" || toolName === "Write" || toolName === "EditNotebook"
              ? `edit ${subject}`
              : toolName === "WebSearch"
                ? `search: ${subject}`
                : toolName === "WebFetch"
                  ? `fetch ${subject}`
                  : toolName;
    const info: PendingApproval = {
      requestId: `apr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      convId,
      callId,
      toolName,
      actionType: type,
      subject,
      detail,
      suggestion: suggestPattern(type, toolName, subject),
      input,
    };
    return new Promise<boolean>((resolve) => {
      const settle = (ok: boolean) => {
        if (!session.pendingApprovals.has(info.requestId)) return;
        session.pendingApprovals.delete(info.requestId);
        this._view?.webview.postMessage({ type: "approvalResolved", convId, requestId: info.requestId, approved: ok });
        resolve(ok);
      };
      session.pendingApprovals.set(info.requestId, { info, resolve: settle });
      this._view?.webview.postMessage({ type: "approvalRequest", convId, request: info });
      // Cancelling the run denies anything still pending.
      session.abort.signal.addEventListener("abort", () => settle(false));
    });
  }

  /** The effective approval policy (user settings over safe defaults). */
  private _approvalPolicy(): ApprovalPolicy {
    return { ...DEFAULT_APPROVAL, ...(this.featureStore.get().approvalPolicy ?? {}) };
  }

  /** Evaluate the current approval policy for a tool call. */
  private _evaluatePolicy(toolName: string, input: any): "allow" | "ask" | "deny" {
    return evaluateApproval(this._approvalPolicy(), toolName, input, getWorkspaceRoot());
  }

  /** Handle the webview's decision on a pending approval (optionally updating global policy). */
  private async _resolveApproval(data: { requestId: string; approve?: boolean; pattern?: string; addPattern?: "allow" | "deny"; setMode?: ApprovalMode }) {
    for (const session of this._sessions.values()) {
      const p = session.pendingApprovals.get(data.requestId);
      if (!p) continue;
      const { info } = p;

      // Persist policy changes first (pattern additions / mode change → Behavior tab).
      const features = this.featureStore.get();
      const policy: ApprovalPolicy = { ...DEFAULT_APPROVAL, ...(features.approvalPolicy ?? {}) };
      const rule = { ...(policy[info.actionType] ?? DEFAULT_APPROVAL[info.actionType]) };
      let changed = false;
      if (data.setMode && rule.mode !== data.setMode) {
        rule.mode = data.setMode;
        changed = true;
      }
      if (data.pattern?.trim()) {
        const key = data.addPattern === "deny" ? "denylist" : "allowlist";
        if (!rule[key].includes(data.pattern.trim())) {
          rule[key] = [...rule[key], data.pattern.trim()];
          changed = true;
        }
      }
      if (changed) {
        await this.featureStore.set({ approvalPolicy: { ...policy, [info.actionType]: rule } });
      }

      if (data.approve !== undefined) {
        p.resolve(!!data.approve);
      } else {
        // Only the policy changed — re-evaluate; keep asking if still "ask".
        const decision = this._evaluatePolicy(info.toolName, info.input);
        if (decision !== "ask") p.resolve(decision === "allow");
      }
      return;
    }
  }

  /**
   * Resolve the active provider (Providers tab) into the connection details a
   * request needs. Falls back to the legacy General-tab settings when no
   * provider is configured/active.
   */
  /** Kind-scoped modelOptions key ("<kind>:<id>") for a scoped picker id, so the
   *  same model id keeps separate option state per provider (anthropic vs claude-code). */
  private _optionsKeyFor(scopedId: string): string {
    const sep = scopedId.indexOf("::");
    const realId = sep >= 0 ? scopedId.slice(sep + 2) : scopedId;
    const providerId = sep >= 0 ? scopedId.slice(0, sep) : undefined;
    if (!providerId) return realId;
    const kind = providerId.startsWith("__oauth__:")
      ? providerId.slice("__oauth__:".length)
      : this.featureStore.get().providers.find((p) => p.id === providerId)?.kind;
    return kind ? `${kind}:${realId}` : realId;
  }

  /** Enabled providers (multi-provider). Falls back to all configured if none flagged. */
  private _enabledProviders(): ProviderConfig[] {
    const features = this.featureStore.get();
    return features.providers.filter(providerEnabled);
  }

  /** Whether a model id maps to a managed local llama.cpp model. */
  private _localModel(modelId: string) {
    const bare = stripModelScope(modelId);
    return this.featureStore.get().llamacppModels.find((m) => m.id === modelId || m.id === bare);
  }

  /**
   * Resolve the provider that serves a given model id into connection details.
   * For local models, pass `{ load: true }` to spawn the server if not already
   * running; otherwise the URL is returned without starting it.
   */
  private async _resolveProviderForModel(modelId: string, opts?: { load?: boolean }): Promise<{ baseUrl: string; apiKey: string; model: string; anthropic: boolean; providerId?: string; oauthKind?: oauth.OAuthKind }> {
    const settings = this.settingsManager.getSettings();
    const features = this.featureStore.get();
    const enabled = this._enabledProviders();
    // Picker ids are provider-scoped composites ("<providerId>::<modelId>") so the
    // same model from different providers stays distinct. Split → route exactly.
    const sep = modelId.indexOf("::");
    const scopedProvider = sep >= 0 ? modelId.slice(0, sep) : undefined;
    modelId = stripModelScope(modelId);
    // OAuth account model: route by the exact scoped account kind when present,
    // else fall back to the model→kind map (legacy / bare ids).
    const oauthKind = (scopedProvider?.startsWith("__oauth__:")
      ? (scopedProvider.slice("__oauth__:".length) as oauth.OAuthKind)
      : scopedProvider && (["claude-code", "codex", "antigravity"] as string[]).includes(scopedProvider)
        ? (scopedProvider as oauth.OAuthKind)
        : undefined) ?? this._oauthModelKind.get(modelId);
    if (oauthKind) {

      return { baseUrl: "", apiKey: "", model: modelId, anthropic: false, providerId: oauthKind, oauthKind };
    }
    // Local llama.cpp model: served by the extension's own server, no provider
    // entry required. Ensure it's loaded, then point at its local /v1 endpoint.
    const local = features.llamacppModels.find((m) => m.id === modelId);
    if (local) {
      if (opts?.load) await ensureLoaded(local, features.llamacppConfig);
      // llama-server's /v1 serves the loaded model regardless of the id sent,
      // but pass the gguf basename so logs/aliases line up.
      return { baseUrl: serverUrlFor(local, features.llamacppConfig), apiKey: "", model: local.file || modelId, anthropic: false, providerId: "llamacpp" };
    }
    // Locally-pulled Ollama model: served by the daemon's /v1, no provider entry.
    if (this._ollamaModelIds.has(modelId)) {
      return { baseUrl: ollama.ollamaOpenAIBase(), apiKey: "", model: modelId, anthropic: false, providerId: "ollama" };
    }
    // 0) Provider-scoped composite id → route to that exact provider.
    let prov: ProviderConfig | undefined;
    if (scopedProvider) prov = enabled.find((p) => p.id === scopedProvider);
    // 1) Catalog/custom model → its tagged provider, else first of matching kind.
    const def = this.featureStore.allModels().find((m) => m.id === modelId);
    if (!prov && def) {
      if (def.providerId) prov = enabled.find((p) => p.id === def.providerId);
      // Catalog models only route to popular (built-in) providers by kind.
      if (!prov) prov = enabled.find((p) => p.id.startsWith("popular:") && kindMatches(def.kind, p.kind)) || enabled.find((p) => p.kind === "openrouter");
    }
    // 1b) Non-catalog fetched model → route to the exact provider that served it.
    if (!prov && !def) {
      const pid = this._modelProvider.get(modelId);
      if (pid) prov = enabled.find((p) => p.id === pid);
    }
    // 2) Otherwise first enabled provider.
    if (!prov) prov = enabled[0] || features.providers[0];
    if (prov) {
      const apiKey = (await this.settingsManager.getProviderKey(prov.id)) || "";
      return { baseUrl: prov.baseUrl, apiKey, model: modelId, anthropic: prov.kind === "anthropic", providerId: prov.id };
    }
    // No provider configured at all — surface a clear error downstream.
    return { baseUrl: "", apiKey: "", model: modelId, anthropic: false };
  }

  /** Context window for a model: llama.cpp ctx length, else the model's
   *  max_context option ("200k"/"1m"…), else a safe 200k default. */
  private _contextTokensFor(modelId: string, oauthKind?: string): number {
    const f = this.featureStore.get();
    const bare = stripModelScope(modelId);
    const m = f.llamacppModels.find((x) => x.id === modelId || x.id === bare);
    if (m) return effectiveContextLength(m, f.llamacppContextLength);
    const opt = this.featureStore.optionsFor(bare, oauthKind).find((o) => o.key === "max_context")?.value;
    return parseContextLabel(opt) || 128_000;
  }

  /** Build the picker model list from ALL enabled providers. */
  private _buildModelList(fetched: { providerId: string; ids: string[] }[]): ModelDef[] {
    const features = this.featureStore.get();
    const enabled = this._enabledProviders();
    // enabledModels is the authoritative allow-list. Catalog models are enabled by
    // default; any other provider model stays disabled until the user enables it.
    // Empty set = legacy/fresh config → fall back to "all catalog enabled".
    const enabledSet = new Set(features.enabledModels.length ? features.enabledModels : this.featureStore.allModels().filter((m) => m.enabled !== false).map((m) => m.id));
    // Only catalog models enabled by default count as auto-on for fetched/OAuth ids.
    const catalogIds = new Set(MODEL_CATALOG.filter((m) => m.enabled !== false).map((m) => m.id));
    // Explicit user opt-outs always win (Models page toggle-off of a catalog default).
    const disabledSet = new Set(features.disabledModels ?? []);
    // Local models (llama.cpp / Ollama) are shown unless explicitly disabled.
    const disabledLocal = new Set(features.disabledLocalModels ?? []);
    const out: ModelDef[] = [];
    const seen = new Set<string>();
    const kinds = new Set(enabled.map((p) => p.kind));
    const hasRouter = kinds.has("openrouter") || kinds.has("ollama") || kinds.has("llamacpp");
    // Catalog/default models served by an enabled provider of matching kind.
    for (const m of this.featureStore.allModels()) {
      // Catalog models default-on; only filter when explicitly disabled.
      if (disabledSet.has(m.id) || !enabledSet.has(m.id)) continue;
      // Custom models tagged to a specific provider route there; else by kind.
      // Catalog models only match popular (built-in) providers — a custom
      // "OpenAI-compatible" endpoint serves its own fetched models, not the catalog.
      const prov = (m.providerId && enabled.find((p) => p.id === m.providerId))
        || enabled.find((p) => p.id.startsWith("popular:") && kindMatches(m.kind, p.kind))
        || (hasRouter && !Array.isArray(m.kind) && !["claude-code", "codex", "antigravity"].includes(m.kind)
          ? enabled.find((p) => p.kind === "openrouter" || p.kind === "ollama" || p.kind === "llamacpp") : undefined);
      if (!prov) continue;
      out.push({ ...m, id: `${prov.id}::${m.id}`, modelId: m.id, options: this.featureStore.optionsFor(m.id, prov.kind), group: "default", providerId: prov.id, providerName: prov.name });
      seen.add(`${prov.id}::${m.id}`);
    }
    // Connected OAuth providers also expose enabled catalog/custom models even
    // when their live model endpoint omits those IDs.
    for (const { providerId } of fetched) {
      if (!providerId.startsWith("__oauth__:")) continue;
      const kind = providerId.slice("__oauth__:".length) as oauth.OAuthKind;
      const label = oauth.OAUTH_LABEL[kind];
      const base = kind === "claude-code" ? "anthropic" : kind === "codex" ? "openai" : "google";
      for (const m of this.featureStore.allModels()) {
        if (m.providerId !== `oauth:${kind}` && !kindMatches(m.kind, kind)) continue;
        const pid = `${providerId}::${m.id}`;
        if (seen.has(pid) || disabledSet.has(m.id) || (!enabledSet.has(m.id) && !catalogIds.has(m.id))) continue;
        out.push({ ...m, id: pid, modelId: m.id, options: this.featureStore.optionsFor(m.id, kind), group: "other", providerId, providerName: label, kind: base as ModelDef["kind"] });
        seen.add(pid);
      }
    }
    // Fetched curated models per provider. Ollama models are surfaced as local
    // models in their own group (shown unless disabled), not the allowlist.
    for (const { providerId, ids } of fetched) {
      // OAuth account models (Claude Code / Codex): own group, toggle via disabledLocal.
      if (providerId.startsWith("__oauth__:")) {
        const kind = providerId.slice("__oauth__:".length) as oauth.OAuthKind;
        const label = oauth.OAUTH_LABEL[kind];
        const base = kind === "claude-code" ? "anthropic" : kind === "codex" ? "openai" : "google";
        for (const id of ids) {
          const pid = `${providerId}::${id}`;
          if (seen.has(pid)) continue;
          // Account models are disabled by default unless explicitly enabled,
          // except for curated catalog entries that are default-on.
          if (disabledSet.has(id) || (!enabledSet.has(id) && !catalogIds.has(id))) continue;
          // Kind-scoped lookup: prefer a def declared for this OAuth kind, then
          // the base API kind — so the same id can have per-provider names/options.
          out.push({ id: pid, modelId: id, name: this.featureStore.nameFor(id, kind), kind: base as ModelDef["kind"], options: this.featureStore.optionsFor(id, kind), group: "other", providerId, providerName: label });
          seen.add(pid);
        }
        continue;
      }
      // Synthetic Ollama entry (or an explicit ollama-kind provider): local group.
      const ollamaProv = enabled.find((p) => p.kind === "ollama");
      const isOllama = providerId === "__ollama__" || ollamaProv?.id === providerId;
      if (isOllama) {
        for (const id of ids) {
          const pid = `ollama::${id}`;
          if (seen.has(pid) || disabledLocal.has(id)) continue;
          out.push({ id: pid, modelId: id, name: id, kind: "ollama", options: this.featureStore.optionsFor(id), group: "default", providerId: "ollama", providerName: "Local (Ollama)" });
          seen.add(pid);
        }
        continue;
      }
      const prov = enabled.find((p) => p.id === providerId);
      if (!prov) continue;
      for (const id of ids) {
        const pid = `${prov.id}::${id}`;
        if (seen.has(pid)) continue;
        // Fetched provider models are disabled by default unless explicitly enabled
        // (or already in the curated catalog).
        if (disabledSet.has(id) || (!enabledSet.has(id) && !catalogIds.has(id))) continue;
        out.push({ id: pid, modelId: id, name: this.featureStore.nameFor(id), kind: prov.kind, options: this.featureStore.optionsFor(id, prov.kind), group: "other", providerId: prov.id, providerName: prov.name });
        seen.add(pid);
      }
    }
    // Local llama.cpp models are selectable unless disabled — no provider entry
    // needed. Selecting one auto-loads its server and routes to local /v1.
    for (const m of features.llamacppModels) {
      const pid = `llamacpp::${m.id}`;
      if (seen.has(pid)) continue;
      if (disabledLocal.has(m.id)) continue;
      // Expose the effective ctx so the composer ring's total matches what the trimmer uses.
      const ctx = effectiveContextLength(m, features.llamacppContextLength);
      const ctxLabel = ctx >= 1_000_000 ? `${ctx / 1_000_000}m` : `${Math.round(ctx / 1000)}k`;
      out.push({ id: pid, modelId: m.id, name: m.name, kind: "llamacpp", options: [{ key: "max_context", label: "Context", type: "select", values: [ctxLabel], value: ctxLabel }], group: "default", providerId: "llamacpp", providerName: "Local (llama.cpp)" });
      seen.add(pid);
    }
    return out;
  }

  /**
   * Bare model ids the given provider/OAuth account can actually serve. Used to
   * reject subagent model slugs the agent invented or borrowed from another provider.
   */
  private _modelsForProvider(providerId?: string, oauthKind?: oauth.OAuthKind): string[] {
    const list = this._buildModelList(this._fetchedCache ?? []);
    const wanted = oauthKind ? `__oauth__:${oauthKind}` : providerId;
    if (!wanted) return [];
    return [...new Set(list.filter((m) => m.providerId === wanted).map((m) => m.modelId || stripModelScope(m.id)))];
  }

  /** Auto mode: ask the judge model to choose an enabled model for the task. */
  private async _resolveAutoModel(task: string): Promise<string> {
    const features = this.featureStore.get();
    const candidates = this._buildModelList([]).map((m) => m.id).filter((id) => id !== "auto");
    if (candidates.length === 0) return this.settingsManager.getSettings().model || "";
    if (candidates.length === 1) return candidates[0];
    const judge = features.autoJudgeModel || candidates[0];
    try {
      const jprov = await this._resolveProviderForModel(judge);
      // Local judge whose server isn't running would need a full model load just
      // to route — not worth it; fall back to the first candidate instead.
      const judgeIsLocal = !!this._localModel(judge);
      if (judgeIsLocal && !isRunning(stripModelScope(judge))) return candidates[0];
      if (!jprov.oauthKind && !jprov.baseUrl) return candidates[0]; // unroutable judge
      const picked = await pickModel(jprov.baseUrl, jprov.apiKey, jprov.model, candidates, task, jprov.anthropic, jprov.oauthKind);
      if (picked && candidates.includes(picked)) return picked;
      // Judge may reply with a bare model id (no provider scope) — match it.
      const scoped = candidates.find((c) => stripModelScope(c) === stripModelScope(picked));
      if (scoped) return scoped;
    } catch {
      // fall through to default
    }
    return candidates[0];
  }

  /**
   * Publish a fetched id map to the webview + routing tables.
   * Rebuilds ModelDef options from featureStore (cheap, no network).
   */
  private _publishFetched(fetched: { providerId: string; ids: string[] }[]) {
    this._ollamaModelIds = new Set(fetched.find((f) => f.providerId === "__ollama__")?.ids ?? []);
    this._oauthModelKind = new Map();
    for (const { providerId, ids } of fetched) {
      if (!providerId.startsWith("__oauth__:")) continue;
      const kind = providerId.slice("__oauth__:".length) as oauth.OAuthKind;
      for (const id of ids) if (!this._oauthModelKind.has(id)) this._oauthModelKind.set(id, kind);
    }
    this._modelProvider = new Map();
    for (const { providerId, ids } of fetched) {
      if (providerId === "__ollama__" || providerId.startsWith("__oauth__:")) continue;
      for (const id of ids) if (!this._modelProvider.has(id)) this._modelProvider.set(id, providerId);
    }
    const allIds = fetched.flatMap((f) => f.ids);
    const modelList = this._buildModelList(fetched);
    const settings = this.settingsManager.getSettings();
    if (settings.model === "auto" || (settings.model && !modelList.some((m) => m.id === settings.model))) {
      settings.model = modelList[0]?.id || "";
      void this.settingsManager.saveSettings(settings).then(() => {
        this._view?.webview.postMessage({ type: "modelSelected", model: settings.model });
      });
    }
    this._view?.webview.postMessage({ type: "modelsFetched", models: allIds, modelList });
  }

  /**
   * Paint cache immediately (no wait), then always list models from providers.
   * Cache is startup UX only — never skips a network refresh.
   */
  private async _handleFetchModels() {
    // Instant paint from last session / memory (or catalog-only if cold).
    this._publishFetched(this._fetchedCache || []);

    // Coalesce concurrent callers onto one in-flight list (still always runs).
    if (this._fetchInflight) return this._fetchInflight;

    this._fetchInflight = this._networkFetchModels().finally(() => {
      this._fetchInflight = null;
    });
    return this._fetchInflight;
  }

  private async _networkFetchModels() {
    const enabled = this._enabledProviders();
    const [providerFetched, ollamaIds, ...oauthBatches] = await Promise.all([
      Promise.all(
        enabled.map(async (p) => {
          const apiKey = (await this.settingsManager.getProviderKey(p.id)) || "";
          const anthropic = p.kind === "anthropic";
          if (!apiKey && anthropic) return { providerId: p.id, ids: [] as string[] };
          try {
            const models = await listModels(p.baseUrl, apiKey, anthropic);
            return { providerId: p.id, ids: models.map((m) => m.id) };
          } catch {
            return { providerId: p.id, ids: [] as string[] };
          }
        }),
      ),
      ollama.listModels().then((ms) => ms.map((m) => m.name)).catch(() => [] as string[]),
      ...(["claude-code", "codex", "antigravity"] as oauth.OAuthKind[]).map(async (kind) => {
        if (!oauth.isConnected(kind)) return { kind, ids: [] as string[] };
        try {
          return { kind, ids: await oauth.listOAuthModels(kind) };
        } catch {
          return { kind, ids: [] as string[] };
        }
      }),
    ]);

    const fetched = [...providerFetched];
    if (ollamaIds.length) fetched.push({ providerId: "__ollama__", ids: ollamaIds });
    for (const { kind, ids } of oauthBatches) {
      if (ids.length) fetched.push({ providerId: `__oauth__:${kind}`, ids });
    }

    this._fetchedCache = fetched;
    void this.context.globalState.update(SidebarProvider.MODELS_CACHE_KEY, { fetched });
    this._publishFetched(fetched);
  }

  private async _browseAttachments() {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: "Attach",
      filters: { Attachments: ["png", "jpg", "jpeg", "gif", "webp", "txt", "md", "json", "ts", "tsx", "js", "jsx", "py", "css", "html"] },
    });
    if (!uris || uris.length === 0) {
      return;
    }
    const attachments: Attachment[] = [];
    for (const uri of uris) {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const name = uri.path.split("/").pop() || "file";
        const ext = name.split(".").pop()?.toLowerCase() || "";
        const imageExt: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
        if (imageExt[ext]) {
          const b64 = Buffer.from(bytes).toString("base64");
          attachments.push({ id: `a_${Date.now()}_${attachments.length}`, name, mime: imageExt[ext], data: `data:${imageExt[ext]};base64,${b64}`, kind: "image" });
        } else {
          const text = Buffer.from(bytes).toString("utf8");
          attachments.push({ id: `a_${Date.now()}_${attachments.length}`, name, mime: "text/plain", data: text, kind: "text" });
        }
      } catch {
        // skip unreadable file
      }
    }
    if (attachments.length) {
      this._view?.webview.postMessage({ type: "attachmentsPicked", attachments });
    }
  }

  private async _handleMessage(
    text: string,
    attachments?: Attachment[],
    edit?: { fromIndex?: number; model?: string; mode?: string; revertFiles?: boolean },
  ) {
    if (!text.trim() && (!attachments || attachments.length === 0)) {
      vscode.window.showWarningMessage("OpenCursor: Message cannot be empty");
      return;
    }

    // Mentions live IN the text as self-contained tokens "@[kind:name](path)",
    // so they survive edits/reloads. Parse them out and resolve into context
    // blocks appended to the prompt. Best-effort; failures are skipped.
    const docSources = this.featureStore.get().docSources ?? [];
    const mentions = parseMentionTokens(text) as HostMentionItem[];
    let mentionContext = "";
    if (mentions.length) {
      mentionContext = await resolveMentions(mentions, text, docSources, {
        summarize: (convId) => {
          const conv = this._store.get(convId);
          if (!conv) return undefined;
          return conv.turns
            .map((t: any) => `${t.role === "user" ? "User" : "Assistant"}: ${(t.text || "").slice(0, 600)}`)
            .join("\n")
            .slice(0, 6000);
        },
      }).catch(() => "");
    }

    // Editing an earlier message: truncate persisted turns + model history to
    // that point, and optionally revert still-pending file edits made after it.
    if (edit?.fromIndex != null && this._activeId && this._store.get(this._activeId)) {
      if (edit.revertFiles) await pendingChanges.rejectAll();
      this._truncateConversation(this._activeId, edit.fromIndex);
    }
    // Per-message model/mode overrides (from an edited bubble) take precedence.
    if (edit?.model) {
      const s = this.settingsManager.getSettings();
      s.model = edit.model;
      await this.settingsManager.saveSettings(s);
    }
    if (edit?.mode) this._currentMode = edit.mode as Mode;

    const settings = this.settingsManager.getSettings();
    let modelId = settings.model;
    // Auto mode is hidden for now; a lingering "auto" selection (or empty)
    // resolves to the first enabled model. (Judge-based routing kept in
    // _resolveAutoModel for when Auto returns.)
    if (modelId === "auto" || !modelId) {
      modelId = this._buildModelList([]).find((m) => m.id !== "auto")?.id || modelId;
    }
    // Resolve connection details without starting a local server yet — we want
    // the chat UI to show a "loading model" state while it boots (below).
    const prov = await this._resolveProviderForModel(modelId, { load: false });
    const apiKey = prov.apiKey;

    if (!apiKey && prov.anthropic) {
      vscode.window.showErrorMessage("OpenCursor: Missing API key. Please open settings to add one.");
      this._view?.webview.postMessage({
        type: "error",
        message: "Missing API Key. Provide it in Settings.",
      });
      return;
    }

    // Ensure there is an active conversation backing this run.
    if (!this._activeId || !this._store.get(this._activeId)) {
      const features = this.featureStore.get();
      const personaId = this._pendingPersonaId ?? features.activePersonaId;
      const conv = await this._store.create(personaId);
      this._activeId = conv.id;
      this._pendingPersonaId = undefined;
    }
    // Bind this run to a fixed conversation id; switching chats must not affect it.
    const convId = this._activeId;
    // A run is already in flight (e.g. "send now" on a queued message): abort it
    // and wait for its `finally` to clear the session, then start this run.
    const existing = this._sessions.get(convId);
    if (existing) {
      existing.abort.abort();
      for (let i = 0; i < 100 && this._sessions.has(convId); i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      if (this._sessions.has(convId)) {
        vscode.window.showWarningMessage("OpenCursor: This chat is already running.");
        return;
      }
    }
    const isFirstMessage = (this._store.get(convId)?.steps.length ?? 0) === 0;
    if (isFirstMessage) {
      const fallback = text.trim() ? titleFromText(renderMentionTokens(text)) : attachments?.length ? `${attachments.length} attachment(s)` : "New chat";
      await this._store.update(convId, { title: fallback });
    }
    const history = this._store.get(convId)?.steps ?? [];

    // Host owns the authoritative UI turns: seed from persisted turns + this
    // user message, then accumulate streamed events below. The webview is just a
    // renderer, so closing/moving/reopening it never loses or breaks the run.
    const seededTurns: Turn[] = [
      ...(this._store.get(convId)?.turns ?? []),
      { role: "user" as const, text, attachments: attachments?.length ? (attachments as any) : undefined, model: settings.model, mode: this._currentMode },
    ];
    const session: RunSession = {
      abort: new AbortController(),
      subagentAborts: new Map(),
      pendingQuestions: new Map(),
      pendingApprovals: new Map(),
      turns: seededTurns,
    };
    this._sessions.set(convId, session);

    const features = this.featureStore.get();
    const mode = this._currentMode;
    // beforeSubmit hooks may veto the prompt entirely.
    {
      const veto = await runBlockingHooks(features.hooks, "beforeSubmit", { prompt: text });
      if (veto) {
        this._sessions.delete(convId);
        vscode.window.showWarningMessage(`OpenCursor: prompt blocked by hook — ${veto}`);
        return;
      }
    }

    // Only deliver events to the webview when this conversation is on screen.
    // High-frequency stream events are coalesced so postMessage + applyEvent
    // cannot stall the extension host (looks like stuck tools/subagents).
    type PendingUi = { event: AgentEvent; apply: boolean };
    const uiPending = new Map<string, PendingUi>();
    let uiTimer: ReturnType<typeof setTimeout> | undefined;
    const flushUi = () => {
      uiTimer = undefined;
      if (!uiPending.size) return;
      const batch = [...uiPending.values()];
      uiPending.clear();
      for (const { event, apply } of batch) {
        if (apply) {
          session.turns = applyEvent(session.turns, event as unknown as SharedAgentEvent);
          this._schedulePersistTurns(convId, session);
        }
        this._view?.webview.postMessage({ type: "agentEvent", convId, event });
      }
    };
    // runAgent already coalesces deltas per stream policy before they get here,
    // so this layer only needs to absorb bursts (retries, parallel subagents)
    // without adding a second full interval of latency to every token.
    const scheduleUi = () => {
      if (!uiTimer) uiTimer = setTimeout(flushUi, 16);
    };
    const emit = (event: AgentEvent) => {
      if (event.type === "error") {
        SidebarProvider.log.appendLine(`[${new Date().toISOString()}] [agent] ${event.message}`);
      } else if (event.type === "retry") {
        SidebarProvider.log.appendLine(`[${new Date().toISOString()}] [retry ${event.attempt}/${event.max}] ${event.error}`);
      }
      // Maintain authoritative host turns from the same reducer the UI uses, then
      // persist (throttled) so any webview reload restores the live state exactly.
      const ev = event as unknown as SharedAgentEvent;

      // Coalesce stream deltas before applying / posting.
      if (ev.type === "text-delta") {
        const prev = uiPending.get("text");
        if (prev && (prev.event as SharedAgentEvent).type === "text-delta") {
          const p = prev.event as Extract<AgentEvent, { type: "text-delta" }>;
          uiPending.set("text", {
            event: { type: "text-delta", text: p.text + ev.text },
            apply: true,
          });
        } else {
          uiPending.set("text", { event, apply: true });
        }
        scheduleUi();
        return;
      }
      if (ev.type === "thinking-delta") {
        const prev = uiPending.get("think");
        if (prev && (prev.event as SharedAgentEvent).type === "thinking-delta") {
          const p = prev.event as Extract<AgentEvent, { type: "thinking-delta" }>;
          uiPending.set("think", {
            event: { type: "thinking-delta", text: p.text + ev.text },
            apply: true,
          });
        } else {
          uiPending.set("think", { event, apply: true });
        }
        scheduleUi();
        return;
      }
      if (ev.type === "tool-call-args") {
        uiPending.set(`args:${ev.callId}`, { event, apply: true });
        scheduleUi();
        return;
      }
      if (ev.type === "tool-call-progress") {
        uiPending.set(`prog:${ev.callId}`, { event, apply: true });
        scheduleUi();
        return;
      }
      if (ev.type === "subagent-event") {
        const child = ev.event as SharedAgentEvent;
        if (child.type === "text-delta" || child.type === "thinking-delta" || child.type === "tool-call-args") {
          const key =
            child.type === "tool-call-args"
              ? `sub:${ev.callId}:args:${(child as { callId: string }).callId}`
              : `sub:${ev.callId}:${child.type}`;
          if (child.type === "text-delta" || child.type === "thinking-delta") {
            const prev = uiPending.get(key);
            if (prev && (prev.event as SharedAgentEvent).type === "subagent-event") {
              const pe = (prev.event as Extract<AgentEvent, { type: "subagent-event" }>).event;
              if (pe.type === child.type) {
                uiPending.set(key, {
                  event: {
                    type: "subagent-event",
                    callId: ev.callId,
                    event: { type: child.type, text: (pe as { text: string }).text + child.text },
                  },
                  apply: true,
                });
                scheduleUi();
                return;
              }
            }
          }
          uiPending.set(key, { event, apply: true });
          scheduleUi();
          return;
        }
      }

      // Discrete events: flush coalesced stream first (ordering).
      if (uiPending.size) {
        if (uiTimer) { clearTimeout(uiTimer); uiTimer = undefined; }
        flushUi();
      }

      if (ev.type === "run-status") {
        if (ev.status === "finished" || ev.status === "cancelled" || ev.status === "error") {
          session.turns = forceSettleOpenWork(
            closeTrailingThinking(session.turns),
            ev.status === "error" ? "error" : "cancelled",
          );
          this._persistTurnsNow(convId, session);
        }
        // OS notification when a run completes while the window is unfocused.
        if (ev.status === "finished" && features.notifyOnComplete !== false && !vscode.window.state.focused) {
          vscode.window.showInformationMessage("OpenCursor: Agent finished responding.");
          runHooks(features.hooks, "notification", { message: "Agent finished responding." });
        }
      } else if (ev.type === "usage") {
        // Persist cumulative per-model token usage (Usage & Quota page).
        if (this.featureStore.get().trackUsage !== false) {
          void recordUsage(stripModelScope(modelId), ev.promptTokens, ev.completionTokens);
        }
        // Persist per-conversation context consumption (composer ring after reload).
        void this._store.update(convId, { usedTokens: ev.totalTokens });
      } else if (ev.type !== "run-result" && ev.type !== "mode-changed" && ev.type !== "shell-notify") {
        session.turns = applyEvent(session.turns, ev);
        this._schedulePersistTurns(convId, session);
      }
      this._view?.webview.postMessage({ type: "agentEvent", convId, event });
    };

    // Surface the (possibly new) conversation in the tab bar immediately.
    await this._store.setActiveId(convId);
    this._sendConversations();

    try {
      this._view?.webview.postMessage({ type: "runStarted", convId, prompt: text });

      // Local model not yet running → boot it now, showing a loading state in the
      // chat (selecting a model never loads it; only sending a message does).
      const local = this._localModel(modelId);
      if (local) {
        if (!isRunning(local.id)) {
          emit({ type: "shell-notify", message: `Loading ${local.name}…` });
          try {
            await ensureLoaded(local, features.llamacppConfig);
          } catch (e: unknown) {
            logError("local-model.load", e, { model: local.id });
            emit({ type: "error", message: `Failed to load ${local.name}: ${e instanceof Error ? e.message : String(e)}` });
            emit({ type: "run-status", status: "error" });
            return; // `finally` clears the session + persists.
          }
        }
        // The server binds a random port each load — resolve the URL only now.
        prov.baseUrl = serverUrlFor(local, features.llamacppConfig);
      }

      // Generate a short AI title once the provider/server is ready (local
      // models aren't reachable until booted above, so this must run here).
      if (isFirstMessage && text.trim() && features.autoGenerateTitles !== false) {
        generateTitle(prov.baseUrl, apiKey, prov.model, text, prov.anthropic, prov.oauthKind)
          .then(async (title) => {
            if (title && this._store.get(convId)) {
              await this._store.update(convId, { title });
              this._sendConversations();
            }
          })
          .catch((error) => logError("title.generate", error, { conversationId: convId }));
      }

      await runAgent({
        apiBaseUrl: prov.baseUrl,
        apiKey: apiKey,
        model: prov.model,
        anthropic: prov.anthropic,
        oauthKind: prov.oauthKind,
        mode,
        // The AI receives the text as-is, <attached /> tags included; the
        // resolved context blocks for those tags are appended after it.
        prompt: mentionContext ? `${text}\n\n${mentionContext}` : text,
        attachments,
        history,
        maxTokens: settings.maxResponseLength > 0 ? settings.maxResponseLength : undefined,
        maxSteps: features.maxAgentSteps > 0 ? features.maxAgentSteps : undefined,
        autoContinue: features.autoContinue === true,
        // Note: modelId (not prov.model — that's the gguf basename for llama.cpp).
        contextTokens: this._contextTokensFor(modelId, prov.oauthKind ?? features.providers.find((p) => p.id === prov.providerId)?.kind),
        modelParams: optionsToParams(this.featureStore.optionsFor(prov.model, prov.oauthKind ?? features.providers.find((p) => p.id === prov.providerId)?.kind)),
        systemPromptOverride: this._personaPromptFor(convId, features),
        extraInstructions: settings.systemPrompt,
        enableFileReading: settings.enableFileReading,
        enableTerminalSuggestions: settings.enableTerminalSuggestions,
        enableWorkspaceContext: settings.enableWorkspaceContext,
        enableWebSearch: features.webSearchEnabled !== false,
        enableWebFetch: features.webFetchEnabled !== false,
        approve: (toolName, input, callId) => this._approveTool(convId, session, toolName, input, callId),
        customSubagents: features.subagents,
        teams: features.teams,
        activeTeamIds: features.activeTeamIds,
        subagentModel: features.subagentModel,
        availableModels: this._modelsForProvider(prov.providerId, prov.oauthKind),
        registerSubagentAbort: (callId, abort) => {
          // Chain aborts (tool kill + nested Task child) so timeout fires both.
          const prev = session.subagentAborts.get(callId);
          session.subagentAborts.set(callId, () => {
            try { prev?.(); } catch { /* ignore */ }
            try { abort(); } catch { /* ignore */ }
          });
        },
        askUser: (callId, _header, _questions, sig) => this._askUser(session, callId, sig),
        onAfterRun: () => runHooks(features.hooks, "afterRun", { prompt: text }),
        onBeforeShell: (command) => runBlockingHooks(features.hooks, "beforeShell", { command }),
        onAfterEdit: (path) => runHooks(features.hooks, "afterEdit", { path }),
        onHook: (event, context, tool) => runBlockingHooks(features.hooks, event, context, tool),
        signal: session.abort.signal,
        emit,
      });
    } catch (err: unknown) {
      logError("agent.run", err, { conversationId: convId });
      try {
        if (session.abort.signal.aborted) {
          emit({ type: "run-status", status: "cancelled" });
        } else {
          const message = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`OpenCursor: Agent failed: ${message}`);
          emit({ type: "error", message } as AgentEvent);
          emit({ type: "run-status", status: "error" });
        }
      } catch { /* emit must never throw out of run */ }
    } finally {
      try {
        // Always settle open tools/subagents and clear hangable waiters.
        for (const abort of session.subagentAborts.values()) {
          try { abort(); } catch { /* ignore */ }
        }
        session.subagentAborts.clear();
        for (const [qid, resolve] of session.pendingQuestions) {
          session.pendingQuestions.delete(qid);
          try { resolve({}); } catch { /* ignore */ }
        }
        for (const [rid, p] of session.pendingApprovals) {
          session.pendingApprovals.delete(rid);
          try { p.resolve(false); } catch { /* ignore */ }
          this._view?.webview.postMessage({ type: "approvalResolved", convId, requestId: rid, approved: false });
        }
        // Only force-close still-open work; leave completed tools alone.
        session.turns = forceSettleOpenWork(closeTrailingThinking(session.turns), "cancelled");
        if (session.persistTimer) { clearTimeout(session.persistTimer); session.persistTimer = undefined; }
        await this._store.update(convId, { turns: session.turns, steps: history });
      } catch (e: unknown) {
        logError("agent.cleanup", e, { conversationId: convId });
      } finally {
        this._sessions.delete(convId);
        this._sendConversations();
        // Guarantee webview leaves "Working" even if run-status was lost (IDE reopen, stuck subagent).
        this._view?.webview.postMessage({
          type: "agentEvent",
          convId,
          event: { type: "run-status", status: session.abort.signal.aborted ? "cancelled" : "finished" },
        });
      }
    }
  }

  /**
   * Hard-stop a conversation run: parent abort + every subagent, pending
   * approvals/questions, and force-settled UI. Safe to call repeatedly.
   */
  private _cancelSession(convId: string): void {
    const session = this._sessions.get(convId);
    if (!session) {
      // Stale UI "Working" with no live session (e.g. after IDE reopen mid-run).
      this._view?.webview.postMessage({
        type: "agentEvent",
        convId,
        event: { type: "run-status", status: "cancelled" },
      });
      return;
    }
    for (const abort of session.subagentAborts.values()) {
      try { abort(); } catch { /* ignore */ }
    }
    for (const [qid, resolve] of session.pendingQuestions) {
      session.pendingQuestions.delete(qid);
      try { resolve({}); } catch { /* ignore */ }
    }
    for (const [rid, p] of session.pendingApprovals) {
      session.pendingApprovals.delete(rid);
      try { p.resolve(false); } catch { /* ignore */ }
      this._view?.webview.postMessage({ type: "approvalResolved", convId, requestId: rid, approved: false });
    }
    session.turns = forceSettleOpenWork(closeTrailingThinking(session.turns), "cancelled");
    this._persistTurnsNow(convId, session);
    try {
      if (!session.abort.signal.aborted) session.abort.abort();
    } catch { /* ignore */ }
    // Immediate UI settle so Stop never feels dead while the loop unwinds.
    this._view?.webview.postMessage({
      type: "agentEvent",
      convId,
      event: { type: "run-status", status: "cancelled" },
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    return renderWebviewHtml(webview, this.context.extensionUri, "sidebar", "OpenCursor Chat");
  }
}
