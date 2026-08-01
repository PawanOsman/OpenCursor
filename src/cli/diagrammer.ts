import { runStandaloneAgent } from "./standaloneHost";
export async function handleDiagramCommand(target?: string) {
	console.log(`\n\x1b[1m\x1b[36m[oc diagram] Generating Mermaid & ASCII architecture diagrams...\x1b[0m\n`);
	await runStandaloneAgent({ prompt: `Analyze ${target || "the full workspace"} module dependencies, data flows, and component relationships. Generate a Mermaid flowchart diagram and an ASCII architecture overview.`, mode: "ask" });
}
