/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { runStandaloneAgent } from "./standaloneHost";

export async function handleRefactorCommand(refactorGoal?: string) {
	const bold = "\x1b[1m";
	const cyan = "\x1b[36m";
	const reset = "\x1b[0m";

	console.log(`\n${bold}${cyan}[oc refactor] Executing structural migration...\x1b[0m\n`);

	const prompt = `Refactor the target code according to the following migration goal: ${refactorGoal || "Modernize code structure, update deprecated APIs, and convert to ES Modules / TypeScript"}. Ensure zero breaking changes.`;

	await runStandaloneAgent({
		prompt,
		mode: "agent",
		autoApprove: false,
	});
}
