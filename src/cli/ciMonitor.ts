import { runStandaloneAgent } from "./standaloneHost";
export async function handleCiMonitorCommand(url?: string) {
	console.log(`\n\x1b[1m\x1b[36m[oc ci-monitor] Monitoring CI pipeline & surfacing failures...\x1b[0m\n`);
	await runStandaloneAgent({ prompt: `Fetch and analyze the CI pipeline status from ${url || "the GitHub Actions workflows in .github/workflows/"}. Surface any failing steps and propose targeted fixes.`, mode: "agent", autoApprove: false });
}
