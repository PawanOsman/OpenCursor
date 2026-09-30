/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// llama.cpp local model manager.
// - Requires llama.cpp installed on the system (provides `llama-server`).
//   Windows: irm https://llama.app/install.ps1 | iex · Linux/Mac: curl -LsSf https://llama.app/install.sh | sh
// - Search/download GGUF models from the Hugging Face Hub (@huggingface/hub).
// - Import local .gguf files. Load/unload = spawn/kill a `llama-server` per model
//   on its own port, exposing an OpenAI-compatible endpoint at /v1.
// - ponytail: one server process per loaded model (simple). Upgrade to a single
//   server with model-swapping (`-hf` / slots) if RAM pressure matters.

import * as fs from "fs/promises";
import { createHash, randomUUID } from "crypto";
import * as path from "path";
import * as os from "os";
import * as net from "net";
import { spawn, execFile } from "child_process";
import * as vscode from "vscode";
import { importRuntimeDep } from "../runtimeDeps";
import { assertGguf, downloadModelFile } from "./modelDownload";
import { stopLocalProcess, type LocalModelState } from "./localRuntime";

/**
 * llama-server launch configuration. Used both as the global default and as a
 * per-model override. Empty/undefined fields fall back to the global defaults,
 * then to llama-server's own defaults. See `tools/server/README.md`.
 */
export interface LlamacppServerConfig {
  /** Bind host (default 127.0.0.1). */
  host?: string;
  /** Bind port. 0/undefined → auto-assign from BASE_PORT. */
  port?: number;
  /** Prompt context size in tokens (-c). 0 = read from model. */
  ctxSize?: number;
  /** Use the jinja chat-template engine (--jinja). Recommended on. */
  jinja?: boolean;
  /** Flash attention (-fa): "on" | "off" | "auto". */
  flashAttn?: "on" | "off" | "auto";
  /** Layers to offload to VRAM (-ngl): a number, "auto", or "all". */
  nGpuLayers?: string;
  /** Generation threads (-t). */
  threads?: number;
  /** Parallel slots (--parallel). Splits ctx across concurrent requests. */
  parallel?: number;
  /** Logical batch size (-b). */
  batchSize?: number;
  /** Physical batch size (-ub). */
  ubatchSize?: number;
  /** KV cache K type (-ctk), e.g. "q8_0", "f16". */
  cacheTypeK?: string;
  /** KV cache V type (-ctv). */
  cacheTypeV?: string;
  /** Multimodal projector file (--mmproj) for vision models. */
  mmprojPath?: string;
  /** Draft model .gguf for speculative decoding / MTP (-md). */
  draftModelPath?: string;
  /** Tokens to draft per step (--spec-draft-n-max). */
  specDraftNMax?: number;
  /** Draft model GPU layers (-ngld). */
  draftNGpuLayers?: string;
  /** Disable mmap (--no-mmap). Helps on unified-memory machines. */
  noMmap?: boolean;
  /** Lock model in RAM (--mlock). */
  mlock?: boolean;
  /** Raw extra args appended verbatim (space-separated escape hatch). */
  extraArgs?: string;
}

export interface LlamacppModel {
  id: string;            // stable id (repo/file or imported basename)
  name: string;         // display name
  /** Local absolute path to the .gguf file (once downloaded/imported). */
  filePath: string;
  /** HF repo id, if sourced from the Hub. */
  repo?: string;
  /** File name within the repo / on disk. */
  file: string;
  sizeBytes?: number;
  /** Port the server binds to when loaded. */
  port: number;
  /** Auto-load this model when the extension starts. */
  autoLoad: boolean;
  /** Override the global config for just this model. */
  useCustomConfig?: boolean;
  /** Per-model context length (tokens). Used only when useCustomConfig. @deprecated use config.ctxSize */
  contextLength?: number;
  /** Per-model llama-server config (used only when useCustomConfig). */
  config?: LlamacppServerConfig;
}

/** Default context length (tokens) when a model has no custom override. */
export const DEFAULT_CONTEXT_LENGTH = 65536;

/** Sensible global launch defaults applied to every load unless overridden. */
export const DEFAULT_SERVER_CONFIG: LlamacppServerConfig = {
  host: "127.0.0.1",
  ctxSize: DEFAULT_CONTEXT_LENGTH,
  jinja: true,
  flashAttn: "auto",
  nGpuLayers: "auto",
  parallel: 1,
};

export interface HfGgufResult {
  repo: string;
  file: string;
  sizeBytes?: number;
  downloads?: number;
  likes?: number;
  sha256?: string;
}

export interface LlamacppStatus {
  installed: boolean;
  states?: Record<string, LocalModelState>;
  endpoints?: Record<string, string>;
  /** model id -> ready */
  running: Record<string, boolean>;
  /** model id -> loading (spawned, weights not ready yet) */
  loading: Record<string, boolean>;
  /** model id -> last error */
  errors: Record<string, string>;
  /** model id -> recent server log lines (stdout+stderr, tail) */
  logs: Record<string, string[]>;
}

// llama.cpp now ships a single `llama` binary; `llama serve` == `llama-server`.
// We prefer the unified binary and fall back to the standalone one.
const UNIFIED_BIN = "llama";
const LEGACY_BIN = "llama-server";
/** Resolved at install-check time: argv prefix to launch the server. */
let serverCmd: { bin: string; pre: string[] } = { bin: UNIFIED_BIN, pre: ["serve"] };
const MAX_LOG_LINES = 500;

/** Ask the OS for a free ephemeral port (bind :0, read the assigned port). */
function getFreePort(host = "127.0.0.1", requestedPort = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(requestedPort, host, () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

let modelsDir: string | undefined;
let extCtx: vscode.ExtensionContext | undefined;

export function initLlamacpp(ctx: vscode.ExtensionContext): void {
  extCtx = ctx;
  modelsDir = path.join(ctx.globalStorageUri.fsPath, "llamacpp-models");
}

// ---- status events ----
const _onStatus = new vscode.EventEmitter<LlamacppStatus>();
export const onLlamacppStatus = _onStatus.event;

interface Running {
  proc: ReturnType<typeof spawn>;
  port: number;
  host: string;
  ready: boolean;
  stopping: boolean;
  closed: Promise<void>;
}
const running = new Map<string, Running>();
const loadPromises = new Map<string, Promise<void>>();
const loading = new Map<string, boolean>();
const loadControllers = new Map<string, AbortController>();
const unloadPromises = new Map<string, Promise<void>>();
const errors = new Map<string, string>();
const logs = new Map<string, string[]>();
let installedCache: boolean | undefined;

/** Append server output to a model's tail log (capped) and notify listeners. */
function appendLog(id: string, chunk: string): void {
  const cur = logs.get(id) ?? [];
  const lines = chunk.split(/\r?\n/).filter((l) => l.length > 0).map(line => line.slice(0, 2000));
  if (!lines.length) return;
  const next = [...cur, ...lines];
  logs.set(id, next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next);
  emit();
}

async function ensureDir(): Promise<string> {
  if (!modelsDir) throw new Error("llama.cpp not initialized");
  await fs.mkdir(modelsDir, { recursive: true });
  return modelsDir;
}

function snapshot(): LlamacppStatus {
  const r: Record<string, boolean> = {};
  for (const [id, server] of running) if (server.ready && !server.stopping) r[id] = true;
  const l: Record<string, boolean> = {};
  for (const [k, v] of loading) if (v) l[k] = true;
  const e: Record<string, string> = {};
  for (const [k, v] of errors) e[k] = v;
  const g: Record<string, string[]> = {};
  for (const [k, v] of logs) g[k] = v;
  const states: Record<string, LocalModelState> = Object.fromEntries([...errors.keys()].map(id => [id, "error"]));
  for (const [id, server] of running) states[id] = server.stopping ? "stopping" : server.ready ? "ready" : "loading";
  for (const id of loading.keys()) if (!running.has(id)) states[id] = "loading";
  const endpoints = Object.fromEntries([...running].filter(([, server]) => server.ready && !server.stopping).map(([id, server]) => [id, `http://${urlHost(server.host)}:${server.port}/v1`]));
  return { installed: installedCache ?? false, running: r, loading: l, errors: e, logs: g, states, endpoints };
}

function emit() {
  _onStatus.fire(snapshot());
}

// ---- install check / install ----
export function checkInstalled(): Promise<boolean> {
  // Prefer the unified `llama serve`; fall back to legacy `llama-server`.
  return new Promise((resolve) => {
    execFile(UNIFIED_BIN, ["serve", "--help"], { timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err) => {
      if (!err) {
        serverCmd = { bin: UNIFIED_BIN, pre: ["serve"] };
        installedCache = true;
        return resolve(true);
      }
      execFile(LEGACY_BIN, ["--version"], { timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err2) => {
        if (!err2) serverCmd = { bin: LEGACY_BIN, pre: [] };
        installedCache = !err2;
        resolve(!err2);
      });
    });
  });
}

/** Install llama.cpp via the platform package manager (winget / curl script). */
export async function installLlamacpp(): Promise<void> {
  const term = vscode.window.createTerminal("Install llama.cpp");
  term.show();
  if (process.platform === "win32") {
    term.sendText("irm https://llama.app/install.ps1 | iex");
  } else if (process.platform === "darwin") {
    term.sendText("curl -LsSf https://llama.app/install.sh | sh");
  } else {
    term.sendText("curl -LsSf https://llama.app/install.sh | sh");
  }
  vscode.window.showInformationMessage(
    "OpenCursor: Installing llama.cpp in the terminal. Re-check status once it finishes."
  );
}

// ---- HF GGUF search ----
export async function searchGguf(query: string, limit = 20): Promise<HfGgufResult[]> {
  const hub = await importRuntimeDep("@huggingface/hub");
  const signal = AbortSignal.timeout(30_000);
  const out: HfGgufResult[] = [];
  for await (const m of hub.listModels({
    search: { query, tags: ["gguf"] },
    sort: "downloads",
    limit,
    fetch: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => fetch(input, { ...init, signal }),
  })) {
    out.push({ repo: (m as any).name, downloads: (m as any).downloads, likes: (m as any).likes, file: "" });
  }
  return out;
}

/** List the .gguf files inside a repo so the user can pick a quantization. */
export async function listRepoGgufFiles(repo: string): Promise<HfGgufResult[]> {
  const hub = await importRuntimeDep("@huggingface/hub");
  const signal = AbortSignal.timeout(30_000);
  const files: HfGgufResult[] = [];
  for await (const f of hub.listFiles({ repo, recursive: true, fetch: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => fetch(input, { ...init, signal }) })) {
    if (f.type === "file" && /\.gguf$/i.test(f.path)) {
      const hash = (f as any).lfs?.oid?.replace(/^sha256:/, "");
      files.push({ repo, file: f.path, sizeBytes: f.size, ...(/^[a-f\d]{64}$/i.test(hash || "") ? { sha256: hash } : {}) });
      if (files.length >= 5000) throw new Error("This repository contains more than 5,000 GGUF files. Choose a smaller model repository.");
    }
  }
  return files;
}

// ---- download / import ----
function modelId(repo: string | undefined, file: string): string {
  return repo ? `${repo}/${file}` : file;
}

/** Download a GGUF file from the Hub into the models dir. Returns the new model. */
export async function downloadGguf(
  repo: string, file: string, onProgress?: (received: number, total: number) => void, signal?: AbortSignal,
  integrity?: { sha256?: string; sizeBytes?: number },
): Promise<LlamacppModel> {
  if (!/^[^/]+\/[^/]+$/.test(repo) || !/\.gguf$/i.test(file) || file.split(/[\\/]/).some(segment => segment === ".." || segment === ".")) throw new Error("Invalid GGUF repository or filename.");
  const dir = await ensureDir();
  const url = `https://huggingface.co/${repo.split("/").map(encodeURIComponent).join("/")}/resolve/main/${file.split("/").map(encodeURIComponent).join("/")}`;
  const identity = createHash("sha256").update(`${repo}/${file}`).digest("hex");
  const dest = path.join(dir, identity, path.basename(file));
  await downloadModelFile(url, dest, { signal, onProgress, sha256: integrity?.sha256, expectedBytes: integrity?.sizeBytes });
  const stat = await fs.stat(dest);
  return makeModel({ repo, file, filePath: dest, sizeBytes: stat.size, name: path.basename(file, ".gguf") });
}

/** Import an existing local .gguf file (copied into the models dir). */
export async function importGguf(srcPath: string): Promise<LlamacppModel> {
  const dir = await ensureDir();
  await assertGguf(srcPath);
  const base = path.basename(srcPath);
  const identity = createHash("sha256").update(await fs.realpath(srcPath)).digest("hex");
  const dest = path.join(dir, identity, base);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  if (path.resolve(srcPath) !== path.resolve(dest)) {
    const temporary = `${dest}.${randomUUID()}.part`;
    try {
      await fs.copyFile(srcPath, temporary);
      await fs.rename(temporary, dest);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
  const stat = await fs.stat(dest);
  return { ...makeModel({ file: base, filePath: dest, sizeBytes: stat.size, name: path.basename(base, ".gguf") }), id: `import:${identity}/${base}` };
}

function makeModel(p: { repo?: string; file: string; filePath: string; sizeBytes?: number; name: string }): LlamacppModel {
  return {
    id: modelId(p.repo, p.file),
    name: p.name,
    filePath: p.filePath,
    repo: p.repo,
    file: p.file,
    sizeBytes: p.sizeBytes,
    port: 0, // assigned per-load: a fresh random free port every time
    autoLoad: false,
  };
}

/** Remove a model's file from disk. */
export async function deleteGgufFile(m: LlamacppModel): Promise<void> {
  await unloadModel(m.id);
  await fs.rm(m.filePath, { force: true });
}

/**
 * Merge the effective launch config for a model: per-model override (when
 * enabled) layered over the supplied global config, over built-in defaults.
 * Honors the legacy per-model `contextLength` field.
 */
export function effectiveConfig(m: LlamacppModel, globalCfg?: LlamacppServerConfig): LlamacppServerConfig {
  const merged: LlamacppServerConfig = { ...DEFAULT_SERVER_CONFIG, ...(globalCfg ?? {}) };
  if (m.useCustomConfig) {
    if (m.config) Object.assign(merged, prune(m.config));
    if (m.contextLength) merged.ctxSize = m.contextLength; // legacy field wins if set
  }
  return merged;
}

/** Drop undefined/empty values so they don't clobber lower-priority defaults. */
function prune(c: LlamacppServerConfig): LlamacppServerConfig {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c)) {
    if (v === undefined || v === null || v === "") continue;
    out[k] = v;
  }
  return out as LlamacppServerConfig;
}

/** Effective context length for a model (kept for callers that only need ctx). */
export function effectiveContextLength(m: LlamacppModel, globalCtx: number): number {
  const cfg = effectiveConfig(m, { ctxSize: globalCtx });
  return cfg.ctxSize ?? globalCtx;
}

/** Effective bind port: the running server's port, else a per-model config override. */
function effectivePort(m: LlamacppModel, cfg: LlamacppServerConfig): number {
  const r = running.get(m.id);
  if (r) return r.port;
  return (m.useCustomConfig && cfg.port) || 0;
}

/** Base URL of a model's local OpenAI-compatible server (no trailing slash). */
export function serverUrlFor(m: LlamacppModel, globalCfg?: LlamacppServerConfig): string {
  const server = running.get(m.id);
  if (server) return `http://${urlHost(server.host)}:${server.port}/v1`;
  const cfg = effectiveConfig(m, globalCfg);
  const host = cfg.host && cfg.host !== "0.0.0.0" ? cfg.host : "127.0.0.1";
  return `http://${urlHost(host)}:${effectivePort(m, cfg)}/v1`;
}

function urlHost(host: string): string { return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host; }

/** Parse quoted arguments without running a shell or expanding variables. */
export function parseExtraArgs(source: string): string[] {
  const args: string[] = []; let token = "", quote = "", active = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote) { if (c === quote) quote = ""; else token += c; active = true; }
    else if (c === '"' || c === "'") { quote = c; active = true; }
    else if (/\s/.test(c)) { if (active) args.push(token); token = ""; active = false; }
    else { token += c; active = true; }
  }
  if (quote) throw new Error("Extra arguments contain an unclosed quote.");
  if (active) args.push(token);
  if (args.some(arg => /^(?:--(?:host|port|model)|-m)(?:=|$)/.test(arg))) throw new Error("Set model, host and port through their dedicated controls, not extra arguments.");
  return args;
}
export function validateServerConfig(cfg: LlamacppServerConfig): void {
  const ranges: Record<string, [number, number]> = { port: [0, 65535], ctxSize: [0, 1048576], threads: [1, 1024], parallel: [1, 256], batchSize: [1, 1048576], ubatchSize: [1, 1048576], specDraftNMax: [1, 4096] };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const value = cfg[key as keyof LlamacppServerConfig];
    if (value != null && (!Number.isInteger(value) || Number(value) < min || Number(value) > max)) throw new Error(`${key} must be an integer between ${min} and ${max}.`);
  }
  if (cfg.host && !/^[a-z\d.:_-]+$/i.test(cfg.host)) throw new Error("Invalid server bind host.");
  for (const value of [cfg.nGpuLayers, cfg.draftNGpuLayers]) if (value && !/^(?:auto|all|\d+)$/.test(value)) throw new Error("GPU layers must be auto, all, or a nonnegative integer.");
  if (cfg.batchSize && cfg.ubatchSize && cfg.ubatchSize > cfg.batchSize) throw new Error("Physical batch size cannot exceed logical batch size.");
  if (cfg.extraArgs) parseExtraArgs(cfg.extraArgs);
}

/** Build the llama-server argv from a model + effective config. */
function buildArgs(m: LlamacppModel, cfg: LlamacppServerConfig, port: number): string[] {
  const args: string[] = ["-m", m.filePath, "--port", String(port), "--host", cfg.host || "127.0.0.1"];
  if (cfg.ctxSize != null) args.push("--ctx-size", String(cfg.ctxSize));
  args.push(cfg.jinja === false ? "--no-jinja" : "--jinja");
  if (cfg.flashAttn) args.push("-fa", cfg.flashAttn);
  if (cfg.nGpuLayers) args.push("-ngl", cfg.nGpuLayers);
  if (cfg.threads != null) args.push("-t", String(cfg.threads));
  if (cfg.parallel != null) args.push("--parallel", String(cfg.parallel));
  if (cfg.batchSize != null) args.push("-b", String(cfg.batchSize));
  if (cfg.ubatchSize != null) args.push("-ub", String(cfg.ubatchSize));
  if (cfg.cacheTypeK) args.push("-ctk", cfg.cacheTypeK);
  if (cfg.cacheTypeV) args.push("-ctv", cfg.cacheTypeV);
  if (cfg.mmprojPath) args.push("--mmproj", cfg.mmprojPath);
  if (cfg.draftModelPath) {
    args.push("-md", cfg.draftModelPath);
    if (cfg.specDraftNMax != null) args.push("--spec-draft-n-max", String(cfg.specDraftNMax));
    if (cfg.draftNGpuLayers) args.push("-ngld", cfg.draftNGpuLayers);
  }
  if (cfg.noMmap) args.push("--no-mmap");
  if (cfg.mlock) args.push("--mlock");
  if (cfg.extraArgs?.trim()) args.push(...parseExtraArgs(cfg.extraArgs));
  return args;
}

// ---- load / unload ----
export function loadModel(m: LlamacppModel, globalCfg?: LlamacppServerConfig | number): Promise<void> {
  const pending = loadPromises.get(m.id);
  if (pending) return pending;
  const controller = new AbortController();
  loadControllers.set(m.id, controller);
  const promise = (async () => {
    await unloadPromises.get(m.id);
    controller.signal.throwIfAborted();
    await startModel(m, globalCfg, controller.signal);
  })().finally(() => {
    if (loadControllers.get(m.id) === controller) loadControllers.delete(m.id);
    if (loadPromises.get(m.id) === promise) loadPromises.delete(m.id);
  });
  loadPromises.set(m.id, promise);
  return promise;
}

async function startModel(m: LlamacppModel, globalCfg: LlamacppServerConfig | number | undefined, signal: AbortSignal): Promise<void> {
  if (running.get(m.id)?.ready) return;
  if (running.get(m.id)?.stopping) throw new Error("The previous server has not confirmed shutdown. Unload it before loading another instance.");
  errors.delete(m.id); logs.set(m.id, []); loading.set(m.id, true); emit();
  try {
    const cfg = effectiveConfig(m, typeof globalCfg === "number" ? { ctxSize: globalCfg } : globalCfg);
    validateServerConfig(cfg);
    await fs.access(m.filePath);
    signal.throwIfAborted();
    const host = cfg.host === "0.0.0.0" ? "127.0.0.1" : cfg.host === "::" ? "::1" : cfg.host || "127.0.0.1";
    for (let attempt = 1; attempt <= 3; attempt++) {
      signal.throwIfAborted();
      const port = await getFreePort(cfg.host || "127.0.0.1", cfg.port || 0).catch(error => { throw new Error(`Cannot bind ${cfg.host || "127.0.0.1"}:${cfg.port || "auto"}: ${String(error)}. Choose another port or stop the conflicting server.`); });
      signal.throwIfAborted();
      try { await spawnServer(m, cfg, host, port, signal); return; }
      catch (error) {
        const bindFailure = /couldn't bind|address already in use|EADDRINUSE|HTTP server error/i.test(String(error)) || (logs.get(m.id) || []).some(line => /couldn't bind|address already in use/i.test(line));
        if (signal.aborted || !bindFailure || cfg.port || attempt === 3) throw error;
        appendLog(m.id, `[retry] port ${port} unavailable; choosing another port`);
      }
    }
  } catch (error) {
    loading.delete(m.id);
    if (!signal.aborted) errors.set(m.id, error instanceof Error ? error.message : String(error));
    emit(); throw error;
  }
}

async function spawnServer(m: LlamacppModel, cfg: LlamacppServerConfig, host: string, port: number, signal: AbortSignal): Promise<void> {
  const argv = [...serverCmd.pre, ...buildArgs(m, cfg, port)];
  appendLog(m.id, `$ ${serverCmd.bin} ${argv.join(" ")}`);
  const proc = spawn(serverCmd.bin, argv, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const server: Running = { proc, port, host, ready: false, stopping: false, closed: new Promise(resolve => proc.once("close", () => resolve())) };
  running.set(m.id, server);
  proc.stdout?.on("data", b => appendLog(m.id, b.toString()));
  proc.stderr?.on("data", b => appendLog(m.id, b.toString()));
  let failure: Error | undefined;
  const failed = (message: string) => {
    failure = new Error(message);
    if (!server.stopping && !signal.aborted && running.get(m.id) === server) {
      errors.set(m.id, message); loading.delete(m.id); running.delete(m.id); emit();
    }
  };
  proc.once("error", error => failed(error.message));
  proc.once("exit", code => failed(`Server exited (${code}). Inspect its log for memory, model, or port errors.`));
  emit();
  const deadline = Date.now() + 10 * 60_000;
  try {
    while (Date.now() < deadline) {
      signal.throwIfAborted(); if (failure) throw failure;
      try {
        const response = await fetch(`http://${urlHost(host)}:${port}/health`, { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
        signal.throwIfAborted(); if (failure) throw failure;
        if (response.ok) {
          const health: any = await response.json().catch(() => ({}));
          if (health?.status !== "ok") throw new Error("Health check returned an unexpected payload; verify the runtime and port.");
          server.ready = true; loading.delete(m.id); appendLog(m.id, `[ready] model loaded on port ${port}`); emit(); return;
        }
        await response.body?.cancel();
        if (response.status !== 503) throw new Error(`Health check returned HTTP ${response.status}; verify this is a llama.cpp endpoint.`);
      } catch (error) {
        if (signal.aborted || failure || /Health check returned/.test(String(error))) throw error;
      }
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 500);
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      });
    }
    throw new Error("Timed out waiting for model readiness. Reduce context/GPU layers or inspect the server log.");
  } catch (error) {
    server.stopping = true;
    try { await stopLocalProcess(proc); }
    catch (stopError) {
      // Preserve ownership after failed teardown so another load cannot orphan
      // or replace the server and the user can retry Unload.
      if (!running.has(m.id)) running.set(m.id, server);
      const message = `${String(error)} Shutdown remains unconfirmed: ${String(stopError)}`;
      errors.set(m.id, message); loading.delete(m.id); appendLog(m.id, message); emit();
      throw new Error(message);
    }
    if (running.get(m.id) === server) running.delete(m.id);
    loading.delete(m.id); emit(); throw error;
  }
}

export async function ensureLoaded(m: LlamacppModel, globalCfg?: LlamacppServerConfig): Promise<void> { await loadModel(m, globalCfg); }

export function unloadModel(id: string): Promise<void> {
  const existing = unloadPromises.get(id); if (existing) return existing;
  const priorLoad = loadPromises.get(id);
  loadControllers.get(id)?.abort(new Error("Model load cancelled."));
  const promise = (async () => {
    const server = running.get(id);
    if (server) {
      server.stopping = true; server.ready = false; emit();
      await stopLocalProcess(server.proc);
      if (running.get(id) === server) running.delete(id);
    }
    // Cancellation can arrive before the port or process is allocated.
    await priorLoad?.catch(() => {});
    loading.delete(id); appendLog(id, "[stopped] server unloaded"); emit();
  })().catch(error => { errors.set(id, String(error)); emit(); throw error; }).finally(() => { unloadPromises.delete(id); });
  unloadPromises.set(id, promise); return promise;
}
export function getStatus(): LlamacppStatus { return snapshot(); }
export function isRunning(id: string): boolean { const server = running.get(id); return Boolean(server?.ready && !server.stopping); }
export async function disposeLlamacpp(): Promise<void> {
  await Promise.allSettled([...new Set([...running.keys(), ...loadPromises.keys()])].map(unloadModel));
}

/** Pick a local .gguf file via the OS dialog. */
export async function pickLocalGguf(): Promise<string | undefined> {
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { "GGUF model": ["gguf"] },
    openLabel: "Import GGUF",
    defaultUri: vscode.Uri.file(os.homedir()),
  });
  return uris?.[0]?.fsPath;
}
