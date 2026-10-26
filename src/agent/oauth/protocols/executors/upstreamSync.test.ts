/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it } from "vitest";
import {
  QODER_QUEUE_CODE,
  computeQoderQueueDelayMs,
  parseQoderQueueInfo,
  parseQoderQueueStatus,
  qoderQueueStatusUrl,
} from "../shared/qoder/queue.js";
import { getQoderStaticModelConfig } from "../shared/qoder/constants.js";
import { deriveMachineId } from "../shared/qoder/cosy.js";
import { __test__ as qoderInternals } from "./qoder.js";
import { normalizeKiroUpstreamModelId, resolveKiroModel, extractKiroEffortLevel } from "../config/kiroConstants.js";
import { GROK_CLI_PAGER_USER_AGENT, GROK_CLI_USER_AGENT, GROK_CLI_VERSION } from "../config/grokCli.js";
import { tailOnlyCursorMessages } from "./cursor.js";
import { resolveAutoModelSelection } from "../utils/cursorModels.js";

describe("Qoder model queue", () => {
  const queueObject = { isQueued: true, modelKey: "auto", queueType: "p3", retryAfterSeconds: 30, subCode: "RESOURCE_LIMIT" };
  const nested = JSON.stringify({
    code: "403",
    message: JSON.stringify({ code: QODER_QUEUE_CODE, message: JSON.stringify(queueObject) }),
  });

  it("parses the queue signal through nested JSON strings", () => {
    const info = parseQoderQueueInfo(nested);
    expect(info).toMatchObject({ isQueued: true, modelKey: "auto", queueType: "p3", retryAfterSeconds: 30 });
    expect(parseQoderQueueInfo(JSON.stringify({ code: "112" }))).toBeNull();
  });

  it("clamps delays and floors status-derived hints", () => {
    expect(computeQoderQueueDelayMs({ retryAfterSeconds: 2 })).toBe(15_000);
    expect(computeQoderQueueDelayMs({ retryAfterSeconds: 2 }, { fromStatus: true })).toBe(30_000);
    expect(computeQoderQueueDelayMs({ retryAfterSeconds: 600 })).toBe(60_000);
    expect(computeQoderQueueDelayMs(null)).toBe(30_000);
  });

  it("builds the qodercli queue-status URL and parses its response", () => {
    expect(qoderQueueStatusUrl("https://api.example", { requestSetId: "r1", modelKey: "auto", queueType: "p3" }))
      .toBe("https://api.example/algo/api/v2/service/ask/queue/status?requestSetId=r1&modelKey=auto&queueType=p3");
    expect(parseQoderQueueStatus('{"isQueued":false,"queueCount":0}')).toMatchObject({ isQueued: false, queueCount: 0 });
    expect(parseQoderQueueStatus('{"foo":1}')).toBeNull();
  });

  it("no longer treats the 10605 queue throttle as a billing block", () => {
    expect(qoderInternals.isBillingBlock('{"code":"10605"}')).toBe(false);
    expect(qoderInternals.isBillingBlock('{"code":"112"}')).toBe(true);
  });

  it("ships static model configs for Sonus/Cantus and a stable derived machine id", () => {
    expect(getQoderStaticModelConfig("smodel")).toMatchObject({ key: "smodel", display_name: "Sonus", source: "system" });
    expect(getQoderStaticModelConfig("unknown")).toBeNull();
    expect(deriveMachineId("user-1")).toBe(deriveMachineId("user-1"));
    expect(deriveMachineId("user-1")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("Kiro model normalization", () => {
  it("folds Anthropic ids onto Kiro aliases", () => {
    expect(normalizeKiroUpstreamModelId("claude-sonnet-4-5-20250929")).toBe("claude-sonnet-4.5");
    expect(normalizeKiroUpstreamModelId("claude-opus-4-7")).toBe("claude-opus-4.7");
    expect(resolveKiroModel("claude-haiku-4-5").upstream).toBe("claude-haiku-4.5");
  });

  it("keeps xhigh/max for models that support them", () => {
    expect(extractKiroEffortLevel({ reasoning_effort: "xhigh" }, "claude-opus-4.7")).toBe("xhigh");
    expect(extractKiroEffortLevel({ reasoning_effort: "xhigh" }, "claude-sonnet-4.6")).toBe("high");
    expect(extractKiroEffortLevel({ reasoning_effort: "max" }, "claude-sonnet-4.6")).toBe("max");
  });
});

describe("Grok CLI identity", () => {
  it("uses the current grok-shell release", () => {
    expect(GROK_CLI_VERSION).toBe("1.0.44");
    expect(GROK_CLI_USER_AGENT).toBe("grok-shell/1.0.44 (linux; x86_64)");
    expect(GROK_CLI_PAGER_USER_AGENT).toBe("grok-pager/1.0.44 grok-shell/1.0.44 (linux; x86_64)");
  });
});

describe("Cursor agent helpers", () => {
  it("trims long sessions to the latest turn", () => {
    const messages = [
      { role: "system", content: "sys" },
      ...Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` })),
    ];
    const tail = tailOnlyCursorMessages(messages);
    expect(tail[0]).toEqual({ role: "system", content: "sys" });
    expect(tail[1].content).toContain("Long session: 11 messages");
    expect(tail.slice(2).map((m) => m.content)).toEqual(["m7", "m8", "m9"]);
  });

  it("resolves auto to the default agent-capable model", () => {
    expect(resolveAutoModelSelection([
      { id: "a", supportsAgent: true },
      { id: "b", supportsAgent: true, defaultOn: true },
      { id: "c", supportsAgent: true, defaultOn: true, isHidden: true },
    ])).toEqual({ modelId: "b", matchedBy: "auto-default" });
    expect(resolveAutoModelSelection([])).toBeNull();
  });
});
