import * as fs from "fs";
import * as path from "path";

const SECRET_PATTERNS = [
	{ name: "AWS Access Key", regex: /AKIA[0-9A-Z]{16}/g },
	{ name: "Generic API Key", regex: /api[_-]?key\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/gi },
	{ name: "Private Key Header", regex: /-----BEGIN (RSA|EC|PGP|OPENSSH) PRIVATE KEY-----/g },
	{ name: "GitHub Token", regex: /gh[pousr]_[A-Za-z0-9_]{36,}/g },
	{ name: "OpenAI / OpenRouter Key", regex: /sk-(or-v1-)?[A-Za-z0-9_-]{32,}/g },
];

export async function handleAuditSecretsCommand() {
	const cwd = process.env.OPEN_CURSOR_WORKSPACE_ROOT || process.cwd();
	console.log(`\n\x1b[1m\x1b[36m[oc audit-secrets] Scanning workspace for secret leaks & credentials...\x1b[0m\n`);

	const leaks: { file: string; line: number; type: string }[] = [];

	function scan(dir: string, depth = 0) {
		if (depth > 6) return;
		try {
			for (const item of fs.readdirSync(dir)) {
				if (["node_modules", ".git", "dist", ".ocursor", ".env"].includes(item)) continue;
				const full = path.join(dir, item);
				const stat = fs.statSync(full);
				if (stat.isDirectory()) {
					scan(full, depth + 1);
				} else if (stat.isFile()) {
					const content = fs.readFileSync(full, "utf8");
					const lines = content.split("\n");
					lines.forEach((line, idx) => {
						SECRET_PATTERNS.forEach((p) => {
							p.regex.lastIndex = 0;
							if (p.regex.test(line)) {
								leaks.push({ file: path.relative(cwd, full), line: idx + 1, type: p.name });
							}
						});
					});
				}
			}
		} catch { /* ignore */ }
	}

	scan(cwd);

	if (leaks.length === 0) {
		console.log(`\x1b[32m✔ No secret leaks or exposed credentials detected!\x1b[0m\n`);
	} else {
		console.log(`\x1b[31m⚠️ Found ${leaks.length} potential secret leak(s):\x1b[0m`);
		leaks.forEach((l) => {
			console.log(`  \x1b[33m- ${l.file}:${l.line}\x1b[0m (${l.type})`);
		});
		console.log(`\n\x1b[90mMove secrets into .env and add them to .gitignore.\x1b[0m\n`);
	}
}
