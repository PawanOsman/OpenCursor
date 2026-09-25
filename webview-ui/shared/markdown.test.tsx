/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";

const htmlDocument = (html: string): Document => new DOMParser().parseFromString(html, "text/html");

const observed = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock("marked", async (original) => {
  const actual = await original<typeof import("marked")>();
  return { ...actual, Marked: class extends actual.Marked {
    constructor(...args: import("marked").MarkedExtension[]) {
      super(...args);
      observed.parse = vi.fn(this.parse);
      this.parse = observed.parse;
    }
  } };
});

beforeEach(() => { vi.resetModules(); });

async function renderer() {
  const { renderMarkdown } = await import("./markdown");
  return { renderMarkdown, parse: observed.parse };
}

it("reuses unchanged markdown without parsing it again", async () => {
  const { renderMarkdown, parse } = await renderer();
  expect(renderMarkdown("**Finished**")).toContain("<strong>Finished</strong>");
  renderMarkdown("**Finished**");
  expect(parse).toHaveBeenCalledTimes(1);
});

it("evicts large streaming revisions by memory cost before reaching the entry limit", async () => {
  const { renderMarkdown, parse } = await renderer();
  const first = "```text\n" + "a".repeat(80000) + "\n```";
  renderMarkdown(first);
  for (let revision = 0; revision < 32; revision++) renderMarkdown(first + revision);
  const calls = parse.mock.calls.length;
  renderMarkdown(first);
  expect(parse).toHaveBeenCalledTimes(calls + 1);
});

it("renders oversized responses without retaining them or evicting useful small entries", async () => {
  const { renderMarkdown, parse } = await renderer();
  renderMarkdown("A small message");
  const large = "```text\n" + "x".repeat(140000) + "\n```";
  expect(renderMarkdown(large)).toContain("x".repeat(140000));
  renderMarkdown(large);
  renderMarkdown("A small message");
  expect(parse).toHaveBeenCalledTimes(3);
});

it.each(["javascript", "js", "JS", "javascript title=example.js"])("highlights explicit %s fences", async language => {
  const { renderMarkdown } = await renderer();
  const doc = htmlDocument(renderMarkdown("```" + language + '\nconst name = "pawan";\nconsole.log(name);\n```'));
  const code = doc.querySelector("pre code")!;
  expect(code.className).toBe("language-javascript");
  expect(code.querySelector(".code-token-keyword")?.textContent).toBe("const");
  expect(code.querySelector(".code-token-string")?.textContent).toBe('"pawan"');
  expect(code.querySelector(".code-token-function")?.textContent).toBe("log");
  expect(code.textContent).toBe('const name = "pawan";\nconsole.log(name);\n');
});

it.each(["", "auto"])("detects each %s fence independently, leaving prose output plain", async language => {
  const { renderMarkdown } = await renderer();
  const source = ['console.log("pawan");', 'print("hello")', "pawan"].map(code => "```" + language + "\n" + code + "\n```").join("\n\n");
  const blocks = htmlDocument(renderMarkdown(source)).querySelectorAll("pre code");
  expect(Array.from(blocks, code => code.className)).toEqual(["language-javascript", "language-python", "language-plaintext"]);
  expect(blocks[0].querySelector(".code-token-function")?.textContent).toBe("log");
  expect(blocks[1].querySelector(".code-token-function")?.textContent).toBe("print");
  expect(blocks[2].children.length).toBe(0);
});

it.each(["plaintext", "text", "none", "unknown-language"])("honors an explicit %s choice instead of auto detection", async language => {
  const { renderMarkdown } = await renderer();
  const code = htmlDocument(renderMarkdown("```" + language + '\nconsole.log("pawan");\n```')).querySelector("pre code")!;
  expect(code.className).toBe("language-plaintext");
  expect(code.children.length).toBe(0);
  expect(code.textContent).toBe('console.log("pawan");\n');
});

it("escapes code and fence labels while preserving examples of HTML attributes", async () => {
  const { renderMarkdown } = await renderer();
  const sample = '<button onclick="alert(1)" href="javascript:example">& test</button>\n// onload="keep this text"';
  const source = "```html\n" + sample + '\n```\n\n```\" onclick=\"alert(1)\n' + sample + "\n```";
  const doc = htmlDocument(renderMarkdown(source));
  expect(doc.querySelectorAll("button, [onclick], [onload]").length).toBe(0);
  expect(Array.from(doc.querySelectorAll("pre code"), code => code.textContent)).toEqual([sample + "\n", sample + "\n"]);
  expect(doc.querySelector(".code-token-tag")?.textContent).toBe("button");
});

it("still removes dangerous raw markup outside code", async () => {
  const { renderMarkdown } = await renderer();
  const doc = htmlDocument(renderMarkdown('<img alt="< >" src="x" onerror="alert(1)"><a href="javascript:alert(1)">link</a><script>alert(1)</script>'));
  expect(doc.querySelectorAll("script, [onerror]").length).toBe(0);
  expect(doc.querySelector("a")?.getAttribute("href")).toBe("#");
});

it("keeps highlighted code left-to-right within mixed direction text", async () => {
  const { renderMarkdown } = await renderer();
  const doc = htmlDocument(renderMarkdown('مرحبا\n\n```js\nconsole.log("مرحبا");\n```'));
  expect(doc.querySelector("p")?.getAttribute("dir")).toBe("auto");
  expect(doc.querySelector("pre")?.getAttribute("dir")).toBe("ltr");
  expect(doc.querySelector("code")?.getAttribute("dir")).toBe("ltr");
  expect(doc.querySelector(".code-token-string")?.textContent).toBe('"مرحبا"');
});

it("bounds highlighting across large responses without truncating code", async () => {
  const { renderMarkdown } = await renderer();
  const sample = "const ready = true;\n".repeat(3400);
  const source = [sample, sample, 'console.log("last");'].map(code => "```js\n" + code + "\n```").join("\n\n");
  const blocks = htmlDocument(renderMarkdown(source)).querySelectorAll("pre code");
  expect(blocks[0].querySelector(".code-token-keyword")).not.toBeNull();
  expect(blocks[1].querySelector(".code-token-keyword")).not.toBeNull();
  expect(blocks[2].children.length).toBe(0);
  expect(blocks[0].textContent).toBe(sample);
  expect(blocks[1].textContent).toBe(sample);
  expect(blocks[2].textContent).toBe('console.log("last");\n');
  const next = htmlDocument(renderMarkdown('```js\nconsole.log("new response");\n```'));
  expect(next.querySelector(".code-token-function")?.textContent).toBe("log");
});
