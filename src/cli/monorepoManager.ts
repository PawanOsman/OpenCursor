import { runStandaloneAgent } from "./standaloneHost";
export async function handleMonorepoCommand(subcmd?: string) {
	console.log(`\n\x1b[1m\x1b[36m[oc monorepo] Managing monorepo workspace: ${subcmd || "status"}...\x1b[0m\n`);
	await runStandaloneAgent({ prompt: `Inspect the monorepo workspace structure (pnpm-workspace.yaml, Nx, Turborepo). ${subcmd === "sync" ? "Sync shared configs and cross-package dependencies." : subcmd === "graph" ? "Generate a dependency graph showing inter-package relationships." : "Show package inventory, versions, and suggest optimizations."}`, mode: "ask" });
}
