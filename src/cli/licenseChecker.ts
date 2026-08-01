import { runStandaloneAgent } from "./standaloneHost";
export async function handleLicenseCommand() {
	console.log(`\n\x1b[1m\x1b[36m[oc license] Scanning dependency licenses for GPL/AGPL contamination risks...\x1b[0m\n`);
	await runStandaloneAgent({ prompt: `Scan all installed dependencies and their transitive licenses. Flag GPL, AGPL, and SSPL contamination risks. Generate a full LICENSE compliance report and suggest compatible alternatives for risky packages.`, mode: "ask" });
}
