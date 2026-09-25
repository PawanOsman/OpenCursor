/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as vscode from "vscode";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RemoteJobClient, workerEndpoint } from "../integrations/remoteClient";

const execute = promisify(execFile);
const endpointKey = "ocursor.workerEndpoint";
const tokenKey = (endpoint: string) => "ocursor.workerToken." + createHash("sha256").update(endpoint).digest("hex");

export function registerRemoteJobs(context: vscode.ExtensionContext): void {
  const configure = async (): Promise<RemoteJobClient | undefined> => {
    const value = await vscode.window.showInputBox({ title: "Configure remote worker", prompt: "Worker origin. Use localhost for an SSH tunnel, or HTTPS for a remote server.", value: context.globalState.get(endpointKey, "http://127.0.0.1:7337"), validateInput: value => { try { workerEndpoint(value); return undefined; } catch (error) { return String((error as Error).message); } } });
    if (value === undefined) return;
    const endpoint = workerEndpoint(value);
    const token = await vscode.window.showInputBox({ title: "Worker bearer token", prompt: "Stored in VS Code SecretStorage.", password: true, value: await context.secrets.get(tokenKey(endpoint)), validateInput: value => value.length >= 32 && !/[\r\n]/.test(value) ? undefined : "Enter a token of at least 32 characters." });
    if (token === undefined) return;
    const client = new RemoteJobClient(endpoint, token);
    await client.health();
    await context.secrets.store(tokenKey(endpoint), token);
    await context.globalState.update(endpointKey, endpoint);
    vscode.window.showInformationMessage(`Worker connected: ${endpoint}`);
    return client;
  };

  const submit = async (client: RemoteJobClient) => {
    const folders = vscode.workspace.workspaceFolders?.filter(folder => folder.uri.scheme === "file") ?? [];
    const folder = folders.length === 1 ? folders[0] : await vscode.window.showQuickPick(folders.map(folder => ({ label: folder.name, description: folder.uri.fsPath, folder })), { placeHolder: "Select the local checkout whose committed HEAD will be used" }).then(item => item?.folder);
    if (!folder) { if (!folders.length) vscode.window.showWarningMessage("Open a local Git workspace before submitting a job."); return; }
    const { stdout } = await execute("git", ["rev-parse", "--verify", "HEAD"], { cwd: folder.uri.fsPath, windowsHide: true, timeout: 10_000, maxBuffer: 4096 });
    const revision = stdout.trim();
    if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(revision)) throw new Error("The workspace does not have a valid committed HEAD.");
    const repository = await vscode.window.showInputBox({ title: "Worker repository", prompt: "Repository alias from the worker allowlist. The worker must already contain this commit.", value: context.workspaceState.get("ocursor.workerRepository", ""), validateInput: value => value.trim() ? undefined : "Enter a repository alias." });
    if (!repository) return;
    const model = await vscode.window.showInputBox({ title: "Worker model", prompt: "Model ID from the worker allowlist", value: context.workspaceState.get("ocursor.workerModel", ""), validateInput: value => value.trim() ? undefined : "Enter a model ID." });
    if (!model) return;
    const prompt = await vscode.window.showInputBox({ title: "Submit remote task", prompt: `Starts from ${revision.slice(0, 12)} in ${repository.trim()}. Uncommitted local changes are not included.`, validateInput: value => value.trim() && value.length <= 100_000 ? undefined : "Enter a task (up to 100,000 characters)." });
    if (!prompt?.trim()) return;
    const job = await client.submit({ repository: repository.trim(), revision, model: model.trim(), prompt: prompt.trim() });
    await context.workspaceState.update("ocursor.workerRepository", repository.trim());
    await context.workspaceState.update("ocursor.workerModel", model.trim());
    vscode.window.showInformationMessage(`Remote job ${job.id}: ${job.status}. Use Remote Jobs to check its result.`);
  };

  context.subscriptions.push(vscode.commands.registerCommand("ocursor.remoteJobs", async () => {
    try {
      const endpoint = context.globalState.get<string>(endpointKey);
      const token = endpoint ? await context.secrets.get(tokenKey(endpoint)) : undefined;
      const client = endpoint && token ? new RemoteJobClient(endpoint, token) : undefined;
      const action = await vscode.window.showQuickPick([
        { label: "$(cloud-upload) Submit a task", value: "submit" },
        { label: "$(list-unordered) View jobs and results", value: "list" },
        { label: "$(settings-gear) Configure worker", value: "configure" },
      ], { placeHolder: endpoint ? `Remote worker: ${endpoint}` : "Connect a remote worker" });
      if (!action) return;
      if (action.value === "configure") { await configure(); return; }
      const ready = client ?? await configure(); if (!ready) return;
      if (action.value === "submit") { await submit(ready); return; }
      const jobs = await ready.list();
      if (!jobs.length) { vscode.window.showInformationMessage("This worker has no jobs yet."); return; }
      const selected = await vscode.window.showQuickPick(jobs.sort((a, b) => b.createdAt - a.createdAt).map(job => ({ label: job.prompt.slice(0, 100).replace(/[\r\n]/g, " "), description: `${job.status} · ${job.repository} · ${job.id.slice(0, 8)}`, detail: `${job.model} · ${job.tokensUsed.toLocaleString()} tokens`, id: job.id })), { placeHolder: "Select a remote job" });
      if (!selected) return;
      const job = await ready.get(selected.id);
      const running = ["queued", "running"].includes(job.status);
      const choice = await vscode.window.showQuickPick([
        { label: "Open status and result", value: "status" },
        ...(running ? [{ label: "Cancel job", value: "cancel" }] : [{ label: "Open patch for review", value: "patch" }, { label: "Download patch…", value: "download" }]),
      ], { placeHolder: `${job.status} · ${job.id}` });
      if (!choice) return;
      if (choice.value === "cancel") { const stopped = await ready.cancel(job.id); vscode.window.showInformationMessage(`Remote job ${stopped.status}.`); return; }
      if (choice.value === "status") { await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: JSON.stringify(job, null, 2), language: "json" })); return; }
      const patch = await ready.patch(job.id);
      if (!patch) { vscode.window.showInformationMessage("This job produced no patch."); return; }
      if (choice.value === "patch") { await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: patch, language: "diff" })); return; }
      const destination = await vscode.window.showSaveDialog({ title: "Download remote job patch", defaultUri: vscode.Uri.file(path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? context.globalStorageUri.fsPath, `${job.id}.patch`)), filters: { "Git patch": ["patch", "diff"] } });
      if (destination) { await vscode.workspace.fs.writeFile(destination, Buffer.from(patch)); await vscode.window.showTextDocument(destination); }
    } catch (error) { vscode.window.showErrorMessage(`Remote Jobs: ${error instanceof Error ? error.message : String(error)}`); }
  }));
}
