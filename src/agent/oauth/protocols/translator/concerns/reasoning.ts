/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { ProtocolValue, ProtocolRecord } from "../../wireTypes.js";
import { ROLE } from "../schema/index.js";
// Build OpenAI delta carrying reasoning_content (optional leading assistant role)
export function reasoningDelta(text: ProtocolValue, withRole = false) {
    return withRole
        ? { role: ROLE.ASSISTANT, reasoning_content: text }
        : { reasoning_content: text };
}
// Extract reasoning text from a streamed OpenAI-compatible delta across vendor shapes:
//   - reasoning_content (GLM, Qwen, DeepSeek, Kimi, Step, Hunyuan)
//   - reasoning (some compat layers)
//   - reasoning_details[] (MiniMax reasoning_split=true): [{ text|content }]
// Returns concatenated reasoning string, or "" when none.
export function extractReasoningText(delta: ProtocolRecord) {
    if (!delta || typeof delta !== "object")
        return "";
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content)
        return delta.reasoning_content;
    if (typeof delta.reasoning === "string" && delta.reasoning)
        return delta.reasoning;
    const details = delta.reasoning_details;
    if (Array.isArray(details)) {
        return details.map((d: ProtocolValue) => (typeof d === "string" ? d : d?.text || d?.content || "")).join("");
    }
    return "";
}
