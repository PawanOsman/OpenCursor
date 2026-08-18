/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { Step, WireContentPart, WireMessage, CacheControl } from "./types";
import { economizeHistoryHard, isProtectedStep, lastRealUserIndex, stepTokens, stepsTokens } from "./contextEconomy";

export { stepTokens, stepsTokens };

const EPHEMERAL: CacheControl = { type: "ephemeral" };

/**
 * Trim history so the built request fits `budgetTokens`. Two things are pinned
 * unconditionally: the first user turn (the original request — losing it is why
 * long runs "forget" the task) and the live user turn.
 *
 * Everything else is selected newest-first in whole call groups, durable state
 * before raw context. Tool bodies stay full — when the window is over budget
 * we drop whole groups, never stub their content. A group is an assistant's
 * tool_calls plus the results that answer them, so a trim can never orphan a
 * call and produce an invalid request.
 *
 * `overheadTokens` must cover everything that rides along outside the steps —
 * system prompt *and* tool schemas. Counting only the system prompt made this
 * "guaranteed fit" pass overshoot the real window by the schema block (10k+).
 */
export function fitStepsToBudget(steps: Step[], overheadTokens: number, budgetTokens: number): Step[] {
  const budget = budgetTokens - overheadTokens;
  if (budget <= 0) return steps;

  // Shallow clone suffices: stripThinking replaces entries via spread (never mutates originals).
  const work = [...steps];
  economizeHistoryHard(work);

  const liveIdx = lastRealUserIndex(work);
  const live = work[liveIdx];
  const firstUserIdx = work.findIndex((s) => s.kind === "user" && !s.synthetic);
  const anchor = firstUserIdx >= 0 && firstUserIdx !== liveIdx ? work[firstUserIdx] : undefined;

  let used = (live ? stepTokens(live) : 0) + (anchor ? stepTokens(anchor) : 0);

  // A single agentic turn can be the whole run, so the work after the live user
  // message gets the same group selection as the work before it.
  const before = groupSteps(work.slice(0, liveIdx).filter((s) => s !== anchor));
  const after = groupSteps(work.slice(liveIdx + 1));
  const keep = new Set<Step[]>();
  const take = (groups: Step[][], protectedOnly: boolean) => {
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i];
      if (keep.has(g)) continue;
      if (g.some(isProtectedStep) !== protectedOnly) continue;
      const t = stepsTokens(g);
      if (used + t > budget) continue;
      used += t;
      keep.add(g);
    }
  };
  // Recent work first, durable state before raw context within each region.
  take(after, true);
  take(after, false);
  take(before, true);
  take(before, false);

  return [
    ...(anchor ? [anchor] : []),
    ...before.filter((g) => keep.has(g)).flat(),
    ...(live ? [live] : []),
    ...after.filter((g) => keep.has(g)).flat(),
  ];
}

/** Group each assistant tool-call step with the tool results that answer it. */
function groupSteps(steps: Step[]): Step[][] {
  const groups: Step[][] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.kind === "assistant" && s.calls?.length) {
      const group: Step[] = [s];
      const ids = new Set(s.calls.map((c) => c.id));
      while (i + 1 < steps.length) {
        const next = steps[i + 1];
        if (next.kind !== "tool-result" || !ids.has(next.callId)) break;
        group.push(next);
        i++;
      }
      groups.push(group);
    } else if (s.kind === "tool-result") {
      // Result whose call already fell outside this slice — never send it alone.
      continue;
    } else {
      groups.push([s]);
    }
  }
  return groups;
}

/**
 * Split history for auto-compaction: `tail` = the most recent steps that fit
 * `keepTokens` (always at least the last user turn onward), `prefix` = the
 * older steps to summarize. The tail never starts on a tool-result.
 */
export function splitForCompaction(steps: Step[], keepTokens: number): { prefix: Step[]; tail: Step[] } {
  // Purely a token window: bounding the tail at the last user message meant a
  // long single-turn agentic run could never be compacted at all.
  let used = 0;
  let cut = steps.length;
  for (let i = steps.length - 1; i >= 0; i--) {
    const t = stepTokens(steps[i]);
    if (used + t > keepTokens) break;
    used += t;
    cut = i;
  }
  // The tail must not start on a tool-result (its tool_call would be orphaned).
  while (cut < steps.length && steps[cut].kind === "tool-result") cut++;
  return { prefix: steps.slice(0, cut), tail: steps.slice(cut) };
}

/** Serialize steps to plain text for the summarizer (dump bodies truncated; todos/edits kept). */
export function stepsToTranscript(steps: Step[]): string {
  const out: string[] = [];
  const keepFull = new Set([
    "TodoWrite", "TodoRead", "Task", "AskQuestion", "SwitchMode", "WritePlan",
    "StrReplace", "Write", "Delete", "EditNotebook",
  ]);
  for (const s of steps) {
    if (s.kind === "user") {
      out.push(`## ${s.synthetic ? "System note" : "User"}\n${s.text}`);
    } else if (s.kind === "assistant") {
      // Prefer generated output text over thinking (thinking is UI-only anyway).
      if (s.text) out.push(`## Assistant\n${s.text}`);
      for (const c of s.calls || []) {
        const args = c.arguments || "";
        const cap = keepFull.has(c.name) ? 800 : 200;
        out.push(`## Assistant tool call: ${c.name}\n${args.slice(0, cap)}`);
      }
    } else {
      // Errors are what the agent was reacting to — never clip them to a stub.
      const cap = keepFull.has(s.name) ? 2000 : s.status === "error" ? 900 : 300;
      out.push(`## Tool result (${s.name}${s.status === "error" ? ", failed" : ""})\n${clip(s.output || "", cap)}`);
    }
  }
  return out.join("\n\n");
}

/** Keep both ends of a long value — the tail usually carries the conclusion. */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = Math.ceil(max * 0.55);
  const tail = max - head;
  return `${s.slice(0, head)}\n…[${s.length - max} chars omitted]…\n${s.slice(-tail)}`;
}

export interface CursorContextBlocks {
  /** <user_info> + <rules> + <agent_skills> */
  userInfo: string;
  /** <open_and_recently_viewed_files> + <active_selection> */
  openFiles: string;
  /** Mode-specific reminder appended right after the live <user_query>. */
  reminder?: string;
  /**
   * Durable run record (todos, files changed, action log). Sent as the last
   * message so it is always current and never inside the cached prefix.
   */
  taskState?: string;
  /** Stable per-run timestamp. A fresh Date each step would invalidate the
   *  cached query block on every model call within the run. */
  timestamp?: string;
}

/**
 * Build wire messages in Cursor's shape:
 * - system as a single cached text block
 * - the CURRENT (last) user turn is split into the cached context blocks
 *   (userInfo, openFiles) followed by a cached <timestamp>+<user_query> block,
 *   matching the exact request Cursor sends.
 */
export function buildMessages(system: string, steps: Step[], ctx?: CursorContextBlocks): WireMessage[] {
  const out: WireMessage[] = [
    { role: "system", content: [{ type: "text", text: system, cache_control: EPHEMERAL }] },
  ];

  // The live context blocks belong to the user's actual request — never to a
  // loop-injected system note, which would hide the request from <user_query>
  // and move the cached blocks on every nudge.
  const lastUserIdx = steps.length ? lastRealUserIndex(steps) : -1;
  // Cache breakpoint for the stable history prefix: the last user-role message
  // before the live turn (a compaction summary or system note). Assistant/tool
  // messages can't carry one through the Anthropic converter.
  let prefixAnchorIdx = -1;
  for (let i = lastUserIdx - 1; i >= 0; i--) {
    if (steps[i].kind === "user") { prefixAnchorIdx = i; break; }
  }

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.kind === "user") {
      const images = (s.attachments || []).filter((a) => a.kind === "image");
      const texts = (s.attachments || []).filter((a) => a.kind === "text");
      let textContent = s.text;
      for (const t of texts) {
        textContent += `\n\n<attached_file name="${t.name}">\n${t.data}\n</attached_file>`;
      }

      // System notes are tagged so the model never mistakes them for the user.
      if (s.synthetic) {
        textContent = `<system_reminder>\n${textContent}\n</system_reminder>`;
      }

      const isLive = i === lastUserIdx && !!ctx;
      const parts: WireContentPart[] = [];

      if (isLive) {
        if (ctx!.userInfo) {
          parts.push({ type: "text", text: ctx!.userInfo, cache_control: EPHEMERAL });
        }
        if (ctx!.openFiles) {
          parts.push({ type: "text", text: ctx!.openFiles, cache_control: EPHEMERAL });
        }
        parts.push({
          type: "text",
          text: `<timestamp>\n${ctx!.timestamp || new Date().toLocaleString()}\n</timestamp>\n<user_query>\n${textContent}\n</user_query>${ctx!.reminder ? `\n${ctx!.reminder}` : ""}`,
          cache_control: EPHEMERAL,
        });
        for (const img of images) {
          parts.push({ type: "image_url", image_url: { url: img.data } });
        }
        out.push({ role: "user", content: parts });
      } else if (images.length) {
        parts.push({ type: "text", text: textContent || "(see attached images)" });
        for (const img of images) {
          parts.push({ type: "image_url", image_url: { url: img.data } });
        }
        out.push({ role: "user", content: parts });
      } else if (i === prefixAnchorIdx) {
        out.push({ role: "user", content: [{ type: "text", text: textContent, cache_control: EPHEMERAL }] });
      } else {
        out.push({ role: "user", content: textContent });
      }
    } else if (s.kind === "assistant") {
      const msg: WireMessage = { role: "assistant", content: s.text || null };
      if (s.calls && s.calls.length) {
        msg.tool_calls = s.calls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: c.arguments || "{}" },
        }));
      }
      out.push(msg);
    } else {
      // Tool result. If it carries an image, send the content as an array
      // (text + image_url); provider.ts renders an Anthropic image block for
      // Anthropic and a trailing user image message for OpenAI.
      if (s.image) {
        const dataUrl = `data:${s.image.mime};base64,${s.image.base64}`;
        out.push({
          role: "tool",
          tool_call_id: s.callId,
          content: [
            { type: "text", text: s.output || "(image)" },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        });
      } else {
        out.push({ role: "tool", tool_call_id: s.callId, content: s.output });
      }
    }
  }
  // Durable state last: maximum recency, outside every cache breakpoint, and it
  // costs the same few hundred tokens however long the run has been.
  if (ctx?.taskState) {
    out.push({ role: "user", content: [{ type: "text", text: ctx.taskState }] });
  }
  return out;
}
