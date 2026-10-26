/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it } from "vitest";
import { buildMessages, fitStepsToBudget, snapshotUserContext, splitForCompaction, stepsToTranscript } from "./messages";
import { restoreContext, saveContext, type ContextState } from "./contextState";
import { stepsTokens } from "./contextEconomy";
import type { Step } from "./types";

const context = { userInfo: "Workspace rules: preserve manual changes", openFiles: "src/first.ts", timestamp: "2026-09-07T12:00:00Z", reminder: "Inspect before editing" };
const first = (): Step => ({ kind: "user", text: "Inspect the project", context: snapshotUserContext(context), attachments: [
  { id: "text", kind: "text", name: "notes.txt", mime: "text/plain", data: "Keep the public API" },
  { id: "image", kind: "image", name: "view.png", mime: "image/png", data: "data:image/png;base64,YQ==" },
] });
const exchange = (id: string): Step[] => [
  { kind: "assistant", text: "Inspecting", calls: [{ id, name: "Read", arguments: '{"path":"src/first.ts"}' }] },
  { kind: "tool-result", callId: id, name: "Read", output: "Current contents", status: "completed" },
];

describe("immutable user context", () => {
  it("preserves entire previous message objects across multiple user turns and appended notifications", () => {
    const history: Step[] = [first(), ...exchange("one")];
    let prior = buildMessages("OpenCursor", history);
    for (let i = 0; i < 3; i++) {
      history.push({ kind: "user", synthetic: true, text: `Editor context changed ${i}` });
      history.push({ kind: "user", text: `Follow-up ${i}`, context: snapshotUserContext({ ...context, openFiles: `src/${i}.ts`, timestamp: String(i) }) });
      history.push(...exchange(`next-${i}`));
      const next = buildMessages("OpenCursor", history);
      expect(next.slice(0, prior.length)).toEqual(prior);
      prior = next;
    }
    expect(JSON.stringify(prior[1])).toContain("Keep the public API");
    expect(JSON.stringify(prior[1])).toContain("data:image/png;base64,YQ==");
  });

  it("ignores refreshed live context for already captured turns", () => {
    const source = { ...context, taskState: "transient state" };
    const step: Step = { kind: "user", text: "Original request", context: snapshotUserContext(source) };
    const prior = buildMessages("OpenCursor", [step]);
    source.userInfo = "different rules";
    source.openFiles = "different.ts";
    source.timestamp = "later";
    expect(buildMessages("OpenCursor", [step], { ...source, taskState: undefined })).toEqual(prior);
    expect(step.context).not.toHaveProperty("taskState");
    expect(Object.isFrozen(step.context)).toBe(true);
  });

  it("omits repeated blocks on the wire while retaining full effective context through serialization", () => {
    const previous = snapshotUserContext(context);
    const next = snapshotUserContext({ ...context, timestamp: "later" }, previous);
    expect(next).toMatchObject({ userInfo: context.userInfo, openFiles: context.openFiles, omitUserInfo: true, omitOpenFiles: true });
    const saved: Step = JSON.parse(JSON.stringify({ kind: "user", text: "Follow-up", context: next }));
    const wire = JSON.stringify(buildMessages("OpenCursor", [saved]));
    expect(wire).not.toContain(context.userInfo);
    expect(wire).not.toContain(context.openFiles);
    expect(wire).toContain("later");
    const full: Step = { kind: "user", text: "Follow-up", context: snapshotUserContext({ ...context, timestamp: "later" }) };
    expect(stepsTokens([full]) - stepsTokens([saved])).toBeGreaterThan(10);
    const changed = snapshotUserContext({ ...context, openFiles: "new.ts" }, previous);
    expect(changed.omitUserInfo).toBe(true);
    expect(changed.omitOpenFiles).toBeUndefined();
  });

  it("does not move cache markers on legacy and synthetic user messages", () => {
    const history: Step[] = [{ kind: "user", text: "Legacy request" }, { kind: "user", synthetic: true, text: "Saved note" }];
    const before = buildMessages("OpenCursor", history);
    history.push(first(), ...exchange("new"));
    expect(buildMessages("OpenCursor", history).slice(0, before.length)).toEqual(before);
  });

  it("restores saved working context with the same envelopes and attachments", () => {
    const history: Step[] = [first(), ...exchange("saved")];
    const state: ContextState = {};
    saveContext(history, history, state);
    const before = buildMessages("OpenCursor", history);
    const saved = JSON.parse(JSON.stringify({ history, state })) as { history: Step[]; state: ContextState };
    saved.history.push({ kind: "user", text: "Continue", context: snapshotUserContext({ ...context, timestamp: "later" }) });
    const restored = restoreContext(saved.history, saved.state);
    expect(buildMessages("OpenCursor", restored).slice(0, before.length)).toEqual(before);
    expect(saved.state.checkpoint).toBeDefined();
  });

  it("counts rendered context and fits only model copies while preserving complete tool exchanges", () => {
    const history: Step[] = [{ kind: "user", text: "Keep the API", context: snapshotUserContext({ userInfo: "rules ".repeat(5000), openFiles: "file ".repeat(5000), timestamp: "fixed" }) }, ...exchange("latest")];
    const original = structuredClone(history);
    expect(stepsTokens(history)).toBeGreaterThan(10_000);
    const fitted = fitStepsToBudget(history, 50, 400);
    expect(stepsTokens(fitted) + 50).toBeLessThanOrEqual(400);
    expect(fitted.some((step) => step.kind === "user")).toBe(true);
    expect(fitted.at(-1)).toEqual(history.at(-1));
    expect(JSON.stringify(fitted)).toContain("[omitted]");
    expect(history).toEqual(original);
  });

  it("retains original/current envelopes across compaction and supplies changing constraints to summaries", () => {
    const firstContext = snapshotUserContext(context);
    const restricted = { ...context, userInfo: "Do not run tests for this task" };
    const history: Step[] = [
      { kind: "user", text: "First", context: firstContext }, ...exchange("old"),
      { kind: "user", text: "Second", context: snapshotUserContext(restricted, firstContext) },
      { kind: "user", text: "Third", context: snapshotUserContext(restricted, restricted) },
      { kind: "user", text: "Fourth", context: snapshotUserContext(context, restricted) }, ...exchange("latest"),
    ];
    const transcript = stepsToTranscript(history);
    expect(transcript.match(/Do not run tests for this task/g)).toHaveLength(1);
    expect(transcript.match(/Workspace rules: preserve manual changes/g)).toHaveLength(2);
    const split = splitForCompaction(history, 100);
    expect(split.tail.find((step) => step.kind === "user" && step.text === "First")).toEqual(history[0]);
    expect(split.tail.find((step) => step.kind === "user" && step.text === "Fourth")).toEqual(history[5]);
  });

  it("restores current rules if emergency fitting removes the turn that first supplied them", () => {
    const original = snapshotUserContext({ ...context, userInfo: "Original rules", openFiles: "" });
    const changed = snapshotUserContext({ ...context, userInfo: "Do not execute tests", openFiles: "" }, original);
    const latest = snapshotUserContext({ ...changed, timestamp: "later" }, changed);
    const firstStep: Step = { kind: "user", text: "First", context: original };
    const latestStep: Step = { kind: "user", text: "Continue", context: latest };
    const recent = exchange("latest");
    const history: Step[] = [firstStep, { kind: "user", text: "Middle " + "details ".repeat(3000), context: changed }, latestStep, ...recent];
    const saved = structuredClone(history);
    const budget = stepsTokens([firstStep, latestStep, ...recent]) + 5;
    const fitted = fitStepsToBudget(history, 0, budget);
    expect(stepsTokens(fitted)).toBeLessThanOrEqual(budget);
    expect(fitted.some((step) => step.kind === "user" && step.text.startsWith("Middle"))).toBe(false);
    expect(JSON.stringify(buildMessages("OpenCursor", fitted))).toContain("Do not execute tests");
    expect(history).toEqual(saved);
    const tail = splitForCompaction(history, 100).tail;
    expect(JSON.stringify(buildMessages("OpenCursor", tail))).toContain("Do not execute tests");
  });
});

describe("mid-run steering", () => {
  const liveContext = { userInfo: "Live rules", openFiles: "src/live.ts", timestamp: "2026-10-27T09:00:00Z", reminder: "Live reminder" };

  it("is sent as an update to the current task, without a new request context", () => {
    const history: Step[] = [first(), ...exchange("one"), { kind: "user", text: "Keep the old shortcuts", steering: true }];
    const messages = buildMessages("OpenCursor", history, liveContext);
    const steer = JSON.stringify(messages.at(-1));
    expect(messages.at(-1)?.role).toBe("user");
    expect(steer).toContain("<user_update>");
    expect(steer).toContain("Keep the old shortcuts");
    expect(steer).toContain("not a new request");
    // No fresh snapshot: the steer is not a new <user_query> with live context.
    expect(steer).not.toContain("<user_query>");
    expect(steer).not.toContain("Live rules");
    expect(steer).not.toContain("src/live.ts");
    // The original request keeps its own context and stays the current request.
    expect(JSON.stringify(messages[1])).toContain("Workspace rules: preserve manual changes");
    expect(JSON.stringify(messages[1])).toContain("<user_query>");
  });

  it("does not change earlier messages, so the prompt cache prefix survives", () => {
    const history: Step[] = [first(), ...exchange("one")];
    const before = buildMessages("OpenCursor", history, liveContext);
    history.push({ kind: "user", text: "Also cover the edge case", steering: true });
    const after = buildMessages("OpenCursor", history, liveContext);
    expect(after.slice(0, before.length)).toEqual(before);
  });

  it("is labelled as an update in compaction transcripts", () => {
    expect(stepsToTranscript([first(), { kind: "user", text: "Use tabs", steering: true }])).toContain("## User update (during the task)\nUse tabs");
  });
});
