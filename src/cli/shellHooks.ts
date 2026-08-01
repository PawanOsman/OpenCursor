/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { runStandaloneAgent } from "./standaloneHost";

export function generateShellCompletion(shell: string): string {
	const s = (shell || "bash").toLowerCase();

	if (s === "zsh") {
		return `# compdef oc open-cursor
_oc() {
  local -a commands
  commands=(
    'fix:Diagnose and fix last failed command'
    'models:Manage local GGUF and Ollama AI models'
    'add-rule:Generate .cursor/rules rule from description'
    'add-skill:Generate .cursor/skills skill from description'
    'completion:Generate shell completion script'
  )
  _describe 'command' commands
}
compdef _oc oc open-cursor
`;
	}

	if (s === "fish") {
		return `# fish completion for oc
complete -c oc -f -a "fix" -d "Diagnose and fix last failed command"
complete -c oc -f -a "models" -d "Manage local GGUF and Ollama AI models"
complete -c oc -f -a "add-rule" -d "Generate .cursor/rules rule"
complete -c oc -f -a "add-skill" -d "Generate .cursor/skills skill"
`;
	}

	// Default: bash
	return `# bash completion for oc
_oc_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local opts="fix models add-rule add-skill completion --mode --model -y --help"
  COMPREPLY=( $(compgen -W "\${opts}" -- \${cur}) )
}
complete -F _oc_completions oc open-cursor
`;
}

export async function handleFixCommand(lastCommand?: string, errorOutput?: string) {
	console.log("\n\x1b[36m\x1b[1m[oc fix] Diagnosing and generating fix...\x1b[0m\n");

	const prompt = `Inspect the codebase, identify why the following terminal command failed, and fix the underlying code:
${lastCommand ? `Failed Command: ${lastCommand}` : ""}
${errorOutput ? `Error Output:\n${errorOutput}` : ""}
`;

	await runStandaloneAgent({
		prompt,
		mode: "agent",
		autoApprove: false,
	});
}
