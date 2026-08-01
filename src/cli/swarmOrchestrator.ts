/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { runStandaloneAgent } from "./standaloneHost";
import { renderSubagentDashboard } from "./tui/SubagentDashboard";

export async function handleSwarmCommand(goal?: string) {
	const bold = "\x1b[1m";
	const cyan = "\x1b[36m";
	const reset = "\x1b[0m";

	console.log(`\n${bold}${cyan}[oc swarm] Launching Multi-Agent Swarm Team...\x1b[0m\n`);

	const dashboard = renderSubagentDashboard([
		{ callId: "task-1", title: "Frontend UI Agent", status: "running" },
		{ callId: "task-2", title: "Backend API Agent", status: "running" },
		{ callId: "task-3", title: "QA & Test Agent", status: "running" },
	]);
	console.log(dashboard);

	const prompt = `Decompose and execute the following task using parallel subagent delegation: ${goal || "Build end-to-end fullstack feature with API, UI, and test coverage"}`;

	await runStandaloneAgent({
		prompt,
		mode: "multitask",
		autoApprove: false,
	});
}
