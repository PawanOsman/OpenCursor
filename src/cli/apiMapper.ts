import { runStandaloneAgent } from "./standaloneHost";

export async function handleMapApiCommand() {
	console.log(`\n\x1b[1m\x1b[36m[oc map-api] Crawling workspace to map all REST & GraphQL endpoints...\x1b[0m\n`);

	await runStandaloneAgent({
		prompt: `Crawl the codebase to locate all HTTP endpoints, routes, GraphQL resolvers, and WebSocket handlers. Generate a comprehensive API_MATRIX.md document listing: HTTP Method, Route Path, Controller/Handler File, Auth Required, and Request/Response shapes.`,
		mode: "ask",
	});
}
