/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { ProtocolCredentials } from "../wireTypes.js";
// Barrel: PROVIDERS now built from providers/registry (transport co-located with models)
import { PROVIDERS } from "../providers/index.js";
export { PROVIDERS, PROVIDER_OAUTH } from "../providers/index.js";
export const OLLAMA_LOCAL_DEFAULT_HOST = "http://localhost:11434";
export function resolveOllamaLocalHost(credentials: ProtocolCredentials) {
    const raw = credentials?.providerSpecificData?.baseUrl?.trim();
    return (raw || OLLAMA_LOCAL_DEFAULT_HOST).replace(/\/$/, "");
}
// Region URLs single-source from registry xiaomi-tokenplan.transport
export const XIAOMI_TOKENPLAN_REGIONS = PROVIDERS["xiaomi-tokenplan"]?.regions || {};
export const XIAOMI_TOKENPLAN_DEFAULT_REGION = PROVIDERS["xiaomi-tokenplan"]?.defaultRegion;
export function resolveXiaomiTokenplanBaseUrl(credentials: ProtocolCredentials) {
    const region = credentials?.providerSpecificData?.region;
    return XIAOMI_TOKENPLAN_REGIONS[region] || XIAOMI_TOKENPLAN_REGIONS[XIAOMI_TOKENPLAN_DEFAULT_REGION];
}
