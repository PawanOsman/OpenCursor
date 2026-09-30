/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it, vi } from "vitest";
import { waitTool } from "./agent";
import { rgTool } from "./search";
import { randomUUID } from "node:crypto";

vi.mock("vscode", () => ({ workspace: { workspaceFolders: [] }, Uri: {} }));

describe("Wait", () => {
  it("sleeps for the requested time and reports it", async () => {
    const started = Date.now();
    const r = await waitTool.execute({ ms: 30 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
    expect(r.output).toBe("Waited 30ms.");
    expect(r.outcome?.status).toBe("completed");
  });
  it("returns early on abort and rejects bad input", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 10);
    const r = await waitTool.execute({ ms: 5000 }, ac.signal);
    expect(r.outcome?.status).toBe("aborted");
    expect((await waitTool.execute({ ms: -1 })).output).toMatch(/^error/);
  });
});

describe("Rg", () => {
  it("rejects shell-style invocations and unsafe flags", async () => {
    expect((await rgTool.execute({})).output).toMatch(/^error: args/);
    expect((await rgTool.execute({ args: ["--pre", "cat", "x"] })).output).toMatch(/not permitted/);
    expect((await rgTool.execute({ args: ["--replace=x", "y"] })).output).toMatch(/not permitted/);
  });
  it("runs ripgrep when available", async () => {
    const r = await rgTool.execute({ args: ["-l", "-F", "export const rgTool", "src/agent/tools"] });
    if (/not available/.test(r.output)) return; // no ripgrep on this machine
    expect(r.outcome?.status).toBe("completed");
    expect(r.output).toContain("src/agent/tools/search.ts");
    const none = await rgTool.execute({ args: ["-F", `absent-fixture-${randomUUID()}`, "src/agent/tools"] });
    expect(none.outcome?.exitCode).toBe(1);
    expect(none.output).toContain("(no matches)");
  });
});
