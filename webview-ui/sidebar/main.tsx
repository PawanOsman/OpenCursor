/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as React from "react";
import { createRoot } from "react-dom/client";
import "./sidebar.css";
import "../shared/code-highlighting.css";
import { App, ErrorBoundary } from "./App";
import "../shared/motion.css";
import { initializeMotionPreference } from "../shared/motionPreference";

initializeMotionPreference();
const root = createRoot(document.getElementById("root")!);
root.render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
