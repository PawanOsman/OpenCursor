/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

export interface DocFetchBudget { requests: number; maxRequests: number; bytes: number; maxBytes: number }
export interface DocResource { url: string; body: string; isHtml: boolean; noindex: boolean }
export class DocLimitError extends Error {}
export class DocHttpError extends Error {
  constructor(readonly status: number, url: string) { super(`HTTP ${status} (${url})`); }
}

export function aborted(): Error { return Object.assign(new Error("Documentation indexing cancelled."), { name: "AbortError" }); }

/** Releases callers promptly even when an embedding runtime cannot interrupt native work. */
export function withDocAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void promise.catch(() => {}); return Promise.reject(signal.reason ?? aborted()); }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => { cleanup(); reject(signal.reason ?? aborted()); };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

export async function docDelay(ms: number, signal: AbortSignal): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await withDocAbort(new Promise<void>(resolve => { timer = setTimeout(resolve, ms); }), signal); }
  finally { clearTimeout(timer); }
}

/** All attempts, redirects, and streamed bytes share a job-wide budget. */
export async function fetchDocResource(url: string, options: {
  signal: AbortSignal; budget: DocFetchBudget; allowUrl: (url: string) => boolean; metadata?: boolean;
}): Promise<DocResource> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new Error(`Timed out fetching ${url}`)), 15_000);
  const signal = AbortSignal.any([options.signal, timeout.signal]);
  const limit = options.metadata ? 512 * 1024 : 2 * 1024 * 1024;
  const visited = new Set<string>();
  let current = url, retry = 0;
  try {
    for (let redirects = 0; redirects <= 5;) {
      signal.throwIfAborted();
      if (!options.allowUrl(current)) throw new Error(`Outside documentation scope: ${current}`);
      if (options.budget.requests >= options.budget.maxRequests) throw new DocLimitError("Request budget reached.");
      options.budget.requests++;
      const res = await withDocAbort(fetch(current, {
        signal, redirect: "manual",
        headers: { "user-agent": "OpenCursor-Docs", accept: options.metadata ? "text/plain,application/xml,text/xml,text/markdown" : "text/html,text/markdown,text/plain;q=0.9", "accept-language": "en;q=0.9" },
      }), signal);
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        await res.body?.cancel().catch(() => {});
        const location = res.headers.get("location");
        if (!location) throw new Error(`Redirect has no destination: ${current}`);
        visited.add(current);
        current = new URL(location, current).toString();
        if (visited.has(current)) throw new Error("Documentation redirect loop.");
        redirects++;
        continue;
      }
      if ([429, 503].includes(res.status) && retry++ === 0) {
        await res.body?.cancel().catch(() => {});
        const raw = res.headers.get("retry-after") || "1";
        const seconds = Number(raw);
        const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - Date.now();
        await docDelay(Math.max(250, Math.min(5000, Number.isFinite(delay) ? delay : 1000)), signal);
        continue;
      }
      if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new DocHttpError(res.status, current); }
      // Guard mocks/adapters that follow redirects despite redirect:manual as well.
      const finalUrl = res.url || current;
      if (!options.allowUrl(finalUrl)) { await res.body?.cancel().catch(() => {}); throw new Error(`Outside documentation scope: ${finalUrl}`); }
      const contentType = (res.headers.get("content-type") || "").toLowerCase();
      const supported = !contentType || /html|markdown|text\/plain/.test(contentType) || options.metadata && /xml/.test(contentType);
      if (!supported) { await res.body?.cancel().catch(() => {}); throw new Error(`Unsupported documentation content: ${contentType}`); }
      const length = Number(res.headers.get("content-length") || 0);
      if (length > limit) { await res.body?.cancel().catch(() => {}); throw new Error("Documentation page exceeds the response size limit."); }
      if (length + options.budget.bytes > options.budget.maxBytes) { await res.body?.cancel().catch(() => {}); throw new DocLimitError("Download budget reached."); }
      const reader = res.body?.getReader();
      let body = "", bytes = 0;
      const decoder = new TextDecoder();
      if (reader) {
        try {
          while (true) {
            const result = await withDocAbort(reader.read(), signal);
            if (result.done) break;
            bytes += result.value.byteLength;
            options.budget.bytes += result.value.byteLength;
            if (options.budget.bytes > options.budget.maxBytes) throw new DocLimitError("Download budget reached.");
            if (bytes > limit) throw new Error("Documentation page exceeds the response size limit.");
            body += decoder.decode(result.value, { stream: true });
          }
          body += decoder.decode();
        } finally { void reader.cancel().catch(() => {}); }
      }
      return { url: finalUrl, body, isHtml: /html/.test(contentType) || /^\s*(?:<!doctype|<html|<head|<body|<main|<article)/i.test(body),
        noindex: /(?:^|[,:\s])(?:noindex|none)(?:$|[,\s])/i.test(res.headers.get("x-robots-tag") || "") };
    }
    throw new Error("Too many documentation redirects.");
  } finally { clearTimeout(timer); }
}

/** A bounded robots parser for this crawler's product token and wildcard groups. */
export function parseDocRobots(text: string): {
  allows: (url: string) => boolean;
  sitemaps: string[];
  aiInputAllowed?: boolean;
  aiInputAllowedFor: (url: string) => boolean | undefined;
} {
  type Rule = { allow: boolean; path: string };
  type InputSignal = { allow: boolean; path?: string };
  type Group = { agents: string[]; rules: Rule[]; inputSignals: InputSignal[] };
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  const globalInputSignals: InputSignal[] = [];
  let group: Group = { agents: [], rules: [], inputSignals: [] };
  let rulesStarted = false;
  for (const line of text.slice(0, 512 * 1024).split(/\r?\n/).slice(0, 10_000)) {
    const match = /^\s*([\w-]+)\s*:\s*(.*?)\s*(?:#.*)?$/.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase(), value = match[2].trim();
    if (key === "sitemap" && sitemaps.length < 8) sitemaps.push(value);
    if (key === "user-agent") {
      if (rulesStarted) { groups.push(group); group = { agents: [], rules: [], inputSignals: [] }; rulesStarted = false; }
      group.agents.push(value.toLowerCase());
    } else if (key === "allow" || key === "disallow") {
      rulesStarted = true;
      if (value.startsWith("/") && value.length < 2048 && group.rules.length < 1000) group.rules.push({ allow: key === "allow", path: value });
    } else if (key === "content-signal") {
      // A signal-only group is still complete before the next User-agent line.
      if (group.agents.length) rulesStarted = true;
      const pathSignal = value.startsWith("/") ? /^(\S+)\s+(.+)$/.exec(value) : undefined;
      if (value.startsWith("/") && (!pathSignal || pathSignal[1].length >= 2048)) continue;
      const target = group.agents.length ? group.inputSignals : globalInputSignals;
      for (const entry of (pathSignal?.[2] ?? value).split(",")) {
        const signal = /^\s*ai-input\s*=\s*(yes|no)\s*$/i.exec(entry);
        if (signal && target.length < 1000) target.push({ allow: signal[1].toLowerCase() === "yes", path: pathSignal?.[1] });
      }
    }
  }
  groups.push(group);
  const specific = groups.filter(g => g.agents.includes("opencursor-docs"));
  const applicable = specific.length ? specific : groups.filter(g => g.agents.includes("*"));
  const rules = applicable.flatMap(g => g.rules);
  const inputSignals = [...globalInputSignals, ...applicable.flatMap(g => g.inputSignals)];
  const normalize = (value: string) => encodeURI(value).replace(/%25([\da-f]{2})/gi, "%$1").replace(/%([\da-f]{2})/gi, (raw, hex) => {
    const char = String.fromCharCode(parseInt(hex, 16));
    return /[\w.~\-]/.test(char) ? char : raw.toUpperCase();
  });
  // Iterative glob matching avoids regex backtracking on remote patterns.
  const matches = (pattern: string, value: string) => {
    const exact = pattern.endsWith("$");
    const parts = (exact ? pattern.slice(0, -1) : pattern).split("*");
    let offset = 0;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;
      const at = i === 0 ? (value.startsWith(part) ? 0 : -1) : value.indexOf(part, offset);
      if (at < 0) return false;
      if (exact && i === parts.length - 1 && !value.endsWith(part)) return false;
      offset = at + part.length;
    }
    return !exact || pattern.endsWith("*$") || value.length === offset || parts.length > 1 && value.endsWith(parts[parts.length - 1]);
  };
  const inputAllowed = (pathname?: string): boolean | undefined => {
    let best = -1;
    let allow: boolean | undefined;
    for (const signal of inputSignals) {
      const pattern = signal.path === undefined ? undefined : normalize(signal.path);
      if (pattern !== undefined && (pathname === undefined || !matches(pattern, pathname))) continue;
      // Explicit path exceptions override the unscoped default. At equal
      // specificity, a denial wins so duplicate groups cannot erase it.
      const specificity = pattern === undefined ? 0 : pattern.replace(/[\*$]/g, "").length;
      if (specificity > best || specificity === best && !signal.allow) { best = specificity; allow = signal.allow; }
    }
    return allow;
  };
  return { sitemaps, aiInputAllowed: inputAllowed(), aiInputAllowedFor(url) {
    const target = new URL(url);
    return inputAllowed(normalize(target.pathname + target.search));
  }, allows(url) {
    const target = new URL(url), pathname = normalize(target.pathname + target.search);
    let best = -1, allow = true;
    for (const rule of rules) {
      const pattern = normalize(rule.path), specificity = pattern.replace(/[\*$]/g, "").length;
      if (matches(pattern, pathname) && (specificity > best || specificity === best && rule.allow)) { best = specificity; allow = rule.allow; }
    }
    return allow;
  } };
}
