/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { ProtocolValue } from "../../wireTypes.js";
// Derive a display name from a model id when the entry omits `name` (mirrors PATTERN_PRICING).
// Provider entries that ship their own `name` always win; this is only a fallback for terse entries.
// Capitalize a hyphen/space separated token group: "coder-plus" → "Coder Plus".
function titleCase(s: ProtocolValue) {
    return s
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((w: ProtocolValue) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
        .join(" ");
}
// Ordered: first match wins. Keep specific patterns above generic ones.
export const NAME_PATTERNS: ProtocolValue[] = [
    [/^kimi-k(\d+(?:\.\d+)?)(-thinking)?$/i, (m: ProtocolValue) => `Kimi K${m[1]}${m[2] ? " Thinking" : ""}`],
    [/^glm-(\d+(?:\.\d+)?)(v)?$/i, (m: ProtocolValue) => `GLM ${m[1]}${m[2] ? "V (Vision)" : ""}`],
    [/^minimax-m(\d+(?:\.\d+)?)$/i, (m: ProtocolValue) => `MiniMax M${m[1]}`],
    [/^gpt-(.+)$/i, (m: ProtocolValue) => `GPT ${titleCase(m[1])}`],
    [/^gemini-(.+)$/i, (m: ProtocolValue) => `Gemini ${titleCase(m[1])}`],
    [/^grok-(.+)$/i, (m: ProtocolValue) => `Grok ${titleCase(m[1])}`],
    [/^deepseek-(.+)$/i, (m: ProtocolValue) => `DeepSeek ${titleCase(m[1])}`],
    [/^qwen([\d.]+.*)$/i, (m: ProtocolValue) => `Qwen ${titleCase(m[1])}`],
];
// id → display name (regex fallback → id verbatim)
export function deriveModelName(id: ProtocolValue) {
    if (typeof id !== "string")
        return id;
    for (const [re, fn] of NAME_PATTERNS) {
        const m = id.match(re);
        if (m)
            return fn(m);
    }
    return id;
}
