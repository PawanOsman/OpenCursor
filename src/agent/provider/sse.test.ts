/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it } from "vitest";
import { sseData } from "./sse";

function readerOf(chunks: Uint8Array[]): ReadableStreamDefaultReader<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); },
  }).getReader();
}

async function collect(chunks: Uint8Array[]): Promise<string[]> {
  const out: string[] = [];
  for await (const data of sseData(readerOf(chunks))) out.push(data);
  return out;
}

/** Straightforward line-by-line decoding, used as the behavioural reference. */
function reference(text: string): string[] {
  if (text && !text.endsWith("\n")) text += "\n";
  const out: string[] = [];
  let data: string[] = [];
  const lines = text.split("\n");
  lines.pop();
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (!line) { if (data.length) out.push(data.join("\n")); data = []; }
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (data.length) out.push(data.join("\n"));
  return out;
}

function split(bytes: Uint8Array, size: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += size) out.push(bytes.subarray(offset, offset + size));
  return out;
}

describe("SSE decoding", () => {
  it("joins multi-line data, ignores comments and fields, and keeps a final unterminated record", async () => {
    const text = ": keep-alive\nevent: delta\ndata: {\"a\":1}\n\ndata:first\ndata:  second\r\n\r\nid: 7\ndata: [DONE]";
    expect(await collect([new TextEncoder().encode(text)])).toEqual(["{\"a\":1}", "first\n second", "[DONE]"]);
  });

  it("matches the line-by-line reference for every chunking, including split CRLF and multi-byte text", async () => {
    const pieces = ["data: é→✓", "data:", "data: x", ": c", "event: e", "", "\r", "data:  two", "id: 1", "data:\r", "retry: 5"];
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let round = 0; round < 300; round++) {
      const lines = Array.from({ length: 1 + Math.floor(random() * 25) }, () => pieces[Math.floor(random() * pieces.length)]);
      const text = lines.join(random() < 0.5 ? "\n" : "\r\n") + (random() < 0.5 ? "\n" : "");
      const bytes = new TextEncoder().encode(text);
      const size = 1 + Math.floor(random() * 12);
      expect(await collect(split(bytes, size))).toEqual(reference(text));
    }
  });
});
