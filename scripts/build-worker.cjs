/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

const path = require('node:path');
const { build } = require('esbuild');
const { hostBuildOptions } = require('../esbuild-options.cjs');
build({ ...hostBuildOptions, entryPoints: ['src/worker/main.ts'], outfile: 'dist/worker.cjs',
  external: hostBuildOptions.external.filter(name => name !== 'vscode'),
  alias: { vscode: path.resolve(__dirname, 'headless-vscode.cjs') }, sourcemap: true,
}).catch(error => { console.error(error.message); process.exitCode = 1; });
