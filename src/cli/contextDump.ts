import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";

export async function handleContextDumpCommand(outFile?: string) {
	console.log(`\n\x1b[1m\x1b[36m[oc context] Dumping full workspace context to structured JSON...\x1b[0m\n`);

	const cwd = process.env.OPEN_CURSOR_WORKSPACE_ROOT || process.cwd();
	const output = outFile || path.join(cwd, ".ocursor-context.json");

	let gitLog = "";
	let gitBranch = "";
	try {
		gitBranch = execSync("git rev-parse --abbrev-ref HEAD", { cwd, encoding: "utf8" }).trim();
		gitLog = execSync("git log --oneline -10", { cwd, encoding: "utf8" }).trim();
	} catch { /* not a git repo */ }

	function walkDir(dir: string, depth = 0): string[] {
		if (depth > 3) return [];
		const results: string[] = [];
		try {
			for (const f of fs.readdirSync(dir)) {
				if (["node_modules", ".git", "dist", ".cache"].includes(f)) continue;
				const full = path.join(dir, f);
				const rel = path.relative(cwd, full);
				results.push(rel);
				if (fs.statSync(full).isDirectory()) results.push(...walkDir(full, depth + 1));
			}
		} catch { /* ignore */ }
		return results;
	}

	const ctx = {
		generatedAt: new Date().toISOString(),
		workspace: cwd,
		node: process.version,
		gitBranch,
		recentCommits: gitLog.split("\n"),
		fileTree: walkDir(cwd),
		configFiles: [".ocursor/config.json", "package.json", "tsconfig.json", ".env.example"].filter(f => fs.existsSync(path.join(cwd, f))),
	};

	fs.writeFileSync(output, JSON.stringify(ctx, null, 2), "utf8");
	console.log(`\x1b[32m✔ Context written to ${output}\x1b[0m\n`);
}
