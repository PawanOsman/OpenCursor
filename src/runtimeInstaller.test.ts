/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { gzipSync } from "zlib";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import { installRuntime, runtimePackages, extractRuntimeTar, withRuntimePublishLock, collectRuntimeGarbage, type RuntimeManifest } from "./runtimeInstaller";

function tarFile(name: string, content: string): Buffer {
  const bytes = Buffer.from(content), header = Buffer.alloc(512);
  header.write(name); header.write("0000644", 100); header.write(bytes.length.toString(8).padStart(11, "0"), 124); header[156] = 48;
  return Buffer.concat([header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512), Buffer.alloc(1024)]);
}
function fixture(version = "1.0.0") {
  const bytes = gzipSync(tarFile("package/package.json", JSON.stringify({ name: "fixture", version })));
  const id = `fixture@${version}`;
  const manifest: RuntimeManifest = { version: 1, roots: { fixture: id }, packages: { [id]: {
    name: "fixture", version, tarball: "https://fixture.invalid/pkg.tgz", integrity: `sha512-${crypto.createHash("sha512").update(bytes).digest("base64")}`,
    dependencies: {}, optionalDependencies: {},
  } } };
  return { bytes, manifest };
}
describe("pinned runtime installation", () => {
  it("preserves distinct dependency versions and selects only native platform packages", () => {
    const selected = runtimePackages("@huggingface/transformers", undefined, { os: "linux", arch: "x64", libc: "glibc" });
    expect(selected.has("onnxruntime-node@1.24.3")).toBe(true);
    expect(selected.has("onnxruntime-node@1.27.0")).toBe(false);
    expect([...selected.keys()].some(id => id.includes("darwin"))).toBe(false);
    expect(() => runtimePackages("pdf-parse", undefined, { os: "other", arch: "x64" })).toThrow("Unsupported");
  });
  it("retries a failed download and atomically retains the preceding release", async () => {
    const storage = await fs.mkdtemp(path.join(os.tmpdir(), "oc-runtime-"));
    try {
      const old = fixture(); const newer = fixture("2.0.0");
      const request = vi.fn().mockResolvedValueOnce(new Response(old.bytes));
      const prior = await installRuntime("fixture", storage, { manifest: old.manifest, fetch: request });
      request.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
      await expect(installRuntime("fixture", storage, { manifest: newer.manifest, fetch: request })).rejects.toThrow("503");
      expect(JSON.parse(await fs.readFile(path.join(prior, "package.json"), "utf8")).version).toBe("1.0.0");
      expect((await fs.readdir(storage)).filter(name => name.startsWith(".install-"))).toEqual([]);
      request.mockResolvedValueOnce(new Response(newer.bytes));
      const next = await installRuntime("fixture", storage, { manifest: newer.manifest, fetch: request });
      expect(next).not.toBe(prior); expect(request).toHaveBeenCalledTimes(3);
      expect(request.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
      await installRuntime("fixture", storage, { manifest: newer.manifest, fetch: request });
      expect(request).toHaveBeenCalledTimes(3);
    } finally { await fs.rm(storage, { recursive: true, force: true }); }
  });
  it("collects stale incomplete and old stamp folders without following links", async () => {
    const storage = await fs.mkdtemp(path.join(os.tmpdir(), "oc-runtime-gc-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "oc-runtime-gc-outside-"));
    try {
      const current = "a".repeat(64), old = "b".repeat(64), young = "c".repeat(64), linked = "d".repeat(64);
      for (const name of [current, old, young, `${current}.incomplete-1234`]) await fs.mkdir(path.join(storage, name, "inner"), { recursive: true });
      await fs.writeFile(path.join(outside, "keep.txt"), "x");
      // A junction inside a stale folder must be unlinked, never traversed.
      await fs.symlink(outside, path.join(storage, old, "inner", "link"), process.platform === "win32" ? "junction" : "dir");
      await fs.symlink(outside, path.join(storage, linked), process.platform === "win32" ? "junction" : "dir");
      const past = new Date(Date.now() - 2 * 86_400_000);
      for (const name of [current, old]) await fs.utimes(path.join(storage, name), past, past);
      const removed = await collectRuntimeGarbage(storage, new Set([current]));
      expect(removed.sort()).toEqual([`${current}.incomplete-1234`, old].sort());
      expect((await fs.readdir(storage)).sort()).toEqual([current, young, linked].sort());
      expect(await fs.readFile(path.join(outside, "keep.txt"), "utf8")).toBe("x");
    } finally {
      await fs.rm(storage, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
  it("rejects a corrupt tarball before publishing an install", async () => {
    const storage = await fs.mkdtemp(path.join(os.tmpdir(), "oc-runtime-"));
    try {
      await expect(installRuntime("fixture", storage, { manifest: fixture().manifest, fetch: vi.fn(async () => new Response("corrupt")) })).rejects.toThrow("Integrity mismatch");
      expect(await fs.readdir(storage)).toEqual([]);
    } finally { await fs.rm(storage, { recursive: true, force: true }); }
  });
  it("rejects path traversal in archives", async () => {
    const storage = await fs.mkdtemp(path.join(os.tmpdir(), "oc-runtime-"));
    try { await expect(extractRuntimeTar(tarFile("package/../outside", "x"), storage)).rejects.toThrow("archive path"); }
    finally { await fs.rm(storage, { recursive: true, force: true }); }
  });
});


describe("cross-process runtime publication", () => {
  function childRun(script: string, args: string[] = []) {
    const child = spawn(process.execPath, ["-e", script, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (data) => { stderr += data; });
    return { pid: child.pid!, done: new Promise<void>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(stderr || `Child exited ${code}`)));
    }) };
  }

  it("serializes independent Node processes sharing one publication destination", async () => {
    const storage = await fs.mkdtemp(path.join(os.tmpdir(), "oc-runtime-lock-"));
    try {
      const bundle = path.join(storage, "installer.cjs");
      await build({ entryPoints: [path.resolve("src/runtimeInstaller.ts")], bundle: true, platform: "node", format: "cjs", outfile: bundle, logLevel: "silent" });
      const script = String.raw`
        const fs = require('node:fs/promises');
        const {withRuntimePublishLock} = require(process.argv[1]);
        const destination = process.argv[2];
        withRuntimePublishLock(destination, async () => {
          const guard = await fs.open(destination + '.critical', 'wx');
          try {
            await fs.appendFile(destination + '.completed', String(process.pid) + '\n');
            await new Promise(resolve => setTimeout(resolve, 50));
          } finally { await guard.close(); await fs.unlink(destination + '.critical'); }
        }).catch(error => { console.error(error); process.exitCode = 1; });
      `;
      const destination = path.join(storage, "release");
      await Promise.all(Array.from({ length: 4 }, () => childRun(script, [bundle, destination]).done));
      expect((await fs.readFile(destination + ".completed", "utf8")).trim().split("\n")).toHaveLength(4);
      await expect(fs.access(destination + ".publish-lock")).rejects.toThrow();
    } finally { await fs.rm(storage, { recursive: true, force: true }); }
  }, 15000);

  it("reclaims a lock whose recorded owner process has exited", async () => {
    const storage = await fs.mkdtemp(path.join(os.tmpdir(), "oc-runtime-stale-"));
    try {
      const child = childRun(""); await child.done;
      const destination = path.join(storage, "release"), token = crypto.randomUUID();
      await fs.mkdir(destination + ".publish-lock");
      await fs.writeFile(path.join(destination + ".publish-lock", `owner-${token}.json`), JSON.stringify({ pid: child.pid, token }));
      expect(await withRuntimePublishLock(destination, async () => "recovered", 1000)).toBe("recovered");
      await expect(fs.access(destination + ".publish-lock")).rejects.toThrow();
    } finally { await fs.rm(storage, { recursive: true, force: true }); }
  });

  it("does not steal a lock while another owner is writing metadata", async () => {
    const storage = await fs.mkdtemp(path.join(os.tmpdir(), "oc-runtime-starting-"));
    try {
      const destination = path.join(storage, "release");
      await fs.mkdir(destination + ".publish-lock");
      const operation = vi.fn();
      await expect(withRuntimePublishLock(destination, operation, 30)).rejects.toThrow("Timed out");
      expect(operation).not.toHaveBeenCalled();
      expect(await fs.readdir(destination + ".publish-lock")).toEqual([]);
    } finally { await fs.rm(storage, { recursive: true, force: true }); }
  });

  it("releases its own lock when publication fails", async () => {
    const storage = await fs.mkdtemp(path.join(os.tmpdir(), "oc-runtime-release-"));
    try {
      const destination = path.join(storage, "release");
      await expect(withRuntimePublishLock(destination, async () => { throw new Error("failed"); })).rejects.toThrow("failed");
      expect(await withRuntimePublishLock(destination, async () => "retry")).toBe("retry");
    } finally { await fs.rm(storage, { recursive: true, force: true }); }
  });
});
