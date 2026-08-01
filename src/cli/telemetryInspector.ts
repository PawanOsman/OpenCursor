/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export async function handleTelemetryCommand() {
	const bold = "\x1b[1m";
	const cyan = "\x1b[36m";
	const green = "\x1b[32m";
	const reset = "\x1b[0m";
	const dim = "\x1b[2m";

	console.log(`\n${bold}${cyan}┌─ OpenCursor Local Telemetry & Performance Inspector ─┐${reset}`);

	const telemetryFile = path.join(os.homedir(), ".ocursor", "telemetry.json");

	if (!fs.existsSync(telemetryFile)) {
		console.log(`\n${dim}No local telemetry records found at ${telemetryFile}.${reset}`);
		console.log(`${green}✔ Local privacy status: Clean & Private.${reset}\n`);
		return;
	}

	try {
		const data = JSON.parse(fs.readFileSync(telemetryFile, "utf8"));
		console.log(`\nLocal Performance Records:`);
		console.log(JSON.stringify(data, null, 2));
	} catch {
		console.log(`\n${dim}Telemetry record file unreadable.${reset}\n`);
	}
}
