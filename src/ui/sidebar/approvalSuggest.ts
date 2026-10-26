/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { ApprovalActionType } from "../../agent/approvalPolicy";

/** Strip a provider-scoped composite picker id ("<providerId>::<modelId>") to the real id. */
export function stripModelScope(id: string): string {
  const i = id.indexOf("::");
  return i >= 0 ? id.slice(i + 2) : id;
}

// Tools whose second word is a fixed subcommand (`git status`), not free input.
const SUBCOMMAND_TOOLS = new Set(["git", "npm", "pnpm", "yarn", "docker", "kubectl", "cargo", "go", "dotnet", "pip"]);
// Subcommands that run arbitrary scripts/packages: never widen past the exact command.
const OPEN_SUBCOMMANDS = new Set(["run", "exec", "x", "dlx", "create", "-c", "-e"]);
// Editor/VCS/CI config: auto-allowing writes here can run code later.
const SENSITIVE_DIR = /(^|\/)\.(vscode|git|github)(\/|$)/i;

/**
 * Suggest an allow/deny pattern for a subject, used to pre-fill the approval
 * prompt. Deliberately narrow: an exact command (or command + fixed
 * subcommand like `git status`), an exact path or its folder, an origin.
 */
export function suggestPattern(type: ApprovalActionType, toolName: string, subject: string): string | undefined {
  if (type === "shell") {
    const command = subject.trim().replace(/\s+/g, " ");
    const tokens = command.split(" ");
    if (!tokens[0]) return undefined;
    const sub = tokens[1];
    if (SUBCOMMAND_TOOLS.has(tokens[0].toLowerCase()) && sub && /^[a-z][\w-]*$/i.test(sub) && !OPEN_SUBCOMMANDS.has(sub.toLowerCase())) {
      return `${tokens[0]} ${sub}`;
    }
    return command;
  }
  if (type === "edits" || type === "delete" || type === "outside") {
    const path = subject.replace(/\\/g, "/").trim();
    if (!path || SENSITIVE_DIR.test(path)) return undefined;
    if (type === "outside") {
      // Allowing the containing directory is the least-surprising default.
      const dir = path.split("/").slice(0, -1).join("/");
      return dir ? `${dir}/**` : undefined;
    }
    return path;
  }
  if (type === "web") {
    try { return `${new URL(subject).origin}/*`; } catch { return undefined; }
  }
  if (type === "mcp") return toolName;
  return undefined;
}
