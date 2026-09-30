/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as React from "react";
import { Select } from "../../shared/Select";
import type { ConversationGoal, GoalStatus, ReviewTarget } from "../../../src/shared/chatSession";
import type { VerificationSnapshot } from "../../../src/agent/verification";

export function VerificationCard({ summary }: { summary: VerificationSnapshot }) {
  if (!summary.changedPaths.length && !summary.checks.length) return null;
  const current = summary.checks.filter((check) => check.revision === summary.revision);
  return <details className={`verification-card ${summary.status}`}>
    <summary>{summary.status === "checks-passed" ? "Checks passed" : summary.status === "checks-failed" ? "Checks failed" : "Not verified"}<span>{current.length} current check{current.length === 1 ? "" : "s"} · {summary.changedPaths.length} changed file{summary.changedPaths.length === 1 ? "" : "s"}</span></summary>
    {summary.checks.length ? <ul>{summary.checks.map((check, index) => <li key={index}><code>{check.command}</code><span>{check.status}{check.exitCode !== undefined && check.exitCode !== null ? ` · exit ${check.exitCode}` : ""}{check.revision !== summary.revision ? " · before later edits" : ""}</span></li>)}</ul> : <p>No verification commands were recorded for this run.</p>}
  </details>;
}

export function GoalBanner({ goal, onStatus }: { goal: ConversationGoal; onStatus: (status: GoalStatus) => void }) {
  return <section className="goal-banner" aria-label="Conversation goal">
    <div className="goal-summary"><strong>{goal.objective}</strong><span>{goal.status === "budgetLimited" ? "Budget reached" : goal.status} · {goal.tokensUsed.toLocaleString()}{goal.tokenBudget ? ` / ${goal.tokenBudget.toLocaleString()}` : ""} tokens</span></div>
    {goal.status !== "complete" && <div className="goal-actions">
      {goal.status === "active" ? <button className="btn-ghost" onClick={() => onStatus("paused")}>Pause</button>
        : goal.status !== "budgetLimited" && <button className="btn-ghost" onClick={() => onStatus("active")}>Resume</button>}
      <button className="btn-ghost" onClick={() => onStatus("complete")}>Mark complete</button>
    </div>}
  </section>;
}

export function WorkflowDialog({ kind, onClose, onGoal, onReview, onSteer }: {
  kind: "goal" | "review" | "steer";
  onClose: () => void;
  onGoal: (objective: string, budget?: number) => void;
  onReview: (target: ReviewTarget) => void;
  onSteer: (text: string) => void;
}) {
  const [text, setText] = React.useState("");
  const [budget, setBudget] = React.useState("");
  const [reviewType, setReviewType] = React.useState<ReviewTarget["type"]>("uncommitted");
  const dialog = React.useRef<HTMLFormElement>(null);
  React.useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>('textarea, [role="combobox"], input')?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  const validBudget = !budget || (Number.isSafeInteger(Number(budget)) && Number(budget) > 0);
  const enabled = kind === "review" ? reviewType === "uncommitted" || !!text.trim() : !!text.trim() && validBudget;
  return <div className="modal-overlay" onClick={onClose}>
    <form ref={dialog} className="modal-card workflow-dialog" role="dialog" aria-modal="true" aria-labelledby="workflow-title" onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
        if (event.key !== "Tab") return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input, select, textarea"));
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }} onSubmit={(event) => {
        event.preventDefault();
        if (!enabled) return;
        if (kind === "goal") onGoal(text.trim(), budget ? Number(budget) : undefined);
        else if (kind === "steer") onSteer(text.trim());
        else onReview(reviewType === "uncommitted" ? { type: "uncommitted" } : reviewType === "baseBranch" ? { type: "baseBranch", branch: text.trim() } : reviewType === "commit" ? { type: "commit", commit: text.trim() } : { type: "custom", instructions: text.trim() });
        onClose();
      }}>
      <div className="modal-title" id="workflow-title">{kind === "goal" ? "Start a goal" : kind === "review" ? "Review code" : "Update the active task"}</div>
      <div className="modal-body">
        {kind === "review" && <label>Review scope<Select aria-label="Review scope" value={reviewType} onChange={(event) => { setReviewType(event.target.value as ReviewTarget["type"]); setText(""); }}>
          <option value="uncommitted">Uncommitted changes</option><option value="baseBranch">Compare with a branch</option><option value="commit">A commit</option><option value="custom">Custom instructions</option>
        </Select></label>}
        {(kind !== "review" || reviewType !== "uncommitted") && <label>{kind === "goal" ? "Objective" : kind === "steer" ? "Updated instructions" : reviewType === "baseBranch" ? "Base branch" : reviewType === "commit" ? "Commit" : "Instructions"}
          <textarea value={text} onChange={(event) => setText(event.target.value)} rows={kind === "review" && reviewType !== "custom" ? 2 : 4} required />
        </label>}
        {kind === "goal" && <label>Token budget (optional)<input type="number" min="1" step="1" value={budget} onChange={(event) => setBudget(event.target.value)} placeholder="No token limit" /></label>}
        <p>{kind === "review" ? "Starts a separate read-only conversation with actionable findings and evidence." : kind === "goal" ? "The objective and usage are saved with this conversation. You can pause or resume it." : "The agent receives these instructions at its next step without restarting completed work."}</p>
      </div>
      <div className="modal-actions"><button className="btn-ghost" type="button" onClick={onClose}>Cancel</button><button className="btn-primary" type="submit" disabled={!enabled}>{kind === "goal" ? "Start goal" : kind === "review" ? "Start review" : "Send update"}</button></div>
    </form>
  </div>;
}
