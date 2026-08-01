/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { runStandaloneAgent } from "./standaloneHost";

export async function handleBenchCommand(targetFile?: string) {
	const bold = "\x1b[1m";
	const cyan = "\x1b[36m";
	const reset = "\x1b[0m";

	console.log(`\n${bold}${cyan}[oc bench] Analyzing code performance & memory profiling...\x1b[0m\n`);

	const prompt = `Inspect ${targetFile || "the codebase"} for potential performance bottlenecks, inefficient O(N^2) loops, memory leak risks, and unoptimized async operations. Suggest optimized implementations.`;

	await runStandaloneAgent({
		prompt,
		mode: "plan",
	});
}
