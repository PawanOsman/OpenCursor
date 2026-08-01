import { runStandaloneAgent } from "./standaloneHost";
export async function handleGraphqlCommand(schema?: string) {
	console.log(`\n\x1b[1m\x1b[36m[oc graphql] Generating TypeScript types & resolvers from GraphQL schema...\x1b[0m\n`);
	await runStandaloneAgent({ prompt: `Inspect ${schema || "the GraphQL schema files (.graphql, schema.ts) in the workspace"} and generate fully-typed TypeScript interfaces, resolver stubs, and query/mutation helper hooks.`, mode: "agent", autoApprove: false });
}
