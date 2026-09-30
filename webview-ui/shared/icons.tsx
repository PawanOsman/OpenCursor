/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as React from "react";
import { ICON_GEOMETRY } from "./iconGeometry";

export type IconName = keyof typeof ICON_GEOMETRY;

/** Functional glyphs use shared, static paths and viewBoxes. The
 * surrounding control owns its accessible name; the glyph stays decorative. */
export function Icon({ name, className, size = 16 }: { name: IconName; className?: string; size?: number }) {
  const icon = ICON_GEOMETRY[name];
  return <svg {...icon.attributes} width={size} height={size} className={className} aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: icon.body }} />;
}

/** Same static geometry for contenteditable mention pills owned by the DOM.
 * No external/user HTML can enter this registry. */
export function iconMarkup(name: IconName): string {
  const icon = ICON_GEOMETRY[name];
  const attrs = Object.entries(icon.attributes).map(([key, value]) => `${key === "viewBox" ? key : key.replace(/[A-Z]/g, letter => "-" + letter.toLowerCase())}="${value}"`).join(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" ${attrs} aria-hidden="true" focusable="false">${icon.body}</svg>`;
}
