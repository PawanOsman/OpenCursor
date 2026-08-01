import * as fs from "fs";
import * as path from "path";

export async function handleDevcontainerCommand() {
	const cwd = process.env.OPEN_CURSOR_WORKSPACE_ROOT || process.cwd();
	const devDir = path.join(cwd, ".devcontainer");
	const jsonFile = path.join(devDir, "devcontainer.json");

	console.log(`\n\x1b[1m\x1b[36m[oc devcontainer] Generating production DevContainer configuration...\x1b[0m\n`);

	if (!fs.existsSync(devDir)) {
		fs.mkdirSync(devDir, { recursive: true });
	}

	const devcontainerConfig = {
		name: "OpenCursor Development Workspace",
		image: "mcr.microsoft.com/devcontainers/typescript-node:1-20-bullseye",
		customizations: {
			vscode: {
				extensions: [
					"dbaeumer.vscode-eslint",
					"esbenp.prettier-vscode",
					"eamodio.gitlens",
				],
				settings: {
					"editor.formatOnSave": true,
				},
			},
		},
		postCreateCommand: "pnpm install || npm install",
		remoteUser: "node",
	};

	fs.writeFileSync(jsonFile, JSON.stringify(devcontainerConfig, null, 2), "utf8");
	console.log(`\x1b[32m✔ DevContainer generated: ${jsonFile}\x1b[0m\n`);
}
