/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// Minimal editor adapter for the production agent in a worker process.
// Language-service tools are disabled by the worker; no fake diagnostics.
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const disposable = () => ({ dispose() {} });
const uri = value => ({ scheme: 'file', fsPath: path.resolve(value), path: path.resolve(value), toString: () => pathToFileURL(path.resolve(value)).href });
exports.Uri = { file: uri, parse: value => value.startsWith('file:') ? uri(fileURLToPath(value)) : { scheme: new URL(value).protocol.slice(0, -1), toString: () => value } };
exports.workspace = {
  workspaceFolders: [], textDocuments: [],
  getConfiguration: () => ({ get: (_key, fallback) => fallback }),
  fs: { readFile: value => fs.readFile(value.fsPath), stat: value => fs.stat(value.fsPath) },
};
exports.window = {
  tabGroups: { all: [] }, visibleTextEditors: [],
  createOutputChannel: () => ({ appendLine() {}, append() {}, dispose() {} }),
  showErrorMessage: message => process.stderr.write(String(message) + '\n'),
  withProgress: (_options, task) => task({ report() {} }),
};
exports.commands = { executeCommand: async () => { throw new Error('Editor language providers are unavailable in the headless worker'); } };
exports.languages = { getDiagnostics: () => { throw new Error('Diagnostics are unavailable in the headless worker'); } };
exports.env = { appRoot: '', openExternal: async () => false };
exports.ProgressLocation = { Notification: 15 };
exports.DiagnosticSeverity = { Error: 0, Warning: 1 };
exports.EventEmitter = class {
  listeners = new Set(); event = fn => { this.listeners.add(fn); return { dispose: () => this.listeners.delete(fn) }; };
  fire(value) { for (const listener of this.listeners) listener(value); } dispose() { this.listeners.clear(); }
};
exports.CancellationTokenSource = class { token = { isCancellationRequested: false, onCancellationRequested: disposable }; cancel() { this.token.isCancellationRequested = true; } dispose() {} };
