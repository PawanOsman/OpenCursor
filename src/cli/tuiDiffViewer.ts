import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

export async function handleDiffViewerCommand(targetFile?: string) {
	const cwd = process.env.OPEN_CURSOR_WORKSPACE_ROOT || process.cwd();
	console.log(`\n\x1b[1m\x1b[36m[oc diff] Interactive Terminal Diff Viewer...\x1b[0m\n`);

	try {
		const gitDiff = execSync(`git diff ${targetFile ? `"${targetFile}"` : ""}`, { cwd, encoding: "utf8" });
		if (!gitDiff.trim()) {
			console.log(`\x1b[32m✔ No unstaged changes detected in workspace.\x1b[0m\n`);
			return;
		}

		const lines = gitDiff.split("\n");
		lines.forEach((line) => {
			if (line.startsWith("+") && !line.startsWith("+++")) {
				console.log(`\x1b[32m${line}\x1b[0m`);
			} else if (line.startsWith("-") && !line.startsWith("---")) {
				console.log(`\x1b[31m${line}\x1b[0m`);
			} else if (line.startsWith("@@")) {
				console.log(`\x1b[36m${line}\x1b[0m`);
			} else if (line.startsWith("diff --git")) {
				console.log(`\n\x1b[1m\x1b[33m${line}\x1b[0m`);
			} else {
				console.log(line);
			}
		});
		console.log(`\n\x1b[90mRun 'git checkout <file>' to revert or 'git add .' to stage changes.\x1b[0m\n`);
	} catch (e: any) {
		console.error(`\x1b[31mError generating diff: ${e?.message || e}\x1b[0m\n`);
	}
}
