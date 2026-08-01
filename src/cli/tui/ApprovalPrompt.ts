/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

export function renderApprovalPrompt(toolName: string, detail?: string): string {
	const yellow = "\x1b[33m";
	const bold = "\x1b[1m";
	const reset = "\x1b[0m";
	const dim = "\x1b[2m";

	return `
${yellow}${bold}┌─ Approval Required ───────────────────────────────────┐${reset}
${yellow}│ Tool: ${bold}${toolName}${reset}${detail ? ` (${dim}${detail}${reset}${yellow})` : ""}
${yellow}└───────────────────────────────────────────────────────┘${reset}
Approve tool execution? [Y/n/a (always)]: `;
}
