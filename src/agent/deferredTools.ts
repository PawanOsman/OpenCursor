/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { ContextArchive } from "./contextArchive";
import type { ToolSchema } from "./types";

const DEFER_ABOVE_CHARS = 8000;

/** Optional capabilities stay discoverable without enlarging every request. */
export const OPTIONAL_BUILTIN_TOOLS = new Set([
  "BrowserNavigate", "BrowserInspect", "BrowserScreenshot", "BrowserInteract", "BrowserClose",
  "GoToDefinition", "FindReferences", "WorkspaceSymbols", "RenamePreview",
  "ListAgents", "SendAgentMessage", "FollowupAgent", "InterruptAgent", "WaitForAgent",
  "RunChecks", "GetVerificationEvidence", "GetGoal", "UpdateGoal", "WriteStdin",
]);

export interface DeferredSchemaOptions { label?: string; thresholdChars?: number }

/**
 * Keep large installed-tool collections out of every model request. A compact
 * searchable catalog points to full archived schemas; reading one makes that
 * tool available in subsequent requests. Activation grants no execution or
 * approval permissions, which remain the agent loop's responsibility.
 */
export class DeferredToolSchemas {
  readonly isDeferred: boolean;
  readonly catalogId?: string;
  private readonly schemas: ToolSchema[];
  private readonly activeNames: Set<string>;
  private readonly namesByArchiveId = new Map<string, string>();

  constructor(archive: ContextArchive, schemas: ToolSchema[], usedNames: Set<string> = new Set(), options: DeferredSchemaOptions = {}) {
    this.schemas = [...schemas];
    this.activeNames = new Set(usedNames);
    const label = options.label ?? "MCP";
    this.isDeferred = schemas.length > 0 && JSON.stringify(schemas).length > (options.thresholdChars ?? DEFER_ABOVE_CHARS);
    if (!this.isDeferred) return;

    const catalog = [
      `Available ${label} tools. Search this catalog by name or description using ReadContext pattern.`,
      "Read a tool's schema archive id to load its full parameters and make it available for a later tool call.",
      "Reading a schema does not execute the tool; normal mode restrictions and approvals still apply.",
      "",
    ];
    for (const schema of this.schemas) {
      const name = schema.function.name;
      const id = archive.store(JSON.stringify(schema), `${label} schema ${name}`);
      this.namesByArchiveId.set(id, name);
      const description = schema.function.description.replace(/\s+/g, " ").trim().slice(0, 160);
      catalog.push(`${name} — ${description} — ReadContext {"id":"${id}"}`);
    }
    this.catalogId = archive.store(catalog.join("\n"), `${label} tool catalog`);
  }

  /** Preserve registry ordering so activating a tool changes only necessary schemas. */
  activeSchemas(): ToolSchema[] {
    return this.schemas.filter((schema) => !this.isDeferred || this.activeNames.has(schema.function.name));
  }

  /** Only known schema ids can activate tools; catalog reads have no side effects. */
  activate(id: string): boolean {
    const name = this.namesByArchiveId.get(id);
    if (!name || this.activeNames.has(name)) return false;
    this.activeNames.add(name);
    return true;
  }
}
