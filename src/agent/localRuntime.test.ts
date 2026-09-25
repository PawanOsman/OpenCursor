/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";
import { estimateModelFit, normalizeLocalEndpoint, stopLocalProcess, type LocalHardware } from "./localRuntime";

const GiB = 1024 ** 3;
const hardware: LocalHardware = { sampledAt: "2026-01-01", totalMemoryBytes: 32 * GiB, freeMemoryBytes: 20 * GiB,
  logicalCpus: 16, cpuModel: "Fixture", gpus: [], gpuProbe: "unavailable" };
describe("local runtime hardware advice", () => {
  it("uses measured available memory rather than total installed memory", () => {
    expect(estimateModelFit(5 * GiB, hardware)).toMatchObject({ level: "comfortable", recommendedThreads: 8, recommendedContext: 8192 });
    expect(estimateModelFit(5 * GiB, { ...hardware, freeMemoryBytes: 2 * GiB })).toMatchObject({ level: "insufficient", recommendedContext: 4096 });
  });
  it("does not add separate GPU and system memory into a fictional allocation", () => {
    const fit = estimateModelFit(10 * GiB, { ...hardware, freeMemoryBytes: 8 * GiB, gpus: [{ name: "GPU", totalBytes: 8 * GiB, freeBytes: 8 * GiB }] });
    expect(fit.level).toBe("insufficient");
    expect(estimateModelFit(undefined, hardware).level).toBe("unknown");
  });
  it("normalizes endpoints and rejects embedded credentials or non-HTTP schemes", () => {
    expect(normalizeLocalEndpoint("http://localhost:11434/v1/")).toBe("http://localhost:11434");
    expect(() => normalizeLocalEndpoint("file:///tmp/model")).toThrow();
    expect(() => normalizeLocalEndpoint("https://user:password@example.com")).toThrow();
  });
});

describe("local process shutdown", () => {
  it("shares concurrent stop requests and resolves only after close", async () => {
    const proc = Object.assign(new EventEmitter(), { kill: vi.fn(() => true), exitCode: null, signalCode: null });
    const first = stopLocalProcess(proc as unknown as ChildProcess);
    const second = stopLocalProcess(proc as unknown as ChildProcess);
    expect(first).toBe(second);
    expect(proc.kill).toHaveBeenCalledTimes(1);
    let resolved = false;
    void first.then(() => { resolved = true; });
    proc.emit("exit", 0);
    await Promise.resolve();
    expect(resolved).toBe(false);
    proc.emit("close", 0);
    await first;
    expect(resolved).toBe(true);
  });

  it("reports an unconfirmed shutdown and permits a later retry", async () => {
    const proc = Object.assign(new EventEmitter(), { kill: vi.fn(() => true), exitCode: null, signalCode: null });
    await expect(stopLocalProcess(proc as unknown as ChildProcess, 1)).rejects.toThrow("did not confirm");
    const retry = stopLocalProcess(proc as unknown as ChildProcess);
    proc.emit("close", 0);
    await retry;
  });
});
