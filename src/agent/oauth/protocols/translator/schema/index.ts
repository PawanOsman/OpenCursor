/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// Translator schema barrel — pure data enums (roles, blocks). No logic here.
export { ROLE, GEMINI_ROLE } from "./roles.js";
export { OPENAI_BLOCK, CLAUDE_BLOCK, RESPONSES_ITEM, VALID_OPENAI_CONTENT_TYPES, VALID_OPENAI_MESSAGE_TYPES, } from "./blocks.js";
export { OPENAI_FINISH, CLAUDE_STOP, GEMINI_FINISH } from "./finishReasons.js";
export { MODEL_FALLBACK, DEFAULT_IMAGE_MIME } from "./defaults.js";
