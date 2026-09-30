/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderEvent } from "../types";
import { ApiKeyPool } from "./apiKeyPool";

vi.mock("vscode", () => ({ EventEmitter: class { event = () => ({ dispose() {} }); fire() {} } }));
vi.mock("../../stores/featureStore", () => ({ MODEL_CATALOG: [] }));
import { generateTitle, listModels, pickModel, streamChat } from "../provider";

const endpoint = "https://fixture.example.test/v1";
const pool = () => new ApiKeyPool("fixture", endpoint, async () => ({ balance: "round-robin", credentials: [
  { id: "first", apiKey: "first-secret", legacy: false }, { id: "second", apiKey: "second-secret", legacy: false },
] }));
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const sse = (...frames: unknown[]) => new Response(frames.map(frame => `data: ${typeof frame === "string" ? frame : JSON.stringify(frame)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
afterEach(() => vi.unstubAllGlobals());

describe("production transport with API credential pools", () => {
  it("uses a different key on failed chat authentication and rotates the next turn", async () => {
    const requests: string[] = [];
    const apiKeyPool = pool();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(new Headers(init.headers).get("authorization")!);
      return requests.length === 1 ? json({ error: { message: "expired key" } }, 401)
        : sse({ choices: [{ delta: { content: "Done" }, finish_reason: "stop" }] }, "[DONE]");
    }));
    for (let i = 0; i < 2; i++) {
      const seen: ProviderEvent[] = [];
      for await (const event of streamChat({ apiBaseUrl: endpoint, apiKey: "unused", apiKeyPool, model: "fixture-model", messages: [{ role: "user", content: "hi" }], signal: new AbortController().signal })) seen.push(event);
      expect(seen.filter(event => event.type === "text-delta")).toEqual([{ type: "text-delta", text: "Done" }]);
    }
    expect(requests).toEqual(["Bearer first-secret", "Bearer second-secret", "Bearer second-secret"]);
  });

  it("never retries a truncated response after displaying its text", async () => {
    const fetchMock = vi.fn(async () => sse({ choices: [{ delta: { content: "Already visible" } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const seen: ProviderEvent[] = [];
    await expect((async () => {
      for await (const event of streamChat({ apiBaseUrl: endpoint, apiKey: "", apiKeyPool: pool(), model: "fixture-model", messages: [], signal: new AbortController().signal })) seen.push(event);
    })()).rejects.toMatchObject({ retryable: false });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(seen).toContainEqual({ type: "text-delta", text: "Already visible" });
  });

  it.each(["title", "judge", "models"] as const)("fails over an HTTP error during %s requests", async purpose => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      if (new Headers(init.headers).get("authorization") === "Bearer first-secret") return json({ error: { message: "busy" } }, 429);
      return json(purpose === "models" ? { data: [{ id: "candidate" }] } : { choices: [{ message: { content: purpose === "title" ? '{"title":"Inspect files"}' : "candidate" } }], usage: { prompt_tokens: 12, completion_tokens: 4 } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const options = { apiKeyPool: pool(), signal: new AbortController().signal, onUsage: vi.fn() };
    if (purpose === "title") expect(await generateTitle(endpoint, "", "fixture-model", "Inspect files", false, undefined, options)).toBe("Inspect files");
    else if (purpose === "judge") expect(await pickModel(endpoint, "", "fixture-model", ["candidate"], "Inspect files", false, undefined, options)).toBe("candidate");
    else expect(await listModels(endpoint, "", false, options)).toEqual([{ id: "candidate" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    if (purpose !== "models") expect(options.onUsage).toHaveBeenCalledOnce();
  });
});
