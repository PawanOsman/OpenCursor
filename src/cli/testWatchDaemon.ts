import { runStandaloneAgent } from "./standaloneHost";
import { execSync } from "child_process";

export async function handleTestWatchCommand(command?: string) {
	const testCmd = command || "npm test";
	console.log(`\n\x1b[1m\x1b[36m[oc test-watch] Running test suite: "${testCmd}"...\x1b[0m\n`);

	const cwd = process.env.OPEN_CURSOR_WORKSPACE_ROOT || process.cwd();

	try {
		const output = execSync(testCmd, { cwd, encoding: "utf8", stdio: "pipe" });
		console.log(output);
		console.log(`\x1b[32m✔ All tests passing cleanly!\x1b[0m\n`);
	} catch (e: any) {
		const failureLog = e.stdout || e.stderr || e.message || String(e);
		console.log(`\x1b[31m✖ Tests failed! Launching OpenCursor auto-fix agent...\x1b[0m\n`);

		await runStandaloneAgent({
			prompt: `The test command "${testCmd}" failed with output:\n\n${failureLog.slice(-3000)}\n\nDiagnose the failure, locate the failing code, and apply a fix to make tests pass.`,
			mode: "agent",
			autoApprove: false,
		});
	}
}
