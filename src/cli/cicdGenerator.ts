/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { runStandaloneAgent } from "./standaloneHost";

export async function handleCicdCommand(provider = "github") {
	const bold = "\x1b[1m";
	const cyan = "\x1b[36m";
	const reset = "\x1b[0m";

	console.log(`\n${bold}${cyan}[oc benchmark-ci] Generating ${provider} CI/CD Pipeline Workflow...\x1b[0m\n`);

	const prompt = `Inspect the project build scripts and generate a production ${provider} CI/CD pipeline workflow configuration file (.github/workflows/ci.yml or .gitlab-ci.yml) including test, lint, and build steps.`;

	await runStandaloneAgent({
		prompt,
		mode: "agent",
		autoApprove: false,
	});
}
