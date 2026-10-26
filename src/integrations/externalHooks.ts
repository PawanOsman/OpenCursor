/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getWorkspaceRoot } from "../context/workspaceUtils";

/**
 * CRUD for hooks defined outside OpenCursor:
 * - Cursor hooks:      ~/.cursor/hooks.json and <workspace>/.cursor/hooks.json
 *   { "version": 1, "hooks": { "<event>": [{ "command": "..." }] } }
 * - Claude Code hooks: ~/.claude/settings.json and <workspace>/.claude/settings.json
 *   { "hooks": { "<Event>": [{ "matcher"?: "...", "hooks": [{ "type": "command", "command": "..." }] }] } }
 */

export type HookSource = "cursor-user" | "cursor-project" | "claude-user" | "claude-project";

export interface ExternalHook {
  source: HookSource;
  event: string;
  command: string;
  /** Claude Code tool matcher (e.g. "Bash", "Edit|Write"). */
  matcher?: string;
  /** Opaque location token — pass back for edit/delete. */
  ref: string;
}

export const CURSOR_HOOK_EVENTS = [
  "beforeSubmitPrompt",
  "beforeShellExecution",
  "beforeMCPExecution",
  "beforeReadFile",
  "afterFileEdit",
  "stop",
];

export const CLAUDE_HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "Notification",
  "Stop",
  "SubagentStop",
  "PreCompact",
  "SessionStart",
  "SessionEnd",
];

function fileFor(source: HookSource): string | undefined {
  const ws = getWorkspaceRoot();
  switch (source) {
    case "cursor-user":
      return path.join(os.homedir(), ".cursor", "hooks.json");
    case "cursor-project":
      return ws ? path.join(ws, ".cursor", "hooks.json") : undefined;
    case "claude-user":
      return path.join(os.homedir(), ".claude", "settings.json");
    case "claude-project":
      return ws ? path.join(ws, ".claude", "settings.json") : undefined;
  }
}

function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Hook files are consulted on every agent event (each tool call, read, edit),
 * so keep their contents and parsed hooks until the file's stat changes. A stat
 * of a missing file does not throw and is far cheaper than open/read/parse.
 */
interface CachedHookFile { mtimeMs: number; size: number; ino: number; content: string | undefined; hooks?: Map<HookSource, ExternalHook[]> }
const hookFileCache = new Map<string, CachedHookFile>();

function cachedHookFile(file: string): CachedHookFile | undefined {
  let stat: fs.Stats | undefined;
  try {
    stat = fs.statSync(file, { throwIfNoEntry: false });
  } catch {
    stat = undefined;
  }
  if (!stat?.isFile()) {
    hookFileCache.delete(file);
    return undefined;
  }
  const cached = hookFileCache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size && cached.ino === stat.ino) return cached;
  let content: string | undefined;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    content = undefined;
  }
  const entry: CachedHookFile = { mtimeMs: stat.mtimeMs, size: stat.size, ino: stat.ino, content };
  hookFileCache.set(file, entry);
  return entry;
}

function writeJson(file: string, data: any): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

const isCursor = (s: HookSource) => s.startsWith("cursor");

function listFrom(source: HookSource): ExternalHook[] {
  const file = fileFor(source);
  if (!file) return [];
  const cached = cachedHookFile(file);
  if (cached?.content === undefined) return [];
  cached.hooks ??= new Map();
  let hooks = cached.hooks.get(source);
  if (!hooks) {
    hooks = hooksFromContent(source, cached.content);
    cached.hooks.set(source, hooks);
  }
  return hooks.map((hook) => ({ ...hook }));
}

/** Parse hooks from already-read file contents (used for consent-pinned project files). */
export function hooksFromContent(source: HookSource, content: string): ExternalHook[] {
  try {
    return listFromData(source, JSON.parse(content));
  } catch {
    return [];
  }
}

function listFromData(source: HookSource, data: any): ExternalHook[] {
  if (!data?.hooks || typeof data.hooks !== "object") return [];
  const out: ExternalHook[] = [];
  for (const [event, arr] of Object.entries<any>(data.hooks)) {
    if (!Array.isArray(arr)) continue;
    if (isCursor(source)) {
      arr.forEach((h, i) => {
        if (h && typeof h.command === "string") out.push({ source, event, command: h.command, ref: JSON.stringify([event, i]) });
      });
    } else {
      arr.forEach((group, gi) => {
        const hooks = Array.isArray(group?.hooks) ? group.hooks : [];
        hooks.forEach((h: any, hi: number) => {
          if (h && typeof h.command === "string") {
            out.push({ source, event, command: h.command, matcher: group.matcher || undefined, ref: JSON.stringify([event, gi, hi]) });
          }
        });
      });
    }
  }
  return out;
}

export function listExternalHooks(): ExternalHook[] {
  return (["cursor-user", "cursor-project", "claude-user", "claude-project"] as HookSource[]).flatMap(listFrom);
}

export const PROJECT_HOOK_SOURCES: readonly HookSource[] = ["cursor-project", "claude-project"];

export function isProjectHookSource(source: HookSource): boolean {
  return PROJECT_HOOK_SOURCES.includes(source);
}

/** Raw contents of a workspace-level hook file, read once so consent and execution see the same bytes. */
export function readProjectHookFile(source: HookSource): { workspace: string; file: string; content: string } | undefined {
  const workspace = getWorkspaceRoot();
  const file = isProjectHookSource(source) ? fileFor(source) : undefined;
  if (!workspace || !file) return undefined;
  const content = cachedHookFile(file)?.content;
  return content === undefined ? undefined : { workspace, file, content };
}

function removeAt(source: HookSource, data: any, ref: string): void {
  const loc = JSON.parse(ref) as any[];
  const event = loc[0];
  const arr = data?.hooks?.[event];
  if (!Array.isArray(arr)) return;
  if (isCursor(source)) {
    arr.splice(loc[1], 1);
  } else {
    const group = arr[loc[1]];
    if (Array.isArray(group?.hooks)) group.hooks.splice(loc[2], 1);
    if (!group?.hooks?.length) arr.splice(loc[1], 1);
  }
  if (!arr.length) delete data.hooks[event];
}

function addTo(source: HookSource, data: any, event: string, command: string, matcher?: string): void {
  data.hooks ||= {};
  data.hooks[event] ||= [];
  const arr = data.hooks[event];
  if (isCursor(source)) {
    arr.push({ command });
  } else {
    const m = matcher?.trim() || undefined;
    let group = arr.find((g: any) => (g?.matcher || undefined) === m);
    if (!group) {
      group = m ? { matcher: m, hooks: [] } : { hooks: [] };
      arr.push(group);
    }
    group.hooks ||= [];
    group.hooks.push({ type: "command", command });
  }
}

/** Add (no ref) or edit (ref) a hook, then persist. */
export function saveExternalHook(source: HookSource, hook: { ref?: string; event: string; command: string; matcher?: string }): void {
  const file = fileFor(source);
  if (!file) throw new Error("No workspace open");
  const data = readJson(file) ?? (isCursor(source) ? { version: 1, hooks: {} } : { hooks: {} });
  data.hooks ||= {};
  if (isCursor(source)) data.version ||= 1;
  if (hook.ref) removeAt(source, data, hook.ref);
  addTo(source, data, hook.event, hook.command, hook.matcher);
  writeJson(file, data);
}

export function deleteExternalHook(source: HookSource, ref: string): void {
  const file = fileFor(source);
  if (!file) return;
  const data = readJson(file);
  if (!data) return;
  removeAt(source, data, ref);
  writeJson(file, data);
}
