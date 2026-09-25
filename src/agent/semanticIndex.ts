/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// Real local semantic codebase index.
// - Embeddings: @huggingface/transformers + onnxruntime-node
//   (Xenova/all-MiniLM-L6-v2, q8). GPU when available (DML/CUDA/CoreML/WebGPU),
//   else CPU with a bounded thread pool so the extension host stays responsive.
// - Chunking: sliding line-window per file (simple, language-agnostic).
//   ponytail: line-window chunking; upgrade to tree-sitter AST chunks when
//   ranking quality on large funcs matters.
// - Store: chunk metadata in JSON + vectors in a packed Float32Array sidecar
//   (`.vec`). Chunk text is NOT kept in memory; snippets are read from disk for
//   the top-k hits only.
//   ponytail: O(n) cosine scan; swap for sqlite-vec/HNSW when repo > ~50k chunks.
// - Incremental: per-file mtime hash skips unchanged files on re-index.

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { scanFiles, isPathExcluded } from "./tools/fileScan";
import { importRuntimeDep } from "../runtimeDeps";
import type { ApiKeyPool } from "./provider/apiKeyPool";

// Selectable local embedding models. Add entries here to offer more choices.
export interface EmbedModel {
  id: string;
  name: string;
  repo: string;
  dtype: "fp32" | "fp16" | "q8";
  pooling: "mean" | "last_token";
  dim: number;
}
export const EMBED_MODELS: EmbedModel[] = [
  { id: "minilm", name: "all-MiniLM-L6-v2 (fast, default)", repo: "Xenova/all-MiniLM-L6-v2", dtype: "q8", pooling: "mean", dim: 384 },
];

let activeModel: EmbedModel = EMBED_MODELS[0];

/** Remote (provider API) embedding model, e.g. OpenAI text-embedding-3-small. */
export interface RemoteEmbedConfig {
  id: string;
  baseUrl: string;
  apiKey: string;
  apiKeyPool?: ApiKeyPool;
}
let remoteCfg: RemoteEmbedConfig | null = null;

export function getEmbedModelId(): string {
  return remoteCfg ? remoteCfg.id : activeModel.id;
}

/** Version vector spaces by all settings that affect their meaning, without persisting credentials. */
export function getEmbedFingerprint(): string {
  const config = remoteCfg
    ? { backend: "remote", model: remoteCfg.id, endpoint: remoteCfg.baseUrl.replace(/\/+$/, "") }
    : { backend: "local", ...activeModel };
  return crypto.createHash("sha256").update(JSON.stringify(config)).digest("hex").slice(0, 24);
}

/** Switch to a LOCAL embedding model. Invalidates the loaded extractor (re-index needed). */
export function setEmbedModel(id: string): void {
  const m = EMBED_MODELS.find((x) => x.id === id);
  if (!m) return;
  const changed = remoteCfg !== null || m.id !== activeModel.id;
  remoteCfg = null;
  if (m.id !== activeModel.id) {
    void releaseEmbedder();
    activeModel = m;
  }
  if (changed) {
    memIndex = null; // index built with old model is stale
    memRoot = null;
  }
}

/** Switch to a REMOTE (provider) embedding model via the OpenAI-compatible /embeddings API. */
export function setRemoteEmbedModel(cfg: RemoteEmbedConfig): void {
  if (remoteCfg?.id === cfg.id && remoteCfg.baseUrl === cfg.baseUrl) {
    remoteCfg = cfg; // refresh key silently
    return;
  }
  remoteCfg = cfg;
  void releaseEmbedder();
  memIndex = null;
  memRoot = null;
}

const CHUNK_LINES = 40;
const CHUNK_OVERLAP = 10;
/** Hard cap per chunk so one minified-ish line can't blow up a forward pass. */
const MAX_CHUNK_CHARS = 4000;
/** Texts per embedder forward pass, and the char budget that also closes a batch. */
const EMBED_BATCH_TEXTS = 24;
const EMBED_BATCH_CHARS = 24_000;
/** Status pushes to the UI are coalesced to this interval during builds. */
const STATUS_THROTTLE_MS = 300;
/** Index is persisted at most this often mid-build (plus once at the end). */
const SAVE_THROTTLE_MS = 8_000;
/** Yield to the event loop at least this often so the extension host stays live. */
const YIELD_EVERY_MS = 40;
/** Snippet length hydrated per search hit. */
const SNIPPET_MAX_CHARS = 2000;
/** Bound the resident matrix independently of workspace size or remote dimensions. */
const MAX_VECTOR_BYTES = 64 * 1024 * 1024;
const MAX_INDEX_CHUNKS = 50_000;
const MAX_METADATA_BYTES = 16 * 1024 * 1024;
const EMBED_IDLE_MS = 60_000;
/** Source / doc extensions worth embedding. No binaries, lockfiles, or assets. */
const EMBED_EXTS = new Set([
  ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".pyi", ".rs", ".go", ".java", ".kt", ".kts", ".scala",
  ".c", ".h", ".cpp", ".cc", ".cxx", ".hpp", ".hh", ".cs",
  ".rb", ".php", ".swift", ".m", ".mm",
  ".vue", ".svelte", ".astro",
  ".css", ".scss", ".less", ".sass",
  ".html", ".htm", ".sql", ".graphql", ".gql",
  ".md", ".mdx", ".rst", ".txt",
  ".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd",
  ".toml", ".yaml", ".yml", ".ini", ".cfg", ".conf",
  ".json", ".jsonc",
  ".proto", ".thrift", ".r", ".lua", ".ex", ".exs", ".erl", ".hs", ".clj", ".cljs",
  ".zig", ".nim", ".dart", ".tf", ".hcl",
]);
/** Path segment names to never index (modules, build, caches, VCS). */
const SKIP_DIR_SEGMENTS = new Set([
  "node_modules", ".git", "dist", "out", "build", ".next", ".nuxt", ".output",
  ".turbo", ".cache", "coverage", ".venv", "venv", "__pycache__", ".tox",
  ".mypy_cache", ".pytest_cache", ".ruff_cache", "target", "vendor", "Pods",
  ".gradle", ".idea", ".vscode", "bower_components", "jspm_packages",
  ".pnpm-store", ".yarn", "site-packages", ".svn", ".hg", ".hgcheck",
  "DerivedData", "xcuserdata", ".terraform", ".serverless", ".parcel-cache",
  ".svelte-kit", ".angular", "storybook-static", "cypress", "playwright-report",
  "test-results", ".nyc_output", "htmlcov",
]);
/** Exact basenames that are never source to embed. */
const SKIP_BASENAMES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock",
  "composer.lock", "Cargo.lock", "Gemfile.lock", "poetry.lock", "Pipfile.lock",
  "go.sum", "flake.lock", "uv.lock",
  ".DS_Store", "Thumbs.db", "desktop.ini",
  "LICENSE", "LICENSE.txt", "LICENSE.md", "COPYING", "CHANGELOG.md", "CHANGELOG",
]);
const MAX_FILE_BYTES = 512 * 1024;

/** Chunk location in the workspace. Text lives on disk, not here. */
export interface Chunk {
  path: string; // workspace-relative, posix
  start: number; // 1-based, inclusive
  end: number; // 1-based, inclusive
}

/**
 * In-memory index. Vectors are one packed Float32Array (`vecs`) whose row i
 * belongs to `metas[i]`, which keeps ~8x less memory than an array of number[]
 * and makes the cosine scan a contiguous walk.
 */
interface IndexData {
  fingerprint: string;
  model: string;
  dim: number;
  files: Record<string, string>; // relPath -> mtime:size:content SHA-256
  metas: Chunk[];
  vecs: Float32Array; // capacity may exceed count * dim
  count: number; // rows in use
}

interface MetaFile {
  v: 3;
  checksum: string;
  fingerprint: string;
  model: string;
  dim: number;
  files: Record<string, string>;
  metas: [string, number, number][]; // [path, start, end] — compact on disk
}

let storageDir: string | undefined;
export function setIndexStorageDir(dir: string): void {
  storageDir = dir;
}

// ---- Embedder (lazy, singleton) ----
// ONNX Runtime Node EPs: Win→dml, Linux x64→cuda, macOS→coreml, then webgpu, then cpu.
// transformers.js defaults to CPU only; we try GPU when available and fall back.
function preferredEmbedDevices(): string[] {
  const order: string[] = [];
  switch (process.platform) {
    case "win32":
      order.push("dml"); // DirectML (any DX12 GPU)
      break;
    case "linux":
      if (process.arch === "x64") order.push("cuda"); // needs CUDA 12 + cuDNN
      break;
    case "darwin":
      order.push("coreml");
      break;
  }
  order.push("webgpu", "cpu");
  return order;
}

/**
 * ORT defaults to one intra-op thread per core, which saturates the machine and
 * starves the extension host. Leave at least half the cores to the editor.
 */
function cpuThreadBudget(): number {
  const cores = Math.max(1, os.cpus()?.length || 1);
  return Math.max(1, Math.min(4, Math.floor(cores / 2)));
}

let extractorP: Promise<any> | null = null;
let embedDevice: string | null = null;
let localOperation: Promise<unknown> = Promise.resolve();
let embedIdleTimer: ReturnType<typeof setTimeout> | null = null;

/** Native sessions are shared by background indexing, documentation and chat search. */
function withLocalOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = localOperation.then(operation);
  localOperation = result.catch(() => {});
  return result;
}

function clearEmbedIdleTimer(): void {
  if (embedIdleTimer) clearTimeout(embedIdleTimer);
  embedIdleTimer = null;
}

function scheduleEmbedRelease(): void {
  clearEmbedIdleTimer();
  embedIdleTimer = setTimeout(() => { void releaseEmbedder(); }, EMBED_IDLE_MS);
  embedIdleTimer.unref?.();
}

/** Device the live embedder is using (null until first load). */
export function getEmbedDevice(): string | null {
  return embedDevice;
}

async function getExtractor(): Promise<any | null> {
  if (!storageDir) return null;
  if (!extractorP) {
    const m = activeModel;
    extractorP = (async () => {
      const t = await importRuntimeDep("@huggingface/transformers");
      t.env.allowRemoteModels = true;
      t.env.cacheDir = path.join(storageDir!, "models");
      // Try GPU EPs first; ORT often fails hard if a provider's libs are missing,
      // so probe one device at a time instead of device:"auto".
      const devices = preferredEmbedDevices();
      const threads = cpuThreadBudget();
      let lastErr: unknown;
      for (const device of devices) {
        try {
          const pipe = await t.pipeline("feature-extraction", m.repo, {
            dtype: m.dtype,
            device,
            session_options:
              device === "cpu"
                ? { intraOpNumThreads: threads, interOpNumThreads: 1, executionMode: "sequential" }
                : undefined,
          });
          embedDevice = device;
          console.log(`[semanticIndex] embedder on ${device} (${m.id})`);
          // UI may already be open; push device once the pipeline is ready.
          if (memRoot) emitStatus(memRoot);
          return pipe;
        } catch (e) {
          lastErr = e;
          console.warn(`[semanticIndex] embedder device "${device}" unavailable, trying next…`);
        }
      }
      throw lastErr ?? new Error("no embedder device available");
    })().catch((e) => {
      console.error("[semanticIndex] embedder load failed:", e);
      extractorP = null;
      embedDevice = null;
      return null;
    });
  }
  return extractorP;
}

/** Free an idle/replaced ONNX session after its in-flight inference finishes. */
export async function releaseEmbedder(): Promise<void> {
  clearEmbedIdleTimer();
  await withLocalOperation(async () => {
    clearEmbedIdleTimer();
    const p = extractorP;
    extractorP = null;
    embedDevice = null;
    if (!p) return;
    try {
      const ex = await p;
      await ex?.dispose?.();
    } catch {}
    if (memRoot) emitStatus(memRoot);
  });
}

/** Embed via a provider's OpenAI-compatible /embeddings endpoint. */
async function embedRemote(texts: string[], parentSignal?: AbortSignal): Promise<number[][] | null> {
  const cfg = remoteCfg;
  if (!cfg) return null;
  const deadline = AbortSignal.timeout(30_000);
  const signal = parentSignal ? AbortSignal.any([parentSignal, deadline]) : deadline;
  try {
    const request = async (apiKey: string): Promise<number[][]> => {
      const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/embeddings`, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: cfg.id, input: texts }),
      });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        const retryAfter = res.headers.get("retry-after");
        const retryAfterMs = retryAfter ? (/^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now()) : undefined;
        throw Object.assign(new Error(`Embedding request failed (HTTP ${res.status}).`), { status: res.status, retryAfterMs });
      }
      const json: any = await res.json();
      const vecs: number[][] = json.data.sort((a: any, b: any) => a.index - b.index).map((d: any) => d.embedding);
      // Normalize (cosine expects unit vectors; some APIs don't normalize).
      return vecs.map((v) => {
        let n = 0;
        for (const x of v) n += x * x;
        n = Math.sqrt(n) || 1;
        return v.map((x) => x / n);
      });
    };
    return cfg.apiKeyPool
      ? await cfg.apiKeyPool.request(credential => request(credential.apiKey), { apiBaseUrl: cfg.baseUrl, signal })
      : await request(cfg.apiKey);
  } catch (e) {
    parentSignal?.throwIfAborted();
    console.error("[semanticIndex] remote embed failed:", e);
    return null;
  }
}

async function embed(texts: string[], signal?: AbortSignal): Promise<number[][] | null> {
  signal?.throwIfAborted();
  if (remoteCfg) return embedRemote(texts, signal);
  const fingerprint = getEmbedFingerprint();
  return withLocalOperation(async () => {
    signal?.throwIfAborted();
    if (fingerprint !== getEmbedFingerprint()) return null;
    clearEmbedIdleTimer();
    let out: any;
    try {
      const ex = await getExtractor();
      signal?.throwIfAborted();
      if (!ex || fingerprint !== getEmbedFingerprint()) return null;
      out = await ex(texts, { pooling: activeModel.pooling, normalize: true });
      signal?.throwIfAborted();
      return (out.tolist ? out.tolist() : out) as number[][];
    } finally {
      try { out?.dispose?.(); } catch {}
      if (extractorP) scheduleEmbedRelease();
    }
  });
}

export async function embedQuery(q: string): Promise<number[] | null> {
  const r = await embed([q]);
  return r ? r[0] : null;
}

/** Batch-embed arbitrary texts with the active local model (docs index reuses this). */
export async function embedTexts(texts: string[], signal?: AbortSignal): Promise<number[][] | null> {
  return embed(texts, signal);
}

// ---- Index lifecycle ----
/** Stable workspace key so Windows drive-letter case / trailing slashes don't orphan the index. */
function normRoot(root: string): string {
  const r = path.resolve(root);
  return process.platform === "win32" ? r.toLowerCase() : r;
}

function indexBase(root: string): string {
  const id = crypto.createHash("sha1").update(normRoot(root)).digest("hex").slice(0, 16);
  const mid = getEmbedFingerprint();
  return path.join(storageDir!, `index-${id}-${mid}`);
}
function metaPath(root: string): string {
  return `${indexBase(root)}.json`;
}
function vecPath(root: string): string {
  return `${indexBase(root)}.vec`;
}

let memIndex: IndexData | null = null;
let memRoot: string | null = null; // normRoot key
let indexingEnabled = true;

export function setIndexingEnabled(on: boolean): void {
  indexingEnabled = on;
  if (!on) {
    // Drop the ONNX session and the vector matrix; both are large and idle now.
    void releaseEmbedder();
    memIndex = null;
    memRoot = null;
    pendingUpserts.clear();
    pendingDeletes.clear();
  }
}

export function isIndexingEnabled(): boolean {
  return indexingEnabled;
}

function activeDim(): number {
  return remoteCfg ? 0 : activeModel.dim; // remote dim is discovered on first embed
}

function emptyIndex(): IndexData {
  return { fingerprint: getEmbedFingerprint(), model: getEmbedModelId(), dim: activeDim(), files: {}, metas: [], vecs: new Float32Array(0), count: 0 };
}

/** Grow the packed matrix geometrically so pushes stay amortized O(1). */
function reserve(idx: IndexData, rows: number): void {
  if (!idx.dim) return;
  const need = rows * idx.dim;
  if (idx.vecs.length >= need) return;
  const maxValues = Math.floor(MAX_VECTOR_BYTES / 4);
  if (rows > MAX_INDEX_CHUNKS || need > maxValues) throw new Error("Semantic index memory limit reached.");
  const next = new Float32Array(Math.min(maxValues, Math.max(need, Math.max(idx.vecs.length * 2, 256 * idx.dim))));
  next.set(idx.vecs.subarray(0, idx.count * idx.dim));
  idx.vecs = next;
}

function pushChunk(idx: IndexData, meta: Chunk, vec: number[]): void {
  if (!idx.dim) idx.dim = vec.length;
  if (vec.length !== idx.dim) return;
  reserve(idx, idx.count + 1);
  idx.vecs.set(vec, idx.count * idx.dim);
  idx.metas.push(meta);
  idx.count++;
}

/**
 * Drop every row whose path fails `keep`, compacting the matrix in place.
 * One pass, no reallocation — used for single-file updates and full sweeps.
 */
function retainChunks(idx: IndexData, keep: (rel: string) => boolean): void {
  if (!idx.count) return;
  const dim = idx.dim;
  let w = 0;
  const metas: Chunk[] = [];
  for (let r = 0; r < idx.count; r++) {
    const m = idx.metas[r];
    if (!keep(m.path)) continue;
    if (w !== r) idx.vecs.copyWithin(w * dim, r * dim, (r + 1) * dim);
    metas.push(m);
    w++;
  }
  idx.metas = metas;
  idx.count = w;
}

function dropPath(idx: IndexData, rel: string): void {
  if (!idx.files[rel]) return;
  retainChunks(idx, (p) => p !== rel);
}

async function readLegacyIndex(root: string): Promise<IndexData | null> {
  // v1 stored everything (including per-chunk text and number[] vectors) in the
  // JSON file. Convert once, then persist in the v2 packed format.
  try {
    if ((await fs.stat(metaPath(root))).size > MAX_METADATA_BYTES) return null;
    const raw = await fs.readFile(metaPath(root), "utf8");
    const parsed: any = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.chunks)) return null;
    if (parsed.fingerprint !== getEmbedFingerprint()) return null;
    const idx = emptyIndex();
    idx.files = parsed.files && typeof parsed.files === "object" ? parsed.files : {};
    reserve(idx, parsed.chunks.length);
    for (const c of parsed.chunks) {
      if (!c?.path || !Array.isArray(c.vec)) continue;
      pushChunk(idx, { path: c.path, start: c.start, end: c.end }, c.vec);
    }
    return idx;
  } catch {
    return null;
  }
}

async function load(root: string): Promise<IndexData> {
  const key = normRoot(root);
  if (memIndex && memRoot === key && memIndex.fingerprint === getEmbedFingerprint()) return memIndex;
  memRoot = key;
  try {
    if ((await fs.stat(metaPath(root))).size > MAX_METADATA_BYTES) throw new Error("Index metadata exceeds its memory budget.");
    const raw = await fs.readFile(metaPath(root), "utf8");
    const meta = JSON.parse(raw) as MetaFile;
    if (meta?.v === 3 && meta.fingerprint === getEmbedFingerprint() && Array.isArray(meta.metas)) {
      if (meta.metas.length > MAX_INDEX_CHUNKS || (await fs.stat(vecPath(root))).size > MAX_VECTOR_BYTES) throw new Error("Index exceeds its memory budget.");
      const buf = await fs.readFile(vecPath(root));
      if (crypto.createHash("sha256").update(buf).digest("hex") !== meta.checksum) throw new Error("Incomplete index snapshot");
      const dim = meta.dim || activeDim();
      if (!Number.isSafeInteger(dim) || dim < 1 || dim > 8192) throw new Error("Invalid index dimensions.");
      const rows = dim ? Math.min(meta.metas.length, Math.floor(buf.byteLength / (dim * 4))) : 0;
      const vecs = new Float32Array(rows * dim);
      // Copy out of the Buffer: its byteOffset may be unaligned for Float32.
      Buffer.from(vecs.buffer).set(buf.subarray(0, rows * dim * 4));
      memIndex = {
        fingerprint: meta.fingerprint,
        model: meta.model,
        dim,
        files: meta.files || {},
        metas: meta.metas.slice(0, rows).map(([p, s, e]) => ({ path: p, start: s, end: e })),
        vecs,
        count: rows,
      };
      return memIndex;
    }
  } catch {}
  const migrated = await readLegacyIndex(root);
  memIndex = migrated ?? emptyIndex();
  if (migrated) await save(root, migrated);
  return memIndex;
}

async function save(root: string, idx: IndexData): Promise<void> {
  if (!storageDir || idx.fingerprint !== getEmbedFingerprint()) return;
  await fs.mkdir(storageDir, { recursive: true });
  if (idx.fingerprint !== getEmbedFingerprint()) return;
  const vectorDestination = vecPath(root), metadataDestination = metaPath(root);
  const rows = idx.count * idx.dim;
  const bytes = Buffer.from(idx.vecs.buffer, 0, rows * 4);
  const meta: MetaFile = {
    v: 3,
    checksum: crypto.createHash("sha256").update(bytes).digest("hex"),
    fingerprint: idx.fingerprint,
    model: idx.model,
    dim: idx.dim,
    files: idx.files,
    metas: idx.metas.map((m) => [m.path, m.start, m.end]),
  };
  const suffix = `.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await fs.writeFile(vectorDestination + suffix, bytes);
    await fs.writeFile(metadataDestination + suffix, JSON.stringify(meta), "utf8");
    await fs.rename(vectorDestination + suffix, vectorDestination);
    await fs.rename(metadataDestination + suffix, metadataDestination);
  } finally {
    await Promise.all([fs.rm(vectorDestination + suffix, { force: true }), fs.rm(metadataDestination + suffix, { force: true })]);
  }
  if (indexingEnabled && idx.fingerprint === getEmbedFingerprint()) { memIndex = idx; memRoot = normRoot(root); }
}

/** Load persisted index into memory (no embed work). Call on activate so status/UI show prior work. */
export async function warmIndex(root: string): Promise<IndexStatus> {
  if (!storageDir || !root || !indexingEnabled) return getStatus(root);
  await load(root);
  emitStatus(root);
  return getStatus(root);
}

function chunkFile(text: string): { start: number; end: number; text: string }[] {
  const lines = text.split("\n");
  const out: { start: number; end: number; text: string }[] = [];
  for (let i = 0; i < lines.length; i += CHUNK_LINES - CHUNK_OVERLAP) {
    const slice = lines.slice(i, i + CHUNK_LINES);
    const body = slice.join("\n").trim();
    if (body) {
      out.push({
        start: i + 1,
        end: Math.min(i + CHUNK_LINES, lines.length),
        text: body.length > MAX_CHUNK_CHARS ? body.slice(0, MAX_CHUNK_CHARS) : body,
      });
    }
    if (i + CHUNK_LINES >= lines.length) break;
  }
  return out;
}

let indexing = false;
export function isIndexing(): boolean {
  return indexing;
}

// Progress reported to UI subscribers (e.g. settings panel).
export interface IndexStatus {
  indexing: boolean;
  done: number;
  total: number;
  files: number; // indexed files in store
  chunks: number;
  model: string; // active EmbedModel.id or remote model id
  /** "local" = onnxruntime-node; "remote" = provider /embeddings API. */
  backend: "local" | "remote";
  /** ONNX EP in use: dml | cuda | coreml | webgpu | cpu. Null until first load / remote. */
  device: string | null;
  /** GPU-class EP vs CPU (remote counts as neither — uses provider). */
  accelerator: "gpu" | "cpu" | "remote" | "pending";
  /** Human-readable device label for the UI. */
  deviceLabel: string;
  /** Active local model technical fields (undefined when remote). */
  modelRepo?: string;
  modelDtype?: string;
  modelPooling?: string;
  modelDim?: number;
  /** Remote endpoint host when using a provider embedding model. */
  remoteBaseUrl?: string;
  runtime: string;
  platform: string;
  vectorBytes: number;
  limitReason?: string;
}
let progress = { done: 0, total: 0 };
let indexLimitReason: string | undefined;
const statusSubs = new Set<(s: IndexStatus) => void>();
export function onIndexStatus(fn: (s: IndexStatus) => void): () => void {
  statusSubs.add(fn);
  return () => statusSubs.delete(fn);
}

function deviceLabelOf(device: string | null, backend: "local" | "remote"): string {
  if (backend === "remote") return "Remote API";
  if (!device) return "Not loaded yet";
  switch (device) {
    case "dml":
      return "GPU · DirectML";
    case "cuda":
      return "GPU · CUDA";
    case "coreml":
      return "GPU · CoreML";
    case "webgpu":
      return "GPU · WebGPU";
    case "cpu":
      return "CPU";
    default:
      return device;
  }
}

function acceleratorOf(device: string | null, backend: "local" | "remote"): IndexStatus["accelerator"] {
  if (backend === "remote") return "remote";
  if (!device) return "pending";
  return device === "cpu" ? "cpu" : "gpu";
}

export function getStatus(root: string): IndexStatus {
  const idx = memRoot === normRoot(root) ? memIndex : null;
  const backend: "local" | "remote" = remoteCfg ? "remote" : "local";
  const device = backend === "remote" ? null : embedDevice;
  return {
    indexing,
    done: progress.done,
    total: progress.total,
    files: idx ? Object.keys(idx.files).length : 0,
    chunks: idx ? idx.count : 0,
    model: getEmbedModelId(),
    backend,
    device,
    accelerator: acceleratorOf(device, backend),
    deviceLabel: deviceLabelOf(device, backend),
    modelRepo: backend === "local" ? activeModel.repo : undefined,
    modelDtype: backend === "local" ? activeModel.dtype : undefined,
    modelPooling: backend === "local" ? activeModel.pooling : undefined,
    modelDim: backend === "local" ? activeModel.dim : undefined,
    remoteBaseUrl: remoteCfg?.baseUrl,
    runtime: backend === "local" ? "onnxruntime-node + @huggingface/transformers" : "OpenAI-compatible /embeddings",
    platform: `${process.platform}-${process.arch}`,
    vectorBytes: idx?.vecs.byteLength ?? 0,
    limitReason: indexLimitReason,
  };
}

function emitStatus(root: string): void {
  if (statusTimer) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }
  lastStatusAt = Date.now();
  if (!statusSubs.size) return;
  const s = getStatus(root);
  for (const fn of statusSubs) fn(s);
}

// Per-file progress used to fire a postMessage per file; coalesce it instead.
let statusTimer: ReturnType<typeof setTimeout> | null = null;
let lastStatusAt = 0;
function emitStatusThrottled(root: string): void {
  if (!statusSubs.size) return;
  if (statusTimer) return;
  const wait = Math.max(0, STATUS_THROTTLE_MS - (Date.now() - lastStatusAt));
  statusTimer = setTimeout(() => {
    statusTimer = null;
    emitStatus(root);
  }, wait);
}

/** Delete the persisted index for a workspace. */
export async function deleteIndex(root: string): Promise<void> {
  memIndex = emptyIndex();
  memRoot = normRoot(root);
  progress = { done: 0, total: 0 };
  try { await fs.unlink(metaPath(root)); } catch {}
  try { await fs.unlink(vecPath(root)); } catch {}
  emitStatus(root);
}

/** True when a workspace-relative path is real source (not vendor/build/junk). */
function isIndexableRel(rel: string): boolean {
  if (!rel || rel.startsWith("..")) return false;
  const parts = rel.split("/");
  const base = parts[parts.length - 1] || "";
  // Hidden files at any depth except common source dots (.env.example etc. skipped too).
  if (base.startsWith(".") && base !== ".gitignore" && base !== ".editorconfig") return false;
  for (const seg of parts) {
    if (!seg) continue;
    if (SKIP_DIR_SEGMENTS.has(seg)) return false;
    // Nested deps / generated trees often use these prefixes.
    if (seg.startsWith(".") && (seg === ".git" || seg.endsWith("_cache") || seg.endsWith("-cache"))) return false;
  }
  if (SKIP_BASENAMES.has(base)) return false;
  // Minified / bundled / source maps (not author source).
  if (/\.(min|bundle|chunk)\.(js|css|mjs|cjs)$/i.test(base)) return false;
  if (/\.map$/i.test(base)) return false;
  if (/\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|eot|mp[34]|wav|zip|gz|tgz|7z|rar|pdf|wasm|exe|dll|so|dylib|bin|o|a|class|jar|war|ear|pyc|pyo|whl|lock)$/i.test(base)) {
    return false;
  }
  const ext = path.extname(base).toLowerCase();
  if (!EMBED_EXTS.has(ext)) return false;
  // package.json etc. OK; skip huge generated JSON dumps by name pattern.
  if (ext === ".json" && /(^|[-_.])(lock|bundle|manifest|sourcemap)([-_.]|$)/i.test(base)) return false;
  return true;
}

/**
 * Collects chunks from many files and embeds them in batched forward passes.
 * Batching is the difference between one ONNX call per chunk and one per ~24,
 * which dominates build cost.
 */
class BatchEmbedder {
  private queue: { meta: Chunk; text: string; file: { rel: string; hash: string; total: number; received: number; failed: boolean; chunks: { meta: Chunk; vec: number[] }[] } }[] = [];
  private chars = 0;

  constructor(private readonly idx: IndexData) {}

  async addFile(rel: string, hash: string, pieces: ReturnType<typeof chunkFile>): Promise<void> {
    const file = { rel, hash, total: pieces.length, received: 0, failed: false, chunks: [] as { meta: Chunk; vec: number[] }[] };
    if (!pieces.length) { dropPath(this.idx, rel); this.idx.files[rel] = hash; return; }
    for (const piece of pieces) {
      this.queue.push({ meta: { path: rel, start: piece.start, end: piece.end }, text: piece.text, file });
      this.chars += piece.text.length;
      if (this.queue.length >= EMBED_BATCH_TEXTS || this.chars >= EMBED_BATCH_CHARS) await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (!this.queue.length) return;
    const batch = this.queue;
    this.queue = [];
    this.chars = 0;
    const sameConfig = this.idx.fingerprint === getEmbedFingerprint();
    const vecs = sameConfig && indexingEnabled ? await embed(batch.map((b) => b.text)).catch(() => null) : null;
    const dim = this.idx.dim || vecs?.[0]?.length || 0;
    const valid = !!vecs && vecs.length === batch.length && dim > 0 && this.idx.fingerprint === getEmbedFingerprint()
      && vecs.every((v) => Array.isArray(v) && v.length === dim && v.every(Number.isFinite));
    for (let i = 0; i < batch.length; i++) {
      const { file, meta } = batch[i];
      file.received++;
      if (!valid) file.failed = true;
      else file.chunks.push({ meta, vec: vecs![i] });
      if (file.received === file.total && !file.failed) {
        const previousRows = this.idx.files[file.rel]
          ? this.idx.metas.reduce((count, chunk) => count + Number(chunk.path === file.rel), 0) : 0;
        const nextRows = this.idx.count - previousRows + file.chunks.length;
        if (nextRows > MAX_INDEX_CHUNKS || nextRows * dim * 4 > MAX_VECTOR_BYTES) {
          indexLimitReason = "Semantic index memory limit reached; remaining files are available through text search.";
          continue;
        }
        // A file's old vectors and hash stay valid until every replacement chunk succeeds.
        dropPath(this.idx, file.rel);
        for (const chunk of file.chunks) pushChunk(this.idx, chunk.meta, chunk.vec);
        this.idx.files[file.rel] = file.hash;
      }
    }
  }
}

async function embedFileInto(embedder: BatchEmbedder, idx: IndexData, root: string, rel: string): Promise<boolean> {
  if (!isIndexableRel(rel) || await isPathExcluded(root, rel)) {
    const removed = !!idx.files[rel];
    dropPath(idx, rel);
    delete idx.files[rel];
    return removed;
  }
  if (idx.fingerprint !== getEmbedFingerprint()) return false;
  const abs = path.join(root, rel);
  let st;
  try { st = await fs.stat(abs); } catch { return false; }
  if (st.size > MAX_FILE_BYTES) return false;
  let text: string;
  try { text = await fs.readFile(abs, "utf8"); } catch { return false; }
  const after = await fs.stat(abs).catch(() => null);
  if (!after || after.mtimeMs !== st.mtimeMs || after.size !== st.size) return false;
  const version = `${Math.round(st.mtimeMs)}:${st.size}:${contentDigest(text)}`;
  if (idx.files[rel] === version) return false;
  await embedder.addFile(rel, version, chunkFile(text));
  return true;
}

function contentDigest(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function sameFileMetadata(version: string | undefined, mtimeMs: number, size: number): boolean {
  // Old snapshots without a content hash must be rebuilt before serving hits.
  return !!version && /^\d+(?:\.\d+)?:\d+:[a-f0-9]{64}$/.test(version)
    && (version.startsWith(`${Math.round(mtimeMs)}:${size}:`) || version.startsWith(`${mtimeMs}:${size}:`));
}

/** Pending single-file updates while a full build runs (or coalesced watcher queue). */
const pendingUpserts = new Map<string, Set<string>>(); // rootKey -> rel paths
const pendingDeletes = new Map<string, Set<string>>();
let drainRunning = false;

function queueKey(root: string): string {
  return normRoot(root);
}

/** A watcher burst shares embedding batches and persists one snapshot. */
export async function applyFileChanges(root: string, changes: ReadonlyMap<string, "up" | "del">): Promise<void> {
  if (!storageDir || !indexingEnabled || !root) return;
  const key = queueKey(root);
  if (!pendingUpserts.has(key)) pendingUpserts.set(key, new Set());
  if (!pendingDeletes.has(key)) pendingDeletes.set(key, new Set());
  const upserts = pendingUpserts.get(key)!, deletes = pendingDeletes.get(key)!;
  for (const [absOrRel, action] of changes) {
    const abs = path.isAbsolute(absOrRel) ? absOrRel : path.join(root, absOrRel);
    const rel = path.relative(root, abs).split(path.sep).join("/");
    if (!rel || rel.startsWith("..") || !isIndexableRel(rel)) continue;
    if (action === "del") { deletes.add(rel); upserts.delete(rel); }
    else { upserts.add(rel); deletes.delete(rel); }
  }
  await drainPending(root);
}

/** Index/update one file immediately (or queue if full build busy). */
export async function upsertFile(root: string, absOrRel: string): Promise<void> {
  if (!storageDir || !indexingEnabled || !root) return;
  const abs = path.isAbsolute(absOrRel) ? absOrRel : path.join(root, absOrRel);
  const rel = path.relative(root, abs).split(path.sep).join("/");
  if (!rel || rel.startsWith("..") || !isIndexableRel(rel)) return;
  if (await isPathExcluded(root, rel)) { await removeFile(root, rel); return; }
  const key = queueKey(root);
  if (indexing || drainRunning) {
    if (!pendingUpserts.has(key)) pendingUpserts.set(key, new Set());
    pendingUpserts.get(key)!.add(rel);
    pendingDeletes.get(key)?.delete(rel);
    return;
  }
  const idx = await load(root);
  let st;
  try { st = await fs.stat(abs); } catch {
    await removeFile(root, abs);
    return;
  }
  if (sameFileMetadata(idx.files[rel], st.mtimeMs, st.size)) {
    const raw = await fs.readFile(abs, "utf8").catch(() => null);
    if (raw !== null && idx.files[rel].endsWith(`:${contentDigest(raw)}`)) return;
  }
  const embedder = new BatchEmbedder(idx);
  await embedFileInto(embedder, idx, root, rel);
  await embedder.flush();
  await save(root, idx);
  emitStatus(root);
}

/** Remove a file from the index (delete/rename). */
export async function removeFile(root: string, absOrRel: string): Promise<void> {
  if (!storageDir || !indexingEnabled || !root) return;
  const abs = path.isAbsolute(absOrRel) ? absOrRel : path.join(root, absOrRel);
  const rel = path.relative(root, abs).split(path.sep).join("/");
  if (!rel || rel.startsWith("..")) return;
  const key = queueKey(root);
  if (indexing || drainRunning) {
    if (!pendingDeletes.has(key)) pendingDeletes.set(key, new Set());
    pendingDeletes.get(key)!.add(rel);
    pendingUpserts.get(key)?.delete(rel);
    return;
  }
  const idx = await load(root);
  if (!idx.files[rel] && !idx.metas.some((m) => m.path === rel)) return;
  dropPath(idx, rel);
  delete idx.files[rel];
  await save(root, idx);
  emitStatus(root);
}

async function drainPending(root: string): Promise<void> {
  if (drainRunning || indexing || !indexingEnabled) return;
  const key = queueKey(root);
  const ups = pendingUpserts.get(key);
  const dels = pendingDeletes.get(key);
  if ((!ups || !ups.size) && (!dels || !dels.size)) return;
  drainRunning = true;
  indexLimitReason = undefined;
  try {
    const idx = await load(root);
    let changed = false;
    if (dels?.size) {
      const gone = new Set(dels);
      changed = [...gone].some(rel => !!idx.files[rel]);
      retainChunks(idx, (p) => !gone.has(p));
      for (const rel of gone) delete idx.files[rel];
      dels.clear();
    }
    if (ups?.size) {
      const list = [...ups];
      ups.clear();
      progress = { done: 0, total: list.length };
      indexing = true;
      emitStatus(root);
      const embedder = new BatchEmbedder(idx);
      let done = 0;
      for (const rel of list) {
        if (!indexingEnabled || idx.fingerprint !== getEmbedFingerprint()) break;
        changed = await embedFileInto(embedder, idx, root, rel) || changed;
        if (indexLimitReason) break;
        done++;
        progress = { done, total: list.length };
        emitStatusThrottled(root);
      }
      await embedder.flush();
      indexing = false;
    }
    if (changed && indexingEnabled) await save(root, idx);
    emitStatus(root);
  } finally {
    drainRunning = false;
    indexing = false;
    // More events may have arrived.
    if ((pendingUpserts.get(key)?.size || 0) + (pendingDeletes.get(key)?.size || 0) > 0) {
      void drainPending(root).catch(error => console.error("[semanticIndex] queued update failed:", error));
    }
  }
}

/** (Re)build the index incrementally. Only re-embeds changed files. No-op if disabled/busy. */
export async function buildIndex(root: string, onProgress?: (done: number, total: number) => void): Promise<void> {
  if (!storageDir || !root || indexing || !indexingEnabled) return;
  indexing = true;
  progress = { done: 0, total: 0 };
  indexLimitReason = undefined;
  emitStatus(root);
  try {
    const idx = await load(root);
    // Parallel scan + mtime/size in one pass (replaces serial walk + per-file stat).
    const { files: scanned, truncated } = await scanFiles(root, {
      maxFiles: 100_000,
      timeMs: 60_000,
      useGitignore: true,
    });
    const targets: string[] = [];
    const seen = new Set<string>();
    let removedFiles = false;
    for (const f of scanned) {
      const rel = f.rel;
      if (!isIndexableRel(rel)) continue;
      if (f.size > MAX_FILE_BYTES) continue;
      seen.add(rel);
      const prev = idx.files[rel];
      if (!sameFileMetadata(prev, f.mtimeMs, f.size)) targets.push(rel);
    }
    // A bounded/partial scan cannot prove that an unseen file was deleted.
    if (!truncated) {
      retainChunks(idx, (p) => seen.has(p));
      for (const rel of Object.keys(idx.files)) if (!seen.has(rel)) { delete idx.files[rel]; removedFiles = true; }
    }

    // Nothing to do — still save cleaned deletions if any, emit status.
    if (!targets.length) {
      if (removedFiles) await save(root, idx);
      return;
    }

    let done = 0;
    progress = { done: 0, total: targets.length };
    emitStatus(root);
    const embedder = new BatchEmbedder(idx);
    let lastSave = Date.now();
    let lastYield = Date.now();
    for (const rel of targets) {
      if (!indexingEnabled || idx.fingerprint !== getEmbedFingerprint()) break;
      await embedFileInto(embedder, idx, root, rel);
      if (indexLimitReason) break;
      done++;
      progress = { done, total: targets.length };
      onProgress?.(done, targets.length);
      emitStatusThrottled(root);
      // Persist periodically so reopen mid-index keeps progress, but time-based
      // rather than every 25 files — the whole matrix is rewritten each save.
      if (Date.now() - lastSave > SAVE_THROTTLE_MS) {
        await embedder.flush();
        await save(root, idx);
        lastSave = Date.now();
      }
      if (Date.now() - lastYield > YIELD_EVERY_MS) {
        await new Promise<void>((r) => setImmediate(r));
        lastYield = Date.now();
      }
    }
    await embedder.flush();
    if (indexingEnabled) await save(root, idx);
  } finally {
    indexing = false;
    emitStatus(root);
    void drainPending(root).catch(error => console.error("[semanticIndex] queued update failed:", error));
  }
}

/** Read the line range for each hit straight from disk (chunk text isn't cached). */
async function hydrate(
  root: string,
  hits: { meta: Chunk; score: number; version: string }[]
): Promise<{ path: string; start: number; end: number; text: string; score: number }[]> {
  const byFile = new Map<string, string[] | null>();
  const out: { path: string; start: number; end: number; text: string; score: number }[] = [];
  for (const h of hits) {
    if (!byFile.has(h.meta.path)) {
      try {
        if (await isPathExcluded(root, h.meta.path)) { byFile.set(h.meta.path, null); continue; }
        const raw = await fs.readFile(path.join(root, h.meta.path), "utf8");
        // A score and its locations describe one exact indexed file version.
        // Changed files are handled by current-text search until re-indexed.
        if (!h.version?.endsWith(`:${contentDigest(raw)}`)) { byFile.set(h.meta.path, null); continue; }
        byFile.set(h.meta.path, raw.split("\n"));
      } catch {
        byFile.set(h.meta.path, null);
      }
    }
    const lines = byFile.get(h.meta.path);
    if (!lines) continue; // file vanished since indexing
    const text = lines.slice(h.meta.start - 1, h.meta.end).join("\n").trim();
    out.push({
      path: h.meta.path,
      start: h.meta.start,
      end: h.meta.end,
      text: text.length > SNIPPET_MAX_CHARS ? text.slice(0, SNIPPET_MAX_CHARS) : text,
      score: h.score,
    });
  }
  return out;
}

/** Cosine top-k. Returns [] if index empty / embedder unavailable. */
export async function search(
  root: string,
  query: string,
  k = 12,
  filter?: (rel: string) => boolean
): Promise<{ path: string; start: number; end: number; text: string; score: number }[]> {
  if (!indexingEnabled || !storageDir || !root) return [];
  const idx = await load(root);
  if (!idx.count || !idx.dim) return [];
  const fingerprint = getEmbedFingerprint();
  const qv = await embedQuery(query);
  if (!qv || fingerprint !== getEmbedFingerprint()) return [];
  if (!idx.count || !idx.dim || qv.length !== idx.dim) return [];
  const dim = idx.dim;
  const q = Float32Array.from(qv);
  const vecs = idx.vecs;
  // Bounded top-k instead of scoring every chunk into an array and sorting it.
  const top: { meta: Chunk; score: number; version: string }[] = [];
  let floor = -Infinity;
  for (let r = 0; r < idx.count; r++) {
    const meta = idx.metas[r];
    if (filter && !filter(meta.path)) continue;
    const base = r * dim;
    let dot = 0;
    for (let i = 0; i < dim; i++) dot += q[i] * vecs[base + i]; // both normalized → cosine
    if (top.length === k && dot <= floor) continue;
    let pos = top.length;
    while (pos > 0 && top[pos - 1].score < dot) pos--;
    top.splice(pos, 0, { meta, score: dot, version: idx.files[meta.path] });
    if (top.length > k) top.pop();
    if (top.length === k) floor = top[k - 1].score;
  }
  return hydrate(root, top);
}
