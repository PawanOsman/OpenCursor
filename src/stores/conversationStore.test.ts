/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { expect, it, vi } from "vitest";
vi.mock("vscode", () => ({}));
import { ConversationStore } from "./conversationStore";
import { buildMessages, snapshotUserContext } from "../agent/messages";
import { restoreContext, saveContext, type ContextState } from "../agent/contextState";
import type { Step } from "../agent/types";

function storage() {
  const values = new Map<string, string>();
  return {
    get: <T>(key: string, fallback?: T): T | undefined => values.has(key) ? JSON.parse(values.get(key)!) : fallback,
    update: async (key: string, value: unknown) => {
      if (value === undefined) values.delete(key);
      else values.set(key, JSON.stringify(value));
    },
  };
}

it("persists original request envelopes and working checkpoints through actual conversation save/reopen", async () => {
  const context = { workspaceState: storage(), globalState: storage() } as unknown as ConstructorParameters<typeof ConversationStore>[0];
  const store = new ConversationStore(context);
  const conversation = await store.create();
  const snapshot = snapshotUserContext({ userInfo: "Preserve local edits", openFiles: "app.ts", timestamp: "2026-09-07T12:00:00Z" });
  const steps: Step[] = [
    { kind: "user", text: "Inspect", context: snapshot, attachments: [{ id: "notes", kind: "text", mime: "text/plain", name: "notes", data: "Keep this" }] },
    { kind: "assistant", text: "Inspected", calls: [] },
  ];
  const state: ContextState = {};
  saveContext(steps, steps, state);
  const before = buildMessages("OpenCursor", steps);
  await store.update(conversation.id, { steps, contextState: state });
  steps[0] = { kind: "user", text: "Later mutable local value" };
  const reopenedStore = new ConversationStore(context);
  const reopened = reopenedStore.get(conversation.id)!;
  reopened.steps.push({ kind: "user", text: "Continue", context: snapshotUserContext({ ...snapshot, timestamp: "later" }, snapshot) });
  const restored = restoreContext(reopened.steps, reopened.contextState);
  expect(buildMessages("OpenCursor", restored).slice(0, before.length)).toEqual(before);
  expect(reopened.contextState?.checkpoint).toBeDefined();
  await reopenedStore.update(conversation.id, { steps: reopened.steps });
  expect(store.get(conversation.id)?.steps).toEqual(reopened.steps);
});

it("preserves concurrent conversation writes and workspace drafts in persistence order", async () => {
  const context = { workspaceState: storage(), globalState: storage() } as unknown as ConstructorParameters<typeof ConversationStore>[0];
  const first = new ConversationStore(context), second = new ConversationStore(context);
  const [a, b] = await Promise.all([first.create(), second.create()]);
  await Promise.all([
    first.update(a.id, { title: "Task A", turns: [{ role: "user", text: "Resolve the lock starvation regression" }] }),
    second.update(b.id, { title: "Task B" }),
    first.setWorkspaceState({ drafts: { [a.id]: { text: "Unsent continuation", attachments: [] } } }),
    second.setWorkspaceState({ openTabs: [a.id, b.id] }),
  ]);
  // A fresh Memento identity models an extension-host restart, not the shared cache.
  const reloadedContext = { ...context, workspaceState: { get: context.workspaceState.get.bind(context.workspaceState), update: context.workspaceState.update.bind(context.workspaceState) } };
  const reloaded = new ConversationStore(reloadedContext as any);
  expect(reloaded.get(a.id)?.title).toBe("Task A");
  expect(reloaded.get(b.id)?.title).toBe("Task B");
  expect(reloaded.getWorkspaceState()).toEqual({ openTabs: [a.id, b.id], drafts: { [a.id]: { text: "Unsent continuation", attachments: [] } } });
  expect(reloaded.list({ query: "starvation" })[0]).toMatchObject({ id: a.id, excerpt: expect.stringContaining("starvation") });
});

it("forks a stable snapshot without inheriting active goals or queued side effects", async () => {
  const context = { workspaceState: storage(), globalState: storage() } as any;
  const store = new ConversationStore(context);
  const original = await store.create("reviewer");
  await store.update(original.id, { title: "Fix a bug", turns: [{ role: "user", text: "Source request" }],
    steps: [{ kind: "user", text: "Source request" }],
    queue: [{ id: "q1", text: "Deploy", status: "queued", createdAt: 1 }],
    steeringQueue: [{ id: "s1", text: "Update the plan", status: "queued", createdAt: 2 }],
    steering: ["Legacy correction"],
    goal: { objective: "Fix bug", status: "active", tokensUsed: 30, updatedAt: 1 } });
  const fork = await store.fork(original.id);
  expect(fork).toMatchObject({ forkedFrom: original.id, personaId: "reviewer", queue: [], goal: undefined, steeringQueue: [], steering: [] });
  expect(store.get(original.id)?.steeringQueue?.[0].id).toBe("s1");
  expect(store.get(original.id)?.steering).toEqual(["Legacy correction"]);
  expect(fork.steps).toEqual(original.steps.length ? original.steps : [{ kind: "user", text: "Source request" }]);
  await store.update(fork.id, { turns: [] });
  expect(store.get(original.id)?.turns).toHaveLength(1);
  await store.update(original.id, { archivedAt: 123 });
  expect(store.list({ archived: false }).map((c) => c.id)).toEqual([fork.id]);
  expect(store.list({ archived: true, query: "Source request" }).map((c) => c.id)).toEqual([original.id]);
});

it("retains unknown running requests as interrupted instead of replaying them after restart", async () => {
  const store = new ConversationStore({ workspaceState: storage(), globalState: storage() } as any);
  const conversation = await store.create();
  await store.enqueue(conversation.id, { id: "live", text: "Publish release", createdAt: 1, status: "running" });
  await store.enqueue(conversation.id, { id: "next", text: "Check deployment", createdAt: 2, status: "queued" });
  await store.recoverInterruptedRuns();
  expect(store.get(conversation.id)?.queue).toMatchObject([{ id: "live", status: "interrupted" }, { id: "next", status: "queued" }]);
  expect(await store.enqueue(conversation.id, { id: "live", text: "Duplicate delivery", createdAt: 3, status: "queued" })).toBe(false);
});

it("retains completed run timing and bounds interrupted timing to the last saved snapshot", async () => {
  const store = new ConversationStore({ workspaceState: storage(), globalState: storage() } as any);
  const conversation = await store.create();
  const now = vi.spyOn(Date, "now").mockReturnValue(5000);
  try {
    await store.update(conversation.id, { turns: [
      { role: "user", text: "Earlier request" },
      { role: "assistant", blocks: [{ kind: "text", text: "Completed" }], startedAt: 100, endedAt: 1000, durationMs: 900, finalText: "Completed" },
      { role: "user", text: "Interrupted request" },
      { role: "assistant", blocks: [{ kind: "thinking", text: "Inspect", startedAt: 3100 }], startedAt: 3000 },
    ] });
    now.mockReturnValue(24 * 60 * 60 * 1000);
    await store.recoverInterruptedRuns();
    const restored = store.get(conversation.id)!.turns;
    expect(restored[1]).toMatchObject({ startedAt: 100, endedAt: 1000, durationMs: 900, finalText: "Completed" });
    expect(restored[3]).toMatchObject({ startedAt: 3000, endedAt: 5000, durationMs: 2000, blocks: [{ endedAt: 5000 }] });
    await store.recoverInterruptedRuns();
    expect(store.get(conversation.id)!.turns).toEqual(restored);
  } finally {
    now.mockRestore();
  }
});

it("recovers accepted steering exactly once with attachments and existing queue order intact", async () => {
  const context = { workspaceState: storage(), globalState: storage() } as any;
  const store = new ConversationStore(context);
  const conversation = await store.create();
  const correction = {
    id: "correction", text: "Use these notes", status: "queued" as const, createdAt: 3,
    model: "model-a", mode: "ask" as const, error: "Stale error",
    attachments: [{ id: "notes", kind: "text" as const, mime: "text/plain", name: "notes", data: "Keep this" }],
  };
  await store.update(conversation.id, {
    queue: [
      { id: "live", text: "Current request", status: "running", createdAt: 1 },
      { id: "next", text: "Later request", status: "queued", createdAt: 2 },
    ],
    steeringQueue: [correction, { ...correction }, { ...correction, id: "next", text: "Duplicate queued ID" }],
    steering: ["Legacy correction"],
  });
  const write = vi.spyOn(context.workspaceState, "update");
  await store.recoverInterruptedRuns();
  const recovered = store.get(conversation.id)!;
  expect(recovered.queue?.map((item) => [item.id, item.status])).toEqual([
    ["live", "interrupted"], ["next", "queued"], ["correction", "queued"], [expect.any(String), "queued"],
  ]);
  expect(recovered.queue?.[1].text).toBe("Later request");
  expect(recovered.queue?.[2]).toEqual({ ...correction, error: undefined });
  expect(recovered.queue?.[3].text).toBe("Legacy correction");
  expect(recovered).toMatchObject({ steeringQueue: [], steering: [] });
  expect(write).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenCalledWith("ocursor.conversations", [expect.objectContaining({
    queue: recovered.queue, steeringQueue: [], steering: [],
  })]);

  const restartContext = { ...context, workspaceState: { get: context.workspaceState.get.bind(context.workspaceState), update: context.workspaceState.update.bind(context.workspaceState) } };
  const restarted = new ConversationStore(restartContext);
  await restarted.recoverInterruptedRuns();
  expect(restarted.get(conversation.id)?.queue).toEqual(recovered.queue);
  expect(await restarted.enqueue(conversation.id, correction)).toBe(false);
  expect(write).toHaveBeenCalledTimes(1);
});

it("deduplicates requests while steering is pending and after terminal queue events", async () => {
  const store = new ConversationStore({ workspaceState: storage(), globalState: storage() } as any);
  const conversation = await store.create();
  await store.update(conversation.id, {
    steeringQueue: [{ id: "pending", text: "Accepted correction", status: "queued", createdAt: 1 }],
    runEvents: ["queue.finished", "queue.cancelled", "queue.superseded", "queue.steered"].map((type) => ({ runId: type, type, at: 1 })),
  });
  for (const id of ["pending", "queue.finished", "queue.cancelled", "queue.superseded", "queue.steered"]) {
    expect(await store.enqueue(conversation.id, { id, text: "Duplicate delivery", createdAt: 2, status: "queued" })).toBe(false);
  }
  expect(await store.enqueue(conversation.id, { id: "fresh", text: "New request", createdAt: 3, status: "queued" })).toBe(true);
  expect(store.get(conversation.id)?.queue?.map((item) => item.id)).toEqual(["fresh"]);
  expect(store.get(conversation.id)?.steeringQueue?.[0].id).toBe("pending");
});

it("reads summaries and workflow metadata without copying transcript history", async () => {
  const context = { workspaceState: storage(), globalState: storage() } as any;
  const store = new ConversationStore(context);
  const a = await store.create(), b = await store.create();
  await store.update(a.id, { turns: [{ role: "user", text: "Large archived history".repeat(10000) }] });
  const clone = vi.spyOn(globalThis, "structuredClone");
  try {
    expect(store.list()).toHaveLength(2);
    expect(clone).not.toHaveBeenCalled();
    expect(store.listMetadata()).toHaveLength(2);
    expect(store.getMetadata(a.id)).not.toHaveProperty("turns");
    expect(clone.mock.calls.every(([value]) => value != null && typeof value === "object" && !("turns" in value) && !("runEvents" in value))).toBe(true);
    clone.mockClear();
    expect(store.get(b.id)?.id).toBe(b.id);
    expect(clone).toHaveBeenCalledTimes(1);
    expect(clone).toHaveBeenCalledWith(expect.objectContaining({ id: b.id }));
    clone.mockClear();
    await store.update(b.id, { usedTokens: 42 });
    expect(clone).toHaveBeenCalledTimes(1);
    expect(clone).toHaveBeenCalledWith({ usedTokens: 42 });
  } finally { clone.mockRestore(); }
});

it("coalesces slow storage snapshots while awaiting durability and keeping earlier snapshots immutable", async () => {
  const state = storage();
  const store = new ConversationStore({ workspaceState: state, globalState: storage() } as any);
  const conversation = await store.create();
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const originalUpdate = state.update;
  const snapshots: any[] = [];
  const write = vi.spyOn(state, "update").mockImplementation(async (key, value) => {
    snapshots.push(value);
    if (snapshots.length === 1) await blocked;
    await originalUpdate(key, value);
  });
  const first = store.update(conversation.id, { usedTokens: 1 });
  await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  const pending = Array.from({ length: 100 }, (_, i) => store.update(conversation.id, { usedTokens: i + 2 }));
  const ui = store.setWorkspaceState({ drafts: { [conversation.id]: { text: "Latest draft", attachments: [] } } });
  let settled = false;
  const complete = Promise.all([first, ...pending, ui, store.flush()]).then(() => { settled = true; });
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(snapshots[0][0].usedTokens).toBe(1);
  expect(store.getMetadata(conversation.id)?.usedTokens).toBe(101);
  release(); await complete;
  expect(write).toHaveBeenCalledTimes(3);
  expect(state.get<any[]>("ocursor.conversations")?.[0].usedTokens).toBe(101);
  expect(state.get<any>("ocursor.chatWorkspace.v1").drafts[conversation.id].text).toBe("Latest draft");
});

it("keeps caller mutations isolated and can persist again after a failed write", async () => {
  const state = storage();
  const store = new ConversationStore({ workspaceState: state, globalState: storage() } as any);
  const created = await store.create();
  created.title = "Must not mutate cache";
  expect(store.getMetadata(created.id)?.title).toBe("New Chat");
  const turns = [{ role: "user" as const, text: "Saved request" }];
  const pending = store.update(created.id, { turns });
  turns[0].text = "Mutated caller input";
  await pending;
  const copy = store.get(created.id)!;
  copy.turns.length = 0;
  expect(store.get(created.id)?.turns).toEqual([{ role: "user", text: "Saved request" }]);
  vi.spyOn(state, "update").mockRejectedValueOnce(new Error("Disk unavailable"));
  await expect(store.update(created.id, { usedTokens: 1 })).rejects.toThrow("Disk unavailable");
  await store.update(created.id, { usedTokens: 2 });
  expect(state.get<any[]>("ocursor.conversations")?.[0].usedTokens).toBe(2);
});

it("resolves each durable write without waiting for later streaming snapshots", async () => {
  const state = storage();
  const store = new ConversationStore({ workspaceState: state, globalState: storage() } as any);
  const conversation = await store.create();
  const releases: (() => void)[] = [];
  vi.spyOn(state, "update").mockImplementation(() => new Promise<void>(resolve => releases.push(resolve)));
  let firstSaved = false, secondSaved = false;
  const first = store.update(conversation.id, { usedTokens: 1 }).then(() => { firstSaved = true; });
  await vi.waitFor(() => expect(releases).toHaveLength(1));
  const flushed = store.flush();
  const second = store.update(conversation.id, { usedTokens: 2 }).then(() => { secondSaved = true; });
  releases[0]();
  await first;
  await flushed;
  expect(firstSaved).toBe(true);
  expect(secondSaved).toBe(false);
  await vi.waitFor(() => expect(releases).toHaveLength(2));
  releases[1](); await second; await store.flush();
});

it("does not drop other pending keys when one storage write fails", async () => {
  const state = storage();
  const store = new ConversationStore({ workspaceState: state, globalState: storage() } as any);
  const conversation = await store.create();
  vi.spyOn(state, "update").mockRejectedValueOnce(new Error("Conversation write failed"));
  const failed = expect(store.update(conversation.id, { usedTokens: 1 })).rejects.toThrow("Conversation write failed");
  const draft = store.setWorkspaceState({ drafts: { [conversation.id]: { text: "Keep this draft", attachments: [] } } });
  await Promise.all([failed, draft]);
  await expect(store.flush()).rejects.toThrow("Conversation write failed");
  expect(state.get<any>("ocursor.chatWorkspace.v1").drafts[conversation.id].text).toBe("Keep this draft");
  await store.update(conversation.id, { usedTokens: 2 });
  await store.flush();
});
