/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { AuthProvider } from "../types.js";
import { CURSOR_CONFIG } from "../constants/oauth.js";

const cursor: AuthProvider = {
  config: CURSOR_CONFIG,
  flowType: "import_token",
  // Cursor accepts only the account token explicitly supplied by the user.
  mapTokens: (tokens) => ({
    accessToken: tokens.accessToken,
    refreshToken: null, // Cursor doesn't have public refresh endpoint
    expiresIn: tokens.expiresIn || 86400,
    providerSpecificData: {
      machineId: tokens.machineId,
      authMethod: "imported",
    },
  }),
};

export default cursor;
