/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// Native Ollama API: the configured endpoint owns models and pull operations.
import { execFile } from "child_process";
import * as vscode from "vscode";
import { localJson, normalizeLocalEndpoint, type LocalModelState } from "./localRuntime";

let HOST = "http://localhost:11434";
export function setOllamaHost(host: string): void {
  const next = normalizeLocalEndpoint(host);
  if (next === HOST) return;
  if (operations.size) throw new Error("Wait for active load/unload operations before changing endpoints.");
  for (const job of pulls.values()) job.controller.abort();
  pulling.clear(); progress.clear(); capabilities.clear();
  HOST = next; reachable = false; version = undefined; loaded = {}; states.clear(); errors.clear(); emit();
}
export function ollamaOpenAIBase(): string { return `${HOST}/v1`; }
export interface OllamaModel {
  name: string; sizeBytes?: number; parameterSize?: string; quantization?: string; family?: string;
}
export interface OllamaLoadedModel {
  sizeBytes?: number; vramBytes?: number; contextLength?: number; expiresAt?: string;
}
export interface OllamaStatus {
  installed: boolean;
  reachable?: boolean;
  endpoint?: string;
  version?: string;
  pulling: Record<string, number>;
  progress?: Record<string, string>;
  errors: Record<string, string>;
  loaded?: Record<string, OllamaLoadedModel>;
  states?: Record<string, LocalModelState>;
  capabilities?: Record<string, string[]>;
}
const pulling = new Map<string, number>();
const progress = new Map<string, string>();
const errors = new Map<string, string>();
const states = new Map<string, LocalModelState>();
const pulls = new Map<string, { controller: AbortController; promise: Promise<void> }>();
const operations = new Map<string, Promise<void>>();
const capabilities = new Map<string, string[]>();
let installedCache = false, reachable = false;
let version: string | undefined;
let loaded: Record<string, OllamaLoadedModel> = {};
const _onStatus = new vscode.EventEmitter<OllamaStatus>();
export const onOllamaStatus = _onStatus.event;
export function getStatus(): OllamaStatus {
  return { installed: installedCache, reachable, endpoint: HOST, version, pulling: Object.fromEntries(pulling),
    progress: Object.fromEntries(progress), errors: Object.fromEntries(errors), loaded: { ...loaded },
    states: Object.fromEntries(states), capabilities: Object.fromEntries(capabilities) };
}
function emit() { _onStatus.fire(getStatus()); }
function modelName(value: string): string {
  const name = String(value).trim();
  if (!name || name.length > 512 || /[\s\x00-\x1f]/.test(name)) throw new Error("Enter a valid Ollama model name, for example qwen3:8b.");
  return name;
}
const jsonBody = (model: string, extra: Record<string, unknown> = {}): RequestInit => ({
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, ...extra }),
});

/** CLI availability and daemon reachability are different states. */
export async function checkInstalled(): Promise<boolean> {
  installedCache = await new Promise<boolean>(resolve => {
    execFile("ollama", ["--version"], { timeout: 5000, windowsHide: true, maxBuffer: 64 * 1024 }, error => resolve(!error));
  });
  await refreshStatus(); emit(); return installedCache;
}
export async function refreshStatus(): Promise<void> {
  const host = HOST;
  try {
    const info = await localJson<{ version: string }>(`${host}/api/version`);
    if (typeof info.version !== "string") throw new Error("The endpoint did not identify itself as an Ollama daemon.");
    const running = await localJson<{ models: any[] }>(`${host}/api/ps`);
    if (!Array.isArray(running.models)) throw new Error("Invalid Ollama running-model response.");
    if (HOST !== host) return;
    reachable = true; version = info.version; errors.delete("runtime");
    loaded = Object.fromEntries(running.models.filter(m => typeof m.name === "string").map(m => [m.name, {
      sizeBytes: m.size, vramBytes: m.size_vram, contextLength: m.context_length, expiresAt: m.expires_at,
    }]));
    for (const [name, state] of states) if (state === "ready" && !loaded[name]) states.set(name, "available");
    for (const name of Object.keys(loaded)) if (!operations.has(name)) states.set(name, "ready");
  } catch (error) {
    if (HOST !== host) return;
    reachable = false; loaded = {}; errors.set("runtime", error instanceof Error ? error.message : String(error));
  }
  emit();
}
export async function listModels(): Promise<OllamaModel[]> {
  const result = await localJson<{ models: any[] }>(`${HOST}/api/tags`);
  if (!Array.isArray(result.models)) throw new Error("Endpoint did not return an Ollama model list.");
  return result.models.filter(m => typeof m.name === "string").map(m => ({ name: m.name, sizeBytes: m.size,
    parameterSize: m.details?.parameter_size, quantization: m.details?.quantization_level, family: m.details?.family }));
}
export async function inspectModel(name: string): Promise<string[]> {
  name = modelName(name);
  const result = await localJson(`${HOST}/api/show`, jsonBody(name));
  const values = Array.isArray(result.capabilities) ? result.capabilities.filter((v: unknown) => typeof v === "string") : [];
  capabilities.set(name, values); emit(); return values;
}

/** The daemon verifies layers and resumes cancelled pulls; no CLI text scraping. */
export function pullModel(value: string, onProgress?: (pct: number) => void): Promise<void> {
  const name = modelName(value);
  const existing = pulls.get(name); if (existing) return existing.promise;
  const controller = new AbortController();
  const host = HOST;
  errors.delete(name); pulling.set(name, 0); states.set(name, "downloading"); emit();
  const promise = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const reset = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(new Error("Download stalled; pull again to resume.")), 60_000); };
    try {
      reset();
      const response = await fetch(`${host}/api/pull`, { ...jsonBody(name, { stream: true }), signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(`Ollama pull failed (HTTP ${response.status}).`);
      reader = response.body.getReader();
      const decoder = new TextDecoder(); let buffer = "", success = false;
      const layers = new Map<string, { completed: number; total: number }>();
      const consume = (line: string) => {
        if (!line.trim()) return;
        const data = JSON.parse(line);
        if (data.error) throw new Error(String(data.error));
        if (data.status === "success") success = true;
        if (typeof data.digest === "string" && Number(data.total) > 0) layers.set(data.digest, { total: Number(data.total), completed: Math.max(0, Number(data.completed) || 0) });
        const total = [...layers.values()].reduce((n, l) => n + l.total, 0);
        const completed = [...layers.values()].reduce((n, l) => n + Math.min(l.total, l.completed), 0);
        const pct = success ? 100 : total ? Math.min(99, Math.floor(completed / total * 100)) : 0;
        if (HOST === host) { pulling.set(name, pct); progress.set(name, String(data.status || "Downloading")); onProgress?.(pct); emit(); }
      };
      for (;;) {
        controller.signal.throwIfAborted(); reset();
        const chunk = await reader.read();
        buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
        if (buffer.length > 1024 * 1024) throw new Error("Ollama progress record exceeded 1 MiB.");
        let end: number;
        while ((end = buffer.indexOf("\n")) >= 0) { consume(buffer.slice(0, end)); buffer = buffer.slice(end + 1); }
        if (chunk.done) { consume(buffer); break; }
      }
      if (!success) throw new Error("Download ended before Ollama confirmed success; pull again to resume.");
      if (HOST === host) states.set(name, "available");
    } catch (error) {
      if (HOST === host) { errors.set(name, controller.signal.aborted ? "Download cancelled or stalled. Pull again to resume." : error instanceof Error ? error.message : String(error)); states.set(name, "error"); }
      throw error;
    } finally {
      clearTimeout(timer); await reader?.cancel().catch(() => {}); reader?.releaseLock();
      if (pulls.get(name)?.controller === controller) { pulls.delete(name); pulling.delete(name); progress.delete(name); }
      emit();
    }
  })();
  pulls.set(name, { controller, promise }); return promise;
}
export function cancelPull(name: string): void { pulls.get(name)?.controller.abort(new Error("Download cancelled")); }

export function setModelLoaded(value: string, load: boolean, contextLength = 8192, keepAliveMinutes = 5): Promise<void> {
  const name = modelName(value);
  const existing = operations.get(name); if (existing) return existing;
  if (!Number.isInteger(contextLength) || contextLength < 512 || contextLength > 1048576 || !Number.isFinite(keepAliveMinutes) || keepAliveMinutes < 0 || keepAliveMinutes > 1440) return Promise.reject(new Error("Invalid context size or keep-alive duration."));
  errors.delete(name); states.set(name, load ? "loading" : "stopping"); emit();
  const promise = (async () => {
    try {
      const result = await localJson(`${HOST}/api/generate`, jsonBody(name, { prompt: "", stream: false, keep_alive: load ? `${keepAliveMinutes}m` : 0,
        ...(load ? { options: { num_ctx: contextLength } } : {}) }), 10 * 60_000);
      if (result.done !== true) throw new Error("Ollama did not confirm the load/unload operation.");
      states.set(name, load ? "ready" : "available");
    } catch (error) { errors.set(name, error instanceof Error ? error.message : String(error)); states.set(name, "error"); throw error; }
    finally { operations.delete(name); await refreshStatus(); }
  })();
  operations.set(name, promise); return promise;
}
export async function deleteModel(value: string): Promise<void> {
  const name = modelName(value);
  if (pulls.has(name) || operations.has(name)) throw new Error("Wait for the model operation to finish before deleting it.");
  try {
    await localJson(`${HOST}/api/delete`, { ...jsonBody(name), method: "DELETE" });
    states.delete(name); capabilities.delete(name); errors.delete(name); await refreshStatus();
  } catch (error) { errors.set(name, error instanceof Error ? error.message : String(error)); emit(); throw error; }
}

/** Open Ollama's install page. */
export async function installOllama(): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse("https://ollama.com/download"));
}

// ---- library search (scrapes ollama.com — no official registry API) ----
export interface OllamaLibraryModel {
  name: string;
  description?: string;
  pulls?: string;
}

/** Search the Ollama library by scraping ollama.com/search. */
export async function searchLibrary(query: string): Promise<OllamaLibraryModel[]> {
  const r = await fetch(`https://ollama.com/search?q=${encodeURIComponent(query)}`, {
    headers: { "user-agent": "Mozilla/5.0", accept: "text/html" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`ollama search ${r.status}`);
  const html = await r.text();
  const out: OllamaLibraryModel[] = [];
  const seen = new Set<string>();
  // Each result is an <a href="/library/<name>"> block with a description.
  const re = /<a[^>]+href="\/library\/([^"#?]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const name = m[1].trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const inner = m[2];
    const desc = stripTags(firstMatch(inner, /<p[^>]*>([\s\S]*?)<\/p>/));
    const pulls = stripTags(firstMatch(inner, /([\d.]+[KMB]?)\s*Pulls/i));
    out.push({ name, description: desc || undefined, pulls: pulls || undefined });
  }
  return out;
}

/** List the available pull tags for a library model (scrapes its tags page). */
export async function listLibraryTags(name: string): Promise<string[]> {
  const r = await fetch(`https://ollama.com/library/${encodeURIComponent(name)}/tags`, {
    headers: { "user-agent": "Mozilla/5.0", accept: "text/html" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`ollama tags ${r.status}`);
  const html = await r.text();
  const tags = new Set<string>();
  const re = new RegExp(`href="/library/${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}:([^"#?]+)"`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) tags.add(`${name}:${m[1]}`);
  return [...tags];
}

function firstMatch(s: string, re: RegExp): string {
  const m = re.exec(s);
  return m ? m[1] : "";
}
function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}
