/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "./types";

vi.mock("vscode", () => ({ EventEmitter: class { event = () => ({ dispose() {} }); fire() {} }, workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } }));
vi.mock("../context/workspaceUtils", () => ({
	getWorkspaceRoot: () => process.cwd(),
	safePath: (value: string) => value,
	withWorkspaceRoot: (_root: string, work: () => unknown) => work(),
	normalizeToolPaths: (_name: string, input: unknown) => input,
}));

import { coalesceEmit, withScanSlot, SCAN_CONCURRENCY, RO_CONCURRENCY } from "./loop";
import { streamPolicyFor } from "../shared/streamPolicy";

afterEach(() => { vi.useRealTimers(); });

describe("streamed tool argument previews", () => {
	it("ships the clipped latest args per flush and stops once the preview is full", () => {
		vi.useFakeTimers();
		const seen: AgentEvent[] = [];
		const emit = coalesceEmit((event) => seen.push(event));
		const limit = streamPolicyFor("Write").maxChars;
		emit({ type: "tool-call-started", callId: "w", name: "Write", input: {} });
		let args = "";
		const step = Math.ceil(limit / 50);
		while (args.length < limit * 3) {
			args += "x".repeat(step);
			emit({ type: "tool-call-args", callId: "w", argsText: args });
			vi.advanceTimersByTime(10);
		}
		vi.runAllTimers();
		const previews = seen.filter((event): event is Extract<AgentEvent, { type: "tool-call-args" }> => event.type === "tool-call-args");
		expect(previews.length).toBeGreaterThan(1);
		for (const preview of previews) expect(preview.argsText.length).toBeLessThanOrEqual(limit);
		// Previews grow monotonically and the full preview is sent exactly once.
		expect(previews.at(-1)!.argsText).toBe(args.slice(0, limit));
		expect(previews.filter((preview) => preview.argsText.length === limit)).toHaveLength(1);
		for (let i = 1; i < previews.length; i++) expect(previews[i].argsText.startsWith(previews[i - 1].argsText)).toBe(true);
	});

	it("keeps short previews unclipped and orders them before a completion", () => {
		const seen: AgentEvent[] = [];
		const emit = coalesceEmit((event) => seen.push(event));
		emit({ type: "tool-call-started", callId: "s", name: "Shell", input: {} });
		emit({ type: "tool-call-args", callId: "s", argsText: '{"command":"np' });
		emit({ type: "tool-call-args", callId: "s", argsText: '{"command":"npm test"}' });
		emit({ type: "tool-call-completed", callId: "s", name: "Shell", status: "completed", result: "ok" });
		expect(seen.map((event) => event.type)).toEqual(["tool-call-started", "tool-call-args", "tool-call-completed"]);
		expect(seen[1]).toMatchObject({ argsText: '{"command":"npm test"}' });
	});
});

describe("workspace scan concurrency", () => {
	it("sizes worker pools to the machine within fixed bounds", () => {
		expect(RO_CONCURRENCY).toBeGreaterThanOrEqual(4);
		expect(RO_CONCURRENCY).toBeLessThanOrEqual(8);
		expect(SCAN_CONCURRENCY).toBeGreaterThanOrEqual(2);
		expect(SCAN_CONCURRENCY).toBeLessThanOrEqual(6);
	});

	it("limits concurrent scans process-wide, hands slots over in order and leaves other tools alone", async () => {
		let active = 0, peak = 0;
		const releases: Array<() => void> = [];
		const scan = () => withScanSlot("Grep", new AbortController().signal, async () => {
			active++; peak = Math.max(peak, active);
			await new Promise<void>((resolve) => releases.push(resolve));
			active--;
			return "done";
		});
		const runs = Array.from({ length: SCAN_CONCURRENCY + 3 }, scan);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(active).toBe(SCAN_CONCURRENCY);
		// Unlimited tools run immediately even while every scan slot is taken.
		await expect(withScanSlot("Read", new AbortController().signal, async () => "read")).resolves.toBe("read");
		while (releases.length) {
			releases.shift()!();
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
		expect(await Promise.all(runs)).toEqual(runs.map(() => "done"));
		expect(peak).toBe(SCAN_CONCURRENCY);
		expect(active).toBe(0);
	});

	it("rejects a cancelled waiter without consuming a slot", async () => {
		const holders: Array<() => void> = [];
		const held = Array.from({ length: SCAN_CONCURRENCY }, () => withScanSlot("Glob", new AbortController().signal, () => new Promise<void>((resolve) => holders.push(resolve))));
		const cancelled = new AbortController();
		const waiting = withScanSlot("Glob", cancelled.signal, async () => "never");
		cancelled.abort(new Error("aborted: test"));
		await expect(waiting).rejects.toThrow("aborted: test");
		holders.forEach((release) => release());
		await Promise.all(held);
		// Every slot is free again.
		const again = await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, () => withScanSlot("Glob", new AbortController().signal, async () => 1)));
		expect(again).toHaveLength(SCAN_CONCURRENCY);
	});
});
