/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { runStandaloneAgent } from "./standaloneHost";

export async function handleContainerCommand(cwd = process.cwd()) {
	const bold = "\x1b[1m";
	const cyan = "\x1b[36m";
	const reset = "\x1b[0m";

	console.log(`\n${bold}${cyan}[oc container] Synthesizing Dockerfile, Docker Compose & K8s Manifests...\x1b[0m\n`);

	const prompt = `Inspect the application runtime dependencies in ${cwd} and generate a multi-stage optimized Dockerfile, a docker-compose.yml service definition, and production Kubernetes deployment manifests.`;

	await runStandaloneAgent({
		prompt,
		mode: "agent",
		autoApprove: false,
	});
}
