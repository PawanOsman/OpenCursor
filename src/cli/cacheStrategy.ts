import { runStandaloneAgent } from "./standaloneHost";
export async function handleCacheCommand() {
	console.log(`\n\x1b[1m\x1b[36m[oc cache] Analyzing endpoints & queries for optimal caching strategies...\x1b[0m\n`);
	await runStandaloneAgent({ prompt: `Analyze the API endpoints and database queries in the workspace. Suggest optimal Redis cache keys, TTLs, CDN edge caching rules, and in-memory memoization strategies. Provide implementation code for the top 5 highest-impact cache opportunities.`, mode: "ask" });
}
