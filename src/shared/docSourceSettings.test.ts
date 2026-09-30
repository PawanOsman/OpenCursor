/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it } from "vitest";
import { docIndexSettingsChanged, normalizeDocSourceSettings } from "./docSourceSettings";

const source = { name: "API docs", url: "https://example.test/docs/api#streaming" };
describe("documentation source settings", () => {
  it("defaults to bounded section indexing and deduplicates normalized path exclusions", () => {
    expect(normalizeDocSourceSettings({ ...source, excludePaths: [" /docs/archive/ ", "/docs/archive"] })).toEqual({
      name: "API docs", url: "https://example.test/docs/api", scope: "section", maxPages: 200, useAi: true,
      focus: undefined, scopePath: undefined, excludePaths: ["/docs/archive"],
    });
  });
  it("clamps numeric budgets and preserves an explicitly disabled planner", () => {
    expect(normalizeDocSourceSettings({ ...source, maxPages: 100000, useAi: false })).toMatchObject({ maxPages: 1000, useAi: false });
    expect(normalizeDocSourceSettings({ ...source, maxPages: -4 })).toMatchObject({ maxPages: 1 });
    expect(normalizeDocSourceSettings({ ...source, maxPages: "not-a-number" })).toMatchObject({ maxPages: 200 });
  });
  it.each(["file:///private/path", "javascript:alert(1)", "https://user:password@example.test/docs", "bad URL"])("rejects unsafe or malformed URLs: %s", url => {
    expect(() => normalizeDocSourceSettings({ ...source, url })).toThrow();
  });
  it.each(["https://other.test/docs", "//other.test/docs", "/docs?all=1", "/docs#topic", "/docs\\other"])("rejects invalid path limits: %s", scopePath => {
    expect(() => normalizeDocSourceSettings({ ...source, scopePath })).toThrow();
    expect(() => normalizeDocSourceSettings({ ...source, excludePaths: [scopePath] })).toThrow();
  });
  it("rebuilds when indexing options change while a rename leaves the index valid", () => {
    const before = normalizeDocSourceSettings(source);
    expect(docIndexSettingsChanged(before, { ...before, name: "New name" })).toBe(false);
    for (const patch of [{ scope: "page" as const }, { scopePath: "/docs" }, { focus: "Streaming" }, { useAi: false }, { maxPages: 5 }, { excludePaths: ["/docs/archive"] }]) {
      expect(docIndexSettingsChanged(before, { ...before, ...patch })).toBe(true);
    }
  });
});
