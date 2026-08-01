/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import { runStandaloneAgent } from "./standaloneHost";

export async function handleWatchCommand(cwd = process.cwd()) {
	const bold = "\x1b[1m";
	const cyan = "\x1b[36m";
	const green = "\x1b[32m";
	const reset = "\x1b[0m";
	const dim = "\x1b[2m";

	console.log(`\n${bold}${cyan}┌─ OpenCursor Continuous Watch Daemon ──────────────────┐${reset}`);
	console.log(`${dim}Watching workspace:${reset} ${green}${cwd}${reset}`);
	console.log(`${dim}Auto-running build checks on save. Press Ctrl+C to stop.${reset}\n`);

	let debounceTimer: NodeJS.Timeout | undefined;

	fs.watch(cwd, { recursive: true }, (eventType, filename) => {
		if (!filename || filename.includes("node_modules") || filename.includes(".git") || filename.includes("dist")) {
			return;
		}

		if (debounceTimer) clearTimeout(debounceTimer);

		debounceTimer = setTimeout(() => {
			console.log(`\x1b[33m[watch] Change detected in ${filename}. Checking...${reset}`);

			exec("pnpm run check-types", { cwd }, (error, stdout, stderr) => {
				if (error) {
					console.log(`\x1b[31m[watch] Build check failed! Triggering oc fix...\x1b[0m`);
					const errorOutput = (stdout + "\n" + stderr).slice(0, 1000);
					runStandaloneAgent({
						prompt: `Fix the following build check failure in ${filename}:\n${errorOutput}`,
						mode: "agent",
						autoApprove: true,
					}).catch(() => {});
				} else {
					console.log(`\x1b[32m✔ [watch] All checks passed cleanly.${reset}`);
				}
			});
		}, 1000);
	});
}
