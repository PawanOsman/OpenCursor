import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

export interface SymbolIndexEntry {
	name: string;
	kind: string;
	file: string;
	line: number;
}

export async function handleGraphIndexCommand(targetDir?: string) {
	const cwd = targetDir ? path.resolve(targetDir) : (process.env.OPEN_CURSOR_WORKSPACE_ROOT || process.cwd());
	const indexDir = path.join(cwd, ".ocursor");
	const indexFile = path.join(indexDir, "symbols.json");

	console.log(`\n\x1b[1m\x1b[36m[oc graph] Indexing AST symbols across workspace: ${cwd}...\x1b[0m\n`);

	if (!fs.existsSync(indexDir)) {
		fs.mkdirSync(indexDir, { recursive: true });
	}

	const symbols: SymbolIndexEntry[] = [];
	const extensions = [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".cpp"];

	function scanFile(filePath: string) {
		try {
			const content = fs.readFileSync(filePath, "utf8");
			const lines = content.split("\n");
			const relPath = path.relative(cwd, filePath);

			lines.forEach((line, idx) => {
				// Regex heuristic for exported functions, classes, interfaces, types, consts
				const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)/);
				const classMatch = line.match(/(?:export\s+)?class\s+([a-zA-Z0-9_$]+)/);
				const interfaceMatch = line.match(/(?:export\s+)?interface\s+([a-zA-Z0-9_$]+)/);
				const typeMatch = line.match(/(?:export\s+)?type\s+([a-zA-Z0-9_$]+)/);
				const constMatch = line.match(/export\s+const\s+([a-zA-Z0-9_$]+)\s*=/);

				if (funcMatch) symbols.push({ name: funcMatch[1], kind: "function", file: relPath, line: idx + 1 });
				else if (classMatch) symbols.push({ name: classMatch[1], kind: "class", file: relPath, line: idx + 1 });
				else if (interfaceMatch) symbols.push({ name: interfaceMatch[1], kind: "interface", file: relPath, line: idx + 1 });
				else if (typeMatch) symbols.push({ name: typeMatch[1], kind: "type", file: relPath, line: idx + 1 });
				else if (constMatch) symbols.push({ name: constMatch[1], kind: "const", file: relPath, line: idx + 1 });
			});
		} catch { /* ignore */ }
	}

	function walk(dir: string, depth = 0) {
		if (depth > 6) return;
		try {
			for (const item of fs.readdirSync(dir)) {
				if (["node_modules", ".git", "dist", ".cache", ".ocursor", "build"].includes(item)) continue;
				const fullPath = path.join(dir, item);
				const stat = fs.statSync(fullPath);
				if (stat.isDirectory()) {
					walk(fullPath, depth + 1);
				} else if (stat.isFile() && extensions.includes(path.extname(item))) {
					scanFile(fullPath);
				}
			}
		} catch { /* ignore */ }
	}

	walk(cwd);

	fs.writeFileSync(indexFile, JSON.stringify({ generatedAt: new Date().toISOString(), totalSymbols: symbols.length, symbols }, null, 2), "utf8");
	console.log(`\x1b[32m✔ AST Symbol Graph indexed ${symbols.length} symbols -> ${indexFile}\x1b[0m\n`);
}
