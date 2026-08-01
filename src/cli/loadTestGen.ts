import { runStandaloneAgent } from "./standaloneHost";

export async function handleLoadTestCommand(target?: string) {
	console.log(`\n\x1b[1m\x1b[36m[oc loadtest] Generating API load testing scripts for ${target || "detected endpoints"}...\x1b[0m\n`);

	await runStandaloneAgent({
		prompt: `Analyze the API routes in the workspace and generate a high-concurrency k6 load testing script (loadtest.js) simulating 100+ virtual users, rate limits, and latency assertions for ${target || "the primary endpoints"}.`,
		mode: "agent",
		autoApprove: false,
	});
}
