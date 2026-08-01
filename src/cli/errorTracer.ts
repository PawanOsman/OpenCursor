import { runStandaloneAgent } from "./standaloneHost";
export async function handleTraceCommand(errorText?: string) {
	console.log(`\n\x1b[1m\x1b[36m[oc trace] Analyzing stack trace & applying root cause fix...\x1b[0m\n`);
	const input = errorText || process.env.OC_LAST_ERR || "(no stack trace provided — inspect recent terminal output)";
	await runStandaloneAgent({ prompt: `Analyze this error stack trace and identify the exact root cause. Apply a precise fix to the offending file:\n\n${input}`, mode: "agent", autoApprove: false });
}
