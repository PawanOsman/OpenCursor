import { runStandaloneAgent } from "./standaloneHost";
export async function handleScaffoldCommand(type?: string) {
	console.log(`\n\x1b[1m\x1b[36m[oc scaffold] Generating project boilerplate: ${type || "auto-detect"}...\x1b[0m\n`);
	await runStandaloneAgent({ prompt: `Scaffold a complete ${type || "modern fullstack"} project boilerplate in the current directory. Include package setup, folder structure, configs, and a working Hello World entry point.`, mode: "agent", autoApprove: false });
}
