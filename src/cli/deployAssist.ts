import { runStandaloneAgent } from "./standaloneHost";
export async function handleDeployCommand(target?: string) {
	console.log(`\n\x1b[1m\x1b[36m[oc deploy] Generating deployment runbook for ${target || "auto-detected platform"}...\x1b[0m\n`);
	await runStandaloneAgent({ prompt: `Inspect the project and generate a complete production deployment runbook for ${target || "the most suitable platform (Vercel, Railway, Fly.io, AWS ECS, or GCP Cloud Run)"}. Include env variable setup, build commands, health checks, rollback procedures, and monitoring setup.`, mode: "agent", autoApprove: false });
}
