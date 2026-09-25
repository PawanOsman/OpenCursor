/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { ProtocolRecord, ProtocolCredentials, ResponseChunk, TranslatorState } from "../wireTypes.js";

type RequestConverter = (model: string, body: ProtocolRecord, stream: boolean, credentials: ProtocolCredentials) => ProtocolRecord | null;
type ResponseConverter = (chunk: ProtocolRecord, state: TranslatorState) => ResponseChunk | ResponseChunk[] | null | undefined;

// Keep these hoisted: translator modules register through circular ESM imports.
var requests: Map<string, RequestConverter> | undefined;
var responses: Map<string, ResponseConverter> | undefined;

export function register(from: string, to: string, request: RequestConverter | null, response: ResponseConverter | null): void {
    requests ??= new Map();
    responses ??= new Map();
    if (request) requests.set(`${from}:${to}`, request);
    if (response) responses.set(`${from}:${to}`, response);
}

export function translateRequest(from: string, to: string, model: string, body: ProtocolRecord, stream: boolean, credentials: ProtocolCredentials): ProtocolRecord | null {
    if (from === to) return body;
    const convert = requests?.get(`${from}:${to}`);
    if (!convert) throw new Error(`Unsupported provider request format: ${to}`);
    return convert(model, body, stream, credentials);
}

export function translateResponse(from: string, to: string, chunk: ProtocolRecord, state: TranslatorState): ResponseChunk[] {
    if (from === to) return [chunk];
    const convert = responses?.get(`${from}:${to}`);
    if (!convert) throw new Error(`Unsupported provider response format: ${from}`);
    const result = convert(chunk, state);
    return result == null ? [] : Array.isArray(result) ? result : [result];
}
