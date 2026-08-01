/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { runStandaloneAgent } from "./standaloneHost";

export async function handleDbCommand(queryOrTask?: string) {
	const bold = "\x1b[1m";
	const cyan = "\x1b[36m";
	const reset = "\x1b[0m";

	console.log(`\n${bold}${cyan}[oc db] Database Schema & Query Optimization Assistant...\x1b[0m\n`);

	const prompt = `Inspect database schema files, ORM definitions (Prisma, TypeORM, SQLALchemy), and queries. ${queryOrTask || "Propose schema migrations, missing indexes, and query optimizations."}`;

	await runStandaloneAgent({
		prompt,
		mode: "agent",
		autoApprove: false,
	});
}
