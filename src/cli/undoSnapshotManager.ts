import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

export async function handleUndoCommand() {
	const cwd = process.env.OPEN_CURSOR_WORKSPACE_ROOT || process.cwd();
	console.log(`\n\x1b[1m\x1b[36m[oc undo] Reverting workspace to last clean snapshot...\x1b[0m\n`);

	try {
		const status = execSync("git status --porcelain", { cwd, encoding: "utf8" }).trim();
		if (!status) {
			console.log(`\x1b[32m✔ Working tree is already clean. Nothing to undo.\x1b[0m\n`);
			return;
		}

		console.log(`\x1b[33mDiscarding unstaged changes across modified files...\x1b[0m`);
		execSync("git checkout -- .", { cwd });
		execSync("git clean -fd", { cwd });
		console.log(`\x1b[32m✔ Workspace successfully reverted to last committed state!\x1b[0m\n`);
	} catch (e: any) {
		console.error(`\x1b[31mUndo failed (ensure workspace is a git repository): ${e?.message || e}\x1b[0m\n`);
	}
}
