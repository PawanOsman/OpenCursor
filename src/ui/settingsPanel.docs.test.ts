/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocSource } from "../agent/docsIndex";
const fixture = vi.hoisted(() => ({
  receive: undefined as ((message: Record<string, unknown>) => Promise<void>) | undefined,
  post: vi.fn(), index: vi.fn(), cancel: vi.fn(), remove: vi.fn(), selector: vi.fn(),
}));
vi.mock("vscode", () => ({
  ViewColumn: { One: 1 }, Uri: { joinPath: () => "icon" },
  window: { createWebviewPanel: () => ({
    webview: { html: "", postMessage: fixture.post, onDidReceiveMessage: (callback: typeof fixture.receive) => { fixture.receive = callback; return { dispose() {} }; } },
    onDidDispose: () => ({ dispose() {} }), dispose() {}, reveal() {},
  }) },
}));
vi.mock("../agent/oauth", () => ({ onOAuthStatus: () => ({ dispose() {} }) }));
vi.mock("../stores/settingsManager", () => ({ DEFAULT_SETTINGS: {} }));
vi.mock("../agent/provider", () => ({}));
vi.mock("./webviewHtml", () => ({ renderWebviewHtml: () => "<html></html>" }));
vi.mock("../stores/featureStore", () => ({ MODEL_CATALOG: [] }));
vi.mock("../context/workspaceContext", () => ({}));
vi.mock("../integrations/mcpClient", () => ({ mcpManager: {} }));
vi.mock("../agent/personas", () => ({ BUILTIN_PERSONAS: [] }));
vi.mock("../agent/semanticIndex", () => ({ onIndexStatus: () => () => {} }));
vi.mock("../agent/docsIndex", () => ({
  onDocsStatus: () => () => {}, getDocsStatus: () => ({ done: 0, total: 0 }),
  indexDocSource: fixture.index, cancelDocIndex: fixture.cancel, deleteDocIndex: fixture.remove,
}));
vi.mock("../agent/docsPlanner", () => ({ createDocsPageSelector: () => fixture.selector }));
vi.mock("../context/workspaceUtils", () => ({}));
vi.mock("../agent/llamacpp", () => ({ onLlamacppStatus: () => ({ dispose() {} }) }));
vi.mock("../agent/ollama", () => ({ onOllamaStatus: () => ({ dispose() {} }) }));
vi.mock("../stores/usageStore", () => ({ onUsageChanged: () => () => {} }));
vi.mock("../integrations/externalHooks", () => ({}));
vi.mock("../stores/modelRegistry", () => ({ onAllModels: () => () => {} }));

import { SettingsPanel } from "./settingsPanel";
let docs: DocSource[];
let resolveIndex: (result: { pages: number; chunks: number; scope?: string; stopReason?: string; selected?: number }) => void;
let rejectIndex: (error: Error) => void;
const stored: DocSource = { id: "reference", name: "Reference", url: "https://example.test/docs", pages: 8, chunks: 20, indexedAt: 500, maxPages: 200 };
beforeEach(() => {
  vi.clearAllMocks(); docs = [{ ...stored }];
  fixture.index.mockImplementation(() => new Promise((resolve, reject) => { resolveIndex = resolve; rejectIndex = reject; }));
  SettingsPanel.createOrShow({ extensionUri: "extension" } as any, {} as any,
    { get: () => ({ providers: [], docSources: docs }), set: async (patch: { docSources: DocSource[] }) => { docs = patch.docSources; } } as any);
});
afterEach(async () => { rejectIndex?.(Object.assign(new Error("Cancelled"), { name: "AbortError" })); await settle(); SettingsPanel.currentPanel?.dispose(); });
const receive = (message: Record<string, unknown>) => fixture.receive!(message);
async function settle() { await new Promise(resolve => setTimeout(resolve, 0)); }

describe("documentation settings host", () => {
  it("validates scope and URLs before storing or indexing a new source", async () => {
    await receive({ type: "addDoc", requestId: "bad-url", name: "Unsafe", url: "file:///private/doc" });
    await receive({ type: "addDoc", requestId: "bad-scope", name: "Broad", url: "https://example.test/docs/api", scopePath: "/" });
    expect(docs).toEqual([stored]); expect(fixture.index).not.toHaveBeenCalled();
    expect(fixture.post).toHaveBeenCalledWith(expect.objectContaining({ type: "docActionResult", requestId: "bad-scope", ok: false }));
  });
  it("starts one bounded job even when two add actions arrive together", async () => {
    await Promise.all([receive({ type: "addDoc", requestId: "one", name: "One", url: "https://example.test/docs", maxPages: 100000 }),
      receive({ type: "addDoc", requestId: "two", name: "Two", url: "https://example.test/docs" })]);
    expect(docs).toHaveLength(2); expect(fixture.index).toHaveBeenCalledTimes(1);
    expect(fixture.index).toHaveBeenCalledWith(expect.objectContaining({ maxPages: 1000, scope: "section", useAi: true }), { selectPages: fixture.selector });
    expect(fixture.post).toHaveBeenCalledWith(expect.objectContaining({ requestId: "two", ok: false }));
  });
  it("re-indexes changed selection options but skips a name-only edit", async () => {
    await receive({ type: "editDoc", id: stored.id, name: "Renamed" });
    expect(fixture.index).not.toHaveBeenCalled();
    await receive({ type: "editDoc", id: stored.id, focus: "Streaming", excludePaths: ["/docs/legacy"] });
    expect(fixture.index).toHaveBeenCalledWith(expect.objectContaining({ focus: "Streaming", excludePaths: ["/docs/legacy"] }), expect.anything());
  });
  it("preserves the previous index metadata on cancellation and rejects busy edits", async () => {
    await receive({ type: "reindexDoc", id: stored.id });
    await receive({ type: "editDoc", id: stored.id, name: "Changed while indexing" });
    await receive({ type: "cancelDocIndex", id: stored.id });
    expect(fixture.cancel).toHaveBeenCalledWith(stored.id);
    rejectIndex(Object.assign(new Error("User cancelled"), { name: "AbortError" })); await settle();
    expect(docs).toEqual([stored]);
  });
  it("persists successful plan metadata and never resurrects a deleted source", async () => {
    await receive({ type: "reindexDoc", id: stored.id });
    resolveIndex({ pages: 5, chunks: 14, scope: "https://example.test/docs", stopReason: "Selected plan complete", selected: 6 }); await settle();
    expect(docs[0]).toMatchObject({ pages: 5, chunks: 14, resolvedScope: "https://example.test/docs", stopReason: "Selected plan complete", selected: 6 });
    await receive({ type: "reindexDoc", id: stored.id }); docs = [];
    resolveIndex({ pages: 2, chunks: 4 }); await settle();
    expect(docs).toEqual([]);
  });
  it("only deletes source ids already present in stored configuration", async () => {
    await receive({ type: "removeDoc", id: "../../foreign-file" });
    expect(fixture.remove).not.toHaveBeenCalled();
    await receive({ type: "removeDoc", id: stored.id });
    expect(fixture.remove).toHaveBeenCalledWith(stored.id); expect(docs).toEqual([]);
  });
});
