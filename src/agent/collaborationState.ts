/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { Step } from "./types";
export interface Collaborator {
  id: string;
  title: string;
  type?: string;
  model: string;
  readonly: boolean;
  status: "running" | "completed" | "failed" | "interrupted";
  history: Step[];
  mailbox: string[];
  result?: string;
  updatedAt: number;
}
export interface AgentControlRequest { action: "list" | "message" | "followup" | "interrupt" | "wait"; id?: string; message?: string; timeout_ms?: number }
