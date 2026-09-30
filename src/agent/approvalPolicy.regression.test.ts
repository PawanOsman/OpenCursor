/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("vscode", () => ({ workspace: {}, Uri: {} }));
import { actionTypesForCall, DEFAULT_APPROVAL, deniedSubject, evaluateApproval, type ApprovalPolicy } from "./approvalPolicy";
const roots: string[] = [];
const allowPolicy = (): ApprovalPolicy => Object.fromEntries(Object.keys(DEFAULT_APPROVAL).map(k => [k, { mode: "allow", allowlist: [], denylist: [] }])) as unknown as ApprovalPolicy;
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe("production approval boundaries", () => {
  it("combines action and outside policies without replacing a denial", () => {
    const policy = allowPolicy(); policy.shell.mode = "deny";
    expect(evaluateApproval(policy, "Shell", { command: "echo ok", working_directory: "/outside" }, "/project")).toBe("deny");
    expect(deniedSubject(policy, "Shell", { command: "echo ok", working_directory: "/outside" }, "/project")).toBe("echo ok");
    policy.shell.mode = "allow"; policy.outside.mode = "ask";
    expect(evaluateApproval(policy, "Shell", { command: "echo ok", working_directory: "/outside" }, "/project")).toBe("ask");
  });
  it("checks existing targets and future files through symlinked parents", () => {
    const base = mkdtempSync(join(tmpdir(), "oc-approval-")); roots.push(base);
    const root = join(base, "workspace"); const outside = join(base, "outside");
    mkdirSync(root); mkdirSync(outside); writeFileSync(join(outside, "secret"), "private");
    symlinkSync(outside, join(root, "link"), "dir");
    const policy = allowPolicy(); policy.outside.mode = "deny";
    expect(evaluateApproval(policy, "Read", { path: "link/secret" }, root)).toBe("deny");
    expect(evaluateApproval(policy, "Write", { path: "link/new/file" }, root)).toBe("deny");
    expect(evaluateApproval(policy, "Write", { path: "ordinary/file" }, root)).toBe("allow");
  });
  it("checks MCP resource downloads against MCP, edit and location rules", () => {
    expect(actionTypesForCall("FetchMcpResource", { downloadPath: "/outside/result" }, "/project")).toEqual(["mcp", "edits", "outside"]);
    const policy = allowPolicy(); policy.edits.mode = "deny";
    expect(evaluateApproval(policy, "FetchMcpResource", { downloadPath: "/outside/result" }, "/project")).toBe("deny");
    policy.mcp.mode = "deny";
    expect(evaluateApproval(policy, "CallMcpTool", {})).toBe("deny");
  });
  it.each(["echo $(touch /tmp/fixture)", 'echo "$(touch /tmp/fixture)"', "echo `touch /tmp/fixture`", "echo safe & touch /tmp/fixture", "echo $(echo $(touch /tmp/fixture))"])("checks hidden commands in %s against explicit denials", (command) => {
    const policy = allowPolicy();
    policy.shell = { mode: "ask", allowlist: ["echo"], denylist: ["touch"] };
    for (const mode of ["allow", "ask", "review", "deny"] as const) {
      policy.shell.mode = mode;
      expect(evaluateApproval(policy, "Shell", { command })).toBe("deny");
      expect(deniedSubject(policy, "Shell", { command })).toBe("touch /tmp/fixture");
    }
  });
  it.each([
    'cd /project && FILE="src/example.ts"; sed -n 1,10p "$FILE"; echo ----; sed -n 20,30p "$FILE"',
    'echo "$HOME"',
    "echo $(pwd)",
    "echo `pwd`",
    "cat <(printf ok)",
    "bash -c 'echo ok'",
    "eval 'echo ok'",
    'for file in *.ts; do echo "$file"; done',
    '$file = "src/app.ts"; Get-Content $file',
  ])("honors Allow with unrelated deny rules for %s", (command) => {
    const policy = allowPolicy();
    policy.shell = { mode: "allow", allowlist: ["git status"], denylist: ["git push", "rm", "touch"] };
    expect(evaluateApproval(policy, "Shell", { command })).toBe("allow");
    expect(deniedSubject(policy, "Shell", { command })).toBeUndefined();
  });
  it.each(["ask", "review", "deny"] as const)("keeps dynamic commands gated in %s mode", (mode) => {
    const policy = allowPolicy();
    policy.shell = { mode, allowlist: ["echo", "pwd", "eval", "bash"], denylist: ["touch"] };
    for (const command of ['echo "$HOME"', "echo $(pwd)", "eval 'echo ok'", "bash -c 'echo ok'"]) {
      expect(evaluateApproval(policy, "Shell", { command })).toBe(mode === "deny" ? "deny" : "ask");
    }
  });
  it("preserves literal quoted text and shell prefix boundaries", () => {
    const policy = allowPolicy();
    policy.shell = { mode: "ask", allowlist: ["echo", "pwd"], denylist: ["touch"] };
    expect(evaluateApproval(policy, "Shell", { command: "echo $(pwd)" })).toBe("ask");
    expect(evaluateApproval(policy, "Shell", { command: "echo '$HOME $(touch /tmp/fixture)'" })).toBe("allow");
    expect(evaluateApproval(policy, "Shell", { command: "echo safe \\& touch /tmp/fixture" })).toBe("allow");
    expect(evaluateApproval(policy, "Shell", { command: "echolocation fixture" })).toBe("ask");
    policy.shell = { mode: "allow", allowlist: [], denylist: [] };
    expect(evaluateApproval(policy, "Shell", { command: "echo $(pwd)" })).toBe("allow");
  });
});
