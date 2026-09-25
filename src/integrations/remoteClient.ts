/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { JobRequest, JobState } from "../worker/jobs";

export function workerEndpoint(value: string): string {
  const url = new URL(value.trim());
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("Use HTTPS for remote workers, or HTTP on localhost through an SSH tunnel.");
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) throw new Error("Enter only the worker origin, without credentials, path, query or fragment.");
  return url.origin;
}

function jobId(id: string): string {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid remote job ID");
  return id;
}

/** Bounded authenticated worker protocol. Redirects cannot forward credentials. */
export class RemoteJobClient {
  readonly endpoint: string;
  constructor(endpoint: string, private token: string) {
    this.endpoint = workerEndpoint(endpoint);
    if (token.length < 32 || /[\r\n]/.test(token)) throw new Error("Worker tokens must contain at least 32 characters and no line breaks.");
  }
  private async request(route: string, method = "GET", data?: unknown, patch = false): Promise<string> {
    const response = await fetch(this.endpoint + route, {
      method, redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${this.token}`, ...(data === undefined ? {} : { "Content-Type": "application/json" }) },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const limit = patch ? 32 * 1024 * 1024 : 2 * 1024 * 1024;
    const chunks: Uint8Array[] = []; let size = 0;
    const reader = response.body?.getReader();
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > limit) { await reader.cancel(); throw new Error("Worker response exceeds the allowed size."); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
    }
    const text = Buffer.concat(chunks).toString("utf8");
    if (!response.ok) {
      let detail = "";
      try { detail = String(JSON.parse(text).error ?? "").slice(0, 500); } catch { /* Do not render arbitrary remote HTML. */ }
      throw new Error(`Worker request failed (${response.status})${detail ? `: ${detail}` : ""}`);
    }
    return text;
  }
  async health(): Promise<void> {
    const result = JSON.parse(await this.request("/v1/health"));
    if (result.version !== 1 || result.status !== "ready") throw new Error("Unsupported or unavailable worker.");
  }
  async list(): Promise<JobState[]> {
    const result: JobState[] = JSON.parse(await this.request("/v1/jobs"));
    if (!Array.isArray(result)) throw new Error("Invalid worker jobs response.");
    for (const job of result) jobId(job.id);
    return result;
  }
  async get(id: string): Promise<JobState> { return JSON.parse(await this.request(`/v1/jobs/${jobId(id)}`)); }
  async submit(request: JobRequest): Promise<JobState> { return JSON.parse(await this.request("/v1/jobs", "POST", request)); }
  async cancel(id: string): Promise<JobState> { return JSON.parse(await this.request(`/v1/jobs/${jobId(id)}/cancel`, "POST")); }
  async patch(id: string): Promise<string> { return this.request(`/v1/jobs/${jobId(id)}/patch`, "GET", undefined, true); }
}
