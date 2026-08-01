import { runStandaloneAgent } from "./standaloneHost";
export async function handleRollbackCommand() {
	console.log(`\n\x1b[1m\x1b[36m[oc rollback] Generating production rollback plan & scripts...\x1b[0m\n`);
	await runStandaloneAgent({ prompt: `Inspect the deployment configuration and recent git history. Generate a complete rollback runbook including: previous stable version tag, rollback shell scripts for each service, database migration reversal steps, feature flag toggles, and a validation checklist.`, mode: "ask" });
}
