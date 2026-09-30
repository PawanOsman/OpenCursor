/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as os from "os";
import { currentExecutionProfile } from "../agent/execution";
import { getWorkspaceRoot, getRecentFiles } from "./workspaceUtils";
import { getActiveSelection, getOpenFiles, listSkills, getGitContext, listRulesForPrompt } from "./workspaceContext";

function shellName(): string {
  if (currentExecutionProfile().kind === "container") return "/bin/sh inside the configured Docker image (POSIX commands)";
  if (process.platform === "win32") {
    return "powershell";
  }
  return process.env.SHELL?.split("/").pop() || "bash";
}

function formatDate(d: Date): string {
  // e.g. "Saturday Jun 27, 2026"
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const month = d.toLocaleDateString("en-US", { month: "short" });
  return `${weekday} ${month} ${d.getDate()}, ${d.getFullYear()}`;
}

function formatTimestamp(d: Date): string {
  // e.g. "Saturday, Jun 27, 2026, 9:08 PM (UTC+3)"
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const month = d.toLocaleDateString("en-US", { month: "short" });
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? "+" : "-";
  const offH = Math.floor(Math.abs(offMin) / 60);
  return `${weekday}, ${month} ${d.getDate()}, ${d.getFullYear()}, ${h}:${m} ${ampm} (UTC${sign}${offH})`;
}

/**
 * Cached context in the first user content block:
 * <user_info>, <agent_transcripts>, <rules> (always-applied + user rules),
 * <agent_skills> (available skills). This block is cached.
 */
export async function buildUserInfoBlock(opts: {
  userRules?: string;
  enableWorkspaceContext?: boolean;
  /** Tool targets accumulated by the current run; includes unopened/new files. */
  matchFiles?: string[];
}): Promise<string> {
  const root = getWorkspaceRoot();
  const now = new Date();
  const gitInfo = await getGitContext();
  const isRepo = gitInfo ? `Yes, at ${root.replace(/\\/g, "/")}` : "No";

  const parts: string[] = [];
  const execution = currentExecutionProfile();
  if (execution.kind === "container") parts.push(`<execution_environment>Commands run inside Docker image ${execution.image ?? "node:22-bookworm-slim"}, using /bin/sh and the workspace mount /workspace. The host OS below describes the editor, not the command environment. Use POSIX commands. Command networking is ${execution.network ? "enabled" : "disabled"}; configured model/embedding connections are managed by the host. File tools are restricted to workspace paths; host MCP execution is unavailable.</execution_environment>`);
  parts.push(
    `<user_info>\nOS Version: ${process.platform} ${os.release()}\n\nShell: ${shellName()}\n\nWorkspace Path: ${root}\n\nIs directory a git repo: ${isRepo}\n\nToday's date: ${formatDate(now)}\n</user_info>`
  );

  // Explicit user instructions apply even when automatic workspace context
  // is disabled; that setting controls only workspace discovery.
  const matchFiles = [...new Set([...getOpenFiles(), ...getRecentFiles(), ...(opts.matchFiles ?? [])])];
  const always = opts.enableWorkspaceContext !== false ? await listRulesForPrompt(matchFiles) : "";
  const userRules = (opts.userRules || "").trim();
  if (always || userRules) {
    let rules = `<rules>\nThe rules section has a number of possible rules/memories/context that you should consider. In each subsection, we provide instructions about what information the subsection contains and how you should consider/follow the contents of the subsection.`;
    if (always) {
      rules += `\n\n\n<always_applied_workspace_rules description="These are workspace-level rules that the agent must always follow.">\n${always}\n</always_applied_workspace_rules>`;
    }
    if (userRules) {
      const split = userRules
        .split(/\n{2,}/)
        .map((r) => r.trim())
        .filter(Boolean)
        .map((r) => `<user_rule>${r}</user_rule>`)
        .join("\n\n");
      rules += `\n\n<user_rules description="These are rules set by the user that you should follow if appropriate.">\n${split}\n</user_rules>`;
    }
    rules += `\n</rules>`;
    parts.push(rules);
  }

  if (opts.enableWorkspaceContext !== false) {
    // Available skills.
    const skills = await listSkills();
    if (skills.length) {
      const list = skills
        .map((s) => `<agent_skill fullPath="${s.path}">${s.description}</agent_skill>`)
        .join("\n\n");
      parts.push(
        `<agent_skills>\nWhen users ask you to perform tasks, check if any of the available skills below can help complete the task more effectively. Skills provide specialized capabilities and domain knowledge. To use a skill, read the skill file at the provided absolute path using the Read tool, then follow the instructions within. When a skill is relevant, read and follow it IMMEDIATELY as your first action. NEVER just announce or mention a skill without actually reading and following it. Only use skills listed below.\n\n\n<available_skills description="Skills the agent can use. Use the Read tool with the provided absolute path to fetch full contents.">\n${list}\n</available_skills>\n</agent_skills>`
      );
    }
  }

  return parts.join("\n\n");
}

/**
 * Second user content block: open and recently viewed files + active selection.
 * Cached.
 */
export async function buildOpenFilesBlock(): Promise<string> {
  // The helper enumerates open tabs; it does not track recency or read files.
  const tabs = [...new Set(getRecentFiles())];
  const visible = getOpenFiles();
  const selection = getActiveSelection();
  const lines = tabs.length
    ? tabs.map((f) => `- ${f}`).join("\n")
    : "(none)";
  const visibleLines = visible.length ? visible.map((f) => `- ${f}`).join("\n") : "(none)";
  let block = `<open_and_recently_viewed_files>\nOpen file tabs in this workspace:\n${lines}\n\nVisible editor files in this workspace:\n${visibleLines}\n\nNote: these files may or may not be relevant to the current conversation. Use the Read tool if you need their contents.\n</open_and_recently_viewed_files>`;
  if (selection) {
    block += `\n\n<active_selection>\n${selection}\n</active_selection>`;
  }
  return block;
}

/** Third user content block: timestamp + the actual user query. Cached. */
export function buildQueryBlock(query: string): string {
  return `<timestamp>\n${formatTimestamp(new Date())}\n</timestamp>\n<user_query>\n${query}\n</user_query>`;
}
