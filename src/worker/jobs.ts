/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RunAgentOptions } from "../agent/loopTypes";
import type { AgentEvent, Step } from "../agent/types";
import type { ContextState } from "../agent/contextState";
import { RunJournal } from "../stores/runJournal";
import { actionTypeForCall } from "../agent/approvalPolicy";
import { withWorkspaceRoot } from "../context/workspaceUtils";
import { validateExecutionProfile, type ExecutionProfile } from "../agent/execution";
import { durableWrite } from "../stores/durableFiles";

const execute = promisify(execFile);
export interface JobRequest { repository: string; revision: string; prompt: string; model: string; tokenBudget?: number; maxSteps?: number }
export interface JobState extends JobRequest { id: string; status: "queued" | "running" | "finished" | "failed" | "cancelled" | "interrupted"; createdAt: number; updatedAt: number; tokensUsed: number; error?: string; baseRevision?: string; result?: string }
export interface WorkerOptions { directory: string; repositories: Record<string, string>; models: string[]; apiBaseUrl: string; apiKey: string; execution?: ExecutionProfile; maxTokens?: number; contextTokens?: number; tokenBudget?: number; maxSteps?: number; timeoutMs?: number; anthropic?: boolean }
export type Runner = (options: RunAgentOptions) => Promise<void>;

export async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execute("git", ["-c", "core.hooksPath=" + (process.platform === "win32" ? "NUL" : "/dev/null"), ...args], { cwd: root, windowsHide: true, env: { ...process.env, GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }, timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}
export async function saveJson(file: string, value: unknown): Promise<void> {
  await durableWrite(file, JSON.stringify(value, null, 2));
}

/** One bounded agent at a time, each on an independent pinned clone. */
export class JobManager {
  private jobs = new Map<string, JobState>();
  private active?: { id: string; abort: AbortController; promise: Promise<void> };
  private closing = false;
  private submitting = false;
  private submission?: Promise<void>;
  constructor(readonly options: WorkerOptions, private run: Runner) {}
  async initialize(): Promise<void> {
    validateExecutionProfile(this.options.execution ?? { kind: "container" });
    for (const field of ["maxTokens", "contextTokens", "tokenBudget", "maxSteps", "timeoutMs"] as const) {
      const value = this.options[field];
      if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0 || (field === "timeoutMs" && value > 2_147_483_647))) throw new Error(`Worker ${field} must be a positive bounded integer`);
    }
    await fs.mkdir(this.options.directory, { recursive: true, mode: 0o700 });
    for (const entry of await fs.readdir(this.options.directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/.test(entry.name)) continue;
      let state: JobState;
      try { state = JSON.parse(await fs.readFile(path.join(this.options.directory, entry.name, "state.json"), "utf8")) as JobState; }
      catch (error) {
        // A crash after mkdir and before the first atomic save leaves no job to
        // replay. Preserve this orphan directory without disabling other jobs.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (state.id !== entry.name) throw new Error("Job identity does not match its storage directory");
      // No automatic replay after a process restart: remote effects may have occurred.
      if (state.status === "queued" || state.status === "running") { state.status = "interrupted"; state.updatedAt = Date.now(); await this.save(state); }
      this.jobs.set(state.id, state);
    }
  }
  list(): JobState[] { return [...this.jobs.keys()].map(id => this.get(id)); }
  get(id: string): JobState {
    const state = this.jobs.get(id); if (!state) throw new Error("Unknown job");
    // A settled agent still needs patch/history/journal persistence. Do not
    // advertise completion before those artifacts are available for review.
    return { ...state, status: this.active?.id === id && !["running", "queued"].includes(state.status) ? "running" : state.status };
  }
  directory(id: string): string { this.get(id); return path.join(this.options.directory, id); }
  private save(job: JobState): Promise<void> { return saveJson(path.join(this.options.directory, job.id, "state.json"), job); }
  async submit(request: JobRequest): Promise<JobState> {
    if (this.closing) throw new Error("Worker is shutting down");
    if (this.submitting || this.active || [...this.jobs.values()].some(job => job.status === "queued")) throw new Error("Worker is busy; retry after the current job finishes");
    if (!request || !Object.hasOwn(this.options.repositories, request.repository)) throw new Error("Repository is not in the worker allowlist");
    if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(request.revision)) throw new Error("An exact full Git commit hash is required");
    if (!this.options.models.includes(request.model)) throw new Error("Model is not in the worker allowlist");
    if (typeof request.prompt !== "string" || !request.prompt.trim() || request.prompt.length > 100_000) throw new Error("Prompt must contain 1–100000 characters");
    const cap = (value: number | undefined, maximum: number) => value === undefined ? maximum : Number.isInteger(value) && value > 0 ? Math.min(value, maximum) : (() => { throw new Error("Budgets must be positive integers"); })();
    const now = Date.now();
    const state: JobState = { repository: request.repository, revision: request.revision, prompt: request.prompt, model: request.model,
      tokenBudget: cap(request.tokenBudget, this.options.tokenBudget ?? 200_000), maxSteps: cap(request.maxSteps, this.options.maxSteps ?? 100),
      id: randomUUID(), status: "queued", createdAt: now, updatedAt: now, tokensUsed: 0 };
    this.submitting = true;
    let submitted!: () => void;
    this.submission = new Promise<void>(resolve => { submitted = resolve; });
    try {
      await fs.mkdir(path.join(this.options.directory, state.id), { mode: 0o700 }); await this.save(state); this.jobs.set(state.id, state);
      if (this.closing) { state.status = "cancelled"; state.updatedAt = Date.now(); await this.save(state); return { ...state }; }
      const abort = new AbortController();
      const promise = Promise.resolve().then(() => this.execute(state, abort)).finally(() => { if (this.active?.id === state.id) this.active = undefined; });
      this.active = { id: state.id, abort, promise };
      // execute records all errors; this catch only covers storage failure during finalization.
      void promise.catch(error => { state.status = "failed"; state.error = String(error); });
      return { ...state };
    } finally { this.submitting = false; submitted(); }
  }
  async wait(id: string): Promise<JobState> { this.get(id); if (this.active?.id === id) await this.active.promise; return this.get(id); }
  async cancel(id: string): Promise<JobState> { this.get(id); if (this.active?.id === id) { this.active.abort.abort(); await this.active.promise; } return this.get(id); }
  async close(): Promise<void> { this.closing = true; await this.submission; if (this.active) { this.active.abort.abort(); await this.active.promise; } }
  async events(id: string, after = 0): Promise<{ events: unknown[]; next: number }> {
    const rows = await new RunJournal(this.directory(id), "events").read();
    const start = Math.max(0, Math.floor(after)); const events = rows.slice(start, start + 250);
    return { events, next: start + events.length };
  }
  async patch(id: string): Promise<string> { const state = this.get(id); if (["running", "queued"].includes(state.status)) throw new Error("Wait for the job to settle before exporting its patch"); return fs.readFile(path.join(this.directory(id), "changes.patch"), "utf8"); }
  private async execute(state: JobState, abort: AbortController): Promise<void> {
    const directory = this.directory(state.id), workspace = path.join(directory, "workspace");
    const journal = new RunJournal(directory, "events");
    const history: Step[] = [], contextState: ContextState = {};
    const timer = setTimeout(() => abort.abort(new Error("Worker elapsed-time budget exceeded")), this.options.timeoutMs ?? 30 * 60_000);
    let baseReady = false, agentError: string | undefined;
    try {
      state.status = "running"; state.updatedAt = Date.now(); await this.save(state);
      await git(directory, ["clone", "--no-hardlinks", "--no-checkout", "--", path.resolve(this.options.repositories[state.repository]), workspace]);
      abort.signal.throwIfAborted();
      await git(workspace, ["checkout", "--detach", state.revision]);
      state.baseRevision = (await git(workspace, ["rev-parse", "HEAD"])).trim(); baseReady = true;
      // Keep Git configuration/index/hooks outside the agent's writable mount.
      // Export must never execute config or filters supplied by the agent.
      await fs.rename(path.join(workspace, ".git"), path.join(directory, "git-metadata"));
      await this.save(state);
      const onEvent = (event: AgentEvent) => {
        if (event.type === "error") agentError = event.message;
        if (event.type === "run-result") state.result = event.text;
        // Tool results/intent are durably written through onRunEvent. Stream
        // deltas remain reconnectable without storing provider credentials.
        if (["text-delta", "run-status", "verification", "usage", "error", "max-steps"].includes(event.type)) void journal.append({ type: "agent-event", at: Date.now(), data: event }).catch(() => abort.abort());
      };
      await this.run({ apiBaseUrl: this.options.apiBaseUrl, apiKey: this.options.apiKey, model: state.model, anthropic: this.options.anthropic,
        workspaceRoot: workspace, executionProfile: this.options.execution ?? { kind: "container", network: false },
        unavailableTools: ["GoToDefinition", "FindReferences", "WorkspaceSymbols", "RenamePreview", "ReadLints", "AskQuestion"],
        prompt: state.prompt, extraInstructions: `Repository ${state.repository}, pinned base ${state.baseRevision}. Git metadata is held by the worker outside your workspace; edit files directly and use the worker's exported patch for review.`, mode: "agent", history, contextState, runId: state.id, promptCacheKey: state.id,
        changeOwner: { conversationId: state.id, runId: state.id },
        goal: { objective: state.prompt, status: "active", tokenBudget: state.tokenBudget, tokensUsed: 0 },
        onGoalUsage: tokens => { state.tokensUsed += tokens; }, maxSteps: state.maxSteps, maxTokens: this.options.maxTokens ?? 4096, contextTokens: this.options.contextTokens,
        enableFileReading: true, enableTerminalSuggestions: true, enableWorkspaceContext: true, enableWebFetch: false, enableWebSearch: false,
        approve: async (name, input) => withWorkspaceRoot(workspace, () => { const effect = actionTypeForCall(name, input, workspace); return effect !== "outside" && effect !== "mcp" && effect !== "web"; }),
        signal: abort.signal, emit: onEvent, onRunEvent: event => journal.append(event),
      });
      state.status = abort.signal.aborted ? "cancelled" : agentError ? "failed" : "finished";
      if (agentError) state.error = agentError;
    } catch (error) { state.status = abort.signal.aborted ? "cancelled" : "failed"; state.error = error instanceof Error ? error.message : String(error); }
    finally {
      clearTimeout(timer);
      if (baseReady) {
        try {
          const metadata = ["--git-dir", path.join(directory, "git-metadata"), "--work-tree", workspace];
          await git(workspace, [...metadata, "add", "--intent-to-add", "--all", "--", "."]);
          const patch = await git(workspace, [...metadata, "diff", "--binary", "--no-ext-diff", "--no-textconv", state.baseRevision!, "--", "."]);
          await durableWrite(path.join(directory, "changes.patch"), patch);
        }
        catch (error) { state.status = "failed"; state.error = `Patch export failed: ${String(error)}`; }
      }
      await journal.flush();
      await saveJson(path.join(directory, "history.json"), { history, contextState });
      state.updatedAt = Date.now(); await this.save(state);
    }
  }
}
