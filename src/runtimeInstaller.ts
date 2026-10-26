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
import * as crypto from "crypto";
import { gunzip } from "zlib";
import { promisify } from "util";
import { runtimeManifest } from "./runtimeManifest";

export interface RuntimePackage {
  name: string; version: string; integrity: string; tarball: string;
  os?: readonly string[]; cpu?: readonly string[]; libc?: readonly string[];
  dependencies: Readonly<Record<string, string>>; optionalDependencies: Readonly<Record<string, string>>;
}
export interface RuntimeManifest { version: number; roots: Readonly<Record<string, string>>; packages: Readonly<Record<string, RuntimePackage>> }
export interface RuntimePlatform { os: string; arch: string; libc?: string }
export function runtimePlatform(): RuntimePlatform {
  return { os: process.platform, arch: process.arch,
    ...(process.platform === "linux" ? { libc: (process.report?.getReport() as any)?.header?.glibcVersionRuntime ? "glibc" : "musl" } : {}) };
}
function supports(pkg: RuntimePackage, platform: RuntimePlatform): boolean {
  const accepts = (values: readonly string[] | undefined, value?: string) => !values || values.includes(value ?? "");
  return accepts(pkg.os, platform.os) && accepts(pkg.cpu, platform.arch) && accepts(pkg.libc, platform.libc);
}
export function runtimePackages(name: string, manifest: RuntimeManifest = runtimeManifest, platform = runtimePlatform()): Map<string, RuntimePackage> {
  if (!["linux", "darwin", "win32"].includes(platform.os) || !["x64", "arm64"].includes(platform.arch)) {
    throw new Error(`Unsupported local runtime platform: ${platform.os}-${platform.arch}`);
  }
  const root = manifest.roots[name]; if (!root) throw new Error(`Unpinned runtime dependency: ${name}`);
  const selected = new Map<string, RuntimePackage>();
  const visit = (id: string) => {
    if (selected.has(id)) return;
    const pkg = manifest.packages[id];
    if (!pkg || !supports(pkg, platform)) throw new Error(`Runtime package ${id} does not support ${platform.os}-${platform.arch}`);
    selected.set(id, pkg);
    for (const dep of Object.values(pkg.dependencies)) visit(dep);
    for (const dep of Object.values(pkg.optionalDependencies)) {
      if (!manifest.packages[dep]) throw new Error(`Missing pinned optional dependency ${dep}`);
      if (supports(manifest.packages[dep], platform)) visit(dep);
    }
    if (pkg.name === "@napi-rs/canvas" && !Object.values(pkg.optionalDependencies).some(dep => selected.has(dep))) {
      throw new Error(`PDF runtime has no native canvas for ${platform.os}-${platform.arch}`);
    }
  };
  visit(root); return selected;
}
const unzip = promisify(gunzip);

/** Extract regular npm package files, rejecting traversal and truncated archives. */
export async function extractRuntimeTar(tar: Buffer, destination: string, filter?: (name: string) => boolean): Promise<void> {
  let offset = 0; let longName: string | undefined;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (!header.some(n => n !== 0)) break;
    const read = (a: number, b: number) => header.toString("utf8", a, b).replace(/\0.*$/s, "");
    let name = read(0, 100); const prefix = read(345, 500); if (prefix) name = `${prefix}/${name}`;
    const size = parseInt(read(124, 136).trim(), 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) throw new Error("Truncated runtime archive");
    const body = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    const type = header[156];
    if (type === 76) { longName = body.toString("utf8").replace(/\0.*$/s, ""); continue; }
    if (longName) { name = longName; longName = undefined; }
    if (type !== 48 && type !== 0) continue;
    name = name.replace(/^[^/]+\//, "");
    const target = path.resolve(destination, name); const relative = path.relative(destination, target);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Invalid runtime archive path");
    if (filter && !filter(name)) continue;
    await fs.mkdir(path.dirname(target), { recursive: true });
    const mode = parseInt(read(100, 108).trim(), 8) || 0o644;
    await fs.writeFile(target, body, { mode: mode & 0o111 ? 0o755 : 0o644 });
  }
}
interface PublishLockOwner { pid: number; token: string }

/** Serialize final publication across extension hosts, without holding the lock during downloads. */
export async function withRuntimePublishLock<T>(destination: string, operation: () => Promise<T>, timeoutMs = 30_000): Promise<T> {
  const directory = `${destination}.publish-lock`;
  const owner: PublishLockOwner = { pid: process.pid, token: crypto.randomUUID() };
  const ownerFile = `owner-${owner.token}.json`;
  const deadline = Date.now() + Math.max(1, Math.min(timeoutMs, 30_000));
  const dead = (pid: number): boolean => {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    try { process.kill(pid, 0); return false; }
    catch (error: any) { return error.code === "ESRCH"; }
  };
  for (;;) {
    try {
      await fs.mkdir(directory);
      try { await fs.writeFile(path.join(directory, ownerFile), JSON.stringify(owner), { flag: "wx" }); }
      catch (error) { await fs.rm(directory, { recursive: true, force: true }); throw error; }
      break;
    } catch (error: any) {
      if (error.code !== "EEXIST") throw error;
    }
    // A new owner may still be writing its metadata. Missing/partial metadata
    // never proves that an owner is dead: wait, then fail safely at the deadline.
    const entries = await fs.readdir(directory).catch(() => [] as string[]);
    if (entries.length === 1 && /^owner-[\w-]+\.json$/.test(entries[0])) {
      const file = path.join(directory, entries[0]);
      let previous: PublishLockOwner | undefined;
      try { previous = JSON.parse(await fs.readFile(file, "utf8")); } catch { /* writing / released */ }
      if (previous && entries[0] === `owner-${previous.token}.json` && dead(previous.pid)) {
        // Only the contender that removes this unique owner's file may remove
        // the directory. Another contender cannot later remove a fresh lock.
        const claimed = await fs.unlink(file).then(() => true, () => false);
        if (claimed) {
          await fs.rmdir(directory).catch((error: any) => { if (error.code !== "ENOENT") throw error; });
          continue;
        }
      }
    }
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for runtime publication lock: ${directory}`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(50, Math.max(1, deadline - Date.now()))));
  }
  try { return await operation(); }
  finally {
    const removed = await fs.unlink(path.join(directory, ownerFile)).then(() => true, () => false);
    if (removed) await fs.rmdir(directory).catch((error: any) => { if (error.code !== "ENOENT") throw error; });
  }
}

/** Stamp folder name of an installed graph for one runtime root. */
function runtimeStamp(name: string, manifest: RuntimeManifest, platform: RuntimePlatform): string {
  const selected = runtimePackages(name, manifest, platform);
  return crypto.createHash("sha256").update(JSON.stringify([manifest.version, name, platform, [...selected]])).digest("hex");
}

/**
 * Remove leftovers of earlier publications: `<stamp>.incomplete-*` folders and
 * stamp folders no current runtime root uses. Never touches `keep`, publish
 * locks, in-flight installs, or symbolic links (links are only unlinked, never
 * followed), and leaves stamps younger than `minAgeMs` for other windows that
 * may still run an older extension version.
 */
export async function collectRuntimeGarbage(storage: string, keep: ReadonlySet<string>, minAgeMs = 24 * 60 * 60_000): Promise<string[]> {
  const removed: string[] = [];
  const entries = await fs.readdir(storage, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const incomplete = /^[a-f\d]{64}\.incomplete-[\w-]+$/.test(entry.name);
    const staleStamp = /^[a-f\d]{64}$/.test(entry.name) && !keep.has(entry.name);
    if (!incomplete && !staleStamp) continue;
    const target = path.join(storage, entry.name);
    if (inFlight.has(target) || inFlight.has(path.join(storage, entry.name.slice(0, 64)))) continue;
    try {
      const info = await fs.lstat(target);
      if (info.isSymbolicLink()) continue;
      if (!info.isDirectory()) continue;
      if (staleStamp && Date.now() - info.mtimeMs < minAgeMs) continue;
      if (staleStamp && await fs.access(`${target}.publish-lock`).then(() => true, () => false)) continue;
      // fs.rm removes links inside the tree without following them.
      await fs.rm(target, { recursive: true, force: true });
      removed.push(entry.name);
    } catch { /* in use (EBUSY on Windows) or already gone: retry on a later publish */ }
  }
  return removed;
}

const inFlight = new Map<string, Promise<string>>();
export async function installRuntime(name: string, storage: string, options: {
  manifest?: RuntimeManifest; platform?: RuntimePlatform; fetch?: typeof fetch; report?: (message: string) => void;
} = {}): Promise<string> {
  const manifest: RuntimeManifest = options.manifest ?? runtimeManifest; const platform = options.platform ?? runtimePlatform();
  const selected = runtimePackages(name, manifest, platform);
  const stamp = runtimeStamp(name, manifest, platform);
  const destination = path.join(storage, stamp);
  const pending = inFlight.get(destination); if (pending) return pending;
  const work = (async () => {
    const packageDir = (base: string, id: string) => path.join(base, "packages", crypto.createHash("sha256").update(id).digest("hex").slice(0, 24), "node_modules", manifest.packages[id].name);
    const rootPath = packageDir(destination, manifest.roots[name]);
    const ready = async () => {
      try {
        if (await fs.readFile(path.join(destination, ".complete"), "utf8") !== stamp) return false;
        for (const id of selected.keys()) await fs.access(path.join(packageDir(destination, id), "package.json"));
        return true;
      } catch { return false; }
    };
    if (await ready()) return rootPath;
    await fs.mkdir(storage, { recursive: true });
    const stage = await fs.mkdtemp(path.join(storage, ".install-"));
    try {
      let done = 0;
      for (const [id, pkg] of selected) {
        options.report?.(`${pkg.name}@${pkg.version} (${++done}/${selected.size})`);
        const response = await (options.fetch ?? fetch)(pkg.tarball, { signal: AbortSignal.timeout(120_000) });
        if (!response.ok) throw new Error(`Download ${id}: HTTP ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        const expected = pkg.integrity.split(/\s+/).find(value => value.startsWith("sha512-"));
        if (!expected || `sha512-${crypto.createHash("sha512").update(bytes).digest("base64")}` !== expected) throw new Error(`Integrity mismatch for ${id}`);
        const keep = `/${platform.os}/${platform.arch}/`;
        await extractRuntimeTar(await unzip(bytes), packageDir(stage, id), pkg.name === "onnxruntime-node"
          ? file => !/^bin\/napi-v\d+\//.test(file) || file.includes(keep) : undefined);
        const installed = JSON.parse(await fs.readFile(path.join(packageDir(stage, id), "package.json"), "utf8"));
        if (installed.name !== pkg.name || installed.version !== pkg.version) throw new Error(`Unexpected package identity for ${id}`);
      }
      // Preserve multiple dependency versions in an isolated graph, like pnpm.
      for (const [id, pkg] of selected) {
        const modules = path.resolve(packageDir(stage, id), pkg.name.startsWith("@") ? "../.." : "..");
        for (const [depName, dep] of Object.entries({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
          if (!selected.has(dep)) continue;
          const link = path.join(modules, depName); const target = packageDir(stage, dep);
          await fs.mkdir(path.dirname(link), { recursive: true });
          // Relative directory links survive the atomic rename on POSIX. Windows
          // junctions use the final absolute destination, which exists on publish.
          await fs.symlink(process.platform === "win32" ? target.replace(stage, destination) : path.relative(path.dirname(link), target), link, process.platform === "win32" ? "junction" : "dir");
        }
      }
      await fs.writeFile(path.join(stage, ".complete"), stamp);
      return await withRuntimePublishLock(destination, async () => {
        // Recheck under the cross-process lock; a different window may have
        // published a complete graph while this one was downloading.
        if (await ready()) return rootPath;
        await fs.rename(destination, `${destination}.incomplete-${crypto.randomUUID()}`).catch((error: any) => { if (error.code !== "ENOENT") throw error; });
        await fs.rename(stage, destination);
        return rootPath;
      }).then(async (published) => {
        // Keep every stamp the current manifest can use on this platform.
        const keep = new Set<string>([stamp]);
        for (const root of Object.keys(manifest.roots)) {
          try { keep.add(runtimeStamp(root, manifest, platform)); } catch { /* unsupported on this platform */ }
        }
        await collectRuntimeGarbage(storage, keep).catch(() => {});
        return published;
      });
    } finally { await fs.rm(stage, { recursive: true, force: true }); }
  })();
  inFlight.set(destination, work);
  try { return await work; } finally { inFlight.delete(destination); }
}
