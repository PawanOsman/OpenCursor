/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { defineTool } from "./types";
import { runTerminalTool } from "./shell";

export const runChecksTool = defineTool("RunChecks", true, async (input, signal, callId, ctx) => {
  const result = await runTerminalTool.execute(input, signal, callId, ctx);
  ctx?.verification?.check(String(input.command), result.outcome);
  return result;
});
export const verificationTool = defineTool("GetVerificationEvidence", false, async (_input, _signal, _id, ctx) => ({
  output: JSON.stringify(ctx?.verification?.snapshot() ?? { status: "untested", checks: [] }),
}));
export const getGoalTool = defineTool("GetGoal", false, async (_input, _signal, _id, ctx) => ({ output: JSON.stringify(ctx?.getGoal?.() ?? null) }));
export const updateGoalTool = defineTool("UpdateGoal", false, async (input, _signal, _id, ctx) => {
  if (!ctx?.updateGoal) return { output: "error: no goal is configured for this conversation" };
  if (input.status === "complete" && ctx.verification?.snapshot().status === "checks-failed") return { output: "error: current verification checks are failing; resolve them or report the blocker" };
  return { output: ctx.updateGoal(input.status) };
});
