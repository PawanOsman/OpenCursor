/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { ProtocolValue, ProtocolRecord } from "../wireTypes.js";
// Format identifiers
export const FORMATS: Record<string, string> = {
    OPENAI: "openai",
    OPENAI_RESPONSES: "openai-responses",
    OPENAI_RESPONSE: "openai-response",
    CLAUDE: "claude",
    GEMINI: "gemini",
    GEMINI_CLI: "gemini-cli",
    VERTEX: "vertex",
    CODEX: "codex",
    ANTIGRAVITY: "antigravity",
    KIRO: "kiro",
    CURSOR: "cursor",
    OLLAMA: "ollama",
    COMMANDCODE: "commandcode"
};
/**
 * Detect source format from request URL pathname + body.
 * Returns null to fall back to body-based detection.
 */
export function detectFormatByEndpoint(pathname: ProtocolValue, body: ProtocolRecord) {
    // /v1/responses is always openai-responses
    if (pathname.includes("/v1/responses"))
        return FORMATS.OPENAI_RESPONSES;
    // /v1/messages is always Claude
    if (pathname.includes("/v1/messages"))
        return FORMATS.CLAUDE;
    // /v1/chat/completions + input[] → treat as openai (Cursor CLI sends Responses body via chat endpoint)
    if (pathname.includes("/v1/chat/completions") && Array.isArray(body?.input)) {
        return FORMATS.OPENAI;
    }
    return null;
}
