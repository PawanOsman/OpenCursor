/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { runStandaloneAgent } from "./standaloneHost";

export async function handleCleanCommand() {
	const bold = "\x1b[1m";
	const cyan = "\x1b[36m";
	const reset = "\x1b[0m";

	console.log(`\n${bold}${cyan}[oc clean] Detecting unused exports & dead code branches...\x1b[0m\n`);

	const prompt = `Inspect the workspace for unused function exports, unreachable dead code blocks, orphan components, and unreferenced asset files. Propose safe removals.`;

	await runStandaloneAgent({
		prompt,
		mode: "plan",
	});
}
