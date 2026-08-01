/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { renderBanner } from "./Banner";
import { renderStatusBar } from "./StatusBar";
import { renderToolCard } from "./ToolCard";
import type { AgentEvent, Mode } from "../../agent/types";

export interface TuiAppOptions {
	model: string;
	mode: Mode;
	cwd: string;
}

export class TuiSession {
	constructor(private options: TuiAppOptions) {}

	public startBanner(): void {
		console.log(renderBanner(this.options.model, this.options.cwd, this.options.mode));
	}

	public handleEvent(event: AgentEvent): void {
		if (event.type === "text-delta") {
			process.stdout.write(event.text);
		} else if (event.type === "thinking-delta") {
			process.stdout.write(`\x1b[90m${event.text}\x1b[0m`);
		} else if (event.type === "tool-call-started") {
			console.log(renderToolCard({ name: event.name, status: "running", input: JSON.stringify(event.input) }));
		} else if (event.type === "tool-call-completed") {
			console.log(renderToolCard({ name: event.name, status: event.status }));
		} else if (event.type === "run-status" && (event.status === "finished" || event.status === "error")) {
			console.log(renderStatusBar(this.options.mode, this.options.model));
		}
	}
}
