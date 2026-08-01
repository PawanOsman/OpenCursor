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

export interface ModelInfo {
	id: string;
	name: string;
	source: "llama.cpp" | "ollama";
	size?: string;
	status: "installed" | "available";
}

export async function listLocalModels(): Promise<ModelInfo[]> {
	const models: ModelInfo[] = [];

	// 1. Check local GGUF models directory (~/.ocursor/models or globalStorage)
	const localGgufDir = path.join(os.homedir(), ".ocursor", "models");
	if (fs.existsSync(localGgufDir)) {
		try {
			const files = fs.readdirSync(localGgufDir);
			for (const f of files) {
				if (f.endsWith(".gguf")) {
					const stat = fs.statSync(path.join(localGgufDir, f));
					const sizeMb = (stat.size / (1024 * 1024)).toFixed(1);
					models.push({
						id: f,
						name: f.replace(/\.gguf$/i, ""),
						source: "llama.cpp",
						size: `${sizeMb} MB`,
						status: "installed",
					});
				}
			}
		} catch {
			/* ignore */
		}
	}

	// 2. Query local Ollama daemon
	try {
		const res = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(2000) });
		if (res.ok) {
			const data = (await res.json()) as { models?: Array<{ name: string; size: number }> };
			for (const m of data.models || []) {
				const sizeGb = (m.size / (1024 * 1024 * 1024)).toFixed(2);
				models.push({
					id: `ollama::${m.name}`,
					name: m.name,
					source: "ollama",
					size: `${sizeGb} GB`,
					status: "installed",
				});
			}
		}
	} catch {
		/* Ollama daemon offline */
	}

	return models;
}

export async function handleModelsCommand(subcommand?: string, targetModel?: string) {
	const bold = "\x1b[1m";
	const cyan = "\x1b[36m";
	const reset = "\x1b[0m";
	const dim = "\x1b[2m";
	const green = "\x1b[32m";

	console.log(`\n${bold}${cyan}┌─ OpenCursor Local AI Model Manager ───────────────────┐${reset}`);

	const models = await listLocalModels();

	if (!models.length) {
		console.log(`\n${dim}No local GGUF or Ollama models detected.${reset}`);
		console.log(`\nTo use offline AI, either:`);
		console.log(` 1. Install Ollama (https://ollama.com) and run: ${green}ollama pull qwen2.5-coder${reset}`);
		console.log(` 2. Download a .gguf model to ${cyan}~/.ocursor/models/${reset}\n`);
		return;
	}

	console.log(`\nInstalled Local AI Models:\n`);
	for (const m of models) {
		console.log(`  ${green}✔${reset} ${bold}${m.name}${reset} (${m.source}) ${dim}${m.size || ""}${reset}`);
	}
	console.log("");
}
