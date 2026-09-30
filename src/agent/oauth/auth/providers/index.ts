/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { AuthProvider } from "../types.js";
import p0 from "./claude.js";
import p1 from "./codex.js";
import p2 from "./antigravity.js";
import p3 from "./xai.js";
import p4 from "./grok-cli.js";
import p5 from "./gemini-cli.js";
import p6 from "./iflow.js";
import p7 from "./qoder.js";
import p8 from "./qoder-cn.js";
import p9 from "./github.js";
import p10 from "./kiro.js";
import p11 from "./cursor.js";
import p12 from "./kimi.js";
import p13 from "./kilocode.js";
import p14 from "./cline.js";
import p15 from "./clinepass.js";
import p16 from "./gitlab.js";
import p17 from "./codebuddy-cn.js";
import p18 from "./codebuddy-intl.js";
import p19 from "./kimchi.js";
import p20 from "./trae.js";
import p21 from "./windsurf.js";
import p22 from "./zed.js";
export const PROVIDERS: Record<string, AuthProvider> = {
  "claude": p0,
  "codex": p1,
  "antigravity": p2,
  "xai": p3,
  "grok-cli": p4,
  "gemini-cli": p5,
  "iflow": p6,
  "qoder": p7,
  "qoder-cn": p8,
  "github": p9,
  "kiro": p10,
  "cursor": p11,
  "kimi": p12,
  "kilocode": p13,
  "cline": p14,
  "clinepass": p15,
  "gitlab": p16,
  "codebuddy-cn": p17,
  "codebuddy-intl": p18,
  "kimchi": p19,
  "trae": p20,
  "windsurf": p21,
  "zed": p22
};
