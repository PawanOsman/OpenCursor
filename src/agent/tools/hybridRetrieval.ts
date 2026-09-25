/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { scanFilesCached, isPathExcluded } from "./fileScan";
import { BINARY_EXTS, isNoisePath } from "./ignore";

export interface RetrievalHit {
  path: string;
  start: number;
  end: number;
  text: string;
  score: number;
  source?: "disk" | "editor";
  signals?: string[];
}

export interface EditorSnapshot { path: string; text: string; version: number }

const STOP_WORDS = new Set(["the", "and", "for", "with", "that", "this", "from", "where", "what", "how", "does", "which", "find", "code", "function", "file", "into", "are", "was"]);
export function queryTerms(query: string): string[] {
  const pieces = `${query} ${query.replace(/([a-z])([A-Z])/g, "$1 $2")}`.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  return [...new Set(pieces.filter((term) => term.length >= 3 && !STOP_WORDS.has(term)))].slice(0, 12);
}

function lexicalHits(relative: string, text: string, terms: string[], source: "disk" | "editor"): RetrievalHit[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const candidates: Array<{ line: number; score: number }> = [];
  const pathScore = terms.filter((term) => relative.toLowerCase().includes(term)).length;
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    let score = 0;
    for (const term of terms) {
      const at = lower.indexOf(term);
      if (at < 0) continue;
      const left = at === 0 || !/[\p{L}\p{N}_]/u.test(lower[at - 1]);
      const right = at + term.length >= lower.length || !/[\p{L}\p{N}_]/u.test(lower[at + term.length]);
      score += left && right ? 4 : 1;
    }
    if (score > 0) candidates.push({ line: i, score: score + pathScore });
  }
  if (!candidates.length && pathScore) candidates.push({ line: 0, score: pathScore });
  candidates.sort((a, b) => b.score - a.score || a.line - b.line);
  const out: RetrievalHit[] = [];
  for (const candidate of candidates) {
    if (out.some((hit) => candidate.line + 1 >= hit.start && candidate.line + 1 <= hit.end)) continue;
    const start = Math.max(0, candidate.line - 3), end = Math.min(lines.length, candidate.line + 7);
    out.push({ path: relative, start: start + 1, end, text: lines.slice(start, end).join("\n").slice(0, 2000), score: candidate.score, source, signals: ["lexical"] });
    if (out.length === 3) break;
  }
  return out;
}

/** Current text candidates, bounded by bytes/files/time and the same ignore policy as vector indexing. */
export async function lexicalCodeSearch(root: string, query: string, options: {
  filter?: (relative: string) => boolean;
  signal?: AbortSignal;
  editors?: EditorSnapshot[];
  maxFiles?: number;
  timeMs?: number;
} = {}): Promise<{ hits: RetrievalHit[]; incomplete: boolean; scannedFiles: number }> {
  const terms = queryTerms(query);
  if (!terms.length) return { hits: [], incomplete: false, scannedFiles: 0 };
  const scan = await scanFilesCached(root, { timeMs: 1500, signal: options.signal });
  const deadline = Date.now() + (options.timeMs ?? 1500);
  const maxFiles = options.maxFiles ?? 1200;
  const editors = new Map((options.editors ?? []).map((editor) => [editor.path, editor]));
  const files = scan.files.filter((file) => file.size <= 512 * 1024 && !BINARY_EXTS.has(path.extname(file.rel).toLowerCase()) && !isNoisePath(file.rel) && (!options.filter || options.filter(file.rel)));
  // Unsaved buffers and matching filenames are useful even under a large-repo budget.
  const priority = (relative: string) => (editors.has(relative) ? 1000 : 0) + terms.filter((term) => relative.toLowerCase().includes(term)).length;
  files.sort((a, b) => priority(b.rel) - priority(a.rel) || a.rel.localeCompare(b.rel));
  const hits: RetrievalHit[] = [];
  let scannedFiles = 0, incomplete = scan.truncated;
  for (let start = 0; start < files.length; start += 8) {
    if (options.signal?.aborted || Date.now() > deadline || scannedFiles >= maxFiles) { incomplete = true; break; }
    const batch = files.slice(start, start + Math.min(8, maxFiles - scannedFiles));
    const results = await Promise.all(batch.map(async (file) => {
      if (options.signal?.aborted || await isPathExcluded(root, file.rel)) return [];
      try {
        const editor = editors.get(file.rel);
        const text = editor?.text ?? await fs.readFile(file.abs, { encoding: "utf8", signal: options.signal });
        if (text.length > 512 * 1024 || text.slice(0, 8192).includes("\0")) return [];
        return lexicalHits(file.rel, text, terms, editor ? "editor" : "disk");
      } catch { return []; }
    }));
    scannedFiles += batch.length;
    hits.push(...results.flat());
    hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.start - b.start);
    if (hits.length > 48) hits.length = 48;
  }
  return { hits, incomplete: incomplete || scannedFiles < files.length, scannedFiles };
}

/** Reciprocal-rank fusion: scores are ranks, never advertised as calibrated confidence. */
export function fuseRetrieval(semantic: RetrievalHit[], lexical: RetrievalHit[], limit = 8): RetrievalHit[] {
  const combined: RetrievalHit[] = [];
  for (const [signal, list] of [["lexical", lexical], ["semantic", semantic]] as const) {
    for (let rank = 0; rank < list.length; rank++) {
      const hit = list[rank];
      const existing = combined.find((item) => item.path === hit.path && item.start <= hit.end && hit.start <= item.end);
      const contribution = 1 / (60 + rank + 1);
      if (existing) {
        if (!existing.signals!.includes(signal)) { existing.score += contribution; existing.signals!.push(signal); }
      } else combined.push({ ...hit, score: contribution, signals: [signal] });
    }
  }
  return combined.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.start - b.start).slice(0, limit);
}
