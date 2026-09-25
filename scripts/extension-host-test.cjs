/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
(async () => {
  let display;
  try {
    const env = { ...process.env };
    if (process.platform === 'linux' && !env.DISPLAY) {
      display = spawn('Xvfb', ['-displayfd', '1', '-screen', '0', '1280x900x24', '-nolisten', 'tcp'], { stdio: ['ignore', 'pipe', 'inherit'] });
      env.DISPLAY = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Xvfb did not start')), 10000);
        display.once('error', error => { clearTimeout(timer); reject(error); });
        display.stdout.once('data', data => { clearTimeout(timer); resolve(':' + String(data).trim()); });
      });
    }
    await new Promise((resolve, reject) => {
      // Windows cannot directly spawn a .cmd shim without a shell. Forward
      // argv to the CLI through Node so shell quoting never changes arguments.
      const cli = path.join(path.dirname(require.resolve('@vscode/test-cli')), 'bin.mjs');
      const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], { env, windowsHide: true, stdio: 'inherit' });
      child.once('error', reject);
      child.once('close', code => code === 0 ? resolve() : reject(new Error(`Extension host tests exited ${code}`)));
    });
  } finally { display?.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
