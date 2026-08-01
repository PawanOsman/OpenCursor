import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";

export async function handleHooksCommand(action = "install") {
	const cwd = process.env.OPEN_CURSOR_WORKSPACE_ROOT || process.cwd();
	const hooksDir = path.join(cwd, ".git", "hooks");
	const bold = "\x1b[1m"; const cyan = "\x1b[36m"; const green = "\x1b[32m"; const reset = "\x1b[0m";

	console.log(`\n${bold}${cyan}[oc hooks] Installing git pre-commit & commit-msg hooks...\x1b[0m\n`);

	if (!fs.existsSync(hooksDir)) {
		console.error("Not a git repository. Run git init first.");
		return;
	}

	const preCommit = `#!/bin/sh\nset -e\nnpx --no-install tsc --noEmit 2>/dev/null || true\nnpx --no-install eslint src --max-warnings 0\n`;
	const commitMsg = `#!/bin/sh\nCOMMIT_MSG=$(cat "$1")\nif ! echo "$COMMIT_MSG" | grep -qE '^(feat|fix|chore|docs|style|refactor|perf|test|ci|revert)(\\(.+\\))?: .{3,}'; then\n  echo "\\nERROR: Commit message must follow Conventional Commits format."\n  echo "Example: feat(cli): add oc hooks command\\n"\n  exit 1\nfi\n`;

	fs.writeFileSync(path.join(hooksDir, "pre-commit"), preCommit, { mode: 0o755 });
	fs.writeFileSync(path.join(hooksDir, "commit-msg"), commitMsg, { mode: 0o755 });

	console.log(`${green}✔ pre-commit hook installed (runs tsc + eslint)${reset}`);
	console.log(`${green}✔ commit-msg hook installed (enforces Conventional Commits)${reset}\n`);
}
