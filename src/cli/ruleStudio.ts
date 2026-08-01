/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as fs from "fs";
import * as path from "path";

function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\w\s-]/g, "")
		.replace(/\s+/g, "-")
		.slice(0, 40);
}

export async function handleAddRule(ruleDescription: string, cwd = process.cwd()) {
	const bold = "\x1b[1m";
	const cyan = "\x1b[36m";
	const green = "\x1b[32m";
	const reset = "\x1b[0m";

	if (!ruleDescription.trim()) {
		console.error("Error: Rule description is required. Example: oc add-rule 'Always use strict TypeScript types'");
		return;
	}

	const slug = slugify(ruleDescription) || "custom-rule";
	const rulesDir = path.join(cwd, ".cursor", "rules");
	const targetPath = path.join(rulesDir, `${slug}.md`);

	const content = `---
description: ${ruleDescription}
alwaysApply: true
globs: ""
---

# ${ruleDescription}

- Follow repository conventions for ${ruleDescription}.
- Ensure code changes adhere to clean code principles and explicit type definitions.
`;

	fs.mkdirSync(rulesDir, { recursive: true });
	fs.writeFileSync(targetPath, content, "utf8");

	console.log(`\n${green}✔ Created workspace rule:${reset} ${bold}${cyan}.cursor/rules/${slug}.md${reset}\n`);
}

export async function handleAddSkill(skillName: string, description?: string, cwd = process.cwd()) {
	const bold = "\x1b[1m";
	const cyan = "\x1b[36m";
	const green = "\x1b[32m";
	const reset = "\x1b[0m";

	if (!skillName.trim()) {
		console.error("Error: Skill name is required. Example: oc add-skill 'django-rest' 'Instructions for Django REST APIs'");
		return;
	}

	const slug = slugify(skillName) || "custom-skill";
	const skillDir = path.join(cwd, ".cursor", "skills", slug);
	const targetPath = path.join(skillDir, "SKILL.md");

	const content = `---
description: ${description || skillName}
---

# ${skillName}

## Instructions
Provide specialized coding guidelines for ${skillName} below:
1. Follow existing patterns in the codebase.
2. Verify all modifications using appropriate tests.
`;

	fs.mkdirSync(skillDir, { recursive: true });
	fs.writeFileSync(targetPath, content, "utf8");

	console.log(`\n${green}✔ Created agent skill:${reset} ${bold}${cyan}.cursor/skills/${slug}/SKILL.md${reset}\n`);
}
