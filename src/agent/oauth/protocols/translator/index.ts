/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { TranslatorState } from "../wireTypes.js";
import { FORMATS } from './formats.js';
export { register, translateRequest, translateResponse } from './registry.js';
export function initState(sourceFormat: string): TranslatorState {
    // Base state for all formats
    const base: TranslatorState = {
        messageId: null,
        model: null,
        textBlockStarted: false,
        thinkingBlockStarted: false,
        inThinkingBlock: false,
        currentBlockIndex: null,
        toolCalls: new Map(),
        finishReason: null,
        finishReasonSent: false,
        usage: null,
        contentBlockIndex: -1
    };
    // Add openai-responses specific fields
    if (sourceFormat === FORMATS.OPENAI_RESPONSES) {
        return {
            ...base,
            seq: 0,
            responseId: `resp_${Date.now()}`,
            created: Math.floor(Date.now() / 1000),
            started: false,
            msgTextBuf: {},
            msgItemAdded: {},
            msgContentAdded: {},
            msgItemDone: {},
            reasoningId: "",
            reasoningIndex: -1,
            reasoningBuf: "",
            reasoningPartAdded: false,
            reasoningDone: false,
            inThinking: false,
            funcArgsBuf: {},
            funcNames: {},
            funcCallIds: {},
            funcItemAdded: {},
            funcArgsDone: {},
            funcItemDone: {},
            customToolNames: new Set(),
            completedSent: false
        };
    }
    return base;
}
import './request/openai-to-kiro.js';
import './request/openai-to-cursor.js';
import './request/openai-to-gemini.js';
import './request/openai-to-claude.js';
import './request/openai-responses.js';
import './request/openai-to-commandcode.js';
import './request/openai-to-ollama.js';
import './response/claude-to-openai.js';
import './response/gemini-to-openai.js';
import './response/openai-responses.js';
import './response/commandcode-to-openai.js';
import './response/ollama-to-openai.js';
