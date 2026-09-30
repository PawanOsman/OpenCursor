/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as fs from "node:fs/promises";
import * as http from "node:http";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ executable: "" }));
vi.mock("vscode", () => ({ workspace: { getConfiguration: () => ({ get: () => config.executable }) } }));
vi.mock("../../runtimeDeps", () => ({ importRuntimeDep: async () => import("playwright-core") }));
import { browserUrl, browserViewport, browserNavigateTool, browserInteractTool, browserScreenshotTool, browserInspectTool, disposeAllBrowserSessions } from "./browser";
import type { ToolContext } from "./types";

let server: http.Server | undefined, url = "";
let onSlowRequest: (() => void) | undefined;
const context = (key: string): ToolContext => ({ todos: [], shellSessionKey: key, getMode: () => "agent" });

beforeAll(async () => {
  const managed = process.env.OPENCURSOR_TEST_BROWSER === "managed";
  const candidates = managed ? [(await import("playwright-core")).chromium.executablePath()]
    : process.platform === "win32" ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"] : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  for (const candidate of candidates) { try { await fs.access(candidate); config.executable = candidate; break; } catch { /* optional local browser */ } }
  if (managed && !config.executable) throw new Error("Required test browser is missing. Run pnpm exec playwright-core install --no-shell chromium.");
  server = http.createServer((request, response) => {
    if (request.url === "/slow") { onSlowRequest?.(); return; }
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(`<!doctype html><html><head><title>Browser verification fixture</title></head><body><h1>Greeting app</h1><label>Name<input aria-label="Name"></label><button>Greet</button><p id="result">Empty session</p><script>console.error('fixture console error');document.querySelector('button').onclick=()=>{let name=document.querySelector('input').value;document.querySelector('#result').textContent='Hello '+name;localStorage.setItem('name',name)};if(localStorage.getItem('name'))document.querySelector('#result').textContent='Saved '+localStorage.getItem('name');</script></body></html>`);
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await disposeAllBrowserSessions();
  const activeServer = server;
  if (activeServer) { activeServer.closeAllConnections(); await new Promise<void>((resolve) => activeServer.close(() => resolve())); }
});

it("rejects local-file, script and credential-bearing navigation URLs", () => {
  for (const value of ["file:///etc/passwd", "javascript:alert(1)", "https://user:secret@example.com", "not a URL"]) expect(() => browserUrl(value)).toThrow();
  expect(browserUrl("http://localhost:3000")).toBe("http://localhost:3000/");
  expect(browserViewport(999999, -1)).toEqual({ width: 1920, height: 240 });
});

it("refuses browser actions in read-only mode before creating a browser", async () => {
  const result = await browserNavigateTool.execute({ url }, undefined, "read-only", { todos: [], shellSessionKey: "read-only", getMode: () => "ask" });
  expect(result).toMatchObject({ outcome: { status: "failed" } });
  expect(result.output).toContain("Agent or Debug mode");
});

it("inspects, interacts, captures screenshots, reports console errors and isolates runs in installed Chrome", async ({ skip }) => {
  if (!config.executable) skip();
  const a = context("browser-a"), b = context("browser-b");
  const opened = await browserNavigateTool.execute({ url, width: 600, height: 500 }, undefined, "nav", a);
  expect(opened.outcome?.status, opened.output).toBe("completed");
  const initial = JSON.parse(opened.output);
  expect(initial.accessiblePage).toContain("Greeting app");
  expect(initial.console).toContain("error: fixture console error");
  expect(initial.viewport).toEqual({ width: 600, height: 500 });
  const filled = await browserInteractTool.execute({ action: "fill", role: "textbox", name: "Name", value: "Pawan" }, undefined, "fill", a);
  expect(filled.outcome?.status, filled.output).toBe("completed");
  const clicked = await browserInteractTool.execute({ action: "click", role: "button", name: "Greet" }, undefined, "click", a);
  expect(clicked.outcome?.status, clicked.output).toBe("completed");
  expect(clicked.output).toContain("Hello Pawan");
  const screenshot = await browserScreenshotTool.execute({}, undefined, "shot", a);
  expect(screenshot.outcome?.status, screenshot.output).toBe("completed");
  expect(screenshot.image?.mime).toBe("image/png");
  expect(Buffer.from(screenshot.image!.base64, "base64").subarray(1, 4).toString()).toBe("PNG");
  expect((await browserNavigateTool.execute({ url }, undefined, "isolated", b)).output).toContain("Empty session");
  expect((await browserInspectTool.execute({}, undefined, "first", a)).output).toContain("Hello Pawan");
}, 90_000);

it("cancels an in-flight page load and closes only its owned browser", async ({ skip }) => {
  if (!config.executable) skip();
  const abort = new AbortController();
  let requested = false;
  onSlowRequest = () => { requested = true; abort.abort(); };
  try {
    const result = await browserNavigateTool.execute({ url: `${url}/slow` }, abort.signal, "slow", context("browser-cancel"));
    expect(requested, result.output).toBe(true);
    expect(result.outcome?.status, result.output).toBe("aborted");
    expect((await browserInspectTool.execute({}, undefined, "lost", context("browser-cancel"))).output).toContain("No browser page is open");
  } finally { onSlowRequest = undefined; }
}, 45_000);
