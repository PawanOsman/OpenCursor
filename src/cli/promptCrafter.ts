import { runStandaloneAgent } from "./standaloneHost";
export async function handlePromptCraftCommand(task?: string) {
	console.log(`\n\x1b[1m\x1b[36m[oc craft-prompt] Crafting optimized LLM system prompt...\x1b[0m\n`);
	await runStandaloneAgent({ prompt: `Design a production-quality LLM system prompt for the following task: "${task || "general coding assistant"}". Include persona definition, output constraints, few-shot examples, chain-of-thought instructions, and safety guardrails.`, mode: "ask" });
}
