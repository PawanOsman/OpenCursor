/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { ProtocolValue } from "../../wireTypes.js";
// Codex auto-generates a "-review" variant for each llm model (review quota family)
export const CODEX_REVIEW_SUFFIX = "-review";
export function withCodexReviewModels(models: ProtocolValue) {
    return models.flatMap((model: ProtocolValue) => {
        if ((model.kind || model.type || "llm") !== "llm" || model.id.endsWith(CODEX_REVIEW_SUFFIX)) {
            return [model];
        }
        return [
            model,
            {
                ...model,
                id: `${model.id}${CODEX_REVIEW_SUFFIX}`,
                name: `${model.name} Review`,
                upstreamModelId: model.upstreamModelId || model.id,
                quotaFamily: "review"
            }
        ];
    });
}
export function isMuseSparkModel(modelId: string) {
    if (!modelId || typeof modelId !== "string")
        return false;
    const clean = modelId.replace(/\([^()]+\)\s*$/, "").trim();
    const base = clean.includes("/") ? clean.split("/").pop()! : clean;
    return /^muse[-_]?spark(?:$|[-_:.\s])/i.test(base);
}
