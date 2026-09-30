/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import type { Step } from "../agent/types";
import type { Turn } from "../shared/turns";
import type { ContextState } from "../agent/contextState";
import { forceSettleOpenWork, turnsToTranscript } from "../shared/turns";
import type { ChatWorkspaceState, ConversationGoal, QueuedMessage, ReviewTarget } from "../shared/chatSession";

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  steps: Step[];
  contextState?: ContextState;
  /** Authoritative UI turns, owned by the host and persisted for rendering. */
  turns: Turn[];
  /** Persona/preset this conversation uses. */
  personaId?: string;
  /** Tokens consumed by the last run (drives the composer context ring). */
  usedTokens?: number;
  archivedAt?: number;
  forkedFrom?: string;
  goal?: ConversationGoal;
  queue?: QueuedMessage[];
  reviewTarget?: ReviewTarget;
  runEvents?: { runId: string; type: string; at: number; data?: unknown }[];
  /** Accepted steering retains its request identity until its history is saved. */
  steeringQueue?: QueuedMessage[];
  steering?: string[];
  workspaceRoot?: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
  archivedAt?: number;
  excerpt?: string;
}

const KEY = "ocursor.conversations";
const ACTIVE_KEY = "ocursor.activeConversation";
const UI_KEY = "ocursor.chatWorkspace.v1";

type ConversationMetadata = Omit<Conversation, "steps" | "turns" | "contextState" | "runEvents">;
type PendingWrite = { snapshot: unknown; waiters: { resolve: () => void; reject: (error: unknown) => void }[] };
type StoreState = {
  conversations: Conversation[]; ui: ChatWorkspaceState; writes: Promise<void>;
  pendingWrites: Map<string, PendingWrite>; draining?: Promise<void>;
  ready: Promise<void>; latestWrites: Map<string, Promise<void>>;
};
// A single synchronous view per workspace prevents competing live sessions from
// losing each other's changes while VS Code asynchronously flushes its Memento.
const sharedStates = new WeakMap<vscode.Memento, StoreState>();
type ConversationPatch = Partial<Pick<Conversation, "steps" | "contextState" | "turns" | "title" | "personaId" | "usedTokens" | "archivedAt" | "goal" | "queue" | "reviewTarget" | "runEvents" | "steeringQueue" | "steering" | "workspaceRoot">>;

export class ConversationStore {
  private readonly cache: StoreState;
  constructor(private readonly context: vscode.ExtensionContext) {
    const existing = sharedStates.get(context.workspaceState);
    if (existing) { this.cache = existing; return; }
    const current = context.workspaceState.get<Conversation[]>(KEY);
    const old = context.globalState.get<Conversation[]>(KEY);
    this.cache = { conversations: structuredClone(current ?? old ?? []), ui: context.workspaceState.get<ChatWorkspaceState>(UI_KEY) ?? { openTabs: [], drafts: {} }, writes: Promise.resolve(), pendingWrites: new Map(), ready: Promise.resolve(), latestWrites: new Map() };
    sharedStates.set(context.workspaceState, this.cache);
    if (!current && old?.length) {
      this.cache.writes = Promise.resolve(this.state.update(KEY, structuredClone(old))).then(async () => {
        const active = context.globalState.get<string>(ACTIVE_KEY);
        if (active) await this.state.update(ACTIVE_KEY, active);
        await context.globalState.update(KEY, undefined);
        await context.globalState.update(ACTIVE_KEY, undefined);
      });
    }
    this.cache.ready = this.cache.writes;
  }

  /** workspaceState = per-workspace storage; VS Code scopes it for us. */
  private get state(): vscode.Memento {
    return this.context.workspaceState;
  }

  /** Keep only the latest pending snapshot per key when storage falls behind. */
  private queueWrite(key: string, snapshot: unknown): Promise<void> {
    const pending = this.cache.pendingWrites.get(key) ?? { snapshot, waiters: [] };
    pending.snapshot = snapshot;
    const written = new Promise<void>((resolve, reject) => pending.waiters.push({ resolve, reject }));
    this.cache.pendingWrites.set(key, pending);
    this.cache.latestWrites.set(key, written);
    if (!this.cache.draining) {
      const next = this.cache.writes.catch(() => {}).then(async () => {
        let failure: unknown;
        try {
          while (this.cache.pendingWrites.size) {
            const batch = this.cache.pendingWrites;
            this.cache.pendingWrites = new Map();
            for (const [key, value] of batch) {
              try {
                await this.state.update(key, value.snapshot);
                for (const waiter of value.waiters) waiter.resolve();
              } catch (error) {
                failure ??= error;
                for (const waiter of value.waiters) waiter.reject(error);
              }
            }
          }
          if (failure !== undefined) throw failure;
        } finally {
          this.cache.draining = undefined;
        }
      });
      this.cache.draining = this.cache.writes = next;
      void next.catch(() => {});
    }
    return written;
  }

  private persist(list: Conversation[]): Promise<void> {
    // Clone incoming patches, preserving immutable untouched transcripts.
    this.cache.conversations = list;
    return this.queueWrite(KEY, list);
  }

  list(options: { archived?: boolean; query?: string } = {}): ConversationSummary[] {
    const query = options.query?.trim().toLocaleLowerCase();
    return this.cache.conversations
      .filter((c) => options.archived === undefined || !!c.archivedAt === options.archived)
      .map((c) => {
        const transcript = query ? turnsToTranscript(c.turns, Number.MAX_SAFE_INTEGER) : "";
        const match = transcript.toLocaleLowerCase().indexOf(query ?? "");
        const titleMatch = !query || c.title.toLocaleLowerCase().includes(query);
        return { ...c, matches: titleMatch || match >= 0, excerpt: query && match >= 0 ? transcript.slice(Math.max(0, match - 45), match + 160).replace(/\s+/g, " ") : undefined };
      })
      .filter((c) => c.matches)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, archivedAt: c.archivedAt, excerpt: c.excerpt }));
  }

  get(id: string): Conversation | undefined {
    const conversation = this.cache.conversations.find((c) => c.id === id);
    return conversation ? structuredClone(conversation) : undefined;
  }

  getMetadata(id: string): ConversationMetadata | undefined {
    const conversation = this.cache.conversations.find((c) => c.id === id);
    return conversation ? this.metadata(conversation) : undefined;
  }

  listMetadata(): ConversationMetadata[] {
    return this.cache.conversations.map(conversation => this.metadata(conversation));
  }

  private metadata(conversation: Conversation): ConversationMetadata {
    const result = { ...conversation } as Partial<Conversation>;
    delete result.steps; delete result.turns; delete result.contextState; delete result.runEvents;
    return structuredClone(result) as ConversationMetadata;
  }

  getActiveId(): string | undefined {
    return this.state.get<string>(ACTIVE_KEY);
  }

  async setActiveId(id: string | undefined): Promise<void> {
    await this.state.update(ACTIVE_KEY, id);
  }

  async create(personaId?: string): Promise<Conversation> {
    const now = Date.now();
    const conv: Conversation = {
      id: `c_${now}_${Math.random().toString(36).slice(2, 8)}`,
      title: "New Chat",
      createdAt: now,
      updatedAt: now,
      steps: [],
      turns: [],
      personaId,
    };
    const list = [...this.cache.conversations, conv];
    await this.persist(list);
    await this.setActiveId(conv.id);
    return structuredClone(conv);
  }

  update(id: string, patch: ConversationPatch): Promise<void> {
    const list = [...this.cache.conversations];
    const i = list.findIndex((c) => c.id === id);
    if (i === -1) return Promise.resolve();
    list[i] = { ...list[i], ...structuredClone(patch), updatedAt: Date.now() };
    return this.persist(list);
  }

  async delete(id: string): Promise<void> {
    const list = this.cache.conversations.filter((c) => c.id !== id);
    await this.persist(list);
    if (this.getActiveId() === id) {
      await this.setActiveId(undefined);
    }
    const ui = this.getWorkspaceState();
    delete ui.drafts[id];
    ui.openTabs = ui.openTabs.filter((tab) => tab !== id);
    await this.setWorkspaceState(ui);
  }

  async fork(id: string): Promise<Conversation> {
    const original = this.get(id);
    if (!original) throw new Error("Conversation no longer exists.");
    const copy = await this.create(original.personaId);
    const list = [...this.cache.conversations];
    const index = list.findIndex((c) => c.id === copy.id);
    const fork: Conversation = {
      ...original, id: copy.id, title: `${original.title} (fork)`,
      createdAt: copy.createdAt, updatedAt: copy.createdAt, forkedFrom: id,
      archivedAt: undefined, queue: [], runEvents: [], goal: undefined, steeringQueue: [], steering: [],
    };
    list[index] = fork;
    await this.persist(list);
    return structuredClone(fork);
  }

  async enqueue(id: string, message: QueuedMessage): Promise<boolean> {
    const conversation = this.cache.conversations.find(conversation => conversation.id === id);
    if (!conversation) throw new Error("Conversation no longer exists.");
    // Retransmission from the UI must not enqueue the same accepted request twice.
    if (conversation.queue?.some((item) => item.id === message.id)
      || conversation.steeringQueue?.some((item) => item.id === message.id)
      || conversation.runEvents?.some((event) => event.runId === message.id && ["queue.finished", "queue.cancelled", "queue.superseded", "queue.steered"].includes(event.type))) return false;
    await this.update(id, { queue: [...conversation.queue ?? [], message], archivedAt: undefined });
    return true;
  }

  async updateQueue(id: string, transform: (queue: QueuedMessage[]) => QueuedMessage[]): Promise<void> {
    const conversation = this.getMetadata(id);
    if (conversation) await this.update(id, { queue: transform(conversation.queue ?? []) });
  }

  async recoverInterruptedRuns(): Promise<void> {
    const list = this.cache.conversations.map(conversation => ({ ...conversation }));
    let changed = false;
    for (const conversation of list) {
      if (conversation.turns.some((turn) => turn.role === "assistant" && turn.startedAt != null && turn.endedAt == null)) {
        // A restarted host cannot know the exact interruption time. Use the
        // last saved snapshot instead of counting time while the IDE was shut.
        conversation.turns = forceSettleOpenWork(conversation.turns, "cancelled", conversation.updatedAt);
        changed = true;
      }
      conversation.queue = (conversation.queue ?? []).map((item) => {
        if (item.status !== "running") return item;
        changed = true;
        return { ...item, status: "interrupted", error: "The extension restarted during this request. Resume to reconcile completed work before continuing." };
      });
      if (conversation.steeringQueue?.length || conversation.steering?.length) {
        const ids = new Set(conversation.queue.map((item) => item.id));
        for (const item of conversation.steeringQueue ?? []) {
          if (ids.has(item.id)) continue;
          ids.add(item.id);
          conversation.queue.push({ ...item, status: "queued", error: undefined });
        }
        for (const text of conversation.steering ?? []) {
          conversation.queue.push({ id: randomUUID(), text, status: "queued", createdAt: Date.now() });
        }
        // Clear both mailboxes in the same snapshot as queue recovery. Repeating
        // startup cannot lose a pending correction or enqueue it a second time.
        conversation.steeringQueue = [];
        conversation.steering = [];
        changed = true;
      }
    }
    if (changed) await this.persist(list);
  }

  getWorkspaceState(): ChatWorkspaceState {
    const stored = this.cache.ui;
    const existing = new Set(this.cache.conversations.map((c) => c.id));
    return { openTabs: [...new Set(stored?.openTabs ?? [])].filter((id) => id === "" || existing.has(id)), drafts: structuredClone(stored?.drafts ?? {}) };
  }

  async setWorkspaceState(patch: Partial<ChatWorkspaceState>): Promise<void> {
    const current = this.getWorkspaceState();
    const snapshot = { ...current, ...structuredClone(patch) };
    this.cache.ui = snapshot;
    await this.queueWrite(UI_KEY, snapshot);
  }

  async appendRunEvent(id: string, event: { runId: string; type: string; at: number; data?: unknown }): Promise<void> {
    const conversation = this.cache.conversations.find(conversation => conversation.id === id);
    if (conversation) await this.update(id, { runEvents: [...conversation.runEvents ?? [], event].slice(-2000) });
  }

  /** A barrier for writes already submitted; later token saves cannot extend it. */
  flush(): Promise<void> { return Promise.all([this.cache.ready, ...this.cache.latestWrites.values()]).then(() => {}); }
}

/** Derive a short title from the first user message. */
export function titleFromText(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 40 ? t.slice(0, 40) + "…" : t || "New Chat";
}
