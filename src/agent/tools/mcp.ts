/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { writeTool } from "./files";
import { mcpManager } from "../../integrations/mcpClient";
import { defineTool } from "./types";
import { mutateFile } from "../../stores/fileMutations";
import { createHash } from "node:crypto";
import { decodeMcpBlob, firstMcpImage, MAX_MCP_RESOURCE_BYTES } from "../../integrations/mcpContent";

// ---- CallMcpTool ----
export const callMcpToolTool = defineTool("CallMcpTool", true, async () => ({
  output: "error: MCP tool execution requires the agent's guarded dispatcher",
}));

// ---- FetchMcpResource ----
export const fetchMcpResourceTool = defineTool("FetchMcpResource", true, async (input, signal, callId, ctx) => {
  const server = String(input?.server ?? "").trim();
  const uri = String(input?.uri ?? "").trim();
  if (!server || !uri) return { output: "error: FetchMcpResource requires 'server' and 'uri'" };

  let resource: Awaited<ReturnType<typeof mcpManager.readResourceContents>>;
  try { resource = await mcpManager.readResourceContents(server, uri, signal); }
  catch (error) { return { output: `error: ${error instanceof Error ? error.message : String(error)}` }; }
  const content = resource.contents.map((item) => "text" in item ? item.text : `[binary resource ${item.uri}; ${item.mimeType ?? "unknown MIME type"}]`).join("\n");
  const binaries = resource.contents.filter((item) => "blob" in item);
  const image = firstMcpImage(resource.contents.map((item) => ({ type: "resource" as const, resource: item })));

  const downloadPath = input?.downloadPath ? String(input.downloadPath) : "";
  if (downloadPath) {
    signal?.throwIfAborted();
    if (binaries.length) {
      if (resource.contents.length !== 1 || !("blob" in resource.contents[0])) return { output: "error: Binary downloads require exactly one resource content item. Select a specific resource URI." };
      try {
        const item = resource.contents[0];
        const bytes = decodeMcpBlob(item.blob);
        const digest = createHash("sha256").update(bytes).digest("hex");
        const preview = `[binary ${item.mimeType ?? "application/octet-stream"}; bytes=${bytes.length}; sha256=${digest}]`;
        const veto = await ctx?.beforeResourceWrite?.(downloadPath, preview, signal);
        if (veto) return { output: `error: blocked by hook: ${veto}` };
        signal?.throwIfAborted();
        return await mutateFile(downloadPath, { signal, owner: ctx?.changeOwner }, () => ({ data: bytes, result: { output: `Saved ${bytes.length} bytes from ${uri} to ${downloadPath}. SHA-256: ${digest}`, diff: `Binary resource: ${bytes.length} bytes (${item.mimeType ?? "application/octet-stream"}).`, image } }));
      } catch (error) { return { output: `error: ${error instanceof Error ? error.message : String(error)}` }; }
    }
    if (Buffer.byteLength(content) > MAX_MCP_RESOURCE_BYTES) return { output: "error: MCP text download exceeds the 16 MiB limit." };
    const veto = await ctx?.beforeResourceWrite?.(downloadPath, content, signal);
    if (veto) return { output: `error: blocked by hook: ${veto}` };
    signal?.throwIfAborted();
    return writeTool.execute({ path: downloadPath, contents: content }, signal, callId, ctx);
  }
  return { output: content, image };
});

// ---- ListMcpResources ----
export const listMcpResourcesTool = defineTool("ListMcpResources", false, async (input, signal) => {
  const filter = input?.server ? String(input.server) : "";
  const [listedResources, listedTemplates] = await Promise.all([mcpManager.listResources(signal), mcpManager.listResourceTemplates(signal)]);
  const resources = listedResources.filter((r) => !filter || r.server === filter);
  const templates = listedTemplates.filter((r) => !filter || r.server === filter);
  if (resources.length === 0 && templates.length === 0) return { output: "No MCP resources or resource templates available." };
  const lines = resources.map(
    (r) => `${r.server}\t${r.uri}${r.name ? `\t${r.name}` : ""}${r.mimeType ? `\t(${r.mimeType})` : ""}`
  );
  for (const template of templates) lines.push(`${template.server}\tTEMPLATE ${template.uriTemplate}\t${template.name}${template.mimeType ? `\t(${template.mimeType})` : ""}`);
  return { output: lines.join("\n") };
});
