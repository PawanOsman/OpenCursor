/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { spawn } from "child_process";
import { createServer } from "net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({ EventEmitter: class { event = () => ({ dispose() {} }); fire() {} } }));
vi.mock("child_process", () => ({ spawn: vi.fn(), execFile: vi.fn() }));
vi.mock("../runtimeDeps", () => ({ importRuntimeDep: vi.fn() }));
import { downloadGguf, importGguf, initLlamacpp, loadModel, ensureLoaded, unloadModel, disposeLlamacpp, isRunning, getStatus, parseExtraArgs, validateServerConfig, type LlamacppModel } from "./llamacpp";

let temporaryRoot: string;
let procs: (EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> })[];
const model: LlamacppModel = { id: "fixture", file: "fixture.gguf", filePath: "/tmp/fixture.gguf", name: "fixture", autoLoad: false, port: 0 };
beforeEach(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ocursor-llama-test-"));
  initLlamacpp({ globalStorageUri: { fsPath: temporaryRoot } } as Parameters<typeof initLlamacpp>[0]);
  model.filePath = path.join(temporaryRoot, "fixture.gguf");
  await fs.writeFile(model.filePath, "GGUF fixture model bytes");
  procs = [];
  vi.mocked(spawn).mockImplementation(() => {
    const proc = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    proc.kill.mockImplementation(() => { proc.emit("exit", null); proc.emit("close", null); return true; });
    procs.push(proc);
    return proc as unknown as ReturnType<typeof spawn>;
  });
  vi.stubGlobal("fetch", vi.fn(async (url: any) => String(url).endsWith("/health") ? Response.json({ status: "ok" }) : new Response("GGUF fixture model bytes")));
});
afterEach(async () => { await disposeLlamacpp(); await fs.rm(temporaryRoot, { recursive: true, force: true }); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("GGUF storage integrity", () => {
  it("keeps matching basenames from different repositories and directories separate", async () => {
    const a = await downloadGguf("vendor/A", "one/model.gguf");
    vi.mocked(fetch).mockResolvedValueOnce(new Response("GGUF different model bytes"));
    const b = await downloadGguf("vendor/B", "one/model.gguf");
    const c = await downloadGguf("vendor/A", "two/model.gguf");
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    expect(new Set([a.filePath, b.filePath, c.filePath]).size).toBe(3);
    expect(await fs.readFile(a.filePath, "utf8")).toBe("GGUF fixture model bytes");
    expect(await fs.readFile(b.filePath, "utf8")).toBe("GGUF different model bytes");
  });

  it("does not replace an existing file when a download is incomplete", async () => {
    const first = await downloadGguf("vendor/A", "model.gguf");
    vi.mocked(fetch).mockResolvedValueOnce(new Response("partial", { headers: { "content-length": "100" } }));
    await expect(downloadGguf("vendor/A", "model.gguf")).rejects.toThrow("incomplete GGUF download");
    expect(await fs.readFile(first.filePath, "utf8")).toBe("GGUF fixture model bytes");
    expect(await fs.readdir(path.dirname(first.filePath))).toEqual(["model.gguf"]);
  });

  it("cleans partial downloads on abort and preserves the installed model", async () => {
    const first = await downloadGguf("vendor/A", "model.gguf");
    const abort = new AbortController();
    await expect(downloadGguf("vendor/A", "model.gguf", () => abort.abort(), abort.signal)).rejects.toThrow();
    expect(await fs.readFile(first.filePath, "utf8")).toBe("GGUF fixture model bytes");
    expect(await fs.readdir(path.dirname(first.filePath))).toEqual(["model.gguf"]);
  });

  it("imports matching basenames without aliasing different local models", async () => {
    const a = path.join(temporaryRoot, "a", "model.gguf");
    const b = path.join(temporaryRoot, "b", "model.gguf");
    for (const file of [a, b]) { await fs.mkdir(path.dirname(file)); await fs.writeFile(file, "GGUF " + file); }
    const first = await importGguf(a);
    const second = await importGguf(b);
    expect(first.id).not.toBe(second.id);
    expect(first.filePath).not.toBe(second.filePath);
    expect(await fs.readFile(first.filePath, "utf8")).toBe("GGUF " + a);
  });
});

describe("local server lifetime", () => {
  it("removes a ready server after it crashes and reloads on the next request", async () => {
    await loadModel(model);
    expect(isRunning(model.id)).toBe(true);
    procs[0].emit("exit", 137);
    expect(isRunning(model.id)).toBe(false);
    expect(getStatus().errors[model.id]).toContain("137");
    await ensureLoaded(model);
    expect(procs).toHaveLength(2);
    expect(isRunning(model.id)).toBe(true);
  });

  it("shares readiness across concurrent callers instead of returning before loading", async () => {
    let ready!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { ready = resolve; }));
    const first = loadModel(model);
    let secondReady = false;
    const second = ensureLoaded(model).then(() => { secondReady = true; });
    await vi.waitFor(() => expect(ready).toBeTypeOf("function"));
    expect(secondReady).toBe(false);
    expect(procs).toHaveLength(1);
    ready(Response.json({ status: "ok" }));
    await Promise.all([first, second]);
    expect(secondReady).toBe(true);
  });

  it("does not label an intentional unload as a crash", async () => {
    await loadModel(model);
    await unloadModel(model.id);
    expect(isRunning(model.id)).toBe(false);
    expect(getStatus().errors[model.id]).toBeUndefined();
  });

  it("cancels a load even before its process is allocated", async () => {
    const pending = loadModel(model);
    const failed = expect(pending).rejects.toThrow("cancelled");
    await unloadModel(model.id);
    await failed;
    expect(isRunning(model.id)).toBe(false);
    expect(getStatus().loading[model.id]).toBeUndefined();
  });

  it("waits for process closure before confirming unload", async () => {
    await loadModel(model);
    procs[0].kill.mockImplementation(() => true);
    let stopped = false;
    const stopping = unloadModel(model.id).then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(getStatus().states?.[model.id]).toBe("stopping");
    procs[0].emit("close", 0);
    await stopping;
    expect(isRunning(model.id)).toBe(false);
  });

  it("honors an explicitly configured port and hides the Windows process window", async () => {
    await loadModel(model, { port: 18567 });
    expect(spawn).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(["--port", "18567"]), expect.objectContaining({ windowsHide: true }));
    expect(getStatus().endpoints?.[model.id]).toBe("http://127.0.0.1:18567/v1");
  });

  it("validates resource limits and preserves quoted extra arguments", () => {
    expect(() => validateServerConfig({ threads: -1 })).toThrow("threads");
    expect(() => validateServerConfig({ batchSize: 32, ubatchSize: 64 })).toThrow("Physical batch");
    expect(parseExtraArgs('--alias "My local model" --metrics')).toEqual(["--alias", "My local model", "--metrics"]);
    expect(() => parseExtraArgs("--port=9999")).toThrow("dedicated controls");
  });

  it("rejects an occupied configured port before spawning or accepting another service's health", async () => {
    const listener = createServer();
    await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
    try {
      const port = (listener.address() as { port: number }).port;
      await expect(loadModel(model, { port })).rejects.toThrow("Choose another port");
      expect(spawn).not.toHaveBeenCalled();
    } finally { await new Promise<void>(resolve => listener.close(() => resolve())); }
  });

  it("rejects an unrelated healthy HTTP endpoint instead of marking the model ready", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ status: "unrelated" }));
    await expect(loadModel(model)).rejects.toThrow("unexpected payload");
    expect(isRunning(model.id)).toBe(false);
  });
});
