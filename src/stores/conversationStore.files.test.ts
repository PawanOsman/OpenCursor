/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, expect, it, vi } from "vitest";
vi.mock("vscode", () => ({}));
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ConversationStore } from "./conversationStore";
import type { Turn } from "../shared/turns";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

/** Models VS Code's Memento: every update serializes the extension's whole state. */
function memento() {
  const values: Record<string, string> = {};
  const stats = { bytes: 0, writes: 0 };
  return {
    stats,
    get: <T>(key: string, fallback?: T): T | undefined => key in values ? JSON.parse(values[key]) : fallback,
    update: async (key: string, value: unknown) => {
      if (value === undefined) delete values[key]; else values[key] = JSON.stringify(value);
      stats.writes++;
      stats.bytes += Object.values(values).reduce((sum, item) => sum + item.length, 0);
    },
  };
}
function fixture(workspaceState = memento()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ocursor-store-"));
  roots.push(root);
  const context = { workspaceState, globalState: memento(), storageUri: { fsPath: root } };
  return { context, root, workspaceState, dir: path.join(root, "conversations") };
}
/** A fresh Memento identity models an extension-host restart, not the shared cache. */
function restart(context: ReturnType<typeof fixture>["context"]) {
  const state = context.workspaceState;
  return new ConversationStore({ ...context, workspaceState: { get: state.get.bind(state), update: state.update.bind(state) } } as any);
}
const transcript = (label: string, size = 20_000): Turn[] => [
  { role: "user", text: `${label} request` },
  { role: "assistant", blocks: [{ kind: "tool", callId: "c", name: "Read", input: {}, status: "completed", result: "x".repeat(size) }], startedAt: 1, endedAt: 2 },
];

it("keeps transcripts out of the Memento and restores them lazily after restart", async () => {
  const { context, workspaceState, dir } = fixture();
  const store = new ConversationStore(context as any);
  const a = await store.create();
  await store.update(a.id, { title: "Large chat", turns: transcript("alpha"), steps: [{ kind: "user", text: "alpha request" }], contextState: {} });
  await store.flush();
  const saved = workspaceState.get<any[]>("ocursor.conversations")!;
  expect(JSON.stringify(saved).length).toBeLessThan(2_000);
  expect(saved[0]).toMatchObject({ id: a.id, title: "Large chat", turns: [], steps: [], bodyInFile: true });
  expect(fs.readdirSync(dir)).toHaveLength(1);

  const reopened = restart(context);
  expect(reopened.list()[0]).toMatchObject({ id: a.id, title: "Large chat" });
  expect(reopened.getMetadata(a.id)).not.toHaveProperty("bodyInFile");
  const restored = reopened.get(a.id)!;
  expect(restored.turns).toEqual(transcript("alpha"));
  expect(restored.steps).toEqual([{ kind: "user", text: "alpha request" }]);
  expect(restored.contextState).toEqual({});
  expect(reopened.list({ query: "alpha request" }).map((c) => c.id)).toEqual([a.id]);
});

it("saves a streaming transcript without reserializing other conversations", async () => {
  const { context, workspaceState } = fixture();
  const store = new ConversationStore(context as any);
  const ids: string[] = [];
  for (let i = 0; i < 12; i++) {
    const conversation = await store.create();
    ids.push(conversation.id);
    await store.update(conversation.id, { turns: transcript(`chat ${i}`, 100_000) });
  }
  await store.flush();
  workspaceState.stats.bytes = 0;
  let turns = transcript("live");
  for (let i = 0; i < 20; i++) {
    turns = [...turns, { role: "assistant", blocks: [{ kind: "text", text: `token ${i}` }] }];
    await store.update(ids[0], { turns, usedTokens: i });
  }
  await Promise.all(Array.from({ length: 50 }, (_, i) => store.setWorkspaceState({ drafts: { [ids[0]]: { text: "draft".repeat(i), attachments: [] } } })));
  await store.flush();
  // Before: each save serialized all 12 transcripts (~1.2 MB) through the Memento.
  expect(workspaceState.stats.bytes).toBeLessThan(200_000);
  const reopened = restart(context);
  expect(reopened.get(ids[0])?.turns).toEqual(turns);
  expect(reopened.getWorkspaceState().drafts[ids[0]].text).toBe("draft".repeat(49));
  for (let i = 1; i < 12; i++) expect(reopened.get(ids[i])?.turns).toEqual(transcript(`chat ${i}`, 100_000));
});

it("coalesces draft keystrokes into one storage write", async () => {
  const { context, workspaceState } = fixture();
  const store = new ConversationStore(context as any);
  const conversation = await store.create();
  await store.flush();
  const before = workspaceState.stats.writes;
  await Promise.all(Array.from({ length: 30 }, (_, i) => store.setWorkspaceState({ drafts: { [conversation.id]: { text: `typing ${i}`, attachments: [] } } })));
  expect(workspaceState.stats.writes - before).toBe(1);
  expect(store.getWorkspaceState().drafts[conversation.id].text).toBe("typing 29");
});

it("migrates inline transcripts from older versions into files", async () => {
  const { context, workspaceState, dir } = fixture();
  const legacy = { id: "c_legacy", title: "Old chat", createdAt: 1, updatedAt: 2, turns: transcript("legacy"), steps: [{ kind: "user", text: "legacy request" }] };
  await workspaceState.update("ocursor.conversations", [legacy]);
  const store = new ConversationStore(context as any);
  expect(store.get(legacy.id)?.turns).toEqual(legacy.turns);
  await store.flush();
  await store.flush();
  expect(fs.readdirSync(dir)).toHaveLength(1);
  expect(workspaceState.get<any[]>("ocursor.conversations")![0]).toMatchObject({ id: legacy.id, turns: [], steps: [], bodyInFile: true });
  const reopened = restart(context);
  expect(reopened.get(legacy.id)).toMatchObject({ title: "Old chat", turns: legacy.turns, steps: legacy.steps });
});

it("keeps a transcript inline when its file cannot be written", async () => {
  const { context, workspaceState, root } = fixture();
  // A file where the directory should be makes every transcript write fail.
  fs.writeFileSync(path.join(root, "conversations"), "not a directory");
  const store = new ConversationStore(context as any);
  const conversation = await store.create();
  await expect(store.update(conversation.id, { turns: transcript("kept") })).rejects.toThrow();
  await store.flush().catch(() => {});
  await store.flush().catch(() => {});
  expect(workspaceState.get<any[]>("ocursor.conversations")![0].turns).toEqual(transcript("kept"));
  expect(restart(context).get(conversation.id)?.turns).toEqual(transcript("kept"));
});

it("releases idle transcripts from memory and recovers interrupted runs on restart", async () => {
  const { context } = fixture();
  const store = new ConversationStore(context as any);
  const ids: string[] = [];
  for (let i = 0; i < 14; i++) {
    const conversation = await store.create();
    ids.push(conversation.id);
    await store.update(conversation.id, { turns: transcript(`chat ${i}`) });
  }
  const interrupted: Turn[] = [{ role: "user", text: "Run" }, { role: "assistant", blocks: [{ kind: "thinking", text: "Inspect", startedAt: 5 }], startedAt: 5 }];
  await store.update(ids[0], { turns: interrupted });
  // Touch the others so the interrupted chat is the least recently used.
  for (const id of ids.slice(1)) await store.update(id, { usedTokens: 1, turns: transcript(`chat ${id}`) });
  await store.flush();
  const cache = (store as any).cache;
  expect(cache.unloaded.size).toBeGreaterThan(0);
  expect(cache.unloaded.has(ids[0])).toBe(true);
  for (let i = 1; i < 14; i++) expect(store.get(ids[i])?.turns[0]).toEqual({ role: "user", text: `chat ${ids[i]} request` });

  const reopened = restart(context);
  await reopened.recoverInterruptedRuns();
  expect(reopened.get(ids[0])?.turns[1]).toMatchObject({ endedAt: expect.any(Number), blocks: [{ endedAt: expect.any(Number) }] });
  await reopened.flush();
  expect(restart(context).get(ids[0])?.turns[1]).toMatchObject({ endedAt: expect.any(Number) });
});

it("removes the transcript file with its conversation and preserves a corrupt one", async () => {
  const { context, dir } = fixture();
  const store = new ConversationStore(context as any);
  const keep = await store.create(), doomed = await store.create();
  await store.update(keep.id, { turns: transcript("keep") });
  await store.update(doomed.id, { turns: transcript("doomed") });
  await store.flush();
  expect(fs.readdirSync(dir)).toHaveLength(2);
  await store.delete(doomed.id);
  await store.flush();
  expect(fs.readdirSync(dir)).toHaveLength(1);

  const [file] = fs.readdirSync(dir);
  fs.writeFileSync(path.join(dir, file), "{ torn");
  const reopened = restart(context);
  expect(reopened.get(keep.id)?.turns).toEqual([]);
  expect(fs.readdirSync(dir).some((name) => name.includes(".corrupt-"))).toBe(true);
});
