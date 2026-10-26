/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as vscode from "vscode";
import { createHash } from "crypto";
import {
  PROJECT_HOOK_SOURCES,
  hooksFromContent,
  isProjectHookSource,
  listExternalHooks,
  readProjectHookFile,
  type ExternalHook,
} from "./externalHooks";

/**
 * Workspace hook files (<workspace>/.cursor/hooks.json, <workspace>/.claude/settings.json)
 * come from whoever authored the repository, so their commands only run after
 * the user approved that exact file content for that workspace, and only in a
 * trusted workspace. User-level hooks (~/.cursor, ~/.claude) are unaffected.
 */

const APPROVALS_KEY = "ocursor.hooks.projectApprovals";
const MAX_APPROVALS = 200;

let store: vscode.Memento | undefined;
/** Declined this session: do not re-prompt until the file content changes. */
const declined = new Set<string>();
const prompts = new Map<string, Promise<boolean>>();

/** Call once from activate(). Until then, project hooks are never run. */
export function initHookConsent(context: vscode.ExtensionContext): void {
  store = context.globalState;
  declined.clear();
}

export function projectHookApprovalKey(workspace: string, file: string, content: string): string {
  return createHash("sha256").update(workspace).update("\0").update(file).update("\0").update(content).digest("hex");
}

function summarize(hooks: ExternalHook[]): string {
  const lines = hooks.slice(0, 25).map((h) => {
    const command = h.command.length > 1000 ? `${h.command.slice(0, 1000)}… (truncated — use Open File to review)` : h.command;
    return `• ${h.event}${h.matcher ? ` [${h.matcher}]` : ""}: ${command}`;
  });
  if (hooks.length > 25) lines.push(`…and ${hooks.length - 25} more`);
  return lines.join("\n");
}

async function ask(key: string, file: string, hooks: ExternalHook[]): Promise<boolean> {
  const allow = "Allow and Run";
  const review = "Open File";
  const choice = await vscode.window.showWarningMessage(
    `This workspace defines hooks in ${file}. They run shell commands on your machine whenever the agent acts. Only allow them if you trust this repository.`,
    { modal: true, detail: summarize(hooks) },
    allow,
    review,
  );
  if (choice === review) {
    // Not a decision: skip for now and ask again on the next hook trigger.
    void vscode.window.showTextDocument(vscode.Uri.file(file)).then(undefined, () => {});
    return false;
  }
  if (choice !== allow) {
    declined.add(key);
    return false;
  }
  const approvals = (store?.get<string[]>(APPROVALS_KEY, []) ?? []).filter((k) => k !== key);
  approvals.push(key);
  await store?.update(APPROVALS_KEY, approvals.slice(-MAX_APPROVALS));
  return true;
}

async function approved(key: string, file: string, hooks: ExternalHook[]): Promise<boolean> {
  if (!store) return false;
  if ((store.get<string[]>(APPROVALS_KEY, []) ?? []).includes(key)) return true;
  if (declined.has(key)) return false;
  let pending = prompts.get(key);
  if (!pending) {
    pending = ask(key, file, hooks).catch(() => false).finally(() => prompts.delete(key));
    prompts.set(key, pending);
  }
  return pending;
}

/**
 * External hooks that may run now: all user-level hooks, plus project hooks
 * whose current file content was approved in a trusted workspace. Commands are
 * parsed from the same bytes that were hashed for approval.
 */
export async function runnableExternalHooks(): Promise<ExternalHook[]> {
  const out = listExternalHooks().filter((h) => !isProjectHookSource(h.source));
  if (vscode.workspace.isTrusted !== true) return out;
  for (const source of PROJECT_HOOK_SOURCES) {
    const read = readProjectHookFile(source);
    if (!read) continue;
    const hooks = hooksFromContent(source, read.content);
    if (!hooks.length) continue;
    if (await approved(projectHookApprovalKey(read.workspace, read.file, read.content), read.file, hooks)) out.push(...hooks);
  }
  return out;
}
