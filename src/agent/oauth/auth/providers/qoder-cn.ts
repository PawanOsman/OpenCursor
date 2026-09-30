/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { QODER_CN_CONFIG } from "../constants/oauth.js";
import { createQoderProvider } from "./qoder.js";

// Qoder CN (qoder.com.cn) — same device flow as intl Qoder, CN endpoints.
export default createQoderProvider(QODER_CN_CONFIG);
