/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// Per-request cancellation; never monkey-patch global fetch.
import { authFetch } from '../../auth/network.js';
export function proxyAwareFetch(url: string | URL | Request, init: RequestInit = {}, _proxyOptions?: unknown): ReturnType<typeof authFetch> {
    return authFetch(url, init);
}
