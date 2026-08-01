/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

export function renderStatusBar(mode: string, model: string): string {
	const dim = "\x1b[2m";
	const reset = "\x1b[0m";
	const bgBlue = "\x1b[44m\x1b[37m\x1b[1m";

	return `\n${bgBlue} ${mode.toUpperCase()} ${reset} ${dim}model: ${model}${reset}\n`;
}
