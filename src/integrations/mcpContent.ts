/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { ContentBlock } from "@modelcontextprotocol/sdk/types.js";

export const MAX_MCP_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_MCP_RESOURCE_BYTES = 16 * 1024 * 1024;

export function decodeMcpBlob(data: string, maximum = MAX_MCP_RESOURCE_BYTES): Buffer {
  if (data.length > Math.ceil(maximum / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error("MCP binary content is malformed or exceeds the supported size.");
  const bytes = Buffer.from(data, "base64");
  if (bytes.length > maximum || bytes.toString("base64").replace(/=+$/, "") !== data.replace(/=+$/, "")) throw new Error("MCP binary content is malformed or exceeds the supported size.");
  return bytes;
}

/** The current provider message contract supports one bounded image per tool result. */
export function firstMcpImage(contents: ContentBlock[]): { mime: string; base64: string } | undefined {
  for (const content of contents) {
    const image = content.type === "image" ? { mime: content.mimeType, base64: content.data }
      : content.type === "resource" && "blob" in content.resource ? { mime: content.resource.mimeType ?? "", base64: content.resource.blob } : undefined;
    if (!image || !/^image\/(png|jpeg|webp|gif)$/i.test(image.mime)) continue;
    try {
      const bytes = decodeMcpBlob(image.base64, MAX_MCP_IMAGE_BYTES);
      const mime = image.mime.toLowerCase();
      const valid = mime === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : mime === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : mime === "image/gif" ? /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("ascii"))
            : bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
      if (valid) return image;
    } catch { /* Keep the textual omission marker. */ }
  }
  return undefined;
}
