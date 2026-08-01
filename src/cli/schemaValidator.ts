import { runStandaloneAgent } from "./standaloneHost";
export async function handleValidateCommand(file?: string) {
	console.log(`\n\x1b[1m\x1b[36m[oc validate] Validating schemas & generating corrected versions...\x1b[0m\n`);
	await runStandaloneAgent({ prompt: `Validate ${file || "all JSON schemas, Zod validators, and OpenAPI spec files in the workspace"}. Report schema violations and generate corrected, fully-typed schema definitions.`, mode: "agent", autoApprove: false });
}
