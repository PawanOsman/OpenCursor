/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it } from "vitest";
import { resolveToolName, validateToolInput } from "./toolValidation";
import { TOOL_SPECS } from "./tools/schemas";
const schemasForMode = (_mode: string) => Object.values(TOOL_SPECS).map(spec => ({ type: "function" as const, function: spec }));

describe("tool contracts", () => {
  it("resolves the IDE suffix only for complete registered built-in names", () => {
    expect(resolveToolName("Read_ide", ["Read"])).toBe("Read");
    expect(resolveToolName("Read_ide_ide", ["Read"])).toBe("Read");
    expect(resolveToolName("Read" + "_ide".repeat(10000), ["Read"])).toBe("Read");
    expect(resolveToolName("ListDir_ide_IDE_iDe", ["ListDir"])).toBe("ListDir");
    expect(resolveToolName("Read_other_ide_ide", ["Read"])).toBe("Read_other_ide_ide");
    expect(resolveToolName("Read_ide_ide", [])).toBe("Read_ide_ide");
    expect(resolveToolName("mcp__test__read_ide_ide", ["mcp__test__read"])).toBe("mcp__test__read_ide_ide");
    expect(resolveToolName("listdir_IDE", ["ListDir"])).toBe("ListDir");
    expect(resolveToolName("Read_ide", [])).toBe("Read_ide");
    expect(resolveToolName("Rea_ide", ["Read"])).toBe("Rea_ide");
    expect(resolveToolName("Read_other", ["Read"])).toBe("Read_other");
    expect(resolveToolName("mcp__test__read_ide", ["mcp__test__read"])).toBe("mcp__test__read_ide");
    expect(resolveToolName("Read_ide", ["Read", "Read_ide"])).toBe("Read_ide");
  });
  it("never dispatches a guessed prefix or prototype member", () => {
    expect(resolveToolName("Rea", ["Read", "ReadContext"])).toBe("Rea");
    expect(resolveToolName("read", ["Read"])).toBe("Read");
    expect(validateToolInput(undefined, {})).toContain("Unknown");
  });
  it("checks fields before execution without coercion", () => {
    const read = schemasForMode("agent").find(tool => tool.function.name === "Read")!;
    expect(validateToolInput(read, { path: "a.ts" })).toBeUndefined();
    expect(validateToolInput(read, { path: 42 })).toContain("string");
    expect(validateToolInput(read, {})).toContain("path");
    expect(validateToolInput(read, [])).toContain("object");
  });
  it("all built-in schemas compile", () => {
    for (const schema of schemasForMode("agent")) expect(validateToolInput(schema, {}) ?? "").not.toContain("cannot be validated");
  });
});
