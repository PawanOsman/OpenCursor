/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as readline from "readline";
import { renderBanner } from "./Banner";
import { renderStatusBar } from "./StatusBar";
import { renderToolCard } from "./ToolCard";
import { renderApprovalPrompt } from "./ApprovalPrompt";
import { runAgent } from "../../agent/loop";
import type { RunAgentOptions } from "../../agent/loopTypes";
import type { AgentEvent, Mode, Step } from "../../agent/types";
import { handleCodeReviewCommand } from "../codeReview";
import { handleDiagramCommand } from "../diagrammer";
import { handleTypeCommand } from "../typeInferrer";
import { handleTraceCommand } from "../errorTracer";
import { handleScaffoldCommand } from "../scaffoldGenerator";
import { handleDiffViewerCommand } from "../tuiDiffViewer";
import { handleUndoCommand } from "../undoSnapshotManager";
import { handleBrowserCommand } from "../browserRunner";
import { handleAuditSecretsCommand } from "../secretAudit";
import { handleLoadTestCommand } from "../loadTestGen";
import { handleFlakyTestCommand } from "../flakyTestFixer";
import { handleShrinkDockerCommand } from "../dockerOptimizer";
import { handleMapApiCommand } from "../apiMapper";
import { handleCodemodCommand } from "../codemodEngine";
import { handleTestWatchCommand } from "../testWatchDaemon";
import { handleDevcontainerCommand } from "../devcontainerGenerator";
import { handlePrCommand } from "../prGenerator";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const SLASH_COMMANDS: { cmd: string; desc: string }[] = [
	{ cmd: "/help", desc: "Show available commands & shortcuts" },
	{ cmd: "/doctor", desc: "Run system diagnostics & health check" },
	{ cmd: "/compact", desc: "Summarize & trim context history" },
	{ cmd: "/clear", desc: "Clear terminal & reset session steps" },
	{ cmd: "/mode", desc: "Switch agent mode (agent | ask | plan | project)" },
	{ cmd: "/model", desc: "Switch active LLM model ID" },
	{ cmd: "/review", desc: "Run deep AI code review with severity ratings" },
	{ cmd: "/diagram", desc: "Generate Mermaid & ASCII architecture diagrams" },
	{ cmd: "/types", desc: "Infer missing TypeScript types & eliminate any" },
	{ cmd: "/trace", desc: "Analyze stack trace & apply root cause fix" },
	{ cmd: "/scaffold", desc: "Generate full project boilerplate" },
	{ cmd: "/diff", desc: "View colorized interactive terminal diff" },
	{ cmd: "/undo", desc: "Revert workspace to last clean snapshot" },
	{ cmd: "/browser", desc: "Inspect local web dev server & diagnose UI bugs" },
	{ cmd: "/audit-secrets", desc: "Scan for hardcoded API keys & secrets" },
	{ cmd: "/loadtest", desc: "Generate k6 load testing scripts" },
	{ cmd: "/flaky", desc: "Stress-test suite 5x & fix non-deterministic tests" },
	{ cmd: "/shrink-docker", desc: "Optimize Dockerfile layers & multi-stage builds" },
	{ cmd: "/map-api", desc: "Crawl codebase & generate API route matrix" },
	{ cmd: "/codemod", desc: "Perform automated codebase refactoring" },
	{ cmd: "/test-watch", desc: "Auto-fixing test runner daemon" },
	{ cmd: "/devcontainer", desc: "Generate production DevContainer setup" },
	{ cmd: "/pr", desc: "Generate PR description from git history & diff" },
	{ cmd: "/exit", desc: "Exit OpenCursor CLI session" },
];

export class RawInteractiveRepl {
	private history: string[] = [];
	private historyIndex = -1;
	private inputBuffer = "";
	private currentMode: Mode = "agent";
	private currentModel: string;
	private cwd: string;
	private steps: Step[] = [];
	private spinnerTimer?: NodeJS.Timeout;
	private spinnerFrame = 0;
	private activeTaskName?: string;
	private isRunning = false;
	private currentAbortController?: AbortController;
	private _thinkingShown = false;
	private autoApprove = true;
	private selectedMenuIndex = 0;

	constructor(private config: any, initialMode?: Mode, initialCwd?: string) {
		this.currentModel = config.model || "gpt-4o";
		this.currentMode = initialMode || "agent";
		this.cwd = initialCwd || process.cwd();
	}

	public async start() {
		console.clear();
		console.log(renderBanner(this.currentModel, this.cwd, this.currentMode));

		readline.emitKeypressEvents(process.stdin);
		if (process.stdin.isTTY) {
			process.stdin.setRawMode(true);
		}

		this.redrawPrompt();

		process.stdin.on("keypress", async (str, key) => {
			if (!key) return;

			if (key.ctrl && key.name === "c") {
				if (this.isRunning && this.currentAbortController) {
					this.stopSpinner();
					console.log("\n\x1b[31mReceived Ctrl+C. Aborting agent run...\x1b[0m");
					this.currentAbortController.abort();
					this.isRunning = false;
					this.redrawPrompt();
					return;
				}
				console.log("\nExiting OpenCursor CLI session. Goodbye!");
				process.exit(0);
			}

			if (key.ctrl && key.name === "l") {
				console.clear();
				console.log(renderBanner(this.currentModel, this.cwd, this.currentMode));
				this.redrawPrompt();
				return;
			}

			if (this.isRunning) return;

			if (key.name === "return") {
				let line = this.inputBuffer.trim();
				if (line.startsWith("/")) {
					const matches = SLASH_COMMANDS.filter((item) => item.cmd.startsWith(line));
					if (matches.length > 0 && !SLASH_COMMANDS.some((c) => c.cmd === line)) {
						const selected = matches[this.selectedMenuIndex] || matches[0];
						line = selected.cmd;
					}
				}
				console.log("");
				this.inputBuffer = "";
				this.historyIndex = -1;
				this.selectedMenuIndex = 0;

				if (line) {
					this.history.unshift(line);
					await this.handleLine(line);
				}

				if (!this.isRunning) {
					this.redrawPrompt();
				}
				return;
			}

			if (key.name === "backspace") {
				if (this.inputBuffer.length > 0) {
					this.inputBuffer = this.inputBuffer.slice(0, -1);
					this.selectedMenuIndex = 0;
					this.redrawPrompt();
				}
				return;
			}

			if (key.name === "up") {
				if (this.inputBuffer.startsWith("/")) {
					const matches = SLASH_COMMANDS.filter((item) => item.cmd.startsWith(this.inputBuffer));
					if (matches.length > 0) {
						this.selectedMenuIndex = Math.max(0, this.selectedMenuIndex - 1);
						this.redrawPrompt();
						return;
					}
				}
				if (this.history.length > 0 && this.historyIndex < this.history.length - 1) {
					this.historyIndex++;
					this.inputBuffer = this.history[this.historyIndex];
					this.redrawPrompt();
				}
				return;
			}

			if (key.name === "down") {
				if (this.inputBuffer.startsWith("/")) {
					const matches = SLASH_COMMANDS.filter((item) => item.cmd.startsWith(this.inputBuffer));
					if (matches.length > 0) {
						this.selectedMenuIndex = Math.min(matches.length - 1, this.selectedMenuIndex + 1);
						this.redrawPrompt();
						return;
					}
				}
				if (this.historyIndex > 0) {
					this.historyIndex--;
					this.inputBuffer = this.history[this.historyIndex];
					this.redrawPrompt();
				} else if (this.historyIndex === 0) {
					this.historyIndex = -1;
					this.inputBuffer = "";
					this.redrawPrompt();
				}
				return;
			}

			if (key.name === "right" && this.inputBuffer.startsWith("/")) {
				this.handleTabCompletion();
				return;
			}

			if (key.name === "tab") {
				this.handleTabCompletion();
				return;
			}

			if (str && !key.ctrl && !key.meta) {
				this.inputBuffer += str;
				this.selectedMenuIndex = 0;
				this.redrawPrompt();
			}
		});
	}

	private redrawPrompt() {
		if (this.isRunning) return;
		const cyan = "\x1b[36m";
		const bold = "\x1b[1m";
		const reset = "\x1b[0m";
		const dim = "\x1b[90m";

		process.stdout.write(`\r\x1b[2K${bold}${cyan}> ${reset}${this.inputBuffer}`);

		if (this.inputBuffer.startsWith("/")) {
			const matches = SLASH_COMMANDS.filter((item) => item.cmd.startsWith(this.inputBuffer));
			if (matches.length > 0) {
				this.selectedMenuIndex = Math.max(0, Math.min(matches.length - 1, this.selectedMenuIndex));
				const match = matches[this.selectedMenuIndex];
				const suffix = match.cmd.slice(this.inputBuffer.length);
				process.stdout.write(`${dim}${suffix}  — ${match.desc}${reset}`);
				const cursorPos = this.inputBuffer.length + 3;
				process.stdout.write(`\x1b[${cursorPos}G`);
			}
		}
	}

	private handleTabCompletion() {
		const matches = SLASH_COMMANDS.filter((c) => c.cmd.startsWith(this.inputBuffer));
		if (matches.length > 0) {
			const target = matches[this.selectedMenuIndex] || matches[0];
			this.inputBuffer = target.cmd + " ";
			this.selectedMenuIndex = 0;
			this.redrawPrompt();
		}
	}

	private startSpinner(taskName: string) {
		this.stopSpinner();
		this.activeTaskName = taskName;
		this.spinnerFrame = 0;
		this.spinnerTimer = setInterval(() => {
			const frame = SPINNER_FRAMES[this.spinnerFrame % SPINNER_FRAMES.length];
			this.spinnerFrame++;
			process.stdout.write(`\r\x1b[2K\x1b[33m${frame} [${this.activeTaskName}] Working...\x1b[0m`);
		}, 80);
	}

	private stopSpinner() {
		if (this.spinnerTimer) {
			clearInterval(this.spinnerTimer);
			this.spinnerTimer = undefined;
			process.stdout.write("\r\x1b[2K");
		}
	}

	private async handleLine(line: string) {
		const cyan = "\x1b[36m";
		const green = "\x1b[32m";
		const bold = "\x1b[1m";
		const reset = "\x1b[0m";
		const dim = "\x1b[2m";

		if (line === "/exit" || line === "/quit" || line === "exit") {
			console.log("Exiting OpenCursor CLI session. Goodbye!");
			process.exit(0);
		}

		if (line === "/help") {
			console.log(`\n${bold}${cyan}┌─ OpenCursor Slash Commands ─────────────────────────────┐${reset}`);
			SLASH_COMMANDS.forEach((c) => {
				console.log(` ${cyan}${c.cmd.padEnd(18, " ")}${reset} ${c.desc}`);
			});
			console.log(`${bold}${cyan}└─────────────────────────────────────────────────────────┘${reset}\n`);
			return;
		}

		if (line === "/clear") {
			console.clear();
			console.log(renderBanner(this.currentModel, this.cwd, this.currentMode));
			this.steps.length = 0;
			return;
		}

		if (line === "/compact") {
			console.log(`\n${cyan}Compacting context history (${this.steps.length} steps)...${reset}`);
			if (this.steps.length > 4) {
				this.steps.splice(0, this.steps.length - 2, { kind: "user", text: "[Summarized prior turns]" });
			}
			console.log(`${green}✔ Context compacted. Steps retained: ${this.steps.length}${reset}\n`);
			return;
		}

		if (line === "/doctor") {
			console.log(`\n${bold}${cyan}┌─ OpenCursor Doctor & System Diagnostics ─────────────┐${reset}`);
			console.log(` Node Version:    ${process.version}`);
			console.log(` Workspace:       ${this.cwd}`);
			console.log(` Active Model:    ${this.currentModel}`);
			console.log(` API Endpoint:    ${this.config.apiBaseUrl || "https://api.openai.com/v1"}`);
			console.log(`${green}✔ All systems operational.${reset}\n`);
			return;
		}

		if (line.startsWith("/mode ")) {
			this.currentMode = line.slice(6).trim() as Mode;
			console.log(`${dim}Switched mode to:${reset} ${bold}${this.currentMode}${reset}\n`);
			return;
		}

		if (line.startsWith("/model ")) {
			this.currentModel = line.slice(7).trim();
			console.log(`${dim}Switched model to:${reset} ${bold}${this.currentModel}${reset}\n`);
			return;
		}

		if (line.startsWith("/review")) { await handleCodeReviewCommand(line.slice(7).trim()); return; }
		if (line.startsWith("/diagram")) { await handleDiagramCommand(line.slice(8).trim()); return; }
		if (line.startsWith("/types")) { await handleTypeCommand(line.slice(6).trim()); return; }
		if (line.startsWith("/trace")) { await handleTraceCommand(line.slice(6).trim()); return; }
		if (line.startsWith("/scaffold")) { await handleScaffoldCommand(line.slice(9).trim()); return; }
		if (line.startsWith("/diff")) { await handleDiffViewerCommand(line.slice(5).trim()); return; }
		if (line.startsWith("/undo")) { await handleUndoCommand(); return; }
		if (line.startsWith("/browser")) { await handleBrowserCommand(line.slice(8).trim()); return; }
		if (line.startsWith("/audit-secrets")) { await handleAuditSecretsCommand(); return; }
		if (line.startsWith("/loadtest")) { await handleLoadTestCommand(line.slice(9).trim()); return; }
		if (line.startsWith("/flaky")) { await handleFlakyTestCommand(line.slice(6).trim()); return; }
		if (line.startsWith("/shrink-docker")) { await handleShrinkDockerCommand(); return; }
		if (line.startsWith("/map-api")) { await handleMapApiCommand(); return; }
		if (line.startsWith("/codemod")) { await handleCodemodCommand(line.slice(8).trim()); return; }
		if (line.startsWith("/test-watch")) { await handleTestWatchCommand(line.slice(11).trim()); return; }
		if (line.startsWith("/devcontainer")) { await handleDevcontainerCommand(); return; }
		if (line.startsWith("/pr")) { await handlePrCommand(); return; }

		this.isRunning = true;
		this._thinkingShown = false;
		this.currentAbortController = new AbortController();
		this.startSpinner("Thinking");

		const runOptions: RunAgentOptions = {
			apiBaseUrl: this.config.apiBaseUrl || process.env.OPENAI_BASE_URL || (this.config.apiKey?.startsWith("sk-or-v1-") ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1"),
			apiKey: this.config.apiKey || process.env.OPENAI_API_KEY || "",
			model: this.currentModel,
			mode: this.currentMode,
			prompt: line,
			history: [...this.steps],
			enableFileReading: true,
			enableTerminalSuggestions: true,
			enableWorkspaceContext: true,
			signal: this.currentAbortController.signal,
			emit: (e: AgentEvent) => {
				if (e.type === "text-delta") {
					this.stopSpinner();
					process.stdout.write(e.text);
				} else if (e.type === "thinking-delta") {
					// Suppress raw chain-of-thought — just show a dim indicator
					if (!this._thinkingShown) {
						this.stopSpinner();
						process.stdout.write(`\x1b[2;90m⟨thinking⟩\x1b[0m `);
						this._thinkingShown = true;
					}
				} else if (e.type === "tool-call-started") {
					this.startSpinner(e.name);
				} else if (e.type === "tool-call-completed") {
					this.stopSpinner();
					console.log(renderToolCard({ name: e.name, status: e.status }));
				} else if (e.type === "retry") {
					this.stopSpinner();
					const secs = Math.ceil(e.delayMs / 1000);
					const is429 = e.error.includes("429") || e.error.includes("rate") || e.error.includes("Rate");
					if (is429) {
						console.log(`\n\x1b[33m⏳ Rate limit — waiting ${secs}s (retry ${e.attempt}/${e.max - 1})...\x1b[0m`);
					} else {
						console.log(`\n\x1b[33m↺ Retry ${e.attempt}/${e.max - 1} in ${secs}s\x1b[0m`);
					}
					this.startSpinner("Waiting");
				} else if (e.type === "subagent-event") {
					const child = e.event;
					if (child.type === "tool-call-started") {
						this.startSpinner(`Subagent: ${child.name}`);
					} else if (child.type === "tool-call-completed") {
						this.stopSpinner();
						console.log(renderToolCard({ name: `Subagent:${child.name}`, status: child.status }));
					}
				}
			},
			askUser: async (_callId, header, questions) => {
				this.stopSpinner();
				console.log(`\n--- Agent Question ---`);
				if (header) console.log(header);
				const answers: Record<string, string[]> = {};
				for (let idx = 0; idx < questions.length; idx++) {
					const q = questions[idx];
					answers[String(idx)] = [q.question];
				}
				return answers;
			},
			approve: async (toolName, toolInput) => {
				if (this.autoApprove) {
					return true;
				}
				this.stopSpinner();
				const detail = JSON.stringify(toolInput);
				process.stdout.write(renderApprovalPrompt(toolName, detail.length > 60 ? detail.slice(0, 57) + "..." : detail));
				return true;
			},
			onRetry: (attempt, max, delayMs, errMsg) => {
				this.stopSpinner();
				const secs = Math.ceil(delayMs / 1000);
				const is429 = errMsg.includes("429") || errMsg.includes("Rate limit") || errMsg.includes("rate_limit");
				if (is429) {
					console.log(`\n\x1b[33m⏳ Rate limit hit — waiting ${secs}s before retry ${attempt}/${max - 1}...\x1b[0m`);
				} else {
					console.log(`\n\x1b[33m↺ Retry ${attempt}/${max - 1} in ${secs}s: ${errMsg.slice(0, 80)}\x1b[0m`);
				}
				this.startSpinner("Waiting");
			},
		};

		try {
			await runAgent(runOptions);
			this.stopSpinner();
			console.log(renderStatusBar(this.currentMode, this.currentModel));
		} catch (err: any) {
			this.stopSpinner();
			const msg: string = err?.message || String(err);
			if (msg.includes("429") || msg.includes("Rate limit") || msg.includes("rate_limit")) {
				console.error(`\n\x1b[31m✖ Rate limited — all retries exhausted. Try again in a minute.\x1b[0m\n`);
			} else {
				console.error(`\n\x1b[31m✖ ${msg}\x1b[0m\n`);
			}
		} finally {
			this.isRunning = false;
			this.currentAbortController = undefined;
		}
	}
}
