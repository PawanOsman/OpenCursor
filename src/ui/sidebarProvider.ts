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
import { providerApiKeyPool, type ApiKeyPool } from "../agent/provider/apiKeyPool";
import { OAUTH_KINDS, isOAuthProviderKind } from "../shared/oauthProviders";
import { PROVIDER_PRESETS } from "../shared/providerCatalog";
import { renderWebviewHtml } from "./webviewHtml";
import { ConversationStore, titleFromText } from "../stores/conversationStore";
import { FeatureStore, MODEL_CATALOG, kindMatches, optionsToParams, parseContextLabel, providerEnabled, type ModelDef, type ModelOption, type ProviderConfig } from "../stores/featureStore";
import { effectiveContextLength, ensureLoaded, isRunning, serverUrlFor } from "../agent/llamacpp";
import * as ollama from "../agent/ollama";
import * as oauth from "../agent/oauth";
import { recordUsage } from "../stores/usageStore";
import { DEFAULT_APPROVAL, evaluateApproval, deniedSubject, actionTypeForCall, actionTypesForCall, subjectFor, type ApprovalActionType, type ApprovalMode, type ApprovalPolicy } from "../agent/approvalPolicy";
import { stripModelScope, suggestPattern } from "./sidebar/approvalSuggest";
import type { PendingApproval, RunSession } from "./sidebar/session";
import { runHooks, runBlockingHooks } from "../integrations/hooksRunner";
import { getWorkspaceRoot, safePath, withWorkspaceRoot } from "../context/workspaceUtils";
import { allPersonas, getPersona } from "../agent/personas";
import { pendingChanges, computeHunks } from "../stores/pendingChanges";
import { applyEvent, closeTrailingThinking, forceSettleOpenWork, parseMentionTokens, renderMentionTokens, setQuestionAnswers, turnsToTranscript, type AgentEvent as SharedAgentEvent, type Turn } from "../shared/turns";
import { resolveFileIcon, invalidateFileIconCache } from "./fileIcons";
import {
  searchFilesAndFolders, searchCommits, searchDocSources, searchTerminals,
  searchRules, searchCode, branchDiffItem, resolveMentions, type MentionItem as HostMentionItem,
} from "../context/mentions";
import { getLog, logError } from "../logging";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { RunJournal } from "../stores/runJournal";
import { workspaceStorageDirectory } from "./sidebar/storage";
import { createConversationWorktree } from "../integrations/worktrees";
import { reviewInstructions, type QueuedMessage, type ReviewTarget, type GoalStatus, type ChatWorkspaceState } from "../shared/chatSession";

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "ocursor.chatView";
  private _view?: vscode.WebviewView;
  /** One independent agent run per conversation, so chats run concurrently. */
  private _sessions = new Map<string, RunSession>();
  private _deleting = new Set<string>();
  private _titleAborts = new Map<string, AbortController>();
  private _currentMode: Mode = "agent";
  private _queueWorkers = new Map<string, Promise<void>>();
  private _queuePaused = new Set<string>();
  /** Serialize queue controls, and keep submissions from resuming a handoff. */
  private _queueActions = new Map<string, Promise<void>>();
  private _pendingNewConversation?: Promise<string>;
  private _workflowReady: Promise<void>;
  private _journals = new Map<string, RunJournal>();
  private _disposed = false;
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
  private _fetchNeedsRefresh = false;
  private static readonly MODELS_CACHE_KEY = "ocursor.modelsFetched.v1";

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly settingsManager: SettingsManager,
    private readonly featureStore: FeatureStore
  ) {
    this._store = new ConversationStore(context);
    this._workflowReady = this._store.recoverInterruptedRuns();
    const disk = context.globalState.get<{ fetched: { providerId: string; ids: string[] }[] }>(
      SidebarProvider.MODELS_CACHE_KEY,
    );
    if (disk?.fetched?.length) this._fetchedCache = disk.fetched;
  }

  public async newChat(): Promise<void> {
    await vscode.commands.executeCommand("ocursor.chatView.focus");
    await this._newConversation();
  }

  public async dispose(): Promise<void> {
    this._disposed = true;
    for (const id of this._sessions.keys()) { this._queuePaused.add(id); this._cancelSession(id); }
    await Promise.allSettled([...this._sessions.values()].map((session) => session.done));
    await Promise.allSettled([...this._queueWorkers.values()]);
    await this._store.flush();
    await Promise.all([...this._journals.values()].map((journal) => journal.flush()));
  }

  private _sendWorkflowState() {
    const conversations = this._store.listMetadata();
    this._view?.webview.postMessage({ type: "workflowState",
      queues: Object.fromEntries(conversations.map((c) => [c.id, (c.queue ?? []).filter((item, index) => {
        const live = this._sessions.get(c.id);
        const head = live?.settled ? (c.queue ?? []).findIndex(entry => entry.status !== "running") : 0;
        // A worker starting an idle conversation is already sending its head request.
        return !(index === head && item.status === "queued" && this._queueWorkers.has(c.id)
          && (!live || live.settled) && !this._queuePaused.has(c.id) && !this._queueActions.has(c.id));
      })])),
      steeringQueues: Object.fromEntries(conversations.map(c => [c.id, c.steeringQueue ?? []])),
      goals: Object.fromEntries(conversations.filter((c) => c.goal).map((c) => [c.id, c.goal])),
    });
  }

  private async _submitMessage(data: { convId?: string | null; text: string; attachments?: Attachment[]; model?: string; mode?: Mode; requestId?: string }) {
    await this._workflowReady;
    if (this._disposed) return;
    if (!data.text?.trim() && !data.attachments?.length) return;
    let id = data.convId === undefined ? this._activeId : data.convId ?? undefined;
    const created = !id;
    if (!id) {
      this._pendingNewConversation ??= this._store.create(this._pendingPersonaId ?? this.featureStore.get().activePersonaId).then((conversation) => conversation.id);
      id = await this._pendingNewConversation;
      this._activeId = id;
      await this._store.setActiveId(id);
    }
    if (this._deleting.has(id) || !this._store.get(id)) return;
    const item: QueuedMessage = { id: data.requestId || randomUUID(), text: data.text, attachments: data.attachments,
      model: data.model ?? this.settingsManager.getSettings().model, mode: data.mode ?? this._currentMode, createdAt: Date.now(), status: "queued" };
    const enqueued = await this._store.enqueue(id, item);
    this._view?.webview.postMessage({ type: "requestAccepted", requestId: item.id, convId: id, created });
    this._sendConversations();
    if (enqueued && !this._queueActions.has(id)) {
      this._queuePaused.delete(id);
      void this._drainQueue(id);
    }
    this._sendWorkflowState();
  }

  private _drainQueue(id: string): Promise<void> {
    const current = this._queueWorkers.get(id);
    if (current) return current;
    // Start on a microtask only after the lock is installed.
    const worker = Promise.resolve().then(async () => {
      while (!this._disposed && !this._queuePaused.has(id) && !this._queueActions.has(id) && !this._deleting.has(id)) {
        const conversation = this._store.get(id);
        if (!conversation || conversation.archivedAt) break;
        const next = conversation.queue?.[0];
        // Unknown interrupted execution is never automatically replayed.
        if (!next || next.status !== "queued") break;
        const live = this._sessions.get(id);
        if (live) { await live.done; continue; }
        await this._store.updateQueue(id, (queue) => queue.map((item) => item.id === next.id ? { ...item, status: "running", startedAt: Date.now(), error: undefined } : item));
        // Queue controls can arrive while the durable running claim is flushing.
        if (this._disposed || this._queuePaused.has(id) || this._queueActions.has(id)) {
          await this._store.updateQueue(id, queue => queue.map(item => item.id === next.id && item.status === "running" ? { ...item, status: "queued", startedAt: undefined } : item));
          break;
        }
        if (!this._store.getMetadata(id)?.queue?.some(item => item.id === next.id && item.status === "running")) continue;
        this._sendWorkflowState();
        let result: string | undefined;
        let failure: string | undefined;
        try {
          const prompt = next.resume ? `Continue this interrupted request. First reconcile the current files and conversation with work already completed. Do not blindly repeat commands or external side effects. Complete only the remaining work.\n\nOriginal request:\n${next.text}` : next.text;
          result = await this._handleMessage(prompt, next.attachments, { convId: id, model: next.model, mode: next.mode, runId: next.id });
        } catch (error) {
          failure = error instanceof Error ? error.message : String(error);
          logError("queue.run", error, { conversationId: id });
        }
        // Send now deliberately retires the old request before aborting it.
        // Its cancellation must not manufacture a recovery entry or pause the replacement.
        if (!this._store.getMetadata(id)?.queue?.some(item => item.id === next.id)) {
          this._sendWorkflowState();
          continue;
        }
        if (result === "finished") {
          // Persist completion and queue removal together; duplicate client delivery
          // cannot resurrect a completed request after the webview reconnects.
          const latest = this._store.get(id);
          if (latest) await this._store.update(id, { queue: (latest.queue ?? []).filter((item) => item.id !== next.id),
            runEvents: [...latest.runEvents ?? [], { runId: next.id, type: "queue.finished", at: Date.now() }].slice(-2000) });
        } else {
          await this._store.updateQueue(id, (queue) => queue.map((item) => item.id === next.id ? { ...item, status: result === "cancelled" ? "interrupted" : "failed", error: failure ?? (result === "cancelled" ? "Request stopped. Resume to continue remaining work." : "Request did not finish. Check the conversation before retrying.") } : item));
          this._queuePaused.add(id);
        }
        this._sendWorkflowState();
      }
    }).catch((error) => {
      this._queuePaused.add(id);
      logError("queue.persistence", error, { conversationId: id });
      this._view?.webview.postMessage({ type: "error", convId: id, message: "Unable to save the request queue. Execution was stopped to preserve recovery state." });
    }).finally(() => {
      this._queueWorkers.delete(id);
      // A request may arrive while the previous worker's last disk flush settles.
      const conversation = this._store.get(id);
      if (!this._disposed && !this._queuePaused.has(id) && !this._queueActions.has(id) && !this._deleting.has(id) && !conversation?.archivedAt && conversation?.queue?.[0]?.status === "queued") void this._drainQueue(id);
    });
    this._queueWorkers.set(id, worker);
    return worker;
  }

  private _queueAction(id: string, requestId: string, action: "remove" | "run" | "steer" | "up" | "down" | "edit"): Promise<void> {
    const previous = this._queueActions.get(id);
    const ready = previous ? previous.catch(() => {}) : this._workflowReady;
    const actionWork = ready.then(() => this._applyQueueAction(id, requestId, action)).finally(() => {
      if (action === "steer") {
        this._sendWorkflowState();
        this._view?.webview.postMessage({ type: "queueSteeringResult", convId: id, requestId,
          accepted: !!this._store.getMetadata(id)?.steeringQueue?.some(item => item.id === requestId) });
      }
    });
    this._queueActions.set(id, actionWork);
    return actionWork.finally(() => {
      if (this._queueActions.get(id) !== actionWork) return;
      this._queueActions.delete(id);
      if (!this._disposed && !this._queuePaused.has(id)) void this._drainQueue(id);
    });
  }

  /** A deliberate Stop retires the active request while preserving unsent follow-ups. */
  private _stopRun(id: string): Promise<void> {
    this._queuePaused.add(id);
    const previous = this._queueActions.get(id);
    const ready = previous ? previous.catch(() => {}) : this._workflowReady;
    const stopping = ready.then(async () => {
      this._queuePaused.add(id);
      const session = this._sessions.get(id);
      const conversation = this._store.get(id);
      const retired = conversation?.queue?.filter(item => item.status === "running") ?? [];
      // update() changes the in-memory queue synchronously, before abort cleanup
      // can classify this request as an unexpected interruption.
      const saved = retired.length && conversation ? this._store.update(id, {
        queue: (conversation.queue ?? []).filter(item => item.status !== "running"),
        runEvents: [...conversation.runEvents ?? [], ...retired.map(item => ({ runId: item.id, type: "queue.cancelled", at: Date.now() }))].slice(-2000),
      }) : Promise.resolve();
      this._cancelSession(id);
      await saved;
      this._sendWorkflowState();
      await session?.done;
      await this._queueWorkers.get(id);
    });
    this._queueActions.set(id, stopping);
    return stopping.finally(() => {
      if (this._queueActions.get(id) === stopping) this._queueActions.delete(id);
    });
  }

  private async _applyQueueAction(id: string, requestId: string, action: "remove" | "run" | "steer" | "up" | "down" | "edit") {
    if (this._disposed || this._deleting.has(id)) return;
    const item = this._store.getMetadata(id)?.queue?.find((q) => q.id === requestId);
    if (!item) return;
    if (action === "edit") {
      if (item.status === "running") throw new Error("This request has already started. Stop it before editing.");
      const text = item.status === "queued" ? item.text : `Reconcile any already completed work before continuing this interrupted request:\n\n${item.text}`;
      const draft = { text, attachments: item.attachments ?? [] };
      const workspace = this._store.getWorkspaceState();
      const key = this.featureStore.get().perTabDrafts ? id : "\u0000shared";
      // Save the draft before removing its source. If the host stops between the
      // writes, recovery retains both instead of losing the user's request.
      await this._store.setWorkspaceState({ drafts: { ...workspace.drafts, [key]: draft } });
      await this._store.updateQueue(id, (queue) => queue.filter((entry) => entry.id !== requestId));
      this._view?.webview.postMessage({ type: "queueDraft", convId: id, draft });
    } else if (action === "run") {
      if (item.status === "running") return;
      this._queuePaused.add(id);
      const current = this._sessions.get(id);
      const snapshot = this._store.get(id)!;
      const replaced = snapshot.queue?.find(entry => entry.status === "running" && entry.id !== requestId);
      if (replaced || current) {
        const retired = [...replaced ? [replaced] : [], ...snapshot.steeringQueue ?? []];
        // Save the deliberate replacement before aborting: a restart must not
        // offer to replay an action the user explicitly superseded.
        await this._store.update(id, { queue: [
          { ...item, status: "queued", resume: item.status !== "queued" || item.resume, error: undefined },
          ...(snapshot.queue ?? []).filter(entry => entry.id !== replaced?.id && entry.id !== requestId),
        ], steering: [], steeringQueue: [],
          runEvents: [...snapshot.runEvents ?? [], ...retired.map(entry => ({ runId: entry.id, type: "queue.superseded", at: Date.now() }))].slice(-2000) });
      }
      if (current && this._sessions.get(id) === current) { this._cancelSession(id); await current.done; }
      await this._queueWorkers.get(id);
      await this._store.updateQueue(id, (queue) => {
        const selected = queue.find((q) => q.id === requestId);
        if (!selected) return queue;
        return [{ ...selected, status: "queued", resume: selected.status !== "queued" || selected.resume, error: undefined }, ...queue.filter((q) => q.id !== requestId)];
      });
      this._queuePaused.delete(id);
    } else if (action === "steer") {
      if (item.status !== "queued") return;
      if (item.attachments?.length) throw new Error("Steering supports text messages. Use Send now for attached files.");
      await this._acceptSteering(id, item, true);
    } else {
      if (item.status === "running") throw new Error("Stop this request before changing its queue entry.");
      await this._store.updateQueue(id, (queue) => {
        if (action === "remove") return queue.filter((q) => q.id !== requestId);
        const index = queue.findIndex((q) => q.id === requestId);
        const other = index + (action === "up" ? -1 : 1);
        if (index >= 0 && other >= 0 && other < queue.length && queue[other].status !== "running") [queue[index], queue[other]] = [queue[other], queue[index]];
        return queue;
      });
    }
    this._sendWorkflowState();
  }

  private async _steerMessage(id: string, text: string) {
    if (!text?.trim()) return;
    await this._workflowReady;
    await this._acceptSteering(id, { id: randomUUID(), text, status: "queued", createdAt: Date.now(), model: this.settingsManager.getSettings().model, mode: this._currentMode });
  }

  private async _acceptSteering(id: string, item: QueuedMessage, fromQueue = false) {
    const live = this._sessions.get(id);
    const conversation = this._store.get(id);
    if (!conversation || this._disposed || this._deleting.has(id)) return;
    if (!live || live.settled || live.abort.signal.aborted || this._queuePaused.has(id)) {
      // If completion won the race, the original queued request stays intact.
      if (!fromQueue) await this._submitMessage({ convId: id, ...item, requestId: item.id });
      return;
    }
    if (conversation.steeringQueue?.some(entry => entry.id === item.id)) return;
    await this._store.update(id, {
      queue: fromQueue ? (conversation.queue ?? []).filter(entry => entry.id !== item.id) : conversation.queue,
      steeringQueue: [...conversation.steeringQueue ?? [], item],
      runEvents: [...conversation.runEvents ?? [], { runId: item.id, type: "queue.steered", at: Date.now(), data: { text: item.text } }].slice(-2000),
    });
    if (this._sessions.get(id) !== live || live.settled || live.abort.signal.aborted) {
      await this._restorePendingSteering(id);
      if (!this._queuePaused.has(id)) void this._drainQueue(id);
      return;
    }
    this._view?.webview.postMessage({ type: "steeringAccepted", convId: id });
  }

  /** Undelivered guidance remains an ordinary queued message after a run ends. */
  private async _restorePendingSteering(id: string) {
    const conversation = this._store.get(id);
    if (!conversation?.steeringQueue?.length) return;
    const queue = conversation.queue ?? [];
    const ids = new Set(queue.map(item => item.id));
    await this._store.update(id, { steeringQueue: [], queue: [...queue, ...conversation.steeringQueue.filter(item => !ids.has(item.id)).map(item => ({ ...item, status: "queued" as const, error: undefined }))] });
    this._sendWorkflowState();
  }

  private async _setGoal(id: string | undefined, objective: string, tokenBudget?: number) {
    if (!objective?.trim()) throw new Error("Enter an objective for the goal.");
    if (tokenBudget !== undefined && (!Number.isSafeInteger(tokenBudget) || tokenBudget <= 0)) throw new Error("Token budget must be a positive whole number.");
    if (!id) {
      const conversation = await this._store.create(this._pendingPersonaId ?? this.featureStore.get().activePersonaId);
      id = conversation.id;
      await this._selectConversation(id);
    }
    const existing = this._store.getMetadata(id)?.goal;
    if (this._sessions.has(id)) throw new Error("Wait for the active run to finish before starting a new goal.");
    if (existing && existing.status !== "complete") throw new Error("Complete the existing goal before replacing its objective.");
    await this._store.update(id, { goal: { objective: objective.trim(), status: "active", tokenBudget, tokensUsed: 0, updatedAt: Date.now() } });
    this._sendWorkflowState();
    await this._submitMessage({ convId: id, text: objective.trim() });
  }

  private async _setGoalStatus(id: string, status: GoalStatus) {
    if (!["active", "paused", "blocked", "budgetLimited", "complete"].includes(status)) throw new Error("Invalid goal status.");
    const goal = this._store.getMetadata(id)?.goal;
    if (!goal) return;
    if (status === "active" && goal.tokenBudget !== undefined && goal.tokensUsed >= goal.tokenBudget) throw new Error("This goal has reached its token budget.");
    await this._store.update(id, { goal: { ...goal, status, updatedAt: Date.now() } });
    if (status !== "active") { this._queuePaused.add(id); this._cancelSession(id); }
    this._sendWorkflowState();
    if (status === "active" && goal.status !== "active") {
      const next = this._store.getMetadata(id)?.queue?.[0];
      if (next) await this._queueAction(id, next.id, "run");
      else await this._submitMessage({ convId: id, text: `Resume the goal: ${goal.objective}. Inspect the current task state and complete the remaining work.` });
    }
  }

  public async startReview(target?: ReviewTarget): Promise<void> {
    const workspaceRoot = this._activeId ? this._store.getMetadata(this._activeId)?.workspaceRoot : undefined;
    if (!target) {
      const selection = await vscode.window.showQuickPick([
        { label: "Uncommitted changes", value: "uncommitted" }, { label: "Compare with a branch", value: "baseBranch" },
        { label: "Review a commit", value: "commit" }, { label: "Custom review", value: "custom" },
      ], { placeHolder: "Choose the scope of the code review" });
      if (!selection) return;
      if (selection.value === "uncommitted") target = { type: "uncommitted" };
      else {
        const value = await vscode.window.showInputBox({ prompt: selection.value === "baseBranch" ? "Base branch" : selection.value === "commit" ? "Commit hash or reference" : "Review instructions" });
        if (!value?.trim()) return;
        target = selection.value === "baseBranch" ? { type: "baseBranch", branch: value.trim() } : selection.value === "commit" ? { type: "commit", commit: value.trim() } : { type: "custom", instructions: value.trim() };
      }
    }
    if (!["uncommitted", "baseBranch", "commit", "custom"].includes(target.type)) throw new Error("Invalid review target.");
    const conversation = await this._store.create();
    await this._store.update(conversation.id, { title: "Code review", reviewTarget: target, workspaceRoot });
    await vscode.commands.executeCommand("ocursor.chatView.focus");
    await this._selectConversation(conversation.id);
    await this._submitMessage({ convId: conversation.id, text: reviewInstructions(target), mode: "ask" });
  }

  public async implementTodo(uri: vscode.Uri, line: number): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri);
    const text = document.lineAt(line).text.trim();
    await this.newChat();
    await this._submitMessage({ text: `Implement the TODO at ${vscode.workspace.asRelativePath(uri, false)}:${line + 1}:\n${text}\n\nInspect the surrounding code and relevant tests before editing, and verify the change.`, mode: "agent" });
  }

  /**
   * Convert pasted text into a @code mention when it matches an open project file.
   * Only scans open documents, not the whole workspace on disk.
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
      this._reevaluatePendingApprovals();
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
      const conversationId = data.convId ?? this._activeId;
      await withWorkspaceRoot(conversationId ? this._store.getMetadata(conversationId)?.workspaceRoot : undefined, async () => {
      try {
      switch (data.type) {
        case "ready":
          await this._sendInitialState();
          break;
        case "sendMessage":
          if (data.fromIndex == null) {
            await this._submitMessage(data);
          } else await this._handleMessage(data.text, data.attachments, {
            convId: data.convId,
            fromIndex: data.fromIndex,
            model: data.model,
            mode: data.mode,
            revertFiles: data.revertFiles,
          });
          break;
        case "updateChatWorkspace":
          await this._store.setWorkspaceState(data.state as Partial<ChatWorkspaceState>);
          break;
        case "queueAction":
          await this._queueAction(data.convId, data.id, data.action);
          break;
        case "steerMessage":
          await this._steerMessage(data.convId, data.text);
          break;
        case "forkConversation": {
          const live = this._sessions.get(data.id);
          if (live) throw new Error("Wait for the active run to finish before forking its conversation.");
          const fork = await this._store.fork(data.id);
          await this._selectConversation(fork.id);
          break;
        }
        case "archiveConversation":
          if (this._sessions.has(data.id)) throw new Error("Stop the active run before archiving this conversation.");
          await this._store.update(data.id, { archivedAt: data.archived === false ? undefined : Date.now() });
          if (this._activeId === data.id && data.archived !== false) await this._newConversation();
          this._sendConversations();
          break;
        case "searchConversations":
          this._view?.webview.postMessage({ type: "conversationSearchResults", requestId: data.requestId, list: this._store.list({ archived: data.archived === true, query: String(data.query ?? "") }) });
          break;
        case "setGoal":
          await this._setGoal(data.convId, data.objective, data.tokenBudget);
          break;
        case "setGoalStatus":
          await this._setGoalStatus(data.convId, data.status);
          break;
        case "startReview":
          await this.startReview(data.target);
          break;
        case "createWorktreeConversation": {
          const worktree = await createConversationWorktree(getWorkspaceRoot(), path.join(this.context.globalStorageUri.fsPath, "worktrees"), data.title);
          const conversation = await this._store.create();
          await this._store.update(conversation.id, { title: `Worktree: ${worktree.branch}`, workspaceRoot: worktree.path });
          await this._selectConversation(conversation.id);
          break;
        }
        case "continueRun":
          // "Continue" button after hitting the step limit. Optionally flips
          // the global Auto Continue setting first.
          if (data.always) await this.featureStore.set({ autoContinue: true });
          await this._handleMessage("Continue", undefined, { convId: data.convId, model: data.model, mode: data.mode });
          break;
        case "revertToMessage": {
          if (this._activeId && this._store.get(this._activeId)) {
            const convId = this._activeId;
            const session = this._sessions.get(convId);
            if (session) { this._cancelSession(convId); await session.done; }
            if (data.revertFiles) await pendingChanges.rejectAll({ conversationId: convId, fromTurnIndex: data.index });
            await this._truncateConversation(convId, data.index);
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
        case "setApprovalPreset":
          await this._setApprovalPreset(data.preset);
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
          if (id) await this._stopRun(id);
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
                  // TodoWrite/Read: use "completed" instead of "error" to avoid red X
                  const isTodo = b.name === "TodoWrite" || b.name === "TodoRead"
                    || b.name === "todo_write" || b.name === "todo_read";
                  return {
                    ...b,
                    status: isTodo ? "completed" as const : "error" as const,
                    result:
                      b.result ||
                      (isTodo ? "(todos: cancelled)" :
                        timedOut
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
            // TodoWrite/Read: cancel/timeout should NOT show red X in UI.
            // The "(cancelled)" string doesn't match parseTodos patterns, so
            // status "error" + empty parse = red X + "(no todos)" which stops
            // processing visually. Use "completed" for TodoWrite/Read.
            const isTodo = toolName === "TodoWrite" || toolName === "TodoRead"
              || toolName === "todo_write" || toolName === "todo_read";
            this._view?.webview.postMessage({
              type: "agentEvent",
              convId: cid,
              event: {
                type: "tool-call-completed",
                callId: data.callId,
                name: toolName,
                status: isTodo ? "completed" : "error",
                result: isTodo ? "(todos: cancelled)" : resultMsg,
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
        case "answerQuestion":
          this._answerQuestion(data.callId, data.answers || {});
          break;
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
          if (this._activeId) pendingChanges.accept(data.path, { conversationId: this._activeId });
          break;
        case "rejectChange":
          if (this._activeId) await pendingChanges.reject(data.path, { conversationId: this._activeId });
          break;
        case "acceptAllChanges":
          if (this._activeId) pendingChanges.acceptAll({ conversationId: this._activeId });
          break;
        case "rejectAllChanges":
          if (this._activeId) await pendingChanges.rejectAll({ conversationId: this._activeId });
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
      } catch (error) {
        logError("sidebar.action", error, { action: data.type });
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`OpenCursor: ${message}`);
        this._view?.webview.postMessage({ type: "error", convId: data.convId ?? this._activeId, message });
      }
      });
    });
  }

  private _sendPendingChanges() {
    this._view?.webview.postMessage({
      type: "pendingChanges",
      changes: (this._activeId ? pendingChanges.list({ conversationId: this._activeId }) : []).map((c) => {
        let added = 0;
        let removed = 0;
        for (const h of c.previewOnly ? [] : computeHunks(c.before, c.after)) {
          added += h.afterLines.length;
          removed += h.beforeLines.length;
        }
        return { path: c.path, existedBefore: c.existedBefore, added, removed };
      }),
    });
  }

  /** Open VS Code's native diff between the original and current file contents. */
  private async _showDiff(relPath: string) {
    const scope = this._activeId ? { conversationId: this._activeId } : undefined;
    const change = scope ? pendingChanges.get(relPath, scope) : undefined;
    if (!change) {
      await this._openFile(relPath);
      return;
    }
    try {
      await vscode.commands.executeCommand("ocursor.viewDiff", relPath, scope);
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

  /** Categorized @-mention search. */
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
          const uri = vscode.Uri.file(safePath(p));
          await vscode.commands.executeCommand(vscode.workspace.getWorkspaceFolder(uri) ? "revealInExplorer" : "revealFileInOS", uri);
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
          const root = getWorkspaceRoot();
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
    await this._workflowReady;
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
      approvalPolicy: this._approvalPolicy(),
      activeId: this._activeId,
      turns: this._turnsFor(this._activeId),
      usedTokens: active?.usedTokens,
      workspaceRoot: active?.workspaceRoot,
      personas: allPersonas(features.customPersonas).map((p) => ({ id: p.id, name: p.name, description: p.description })),
      activePersonaId: active?.personaId ?? features.activePersonaId,
      hasProviders: this._enabledProviders().length > 0 || OAUTH_KINDS.some(kind => oauth.isConnected(kind)),
      teams: this._teamSummaries(features),
      activeTeamIds: features.activeTeamIds ?? [],
      runningConvIds: [...this._sessions.keys()],
      workspaceState: this._store.getWorkspaceState(),
      uiPrefs: {
        chatTextSize: features.chatTextSize ?? "default",
        motion: features.motion ?? "full",
        submitWithCtrlEnter: features.submitWithCtrlEnter === true,
        maxTabCount: features.maxTabCount ?? 0,
        completionSound: features.completionSound === true,
        perTabDrafts: features.perTabDrafts === true,
      },
    });
    this._sendConversations();
    this._sendWorkflowState();
    this._sendPendingChanges();
    // Re-surface any approvals still waiting (webview may have been reloaded).
    for (const session of this._sessions.values()) {
      for (const { info } of session.pendingApprovals.values()) {
        this._view?.webview.postMessage({ type: "approvalRequest", convId: info.convId, request: info });
      }
    }
    await this._handleFetchModels();
  }

  /** Save both representations together so a reload can resume the visible work. */
  private _persistTurnsNow(convId: string, session: RunSession) {
    if (session.persistTimer) { clearTimeout(session.persistTimer); session.persistTimer = undefined; }
    void this._store.update(convId, { turns: session.turns, steps: session.history, contextState: session.contextState }).catch((error) => logError("conversation.persist", error, { conversationId: convId }));
  }

  /** Throttle persistence of live turns (~1/sec) during a run. */
  private _schedulePersistTurns(convId: string, session: RunSession) {
    if (session.persistTimer) return;
    session.persistTimer = setTimeout(() => {
      session.persistTimer = undefined;
      this._persistTurnsNow(convId, session);
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
  private async _truncateConversation(convId: string, turnIndex: number) {
    const conv = this._store.get(convId);
    if (!conv) return;
    const turns = conv.turns.slice(0, turnIndex);
    // Count user turns kept — that's how many user steps to keep.
    const keepUserSteps = turns.filter((t) => t.role === "user").length;
    let seen = 0;
    let cut = conv.steps.length;
    for (let i = 0; i < conv.steps.length; i++) {
      const step = conv.steps[i];
      if (step.kind === "user" && !step.synthetic) {
        if (seen === keepUserSteps) { cut = i; break; }
        seen++;
      }
    }
    const steps = conv.steps.slice(0, cut);
    await this._store.update(convId, { turns, steps, contextState: undefined });
  }

  private _sendConversations() {
    this._view?.webview.postMessage({
      type: "conversations",
      list: this._store.list({ archived: false }),
      activeId: this._activeId,
      runningConvIds: [...this._sessions.keys()],
    });
  }

  private async _newConversation(personaId?: string) {
    this._pendingNewConversation = undefined;
    const features = this.featureStore.get();
    this._pendingPersonaId = personaId ?? features.activePersonaId;
    // Only create a fresh record when the active one already has messages.
    const active = this._activeId ? this._store.get(this._activeId) : undefined;
    if (active && !active.workspaceRoot && !active.archivedAt && !active.goal && !active.queue?.length && active.steps.length === 0 && !this._sessions.has(active.id)) {
      // Active conversation is already empty — reuse it; just set its persona.
      await this._store.update(active.id, { personaId: this._pendingPersonaId });
      this._view?.webview.postMessage({ type: "loadConversation", activeId: this._activeId, turns: [], personaId: this._pendingPersonaId });
      return;
    }
    this._activeId = undefined;
    await this._store.setActiveId(undefined);
    this._view?.webview.postMessage({ type: "loadConversation", activeId: undefined, turns: [], personaId: this._pendingPersonaId });
    this._sendConversations();
    this._sendWorkflowState();
    this._sendPendingChanges();
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
    this._view?.webview.postMessage({ type: "loadConversation", activeId: id, turns: this._turnsFor(id), personaId: conv.personaId ?? features.activePersonaId, usedTokens: conv.usedTokens, running: this._sessions.has(id), workspaceRoot: conv.workspaceRoot });
    this._sendConversations();
    this._sendWorkflowState();
    this._sendPendingChanges();
  }

  private async _deleteConversation(id: string) {
    this._deleting.add(id);
    this._queuePaused.add(id);
    try {
      const session = this._sessions.get(id);
      this._cancelSession(id);
      if (session) await session.done;
      await this._queueWorkers.get(id);
      await this._store.delete(id);
      if (this._activeId === id) {
        this._activeId = undefined;
        this._view?.webview.postMessage({ type: "loadConversation", activeId: undefined, turns: [] });
      }
      this._sendConversations();
      this._sendWorkflowState();
      this._sendPendingChanges();
    } finally {
      this._deleting.delete(id);
    }
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
      approvalPolicy: this._approvalPolicy(),
      personas: allPersonas(features.customPersonas).map((p) => ({ id: p.id, name: p.name, description: p.description })),
      activePersonaId: active?.personaId ?? features.activePersonaId,
      hasProviders: this._enabledProviders().length > 0 || OAUTH_KINDS.some(kind => oauth.isConnected(kind)),
      teams: this._teamSummaries(features),
      activeTeamIds: features.activeTeamIds ?? [],
      uiPrefs: {
        chatTextSize: features.chatTextSize ?? "default",
        motion: features.motion ?? "full",
        submitWithCtrlEnter: features.submitWithCtrlEnter === true,
        maxTabCount: features.maxTabCount ?? 0,
        completionSound: features.completionSound === true,
        perTabDrafts: features.perTabDrafts === true,
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

  private _answerQuestion(callId: string, answers: Record<string, string[]>) {
    for (const [convId, session] of this._sessions) {
      const resolve = session.pendingQuestions.get(callId);
      if (!resolve) continue;
      session.pendingQuestions.delete(callId);
      session.turns = setQuestionAnswers(session.turns, callId, answers);
      this._persistTurnsNow(convId, session);
      this._view?.webview.postMessage({ type: "questionAnswered", convId, callId, answers });
      resolve(answers);
      return;
    }
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
      const onAbort = () => {
        if (session.pendingQuestions.has(callId)) {
          session.pendingQuestions.delete(callId);
          const err = new Error("cancelled");
          err.name = "AbortError";
          reject(err);
        }
      };
      session.pendingQuestions.set(callId, (answers) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(answers);
      });
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /** Ask for approval in the chat UI; resolves when the user decides (or the run aborts). */
  private async _approveTool(convId: string, session: RunSession, toolName: string, input: any, callId?: string): Promise<boolean | { approved: false; blockedSubject: string }> {
    const decision = this._evaluatePolicy(toolName, input);
    if (decision === "allow") return true;
    const policy = this._approvalPolicy();
    const applicable = actionTypesForCall(toolName, input, getWorkspaceRoot());
    const permissive = Object.fromEntries(Object.keys(DEFAULT_APPROVAL).map((key) => [key, { mode: "allow", allowlist: [], denylist: [] }])) as unknown as ApprovalPolicy;
    const type = applicable.find((key) => evaluateApproval({ ...permissive, [key]: policy[key] }, toolName, input, getWorkspaceRoot()) === "ask")
      ?? actionTypeForCall(toolName, input, getWorkspaceRoot())!;
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
      detail: type !== "outside" && applicable.includes("outside") ? `${detail} (outside workspace: ${subjectFor("outside", toolName, input)})` : detail,
      suggestion: suggestPattern(type, toolName, subject),
      input,
    };
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const onAbort = () => settle(false);
      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        session.abort.signal.removeEventListener("abort", onAbort);
        session.pendingApprovals.delete(info.requestId);
        this._view?.webview.postMessage({ type: "approvalResolved", convId, requestId: info.requestId, approved: ok });
        resolve(ok);
      };
      session.pendingApprovals.set(info.requestId, { info, resolve: settle });
      this._view?.webview.postMessage({ type: "approvalRequest", convId, request: info });
      // Cancelling the run denies anything still pending.
      if (session.abort.signal.aborted) settle(false);
      else session.abort.signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  /**
   * A policy change from the Settings panel (e.g. switching to "Allow") must
   * settle prompts that were already raised, not just future ones.
   */
  private _reevaluatePendingApprovals() {
    for (const session of this._sessions.values()) {
      for (const p of [...session.pendingApprovals.values()]) {
        const decision = this._evaluatePolicy(p.info.toolName, p.info.input, this._store.getMetadata(p.info.convId)?.workspaceRoot);
        if (decision !== "ask") p.resolve(decision === "allow");
      }
    }
  }

  /** The effective approval policy (user settings over safe defaults). */
  private _approvalPolicy(): ApprovalPolicy {
    return { ...DEFAULT_APPROVAL, ...(this.featureStore.get().approvalPolicy ?? {}) };
  }

  /** Change only the action modes; explicit allow/deny patterns remain authoritative. */
  private async _setApprovalPreset(preset: unknown) {
    if (preset !== "ask" && preset !== "review" && preset !== "allow") return;
    const current = this._approvalPolicy();
    const approvalPolicy = Object.fromEntries((Object.keys(DEFAULT_APPROVAL) as ApprovalActionType[]).map((key) => [key, {
      ...current[key], mode: preset,
    }])) as ApprovalPolicy;
    // The normal feature-change notification refreshes the UI and re-evaluates
    // outstanding approval cards using this same policy.
    await this.featureStore.set({ approvalPolicy });
  }

  /** Evaluate the current approval policy for a tool call. */
  private _evaluatePolicy(toolName: string, input: any, root = getWorkspaceRoot()): "allow" | "ask" | "deny" {
    return evaluateApproval(this._approvalPolicy(), toolName, input, root);
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
        const decision = this._evaluatePolicy(info.toolName, info.input, this._store.getMetadata(info.convId)?.workspaceRoot);
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

  /** Current selectable providers; explicit empty/disabled key pools cannot serve chat. */
  private _enabledProviders(): ProviderConfig[] {
    const features = this.featureStore.get();
    return features.providers.filter(provider => {
      if (!providerEnabled(provider)) return false;
      const preset = PROVIDER_PRESETS[provider.kind];
      if (preset?.noAuth && provider.id === `popular:${provider.kind}`
        && provider.baseUrl.replace(/\/+$/, "") === preset.baseUrl.replace(/\/+$/, "")) return true;
      // Absent metadata is the original single-secret/custom anonymous contract.
      if (provider.apiKeys === undefined) return provider.hasKey !== false || !provider.id.startsWith("popular:");
      return provider.apiKeys.some(key => key.enabled !== false && key.hasKey !== false
        && (key.id === provider.id || key.id.startsWith(`${provider.id}:key:`)));
    });
  }

  /** Whether a model id maps to a managed local llama.cpp model. */
  private _localModel(modelId: string) {
    const scope = modelId.includes("::") ? modelId.slice(0, modelId.indexOf("::")) : undefined;
    if (scope && scope !== "llamacpp") return undefined;
    const bare = stripModelScope(modelId);
    return this.featureStore.get().llamacppModels.find((m) => m.id === modelId || m.id === bare);
  }

  /**
   * Resolve the provider that serves a given model id into connection details.
   * For local models, pass `{ load: true }` to spawn the server if not already
   * running; otherwise the URL is returned without starting it.
   */
  private async _resolveProviderForModel(modelId: string, opts?: { load?: boolean }): Promise<{ baseUrl: string; apiKey: string; apiKeyPool?: ApiKeyPool; model: string; anthropic: boolean; providerId?: string; oauthKind?: oauth.OAuthKind }> {
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
      : scopedProvider && isOAuthProviderKind(scopedProvider)
        ? (scopedProvider as oauth.OAuthKind)
        : undefined) ?? (!scopedProvider ? this._oauthModelKind.get(modelId) : undefined);
    if (oauthKind) {
      if (!isOAuthProviderKind(oauthKind) || !oauth.isConnected(oauthKind)) throw new Error("Selected account provider is unavailable or disabled. Connect an enabled account.");
      return { baseUrl: "", apiKey: "", model: modelId, anthropic: false, providerId: oauthKind, oauthKind };
    }
    // Local llama.cpp model: served by the extension's own server, no provider
    // entry required. Ensure it's loaded, then point at its local /v1 endpoint.
    const local = features.llamacppModels.find((m) => m.id === modelId);
    if (local && (!scopedProvider || scopedProvider === "llamacpp")) {
      if (opts?.load) await ensureLoaded(local, features.llamacppConfig);
      // llama-server's /v1 serves the loaded model regardless of the id sent,
      // but pass the gguf basename so logs/aliases line up.
      return { baseUrl: serverUrlFor(local, features.llamacppConfig), apiKey: "", model: local.file || modelId, anthropic: false, providerId: "llamacpp" };
    }
    // Locally-pulled Ollama model: served by the daemon's /v1, no provider entry.
    if ((!scopedProvider || scopedProvider === "ollama") && this._ollamaModelIds.has(modelId)) {
      return { baseUrl: ollama.ollamaOpenAIBase(), apiKey: "", model: modelId, anthropic: false, providerId: "ollama" };
    }
    // 0) Provider-scoped composite id → route to that exact provider.
    let prov: ProviderConfig | undefined;
    if (scopedProvider) {
      prov = enabled.find((p) => p.id === scopedProvider);
      if (!prov) throw new Error(`Selected provider "${scopedProvider}" is unavailable or disabled. Select an enabled provider.`);
    }
    // 1) Catalog/custom model → its tagged provider, else first of matching kind.
    const def = this.featureStore.allModels().find((m) => m.id === modelId);
    if (!prov && def) {
      if (def.providerId) {
        prov = enabled.find((p) => p.id === def.providerId);
        if (!prov) throw new Error(`Selected provider "${def.providerId}" is unavailable or disabled. Select an enabled provider.`);
      }
      // Catalog models only route to popular (built-in) providers by kind.
      if (!prov) prov = enabled.find((p) => p.id.startsWith("popular:") && kindMatches(def.kind, p.kind));
    }
    // 1b) A fetched ID also works on the exact provider that advertised it.
    if (!prov) {
      const pid = this._modelProvider.get(modelId);
      if (pid) prov = enabled.find((p) => p.id === pid);
    }
    if (!prov && def) {
      throw new Error(`No enabled provider serves "${modelId}". Connect its provider or select a model advertised by your configured endpoint.`);
    }
    // 2) Otherwise first enabled provider.
    if (!prov) prov = enabled[0];
    if (prov) {
      const apiKey = prov.apiKeys === undefined ? (await this.settingsManager.getProviderKey(prov.id)) || "" : "";
      return { baseUrl: prov.baseUrl, apiKey, apiKeyPool: providerApiKeyPool(prov, this.featureStore, this.settingsManager), model: modelId, anthropic: prov.kind === "anthropic", providerId: prov.id };
    }
    // No provider configured at all — surface a clear error downstream.
    return { baseUrl: "", apiKey: "", model: modelId, anthropic: false };
  }

  /** Context window for a model: llama.cpp ctx length, else the model's
   *  max_context option ("200k"/"1m"…), else a safe 200k default. */
  private _contextTokensFor(modelId: string, oauthKind?: string): number {
    const f = this.featureStore.get();
    const bare = stripModelScope(modelId);
    const m = this._localModel(modelId);
    if (m) return effectiveContextLength(m, f.llamacppContextLength);
    const opt = this.featureStore.optionsFor(bare, oauthKind).find((o) => o.key === "max_context")?.value;
    return parseContextLabel(opt) || 128_000;
  }

  /** Build the picker model list from ALL enabled providers. */
  private _buildModelList(fetched: { providerId: string; ids: string[] }[]): ModelDef[] {
    const features = this.featureStore.get();
    const enabled = this._enabledProviders();
    // Saved choices include explicitly enabled models. Newly shipped catalog
    // defaults also appear; any explicit disabledModels entry takes precedence.
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
    // Catalog/default models served by an enabled provider of matching kind.
    for (const m of this.featureStore.allModels()) {
      // Catalog models default-on; only filter when explicitly disabled.
      if (disabledSet.has(m.id) || (!enabledSet.has(m.id) && !catalogIds.has(m.id))) continue;
      // Custom models tagged to a specific provider route there; else by kind.
      // Catalog models only match popular (built-in) providers — a custom
      // "OpenAI-compatible" endpoint serves its own fetched models, not the catalog.
      const prov = m.providerId ? enabled.find((p) => p.id === m.providerId)
        : enabled.find((p) => p.id.startsWith("popular:") && kindMatches(m.kind, p.kind));
      if (!prov) continue;
      out.push({ ...m, id: `${prov.id}::${m.id}`, modelId: m.id, options: this.featureStore.optionsFor(m.id, prov.kind), group: "default", providerId: prov.id, providerName: prov.name });
      seen.add(`${prov.id}::${m.id}`);
    }
    // Most OAuth catalogs supplement discovery. Antigravity's advertised IDs
    // are authoritative because model availability varies by account project.
    for (const { providerId, ids } of fetched) {
      if (!providerId.startsWith("__oauth__:")) continue;
      const kind = providerId.slice("__oauth__:".length) as oauth.OAuthKind;
      if (!isOAuthProviderKind(kind) || !oauth.isConnected(kind)) continue;
      const label = oauth.OAUTH_LABEL[kind];
      const base = kind;
      const available = kind === "antigravity" ? new Set(ids) : undefined;
      for (const m of this.featureStore.allModels()) {
        if (m.providerId ? m.providerId !== `oauth:${kind}` : !kindMatches(m.kind, kind)) continue;
        if (available && !available.has(m.id)) continue;
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
        if (!isOAuthProviderKind(kind) || !oauth.isConnected(kind)) continue;
        const label = oauth.OAUTH_LABEL[kind];
        const base = kind;
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
          out.push({ id: pid, modelId: id, name: id, kind: "ollama", options: this.featureStore.optionsFor(id, "ollama"), group: "default", providerId: "ollama", providerName: "Local (Ollama)" });
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
    const candidates = this._buildModelList(this._fetchedCache ?? []).map((m) => m.id).filter((id) => id !== "auto");
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
      const picked = await pickModel(jprov.baseUrl, jprov.apiKey, jprov.model, candidates, task, jprov.anthropic, jprov.oauthKind, {
        apiKeyPool: jprov.apiKeyPool,
        onUsage: (event) => {
          if (this.featureStore.get().trackUsage !== false) void recordUsage(event.model ?? jprov.model, event.promptTokens ?? 0, event.completionTokens ?? 0, event);
        },
      });
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
      if (!isOAuthProviderKind(kind) || !oauth.isConnected(kind)) continue;
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
    if (this._fetchInflight) { this._fetchNeedsRefresh = true; return this._fetchInflight; }

    this._fetchInflight = (async () => {
      do {
        this._fetchNeedsRefresh = false;
        await this._networkFetchModels();
      } while (this._fetchNeedsRefresh);
    })().finally(() => {
      this._fetchInflight = null;
    });
    return this._fetchInflight;
  }

  private async _networkFetchModels() {
    const enabled = this._enabledProviders();
    const [providerFetched, ollamaIds, ...oauthBatches] = await Promise.all([
      Promise.all(
        enabled.map(async (p) => {
          const anthropic = p.kind === "anthropic";
          try {
            const models = await listModels(p.baseUrl, "", anthropic, { apiKeyPool: providerApiKeyPool(p, this.featureStore, this.settingsManager) });
            return { providerId: p.id, ids: models.map((m) => m.id) };
          } catch {
            return { providerId: p.id, ids: [] as string[] };
          }
        }),
      ),
      ollama.listModels().then((ms) => ms.map((m) => m.name)).catch(() => [] as string[]),
      ...OAUTH_KINDS.map(async (kind) => {
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

  private _handleMessage(
    text: string,
    attachments?: Attachment[],
    edit?: { convId?: string | null; fromIndex?: number; model?: string; mode?: string; revertFiles?: boolean; runId?: string },
  ) {
    const id = edit?.convId === undefined ? this._activeId : edit.convId;
    return withWorkspaceRoot(id ? this._store.getMetadata(id)?.workspaceRoot : undefined, () => this._handleMessageInWorkspace(text, attachments, edit));
  }

  private async _handleMessageInWorkspace(
    text: string,
    attachments?: Attachment[],
    edit?: { convId?: string | null; fromIndex?: number; model?: string; mode?: string; revertFiles?: boolean; runId?: string },
  ) {
    if (!text.trim() && (!attachments || attachments.length === 0)) {
      vscode.window.showWarningMessage("OpenCursor: Message cannot be empty");
      return;
    }

    // Capture routing before any asynchronous work; switching tabs cannot retarget a send.
    let convId = edit?.convId !== undefined ? edit.convId ?? undefined : this._activeId;
    const selectedAtSubmit = this._activeId;
    const submittedMode = (edit?.mode ?? this._currentMode) as Mode;
    const submittedModel = edit?.model ?? this.settingsManager.getSettings().model;
    const queueRunStopped = () => !!edit?.runId && !!convId && (this._disposed || this._queuePaused.has(convId)
      || !this._store.getMetadata(convId)?.queue?.some(item => item.id === edit.runId && item.status === "running"));
    if (convId && (this._deleting.has(convId) || !this._store.get(convId))) return;
    if (queueRunStopped()) return "cancelled";
    const existing = convId ? this._sessions.get(convId) : undefined;
    if (existing) {
      if (!existing.settled) this._cancelSession(convId!);
      await existing.done;
      if (this._deleting.has(convId!)) return;
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
          return turnsToTranscript(conv.turns, 6000);
        },
      }).catch(() => "");
    }

    // Editing an earlier message: truncate persisted turns + model history to
    // that point, and optionally revert still-pending file edits made after it.
    if (edit?.fromIndex != null && convId && this._store.get(convId)) {
      if (edit.revertFiles) await pendingChanges.rejectAll({ conversationId: convId, fromTurnIndex: edit.fromIndex });
      await this._truncateConversation(convId, edit.fromIndex);
    }
    const settings = this.settingsManager.getSettings();
    let modelId = submittedModel;
    // Auto mode is hidden for now; a lingering "auto" selection (or empty)
    // resolves to the first enabled model. (Judge-based routing kept in
    // _resolveAutoModel for when Auto returns.)
    if (modelId === "auto" || !modelId) {
      modelId = this._buildModelList([]).find((m) => m.id !== "auto")?.id || modelId;
    }
    // Resolve connection details without starting a local server yet — we want
    // the chat UI to show a "loading model" state while it boots (below).
    const prov = await this._resolveProviderForModel(modelId, { load: false });
    if (queueRunStopped()) return "cancelled";
    const apiKey = prov.apiKey;

    if (!apiKey && !prov.apiKeyPool && prov.anthropic) {
      vscode.window.showErrorMessage("OpenCursor: Missing API key. Please open settings to add one.");
      this._view?.webview.postMessage({
        type: "error",
        convId,
        message: "Missing API Key. Provide it in Settings.",
      });
      return;
    }

    // A new chat gets its record once; existing/background sends retain their target.
    const created = !convId;
    if (!convId) {
      const features = this.featureStore.get();
      const personaId = this._pendingPersonaId ?? features.activePersonaId;
      const conv = await this._store.create(personaId);
      convId = conv.id;
      if (this._activeId === selectedAtSubmit) this._activeId = conv.id;
      this._pendingPersonaId = undefined;
    }
    const storedConversation = this._store.get(convId);
    const isFirstMessage = (storedConversation?.steps.length ?? 0) === 0;
    if (isFirstMessage) {
      const fallback = text.trim() ? titleFromText(renderMentionTokens(text)) : attachments?.length ? `${attachments.length} attachment(s)` : "New chat";
      await this._store.update(convId, { title: fallback });
    }
    if (queueRunStopped()) return "cancelled";
    const history = storedConversation?.steps ?? [];
    const contextState = storedConversation?.contextState ?? {};

    // Host owns the authoritative UI turns: seed from persisted turns + this
    // user message, then accumulate streamed events below. The webview is just a
    // renderer, so closing/moving/reopening it never loses or breaks the run.
    const seededTurns: Turn[] = [
      ...(storedConversation?.turns ?? []),
      { role: "user" as const, text, attachments: attachments?.length ? (attachments as any) : undefined, model: modelId, mode: submittedMode },
    ];
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => { resolveDone = resolve; });
    const session: RunSession = {
      done, resolveDone,
      abort: new AbortController(),
      subagentAborts: new Map(),
      pendingQuestions: new Map(),
      pendingApprovals: new Map(),
      turns: applyEvent(seededTurns, { type: "run-status", status: "running" }),
      history,
      contextState,
    };
    this._sessions.set(convId, session);

    const features = this.featureStore.get();
    const mode = submittedMode;
    // beforeSubmit hooks may veto the prompt entirely.
    {
      const veto = await runBlockingHooks(features.hooks, "beforeSubmit", { prompt: text }, undefined, session.abort.signal);
      if (veto || session.abort.signal.aborted) {
        this._sessions.delete(convId);
        session.resolveDone();
        this._view?.webview.postMessage({ type: "agentEvent", convId, event: { type: "run-status", status: "cancelled" } });
        if (!session.abort.signal.aborted) vscode.window.showWarningMessage(`OpenCursor: prompt blocked by hook — ${veto}`);
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
    let finalStatus: "finished" | "cancelled" | "error" = "finished";
    let reachedLimit = false;
    const emit = (event: AgentEvent) => {
      if (event.type === "error") {
        SidebarProvider.log.appendLine(`[${new Date().toISOString()}] [agent] ${event.message}`);
      } else if (event.type === "retry") {
        SidebarProvider.log.appendLine(`[${new Date().toISOString()}] [retry ${event.attempt}/${event.max}] ${event.error}`);
      }
      // Maintain authoritative host turns from the same reducer the UI uses, then
      // persist (throttled) so any webview reload restores the live state exactly.
      const ev = event as unknown as SharedAgentEvent;
      if (ev.type === "max-steps") reachedLimit = true;

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
        session.turns = applyEvent(session.turns, ev);
        if (ev.status === "finished" || ev.status === "cancelled" || ev.status === "error") {
          session.settled = true;
          finalStatus = ev.status;
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
          void recordUsage(ev.model ?? stripModelScope(modelId), ev.promptTokens, ev.completionTokens, ev);
        }
        // Persist per-conversation context consumption (composer ring after reload).
        if (!ev.source || ev.source === "parent") void this._store.update(convId, { usedTokens: ev.totalTokens });
      } else if (ev.type === "run-result") {
        session.turns = applyEvent(session.turns, ev);
        this._persistTurnsNow(convId, session);
      } else if (ev.type !== "mode-changed" && ev.type !== "shell-notify") {
        session.turns = applyEvent(session.turns, ev);
        this._schedulePersistTurns(convId, session);
      }
      this._view?.webview.postMessage({ type: "agentEvent", convId, event });
    };

    // Surface the (possibly new) conversation in the tab bar immediately.
    if (this._activeId === convId) await this._store.setActiveId(convId);
    this._sendConversations();

    try {
      this._view?.webview.postMessage({ type: "runStarted", convId, prompt: text, created, turns: session.turns });

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
        this._titleAborts.get(convId)?.abort();
        const titleAbort = new AbortController();
        this._titleAborts.set(convId, titleAbort);
        const abortTitle = () => titleAbort.abort();
        if (session.abort.signal.aborted) abortTitle();
        else session.abort.signal.addEventListener("abort", abortTitle, { once: true });
        generateTitle(prov.baseUrl, apiKey, prov.model, text, prov.anthropic, prov.oauthKind, {
          apiKeyPool: prov.apiKeyPool,
          signal: titleAbort.signal,
          onUsage: (event) => {
            if (this.featureStore.get().trackUsage !== false) void recordUsage(event.model ?? prov.model, event.promptTokens ?? 0, event.completionTokens ?? 0, event);
          },
        })
          .then(async (title) => {
            if (title && this._store.get(convId)) {
              await this._store.update(convId, { title });
              this._sendConversations();
            }
          })
          .catch((error) => logError("title.generate", error, { conversationId: convId }))
          .finally(() => {
            session.abort.signal.removeEventListener("abort", abortTitle);
            if (this._titleAborts.get(convId) === titleAbort) this._titleAborts.delete(convId);
          });
      }

      const activeRunId = edit?.runId ?? randomUUID();
      // Synthetic local providers have no configured provider entry to supply their kind.
      const modelKind = prov.oauthKind ?? (prov.providerId === "ollama" || prov.providerId === "llamacpp"
        ? prov.providerId : features.providers.find((p) => p.id === prov.providerId)?.kind);
      let steeringBatch: QueuedMessage[] = [];
      await runAgent({
        workspaceRoot: getWorkspaceRoot(),
        runId: activeRunId,
        goal: this._store.getMetadata(convId)?.goal?.status === "active" ? this._store.getMetadata(convId)?.goal : undefined,
        onGoalUsage: (deltaTokens) => {
          const goal = this._store.getMetadata(convId)?.goal;
          if (goal) void this._store.update(convId, { goal: { ...goal, tokensUsed: goal.tokensUsed + deltaTokens, updatedAt: Date.now() } }).then(() => this._sendWorkflowState());
        },
        onGoalStatus: (status) => {
          const goal = this._store.getMetadata(convId)?.goal;
          if (goal) void this._store.update(convId, { goal: { ...goal, status, updatedAt: Date.now() } }).then(() => this._sendWorkflowState());
        },
        drainSteering: async () => {
          const messages = this._store.getMetadata(convId)?.steeringQueue ?? [];
          if (!messages.length) return [];
          // Delivery cannot outrun persistence. The mailbox remains recoverable
          // until onRunEvent saves it together with the updated model history.
          await this._store.flush();
          if (session.abort.signal.aborted || session.settled) return [];
          const pending = new Set(this._store.getMetadata(convId)?.steeringQueue?.map(item => item.id));
          steeringBatch = messages.filter(item => pending.has(item.id));
          return steeringBatch.map(item => item.text);
        },
        onRunEvent: async (event) => {
          const data = event.data as { runId?: string; text?: string } | undefined;
          if (event.type === "steering" && data?.runId === activeRunId) {
            const applied = steeringBatch.shift();
            if (applied) {
              // Commit consumption before journal I/O can yield to another
              // history save and leave already-applied guidance pending.
              emit({ type: "user-steering", text: applied.text, requestId: applied.id });
              await this._store.update(convId, {
                turns: session.turns, steps: history, contextState,
                steeringQueue: (this._store.getMetadata(convId)?.steeringQueue ?? []).filter(item => item.id !== applied.id),
              });
              this._sendWorkflowState();
            }
          }
          const storage = workspaceStorageDirectory(this.context);
          if (storage) {
            let journal = this._journals.get(convId);
            if (!journal) { journal = new RunJournal(path.join(storage, "runs"), convId); this._journals.set(convId, journal); }
            await journal.append(event);
          }
          await this._store.appendRunEvent(convId, { ...event, runId: edit?.runId ?? convId });
        },
        apiBaseUrl: prov.baseUrl,
        apiKey: apiKey,
        apiKeyPool: prov.apiKeyPool,
        model: prov.model,
        anthropic: prov.anthropic,
        oauthKind: prov.oauthKind,
        mode,
        // The AI receives the text as-is, <attached /> tags included; the
        // resolved context blocks for those tags are appended after it.
        prompt: mentionContext ? `${text}\n\n${mentionContext}` : text,
        attachments,
        history,
        contextState,
        changeOwner: { conversationId: convId, runId: `run_${Date.now()}_${Math.random().toString(36).slice(2)}`, turnIndex: seededTurns.length - 1 },
        promptCacheKey: convId,
        maxTokens: settings.maxResponseLength > 0 ? settings.maxResponseLength : undefined,
        maxSteps: features.maxAgentSteps > 0 ? features.maxAgentSteps : undefined,
        autoContinue: features.autoContinue === true,
        // Note: modelId (not prov.model — that's the gguf basename for llama.cpp).
        contextTokens: this._contextTokensFor(modelId, modelKind),
        modelParams: optionsToParams(this.featureStore.optionsFor(prov.model, modelKind)),
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
        resolveModelOptions: (childModel) => {
          return {
            contextTokens: this._contextTokensFor(childModel, modelKind),
            modelParams: optionsToParams(this.featureStore.optionsFor(childModel, modelKind)),
            maxTokens: settings.maxResponseLength > 0 ? settings.maxResponseLength : undefined,
          };
        },
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
        onBeforeShell: (command, hookSignal) => runBlockingHooks(features.hooks, "beforeShell", { command }, undefined, hookSignal ?? session.abort.signal),
        onAfterEdit: (path) => runHooks(features.hooks, "afterEdit", { path }),
        onHook: (event, context, tool, hookSignal) => runBlockingHooks(features.hooks, event, context, tool, hookSignal ?? session.abort.signal),
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
        for (const p of [...session.pendingApprovals.values()]) {
          try { p.resolve(false); } catch { /* ignore */ }
        }
        // Only force-close still-open work; leave completed tools alone.
        session.turns = forceSettleOpenWork(closeTrailingThinking(session.turns), "cancelled");
        if (session.persistTimer) { clearTimeout(session.persistTimer); session.persistTimer = undefined; }
        await this._store.update(convId, { turns: session.turns, steps: history, contextState });
        if (reachedLimit || this._store.getMetadata(convId)?.goal?.status === "budgetLimited") this._queuePaused.add(convId);
        await this._restorePendingSteering(convId);
      } catch (e: unknown) {
        logError("agent.cleanup", e, { conversationId: convId });
      } finally {
        this._sessions.delete(convId);
        session.resolveDone();
        this._sendConversations();
        // Guarantee webview leaves "Working" even if run-status was lost (IDE reopen, stuck subagent).
        this._view?.webview.postMessage({
          type: "agentEvent",
          convId,
          event: { type: "run-status", status: session.abort.signal.aborted ? "cancelled" : finalStatus },
        });
      }
    }
    return session.abort.signal.aborted ? "cancelled" : finalStatus;
  }

  /**
   * Hard-stop a conversation run: parent abort + every subagent, pending
   * approvals/questions, and force-settled UI. Safe to call repeatedly.
   */
  private _cancelSession(convId: string): void {
    this._titleAborts.get(convId)?.abort();
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
    for (const p of [...session.pendingApprovals.values()]) {
      try { p.resolve(false); } catch { /* ignore */ }
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
