/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

/** Timeout/abort contracts use the production wrapper; loop outcomes live in evaluations.test.ts. */
import { describe, expect, it, vi } from "vitest";
import { withToolTimeout } from "./shared";

vi.mock("vscode", () => ({ EventEmitter: class { event = () => ({ dispose() {} }); fire() {} }, workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } }));

describe("production tool timeout and cancellation", () => {
  it("rejects an already-aborted signal even without a wall-clock limit", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(withToolTimeout(Promise.resolve("late"), 0, "Task", undefined, controller.signal)).rejects.toThrow("aborted:");
  });
  it("settles cancellation without misreporting a timeout", async () => {
    const controller = new AbortController(), cancel = vi.fn();
    let finish!: (value: string) => void;
    const work = new Promise<string>((resolve) => { finish = resolve; });
    const result = withToolTimeout(work, 1000, "Read", cancel, controller.signal);
    const assertion = expect(result).rejects.toThrow("aborted:");
    controller.abort(); await assertion; finish("late completion");
    await Promise.resolve(); expect(cancel).not.toHaveBeenCalled();
  });
  it("rejects a hung tool on timeout and accepts an ordinary completed tool", async () => {
    const cancel = vi.fn();
    await expect(withToolTimeout(new Promise(() => {}), 5, "Read", cancel)).rejects.toThrow("timeout:");
    expect(cancel).toHaveBeenCalledTimes(1);
    await expect(withToolTimeout(Promise.resolve("completed"), 100, "Read")).resolves.toBe("completed");
  });
});
