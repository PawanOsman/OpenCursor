/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
const state = vi.hoisted(() => ({ root: "" }));
vi.mock("vscode", () => ({ workspace: { get workspaceFolders() { return [{ uri: { fsPath: state.root } }]; }, textDocuments: [] }, window: { tabGroups: { all: [] } } }));
import { fetchMcpResourceTool, listMcpResourcesTool } from "./mcp";
import { mcpManager } from "../../integrations/mcpClient";
import { pendingChanges } from "../../stores/pendingChanges";
import { firstMcpImage, MAX_MCP_IMAGE_BYTES } from "../../integrations/mcpContent";

beforeEach(async () => { state.root = await fs.mkdtemp(path.join(tmpdir(), "ocursor-resource-")); });
afterEach(async () => { vi.restoreAllMocks(); pendingChanges.acceptAll(); await fs.rm(state.root, { recursive: true, force: true }); });

it("returns resource templates alongside concrete resources, with server filtering", async () => {
  vi.spyOn(mcpManager, "listResources").mockResolvedValue([{ server: "a", uri: "fixture://one" }]);
  vi.spyOn(mcpManager, "listResourceTemplates").mockResolvedValue([{ server: "a", uriTemplate: "fixture://items/{id}", name: "Item" }, { server: "b", uriTemplate: "hidden://{id}", name: "Hidden" }]);
  const result = await listMcpResourcesTool.execute({ server: "a" });
  expect(result.output).toContain("fixture://one"); expect(result.output).toContain("TEMPLATE fixture://items/{id}"); expect(result.output).not.toContain("hidden");
});

it("returns a bounded image from typed resources without expanding base64 into text", async () => {
  const image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jz1sAAAAASUVORK5CYII=";
  vi.spyOn(mcpManager, "readResourceContents").mockResolvedValue({ contents: [{ uri: "fixture://image", mimeType: "image/png", blob: image }] });
  const result = await fetchMcpResourceTool.execute({ server: "a", uri: "fixture://image" });
  expect(result.image).toEqual({ mime: "image/png", base64: image }); expect(result.output).not.toContain(image);
  expect(firstMcpImage([{ type: "image", mimeType: "image/png", data: "cGl4ZWw=" }])).toBeUndefined();
  expect(firstMcpImage([{ type: "image", mimeType: "image/png", data: Buffer.alloc(MAX_MCP_IMAGE_BYTES + 1).toString("base64") }])).toBeUndefined();
  expect(firstMcpImage([{ type: "image", mimeType: "image/png", data: "invalid$base64" }])).toBeUndefined();
});

it("gates binary downloads before writing and preserves exact bytes for undo", async () => {
  const old = Buffer.from([0, 255, 33]), next = Buffer.from([0, 128, 12, 99]);
  const target = path.join(state.root, "resource.bin"); await fs.writeFile(target, old);
  vi.spyOn(mcpManager, "readResourceContents").mockResolvedValue({ contents: [{ uri: "fixture://binary", mimeType: "application/octet-stream", blob: next.toString("base64") }] });
  const blocked = await fetchMcpResourceTool.execute({ server: "a", uri: "fixture://binary", downloadPath: target }, undefined, "blocked", { todos: [], beforeResourceWrite: async () => "preserve file" });
  expect(blocked.output).toContain("blocked by hook"); expect(await fs.readFile(target)).toEqual(old);
  const hook = vi.fn(async () => undefined);
  const written = await fetchMcpResourceTool.execute({ server: "a", uri: "fixture://binary", downloadPath: target }, undefined, "allowed", { todos: [], beforeResourceWrite: hook });
  expect(written.output).toContain("Saved 4 bytes"); expect(await fs.readFile(target)).toEqual(next);
  expect(hook).toHaveBeenCalledWith(target, expect.stringContaining("sha256="), undefined);
  await pendingChanges.reject(target); expect(await fs.readFile(target)).toEqual(old);
});
