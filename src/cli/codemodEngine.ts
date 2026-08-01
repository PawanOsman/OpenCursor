import { runStandaloneAgent } from "./standaloneHost";

export async function handleCodemodCommand(transformation?: string) {
	console.log(`\n\x1b[1m\x1b[36m[oc codemod] Running automated refactoring transformation: ${transformation || "general code modernization"}...\x1b[0m\n`);

	await runStandaloneAgent({
		prompt: `Perform an automated structural refactoring across the workspace: "${transformation || "Migrate deprecated code patterns, update syntax to modern standards, and convert legacy imports to modern ES modules"}". Apply safe edits directly to files.`,
		mode: "agent",
		autoApprove: false,
	});
}
