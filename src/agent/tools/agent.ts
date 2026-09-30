/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as path from "path";
import { writeTodos, readTodos } from "./todoState";
import type { Mode } from "../types";
import { getWorkspaceRoot } from "../../context/workspaceUtils";
import { mutateFile } from "../../stores/fileMutations";
import { defineTool, type AskQuestionItem } from "./types";
import {
  getSubagentRunner,
  getQuestionAsker,
  slugify,
  makeDiff,
  firstDiffLine,
} from "./shared";

// ---- TodoWrite ----
export const todoWriteTool = defineTool("TodoWrite", false, async (input, _signal, _id, ctx) => writeTodos(input, ctx));

// ---- TodoRead ----
export const todoReadTool = defineTool("TodoRead", false, async (_input, _signal, _id, ctx) => readTodos(ctx));

// ---- AskQuestion (interactive wizard form in the chat UI) ----
export const askQuestionTool = defineTool("AskQuestion", false, async (input, abortSignal, callId, ctx) => {
  const asker = ctx?.askUser ?? getQuestionAsker();
  if (!asker) return { output: "error: cannot ask questions in this context" };

// Question shape: questions:[{id, prompt, options:[{id,label}], allow_multiple}], title.
  // Back-compat: also accept {question, options:[string], multiple} and header.
  // Structured inputs: {type: "text"|"textArea"|"number"|"date", required, placeholder}.
  const questions: AskQuestionItem[] = Array.isArray(input?.questions)
    ? input.questions
        .map((q: any) => ({
          question: String(q?.prompt ?? q?.question ?? ""),
          options: Array.isArray(q?.options)
            ? q.options.map((o: any) => (typeof o === "string" ? o : String(o?.label ?? o?.id ?? "")))
            : undefined,
          multiple: !!(q?.allow_multiple ?? q?.multiple),
          type: typeof q?.type === "string" ? (q.type as AskQuestionItem["type"]) : undefined,
          required: q?.required === true,
          placeholder: typeof q?.placeholder === "string" ? q.placeholder : undefined,
        }))
        .filter((q: AskQuestionItem) => q.question)
    : [];
  if (!questions.length) return { output: "error: no questions provided" };

  try {
    const answers = await asker(callId || "", input?.title ?? input?.header ? String(input.title ?? input.header) : undefined, questions, abortSignal);
    const lines = questions.map((q, i) => {
      const a = answers[String(i)] ?? answers[q.question] ?? [];
      return `Q${i + 1}: ${q.question}\nA: ${a.length ? a.join(", ") : "(skipped)"}`;
    });
    return { output: "The user answered:\n\n" + lines.join("\n\n") };
  } catch (e: any) {
    if (e?.name === "AbortError") return { output: "error: cancelled" };
    return { output: "error: " + String(e?.message || e) };
  }
});

// ---- Task (launch a subagent) ----
export const taskTool = defineTool("Task", false, async (input, abortSignal, callId, ctx) => {
  const runner = ctx?.runSubagent ?? getSubagentRunner();
  if (!runner) return { output: "error: subagents are not available" };
  // Read-only subagent types or an explicit readonly flag run in ask mode.
  const roTypes = new Set(["explore", "cursor-guide", "docs-researcher", "code-reviewer", "bugbot", "security-review", "ci-investigator"]);
  const subType = String(input.subagent_type || "");
  const readonly = input.readonly === true || roTypes.has(subType);
  const subName = subType || undefined;
  const fileAttachments = Array.isArray(input.file_attachments)
    ? input.file_attachments.map((f: any) => String(f))
    : undefined;
  const result = await runner(String(input.prompt || ""), readonly, subName, abortSignal, callId, {
    model: input.model ? String(input.model) : undefined,
    runInBackground: input.run_in_background === true,
    description: input.description ? String(input.description) : undefined,
    fileAttachments,
    resume: input.resume ? String(input.resume) : undefined,
    interrupt: input.interrupt === true,
    fork: input.fork === true,
  });
  return { output: result };
});

export const listAgentsTool = defineTool("ListAgents", false, async (_input, signal, _id, ctx) => ({ output: await ctx?.agentControl?.({ action: "list" }, signal) ?? "No agent registry is available." }));
export const sendAgentMessageTool = defineTool("SendAgentMessage", false, async (input, signal, _id, ctx) => ({ output: await ctx?.agentControl?.({ action: "message", id: input.id, message: input.message }, signal) ?? "error: agent collaboration unavailable" }));
export const followupAgentTool = defineTool("FollowupAgent", false, async (input, signal, _id, ctx) => ({ output: await ctx?.agentControl?.({ action: "followup", id: input.id, message: input.message }, signal) ?? "error: agent collaboration unavailable" }));
export const interruptAgentTool = defineTool("InterruptAgent", false, async (input, signal, _id, ctx) => ({ output: await ctx?.agentControl?.({ action: "interrupt", id: input.id }, signal) ?? "error: agent collaboration unavailable" }));
export const waitForAgentTool = defineTool("WaitForAgent", false, async (input, signal, _id, ctx) => ({ output: await ctx?.agentControl?.({ action: "wait", id: input.id, timeout_ms: input.timeout_ms }, signal) ?? "error: agent collaboration unavailable" }));

// ---- Wait (plain sleep) ----
const MAX_WAIT_MS = 120_000;
export const waitTool = defineTool("Wait", false, async (input, abortSignal) => {
  const requested = Number(input?.ms);
  if (!Number.isFinite(requested) || requested < 0) return { output: "error: ms must be a non-negative number" };
  const ms = Math.min(MAX_WAIT_MS, Math.round(requested));
  const startedAt = Date.now();
  await new Promise<void>((resolve) => {
    const finish = () => { clearTimeout(timer); abortSignal?.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, ms);
    if (abortSignal?.aborted) finish();
    else abortSignal?.addEventListener("abort", finish, { once: true });
  });
  if (abortSignal?.aborted) return { output: `Wait aborted after ${Date.now() - startedAt}ms.`, outcome: { status: "aborted" } };
  return { output: `Waited ${ms}ms${ms < requested ? ` (capped from ${Math.round(requested)})` : ""}.`, outcome: { status: "completed" } };
});

// ---- SwitchMode ----
export const switchModeTool = defineTool("SwitchMode", false, async (input, _signal, _callId, ctx) => {
  const target = String(input?.target_mode_id ?? "").trim().toLowerCase();
  const allowed = ["plan", "agent", "multitask", "project", "debug"];
  if (!allowed.includes(target)) {
    return { output: `error: target_mode_id must be one of ${allowed.map((m) => `'${m}'`).join(", ")}` };
  }
  if (!ctx?.switchMode) return { output: "error: mode switching is not available in this run" };
  return { output: ctx.switchMode(target as Mode) };
});

// ---- WritePlan (allowed in plan, agent, and debug modes) ----
export const writePlanTool = defineTool("WritePlan", true, async (input, signal, _callId, ctx) => {
  const root = getWorkspaceRoot();
  const rel = `.plans/${slugify(input.title)}.md`;
  const body = `# ${String(input.title || "Plan").trim()}\n\n${String(input.content || "").trim()}\n`;
  return mutateFile(path.join(root, rel), { signal, owner: ctx?.changeOwner }, ({ data }) => {
    const original = data?.toString("utf8") ?? "";
    return { data: Buffer.from(body), result: {
      output: `wrote plan to ${rel}`,
      diff: makeDiff(rel, original, body),
      startLine: firstDiffLine(original, body),
    } };
  });
});
