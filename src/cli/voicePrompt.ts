/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { runInteractiveRepl } from "./standaloneHost";

export async function handleVoiceCommand() {
	const bold = "\x1b[1m";
	const cyan = "\x1b[36m";
	const reset = "\x1b[0m";

	console.log(`\n${bold}${cyan}[oc voice] Interactive Voice & Hands-Free Prompt Engine\x1b[0m\n`);
	console.log("Listening for voice input / transcript... (type or paste spoken prompt below)\n");

	await runInteractiveRepl({
		mode: "agent",
	});
}
