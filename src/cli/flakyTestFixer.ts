import { runStandaloneAgent } from "./standaloneHost";
import { execSync } from "child_process";

export async function handleFlakyTestCommand(testTarget?: string) {
	const cmd = testTarget ? `npx jest ${testTarget}` : "npm test";
	console.log(`\n\x1b[1m\x1b[36m[oc flaky] Stress-testing test suite 5x to isolate flaky tests: "${cmd}"...\x1b[0m\n`);

	const cwd = process.env.OPEN_CURSOR_WORKSPACE_ROOT || process.cwd();
	let failureLog = "";

	for (let i = 1; i <= 5; i++) {
		process.stdout.write(`  Run #${i}... `);
		try {
			execSync(cmd, { cwd, stdio: "ignore" });
			console.log(`\x1b[32mPASSED\x1b[0m`);
		} catch (e: any) {
			console.log(`\x1b[31mFAILED\x1b[0m`);
			failureLog += `Run ${i} failed.\n`;
		}
	}

	if (!failureLog) {
		console.log(`\n\x1b[32m✔ Test suite executed 5x cleanly with zero flaky failures!\x1b[0m\n`);
	} else {
		console.log(`\n\x1b[31m⚠️ Flaky test failures detected. Launching auto-fix agent...\x1b[0m\n`);
		await runStandaloneAgent({
			prompt: `The test command "${cmd}" failed non-deterministically during repeated runs. Diagnose race conditions, timing issues, or state leakage, and apply deterministic fixes to the test files.`,
			mode: "agent",
			autoApprove: false,
		});
	}
}
