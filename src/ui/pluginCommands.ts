/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as vscode from "vscode";
import { LocalPluginManager, type InstalledPlugin } from "../integrations/pluginManager";
import { mcpManager } from "../integrations/mcpClient";
import type { FeatureStore } from "../stores/featureStore";
import { logError } from "../logging";

/** Skills are discovered from the same registry; MCP dependencies are reconciled
 * with settings, preserving every user-managed server. Installation never runs
 * arbitrary package install scripts or downloads dependencies. */
export async function registerPluginManagement(context: vscode.ExtensionContext, features: FeatureStore): Promise<void> {
  const manager = new LocalPluginManager();
  const key = "ocursor.pluginMcpNames.v1";
  const reconcile = async () => {
    const previous = new Set(context.globalState.get<string[]>(key, []));
    const configured = features.get().mcpServers;
    const pluginServers = await manager.mcpServers();
    const owned = new Set(pluginServers.map((server) => server.name));
    const collisions = configured.filter((server) => owned.has(server.name) && !previous.has(server.name));
    if (collisions.length) throw new Error(`Plugin MCP names conflict with existing servers: ${collisions.map((server) => server.name).join(", ")}. Rename the existing servers first.`);
    await features.set({ mcpServers: [...configured.filter((server) => !previous.has(server.name)), ...pluginServers] });
    await context.globalState.update(key, [...owned]);
    await mcpManager.sync(features.get().mcpServers);
    features.notifyChanged();
  };

  const preview = async (source: string, update = false): Promise<InstalledPlugin | undefined> => {
    const manifest = await manager.inspect(source);
    const result = await vscode.window.showInformationMessage(`${update ? "Update" : "Install"} ${manifest.name} (${manifest.version})?`, {
      modal: true,
      detail: `${manifest.description}\n\nSource: ${source}\nSkill directories: ${manifest.skills.length}\nMCP servers: ${Object.keys(manifest.mcpServers).join(", ") || "None"}\n\nEnabled MCP servers may launch their configured local commands or connect to their configured URLs.`,
    }, update ? "Update plugin" : "Install plugin");
    if (!result) return;
    const plugin = await manager.install(source);
    await reconcile();
    await manager.prune(plugin.id);
    return plugin;
  };

  context.subscriptions.push(vscode.commands.registerCommand("ocursor.managePlugins", async () => {
    try {
      const installed = await manager.list();
      const chosen = await vscode.window.showQuickPick([
        { label: "$(add) Install a local plugin…", description: "Skill and MCP packages", id: "" },
        ...installed.map((plugin) => ({ label: `${plugin.enabled ? "$(extensions)" : "$(circle-slash)"} ${plugin.manifest.name}`, description: `${plugin.manifest.version}${plugin.enabled ? "" : " · disabled"}`, detail: plugin.manifest.description, id: plugin.id })),
      ], { placeHolder: "Manage OpenCursor plugins" });
      if (!chosen) return;
      if (!chosen.id) {
        const directories = await vscode.window.showOpenDialog({ title: "Select a plugin source folder", canSelectFiles: false, canSelectFolders: true, canSelectMany: false });
        if (!directories?.[0]) return;
        const plugin = await preview(directories[0].fsPath);
        if (plugin) vscode.window.showInformationMessage(`Installed ${plugin.manifest.name}. Its skills are available to new agent turns.`);
        return;
      }
      const plugin = installed.find((entry) => entry.id === chosen.id)!;
      const action = await vscode.window.showQuickPick([
        { label: "Open installed package", id: "open" },
        { label: "Update from local source…", id: "update" },
        { label: plugin.enabled ? "Disable plugin" : "Enable plugin", id: "toggle" },
        { label: "Remove plugin…", id: "remove" },
      ], { placeHolder: `${plugin.manifest.name} · ${plugin.manifest.version}` });
      if (!action) return;
      if (action.id === "open") { await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(plugin.directory)); return; }
      if (action.id === "update") {
        const manifest = await manager.inspect(plugin.source);
        if (manifest.id !== plugin.id) throw new Error("The source changed its plugin ID; install it as a separate plugin.");
        await preview(plugin.source, true);
      } else if (action.id === "toggle") {
        await manager.setEnabled(plugin.id, !plugin.enabled);
        await reconcile();
      } else {
        if (await vscode.window.showWarningMessage(`Remove ${plugin.manifest.name}?`, { modal: true, detail: "Installed copies and their MCP connections will be removed. The original local source remains available." }, "Remove plugin") !== "Remove plugin") return;
        await manager.setEnabled(plugin.id, false);
        await reconcile();
        await manager.remove(plugin.id);
      }
      features.notifyChanged();
    } catch (error) {
      logError("plugins.manage", error);
      vscode.window.showErrorMessage(`OpenCursor plugins: ${error instanceof Error ? error.message : String(error)}`);
    }
  }));
  await reconcile();
}
