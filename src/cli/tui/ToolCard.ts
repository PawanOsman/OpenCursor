/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

export interface ToolCardProps {
	name: string;
	status: "running" | "completed" | "error";
	input?: string;
	result?: string;
}

export function renderToolCard(props: ToolCardProps): string {
	const yellow = "\x1b[33m";
	const green = "\x1b[32m";
	const red = "\x1b[31m";
	const bold = "\x1b[1m";
	const reset = "\x1b[0m";
	const dim = "\x1b[2m";

	const symbol = props.status === "running" ? `${yellow}⠋${reset}` : props.status === "completed" ? `${green}✔${reset}` : `${red}✖${reset}`;
	const color = props.status === "running" ? yellow : props.status === "completed" ? green : red;

	let summary = "";
	if (props.input) {
		try {
			const parsed = typeof props.input === "string" ? JSON.parse(props.input) : props.input;
			summary = parsed.path || parsed.command || parsed.query || parsed.prompt || "";
		} catch {
			summary = props.input;
		}
	}

	const detail = summary ? ` ${dim}${summary.slice(0, 80)}${reset}` : "";

	return `${symbol} ${bold}${color}[${props.name}]${reset}${detail}`;
}
