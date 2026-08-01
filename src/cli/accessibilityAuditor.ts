/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { runStandaloneAgent } from "./standaloneHost";

export async function handleAccessibilityCommand(targetFile?: string) {
	const bold = "\x1b[1m";
	const cyan = "\x1b[36m";
	const reset = "\x1b[0m";

	console.log(`\n${bold}${cyan}[oc accessibility] Auditing WCAG Accessibility & Screen Reader Compliance...\x1b[0m\n`);

	const prompt = `Audit ${targetFile || "the UI components"} for WCAG accessibility violations (missing aria-labels, semantic HTML, keyboard focus traps, contrast issues) and apply auto-remediations.`;

	await runStandaloneAgent({
		prompt,
		mode: "agent",
		autoApprove: false,
	});
}
