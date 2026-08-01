/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

export interface SubagentInfo {
	callId: string;
	title: string;
	status: "running" | "finished" | "error" | "cancelled";
	lastOutput?: string;
}

export function renderSubagentDashboard(subagents: SubagentInfo[]): string {
	if (!subagents.length) return "";

	const yellow = "\x1b[33m";
	const green = "\x1b[32m";
	const red = "\x1b[31m";
	const bold = "\x1b[1m";
	const reset = "\x1b[0m";
	const dim = "\x1b[2m";
	const bgBlue = "\x1b[44m\x1b[37m";

	const badges = subagents
		.map((s, idx) => {
			const color = s.status === "running" ? yellow : s.status === "finished" ? green : red;
			const icon = s.status === "running" ? "⏳" : s.status === "finished" ? "✔" : "✖";
			return `${bgBlue} [${idx + 1}] ${s.title} (${icon}) ${reset}`;
		})
		.join(" ");

	return `\n${bold}Parallel Subagents:${reset}\n${badges}\n${dim}Press Tab or 1-${subagents.length} to switch worker logs${reset}\n`;
}
