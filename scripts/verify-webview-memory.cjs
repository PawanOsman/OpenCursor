/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// Run with node --expose-gc scripts/verify-webview-memory.cjs.
const assert = require("node:assert/strict");
const esbuild = require("esbuild");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "opencursor-webview-memory-"));
try {
  assert.equal(typeof global.gc, "function", "Run Node with --expose-gc");
  const file = path.join(temporary, "markdown.cjs");
  esbuild.buildSync({ entryPoints: [path.join(__dirname, "../webview-ui/shared/markdown.ts")], bundle: true, platform: "node", outfile: file });
  const { renderMarkdown } = require(file);
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let revision = 0; revision < 240; revision++) {
    renderMarkdown("```text\n" + "stream output ".repeat(9000) + revision + "\n```");
  }
  global.gc();
  const retainedMiB = (process.memoryUsage().heapUsed - before) / 1048576;
  console.log(JSON.stringify({ revisions: 240, charactersPerRevision: 126000, retainedMiB: +retainedMiB.toFixed(1) }));
  assert.ok(retainedMiB < 12, `Markdown revisions retained ${retainedMiB.toFixed(1)} MiB (budget 12 MiB)`);
} finally {
  // Delete only the individual files created in the unique temporary directory.
  for (const name of fs.readdirSync(temporary)) fs.unlinkSync(path.join(temporary, name));
  fs.rmdirSync(temporary);
}
