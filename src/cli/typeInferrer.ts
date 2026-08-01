import { runStandaloneAgent } from "./standaloneHost";
export async function handleTypeCommand(file?: string) {
	console.log(`\n\x1b[1m\x1b[36m[oc types] Inferring missing TypeScript types & eliminating any...\x1b[0m\n`);
	await runStandaloneAgent({ prompt: `Scan ${file || "the workspace"} for implicit any, missing return types, weak generics, and unknown types. Infer and apply strict TypeScript types everywhere without breaking existing behaviour.`, mode: "agent", autoApprove: false });
}
