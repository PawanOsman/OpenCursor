import { runStandaloneAgent } from "./standaloneHost";
export async function handleKnowledgeBaseCommand(query?: string) {
	console.log(`\n\x1b[1m\x1b[36m[oc knowledge] ${query ? `Querying: "${query}"` : "Building local knowledge base from workspace docs..."}...\x1b[0m\n`);
	await runStandaloneAgent({ prompt: query ? `Search the workspace documentation and codebase for: "${query}". Return the most relevant information from README files, inline comments, and type definitions.` : `Index all markdown files, JSDoc comments, and README files in the workspace into a searchable knowledge summary. Generate a KNOWLEDGE.md overview document.`, mode: "ask" });
}
