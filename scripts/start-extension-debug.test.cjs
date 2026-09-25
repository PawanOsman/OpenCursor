/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { startExtensionDebug, probeInspector } = require('./start-extension-debug.cjs');

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}
async function close(server) { await new Promise((resolve) => server.close(resolve)); }
async function unusedPort() { const server = net.createServer(); const port = await listen(server); await close(server); return port; }
function fakeChild() { const child = new EventEmitter(); child.unref = () => {}; return child; }

test('launches a non-pausing host and waits for a valid IPv4 inspector', async () => {
  const port = await unusedPort();
  const workspace = path.resolve(__dirname, '..');
  let calls = 0;
  const server = http.createServer((req, res) => {
    calls++;
    assert.equal(req.url, '/json/list');
    res.end(JSON.stringify([{ webSocketDebuggerUrl: `ws://127.0.0.1:${port}/fixture` }]));
  });
  const old = process.env.ELECTRON_RUN_AS_NODE;
  process.env.ELECTRON_RUN_AS_NODE = '1';
  try {
    await startExtensionDebug(process.execPath, port, { workspace, cleanProfile: true, timeoutMs: 2_000, spawnProcess(executable, args, options) {
      assert.equal(executable, process.execPath);
      assert.ok(args.includes(`--inspect-extensions=${port}`));
      assert.ok(args.includes(`--extensionDevelopmentPath=${workspace}`));
      assert.ok(args.includes(`--user-data-dir=${path.join(workspace, '.vscode-dev-profile')}`));
      assert.ok(!args.some((arg) => /inspect-brk|debugId/.test(arg)));
      assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined);
      assert.equal(options.windowsHide, true);
      assert.equal(options.detached, true);
      server.listen(port, '127.0.0.1');
      return fakeChild();
    } });
    assert.ok(calls > 0);
  } finally { if (old === undefined) delete process.env.ELECTRON_RUN_AS_NODE; else process.env.ELECTRON_RUN_AS_NODE = old; await close(server); }
});

test('occupied port fails before launching a second host', async () => {
  const server = net.createServer();
  const port = await listen(server);
  try {
    await assert.rejects(startExtensionDebug(process.execPath, port, { spawnProcess() { assert.fail('must not launch'); } }), /port .* unavailable/);
  } finally { await close(server); }
});

test('rejects unrelated HTTP services and bounds a stalled response', async () => {
  let stalled = false;
  const sockets = new Set();
  const server = http.createServer((_req, res) => { if (!stalled) res.end(JSON.stringify([{ webSocketDebuggerUrl: 'ws://example.com:9333/wrong' }])); });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  const port = await listen(server);
  try {
    assert.equal(await probeInspector(port, 100), false);
    stalled = true;
    const start = Date.now();
    assert.equal(await probeInspector(port, 50), false);
    assert.ok(Date.now() - start < 1_000);
  } finally { for (const socket of sockets) socket.destroy(); await close(server); }
});

test('surfaces spawn failure and readiness timeout without killing a reused Code process', async () => {
  const port = await unusedPort();
  await assert.rejects(startExtensionDebug(process.execPath, port, { timeoutMs: 500, spawnProcess() {
    const child = fakeChild();
    queueMicrotask(() => child.emit('error', new Error('fixture executable missing')));
    return child;
  } }), /Could not launch VS Code: fixture executable missing/);
  await assert.rejects(startExtensionDebug(process.execPath, port, { timeoutMs: 30, spawnProcess: fakeChild }), /did not become ready within 30 ms/);
  await assert.rejects(startExtensionDebug(process.execPath, 0), /Inspector port must/);
});
