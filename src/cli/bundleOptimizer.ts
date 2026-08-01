/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { runStandaloneAgent } from "./standaloneHost";

export async function handleBundleCommand() {
	const bold = "\x1b[1m";
	const cyan = "\x1b[36m";
	const reset = "\x1b[0m";

	console.log(`\n${bold}${cyan}[oc bundle] Analyzing bundle size & tree-shaking optimizations...\x1b[0m\n`);

	const prompt = `Inspect build configs (esbuild.js, webpack.config.js, vite.config.ts) and imported dependencies. Identify heavy packages and suggest code-splitting and tree-shaking optimizations.`;

	await runStandaloneAgent({
		prompt,
		mode: "ask",
	});
}
