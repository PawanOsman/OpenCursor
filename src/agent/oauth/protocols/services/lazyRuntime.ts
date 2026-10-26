/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// Lazy loader for heavy optional native runtime deps (wreq-js). They are not
// bundled, so the extension stays small and platform-neutral; on first use the
// package is installed into ~/.opencursor/runtime and imported from there.
// Resolution order: extension node_modules → runtime dir → npm install.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const LAZY_DEP_VERSIONS: Record<string, string> = {
  "wreq-js": "^3.2.0",
};

function getRuntimeDir(): string {
  return path.join(os.homedir(), ".opencursor", "runtime");
}

function isModuleMissing(error: unknown): boolean {
  const code = String((error as { code?: unknown })?.code || "");
  return code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND";
}

function npmInstall(pkg: string, version: string): Promise<{ ok: boolean; stderr: string }> {
  const cwd = getRuntimeDir();
  fs.mkdirSync(cwd, { recursive: true });
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const args = ["install", "--no-audit", "--no-fund", "--prefer-online", `${pkg}@${version}`];
  return new Promise((resolve) => {
    const child = spawn(npm, args, { cwd, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => resolve({ ok: false, stderr: String(error.message || error) }));
    child.on("close", (status) => resolve({ ok: status === 0, stderr }));
  });
}

// The host bundle is CJS, where esbuild rewrites import() to require(), which
// cannot load file:// URLs or ESM-only packages. Keep a native dynamic import.
const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<Record<string, unknown>>;

async function load(pkg: string): Promise<Record<string, unknown>> {
  try {
    return await dynamicImport(pkg);
  } catch (error) {
    if (!isModuleMissing(error)) throw error;
  }
  const dir = getRuntimeDir();
  const runtimeRequire = createRequire(path.join(dir, "package.json"));
  try {
    return await dynamicImport(pathToFileURL(runtimeRequire.resolve(pkg)).href);
  } catch (error) {
    if (!isModuleMissing(error)) throw error;
  }
  const version = LAZY_DEP_VERSIONS[pkg] || "latest";
  const res = await npmInstall(pkg, version);
  if (!res.ok) {
    const reason = (res.stderr.match(/npm ERR! ?(.+)/) || [])[1] || res.stderr.split("\n").filter(Boolean).pop() || "unknown npm error";
    throw new Error(
      `${pkg} is missing and the on-demand install failed (${String(reason).slice(0, 160)}) — ` +
      `install it manually: cd "${dir}" && npm install ${pkg}@${version}`
    );
  }
  return dynamicImport(pathToFileURL(createRequire(path.join(dir, "package.json")).resolve(pkg)).href);
}

const inflight = new Map<string, Promise<Record<string, unknown>>>();

export function loadRuntimeDep(pkg: string): Promise<Record<string, unknown>> {
  let pending = inflight.get(pkg);
  if (!pending) {
    pending = load(pkg).finally(() => inflight.delete(pkg));
    inflight.set(pkg, pending);
  }
  return pending;
}
