/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const workspace = mkdtempSync(join(tmpdir(), "ocursor-hook-consent-"));
const vscodeState = vi.hoisted(() => ({ trusted: true, choice: undefined as string | undefined }));
const showWarningMessage = vi.hoisted(() => vi.fn(async () => vscodeState.choice));

vi.mock("../context/workspaceUtils", () => ({ getWorkspaceRoot: () => workspace }));
vi.mock("vscode", () => ({
  window: { showWarningMessage, showTextDocument: vi.fn(async () => undefined) },
  workspace: { get isTrusted() { return vscodeState.trusted; } },
  Uri: { file: (fsPath: string) => ({ fsPath }) },
}));
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  // Keep user-level hook files out of the real home directory.
  return { ...actual, homedir: () => join(workspace, "home") };
});

import { initHookConsent, runnableExternalHooks } from "./hookConsent";

function memento() {
  const data = new Map<string, unknown>();
  return { get: (key: string, fallback?: unknown) => data.has(key) ? data.get(key) : fallback, update: async (key: string, value: unknown) => { data.set(key, value); }, keys: () => [...data.keys()] };
}

function writeProjectHooks(command: string) {
  mkdirSync(join(workspace, ".cursor"), { recursive: true });
  writeFileSync(join(workspace, ".cursor", "hooks.json"), JSON.stringify({ version: 1, hooks: { beforeShellExecution: [{ command }] } }));
}

beforeEach(() => {
  vscodeState.trusted = true;
  vscodeState.choice = undefined;
  showWarningMessage.mockClear();
  initHookConsent({ globalState: memento() } as any);
});
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

describe("project hook consent", () => {
  it("skips project hooks in an untrusted workspace without prompting", async () => {
    writeProjectHooks("echo untrusted");
    vscodeState.trusted = false;
    expect(await runnableExternalHooks()).toEqual([]);
    expect(showWarningMessage).not.toHaveBeenCalled();
  });

  it("skips declined hooks and does not re-prompt for the same content", async () => {
    writeProjectHooks("echo declined");
    expect(await runnableExternalHooks()).toEqual([]);
    expect(await runnableExternalHooks()).toEqual([]);
    expect(showWarningMessage).toHaveBeenCalledTimes(1);
    expect((showWarningMessage.mock.calls[0] as any[])[1]).toMatchObject({ modal: true, detail: expect.stringContaining("echo declined") });
  });

  it("runs approved content and re-prompts when the file changes", async () => {
    writeProjectHooks("echo approved");
    vscodeState.choice = "Allow and Run";
    expect((await runnableExternalHooks()).map(h => h.command)).toEqual(["echo approved"]);
    vscodeState.choice = undefined;
    expect((await runnableExternalHooks()).map(h => h.command)).toEqual(["echo approved"]);
    expect(showWarningMessage).toHaveBeenCalledTimes(1);
    writeProjectHooks("echo changed");
    expect(await runnableExternalHooks()).toEqual([]);
    expect(showWarningMessage).toHaveBeenCalledTimes(2);
  });

  it("never runs project hooks before the consent store is initialized", async () => {
    vi.resetModules();
    const fresh = await import("./hookConsent.js");
    writeProjectHooks("echo uninitialized");
    vscodeState.choice = "Allow and Run";
    expect(await fresh.runnableExternalHooks()).toEqual([]);
  });
});
