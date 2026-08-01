/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

export async function handleApiCommand(url?: string, method = "GET") {
	const bold = "\x1b[1m";
	const cyan = "\x1b[36m";
	const green = "\x1b[32m";
	const red = "\x1b[31m";
	const reset = "\x1b[0m";

	if (!url) {
		console.log(`\nUsage: oc api <url> [method]\nExample: oc api https://api.github.com GET\n`);
		return;
	}

	console.log(`\n${bold}${cyan}[oc api] Requesting ${method} ${url}...\x1b[0m\n`);

	try {
		const res = await fetch(url, { method });
		const color = res.ok ? green : red;
		console.log(`Status: ${bold}${color}${res.status} ${res.statusText}${reset}`);
		console.log(`Headers: ${JSON.stringify(Object.fromEntries(res.headers.entries()), null, 2)}`);
		const body = await res.text();
		console.log(`\nResponse Body:\n${body.slice(0, 2000)}\n`);
	} catch (e: any) {
		console.error(`${red}API Request Failed:${reset}`, e?.message || e);
	}
}
