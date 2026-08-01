import * as fs from "fs";
import { runStandaloneAgent } from "./standaloneHost";
export async function handleLogCommand(logFile?: string) {
	console.log(`\n\x1b[1m\x1b[36m[oc logs] Analyzing log file for errors, anomalies & regressions...\x1b[0m\n`);
	let logContent = "";
	if (logFile && fs.existsSync(logFile)) {
		logContent = fs.readFileSync(logFile, "utf8").slice(-4000);
	}
	await runStandaloneAgent({ prompt: `Analyze the following log output for error patterns, performance anomalies, and regressions. Provide a ranked summary of issues:\n${logContent || "(inspect recent application logs or stdout in the workspace)"}`, mode: "ask" });
}
