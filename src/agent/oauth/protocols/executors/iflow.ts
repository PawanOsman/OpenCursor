/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { ProtocolRecord, ProtocolValue, ProtocolCredentials, ProtocolError } from "../wireTypes.js";
import type { ExecutorConfig, ExecutorRequest, ExecutorResult, ExecutorLogger, TokenRefreshResult } from "./types.js";
import crypto from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";

/**
 * IFlowExecutor - Executor for iFlow API with HMAC-SHA256 signature
 */
export class IFlowExecutor extends BaseExecutor {
  constructor() {
    super("iflow", PROVIDERS.iflow);
  }

  /**
   * Generate UUID v4
   * @returns {string} UUID v4 string
   */
  generateUUID() {
    return crypto.randomUUID();
  }

  /**
   * Create iFlow signature using HMAC-SHA256
   * @param {string} userAgent - User agent string
   * @param {string} sessionID - Session ID
   * @param {number} timestamp - Unix timestamp in milliseconds
   * @param {string} apiKey - API key for signing
   * @returns {string} Hex-encoded signature
   */
  createIFlowSignature(userAgent: ProtocolValue, sessionID: ProtocolValue, timestamp: ProtocolValue, apiKey: ProtocolValue) {
    if (!apiKey) return "";
    const payload = `${userAgent}:${sessionID}:${timestamp}`;
    const hmac = crypto.createHmac("sha256", apiKey);
    hmac.update(payload);
    return hmac.digest("hex");
  }

  /**
   * Build headers with iFlow-specific signature
   * @param {object} credentials - Provider credentials
   * @param {boolean} stream - Whether streaming is enabled
   * @returns {object} Headers object
   */
  buildHeaders(credentials: ProtocolCredentials, stream = true) {
    // Generate session ID and timestamp
    const sessionID = `session-${this.generateUUID()}`;
    const timestamp = Date.now();

    // Get user agent from config
    const userAgent = this.config.headers?.["User-Agent"] || "iFlow-Cli";

    // Get API key (prefer apiKey, fallback to accessToken)
    const apiKey = credentials.apiKey || credentials.accessToken || "";

    // Create signature
    const signature = this.createIFlowSignature(userAgent, sessionID, timestamp, apiKey);

    // Build headers
    const headers: Record<string,string> = {
      "Content-Type": "application/json",
      ...this.config.headers,
      "session-id": sessionID,
      "x-iflow-timestamp": timestamp.toString(),
      "x-iflow-signature": signature
    };

    // Add authorization
    if (credentials.apiKey) {
      headers["Authorization"] = `Bearer ${credentials.apiKey}`;
    }

    // Add streaming header
    if (stream) {
      headers["Accept"] = "text/event-stream";
    }

    return headers;
  }

  /**
   * Build URL for iFlow API
   * @param {string} model - Model name
   * @param {boolean} stream - Whether streaming is enabled
   * @param {number} urlIndex - URL index for fallback
   * @param {object} credentials - Provider credentials
   * @returns {string} API URL
   */
  buildUrl(model: string, stream: boolean, urlIndex = 0, credentials: ProtocolCredentials | null = null) {
    return this.config.baseUrl!;
  }

  /**
   * Transform request body - inject stream_options for usage data
   * @param {string} model - Model name
   * @param {object} body - Request body
   * @param {boolean} stream - Whether streaming is enabled
   * @param {object} credentials - Provider credentials
   * @returns {object} Transformed body
   */
  transformRequest(model: string, body: ProtocolRecord, stream: boolean, credentials: ProtocolCredentials) {
    // Inject stream_options for streaming requests to get usage data
    if (stream && body.messages && !body.stream_options) {
      body.stream_options = { include_usage: true };
    }
    return body;
  }
}

export default IFlowExecutor;
