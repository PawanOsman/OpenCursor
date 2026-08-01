import { runStandaloneAgent } from "./standaloneHost";
export async function handleTranslationSyncCommand(target?: string) {
	console.log(`\n\x1b[1m\x1b[36m[oc translation-sync] Syncing translation locale keys & flagging stale entries...\x1b[0m\n`);
	await runStandaloneAgent({ prompt: `Scan all locale files in ${target || "locales/ or i18n/"}, diff the keys across all language files, flag missing translations, and fill in placeholder entries for incomplete locales.`, mode: "agent", autoApprove: false });
}
