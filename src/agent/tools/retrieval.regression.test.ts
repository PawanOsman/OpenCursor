/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ root: "", rg: null as string | null, delayFirst: false }));
vi.mock("child_process", async (original) => {
  const actual = await original<typeof import("child_process")>();
  return { ...actual, spawn: (command: string, args: string[] = [], options: import("child_process").SpawnOptions = {}) =>
    command === fixture.rg ? actual.spawn(process.execPath, [command, ...args], options) : actual.spawn(command, args, options) };
});
vi.mock("fs/promises", async (original) => {
  const actual = await original<typeof import("fs/promises")>();
  return { ...actual, readFile: async (name: Parameters<typeof actual.readFile>[0], options: any) => {
    if (fixture.delayFirst && String(name).endsWith("a.txt")) await new Promise((resolve) => setTimeout(resolve, 30));
    return actual.readFile(name, options);
  } };
});
vi.mock("vscode", () => ({ workspace: {
  get workspaceFolders() { return [{ uri: { fsPath: fixture.root } }]; }, textDocuments: [],
}, window: { tabGroups: { all: [] } }, languages: { getDiagnostics: () => [] }, DiagnosticSeverity: { Warning: 1, Error: 0 } }));
vi.mock("./shared", async (original) => ({ ...await original<object>(), rgCommand: async () => fixture.rg }));
vi.mock("../semanticIndex", () => ({}));
vi.mock("../docsIndex", () => ({}));

import { readFileTool } from "./files";
import { grepTool } from "./search";
import { invalidateScanCache } from "./fileScan";
import { READ_PAGE_CHARS, readTextPage } from "./textRead";

beforeEach(async () => { fixture.root = await fs.mkdtemp(path.join(os.tmpdir(), "opencursor-retrieval-")); fixture.rg = null; fixture.delayFirst = false; });
afterEach(async () => { vi.restoreAllMocks(); invalidateScanCache(); await fs.rm(fixture.root, { recursive: true, force: true }); });
async function file(name: string, text: string | Buffer) {
  const target = path.join(fixture.root, name);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, text);
  return target;
}
const readRows = (output: string) => output.split("\n").filter((line) => /^\d+\|/.test(line));
const grepRows = (output: string) => output.split("\n").filter((line) => /^\d+[:-]/.test(line));

describe("production Read pagination", () => {
  it("bounds default and offset-only reads while honoring larger explicit ranges", async () => {
    const target = await file("source.txt", Array.from({ length: 700 }, (_, i) => `source-${i + 1}`).join("\n"));
    const first = await readFileTool.execute({ path: target });
    expect(first.output).toContain("total_lines=700 start_line=1 end_line=200");
    expect(first.output).toContain("next_line=201");
    expect(readRows(first.output)).toHaveLength(200);
    const offset = await readFileTool.execute({ path: target, offset: 301 });
    expect(readRows(offset.output)).toHaveLength(200);
    expect(offset).toMatchObject({ startLine: 301, endLine: 500 });
    expect(offset.output).toContain("next_line=501");
    const explicit = await readFileTool.execute({ path: target, offset: 100, limit: 350 });
    expect(readRows(explicit.output)).toHaveLength(350);
    expect(explicit.output).toContain("total_lines=700 start_line=100 end_line=449");
  });

  it("retrieves exactly an 18-line range in a >8 MiB file, including exact totals and EOF-relative ranges", async () => {
    const lines = Array.from({ length: 60003 }, (_, i) => `row ${i + 1} ${"x".repeat(150)}`);
    lines[43911] = "unique fixture marker";
    const target = await file("large.txt", lines.join("\n"));
    expect((await fs.stat(target)).size).toBeGreaterThan(8 * 1024 * 1024);
    const result = await readFileTool.execute({ path: target, offset: 43904, limit: 18 });
    expect(result.output).toContain("total_lines=60003 start_line=43904 end_line=43921");
    expect(result.output).toContain("next_line=43922");
    expect(readRows(result.output)).toEqual(lines.slice(43903, 43921).map((line, i) => `${43904 + i}|${line}`));
    const tail = await readFileTool.execute({ path: target, offset: -2, limit: 10 });
    expect(readRows(tail.output)).toEqual([`60002|${lines[60001]}`, `60003|${lines[60002]}`]);
    expect(tail.output).toContain("next_line=none");
  });

  it("resumes long Unicode lines without dropping, duplicating or splitting characters", async () => {
    const source = "a".repeat(READ_PAGE_CHARS - 4) + "😀" + "b".repeat(45000) + "終";
    const target = await file("long.txt", source + "\r\ntail");
    let column = 1;
    let combined = "";
    for (let count = 0; count < 8; count++) {
      const result = await readFileTool.execute({ path: target, offset: 1, limit: 1, start_column: column });
      expect(result.output.length).toBeLessThan(READ_PAGE_CHARS + 250);
      const rows = readRows(result.output);
      expect(rows).toHaveLength(1);
      combined += rows[0].slice(2);
      const next = result.output.match(/next_column=(\d+)/);
      if (!next) { expect(result.output).toContain("next_line=2"); break; }
      expect(result.output).toContain("next_line=1 ");
      expect(Number(next[1])).toBeGreaterThan(column);
      column = Number(next[1]);
    }
    expect(combined).toBe(source);
    expect(combined).not.toContain("\uFFFD");
  });

  it("bounds a single >8 MiB line and can resume directly near its end", async () => {
    const source = "z".repeat(8 * 1024 * 1024 + 10) + "FINAL";
    const target = await file("one-line.txt", source);
    const initial = await readFileTool.execute({ path: target });
    expect(initial.output.length).toBeLessThan(READ_PAGE_CHARS + 250);
    expect(initial.output).toContain("total_lines=1");
    expect(initial.output).toMatch(/next_line=1 next_column=\d+/);
    const ending = await readFileTool.execute({ path: target, start_column: source.length - 4 });
    expect(readRows(ending.output)).toEqual(["1|FINAL"]);
    expect(ending.output).toContain("next_line=none");
  });

  it("normalizes BOM/CRLF while preserving the existing trailing empty-line numbering", async () => {
    const target = await file("windows.txt", "\uFEFFfirst\r\nsecond\r\n");
    const result = await readFileTool.execute({ path: target });
    expect(readRows(result.output)).toEqual(["1|first", "2|second", "3|"]);
    expect(result.output).toContain("total_lines=3");
    expect((await readFileTool.execute({ path: target, offset: -1 })).output).toContain("3|");
  });

  it("reassembles mixed short and long lines exactly across page and stream-chunk boundaries", async () => {
    const expected = ["", "a".repeat(19997), "b".repeat(65534) + "😀", "", "c".repeat(20000), "final\r"];
    const target = await file("boundaries.txt", "\uFEFF" + expected.join("\r\n"));
    const actual: string[] = [];
    let offset = 1;
    let column = 1;
    for (let page = 0; page < 20; page++) {
      const result = await readFileTool.execute({ path: target, offset, limit: 3, start_column: column });
      for (const row of readRows(result.output)) {
        const [number, ...parts] = row.split("|");
        actual[Number(number) - 1] = (actual[Number(number) - 1] ?? "") + parts.join("|");
      }
      const next = result.output.match(/next_line=(\d+)/);
      if (!next) break;
      offset = Number(next[1]);
      column = Number(result.output.match(/next_column=(\d+)/)?.[1] ?? 1);
    }
    expect(actual).toEqual(expected);
  });

  it("cancels an active streaming read", async () => {
    const target = await file("cancel.txt", "text\n".repeat(200000));
    const controller = new AbortController();
    const pending = readTextPage(target, {}, controller.signal);
    queueMicrotask(() => controller.abort());
    await expect(pending).rejects.toThrow("aborted: Read");
  });

  it("reports empty files, invalid ranges, binary files, cancellation and directories accurately", async () => {
    const empty = await file("empty.txt", "");
    expect((await readFileTool.execute({ path: empty })).output).toContain("total_lines=0");
    const target = await file("short.txt", "hello");
    for (const input of [{ offset: 2 }, { offset: 1.5 }, { limit: 0 }, { start_column: 0 }, { start_column: 7 }]) {
      expect((await readFileTool.execute({ path: target, ...input })).output).toMatch(/^error:/);
    }
    const binary = await file("binary.txt", Buffer.from([1, 0, 3]));
    expect((await readFileTool.execute({ path: binary })).output).toContain("binary content detected");
    expect((await readFileTool.execute({ path: fixture.root })).output).toContain("path is a directory");
    const controller = new AbortController(); controller.abort();
    expect((await readFileTool.execute({ path: target }, controller.signal)).output).toContain("aborted");
  });
});

describe("production Grep fallback", () => {
  it("groups filenames, merges overlapping contexts, and pages source rows without duplicates", async () => {
    await file("b.txt", "last\nhit b");
    await file("a.txt", "before\nhit a\nhit adjacent\nafter");
    const args = { pattern: "hit", "-C": 1, head_limit: 2 };
    const first = await grepTool.execute(args);
    const second = await grepTool.execute({ ...args, offset: 2 });
    const third = await grepTool.execute({ ...args, offset: 4 });
    expect(first.output).toBe("[Grep rows=2 offset=0 next_offset=2]\na.txt\n1-before\n2:hit a");
    expect(second.output).toBe("[Grep rows=2 offset=2 next_offset=4]\na.txt\n3:hit adjacent\n4-after");
    expect(third.output).toBe("[Grep rows=2 offset=4 next_offset=none]\nb.txt\n1-last\n2:hit b");
    expect(grepRows(first.output + "\n" + second.output + "\n" + third.output)).toHaveLength(6);
  });

  it("honors explicit file scope, anchored line patterns, mode counts and glob filters", async () => {
    const target = await file("src/a.ts", "prefix\nhit\nhit\nsuffix");
    await file("src/b.js", "hit");
    const only = await grepTool.execute({ path: target, pattern: "^hit$", output_mode: "files_with_matches" });
    expect(only.output).toBe("[Grep files=1 offset=0 next_offset=none]\nsrc/a.ts");
    const counts = await grepTool.execute({ pattern: "^hit$", output_mode: "count", glob: "*.ts" });
    expect(counts.output).toBe("[Grep files=1 offset=0 next_offset=none]\nsrc/a.ts:2");
    expect((await grepTool.execute({ pattern: "hit", type: "not-a-type" })).output).toContain("unsupported file type");
  });

  it("returns multiline matches as numbered source lines with context", async () => {
    await file("source.txt", "before\nBEGIN\ninside\nEND\nafter\n");
    const result = await grepTool.execute({ pattern: "BEGIN.*?END", multiline: true, "-C": 1 });
    expect(grepRows(result.output)).toEqual(["1-before", "2:BEGIN", "3:inside", "4:END", "5-after"]);
    const count = await grepTool.execute({ pattern: "BEGIN.*?END", multiline: true, output_mode: "count" });
    expect(count.output).toContain("source.txt:3");
  });

  it("keeps first-page ordering independent of file-read completion order", async () => {
    for (const name of ["z.txt", "b.txt", "a.txt", "c.txt", "d.txt"]) await file(name, "hit\n".repeat(600));
    fixture.delayFirst = true;
    const result = await grepTool.execute({ pattern: "hit", head_limit: 2 });
    expect(result.output).toBe("[Grep rows=2 offset=0 next_offset=2]\na.txt\n1:hit\n2:hit");
    const next = await grepTool.execute({ pattern: "hit", head_limit: 2, offset: 600 });
    expect(next.output).toContain("\nb.txt\n1:hit\n2:hit");
  });

  it("clips long lines with an explicit exact-read hint and reports a resumable output budget", async () => {
    await file("long.txt", Array.from({ length: 100 }, (_, i) => `hit ${i} ${"x".repeat(700)}`).join("\n"));
    const result = await grepTool.execute({ pattern: "hit", head_limit: 100 });
    expect(result.output).toContain("[truncated; use Read for exact text]");
    expect(result.output.length).toBeLessThan(20500);
    const offset = Number(result.output.match(/next_offset=(\d+)/)?.[1]);
    expect(offset).toBe(grepRows(result.output).length);
    expect(offset).toBeGreaterThan(1);
    const next = await grepTool.execute({ pattern: "hit", head_limit: 100, offset });
    expect(grepRows(next.output)[0]).toContain(`${offset + 1}:hit ${offset} `);
  });

  it("reports cancellation while fallback file reads are pending as an aborted outcome", async () => {
    await file("a.txt", "hit"); fixture.delayFirst = true;
    const controller = new AbortController();
    const pending = grepTool.execute({ pattern: "hit" }, controller.signal);
    const timer = setTimeout(() => controller.abort(), 10);
    try { expect((await pending).outcome?.status).toBe("aborted"); }
    finally { clearTimeout(timer); }
  });
});

// A protocol fixture drives the real child-process parser; launch through Node
// explicitly because Windows does not execute Unix shebang scripts.
async function ripgrepFixture(events: unknown[], hanging = false) {
  const executable = await file("rg-fixture.cjs", `#!/usr/bin/env node\nconst fs = require('node:fs');\nfs.writeFileSync(${JSON.stringify(path.join(fixture.root, "args.json"))}, JSON.stringify(process.argv.slice(2)));\nprocess.stdout.write(${JSON.stringify(events.map((e) => JSON.stringify(e)).join("\n") + "\n")});\n${hanging ? "setInterval(() => {}, 1000);" : ""}\n`);
  await fs.chmod(executable, 0o700);
  fixture.rg = executable;
}
const begin = (file: string) => ({ type: "begin", data: { path: { text: file } } });
const row = (file: string, line: number, text: string, match = true) => ({ type: match ? "match" : "context", data: { path: { text: file }, line_number: line, lines: { text: text + "\n" } } });
const end = (file: string) => ({ type: "end", data: { path: { text: file } } });

describe("production Grep ripgrep protocol", () => {
  it("uses sorted JSON on the first page and groups ambiguous filenames with correct row pagination", async () => {
    const name = "./src/a:odd.txt";
    await ripgrepFixture([begin(name), row(name, 1, "before", false), row(name, 2, "hit"), row(name, 3, "after", false), end(name)]);
    const first = await grepTool.execute({ pattern: "hit", head_limit: 2, "-C": 1 });
    expect(first.output).toBe("[Grep rows=2 offset=0 next_offset=2]\nsrc/a:odd.txt\n1-before\n2:hit");
    const args = JSON.parse(await fs.readFile(path.join(fixture.root, "args.json"), "utf8"));
    expect(args).toContain("--sort=path");
    expect(args).toContain("--json");
    const next = await grepTool.execute({ pattern: "hit", head_limit: 2, offset: 2, "-C": 1 });
    expect(next.output).toBe("[Grep rows=1 offset=2 next_offset=none]\nsrc/a:odd.txt\n3-after");
  });

  it("handles multiline/base64 source records and matching-line counts", async () => {
    const name = path.join(fixture.root, "multi.txt");
    const event = { type: "match", data: { path: { bytes: Buffer.from(name).toString("base64") }, line_number: 2, lines: { bytes: Buffer.from("BEGIN\ninside\nEND\n").toString("base64") } } };
    await ripgrepFixture([begin(name), event, end(name)]);
    const result = await grepTool.execute({ pattern: "BEGIN.*END", multiline: true });
    expect(grepRows(result.output)).toEqual(["2:BEGIN", "3:inside", "4:END"]);
    const count = await grepTool.execute({ pattern: "BEGIN.*END", multiline: true, output_mode: "count" });
    expect(count.output).toContain("multi.txt:3");
  });

  it("kills an aborted search and explicitly labels its partial result", async () => {
    await ripgrepFixture([begin("a.txt"), row("a.txt", 1, "hit")], true);
    const controller = new AbortController();
    const result = grepTool.execute({ pattern: "hit" }, controller.signal);
    const timer = setTimeout(() => controller.abort(), 100);
    try {
      const completed = await result;
      const output = completed.output;
      expect(completed.outcome?.status).toBe("aborted");
      expect(output).toContain("grep aborted");
      expect(output).toContain("scan_incomplete=true");
    } finally { clearTimeout(timer); }
  });
});
