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
import * as readline from "readline";
import { runAgent } from "../agent/loop";
import type { RunAgentOptions } from "../agent/loopTypes";
import type { AgentEvent, Mode } from "../agent/types";
import { TuiSession } from "./tui/App";
import { renderApprovalPrompt } from "./tui/ApprovalPrompt";
import { RawInteractiveRepl } from "./tui/InteractiveRepl";

export interface StandaloneOptions {
	prompt?: string;
	mode?: Mode;
	cwd?: string;
	configFile?: string;
	autoApprove?: boolean;
}

function loadConfig(configPath?: string) {
	const defaultPath = path.join(os.homedir(), ".ocursor", "config.json");
	const targetPath = configPath || defaultPath;
	if (fs.existsSync(targetPath)) {
		try {
			return JSON.parse(fs.readFileSync(targetPath, "utf-8"));
		} catch (e) {
			console.error(`Failed to parse config at ${targetPath}`, e);
		}
	}
	return {};
}

function askConsole(query: string): Promise<string> {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(query, (ans) => {
			rl.close();
			resolve(ans);
		});
	});
}

export async function runStandaloneAgent(options: StandaloneOptions) {
	const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
	process.env.OPEN_CURSOR_WORKSPACE_ROOT = cwd;
	const config = loadConfig(options.configFile);
	const ac = new AbortController();
	process.on("SIGINT", () => {
		console.log("\nReceived SIGINT. Aborting...");
		ac.abort();
	});

	const tui = new TuiSession({
		model: config.model || "gpt-4o",
		mode: options.mode || "agent",
		cwd,
	});

	if (options.prompt) {
		tui.startBanner();
	}

	const runOptions: RunAgentOptions = {
		apiBaseUrl: config.apiBaseUrl || process.env.OPENAI_BASE_URL || (config.apiKey?.startsWith("sk-or-v1-") ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1"),
		apiKey: config.apiKey || process.env.OPENAI_API_KEY || "",
		model: config.model || "gpt-4o",
		mode: options.mode || "agent",
		prompt: options.prompt || "",
		history: [],
		enableFileReading: true,
		enableTerminalSuggestions: true,
		enableWorkspaceContext: true,
		signal: ac.signal,
		emit: (e: AgentEvent) => tui.handleEvent(e),
		askUser: async (_callId, header, questions) => {
			console.log(`\n--- Agent Question ---`);
			if (header) console.log(header);
			const answers: Record<string, string[]> = {};
			for (let idx = 0; idx < questions.length; idx++) {
				const q = questions[idx];
				const ans = await askConsole(`${q.question}: `);
				answers[String(idx)] = [ans];
			}
			return answers;
		},
		approve: async (toolName, input) => {
			if (options.autoApprove) return true;
			const detail = JSON.stringify(input);
			const ans = await askConsole(renderApprovalPrompt(toolName, detail.length > 60 ? detail.slice(0, 57) + "..." : detail));
			if (ans.trim().toLowerCase() === "n") {
				return { approved: false, blockedSubject: "User rejected" };
			}
			return true;
		},
	};

	if (!runOptions.apiKey) {
		console.error("Error: No API key found. Set OPENAI_API_KEY environment variable or configure ~/.ocursor/config.json");
		process.exit(1);
	}

	await runAgent(runOptions);
}

export async function runInteractiveRepl(options: StandaloneOptions) {
	const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
	process.env.OPEN_CURSOR_WORKSPACE_ROOT = cwd;
	const config = loadConfig(options.configFile);

	const repl = new RawInteractiveRepl(config, options.mode, cwd);
	await repl.start();
}
