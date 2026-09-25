/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import Ajv, { type ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020";
import type { ToolSchema } from "./types";
import { TOOL_SPECS } from "./tools/schemas";

// No coercion, default insertion or deletion: approval must see exactly what runs.
const options = { allErrors: true, strict: false, validateFormats: false, addUsedSchema: false };
const validators = [new Ajv(options), new Ajv2020(options)];
const cache = new WeakMap<object, ValidateFunction>();

export function resolveToolName(name: string, names: string[]): string {
  if (names.includes(name)) return name;
  const exact = names.find(candidate => candidate.toLowerCase() === name.toLowerCase());
  if (exact) return exact;
  // Some compatible endpoints append repeated IDE suffixes. Accept only a complete
  // built-in name in the supplied registry, never guessed prefixes or MCP aliases.
  if (/_ide$/i.test(name)) {
    let end = name.length;
    while (end >= 4 && name.slice(end - 4, end).toLowerCase() === "_ide") end -= 4;
    const base = name.slice(0, end).toLowerCase();
    const builtin = names.find(candidate => Object.hasOwn(TOOL_SPECS, candidate) && candidate.toLowerCase() === base);
    if (builtin) return builtin;
  }
  return name;
}

export function validateToolInput(schema: ToolSchema | undefined, input: unknown): string | undefined {
  if (!schema) return "Unknown or unavailable tool. ReadContext id=capabilities lists available tools; use an exact name.";
  if (!input || typeof input !== "object" || Array.isArray(input)) return "Tool arguments must be a JSON object.";
  const parameters = schema.function.parameters as Record<string, unknown> | undefined;
  if (!parameters) return undefined;
  try {
    let check = cache.get(parameters);
    if (!check) {
      check = validators[String(parameters.$schema ?? "").includes("2020-12") ? 1 : 0].compile(parameters);
      cache.set(parameters, check);
    }
    if (check(input)) return undefined;
    return (check.errors ?? []).slice(0, 8).map(error => `${error.instancePath || "/"}: ${error.message}${error.keyword === "required" ? ` (${error.params.missingProperty})` : ""}`).join("; ");
  } catch (error) {
    return `Tool schema cannot be validated: ${error instanceof Error ? error.message : String(error)}`;
  }
}
