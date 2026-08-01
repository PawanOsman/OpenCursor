/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { runStandaloneAgent } from "./standaloneHost";

export async function handleExplainCommand(targetFile?: string) {
	const bold = "\x1b[1m";
	const cyan = "\x1b[36m";
	const reset = "\x1b[0m";

	console.log(`\n${bold}${cyan}[oc explain] Synthesizing code explanation & architecture graph...\x1b[0m\n`);

	const prompt = `Deeply explain the architecture and control flow of ${targetFile || "the workspace"}. Include an ASCII flowchart of key modules and data structures.`;

	await runStandaloneAgent({
		prompt,
		mode: "ask",
	});
}
