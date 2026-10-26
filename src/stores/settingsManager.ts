/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as vscode from "vscode";

export interface Settings {
  model: string;
  maxResponseLength: number;
  enableWorkspaceContext: boolean;
  enableFileReading: boolean;
  enableTerminalSuggestions: boolean;
  systemPrompt: string;
}

export const DEFAULT_SETTINGS: Settings = {
  // Auto hidden for now (bring back later): "" resolves to first enabled model.
  model: "",
  // 0 = don't send max_tokens; the model decides when to stop.
  maxResponseLength: 0,
  enableWorkspaceContext: true,
  enableFileReading: true,
  enableTerminalSuggestions: true,
  systemPrompt: "You are a professional coding assistant extension named OpenCursor.",
};

export class SettingsManager {
  private static readonly SETTINGS_KEY = "ocursor.settings";
  private static readonly API_KEY_SECRET_KEY = "ocursor.apiKey";

  constructor(private readonly context: vscode.ExtensionContext) {}

  public getSettings(): Settings {
    const config = vscode.workspace.getConfiguration("ocursor");
    return {
      model: config.get<string>("model", DEFAULT_SETTINGS.model),
      maxResponseLength: config.get<number>("maxResponseLength", DEFAULT_SETTINGS.maxResponseLength),
      enableWorkspaceContext: config.get<boolean>("enableWorkspaceContext", DEFAULT_SETTINGS.enableWorkspaceContext),
      enableFileReading: config.get<boolean>("enableFileReading", DEFAULT_SETTINGS.enableFileReading),
      enableTerminalSuggestions: config.get<boolean>("enableTerminalSuggestions", DEFAULT_SETTINGS.enableTerminalSuggestions),
      systemPrompt: config.get<string>("systemPrompt", DEFAULT_SETTINGS.systemPrompt),
    };
  }

  /**
   * Persist only the keys whose effective value actually changed. A key the
   * workspace overrides is updated in the workspace (where it is defined), so a
   * workspace-scoped value is never copied into the user's Global settings.
   */
  public async saveSettings(settings: Partial<Settings>): Promise<void> {
    const config = vscode.workspace.getConfiguration("ocursor");
    const current = this.getSettings();
    const updates: Thenable<void>[] = [];
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      if (!(key in settings)) continue;
      const value = settings[key];
      if (value === undefined || value === current[key]) continue;
      const inspected = config.inspect(key);
      const target = inspected?.workspaceFolderValue !== undefined
        ? vscode.ConfigurationTarget.WorkspaceFolder
        : inspected?.workspaceValue !== undefined
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global;
      updates.push(config.update(key, value, target));
    }
    await Promise.all(updates);
  }

  public async getApiKey(): Promise<string | undefined> {
    return await this.context.secrets.get(SettingsManager.API_KEY_SECRET_KEY);
  }

  // ---- Per-provider API keys (Providers tab) ----
  private static providerSecretKey(providerId: string): string {
    return `ocursor.provider.${providerId}.apiKey`;
  }

  public async getProviderKey(providerId: string): Promise<string | undefined> {
    return await this.context.secrets.get(SettingsManager.providerSecretKey(providerId));
  }

  public async setProviderKey(providerId: string, apiKey: string): Promise<void> {
    if (apiKey.trim() === "") {
      await this.context.secrets.delete(SettingsManager.providerSecretKey(providerId));
    } else {
      await this.context.secrets.store(SettingsManager.providerSecretKey(providerId), apiKey);
    }
  }

  public async deleteProviderKey(providerId: string): Promise<void> {
    await this.context.secrets.delete(SettingsManager.providerSecretKey(providerId));
  }

  public async saveApiKey(apiKey: string): Promise<void> {
    await this.context.secrets.store(SettingsManager.API_KEY_SECRET_KEY, apiKey);
  }

  public async deleteApiKey(): Promise<void> {
    await this.context.secrets.delete(SettingsManager.API_KEY_SECRET_KEY);
  }
}
