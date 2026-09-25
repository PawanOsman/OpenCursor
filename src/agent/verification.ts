/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { ToolOutcome } from "./toolOutcome";
export interface VerificationCheck { command: string; revision: number; status: string; exitCode?: number | null; at: number; jobId?: string }
export interface VerificationSnapshot { status: "checks-passed" | "checks-failed" | "untested"; revision: number; changedPaths: string[]; checks: VerificationCheck[] }

/** Records observations, never infers that a passing command proves every requirement. */
export class VerificationLedger {
  private revision = 0;
  private changed = new Set<string>();
  private checks: VerificationCheck[] = [];
  changedFile(path: string): void { this.revision++; this.changed.add(path); }
  check(command: string, outcome?: ToolOutcome): void {
    this.checks.push({ command, revision: this.revision, status: outcome?.status ?? "unknown", exitCode: outcome?.exitCode, jobId: outcome?.jobId, at: Date.now() });
    this.checks = this.checks.slice(-50);
  }
  settle(outcome?: ToolOutcome): void {
    if (!outcome?.jobId || outcome.status === "running") return;
    const check = [...this.checks].reverse().find(entry => entry.jobId === outcome.jobId);
    // Keep the original revision: a test started before another edit cannot
    // verify that newer edit merely because it finished afterwards.
    if (check) { check.status = outcome.status; check.exitCode = outcome.exitCode; check.at = Date.now(); }
  }
  snapshot(): VerificationSnapshot {
    const latest = new Map<string, VerificationCheck>();
    for (const check of this.checks.filter(c => c.revision === this.revision)) latest.set(check.command, check);
    const current = [...latest.values()];
    const status = current.some(c => c.status === "failed" || (c.exitCode != null && c.exitCode !== 0)) ? "checks-failed"
      : current.length && current.every(c => c.status === "completed" && c.exitCode === 0) ? "checks-passed" : "untested";
    return { status, revision: this.revision, changedPaths: [...this.changed], checks: this.checks.map(check => ({ ...check })) };
  }
}
