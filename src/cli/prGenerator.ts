import { runStandaloneAgent } from "./standaloneHost";
import { execSync } from "child_process";

export async function handlePrCommand() {
	const cwd = process.env.OPEN_CURSOR_WORKSPACE_ROOT || process.cwd();
	console.log(`\n\x1b[1m\x1b[36m[oc pr] Generating PR description from git history & diffs...\x1b[0m\n`);

	let diffText = "";
	let logText = "";
	try {
		logText = execSync("git log -n 5 --oneline", { cwd, encoding: "utf8" });
		diffText = execSync("git diff HEAD~1", { cwd, encoding: "utf8" }).slice(0, 4000);
	} catch {
		diffText = "No git commit history found.";
	}

	await runStandaloneAgent({
		prompt: `Generate a clear, professional Pull Request description based on the following recent commits and git diff:\n\nRecent Commits:\n${logText}\n\nGit Diff:\n${diffText}\n\nInclude Markdown sections: ## Summary, ## Key Changes, ## Testing & Verification, and ## Screenshots / Notes.`,
		mode: "ask",
	});
}
