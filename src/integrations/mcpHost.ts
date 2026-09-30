/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as vscode from "vscode";
import type { ElicitRequest, ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import { mcpManager } from "./mcpClient";
import { validateMcpRemoteUrl } from "./mcpOAuth";

/** Native, explicit user input: an MCP server never receives an inferred answer. */
export async function presentMcpElicitation(server: string, request: ElicitRequest["params"], signal: AbortSignal): Promise<ElicitResult> {
  if (signal.aborted) return { action: "cancel" };
  const cancellation = new vscode.CancellationTokenSource();
  const abort = () => cancellation.cancel();
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (request.mode === "url") {
      const url = validateMcpRemoteUrl(request.url);
      const choice = await vscode.window.showInformationMessage(`${server} requests: ${request.message.slice(0, 2000)}\n\nOpen ${url.origin} to continue.`, { modal: true }, "Open browser", "Decline");
      if (signal.aborted || !choice) return { action: "cancel" };
      if (choice !== "Open browser") return { action: "decline" };
      return { action: await vscode.env.openExternal(vscode.Uri.parse(url.toString())) ? "accept" : "cancel" };
    }
    const entries = Object.entries(request.requestedSchema.properties);
    if (entries.length > 20) throw new Error("MCP form exceeds the supported 20-field limit.");
    const choice = await vscode.window.showInformationMessage(`${server} requests information:\n\n${request.message.slice(0, 2000)}`, { modal: true }, "Continue", "Decline");
    if (signal.aborted || !choice) return { action: "cancel" };
    if (choice !== "Continue") return { action: "decline" };
    const content: Record<string, string | number | boolean | string[]> = {};
    for (const [name, field] of entries) {
      if (signal.aborted) return { action: "cancel" };
      const required = request.requestedSchema.required?.includes(name) ?? false;
      const title = `${server}: ${field.title || name}${required ? " (required)" : ""}`;
      if (field.type === "boolean") {
        const options = required ? ["Yes", "No"] : ["Yes", "No", "Skip"];
        const answer = await vscode.window.showQuickPick(options, { title, placeHolder: field.description }, cancellation.token);
        if (answer === undefined) return { action: "cancel" };
        if (answer !== "Skip") content[name] = answer === "Yes";
      } else if (field.type === "string" && ("enum" in field || "oneOf" in field)) {
        const options = "enum" in field ? field.enum.map((value) => ({ label: value, value })) : field.oneOf.map((option) => ({ label: option.title ?? option.const, value: option.const }));
        const answer = await vscode.window.showQuickPick(options, { title, placeHolder: field.description }, cancellation.token);
        if (!answer) return { action: "cancel" };
        content[name] = answer.value;
      } else if (field.type === "array") {
        const items = field.items;
        const options = "enum" in items ? items.enum.map((value) => ({ label: value, value })) : items.anyOf.map((option) => ({ label: option.title ?? option.const, value: option.const }));
        const answer = await vscode.window.showQuickPick(options, { title, canPickMany: true, placeHolder: field.description }, cancellation.token);
        if (!answer) return { action: "cancel" };
        if ((required && !answer.length) || (field.minItems !== undefined && answer.length < field.minItems) || (field.maxItems !== undefined && answer.length > field.maxItems)) throw new Error("The selected MCP form values do not meet the requested count.");
        content[name] = answer.map((item) => item.value);
      } else {
        const answer = await vscode.window.showInputBox({ title, prompt: field.description, value: field.default === undefined ? undefined : String(field.default), validateInput: (value) => {
          if (!value) return required ? "A value is required." : undefined;
          if (field.type === "number" || field.type === "integer") {
            const number = Number(value);
            if (!Number.isFinite(number) || (field.type === "integer" && !Number.isInteger(number))) return "Enter a valid number.";
            if (field.minimum !== undefined && number < field.minimum) return `Minimum: ${field.minimum}`;
            if (field.maximum !== undefined && number > field.maximum) return `Maximum: ${field.maximum}`;
          } else if (field.type === "string") {
            if ("minLength" in field && field.minLength !== undefined && value.length < field.minLength) return `Minimum length: ${field.minLength}`;
            if ("maxLength" in field && field.maxLength !== undefined && value.length > field.maxLength) return `Maximum length: ${field.maxLength}`;
          }
          return undefined;
        } }, cancellation.token);
        if (answer === undefined) return { action: "cancel" };
        if (answer !== "" || required) content[name] = field.type === "number" || field.type === "integer" ? Number(answer) : answer;
      }
    }
    return signal.aborted ? { action: "cancel" } : { action: "accept", content };
  } finally { signal.removeEventListener("abort", abort); cancellation.dispose(); }
}

export function configureMcpAuthentication(context: vscode.ExtensionContext): void {
  mcpManager.configureHost({ secrets: context.secrets, openExternal: (url) => vscode.env.openExternal(vscode.Uri.parse(url)), elicit: presentMcpElicitation });
}
