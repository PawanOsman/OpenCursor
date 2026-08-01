/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { execSync } from "child_process";
import { runStandaloneAgent } from "./standaloneHost";

export async function handleGitCommand(subcommand = "commit", cwd = process.cwd()) {
	const bold = "\x1b[1m";
	const cyan = "\x1b[36m";
	const reset = "\x1b[0m";

	if (subcommand === "commit") {
		console.log(`\n${bold}${cyan}[oc git commit] Generating semantic commit message...\x1b[0m\n`);
		try {
			const diff = execSync("git diff --cached", { cwd, encoding: "utf8" });
			if (!diff.trim()) {
				console.log("No staged git changes found. Run 'git add <files>' first.");
				return;
			}
			await runStandaloneAgent({
				prompt: `Inspect this git diff and create a conventional commit message. Run 'git commit -m "... "' tool to commit:\n${diff.slice(0, 3000)}`,
				mode: "agent",
				autoApprove: false,
			});
		} catch (e: any) {
			console.error("Git error:", e?.message || e);
		}
		return;
	}

	if (subcommand === "conflict") {
		console.log(`\n${bold}${cyan}[oc git conflict] Resolving merge conflicts...\x1b[0m\n`);
		await runStandaloneAgent({
			prompt: `Scan the workspace for git merge conflict markers (<<<<<<< HEAD) and resolve them cleanly while maintaining code integrity.`,
			mode: "agent",
			autoApprove: false,
		});
		return;
	}

	if (subcommand === "pr") {
		console.log(`\n${bold}${cyan}[oc git pr] Generating Pull Request summary...\x1b[0m\n`);
		await runStandaloneAgent({
			prompt: `Inspect git status and recent commits to generate a comprehensive Pull Request title and description in Markdown.`,
			mode: "ask",
		});
		return;
	}
}
