/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as React from "react";
import { renderMarkdownBlocks } from "./markdown";

interface MountedBlock { html: string; nodes: ChildNode[] }

/**
 * Keep `root`'s children in sync with `blocks`, touching only blocks that
 * changed. Streaming appends to the trailing block, so earlier blocks keep
 * their DOM (no re-layout, and text selections inside them survive).
 */
export function patchMarkdownBlocks(root: HTMLElement, mounted: MountedBlock[], blocks: readonly string[]): void {
  let same = 0;
  while (same < mounted.length && same < blocks.length && mounted[same].html === blocks[same]) same++;
  for (let index = same; index < mounted.length; index++) for (const node of mounted[index].nodes) node.remove();
  mounted.length = same;
  for (let index = same; index < blocks.length; index++) {
    const template = document.createElement("template");
    template.innerHTML = blocks[index];
    const nodes = Array.from(template.content.childNodes);
    root.append(template.content);
    mounted.push({ html: blocks[index], nodes });
  }
}

/** Sanitized markdown, updated block by block instead of replacing all innerHTML. */
export const MarkdownView = React.memo(function MarkdownView({ text, autoDirection = true }: { text: string; autoDirection?: boolean }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const mounted = React.useRef<MountedBlock[]>([]);
  React.useLayoutEffect(() => {
    if (ref.current) patchMarkdownBlocks(ref.current, mounted.current, renderMarkdownBlocks(text));
  }, [text]);
  return <div ref={ref} className="markdown-content" dir={autoDirection ? "auto" : undefined} />;
});
