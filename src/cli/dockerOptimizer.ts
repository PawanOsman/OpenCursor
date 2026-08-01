import { runStandaloneAgent } from "./standaloneHost";

export async function handleShrinkDockerCommand() {
	console.log(`\n\x1b[1m\x1b[36m[oc shrink-docker] Optimizing Dockerfile layers & multi-stage builds...\x1b[0m\n`);

	await runStandaloneAgent({
		prompt: `Inspect all Dockerfile and docker-compose.yml files in the workspace. Optimize multi-stage build layers, replace bloated base images with alpine/slim variants, prune dev dependencies from final stages, and generate an optimized Dockerfile.optimized.`,
		mode: "agent",
		autoApprove: false,
	});
}
