import { runStandaloneAgent } from "./standaloneHost";
export async function handleFeatureFlagCommand(name?: string) {
	console.log(`\n\x1b[1m\x1b[36m[oc feature-flag] Generating feature flag integration code...\x1b[0m\n`);
	await runStandaloneAgent({ prompt: `Generate feature flag integration code for ${name || "a new feature flag system"} in this project. Support LaunchDarkly, Flagsmith, or a simple env-based toggle. Add flag checks at the right call sites.`, mode: "agent", autoApprove: false });
}
