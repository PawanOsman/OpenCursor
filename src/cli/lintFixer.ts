/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { runStandaloneAgent } from "./standaloneHost";

export async function handleLintFixCommand() {
	const bold = "\x1b[1m";
	const cyan = "\x1b[36m";
	const reset = "\x1b[0m";

	console.log(`\n${bold}${cyan}[oc lint-fix] Running linter auto-fix engine...\x1b[0m\n`);

	const prompt = `Run project linter (ESLint / Biome / Prettier / Black) auto-fix commands and fix any remaining manual lint warnings across the workspace.`;

	await runStandaloneAgent({
		prompt,
		mode: "agent",
		autoApprove: true,
	});
}
