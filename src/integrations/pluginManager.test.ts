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
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it } from "vitest";
import { LocalPluginManager, installedPluginSkills } from "./pluginManager";

let root: string, source: string, manager: LocalPluginManager;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "ocursor-plugin-test-"));
  source = path.join(root, "source");
  await fs.mkdir(path.join(source, ".codex-plugin"), { recursive: true });
  await fs.mkdir(path.join(source, "skills", "review"), { recursive: true });
  await fs.writeFile(path.join(source, "skills", "review", "SKILL.md"), "---\nname: review\ndescription: Inspect a change\n---\nReview source and tests.");
  await fs.writeFile(path.join(source, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "review-tools", version: "1.0.0", skills: "skills", mcpServers: { local: { command: "node", args: ["${PLUGIN_ROOT}/server.js"] } } }));
  await fs.writeFile(path.join(source, "server.js"), "throw new Error('Installation must never execute scripts');");
  manager = new LocalPluginManager(path.join(root, "installed"));
});
afterEach(async () => {
  if (!path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(root).startsWith("ocursor-plugin-test-")) throw new Error("Unexpected test cleanup path");
  await fs.rm(root, { recursive: true, force: true });
});

it("installs immutable local packages, exposes namespaced skills/MCP, and removes only installed copies", async () => {
  const installed = await manager.install(source);
  expect(installed.manifest).toMatchObject({ id: "review-tools", version: "1.0.0" });
  expect(installed.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect((await installedPluginSkills(manager.directory))[0]).toMatchObject({ name: "review-tools:review", description: "Inspect a change", pluginId: "review-tools" });
  expect(await manager.mcpServers()).toEqual([expect.objectContaining({ name: "plugin-review-tools-local", transport: "stdio", command: "node", args: [`${installed.directory}/server.js`] })]);
  await manager.setEnabled(installed.id, false);
  expect(await installedPluginSkills(manager.directory)).toEqual([]);
  expect(await manager.mcpServers()).toEqual([]);
  await manager.remove(installed.id);
  expect(await manager.list()).toEqual([]);
  expect(await fs.readFile(path.join(source, "server.js"), "utf8")).toContain("Installation must never execute scripts");
});

it("updates via an atomic registry pointer and preserves the prior package if validation fails", async () => {
  const first = await manager.install(source);
  const manifest = path.join(source, ".codex-plugin", "plugin.json");
  await fs.writeFile(manifest, JSON.stringify({ name: "review-tools", version: "2.0.0", skills: "skills" }));
  await fs.writeFile(path.join(source, "skills", "review", "SKILL.md"), "---\nname: review\n---\nVersion two instructions");
  const updated = await manager.update(first.id);
  expect(updated.directory).not.toBe(first.directory);
  expect((await manager.list())[0].manifest.version).toBe("2.0.0");
  await manager.prune(first.id);
  await expect(fs.stat(first.directory)).rejects.toMatchObject({ code: "ENOENT" });
  await fs.writeFile(manifest, JSON.stringify({ name: "review-tools", version: "3.0.0", skills: "../../outside" }));
  await expect(manager.update(first.id)).rejects.toThrow("escapes");
  expect((await manager.list())[0].directory).toBe(updated.directory);
  expect(await fs.readFile((await installedPluginSkills(manager.directory))[0].path, "utf8")).toContain("Version two");
});

it("rejects symlink-bearing packages and refuses recursive deletion through redirected parents", async () => {
  const external = path.join(root, "outside");
  await fs.mkdir(path.join(external, "version"), { recursive: true });
  await fs.writeFile(path.join(external, "version", "keep.txt"), "Preserve me");
  await fs.symlink(external, path.join(source, "linked"), process.platform === "win32" ? "junction" : "dir");
  await expect(manager.install(source)).rejects.toThrow("symbolic links");
  expect(await manager.list()).toEqual([]);
  await fs.mkdir(path.join(manager.directory, "packages"), { recursive: true });
  await fs.symlink(external, path.join(manager.directory, "packages", "redirected"), process.platform === "win32" ? "junction" : "dir");
  await fs.writeFile(path.join(manager.directory, "registry.json"), JSON.stringify({ version: 1, plugins: [{ id: "redirected", directory: path.join(manager.directory, "packages", "redirected", "version"), manifest: {} }] }));
  await expect(manager.remove("redirected")).rejects.toThrow("symbolic links");
  expect(await fs.readFile(path.join(external, "version", "keep.txt"), "utf8")).toBe("Preserve me");
});
