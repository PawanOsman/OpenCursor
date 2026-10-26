/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it } from "vitest";
import { withStreamDeadline } from "./deadlines";
describe("provider stream deadlines", () => {
  it("bounds a hung connection even if the source ignores abort", async () => {
    const source = withStreamDeadline(async function* () { await new Promise(() => {}); yield 1; }, new AbortController().signal, 10, 10);
    await expect(source.next()).rejects.toThrow("connection deadline");
  });
  it("preserves the first event and rejects a stalled continuation", async () => {
    const source = withStreamDeadline(async function* () { yield "partial"; await new Promise(() => {}); }, new AbortController().signal, 100, 10);
    expect((await source.next()).value).toBe("partial");
    await expect(source.next()).rejects.toThrow("stalled");
  });
  it("does not count consumer time against the idle deadline and keeps every event", async () => {
    const source = withStreamDeadline(async function* () { for (let i = 0; i < 500; i++) yield i; }, new AbortController().signal, 1000, 20);
    const seen: number[] = [];
    for await (const value of source) {
      seen.push(value);
      if (value === 3) await new Promise(resolve => setTimeout(resolve, 60));
    }
    expect(seen).toHaveLength(500);
  });
  it("cancels a blocked read immediately", async () => {
    const abort = new AbortController();
    const source = withStreamDeadline(async function* () { await new Promise(() => {}); yield 1; }, abort.signal);
    const pending = source.next(); abort.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
