/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { ProtocolValue } from "../../wireTypes.js";
// Safe JSON.parse: non-string passthrough; on parse error return caller-chosen `fallback`.
export function safeParseJSON(str: ProtocolValue, fallback: ProtocolValue) {
    if (typeof str !== "string")
        return str;
    try {
        return JSON.parse(str);
    }
    catch {
        return fallback;
    }
}
