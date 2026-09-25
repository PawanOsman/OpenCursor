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
import { createHash } from "crypto";
import { embedTexts, embedQuery, getEmbedFingerprint } from "./semanticIndex";
import { createDocPolicy, extractDocPage, extractSitemapUrls, extractLlmsLinks, rankDocCandidates, type DocCandidate } from "./docsDiscovery";
import { aborted, withDocAbort, fetchDocResource, parseDocRobots, docDelay, DocLimitError, DocHttpError, type DocFetchBudget, type DocResource } from "./docsFetch";

export interface DocSource {
  id: string;
  name: string;
  url: string;
  pages?: number;
  chunks?: number;
  indexedAt?: number;
  /** Maximum selected pages, not a target; discovery always has a finite boundary. */
  maxPages?: number;
  scope?: "section" | "page";
  scopePath?: string;
  focus?: string;
  useAi?: boolean;
  excludePaths?: string[];
  resolvedScope?: string;
  stopReason?: string;
  selected?: number;
  error?: string;
}
export type DocPageSelector = (input: {
  source: DocSource; candidates: readonly { url: string; title: string }[]; limit: number; signal: AbortSignal;
}) => Promise<readonly string[]>;
export interface DocIndexResult { pages: number; chunks: number; selected: number; scope: string; stopReason: string }
interface DocChunk { url: string; title: string; text: string; vec: number[] }
interface DocIndexFile {
  fingerprint: string;
  chunks: DocChunk[];
  pages?: { url: string; hash: string }[];
  source?: { url: string; scope: string; focus: string };
}
export interface DocsStatus {
  indexing?: string;
  sourceId?: string;
  phase?: "discovering" | "planning" | "indexing" | "saving" | "complete" | "cancelled" | "error";
  done: number;
  total: number;
  fetched?: number;
  indexed?: number;
  skipped?: number;
  scope?: string;
  stopReason?: string;
  error?: string;
}

const DEFAULT_MAX_PAGES = 200;
const MAX_CANDIDATES = 1500;
const MAX_CHUNKS = 12000;
const MAX_VECTOR_VALUES = 2_000_000;
const CHUNK_CHARS = 1600;
let storageDir: string | undefined;
export function setDocsStorageDir(dir: string): void { storageDir = dir; }
let docSourcesProvider: () => DocSource[] = () => [];
export function setDocSourcesProvider(fn: () => DocSource[]): void { docSourcesProvider = fn; }
export function listDocSources(): DocSource[] { return docSourcesProvider(); }
function fileFor(id: string): string {
  if (!id || id.length > 200) throw new Error("Invalid documentation source id.");
  return path.join(storageDir!, `docs-${encodeURIComponent(id)}.json`);
}
let status: DocsStatus = { done: 0, total: 0 };
const subs = new Set<(s: DocsStatus) => void>();
const docLogs = new Map<string, string[]>();
function log(id: string, line: string) {
  const lines = docLogs.get(id) ?? [];
  lines.push(`${new Date().toLocaleTimeString()}  ${line}`);
  if (lines.length > 500) lines.shift();
  docLogs.set(id, lines);
}
export function getDocLogs(id: string): string[] { return docLogs.get(id) ?? []; }
export function onDocsStatus(fn: (s: DocsStatus) => void): () => void { subs.add(fn); return () => subs.delete(fn); }
export function getDocsStatus(): DocsStatus { return status; }
function emit(patch: Partial<DocsStatus>) {
  status = { ...status, ...patch };
  for (const fn of subs) { try { fn(status); } catch { /* A closed settings view cannot stop indexing. */ } }
}
let activeJob: { id: string; controller: AbortController; settled: Promise<void> } | undefined;
export function cancelDocIndex(id?: string): boolean {
  if (!activeJob || id && activeJob.id !== id) return false;
  activeJob.controller.abort(aborted());
  return true;
}

/** Split long paragraphs/code blocks too, so a single page cannot overwhelm an embedder. */
export function chunkDocText(text: string): string[] {
  const out: string[] = [];
  let remaining = text.trim();
  while (remaining.length) {
    let end = Math.min(CHUNK_CHARS, remaining.length);
    if (end < remaining.length) {
      const newline = remaining.lastIndexOf("\n", end);
      const space = remaining.lastIndexOf(" ", end);
      if (newline > CHUNK_CHARS / 2) end = newline;
      else if (space > CHUNK_CHARS / 2) end = space;
    }
    const piece = remaining.slice(0, end).trim();
    if (piece.length >= 40 || out.length > 0) out.push(piece);
    remaining = remaining.slice(end).trimStart();
  }
  return out;
}
function hashText(text: string): string { return createHash("sha256").update(text.replace(/\r\n/g, "\n").trim()).digest("hex"); }

/** Discover once, select once, then process only that immutable plan. */
export async function indexDocSource(doc: DocSource, options: { signal?: AbortSignal; selectPages?: DocPageSelector } = {}): Promise<DocIndexResult> {
  if (!storageDir) throw new Error("Documentation storage is not initialised.");
  if (activeJob) throw new Error("Another documentation source is already being indexed.");
  const policy = createDocPolicy(doc.url, doc);
  const destination = fileFor(doc.id);
  const maxPages = Number.isFinite(doc.maxPages) ? Math.max(1, Math.min(1000, Math.floor(doc.maxPages!))) : DEFAULT_MAX_PAGES;
  const controller = new AbortController();
  let finish!: () => void;
  const job = { id: doc.id, controller, settled: new Promise<void>(resolve => { finish = resolve; }) };
  activeJob = job;
  const timeout = setTimeout(() => controller.abort(new DocLimitError("Indexing time budget reached (10 minutes). The previous index was kept.")), 10 * 60_000);
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  const fingerprint = getEmbedFingerprint();
  const budget: DocFetchBudget = { requests: 0, maxRequests: maxPages * 3 + 40, bytes: 0, maxBytes: 64 * 1024 * 1024 };
  const scope = policy.origin + policy.scopePath;
  let fetched = 0, skipped = 0, indexed = 0;
  const progress = () => emit({ fetched, skipped, indexed });
  const sameOrigin = (url: string) => {
    try { const u = new URL(url); return u.origin === policy.origin && !u.username && !u.password && /^https?:$/.test(u.protocol); } catch { return false; }
  };
  let robots = parseDocRobots("");
  const fetchResource = async (url: string, metadata = false): Promise<DocResource> => {
    const resource = await fetchDocResource(url, { signal, budget, metadata,
      allowUrl: target => sameOrigin(target) && robots.allows(target) && robots.aiInputAllowedFor(target) !== false && (metadata || policy.allows(target)),
    });
    if (!metadata) { fetched++; progress(); }
    return resource;
  };
  const optionalResource = async (url: string, metadata = false, onFailure?: (error: unknown) => void): Promise<DocResource | undefined> => {
    try { return await fetchResource(url, metadata); }
    catch (error) {
      signal.throwIfAborted();
      if (error instanceof DocLimitError) throw error;
      onFailure?.(error);
      if (!metadata) { skipped++; progress(); }
      log(doc.id, `SKIP ${url} — ${String((error as Error).message || error)}`);
      return undefined;
    }
  };
  docLogs.set(doc.id, []);
  emit({ indexing: doc.id, sourceId: doc.id, phase: "discovering", done: 0, total: 0, fetched: 0, indexed: 0, skipped: 0, scope, stopReason: undefined, error: undefined });
  log(doc.id, `Discovering "${doc.name}" within ${scope}${doc.scope === "page" ? " (single page)" : " (section)"}.`);
  if (doc.maxPages && doc.maxPages > 1000) log(doc.id, "Page budget limited to 1000. A larger budget never expands the discovery boundary.");
  try {
    signal.throwIfAborted();
    try {
      const response = await fetchResource(new URL("/robots.txt", policy.origin).toString(), true);
      robots = parseDocRobots(response.body);
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof DocHttpError) || error.status >= 500) throw new Error(`Could not check robots.txt: ${(error as Error).message}`);
    }
    if (!robots.allows(policy.startUrl)) throw new Error("The documentation site disallows indexing this path in robots.txt.");
    if (robots.aiInputAllowedFor(policy.startUrl) === false) throw new Error("The documentation site disallows AI retrieval in robots.txt (Content-Signal: ai-input=no). The previous index was kept.");
    if (robots.aiInputAllowedFor(policy.startUrl) === true) log(doc.id, "The site explicitly permits AI retrieval (Content-Signal: ai-input=yes). Search-only noindex headers on permitted text documentation do not exclude it from this local index.");
    const seed = await fetchResource(policy.startUrl);
    const seedPage = extractDocPage(seed.body, seed.url, seed.isHtml);
    const seedUrl = policy.normalize(seed.url) ?? policy.startUrl;
    const candidates = new Map<string, DocCandidate>();
    const cached = new Map<string, DocResource>([[seedUrl, seed]]);
    let candidateLimit = false;
    const priority = { seed: 5, llms: 4, navigation: 3, sitemap: 2, link: 1 };
    const add = (candidate: DocCandidate) => {
      const url = policy.normalize(candidate.url, seed.url);
      if (!url || !robots.allows(url) || robots.aiInputAllowedFor(url) === false) { skipped++; return; }
      const existing = candidates.get(url);
      if (existing) {
        if (priority[candidate.source] > priority[existing.source]) existing.source = candidate.source;
        if ((!existing.title || existing.title === url) && candidate.title) existing.title = candidate.title.slice(0, 300);
        return;
      }
      if (candidates.size >= MAX_CANDIDATES) {
        candidateLimit = true;
        // Large body link lists must not crowd curated page lists out of discovery.
        const weaker = [...candidates].find(([, page]) => priority[page.source] < priority[candidate.source]);
        if (!weaker) return;
        candidates.delete(weaker[0]);
      }
      candidates.set(url, { ...candidate, url, title: candidate.title.slice(0, 300) });
    };
    add({ url: seedUrl, title: seedPage.title || doc.name, source: "seed" });
    if (doc.scope !== "page" && maxPages > 1) {
      seedPage.links.forEach(add);
      const directory = policy.scopePath.replace(/\/$/, "") + "/";
      const llmsUrls = [...new Set([new URL(`${directory}llms.txt`, policy.origin).toString(), new URL("/llms.txt", policy.origin).toString()])];
      for (const url of llmsUrls) {
        if (!robots.allows(url)) continue;
        const resource = await optionalResource(url, true);
        if (resource && !resource.isHtml) extractLlmsLinks(resource.body, resource.url).forEach(add);
      }
      const sitemapQueue = [...new Set([
        ...robots.sitemaps.filter(sameOrigin),
        new URL(`${directory}sitemap.xml`, policy.origin).toString(), new URL("/sitemap.xml", policy.origin).toString(),
      ])];
      const sitemapSeen = new Set<string>();
      for (let attempts = 0; sitemapQueue.length && attempts < 4; attempts++) {
        const url = sitemapQueue.shift()!;
        if (sitemapSeen.has(url) || !sameOrigin(url) || !robots.allows(url)) continue;
        sitemapSeen.add(url);
        const resource = await optionalResource(url, true);
        if (!resource) continue;
        const entries = extractSitemapUrls(resource.body, resource.url);
        entries.pages.forEach(url => add({ url, title: "", source: "sitemap" }));
        sitemapQueue.push(...entries.sitemaps.filter(url => sameOrigin(url) && !sitemapSeen.has(url)).slice(0, 4));
      }
      // Only first-level navigation hubs help fill missing page lists. Their children
      // become candidates, never further discovery jobs. Body cross-links do not recurse.
      const hubs = rankDocCandidates([...candidates.values()].filter(item => item.source === "navigation" && /(?:^|\/)(?:docs?|guides?|reference|api|tutorials?|getting-started|overview|manual)\/?$/i.test(new URL(item.url).pathname) && item.url !== seedUrl), doc.focus || "", 3);
      for (const hub of hubs) {
        const resource = await optionalResource(hub.url);
        if (!resource) continue;
        cached.set(hub.url, resource);
        extractDocPage(resource.body, resource.url, resource.isHtml).links.forEach(add);
      }
    }
    progress();
    emit({ phase: "planning" });
    const ranked = rankDocCandidates([...candidates.values()], doc.focus || "", MAX_CANDIDATES);
    let plan = ranked.slice(0, maxPages);
    if (doc.useAi !== false && options.selectPages && ranked.length > 1) {
      try {
        const selection = await withDocAbort(options.selectPages({ source: doc, candidates: ranked, limit: maxPages, signal }), signal);
        const allowed = new Map(ranked.map(candidate => [candidate.url, candidate]));
        const selected = [...new Set(selection)].map(url => allowed.get(url)).filter((candidate): candidate is DocCandidate => !!candidate);
        if (!selected.length) throw new Error("The planner did not select any eligible pages.");
        plan = selected.slice(0, maxPages);
        log(doc.id, `AI selected ${plan.length} pages from the eligible documentation candidates.`);
      } catch (error) {
        signal.throwIfAborted();
        log(doc.id, `AI planning unavailable; using the scoped page plan. ${(error as Error).message}`);
      }
    } else if (doc.useAi !== false && ranked.length > 1) log(doc.id, "Using the scoped page plan; no AI planner is configured.");
    if (!plan.length) throw new Error("No relevant documentation pages were found within the chosen scope.");
    log(doc.id, `Plan fixed: ${plan.length} selected of ${candidates.size} eligible pages. Links on indexed pages will not expand this plan.`);
    log(doc.id, `Limits: ${budget.maxRequests} requests including retries, 64 MiB downloads, 10 minutes.`);
    for (const page of plan) log(doc.id, `PLAN ${page.url}`);
    emit({ phase: "indexing", done: 0, total: plan.length });

    let previous: DocIndexFile | undefined;
    try {
      const info = await fs.stat(destination);
      if (info.size <= 64 * 1024 * 1024) {
        const candidate = JSON.parse(await fs.readFile(destination, "utf8")) as DocIndexFile;
        if (candidate.fingerprint === fingerprint && Array.isArray(candidate.chunks)) previous = candidate;
      }
    } catch { /* First index or an unreadable cache gets rebuilt. */ }
    const previousHashes = new Map((Array.isArray(previous?.pages) ? previous.pages : [])
      .filter(page => page && typeof page.url === "string" && typeof page.hash === "string").map(page => [page.url, page.hash]));
    const previousChunks = new Map<string, DocChunk[]>();
    for (const chunk of previous?.chunks ?? []) {
      if (!chunk || typeof chunk.url !== "string" || typeof chunk.text !== "string" || !Array.isArray(chunk.vec) || !chunk.vec.length || !chunk.vec.every(Number.isFinite)) continue;
      const items = previousChunks.get(chunk.url) ?? [];
      items.push(chunk); previousChunks.set(chunk.url, items);
    }
    const chunks: DocChunk[] = [], pages: { url: string; hash: string }[] = [];
    const seenUrls = new Set<string>(), seenContent = new Set<string>();
    const skipReasons = new Map<string, number>();
    const countSkip = (reason: string) => skipReasons.set(reason, (skipReasons.get(reason) ?? 0) + 1);
    const skipPage = (url: string, reason: string) => {
      skipped++; countSkip(reason); log(doc.id, `SKIP ${url} — ${reason}.`);
    };
    let vectorSize: number | undefined;
    let vectorValues = 0;
    for (let index = 0; index < plan.length; index++) {
      signal.throwIfAborted();
      const candidate = plan[index];
      const resource = cached.get(candidate.url) ?? await optionalResource(candidate.url, false, error => {
        countSkip(error instanceof DocHttpError ? `HTTP ${error.status}` : String((error as Error).message || error).slice(0, 200));
      });
      cached.delete(candidate.url);
      if (resource) {
        const page = extractDocPage(resource.body, resource.url, resource.isHtml);
        const canonical = page.canonical ? policy.normalize(page.canonical, resource.url) : undefined;
        const url = canonical || policy.normalize(resource.url) || candidate.url;
        const hash = hashText(page.text);
        // Text representations can exclude search engines while explicitly allowing
        // private AI retrieval. Crawl restrictions and HTML noindex still apply.
        const textRetrievalAllowed = !resource.isHtml && robots.aiInputAllowedFor(resource.url) === true;
        if ((resource.noindex || page.noindex) && !textRetrievalAllowed) {
          skipPage(candidate.url, "excluded by noindex without permission for AI text retrieval");
        } else if (!robots.allows(url)) {
          skipPage(candidate.url, "canonical URL excluded by robots.txt");
        } else if (robots.aiInputAllowedFor(url) === false) {
          skipPage(candidate.url, "canonical URL excludes AI retrieval");
        } else if (seenUrls.has(url) || seenContent.has(hash)) {
          skipPage(candidate.url, "duplicate URL or content");
        } else {
          const pieces = chunkDocText(page.text);
          if (!pieces.length) skipPage(url, "no readable documentation content");
          else {
            if (chunks.length + pieces.length > MAX_CHUNKS) throw new DocLimitError("Documentation chunk budget reached. Narrow the section or topic; the previous index was kept.");
            const reusable = previousHashes.get(url) === hash ? previousChunks.get(url) : undefined;
            const next: DocChunk[] = [];
            if (reusable?.length === pieces.length && reusable.every((chunk, i) => chunk.text === pieces[i])) {
              next.push(...reusable.map(chunk => ({ ...chunk, title: page.title || candidate.title || doc.name })));
              log(doc.id, `REUSE ${url} — unchanged content.`);
            } else {
              for (let offset = 0; offset < pieces.length; offset += 24) {
                signal.throwIfAborted();
                const batch = pieces.slice(offset, offset + 24);
                const vectors = await withDocAbort(embedTexts(batch, signal), signal);
                if (getEmbedFingerprint() !== fingerprint) throw new Error("Embedding configuration changed during indexing; retry this source.");
                if (!vectors || vectors.length !== batch.length || vectors.some(vector => !Array.isArray(vector) || !vector.length || !vector.every(Number.isFinite))) throw new Error("Embedding failed. Check the embedding model in Codebase Indexing.");
                if (vectorValues + next.reduce((count, chunk) => count + chunk.vec.length, 0) + vectors.reduce((count, vector) => count + vector.length, 0) > MAX_VECTOR_VALUES) throw new DocLimitError("Documentation vector memory budget reached. Narrow the section or topic; the previous index was kept.");
                batch.forEach((text, i) => next.push({ url, title: page.title || candidate.title || doc.name, text, vec: vectors[i] }));
              }
              log(doc.id, `OK ${url} — ${next.length} chunks.`);
            }
            for (const chunk of next) {
              vectorSize ??= chunk.vec.length;
              if (chunk.vec.length !== vectorSize) throw new Error("Embedding dimensions changed; the previous index was kept.");
              vectorValues += chunk.vec.length;
              if (vectorValues > MAX_VECTOR_VALUES) throw new DocLimitError("Documentation vector memory budget reached. Narrow the section or topic; the previous index was kept.");
            }
            seenUrls.add(url); seenContent.add(hash);
            chunks.push(...next); pages.push({ url, hash }); indexed++;
          }
        }
      }
      emit({ done: index + 1 }); progress();
      if (index + 1 < plan.length && !cached.has(plan[index + 1].url)) await docDelay(100, signal);
    }
    const commonSkips = [...skipReasons].sort((a, b) => b[1] - a[1]);
    const remainingSkips = commonSkips.slice(5).reduce((count, [, pages]) => count + pages, 0);
    const skipSummary = commonSkips.slice(0, 5).map(([reason, count]) => `${count} ${count === 1 ? "page" : "pages"}: ${reason}`)
      .concat(remainingSkips ? [`${remainingSkips} other skipped pages (see logs)`] : []).join("; ");
    if (skipSummary) log(doc.id, `Selected-page skips: ${skipSummary}.`);
    if (!chunks.length) throw new Error(`No readable documentation was indexed. ${skipSummary ? `${skipSummary}. ` : ""}The previous index was kept; check the URL, scope, and logs.`);
    signal.throwIfAborted();
    if (getEmbedFingerprint() !== fingerprint) throw new Error("Embedding configuration changed during indexing; retry this source.");
    emit({ phase: "saving" });
    await fs.mkdir(storageDir, { recursive: true });
    const temp = `${destination}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify({ fingerprint, chunks, pages, source: { url: doc.url, scope, focus: doc.focus || "" } } satisfies DocIndexFile), "utf8");
      signal.throwIfAborted();
      await fs.rename(temp, destination);
    } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
    const stopReason = `Completed the fixed plan: ${indexed} of ${plan.length} selected pages indexed.${candidateLimit ? " Discovery candidate limit reached." : ""}${ranked.length > maxPages ? " Page budget applied; narrow the topic to target a different subset." : ""}`;
    log(doc.id, `${stopReason} ${chunks.length} chunks; ${budget.requests} requests.`);
    emit({ indexing: undefined, phase: "complete", stopReason, error: undefined });
    return { pages: indexed, chunks: chunks.length, selected: plan.length, scope, stopReason };
  } catch (error) {
    const cancelled = signal.aborted && !(signal.reason instanceof DocLimitError);
    const message = cancelled ? "Indexing cancelled. The previous index was kept." : String((error as Error).message || error);
    log(doc.id, `${cancelled ? "STOP" : "FAILED"}: ${message}`);
    emit({ indexing: undefined, phase: cancelled ? "cancelled" : "error", error: cancelled ? undefined : message, stopReason: message });
    throw cancelled ? aborted() : error;
  } finally {
    clearTimeout(timeout);
    if (activeJob === job) activeJob = undefined;
    finish();
  }
}

export async function deleteDocIndex(id: string): Promise<void> {
  if (activeJob?.id === id) { const job = activeJob; cancelDocIndex(id); await job.settled; }
  if (storageDir) await fs.rm(fileFor(id), { force: true });
  docLogs.delete(id);
}

/** Cosine top-k over one doc source's chunks. */
export async function searchDocs(
  id: string,
  query: string,
  k = 6
): Promise<{ url: string; title: string; text: string; score: number }[]> {
  if (!storageDir) return [];
  let idx: DocIndexFile;
  try {
    idx = JSON.parse(await fs.readFile(fileFor(id), "utf8"));
  } catch {
    return [];
  }
  if (!idx || !Array.isArray(idx.chunks)) return [];
  const source = listDocSources().find(doc => doc.id === id);
  const policy = source ? createDocPolicy(source.url, source) : undefined;
  if (source && idx.source && (idx.source.url !== source.url || idx.source.scope !== policy!.origin + policy!.scopePath)) {
    throw new Error("Documentation source scope changed. Reindex this source in Settings.");
  }
  const fingerprint = getEmbedFingerprint();
  if (idx.fingerprint !== fingerprint) throw new Error("Documentation index uses a different embedding configuration. Reindex this source in Settings.");
  const qv = await embedQuery(query);
  if (!qv || !idx.chunks.length || getEmbedFingerprint() !== fingerprint) return [];
  const scored = idx.chunks
    .filter((c) => c && typeof c.url === "string" && typeof c.text === "string" && Array.isArray(c.vec) && c.vec.length === qv.length && c.vec.every(Number.isFinite) && (!policy || policy.allows(c.url)))
    .map((c) => {
      let dot = 0;
      for (let i = 0; i < qv.length; i++) dot += qv[i] * c.vec[i];
      return { c, score: dot };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
  return scored.map(({ c, score }) => ({ url: c.url, title: c.title, text: c.text, score }));
}
