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
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { isWithinDirectory, parseRuleFrontmatter } from "../context/scopedInstructions";
import type { McpServerConfig } from "./mcpClient";

export interface LocalPluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  skills: string[];
  mcpServers: Record<string, Omit<McpServerConfig, "name" | "enabled">>;
}
export interface InstalledPlugin {
  id: string;
  manifest: LocalPluginManifest;
  directory: string;
  source: string;
  installedAt: number;
  fingerprint: string;
  enabled: boolean;
}

const validId = (id: unknown): id is string => typeof id === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(id) && id !== "." && id !== "..";
export const defaultPluginDirectory = () => path.join(homedir(), ".opencursor", "plugins");

function relativePath(root: string, input: unknown): string {
  if (typeof input !== "string" || !input.trim() || path.isAbsolute(input)) throw new Error("Plugin paths must be relative to the plugin directory.");
  const destination = path.resolve(root, input);
  if (!isWithinDirectory(root, destination)) throw new Error("Plugin path escapes its package directory.");
  return path.relative(root, destination);
}

async function smallJson(file: string, maxBytes = 256 * 1024): Promise<any> {
  if ((await fs.stat(file)).size > maxBytes) throw new Error("Plugin metadata exceeds its size limit.");
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function manifestAt(source: string): Promise<LocalPluginManifest> {
  source = await fs.realpath(source);
  let raw: any;
  for (const relative of [".opencursor-plugin/plugin.json", ".codex-plugin/plugin.json", "plugin.json"]) {
    try { raw = await smallJson(path.join(source, relative)); break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  if (!raw || typeof raw !== "object") throw new Error("No plugin manifest found. Add .opencursor-plugin/plugin.json or .codex-plugin/plugin.json.");
  const id = raw.id ?? raw.name;
  if (!validId(id)) throw new Error("Plugin id/name must contain 1–64 lowercase letters, digits, dots, underscores or hyphens.");
  const suppliedSkills = raw.skills === undefined ? ["skills"] : typeof raw.skills === "string" ? [raw.skills] : raw.skills;
  if (!Array.isArray(suppliedSkills) || suppliedSkills.length > 100) throw new Error("Plugin skills must be a relative directory or a list of up to 100 relative directories.");
  const skills: string[] = [];
  for (const entry of suppliedSkills) {
    const relative = relativePath(source, entry);
    try {
      const target = await fs.realpath(path.join(source, relative));
      if (!isWithinDirectory(source, target) || !(await fs.stat(target)).isDirectory()) throw new Error("Skill directories must remain inside the package.");
      skills.push(relative);
    } catch (error) { if (raw.skills !== undefined || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  let mcp: any = raw.mcpServers;
  if (typeof mcp === "string") mcp = await smallJson(path.join(source, relativePath(source, mcp)));
  if (mcp === undefined) { try { mcp = await smallJson(path.join(source, ".mcp.json")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
  mcp = mcp?.mcpServers ?? mcp ?? {};
  if (typeof mcp !== "object" || Array.isArray(mcp) || Object.keys(mcp).length > 50) throw new Error("Plugin mcpServers must be a map of at most 50 servers.");
  const mcpServers: LocalPluginManifest["mcpServers"] = {};
  for (const [name, value] of Object.entries(mcp) as [string, any][]) {
    if (!validId(name) || !value || typeof value !== "object") throw new Error("Invalid plugin MCP server definition.");
    const transport = value.transport ?? (value.url ? "http" : "stdio");
    if (!["stdio", "http", "sse"].includes(transport)) throw new Error(`Unsupported MCP transport for ${name}.`);
    if (transport === "stdio" && (typeof value.command !== "string" || !value.command.trim())) throw new Error(`MCP server ${name} requires a command.`);
    if (transport !== "stdio") {
      const url = new URL(value.url);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error(`MCP server ${name} needs an HTTP(S) URL without embedded credentials.`);
    }
    if (value.args !== undefined && (!Array.isArray(value.args) || !value.args.every((arg: unknown) => typeof arg === "string"))) throw new Error(`MCP args for ${name} must be strings.`);
    for (const field of ["env", "headers"]) if (value[field] !== undefined && (typeof value[field] !== "object" || Array.isArray(value[field]) || !Object.values(value[field]).every((entry) => typeof entry === "string"))) throw new Error(`MCP ${field} for ${name} must contain string values.`);
    mcpServers[name] = { transport, command: value.command, args: value.args, env: value.env, url: value.url, headers: value.headers, oauth: value.oauth };
  }
  return { id, name: typeof raw.displayName === "string" ? raw.displayName.slice(0, 120) : id,
    version: typeof raw.version === "string" ? raw.version.slice(0, 100) : "unversioned",
    description: typeof raw.description === "string" ? raw.description.slice(0, 2000) : "", skills, mcpServers };
}

/** Local package installation copies immutable versions and atomically switches
 * the registry pointer. Failed updates retain the previously installed version. */
export class LocalPluginManager {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(readonly directory = defaultPluginDirectory()) { this.directory = path.resolve(directory); }

  inspect(source: string): Promise<LocalPluginManifest> { return manifestAt(source); }

  private assertOwned(destination: string) {
    const packages = path.join(this.directory, "packages");
    if (path.resolve(destination) === packages || !isWithinDirectory(packages, destination)) throw new Error("Refusing to change a path outside managed plugin packages.");
  }

  private async verifyOwned(destination: string): Promise<void> {
    this.assertOwned(destination);
    // Reject redirected parents before any recursive operation on a managed path.
    const relative = path.relative(this.directory, path.resolve(destination));
    let current = this.directory;
    for (const component of ["", ...relative.split(path.sep)]) {
      current = component ? path.join(current, component) : current;
      try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error("Managed plugin paths may not contain symbolic links."); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") break; throw error; }
    }
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.pending.catch(() => {}).then(work);
    this.pending = next;
    return next;
  }

  async list(): Promise<InstalledPlugin[]> {
    let raw: any;
    try { raw = await smallJson(path.join(this.directory, "registry.json"), 8 * 1024 * 1024); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    if (raw.version !== 1 || !Array.isArray(raw.plugins)) throw new Error("Unsupported or damaged plugin registry; existing packages were preserved.");
    for (const plugin of raw.plugins) {
      if (!validId(plugin.id) || typeof plugin.directory !== "string" || !plugin.manifest) throw new Error("Invalid plugin registry entry.");
      this.assertOwned(plugin.directory);
    }
    return raw.plugins;
  }

  private async save(plugins: InstalledPlugin[]) {
    const json = JSON.stringify({ version: 1, plugins }, null, 2);
    if (Buffer.byteLength(json) > 8 * 1024 * 1024) throw new Error("Plugin registry exceeds 8 MiB; remove unused packages before installing more.");
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(this.directory, `.registry-${randomUUID()}.tmp`);
    try {
      const file = await fs.open(temporary, "wx", 0o600);
      try { await file.writeFile(json); await file.sync(); } finally { await file.close(); }
      await fs.rename(temporary, path.join(this.directory, "registry.json"));
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  }

  async install(source: string): Promise<InstalledPlugin> {
    return this.exclusive(async () => {
      source = await fs.realpath(source);
      if (isWithinDirectory(this.directory, source)) throw new Error("Choose the original plugin source directory, outside the installed plugin store.");
      const manifest = await manifestAt(source);
      const plugins = await this.list();
      const old = plugins.find((entry) => entry.id === manifest.id);
      const destination = path.join(this.directory, "packages", manifest.id, randomUUID());
      await this.verifyOwned(destination);
      const hash = createHash("sha256");
      let fileCount = 0, totalBytes = 0, committed = false;
      const copy = async (relative = "") => {
        const input = path.join(source, relative), output = path.join(destination, relative);
        const info = await fs.lstat(input);
        if (info.isSymbolicLink()) throw new Error(`Plugin packages may not contain symbolic links: ${relative}`);
        if (info.isDirectory()) {
          await fs.mkdir(output, { recursive: true, mode: 0o700 });
          for (const entry of (await fs.readdir(input)).sort()) {
            if ([".git", "node_modules", ".DS_Store"].includes(entry)) continue;
            await copy(path.join(relative, entry));
          }
        } else if (info.isFile()) {
          if (++fileCount > 2000 || (totalBytes += info.size) > 50 * 1024 * 1024) throw new Error("Plugin exceeds the local package limit (2,000 files / 50 MiB).");
          const canonical = await fs.realpath(input);
          if (!isWithinDirectory(source, canonical)) throw new Error("A plugin source changed outside the selected directory.");
          const data = await fs.readFile(canonical);
          hash.update(relative).update("\0").update(data);
          await fs.writeFile(output, data, { flag: "wx", mode: info.mode & 0o111 ? 0o700 : 0o600 });
        } else throw new Error(`Plugin contains an unsupported special file: ${relative}`);
      };
      try {
        await copy();
        // Validate the actual copied manifest, not just the mutable source metadata.
        const copied = await manifestAt(destination);
        if (JSON.stringify(copied) !== JSON.stringify(manifest)) throw new Error("Plugin source changed during installation. Retry from a stable source.");
        const installed: InstalledPlugin = { id: manifest.id, manifest, directory: destination, source, installedAt: Date.now(), fingerprint: hash.digest("hex"), enabled: old?.enabled ?? true };
        await this.save([...plugins.filter((entry) => entry.id !== manifest.id), installed]);
        committed = true;
        return installed;
      } finally { if (!committed) { await this.verifyOwned(destination); await fs.rm(destination, { recursive: true, force: true }).catch(() => {}); } }
    });
  }

  async update(id: string): Promise<InstalledPlugin> {
    const plugin = (await this.list()).find((entry) => entry.id === id);
    if (!plugin) throw new Error("Plugin is no longer installed.");
    const manifest = await this.inspect(plugin.source);
    if (manifest.id !== id) throw new Error("The plugin source changed its identity. Install it separately.");
    return this.install(plugin.source);
  }

  setEnabled(id: string, enabled: boolean): Promise<void> {
    return this.exclusive(async () => {
      const plugins = await this.list();
      if (!plugins.some((entry) => entry.id === id)) throw new Error("Plugin is no longer installed.");
      await this.save(plugins.map((entry) => entry.id === id ? { ...entry, enabled } : entry));
    });
  }

  remove(id: string): Promise<void> {
    return this.exclusive(async () => {
      const plugins = await this.list(), plugin = plugins.find((entry) => entry.id === id);
      if (!plugin) return;
      const allVersions = path.join(this.directory, "packages", id);
      await this.verifyOwned(allVersions);
      await this.save(plugins.filter((entry) => entry.id !== id));
      await fs.rm(allVersions, { recursive: true, force: true });
    });
  }

  prune(id: string): Promise<void> {
    return this.exclusive(async () => {
      const plugin = (await this.list()).find((entry) => entry.id === id);
      if (!plugin) return;
      const base = path.join(this.directory, "packages", id);
      await this.verifyOwned(base);
      for (const entry of await fs.readdir(base, { withFileTypes: true })) {
        const destination = path.join(base, entry.name);
        if (destination === plugin.directory || !entry.isDirectory()) continue;
        await this.verifyOwned(destination);
        await fs.rm(destination, { recursive: true, force: true });
      }
    });
  }

  async mcpServers(): Promise<McpServerConfig[]> {
    return (await this.list()).filter((plugin) => plugin.enabled).flatMap((plugin) => Object.entries(plugin.manifest.mcpServers).map(([name, config]) => {
      const expand = (text: string) => text.replace(/\$\{(?:PLUGIN_ROOT|CLAUDE_PLUGIN_ROOT)\}/g, plugin.directory);
      return { ...config, name: `plugin-${plugin.id}-${name}`, enabled: true,
        command: config.command ? expand(config.command) : undefined, args: config.args?.map(expand),
        env: config.env ? Object.fromEntries(Object.entries(config.env).map(([key, value]) => [key, expand(value)])) : undefined };
    }));
  }
}

export async function installedPluginSkills(directory = defaultPluginDirectory()): Promise<{ name: string; description: string; path: string; pluginId: string }[]> {
  const plugins = await new LocalPluginManager(directory).list();
  const skills: { name: string; description: string; path: string; pluginId: string }[] = [];
  for (const plugin of plugins.filter((entry) => entry.enabled)) {
    const visit = async (relative: string, depth: number) => {
      const dir = path.join(plugin.directory, relative);
      if (!isWithinDirectory(plugin.directory, dir)) return;
      let canonical: string;
      try { canonical = await fs.realpath(dir); } catch { return; }
      if (!isWithinDirectory(plugin.directory, canonical)) return;
      try {
        const file = path.join(canonical, "SKILL.md");
        if ((await fs.stat(file)).size > 256 * 1024) return;
        const raw = await fs.readFile(file, "utf8"), parsed = parseRuleFrontmatter(raw);
        skills.push({ name: `${plugin.id}:${parsed.name || path.basename(canonical)}`, description: parsed.description || parsed.body.slice(0, 200).replace(/\s+/g, " "), path: file, pluginId: plugin.id });
        return;
      } catch { /* A collection directory, or a missing skill file. */ }
      if (depth >= 3) return;
      for (const child of await fs.readdir(canonical, { withFileTypes: true })) if (child.isDirectory() && !child.isSymbolicLink()) await visit(path.join(relative, child.name), depth + 1);
    };
    for (const relative of plugin.manifest.skills) await visit(relative, 0);
  }
  return skills;
}
