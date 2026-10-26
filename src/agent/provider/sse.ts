/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

/** Decode SSE records, including a final record without a trailing newline. */
export async function* sseData(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (done && buffer && !buffer.endsWith("\n")) buffer += "\n";
      // Walk the lines with a cursor and drop the consumed prefix once per read,
      // instead of re-slicing the remaining buffer after every line.
      let start = 0;
      let end: number;
      while ((end = buffer.indexOf("\n", start)) >= 0) {
        const lineEnd = end > start && buffer.charCodeAt(end - 1) === 13 ? end - 1 : end;
        if (lineEnd === start) {
          if (data.length) yield data.join("\n");
          data = [];
        } else if (buffer.startsWith("data:", start)) {
          const from = start + 5 < lineEnd && buffer.charCodeAt(start + 5) === 32 ? start + 6 : start + 5;
          data.push(buffer.slice(from, lineEnd));
        }
        start = end + 1;
      }
      if (start) buffer = buffer.slice(start);
      if (done) {
        if (data.length) yield data.join("\n");
        return;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
