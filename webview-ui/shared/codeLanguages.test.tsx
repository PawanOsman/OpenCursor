/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it } from "vitest";
import { CODE_LANGUAGES, escapeCodeHtml, getCodeLanguage, highlightCode, normalizeCodeLanguage } from "./codeLanguages";

describe("code language detection", () => {
  it.each([
    ['console.log("test");', "javascript"],
    ['const greet = (name) => `Hello ${name}`;', "javascript"],
    ['const name: string = "Pawan";', "typescript"],
    ['interface User { name: string; }', "typescript"],
    ['{"name":"value", "enabled":true}', "json"],
    ['{"unfinished":', "json"],
    ['print("Hello")', "python"],
    ['def greet(name):\n    return name', "python"],
    ['#!/usr/bin/env python3\nx = 1', "python"],
    ['SELECT name FROM users WHERE id = 3;', "sql"],
    ['<div class="hello">Hello</div>', "html"],
    ['<?xml version="1.0"?><items/>', "xml"],
    ['package main\nfunc main() { fmt.Println("hello") }', "go"],
    ['fn main() { println!("hello"); }', "rust"],
    ['#include <stdio.h>\nint main() { return 0; }', "c"],
    ['#include <iostream>\nstd::cout << "Hello";', "cpp"],
    ['void setup() { pinMode(1, OUTPUT); }\nvoid loop() {}', "arduino"],
    ['using System;\nConsole.WriteLine("Hello");', "csharp"],
    ['public class Main { public static void main(String[] args) {} }', "java"],
    ['Get-ChildItem -Path .', "powershell"],
    ['curl -H "accept: application/json" https://example.test', "bash"],
    ['FROM node:22\nWORKDIR /app\nCOPY . .', "dockerfile"],
    ['name: Example\nenabled: true', "yaml"],
    ['[database]\nhost=localhost\nport=123', "ini"],
    ['[package]\nname = "example"', "toml"],
    ['body { color: red; }', "css"],
    ['$color: red;\nbody { color: $color; }', "scss"],
    ['query { user { name } }', "graphql"],
    ['--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-a\n+b', "diff"],
    ['def hello\n  puts "Hello"\nend', "ruby"],
    ['local name = "hello"\nprint(name)', "lua"],
    ['fun main() { println("Hello") }', "kotlin"],
    ['import Foundation\nprint("Hello")', "swift"],
    ['case class User(name: String)', "scala"],
    ['use strict;\nmy $x = 1;', "perl"],
    ['data <- data.frame(x = c(1, 2))', "r"],
    ['build: source.c\n\tcc source.c', "makefile"],
    ['# Heading\nSome documentation', "markdown"],
  ])("detects %s", (code, id) => expect(getCodeLanguage(code).id).toBe(id));

  it("uses Plain text for unknown, empty and non-code content", () => {
    for (const content of ["", "ok", "Please fix the current function and explain your changes.", "TypeError: something failed\n at console.log (a.js:1)", "HTTP/1.1 200 OK\nContent-Type: application/json", "2026-01-02T12:00:00 INFO console.log(1)"])
      expect(getCodeLanguage(content)).toMatchObject({ id: "plaintext", label: "Plain text" });
  });
  it("keeps explicit language choices stable and normalizes aliases", () => {
    expect(getCodeLanguage('console.log("hello")', "text").id).toBe("plaintext");
    expect(getCodeLanguage('not code', " TSX ")).toMatchObject({ id: "typescript", label: "TypeScript" });
    expect(normalizeCodeLanguage("C#")).toBe("csharp");
    expect(normalizeCodeLanguage("unknown\" onclick=\"x")).toBe("plaintext");
    expect(normalizeCodeLanguage("")).toBe("auto");
    expect(new Set(CODE_LANGUAGES.map(language => language.id)).size).toBe(CODE_LANGUAGES.length);
  });
  it("limits automatic detection to a bounded prefix", () => {
    expect(getCodeLanguage(" ".repeat(24_000) + 'console.log("later")').id).toBe("plaintext");
  });
});

describe("safe lexical highlighting", () => {
  it("highlights strings, keywords, functions and numbers without changing text", () => {
    const code = 'const count = 42;\nconsole.log("test"); // comment';
    const html = highlightCode(code);
    for (const type of ["keyword", "number", "function", "string", "comment"]) expect(html).toContain(`class="code-token-${type}"`);
    expect(html.replace(/<\/?span[^>]*>/g, "")).toBe(escapeCodeHtml(code));
  });
  it("escapes markup and never uses a supplied language as HTML", () => {
    const code = '<img src=x onerror="alert(1)">\n<script>alert(1)</script>&';
    for (const explicit of ["html", "plaintext", '"><script>alert(1)</script>']) {
      const html = highlightCode(code, explicit);
      expect(html).not.toContain("<img"); expect(html).not.toContain("<script");
      expect(html.replace(/<\/?span[^>]*>/g, "")).toBe(escapeCodeHtml(code));
    }
  });
  it("preserves large pasted content while limiting highlight work", () => {
    const code = 'const x = 1;\n'.repeat(12_000) + "<unsafe>";
    const html = highlightCode(code, "javascript");
    expect(html.replace(/<\/?span[^>]*>/g, "")).toBe(escapeCodeHtml(code));
    expect(html.slice(html.lastIndexOf("</span>") + 7).length).toBeGreaterThan(64_000);
  });
});
