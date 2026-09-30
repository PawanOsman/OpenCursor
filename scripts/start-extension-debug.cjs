/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

'use strict';

const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

function checkPort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (error) => reject(new Error(`Inspector port ${port} is unavailable (${error.code}). Close the previous development window or choose another port.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

function probeInspector(port, timeoutMs = 750) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ready) => { if (!settled) { settled = true; clearTimeout(timer); resolve(ready); } };
    const request = http.get({ hostname: '127.0.0.1', port, path: '/json/list', agent: false }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > 64 * 1024) { finish(false); request.destroy(); }
      });
      response.on('error', () => finish(false));
      response.on('end', () => {
        try {
          const targets = JSON.parse(body);
          finish(response.statusCode === 200 && Array.isArray(targets) && targets.some((target) => {
            const address = new URL(target.webSocketDebuggerUrl);
            return address.protocol === 'ws:' && ['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname)
              && Number(address.port) === port && address.pathname.length > 1;
          }));
        } catch { finish(false); }
      });
    });
    const timer = setTimeout(() => { finish(false); request.destroy(); }, timeoutMs);
    request.on('error', () => finish(false));
  });
}

async function startExtensionDebug(executable, port, options = {}) {
  if (!executable || !path.isAbsolute(executable)) throw new Error('Provide the absolute VS Code executable path as the first argument.');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Inspector port must be an integer between 1024 and 65535.');
  await checkPort(port);
  const workspace = options.workspace || path.resolve(__dirname, '..');
  const args = [`--extensionDevelopmentPath=${workspace}`, '--new-window', '--disable-extensions', `--inspect-extensions=${port}`];
  if (options.cleanProfile) args.push(`--user-data-dir=${path.join(workspace, '.vscode-dev-profile')}`, `--extensions-dir=${path.join(workspace, '.vscode-dev-extensions')}`, '--profile-temp');
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete env[key];
  const child = (options.spawnProcess || spawn)(executable, args, { cwd: workspace, env, detached: true, windowsHide: true, stdio: 'ignore' });
  let launchError;
  child.once('error', (error) => { launchError = error; });
  child.once('exit', (code) => { if (code) launchError = new Error(`VS Code exited with code ${code}.`); });
  child.unref();
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  while (Date.now() < deadline) {
    if (launchError) throw new Error(`Could not launch VS Code: ${launchError.message}`);
    if (await probeInspector(port, Math.min(750, deadline - Date.now()))) return;
    await new Promise((resolve) => setTimeout(resolve, Math.min(150, Math.max(0, deadline - Date.now()))));
  }
  if (launchError) throw new Error(`Could not launch VS Code: ${launchError.message}`);
  throw new Error(`The extension inspector at 127.0.0.1:${port} did not become ready within ${options.timeoutMs ?? 30_000} ms. Check the development window and its extension-host logs; close it before retrying.`);
}

module.exports = { startExtensionDebug, probeInspector };

if (require.main === module) {
  const [executable, rawPort, flag, ...extra] = process.argv.slice(2);
  const work = extra.length || (flag && flag !== '--clean-profile')
    ? Promise.reject(new Error('Usage: node scripts/start-extension-debug.cjs <Code executable> <port> [--clean-profile]'))
    : startExtensionDebug(executable, Number(rawPort), { cleanProfile: flag === '--clean-profile' });
  work.then(() => console.log(`OpenCursor extension inspector is ready at 127.0.0.1:${rawPort}.`), (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
