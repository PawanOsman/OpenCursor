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
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { OAUTH_ENDPOINTS, GEMINI_CLI_API_CLIENT, geminiCLIUserAgent } from "../config/appConstants.js";

export class GeminiCLIExecutor extends BaseExecutor {
  _currentModel!: ProtocolValue;

  constructor() {
    super("gemini-cli", PROVIDERS["gemini-cli"]);
  }

  buildUrl(model: string, stream: boolean, urlIndex = 0) {
    const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    return `${this.config.baseUrl}:${action}`;
  }

  buildHeaders(credentials: ProtocolCredentials, stream = true) {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${credentials.accessToken}`,
      "User-Agent": geminiCLIUserAgent(this._currentModel),
      "X-Goog-Api-Client": GEMINI_CLI_API_CLIENT,
      "Accept": stream ? "text/event-stream" : "application/json"
    };
  }

  transformRequest(model: string, body: ProtocolRecord, stream: boolean, credentials: ProtocolCredentials) {
    // Store model for use in buildHeaders (called by base.execute after transformRequest)
    this._currentModel = model;
    // Cloud Code Assist wraps the Gemini payload: { project, model, request: <body> }
    if (body && body.request && body.model) return body;
    return {
      project: credentials?.projectId || body?.project,
      model,
      request: body
    };
  }

  // Parse RetryInfo.retryDelay from Google API 429 body to surface upstream retry hint
  parseError(response: Response, bodyText: string) {
    const base = super.parseError(response, bodyText);
    if (response.status !== 429 || !bodyText) return base;
    try {
      const parsed = JSON.parse(bodyText);
      const details = parsed?.error?.details;
      if (Array.isArray(details)) {
        for (const d of details) {
          if (d?.["@type"] === "type.googleapis.com/google.rpc.RetryInfo" && d?.retryDelay) {
            base.retryAfter = d.retryDelay;
            break;
          }
        }
      }
    } catch {}
    return base;
  }

  async refreshCredentials(credentials: ProtocolCredentials, log: ExecutorLogger | undefined) {
    if (!credentials.refreshToken) return null;

    try {
      const response = await fetch(OAUTH_ENDPOINTS.google.token, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: credentials.refreshToken,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret
        })
      });

      if (!response.ok) return null;

      const tokens = (await response.json() as ProtocolRecord);
      log?.info?.("TOKEN", "Gemini CLI refreshed");

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || credentials.refreshToken,
        expiresIn: tokens.expires_in,
        projectId: credentials.projectId
      };
    } catch ( caught) {
const error = caught as ProtocolError;
      log?.error?.("TOKEN", `Gemini CLI refresh error: ${error.message}`);
      return null;
    }
  }
}

export default GeminiCLIExecutor;
