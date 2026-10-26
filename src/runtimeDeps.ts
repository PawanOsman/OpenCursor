/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as vscode from "vscode";
import * as fs from "fs/promises";
import { existsSync, readFileSync, realpathSync } from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { installRuntime } from "./runtimeInstaller";
import { runtimeManifest } from "./runtimeManifest";

let rootDir: string | undefined;
const imports = new Map<string, Promise<any>>();

export function initRuntimeDeps(storageDir: string): void {
  rootDir = path.join(storageDir, "runtime-deps-v2");
  imports.clear();
}

/** Prefer the Node ESM condition without flattening a package's native layout. */
function entryOf(pkg: any): string {
  const pick = (value: any): string | undefined => {
    if (typeof value === "string") return value;
    if (value && typeof value === "object") return pick(value.node ?? value.import ?? value.default ?? value.require);
    return undefined;
  };
  return pick(pkg.exports?.["."] ?? pkg.exports) || pkg.module || pkg.main || "index.js";
}

/** This extension's own directory (never a parent folder such as ~/). */
function extensionRoot(): string | undefined {
  try {
    const fromHost = vscode.extensions?.getExtension?.("pkrd.ocursor")?.extensionPath;
    if (fromHost) return fromHost;
  } catch { /* outside the extension host */ }
  // Bundled as dist/extension.js; sources live under src/.
  for (let dir = __dirname, i = 0; i < 4; i++, dir = path.dirname(dir)) {
    try {
      if (JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).name === "ocursor") return dir;
    } catch { /* keep looking */ }
  }
  return undefined;
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Development checkout: the package-manager-installed graph in the extension's
 * own node_modules. Node's bare-specifier lookup would also walk parent
 * directories (e.g. ~/node_modules) from a packaged VSIX, so resolve the
 * package explicitly and require its real path to stay inside the extension.
 */
export function localDevPackageDir(name: string, root = extensionRoot()): string | undefined {
  if (!root) return undefined;
  const candidate = path.join(root, "node_modules", ...name.split("/"));
  if (!existsSync(path.join(candidate, "package.json"))) return undefined;
  try {
    const realRoot = realpathSync(root);
    const realPackage = realpathSync(candidate);
    return isInside(realPackage, realRoot) ? realPackage : undefined;
  } catch {
    return undefined;
  }
}

async function importPackageDir(directory: string): Promise<any> {
  const pkg = JSON.parse(await fs.readFile(path.join(directory, "package.json"), "utf8"));
  return await import(pathToFileURL(path.join(directory, entryOf(pkg))).href);
}

/** Install only the requested feature's pinned graph, and import its original files. */
export function importRuntimeDep<T = any>(name: string): Promise<T> {
  if (!(name in runtimeManifest.roots)) return Promise.reject(new Error(`Unpinned runtime dependency: ${name}`));
  let pending = imports.get(name);
  if (!pending) {
    pending = (async () => {
      const local = localDevPackageDir(name);
      if (local) {
        try { return await importPackageDir(local); } catch (error: any) {
          if (!rootDir) throw error;
        }
      } else if (!rootDir) throw new Error(`Runtime dependency ${name} is not installed`);
      const directory = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "OpenCursor: installing feature runtime" },
        progress => installRuntime(name, rootDir!, { report: message => progress.report({ message }) }),
      );
      return await importPackageDir(directory);
    })();
    imports.set(name, pending);
    // A network or initialization failure must be retryable on the next call.
    void pending.catch(() => { imports.delete(name); });
  }
  return pending as Promise<T>;
}

export async function ensureRuntimeDeps(): Promise<boolean> {
  try { await importRuntimeDep("@huggingface/transformers"); return true; }
  catch (error: any) {
    vscode.window.showErrorMessage(`OpenCursor: failed to initialize local runtime: ${error?.message ?? error}`);
    return false;
  }
}
