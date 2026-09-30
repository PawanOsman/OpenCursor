/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { ProtocolValue } from "../wireTypes.js";
// Preserve the caller's actual tool schema; never inject decoy tools.
export const applyFingerprintTools = (..._request: unknown[]): Map<string, string> => new Map();
export const takeRenamedToolNames = () => null;
export const recordRenamedToolNames = (..._names: unknown[]): void => { };
export const restoreToolNames = (payload: ProtocolValue) => payload;
