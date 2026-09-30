/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// Shared by the shipped host bundle and isolated feature smoke tests.
exports.hostBuildOptions = {
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: ['node20.18'],
  external: ['vscode', '@huggingface/transformers', '@huggingface/hub', 'onnxruntime-node', 'sharp', 'pdf-parse', '@lydell/node-pty', 'playwright-core'],
};
