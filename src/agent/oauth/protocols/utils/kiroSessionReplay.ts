/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { ProtocolValue, ProtocolRecord } from "../wireTypes.js";
import { MEMORY_CONFIG } from "../config/runtimeConfig.js";
const sessionStartStore = new Map();
const MAX_SESSION_STARTS = 5000;
function clone(value: ProtocolValue) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}
function sessionKey(connectionId: string, conversationId: ProtocolValue) {
    return `${connectionId || ""}:${conversationId || ""}`;
}
function ensureUserMessageModelId(message: ProtocolRecord, modelId: string) {
    if (message?.userInputMessage && !message.userInputMessage.modelId && modelId) {
        message.userInputMessage.modelId = modelId;
    }
    return message;
}
function ensureHistoryModelIds(history: ProtocolValue, modelId: string) {
    for (const item of history || []) {
        ensureUserMessageModelId(item, modelId);
    }
    return history;
}
function prefixUserMessage(message: ProtocolRecord, contentPrefix: ProtocolValue, modelId: string) {
    const out = clone(message) || { userInputMessage: { content: "" } };
    if (!out.userInputMessage)
        out.userInputMessage = { content: "" };
    ensureUserMessageModelId(out, modelId);
    if (contentPrefix) {
        const content = out.userInputMessage.content || "";
        out.userInputMessage.content = content
            ? `${contentPrefix}\n\n${content}`
            : contentPrefix;
    }
    return out;
}
function findFirstUserIndex(history: ProtocolValue) {
    return history.findIndex((item: ProtocolValue) => item?.userInputMessage);
}
function hasToolResults(message: ProtocolRecord) {
    return !!message?.userInputMessage?.userInputMessageContext?.toolResults?.length;
}
function canReplaceSessionStart(history: ProtocolValue, firstUserIndex: ProtocolValue) {
    return firstUserIndex === 0 && !hasToolResults(history[firstUserIndex]);
}
function rememberSessionStart(key: ProtocolValue, entry: ProtocolValue) {
    if (sessionStartStore.size >= MAX_SESSION_STARTS) {
        sessionStartStore.delete(sessionStartStore.keys().next().value);
    }
    sessionStartStore.set(key, { ...entry, lastUsed: Date.now() });
}
/**
 * Preserve Kiro cacheability by freezing the first user message (`msg0`) for a
 * session, replaying that exact message as the first history user on later
 * turns, and injecting volatile current-time context only into the current turn.
 */
export function applyKiroSessionReplay({ conversationId, connectionId, modelId, systemPrompt = "", contentPrefix = "", currentContentPrefix = "", history = [], currentMessage, }: ProtocolValue = {}) {
    const key = sessionKey(connectionId, conversationId);
    const existing = conversationId ? sessionStartStore.get(key) : null;
    const baseHistory = clone(history) || [];
    const baseCurrent = clone(currentMessage) || { userInputMessage: { content: "" } };
    if (existing && existing.modelId === modelId && existing.systemPrompt === systemPrompt) {
        existing.lastUsed = Date.now();
        const firstUserIndex = findFirstUserIndex(baseHistory);
        const sessionStart = ensureUserMessageModelId(clone(existing.sessionStart), modelId);
        if (canReplaceSessionStart(baseHistory, firstUserIndex)) {
            baseHistory[firstUserIndex] = sessionStart;
        }
        else {
            baseHistory.unshift(sessionStart);
            if (baseHistory.length === 1) {
                baseHistory.push({ assistantResponseMessage: { content: "..." } });
            }
        }
        return {
            history: ensureHistoryModelIds(baseHistory, modelId),
            currentMessage: prefixUserMessage(baseCurrent, currentContentPrefix, modelId),
            replayed: true,
        };
    }
    const firstUserIndex = findFirstUserIndex(baseHistory);
    let sessionStart: ProtocolValue;
    let nextCurrent = ensureUserMessageModelId(baseCurrent, modelId);
    if (canReplaceSessionStart(baseHistory, firstUserIndex)) {
        sessionStart = prefixUserMessage(baseHistory[firstUserIndex], contentPrefix, modelId);
        baseHistory[firstUserIndex] = clone(sessionStart);
        nextCurrent = prefixUserMessage(baseCurrent, currentContentPrefix, modelId);
    }
    else if (firstUserIndex >= 0) {
        sessionStart = prefixUserMessage({ userInputMessage: { content: "", modelId } }, contentPrefix, modelId);
        baseHistory.unshift(clone(sessionStart));
        nextCurrent = prefixUserMessage(baseCurrent, currentContentPrefix, modelId);
    }
    else {
        sessionStart = prefixUserMessage(baseCurrent, contentPrefix, modelId);
        nextCurrent = clone(sessionStart);
    }
    if (conversationId) {
        rememberSessionStart(key, {
            sessionStart: clone(sessionStart),
            modelId,
            systemPrompt,
        });
    }
    return {
        history: ensureHistoryModelIds(baseHistory, modelId),
        currentMessage: nextCurrent,
        replayed: false,
    };
}
export function clearKiroSessionReplayStore() {
    sessionStartStore.clear();
}
const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of sessionStartStore) {
        if (now - entry.lastUsed > MEMORY_CONFIG.sessionTtlMs)
            sessionStartStore.delete(key);
    }
}, MEMORY_CONFIG.sessionCleanupIntervalMs);
if (cleanup.unref)
    cleanup.unref();
