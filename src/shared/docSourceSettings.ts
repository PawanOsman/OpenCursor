/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { DocSource } from "../agent/docsIndex";

export type DocSourceSettings = Pick<DocSource, "name" | "url" | "maxPages" | "scope" | "scopePath" | "focus" | "useAi" | "excludePaths">;

/** Validate webview input before it reaches storage, network discovery, or planning. */
export function normalizeDocSourceSettings(input: Partial<Record<keyof DocSourceSettings, unknown>>): DocSourceSettings {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 160) : "";
  if (!name) throw new Error("Enter a name for the documentation source.");
  let url: URL;
  try { url = new URL(typeof input.url === "string" && input.url.length <= 8192 ? input.url.trim() : ""); }
  catch { throw new Error("Enter a valid HTTP or HTTPS documentation URL."); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new Error("Use an HTTP or HTTPS URL without embedded credentials.");
  }
  url.hash = "";
  if (input.scope !== undefined && input.scope !== "page" && input.scope !== "section") throw new Error("Choose a documentation section or a single page.");
  const scope = input.scope === "page" ? "page" : "section";
  if (input.scopePath !== undefined && typeof input.scopePath !== "string") throw new Error("The section path must be a URL path prefix.");
  const prefix = (value: unknown) => {
    if (typeof value !== "string") throw new Error("Path limits must be URL path prefixes such as /docs/api.");
    const result = value.trim();
    if (!result.startsWith("/") || result.startsWith("//") || /[?#\\\s]/.test(result)) {
      throw new Error("Path limits must be URL path prefixes such as /docs/api, without a domain, query, or fragment.");
    }
    const normalized = new URL(result, url.origin).pathname;
    return normalized === "/" ? normalized : normalized.replace(/\/+$/, "");
  };
  const scopePath = scope === "section" && typeof input.scopePath === "string" && input.scopePath.trim() ? prefix(input.scopePath) : undefined;
  const rawExcludes = input.excludePaths === undefined ? [] : input.excludePaths;
  if (!Array.isArray(rawExcludes) || rawExcludes.length > 100) throw new Error("Enter up to 100 excluded path prefixes.");
  const excludePaths = [...new Set(rawExcludes.map(prefix))];
  if (input.useAi !== undefined && typeof input.useAi !== "boolean") throw new Error("The AI-assisted planning setting must be on or off.");
  const parsedLimit = Number(input.maxPages ?? 200);
  const maxPages = Number.isFinite(parsedLimit) ? Math.min(1000, Math.max(1, Math.floor(parsedLimit))) : 200;
  const focus = typeof input.focus === "string" ? input.focus.trim().slice(0, 2000) : "";
  return { name, url: url.toString(), scope, scopePath, focus: focus || undefined, useAi: input.useAi !== false, excludePaths, maxPages };
}

export function docIndexSettingsChanged(before: DocSourceSettings, after: DocSourceSettings): boolean {
  const { name: _beforeName, ...left } = normalizeDocSourceSettings(before);
  const { name: _afterName, ...right } = normalizeDocSourceSettings(after);
  return JSON.stringify(left) !== JSON.stringify(right);
}
