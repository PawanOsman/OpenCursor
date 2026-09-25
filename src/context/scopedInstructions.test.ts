/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseRuleFrontmatter, resolveScopedInstructions, ruleMatches } from "./scopedInstructions";

const fixture = vi.hoisted(() => ({ root: "" }));
vi.mock("vscode", () => ({ workspace: { get workspaceFolders() { return [{ uri: { fsPath: fixture.root } }]; } } }));
import { listSkills } from "./workspaceContext";
import { getWorkspaceRoot, withWorkspaceRoot } from "./workspaceUtils";

let directory: string;
beforeEach(async () => { directory = await fs.mkdtemp(path.join(tmpdir(), "ocursor-scopes-")); fixture.root = path.join(directory, "project"); await fs.mkdir(fixture.root); });
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });
async function write(relative: string, body: string) { const file = path.join(fixture.root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, body); return file; }

it("orders ancestor and nested instructions and excludes unrelated/new sibling scopes", async () => {
  await fs.writeFile(path.join(directory, "AGENTS.md"), "Parent constraint");
  await write("AGENTS.md", "Root constraint");
  await write("src/AGENTS.md", "Source constraint");
  await write("src/feature/AGENTS.md", "Feature default");
  await write("src/feature/AGENTS.override.md", "Feature override");
  await write("other/AGENTS.md", "Unrelated constraint");
  const rules = await resolveScopedInstructions(fixture.root, ["src/feature/new.ts", "../escape.ts"]);
  expect(rules.map((r) => r.content)).toEqual(["Parent constraint", "Root constraint", "Source constraint", "Feature override"]);
  expect(rules.at(-1)?.scope).toBe(path.join(fixture.root, "src", "feature"));
  expect(rules.every((rule) => /^[a-f0-9]{64}$/.test(rule.fingerprint))).toBe(true);
  await write("src/feature/AGENTS.override.md", "Updated override");
  const refreshed = await resolveScopedInstructions(fixture.root, ["src/feature/new.ts"]);
  expect(refreshed.at(-1)?.fingerprint).not.toBe(rules.at(-1)?.fingerprint);
});

it("applies glob rules for unopened paths with arrays, braces and zero-directory globstars", async () => {
  await write(".cursor/rules/components.mdc", '---\nalwaysApply: false\nglobs: ["src/**/*.{ts,tsx}", "tests/**/*.ts"]\n---\nComponent constraint');
  await write(".cursor/rules/docs.mdc", "---\nglobs:\n  - '**/*.md'\n  - '**/*.mdx'\n---\nDocs constraint");
  await write(".cursor/rules/always.md", "Always constraint");
  expect((await resolveScopedInstructions(fixture.root, ["src/app.ts"])).map((r) => r.content)).toEqual(["Always constraint", "Component constraint"]);
  expect((await resolveScopedInstructions(fixture.root, ["README.md"])).map((r) => r.content)).toEqual(["Always constraint", "Docs constraint"]);
  expect(ruleMatches('"*.ts, *.tsx"', "src/app.tsx")).toBe(true);
  expect(ruleMatches("src/*.ts", "other/src/file.ts")).toBe(false);
});

it("discovers workspace and user skills with workspace precedence and namespace folders", async () => {
  const home = path.join(directory, "user");
  await write(".agents/skills/testing/SKILL.md", "---\nname: testing\ndescription: >\n  Repository specific\n  test instructions\n---\n# Tests\nDo these tests.");
  const global = path.join(home, ".codex", "skills", ".system", "testing");
  await fs.mkdir(global, { recursive: true });
  await fs.writeFile(path.join(global, "SKILL.md"), "---\nname: testing\ndescription: user copy\n---\n# Testing");
  const other = path.join(home, ".agents", "skills", "docs");
  await fs.mkdir(other, { recursive: true }); await fs.writeFile(path.join(other, "SKILL.md"), "---\nname: docs\ndescription: Write documentation\n---\n# Docs");
  const skills = await listSkills({ root: fixture.root, userHome: home, codexHome: path.join(home, ".codex") });
  expect(skills.map((s) => s.name)).toEqual(["testing", "docs"]);
  expect(skills[0].description).toBe("Repository specific test instructions");
  expect(skills[0].path).toContain(path.join("project", ".agents"));
  expect(parseRuleFrontmatter("---\nname: 'quoted'\n---\nBody").name).toBe("quoted");
});

it("keeps concurrent asynchronous conversation roots isolated and restores the host default", async () => {
  const second = path.join(directory, "second");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const first = withWorkspaceRoot(fixture.root, async () => { await gate; return getWorkspaceRoot(); });
  const other = withWorkspaceRoot(second, async () => { await Promise.resolve(); release(); return getWorkspaceRoot(); });
  expect(await Promise.all([first, other])).toEqual([fixture.root, second]);
  expect(getWorkspaceRoot()).toBe(fixture.root);
});
