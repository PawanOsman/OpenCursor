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

export interface PluginInfo {
	name: string;
	path: string;
}

export function discoverPlugins(cwd = process.cwd()): PluginInfo[] {
	const plugins: PluginInfo[] = [];

	const dirs = [path.join(os.homedir(), ".ocursor", "plugins"), path.join(cwd, ".ocursor", "plugins")];

	for (const dir of dirs) {
		if (fs.existsSync(dir)) {
			try {
				const files = fs.readdirSync(dir);
				for (const f of files) {
					if (f.endsWith(".js") || f.endsWith(".ts")) {
						plugins.push({ name: f, path: path.join(dir, f) });
					}
				}
			} catch {
				/* ignore */
			}
		}
	}

	return plugins;
}

export async function handlePluginCommand(action = "list") {
	const bold = "\x1b[1m";
	const cyan = "\x1b[36m";
	const green = "\x1b[32m";
	const reset = "\x1b[0m";
	const dim = "\x1b[2m";

	console.log(`\n${bold}${cyan}┌─ OpenCursor Plugin & Extension Manager ──────────────┐${reset}`);

	const plugins = discoverPlugins();

	if (!plugins.length) {
		console.log(`\n${dim}No custom plugins installed.${reset}`);
		console.log(`To add a custom tool plugin, create a JS/TS file under ${cyan}~/.ocursor/plugins/${reset}\n`);
		return;
	}

	console.log(`\nInstalled Custom Plugins:\n`);
	for (const p of plugins) {
		console.log(`  ${green}✔${reset} ${bold}${p.name}${reset} (${dim}${p.path}${reset})`);
	}
	console.log("");
}
