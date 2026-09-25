/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// Finish/stop reason enums. Pure data — mapping LOGIC lives in concerns/finishReason.js.
// OpenAI finish_reason values (the hub format; shared across all response translators).
export const OPENAI_FINISH: Record<string, string> = {
    STOP: "stop",
    LENGTH: "length",
    TOOL_CALLS: "tool_calls",
    CONTENT_FILTER: "content_filter",
};
// Claude stop_reason values.
export const CLAUDE_STOP: Record<string, string> = {
    END_TURN: "end_turn",
    MAX_TOKENS: "max_tokens",
    TOOL_USE: "tool_use",
    STOP_SEQUENCE: "stop_sequence",
    // Anthropic's API-level refusal (streaming classifier / ToS). Arrives in
    // message_delta with zero output tokens; stop_details carries the reason.
    REFUSAL: "refusal",
};
// Gemini finishReason values.
export const GEMINI_FINISH: Record<string, string> = {
    STOP: "STOP",
    MAX_TOKENS: "MAX_TOKENS",
    SAFETY: "SAFETY",
    RECITATION: "RECITATION",
    BLOCKLIST: "BLOCKLIST",
    PROHIBITED_CONTENT: "PROHIBITED_CONTENT",
};
