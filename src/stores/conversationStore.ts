/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as syncFs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { atomicWrite } from "./durableFiles";
import { logError } from "../logging";
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
  /** User opted in to editing this conversation's assistant text and reasoning. */
  allowModelOutputEdits?: boolean;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
  archivedAt?: number;
  excerpt?: string;
  allowModelOutputEdits?: boolean;
}

/** Run evidence kept per conversation; the durable run journal holds the full record. */
export const MAX_RUN_EVENTS = 500;
/** Queue outcomes deduplicate retransmitted requests, so they outlive ordinary events. */
const MAX_QUEUE_EVENTS = 500;
export function capRunEvents<T extends { type: string }>(events: T[]): T[] {
  if (events.length <= MAX_RUN_EVENTS) return events;
  const queue = events.filter((event) => event.type.startsWith("queue.")).slice(-MAX_QUEUE_EVENTS);
  const other = events.filter((event) => !event.type.startsWith("queue.")).slice(-MAX_RUN_EVENTS);
  const keep = new Set<T>([...queue, ...other]);
  return events.filter((event) => keep.has(event));
}
/** Archived transcripts keep only a preview of long tool output. */
const ARCHIVED_TOOL_OUTPUT = 4_000;
function clip(text: string): string {
  return text.length > ARCHIVED_TOOL_OUTPUT ? `${text.slice(0, ARCHIVED_TOOL_OUTPUT)}
… [${text.length - ARCHIVED_TOOL_OUTPUT} characters of archived tool output trimmed]` : text;
}
function trimTurns(turns: Turn[]): Turn[] {
  const trimBlocks = <B extends { kind: string }>(blocks: B[]): B[] => blocks.map((block) => {
    if (block.kind !== "tool") return block;
    const tool = block as unknown as { result?: string; subBlocks?: { kind: string }[] };
    return { ...block, ...(tool.result ? { result: clip(tool.result) } : {}), ...(tool.subBlocks ? { subBlocks: trimBlocks(tool.subBlocks) } : {}) };
  });
  return turns.map((turn) => turn.role === "assistant" ? { ...turn, blocks: trimBlocks(turn.blocks) } : turn);
}
/** Trim stored tool output once a conversation is archived; the run journal keeps evidence. */
export function trimArchivedConversation(conversation: Conversation): Conversation {
  return {
    ...conversation,
    turns: trimTurns(conversation.turns),
    steps: conversation.steps.map((step) => step.kind === "tool-result" ? { ...step, output: clip(step.output), image: undefined } : step),
    runEvents: (conversation.runEvents ?? []).filter((event) => event.type.startsWith("queue.")).slice(-MAX_QUEUE_EVENTS),
  };
}

const KEY = "ocursor.conversations";
const ACTIVE_KEY = "ocursor.activeConversation";
const UI_KEY = "ocursor.chatWorkspace.v1";
/** Composer drafts arrive per keystroke; storage only needs the settled text. */
const UI_WRITE_DELAY_MS = 250;
/** Transcript bodies kept in memory once their file is current (LRU beyond this). */
const MAX_LOADED_BODIES = 8;
const BODY_PREFIX = "body:";

type ConversationMetadata = Omit<Conversation, "steps" | "turns" | "contextState" | "runEvents">;
type Snapshot = unknown | (() => unknown);
type PendingWrite = { snapshot: Snapshot; waiters: { resolve: () => void; reject: (error: unknown) => void }[] };
type StoreState = {
  conversations: Conversation[]; ui: ChatWorkspaceState; writes: Promise<void>;
  pendingWrites: Map<string, PendingWrite>; draining?: Promise<void>;
  ready: Promise<void>; latestWrites: Map<string, Promise<void>>;
  /** Per-conversation transcript files; undefined keeps everything in the Memento. */
  directory?: string;
  /** File-backed conversations whose transcript is not currently in memory. */
  unloaded: Set<string>;
  /** Transcripts that must stay inline in the Memento (legacy data, or a failed file write). */
  inline: Set<string>;
  /** Unloaded conversations saved with an unsettled run (restart recovery). */
  openRuns: Set<string>;
  recent: Map<string, number>; tick: number;
  inFlight?: string;
  uiTimer?: ReturnType<typeof setTimeout>;
  uiWaiters: { resolve: () => void; reject: (error: unknown) => void }[];
};
// A single synchronous view per workspace prevents competing live sessions from
// losing each other's changes while VS Code asynchronously flushes its Memento.
const sharedStates = new WeakMap<vscode.Memento, StoreState>();
type ConversationPatch = Partial<Pick<Conversation, "steps" | "contextState" | "turns" | "title" | "personaId" | "usedTokens" | "archivedAt" | "goal" | "queue" | "reviewTarget" | "runEvents" | "steeringQueue" | "steering" | "workspaceRoot" | "allowModelOutputEdits">>;
const BODY_KEYS = ["turns", "steps", "contextState", "runEvents"] as const;
type StoredConversation = Conversation & { bodyInFile?: true; openRun?: true };

function hasOpenRun(turns: Turn[] | undefined): boolean {
  return !!turns?.some((turn) => turn.role === "assistant" && turn.startedAt != null && turn.endedAt == null);
}
function withoutBody(conversation: Conversation): Conversation {
  const result = { ...conversation } as Partial<Conversation>;
  delete result.steps; delete result.turns; delete result.contextState; delete result.runEvents;
  return result as Conversation;
}

/**
 * VS Code serializes an extension's entire Memento (and ships it to the main
 * process) on every update. Keeping transcripts there made each streaming save
 * and each draft keystroke reserialize every conversation in the workspace, so
 * transcripts live in one file per conversation and the Memento holds metadata.
 */
function transcriptDirectory(context: vscode.ExtensionContext): string | undefined {
  const base = context.storageUri?.fsPath ?? context.globalStorageUri?.fsPath;
  return base ? path.join(base, "conversations") : undefined;
}

export class ConversationStore {
  private readonly cache: StoreState;
  constructor(private readonly context: vscode.ExtensionContext) {
    const existing = sharedStates.get(context.workspaceState);
    if (existing) { this.cache = existing; return; }
    const current = context.workspaceState.get<StoredConversation[]>(KEY);
    const old = context.globalState.get<StoredConversation[]>(KEY);
    const directory = transcriptDirectory(context);
    this.cache = {
      conversations: [], ui: context.workspaceState.get<ChatWorkspaceState>(UI_KEY) ?? { openTabs: [], drafts: {} }, writes: Promise.resolve(),
      pendingWrites: new Map(), ready: Promise.resolve(), latestWrites: new Map(), directory,
      unloaded: new Set(), inline: new Set(), openRuns: new Set(), recent: new Map(), tick: 0, uiWaiters: [],
    };
    this.cache.conversations = structuredClone(current ?? old ?? []).map((stored) => this.adopt(stored));
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
    // Move inline (pre-file) transcripts out of the Memento in the background.
    for (const id of this.cache.inline) void this.queueWrite(BODY_PREFIX + id, id).catch(() => {});
  }

  /** Normalize one persisted record into the in-memory cache representation. */
  private adopt(stored: StoredConversation): Conversation {
    const { bodyInFile, openRun, ...conversation } = stored;
    const inlineBody = (conversation.turns?.length ?? 0) > 0 || (conversation.steps?.length ?? 0) > 0 || conversation.contextState !== undefined || (conversation.runEvents?.length ?? 0) > 0;
    if (this.cache.directory && bodyInFile && !inlineBody) {
      this.cache.unloaded.add(conversation.id);
      if (openRun) this.cache.openRuns.add(conversation.id);
      return withoutBody(conversation as Conversation);
    }
    const result = { ...conversation, turns: conversation.turns ?? [], steps: conversation.steps ?? [] } as Conversation;
    if (this.cache.directory) this.cache.inline.add(result.id);
    return result;
  }

  /** workspaceState = per-workspace storage; VS Code scopes it for us. */
  private get state(): vscode.Memento {
    return this.context.workspaceState;
  }

  private bodyFile(id: string): string {
    return path.join(this.cache.directory!, `${createHash("sha256").update(id).digest("hex").slice(0, 32)}.json`);
  }

  /** Keep only the latest pending snapshot per key when storage falls behind. */
  private queueWrite(key: string, snapshot: Snapshot): Promise<void> {
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
              this.cache.inFlight = key;
              try {
                if (key.startsWith(BODY_PREFIX)) await this.writeBody(key.slice(BODY_PREFIX.length));
                else await this.state.update(key, typeof value.snapshot === "function" ? (value.snapshot as () => unknown)() : value.snapshot);
                for (const waiter of value.waiters) waiter.resolve();
              } catch (error) {
                failure ??= error;
                for (const waiter of value.waiters) waiter.reject(error);
              } finally {
                this.cache.inFlight = undefined;
              }
            }
          }
          if (failure !== undefined) throw failure;
        } finally {
          this.cache.draining = undefined;
        }
        this.trimLoaded();
      });
      this.cache.draining = this.cache.writes = next;
      void next.catch(() => {});
    }
    return written;
  }

  /** Write one transcript file; a failure keeps that transcript inline in the Memento instead. */
  private async writeBody(id: string): Promise<void> {
    const directory = this.cache.directory!;
    const file = this.bodyFile(id);
    const conversation = this.cache.conversations.find((c) => c.id === id);
    if (!conversation) { await fs.rm(file, { force: true }); return; }
    if (this.cache.unloaded.has(id)) return;
    const json = JSON.stringify({ version: 1, id, turns: conversation.turns, steps: conversation.steps, contextState: conversation.contextState, runEvents: conversation.runEvents });
    try {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      await atomicWrite(file, json);
    } catch (error) {
      if (!this.cache.inline.has(id) && this.cache.conversations.some((c) => c.id === id)) {
        this.cache.inline.add(id);
        void this.queueWrite(KEY, () => this.snapshotList()).catch(() => {});
      }
      throw error;
    }
    if (this.cache.inline.delete(id)) void this.queueWrite(KEY, () => this.snapshotList()).catch(() => {});
  }

  /** The Memento record: metadata for file-backed transcripts, full records otherwise. */
  private snapshotList(): unknown[] {
    if (!this.cache.directory) return this.cache.conversations;
    return this.cache.conversations.map((conversation) => {
      if (this.cache.inline.has(conversation.id)) return conversation;
      const open = this.cache.unloaded.has(conversation.id) ? this.cache.openRuns.has(conversation.id) : hasOpenRun(conversation.turns);
      // Empty placeholders keep older extension versions from crashing on a downgrade.
      return { ...withoutBody(conversation), turns: [], steps: [], bodyInFile: true, ...(open ? { openRun: true } : {}) };
    });
  }

  /** Read a file-backed transcript into memory (synchronously; first access only). */
  private load(id: string): Conversation | undefined {
    const index = this.cache.conversations.findIndex((c) => c.id === id);
    if (index < 0) return undefined;
    this.cache.recent.set(id, ++this.cache.tick);
    const current = this.cache.conversations[index];
    if (!this.cache.unloaded.has(id)) return current;
    const file = this.bodyFile(id);
    let body: Partial<Conversation> = {};
    try {
      body = JSON.parse(syncFs.readFileSync(file, "utf8"));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code && code !== "ENOENT") throw error;
      if (!code) {
        // Corrupt JSON: preserve it for recovery rather than overwriting it later.
        try { syncFs.renameSync(file, `${file}.corrupt-${Date.now()}`); } catch { /* best effort */ }
        logError("conversation.load", error, { conversationId: id });
      }
    }
    const loaded: Conversation = {
      ...current, turns: Array.isArray(body.turns) ? body.turns : [], steps: Array.isArray(body.steps) ? body.steps : [],
      ...(body.contextState !== undefined ? { contextState: body.contextState } : {}),
      ...(body.runEvents !== undefined ? { runEvents: body.runEvents } : {}),
    };
    // Copy-on-write: earlier list snapshots stay immutable.
    const list = [...this.cache.conversations];
    list[index] = loaded;
    this.cache.conversations = list;
    this.cache.unloaded.delete(id);
    this.cache.openRuns.delete(id);
    return loaded;
  }

  /** Release clean, least-recently-used transcripts; their files are current. */
  private trimLoaded(): void {
    if (!this.cache.directory) return;
    const candidates = this.cache.conversations.filter((c) => !this.cache.unloaded.has(c.id));
    let excess = candidates.length - MAX_LOADED_BODIES;
    if (excess <= 0) return;
    const busy = (id: string) => this.cache.inline.has(id) || this.cache.pendingWrites.has(BODY_PREFIX + id) || this.cache.inFlight === BODY_PREFIX + id;
    const order = candidates.filter((c) => !busy(c.id)).sort((a, b) => (this.cache.recent.get(a.id) ?? 0) - (this.cache.recent.get(b.id) ?? 0));
    let list: Conversation[] | undefined;
    for (const conversation of order) {
      if (excess-- <= 0) break;
      list ??= [...this.cache.conversations];
      const index = list.indexOf(conversation);
      if (hasOpenRun(conversation.turns)) this.cache.openRuns.add(conversation.id);
      list[index] = withoutBody(conversation);
      this.cache.unloaded.add(conversation.id);
      this.cache.recent.delete(conversation.id);
    }
    if (list) this.cache.conversations = list;
  }

  private persist(list: Conversation[], bodies: string[] = []): Promise<void> {
    // Clone incoming patches, preserving immutable untouched transcripts.
    this.cache.conversations = list;
    const writes = this.cache.directory ? bodies.map((id) => this.queueWrite(BODY_PREFIX + id, id)) : [];
    const metadata = this.queueWrite(KEY, () => this.snapshotList());
    return writes.length ? Promise.all([...writes, metadata]).then(() => {}) : metadata;
  }

  list(options: { archived?: boolean; query?: string } = {}): ConversationSummary[] {
    const query = options.query?.trim().toLocaleLowerCase();
    const result = this.cache.conversations
      .filter((c) => options.archived === undefined || !!c.archivedAt === options.archived)
      .map((c) => {
        const titleMatch = !query || c.title.toLocaleLowerCase().includes(query);
        const transcript = query ? turnsToTranscript(this.loadSafely(c.id)?.turns ?? [], Number.MAX_SAFE_INTEGER) : "";
        const match = transcript.toLocaleLowerCase().indexOf(query ?? "");
        return { ...c, matches: titleMatch || match >= 0, excerpt: query && match >= 0 ? transcript.slice(Math.max(0, match - 45), match + 160).replace(/\s+/g, " ") : undefined };
      })
      .filter((c) => c.matches)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, archivedAt: c.archivedAt, excerpt: c.excerpt, ...(c.allowModelOutputEdits ? { allowModelOutputEdits: true } : {}) }));
    if (query) this.trimLoaded();
    return result;
  }

  private loadSafely(id: string): Conversation | undefined {
    try { return this.load(id); } catch (error) { logError("conversation.load", error, { conversationId: id }); return undefined; }
  }

  /** Cheap existence check that never reads or copies a transcript. */
  has(id: string): boolean {
    return this.cache.conversations.some((c) => c.id === id);
  }

  get(id: string): Conversation | undefined {
    const conversation = this.loadSafely(id);
    if (!conversation) {
      const metadata = this.cache.conversations.find((c) => c.id === id);
      // An unreadable transcript is shown empty but never overwritten (update() rejects).
      return metadata ? { ...structuredClone(metadata), turns: [], steps: [] } : undefined;
    }
    const copy = structuredClone(conversation);
    this.trimLoaded();
    return copy;
  }

  getMetadata(id: string): ConversationMetadata | undefined {
    const conversation = this.cache.conversations.find((c) => c.id === id);
    return conversation ? this.metadata(conversation) : undefined;
  }

  listMetadata(): ConversationMetadata[] {
    return this.cache.conversations.map(conversation => this.metadata(conversation));
  }

  private metadata(conversation: Conversation): ConversationMetadata {
    return structuredClone(withoutBody(conversation)) as ConversationMetadata;
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
    this.cache.recent.set(conv.id, ++this.cache.tick);
    // A missing transcript file reads as empty, so a new chat writes only metadata.
    await this.persist(list);
    await this.setActiveId(conv.id);
    return structuredClone(conv);
  }

  update(id: string, patch: ConversationPatch): Promise<void> {
    if (!this.cache.conversations.some((c) => c.id === id)) return Promise.resolve();
    const needsBody = BODY_KEYS.some((key) => key in patch) || patch.archivedAt !== undefined;
    if (needsBody && this.cache.unloaded.has(id)) {
      try { this.load(id); } catch (error) { return Promise.reject(error); }
    }
    const list = [...this.cache.conversations];
    const i = list.findIndex((c) => c.id === id);
    const current = list[i];
    // Frequent saves (token usage, goal counters, unchanged turns) must not
    // rewrite the whole store when nothing actually changed.
    const changed = (Object.keys(patch) as (keyof ConversationPatch)[]).filter((key) => {
      const next = patch[key], previous = current[key];
      if (next === previous) return false;
      // Transcripts are compared by identity; deep comparison would cost as much as saving.
      if (key === "turns" || key === "steps" || key === "contextState" || key === "runEvents") return true;
      if (next === undefined || previous === undefined || typeof next !== "object" || typeof previous !== "object") return true;
      return JSON.stringify(next) !== JSON.stringify(previous);
    });
    if (!changed.length) return this.cache.latestWrites.get(KEY) ?? Promise.resolve();
    const changes = Object.fromEntries(changed.map((key) => [key, patch[key]])) as ConversationPatch;
    if (changes.runEvents) changes.runEvents = capRunEvents(changes.runEvents);
    let next: Conversation = { ...current, ...structuredClone(changes), updatedAt: Date.now() };
    let bodyChanged = changed.some((key) => (BODY_KEYS as readonly string[]).includes(key));
    if (changes.archivedAt && !current.archivedAt) { next = trimArchivedConversation(next); bodyChanged = true; }
    list[i] = next;
    this.cache.recent.set(id, ++this.cache.tick);
    return this.persist(list, bodyChanged ? [id] : []);
  }

  async delete(id: string): Promise<void> {
    const list = this.cache.conversations.filter((c) => c.id !== id);
    this.cache.unloaded.delete(id); this.cache.inline.delete(id); this.cache.openRuns.delete(id); this.cache.recent.delete(id);
    // writeBody removes the transcript file of a conversation that no longer exists.
    await this.persist(list, [id]);
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
    this.cache.unloaded.delete(fork.id);
    await this.persist(list, [fork.id]);
    return structuredClone(fork);
  }

  async enqueue(id: string, message: QueuedMessage): Promise<boolean> {
    const conversation = this.load(id);
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
    // Only transcripts saved mid-run need reading; others stay on disk.
    for (const id of [...this.cache.openRuns]) this.loadSafely(id);
    const list = this.cache.conversations.map(conversation => ({ ...conversation }));
    let changed = false;
    const bodies: string[] = [];
    for (const conversation of list) {
      if (!this.cache.unloaded.has(conversation.id) && hasOpenRun(conversation.turns)) {
        // A restarted host cannot know the exact interruption time. Use the
        // last saved snapshot instead of counting time while the IDE was shut.
        conversation.turns = forceSettleOpenWork(conversation.turns, "cancelled", conversation.updatedAt);
        changed = true;
        bodies.push(conversation.id);
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
    if (changed) await this.persist(list, bodies);
  }

  getWorkspaceState(): ChatWorkspaceState {
    const stored = this.cache.ui;
    const existing = new Set(this.cache.conversations.map((c) => c.id));
    return { openTabs: [...new Set(stored?.openTabs ?? [])].filter((id) => id === "" || existing.has(id)), drafts: structuredClone(stored?.drafts ?? {}) };
  }

  async setWorkspaceState(patch: Partial<ChatWorkspaceState>): Promise<void> {
    const current = this.cache.ui;
    const existing = new Set(this.cache.conversations.map((c) => c.id));
    // The cache owns its snapshot; only the caller's patch needs copying.
    this.cache.ui = {
      openTabs: [...new Set(current?.openTabs ?? [])].filter((id) => id === "" || existing.has(id)), drafts: current?.drafts ?? {},
      ...structuredClone(patch),
    };
    // Drafts arrive per keystroke: coalesce them into one storage write.
    const written = new Promise<void>((resolve, reject) => this.cache.uiWaiters.push({ resolve, reject }));
    this.cache.uiTimer ??= setTimeout(() => this.releaseWorkspaceState(), UI_WRITE_DELAY_MS);
    await written;
  }

  private releaseWorkspaceState(): void {
    if (this.cache.uiTimer) clearTimeout(this.cache.uiTimer);
    this.cache.uiTimer = undefined;
    const waiters = this.cache.uiWaiters.splice(0);
    if (!waiters.length) return;
    this.queueWrite(UI_KEY, () => this.cache.ui).then(
      () => { for (const waiter of waiters) waiter.resolve(); },
      (error) => { for (const waiter of waiters) waiter.reject(error); },
    );
  }

  async appendRunEvent(id: string, event: { runId: string; type: string; at: number; data?: unknown }): Promise<void> {
    const conversation = this.load(id);
    if (conversation) await this.update(id, { runEvents: [...conversation.runEvents ?? [], event] });
  }

  /** A barrier for writes already submitted; later token saves cannot extend it. */
  flush(): Promise<void> {
    this.releaseWorkspaceState();
    return Promise.all([this.cache.ready, ...this.cache.latestWrites.values()]).then(() => {});
  }
}

/** Derive a short title from the first user message. */
export function titleFromText(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 40 ? t.slice(0, 40) + "…" : t || "New Chat";
}
