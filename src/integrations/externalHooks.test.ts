/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

let workspace = "";
vi.mock("../context/workspaceUtils", () => ({ getWorkspaceRoot: () => workspace }));

import { deleteExternalHook, listExternalHooks, readProjectHookFile, saveExternalHook } from "./externalHooks";

const projectHooks = () => listExternalHooks().filter((hook) => hook.source === "cursor-project");
const hookFile = () => path.join(workspace, ".cursor", "hooks.json");

beforeEach(() => { workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ocursor-hooks-")); });
afterEach(() => { fs.rmSync(workspace, { recursive: true, force: true }); });

describe("external hook file cache", () => {
  it("reflects creation, external rewrites, edits through the API and deletion", () => {
    expect(projectHooks()).toEqual([]);
    expect(readProjectHookFile("cursor-project")).toBeUndefined();

    fs.mkdirSync(path.dirname(hookFile()), { recursive: true });
    fs.writeFileSync(hookFile(), JSON.stringify({ version: 1, hooks: { stop: [{ command: "one" }] } }));
    expect(projectHooks().map((hook) => hook.command)).toEqual(["one"]);

    // Same-size rewrite with a different mtime must not serve the stale copy.
    fs.writeFileSync(hookFile(), JSON.stringify({ version: 1, hooks: { stop: [{ command: "two" }] } }));
    const later = new Date(Date.now() + 5_000);
    fs.utimesSync(hookFile(), later, later);
    expect(projectHooks().map((hook) => hook.command)).toEqual(["two"]);
    expect(readProjectHookFile("cursor-project")?.content).toContain("two");

    saveExternalHook("cursor-project", { event: "afterFileEdit", command: "three" });
    expect(projectHooks().map((hook) => hook.command).sort()).toEqual(["three", "two"]);

    deleteExternalHook("cursor-project", projectHooks().find((hook) => hook.command === "two")!.ref);
    expect(projectHooks().map((hook) => hook.command)).toEqual(["three"]);

    fs.rmSync(hookFile());
    expect(projectHooks()).toEqual([]);
    expect(readProjectHookFile("cursor-project")).toBeUndefined();
  });

  it("returns copies so callers cannot alter the cached hooks", () => {
    fs.mkdirSync(path.dirname(hookFile()), { recursive: true });
    fs.writeFileSync(hookFile(), JSON.stringify({ version: 1, hooks: { stop: [{ command: "safe" }] } }));
    projectHooks()[0].command = "tampered";
    expect(projectHooks()[0].command).toBe("safe");
  });

  it("ignores unreadable or malformed files", () => {
    fs.mkdirSync(path.dirname(hookFile()), { recursive: true });
    fs.writeFileSync(hookFile(), "{ not json");
    expect(projectHooks()).toEqual([]);
  });
});
