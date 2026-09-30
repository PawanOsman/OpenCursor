/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { createServer, type Server } from "http";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { createHash } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { downloadModelFile } from "./modelDownload";

let root: string, destination: string, server: Server, url: string;
const bytes = Buffer.from("GGUF fixture weights for integrity checks");
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "ocursor-download-"));
  destination = path.join(root, "fixture.gguf");
  server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/model.gguf`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await fs.rm(root, { recursive: true, force: true });
});
describe("verified resumable model transfers", () => {
  it("publishes only a complete GGUF matching its expected size and hash", async () => {
    server.on("request", (_, response) => { response.setHeader("content-length", bytes.length); response.end(bytes); });
    await downloadModelFile(url, destination, { sha256: createHash("sha256").update(bytes).digest("hex"), expectedBytes: bytes.length });
    expect(await fs.readFile(destination)).toEqual(bytes);
    expect(await fs.readdir(root)).toEqual(["fixture.gguf"]);
  });
  it("retains a validated partial on cancellation and requests exactly the remaining range", async () => {
    const ranges: (string | undefined)[] = [];
    server.on("request", (request, response) => {
      ranges.push(request.headers.range);
      response.setHeader("etag", '"weights-v1"');
      if (!request.headers.range) { response.setHeader("content-length", bytes.length); response.write(bytes.subarray(0, 8)); }
      else {
        expect(request.headers["if-range"]).toBe('"weights-v1"');
        response.writeHead(206, { "content-range": `bytes 8-${bytes.length - 1}/${bytes.length}`, "content-length": bytes.length - 8 });
        response.end(bytes.subarray(8));
      }
    });
    const controller = new AbortController();
    await expect(downloadModelFile(url, destination, { signal: controller.signal, onProgress: () => controller.abort() })).rejects.toThrow();
    expect((await fs.stat(destination + ".part")).size).toBe(8);
    await downloadModelFile(url, destination);
    expect(ranges).toEqual([undefined, "bytes=8-"]);
    expect(await fs.readFile(destination)).toEqual(bytes);
  });
  it("restarts when a server ignores Range rather than appending duplicate bytes", async () => {
    await fs.writeFile(destination + ".part", bytes.subarray(0, 8));
    await fs.writeFile(destination + ".part.json", JSON.stringify({ url, validator: '"old"' }));
    server.on("request", (_, response) => { response.setHeader("etag", '"new"'); response.end(bytes); });
    await downloadModelFile(url, destination);
    expect(await fs.readFile(destination)).toEqual(bytes);
  });
  it("preserves the installed model and discards corrupt data on a checksum mismatch", async () => {
    await fs.writeFile(destination, "GGUF existing model");
    server.on("request", (_, response) => { response.setHeader("etag", '"corrupt"'); response.end(bytes); });
    await expect(downloadModelFile(url, destination, { sha256: "a".repeat(64) })).rejects.toThrow("checksum mismatch");
    expect(await fs.readFile(destination, "utf8")).toBe("GGUF existing model");
    expect(await fs.readdir(root)).toEqual(["fixture.gguf"]);
  });
  it("rejects an HTML error page even if HTTP reports success", async () => {
    server.on("request", (_, response) => response.end("<html>Access denied</html>"));
    await expect(downloadModelFile(url, destination)).rejects.toThrow("invalid header");
    expect(await fs.readdir(root)).toEqual([]);
  });
  it("bounds a stalled transfer and leaves a resumable representation", async () => {
    server.on("request", (_, response) => { response.setHeader("etag", '"slow"'); response.write(bytes.subarray(0, 8)); });
    await expect(downloadModelFile(url, destination, { timeoutMs: 150 })).rejects.toThrow();
    expect(await fs.readFile(destination + ".part")).toEqual(bytes.subarray(0, 8));
  });
});
