import { runStandaloneAgent } from "./standaloneHost";
export async function handleCodeReviewCommand(target?: string) {
	console.log(`\n\x1b[1m\x1b[36m[oc review] Running deep AI code review with severity ratings...\x1b[0m\n`);
	await runStandaloneAgent({ prompt: `Perform a deep code review on ${target || "all modified files in the workspace"}. Rate each finding as CRITICAL / MAJOR / MINOR with inline fix suggestions and an overall score.`, mode: "ask" });
}
