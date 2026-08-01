/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

export function renderBanner(model: string, cwd: string, mode = "agent"): string {
	const cyan = "\x1b[36m";
	const bold = "\x1b[1m";
	const reset = "\x1b[0m";
	const dim = "\x1b[2m";
	const green = "\x1b[32m";

	return `
${bold}${cyan}┌────────────────────────────────────────────────────────┐${reset}
${bold}${cyan}│  OpenCursor Interactive CLI Agent (oc)  v0.1.0        │${reset}
${bold}${cyan}└────────────────────────────────────────────────────────┘${reset}
${dim}cwd:${reset}   ${green}${cwd}${reset}
${dim}model:${reset} ${bold}${cyan}${model}${reset}  ${dim}mode:${reset} ${bold}${mode.toUpperCase()}${reset}
${dim}Type ${cyan}/help${dim} for slash commands, ${cyan}/compact${dim} to summarize context.${reset}
`;
}
