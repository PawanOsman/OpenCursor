import { runStandaloneAgent } from "./standaloneHost";

export async function handleBrowserCommand(url?: string) {
	const targetUrl = url || "http://localhost:3000";
	console.log(`\n\x1b[1m\x1b[36m[oc browser] Inspecting web app at ${targetUrl}...\x1b[0m\n`);

	try {
		const r = await fetch(targetUrl);
		console.log(`\x1b[32m✔ HTTP Status: ${r.status} ${r.statusText}\x1b[0m`);
		const html = await r.text();
		const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
		console.log(`\x1b[36mPage Title:\x1b[0m ${titleMatch ? titleMatch[1] : "(no title found)"}`);

		await runStandaloneAgent({
			prompt: `Analyze the HTML response and console logs for web app at ${targetUrl}. Surface any UI bugs, missing assets, or JavaScript errors: ${html.slice(0, 2000)}`,
			mode: "ask",
		});
	} catch (e: any) {
		console.log(`\x1b[31mCould not connect to ${targetUrl}: ${e?.message || e}\x1b[0m`);
		console.log(`\x1b[90mEnsure your local web dev server (e.g. npm run dev) is running.\x1b[0m\n`);
	}
}
