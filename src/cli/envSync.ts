/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { runStandaloneAgent } from "./standaloneHost";

export async function handleEnvCommand() {
	const bold = "\x1b[1m";
	const cyan = "\x1b[36m";
	const reset = "\x1b[0m";

	console.log(`\n${bold}${cyan}[oc env] Synchronizing environment variables & .env.example...\x1b[0m\n`);

	const prompt = `Scan the codebase for process.env / os.getenv variable references and update .env.example with placeholders for all required environment keys. Never leak actual secret values.`;

	await runStandaloneAgent({
		prompt,
		mode: "agent",
		autoApprove: false,
	});
}
