/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type * as vscode from "vscode";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { getWorkspaceRoot } from "../../context/workspaceUtils";

export function workspaceStorageDirectory(context: vscode.ExtensionContext): string | undefined {
  if (context.storageUri?.fsPath) return context.storageUri.fsPath;
  if (!context.globalStorageUri?.fsPath) return undefined;
  const workspace = getWorkspaceRoot() ?? "no-workspace";
  return path.join(context.globalStorageUri.fsPath, "workspaces", createHash("sha256").update(workspace).digest("hex").slice(0, 24));
}
