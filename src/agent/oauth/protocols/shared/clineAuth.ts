/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { ProtocolValue, ProtocolRecord } from "../wireTypes.js";
const pkg: Record<string, string> = { version: "0.2.0" };
const APP_VERSION = pkg.version || "0.0.0";
export function getClineAccessToken(token: ProtocolValue) {
    if (typeof token !== "string")
        return "";
    const trimmed = token.trim();
    if (!trimmed)
        return "";
    if (trimmed.toLowerCase().startsWith("workos:"))
        return trimmed;
    // Cline OAuth access tokens are WorkOS JWTs (base64url `eyJ…` header).
    // ClinePass API keys (category "apikey", e.g. `clp_…`) are NOT JWTs and must
    // be sent verbatim — prefixing them with `workos:` makes the Cline API reject
    // the request with HTTP 401 ("Please make sure you're using the latest
    // version of Cline and re-authenticate your Cline account.").
    const isWorkOsJwt = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(trimmed);
    return isWorkOsJwt ? `workos:${trimmed}` : trimmed;
}
export function getClineAuthorizationHeader(token: ProtocolValue) {
    const accessToken = getClineAccessToken(token);
    return accessToken ? `Bearer ${accessToken}` : "";
}
export function buildClineHeaders(token: ProtocolValue, extraHeaders: ProtocolValue = {}) {
    const authorization = getClineAuthorizationHeader(token);
    const headers: ProtocolRecord = {
        "HTTP-Referer": "https://cline.bot",
        "X-Title": "Cline",
        "User-Agent": `OpenCursor/${APP_VERSION}`,
        "X-PLATFORM": process.platform || "unknown",
        "X-PLATFORM-VERSION": process.version || "unknown",
        "X-CLIENT-TYPE": "opencursor",
        "X-CLIENT-VERSION": APP_VERSION,
        "X-CORE-VERSION": APP_VERSION,
        "X-IS-MULTIROOT": "false",
        ...extraHeaders,
    };
    if (authorization) {
        headers.Authorization = authorization;
    }
    return headers;
}
