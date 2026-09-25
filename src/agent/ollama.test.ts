/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFile } from "child_process";
vi.mock("vscode", () => ({ EventEmitter: class { event = () => ({ dispose() {} }); fire() {} } }));
vi.mock("child_process", () => ({ execFile: vi.fn() }));
import { setOllamaHost, getStatus, checkInstalled, refreshStatus, listModels, pullModel, cancelPull, setModelLoaded, inspectModel, deleteModel } from "./ollama";

let sequence = 0;
beforeEach(() => {
  setOllamaHost(`http://127.0.0.1:${18000 + sequence++}`);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/api/version")) return Response.json({ version: "fixture-version" });
    if (url.endsWith("/api/ps")) return Response.json({ models: [] });
    return Response.json({});
  }));
  vi.mocked(execFile).mockImplementation((...args: any[]) => { args.at(-1)(null, "ollama version fixture", ""); return {} as any; });
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("native Ollama management", () => {
  it("separates CLI installed from daemon reachable and validates endpoint identity", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("connection refused"));
    expect(await checkInstalled()).toBe(true);
    expect(getStatus()).toMatchObject({ installed: true, reachable: false });
    vi.mocked(fetch).mockResolvedValue(Response.json({ unrelated: "service" }));
    await refreshStatus();
    expect(getStatus().errors.runtime).toContain("identify itself");
  });
  it("reports loaded models, VRAM and context from daemon evidence", async () => {
    vi.mocked(fetch).mockImplementation(async (input: any) => Response.json(String(input).endsWith("/api/version") ? { version: "fixture" } : { models: [{ name: "coder:8b", size: 8000, size_vram: 7000, context_length: 8192 }] }));
    await refreshStatus();
    expect(getStatus()).toMatchObject({ reachable: true, loaded: { "coder:8b": { sizeBytes: 8000, vramBytes: 7000, contextLength: 8192 } }, states: { "coder:8b": "ready" } });
  });
  it("parses split NDJSON records and requires final success", async () => {
    const encoder = new TextEncoder();
    vi.mocked(fetch).mockResolvedValue(new Response(new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode('{"status":"pulling","digest":"abc","completed":5,"total":10}\n{"sta'));
      controller.enqueue(encoder.encode('tus":"success"}')); controller.close();
    } })));
    const progress: number[] = [];
    const first = pullModel("coder:8b", value => progress.push(value));
    expect(pullModel("coder:8b")).toBe(first);
    await first;
    expect(progress).toEqual([50, 100]);
    expect(getStatus().states?.["coder:8b"]).toBe("available");
    vi.mocked(fetch).mockResolvedValue(new Response('{"status":"pulling"}\n'));
    await expect(pullModel("other:8b")).rejects.toThrow("before Ollama confirmed success");
    expect(getStatus().errors["other:8b"]).toContain("resume");
  });
  it("cancels an active pull without leaving a permanent download state", async () => {
    vi.mocked(fetch).mockImplementation((_url: any, init: any) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true })));
    const pending = pullModel("cancel:8b");
    const failed = expect(pending).rejects.toThrow();
    cancelPull("cancel:8b"); await failed;
    expect(getStatus().pulling["cancel:8b"]).toBeUndefined();
    expect(getStatus().errors["cancel:8b"]).toContain("resume");
  });
  it("loads with requested resource controls and unloads with keep_alive zero", async () => {
    const requests: any[] = [];
    vi.mocked(fetch).mockImplementation(async (input: any, init: any) => {
      if (String(input).endsWith("/api/generate")) { requests.push(JSON.parse(init.body)); return Response.json({ done: true }); }
      return Response.json(String(input).endsWith("/api/version") ? { version: "fixture" } : { models: [] });
    });
    await setModelLoaded("coder:8b", true, 16384, 10);
    await setModelLoaded("coder:8b", false);
    expect(requests).toEqual([
      { model: "coder:8b", prompt: "", stream: false, keep_alive: "10m", options: { num_ctx: 16384 } },
      { model: "coder:8b", prompt: "", stream: false, keep_alive: 0 },
    ]);
  });
  it("exposes model capabilities without assuming every model supports tools", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ capabilities: ["completion", "vision"] }));
    expect(await inspectModel("vision:8b")).toEqual(["completion", "vision"]);
    expect(getStatus().capabilities?.["vision:8b"]).not.toContain("tools");
  });
  it("surfaces list/delete errors and does not accept arbitrary endpoint payloads", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ models: "wrong" }));
    await expect(listModels()).rejects.toThrow("model list");
    vi.mocked(fetch).mockResolvedValue(Response.json({ error: "model not found" }, { status: 404 }));
    await expect(deleteModel("missing:8b")).rejects.toThrow("model not found");
    expect(getStatus().errors["missing:8b"]).toContain("model not found");
  });
});
