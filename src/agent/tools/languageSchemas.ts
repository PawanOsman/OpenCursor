/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { ToolSpec } from "./schemas";

const position = {
  path: { type: "string", description: "Workspace file path. The current editor buffer is used, including unsaved changes." },
  line: { type: "integer", minimum: 1, description: "1-based line containing the symbol" },
  column: { type: "integer", minimum: 1, description: "1-based UTF-16 character position, as in VS Code" },
};

export const LANGUAGE_TOOL_SPECS: ToolSpec[] = [
  {
    name: "GoToDefinition",
    description: "Resolve a symbol through the workspace language service. Returns exact source locations with 1-based line/column positions. Requires a language extension/provider; an empty result does not prove no definition exists. Read the returned files before editing.",
    parameters: { type: "object", properties: { ...position, kind: { type: "string", enum: ["definition", "typeDefinition", "implementation"], description: "Defaults to definition" } }, required: ["path", "line", "column"], additionalProperties: false },
  },
  {
    name: "FindReferences",
    description: "Find symbol references through the language service instead of text matching. Includes source locations available to the provider within this workspace. Results may include the declaration. An empty result may mean no provider is available.",
    parameters: { type: "object", properties: { ...position, limit: { type: "integer", minimum: 1, maximum: 500, description: "Maximum returned locations (default 100)" } }, required: ["path", "line", "column"], additionalProperties: false },
  },
  {
    name: "WorkspaceSymbols",
    description: "Search names of classes, functions, types and other symbols using installed language services. Returns workspace locations rather than arbitrary text matches. The language provider determines matching and may still be indexing.",
    parameters: { type: "object", properties: { query: { type: "string", description: "Symbol name or fragment" }, limit: { type: "integer", minimum: 1, maximum: 500, description: "Maximum returned symbols (default 100)" } }, required: ["query"], additionalProperties: false },
  },
  {
    name: "RenamePreview",
    description: "Ask the language service for a cross-file symbol rename preview. NEVER applies edits. Returns proposed text edits, source buffer versions and bounded replacement text for review. Read and use normal approved edit tools if the user wants the rename applied; respect truncation and current file changes.",
    parameters: { type: "object", properties: { ...position, new_name: { type: "string", description: "Proposed symbol name" } }, required: ["path", "line", "column", "new_name"], additionalProperties: false },
  },
];
