/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

/** Icon resolved from the user's active file-icon theme, ready for a webview. */
export type FileIconInfo =
  | { kind: "img"; src: string }
  | { kind: "font"; fontFamily: string; src: string; format: string; char: string; color?: string; size?: string };

let cached: { themeId: string; themeDir: string; theme: any } | null | undefined;

function loadTheme(): { themeDir: string; theme: any } | null {
  const themeId = vscode.workspace.getConfiguration("workbench").get<string>("iconTheme") || "";
  if (cached !== undefined && cached?.themeId === themeId) return cached;
  cached = null;
  if (themeId) {
    for (const ext of vscode.extensions.all) {
      const contrib = ext.packageJSON?.contributes?.iconThemes;
      if (!Array.isArray(contrib)) continue;
      const t = contrib.find((c: any) => c.id === themeId);
      if (!t) continue;
      try {
        const file = path.join(ext.extensionPath, t.path);
        // Theme JSON may contain comments/trailing commas; strip line comments.
        const raw = fs.readFileSync(file, "utf8").replace(/^\s*\/\/.*$/gm, "");
        cached = { themeId, themeDir: path.dirname(file), theme: JSON.parse(raw) };
      } catch {
        cached = null;
      }
      break;
    }
  }
  return cached;
}

/** Drop the theme cache when the icon theme setting changes. */
export function invalidateFileIconCache() {
  cached = undefined;
  resolved.clear();
  dataUris.clear();
  langMaps = undefined;
}

// filename/extension → languageId maps, built from every extension's
// contributes.languages (this is how the IDE itself matches files to icons).
let langMaps: { byFilename: Map<string, string>; byExt: Map<string, string> } | undefined;
function getLangMaps() {
  if (langMaps) return langMaps;
  const byFilename = new Map<string, string>();
  const byExt = new Map<string, string>();
  for (const ext of vscode.extensions.all) {
    const langs = ext.packageJSON?.contributes?.languages;
    if (!Array.isArray(langs)) continue;
    for (const l of langs) {
      if (!l?.id) continue;
      for (const fn of l.filenames || []) if (!byFilename.has(String(fn).toLowerCase())) byFilename.set(String(fn).toLowerCase(), l.id);
      for (const e of l.extensions || []) {
        const key = String(e).toLowerCase().replace(/^\./, "");
        if (!byExt.has(key)) byExt.set(key, l.id);
      }
    }
  }
  langMaps = { byFilename, byExt };
  return langMaps;
}

function languageIdFor(name: string): string | undefined {
  const { byFilename, byExt } = getLangMaps();
  const direct = byFilename.get(name);
  if (direct) return direct;
  // Longest-suffix extension match: "a.d.ts" → "d.ts" → "ts".
  const parts = name.split(".");
  for (let i = 1; i < parts.length; i++) {
    const lang = byExt.get(parts.slice(i).join("."));
    if (lang) return lang;
  }
  return undefined;
}

const dataUris = new Map<string, string | undefined>();
function toDataUri(abs: string): string | undefined {
  if (dataUris.has(abs)) return dataUris.get(abs);
  let uri: string | undefined;
  try {
    const mime: Record<string, string> = {
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".ttf": "font/ttf",
    };
    uri = `data:${mime[path.extname(abs).toLowerCase()] || "application/octet-stream"};base64,${fs.readFileSync(abs).toString("base64")}`;
  } catch {
    uri = undefined;
  }
  dataUris.set(abs, uri);
  return uri;
}

const resolved = new Map<string, FileIconInfo | undefined>();

/** Resolve a filename to its icon in the active file-icon theme. */
export function resolveFileIcon(filename: string): FileIconInfo | undefined {
  const key = filename.toLowerCase();
  if (resolved.has(key)) return resolved.get(key);
  const info = doResolve(key);
  resolved.set(key, info);
  return info;
}

function doResolve(name: string): FileIconInfo | undefined {
  const c = loadTheme();
  if (!c) return undefined;
  const { theme, themeDir } = c;

  // Match VS Code's own precedence within a theme (light/dark variants aside):
  // fileNames → fileExtensions (longest suffix) → languageIds → file default.
  // Theme keys may live at the root or under "light"/"highContrast"; use root (dark default).
  let defId: string | undefined = theme.fileNames?.[name];
  if (!defId) {
    const parts = name.split(".");
    for (let i = 1; i < parts.length && !defId; i++) defId = theme.fileExtensions?.[parts.slice(i).join(".")];
  }
  if (!defId) {
    const lang = languageIdFor(name);
    if (lang) defId = theme.languageIds?.[lang];
  }
  if (!defId) defId = theme.file;
  const def = defId ? theme.iconDefinitions?.[defId] : undefined;
  if (!def) return undefined;

  if (def.iconPath) {
    const src = toDataUri(path.resolve(themeDir, def.iconPath));
    return src ? { kind: "img", src } : undefined;
  }
  if (def.fontCharacter) {
    const fonts: any[] = theme.fonts || [];
    const font = fonts.find((f) => f.id === def.fontId) || fonts[0];
    const srcDef = font?.src?.[0];
    const src = srcDef ? toDataUri(path.resolve(themeDir, srcDef.path)) : undefined;
    if (!src) return undefined;
    return {
      kind: "font",
      fontFamily: font.id,
      src,
      format: srcDef.format || "woff",
      char: def.fontCharacter,
      color: def.fontColor,
      size: def.fontSize || font.size,
    };
  }
  return undefined;
}
