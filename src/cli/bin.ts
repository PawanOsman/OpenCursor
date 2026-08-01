#!/usr/bin/env node
/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { IpcClient } from "./ipcClient";
import { runStandaloneAgent, runInteractiveRepl } from "./standaloneHost";
import { handleFixCommand, generateShellCompletion } from "./shellHooks";
import { handleModelsCommand } from "./modelsManager";
import { handleAddRule, handleAddSkill } from "./ruleStudio";
import { handleWatchCommand } from "./watchDaemon";
import { handleGitCommand } from "./gitSuite";
import { handleBenchCommand } from "./benchProfiler";
import { handleDocsCommand } from "./docsGenerator";
import { handleTestCommand } from "./testGenerator";
import { handleSecurityCommand } from "./securityScanner";
import { handleRefactorCommand } from "./refactorMigrator";
import { handleVoiceCommand } from "./voicePrompt";
import { handleContainerCommand } from "./containerSynthesizer";
import { handleDbCommand } from "./dbAssistant";
import { handleSwarmCommand } from "./swarmOrchestrator";
import { handlePluginCommand } from "./pluginEcosystem";
import { handleExplainCommand } from "./explainCode";
import { handleI18nCommand } from "./i18nLocalizer";
import { handleMockCommand } from "./mockServer";
import { handleMigrateCommand } from "./migrateOrm";
import { handleDependencyCommand } from "./dependencyAuditor";
import { handleLintFixCommand } from "./lintFixer";
import { handleEnvCommand } from "./envSync";
import { handleCleanCommand } from "./deadCodePruner";
import { handleChangelogCommand } from "./changelogGenerator";
import { handleApiCommand } from "./apiTester";
import { handleBundleCommand } from "./bundleOptimizer";
import { handleCicdCommand } from "./cicdGenerator";
import { handleAccessibilityCommand } from "./accessibilityAuditor";
import { handleStorybookCommand } from "./storybookGenerator";
import { handleTelemetryCommand } from "./telemetryInspector";
import { handleScaffoldCommand } from "./scaffoldGenerator";
import { handleCodeReviewCommand } from "./codeReview";
import { handleDiagramCommand } from "./diagrammer";
import { handleTypeCommand } from "./typeInferrer";
import { handleTraceCommand } from "./errorTracer";
import { handleCiMonitorCommand } from "./ciMonitor";
import { handleFeatureFlagCommand } from "./featureFlag";
import { handleContextDumpCommand } from "./contextDump";
import { handlePromptCraftCommand } from "./promptCrafter";
import { handleDeployCommand } from "./deployAssist";
import { handleLogCommand } from "./logAnalyzer";
import { handleValidateCommand } from "./schemaValidator";
import { handleLicenseCommand } from "./licenseChecker";
import { handleHooksCommand } from "./commitHooks";
import { handleMonorepoCommand } from "./monorepoManager";
import { handleTranslationSyncCommand } from "./translationSync";
import { handleGraphqlCommand } from "./graphqlHelper";
import { handleCacheCommand } from "./cacheStrategy";
import { handleRollbackCommand } from "./rollbackPlan";
import { handleKnowledgeBaseCommand } from "./knowledgeBase";
import { handleGraphIndexCommand } from "./codeGraphIndex";
import { handleDiffViewerCommand } from "./tuiDiffViewer";
import { handleUndoCommand } from "./undoSnapshotManager";
import { handleBrowserCommand } from "./browserRunner";
import { handleCodemodCommand } from "./codemodEngine";
import { handleTestWatchCommand } from "./testWatchDaemon";
import { handleDevcontainerCommand } from "./devcontainerGenerator";
import { handlePrCommand } from "./prGenerator";
import { handleAuditSecretsCommand } from "./secretAudit";
import { handleLoadTestCommand } from "./loadTestGen";
import { handleFlakyTestCommand } from "./flakyTestFixer";
import { handleShrinkDockerCommand } from "./dockerOptimizer";
import { handleMapApiCommand } from "./apiMapper";
import type { Mode } from "../agent/types";

function printHelp() {
	console.log(`
OpenCursor Terminal CLI Agent (oc)

Usage:
  oc [command|prompt...] [options]

Commands:
  (no command)         Start interactive REPL session (like Claude Code)
  explain [file]       Synthesize deep code explanation & ASCII flowcharts
  i18n [langs]         Extract UI text keys & generate translation locales
  mock [type]          Generate realistic mock JSON data & MSW handlers
  migrate [desc]       Generate ORM database schema migrations
  dependency           Audit outdated packages & supply chain security
  lint-fix             Run linter auto-fix engine & resolve warnings
  env                  Synchronize process.env keys & update .env.example
  clean                Detect unused exports, dead code & orphan assets
  changelog            Generate conventional release CHANGELOG.md
  api <url> [method]   Interactive REST / GraphQL API endpoint tester
  bundle               Analyze bundle size & tree-shaking optimizations
  benchmark-ci         Generate GitHub Actions / GitLab CI pipeline workflows
  accessibility        Audit WCAG A11y violations & apply auto-patches
  storybook            Generate Component Storybook stories (.stories.tsx)
  telemetry            Inspect local performance analytics & agent records
  watch                Run continuous background watcher & auto-fix daemon
  git <commit|pr>      Git workflow automation & AI commit helper
  bench [target]       Code performance & memory leak profiler
  docs [module]        Generate JSDoc, OpenAPI & developer portal docs
  test [target]        Generate AI unit and E2E test suites
  security             SAST vulnerability & secret leak scanner
  refactor [goal]      Structural codebase & modern API migrator
  voice                Hands-free voice prompt engine
  container            Synthesize Dockerfile, Docker-Compose & K8s manifests
  db [query]           SQL/ORM schema & query optimization assistant
  swarm [task]         Multi-agent swarm team orchestrator
  plugin [list]        Custom JS/TS plugin & extension manager
  fix                  Diagnose and fix the last failed command/error
  models               List and inspect local GGUF and Ollama AI models
  add-rule <desc>      Generate a workspace rule under .cursor/rules/
  add-skill <name>     Generate an agent skill under .cursor/skills/
  completion [shell]   Generate shell completion script (bash | zsh | fish)

  scaffold [type]      Generate full project boilerplate (React, Next.js, Express, FastAPI)
  review [target]      Deep AI code review with CRITICAL/MAJOR/MINOR severity ratings
  diagram [target]     Generate Mermaid & ASCII architecture diagrams
  types [file]         Infer missing TS types & eliminate any usage
  trace [error]        Root cause analyze a stack trace & apply fix
  ci-monitor [url]     Monitor GitHub Actions / GitLab CI pipelines in real-time
  feature-flag [name]  Generate feature flag integration code
  context [out]        Dump full workspace context to structured JSON
  craft-prompt [task]  Craft optimized LLM system prompts with few-shot examples
  deploy [target]      Generate production deployment runbooks & scripts
  logs [file]          Analyze log files for errors, anomalies & regressions
  validate [file]      Validate JSON/Zod/OpenAPI schemas & generate corrected versions
  license              Scan dependency licenses for GPL/AGPL contamination
  hooks [install]      Install & configure git pre-commit/commit-msg hooks
  monorepo [sub]       Manage monorepo workspaces & dependency graphs
  translation-sync     Sync locale files & flag missing/stale translations
  graphql [schema]     Generate TS types & resolvers from GraphQL schema
  cache                Analyze & suggest Redis/CDN/memory caching strategies
  rollback             Generate production rollback plan & shell scripts
  knowledge [query]    Build & query local knowledge base from workspace docs

Options:
  -m, --mode <mode>    Agent mode (agent | ask | plan | debug | multitask | project)
  --model <model>     LLM model ID
  -y, --auto-approve  Auto-approve all tool calls without prompting
  --cwd <directory>   Set working directory
  -h, --help          Show this help message
`);
}

async function main() {
	const rawArgs = process.argv.slice(2);
	if (rawArgs.includes("-h") || rawArgs.includes("--help")) {
		printHelp();
		return;
	}

	const cmd = rawArgs[0];

	// 47-Command Subcommand Router
	if (cmd === "scaffold") { await handleScaffoldCommand(rawArgs[1]); return; }
	if (cmd === "review") { await handleCodeReviewCommand(rawArgs[1]); return; }
	if (cmd === "diagram") { await handleDiagramCommand(rawArgs[1]); return; }
	if (cmd === "types") { await handleTypeCommand(rawArgs[1]); return; }
	if (cmd === "trace") { await handleTraceCommand(rawArgs.slice(1).join(" ")); return; }
	if (cmd === "ci-monitor") { await handleCiMonitorCommand(rawArgs[1]); return; }
	if (cmd === "feature-flag") { await handleFeatureFlagCommand(rawArgs[1]); return; }
	if (cmd === "context") { await handleContextDumpCommand(rawArgs[1]); return; }
	if (cmd === "craft-prompt") { await handlePromptCraftCommand(rawArgs.slice(1).join(" ")); return; }
	if (cmd === "deploy") { await handleDeployCommand(rawArgs[1]); return; }
	if (cmd === "logs") { await handleLogCommand(rawArgs[1]); return; }
	if (cmd === "validate") { await handleValidateCommand(rawArgs[1]); return; }
	if (cmd === "license") { await handleLicenseCommand(); return; }
	if (cmd === "hooks") { await handleHooksCommand(rawArgs[1]); return; }
	if (cmd === "monorepo") { await handleMonorepoCommand(rawArgs[1]); return; }
	if (cmd === "translation-sync") { await handleTranslationSyncCommand(rawArgs[1]); return; }
	if (cmd === "graphql") { await handleGraphqlCommand(rawArgs[1]); return; }
	if (cmd === "cache") { await handleCacheCommand(); return; }
	if (cmd === "rollback") { await handleRollbackCommand(); return; }
	if (cmd === "knowledge") { await handleKnowledgeBaseCommand(rawArgs.slice(1).join(" ")); return; }
	if (cmd === "graph") { await handleGraphIndexCommand(rawArgs[1]); return; }
	if (cmd === "diff") { await handleDiffViewerCommand(rawArgs[1]); return; }
	if (cmd === "undo") { await handleUndoCommand(); return; }
	if (cmd === "browser") { await handleBrowserCommand(rawArgs[1]); return; }
	if (cmd === "codemod") { await handleCodemodCommand(rawArgs.slice(1).join(" ")); return; }
	if (cmd === "test-watch") { await handleTestWatchCommand(rawArgs.slice(1).join(" ")); return; }
	if (cmd === "devcontainer") { await handleDevcontainerCommand(); return; }
	if (cmd === "pr") { await handlePrCommand(); return; }
	if (cmd === "audit-secrets") { await handleAuditSecretsCommand(); return; }
	if (cmd === "loadtest") { await handleLoadTestCommand(rawArgs[1]); return; }
	if (cmd === "flaky") { await handleFlakyTestCommand(rawArgs[1]); return; }
	if (cmd === "shrink-docker") { await handleShrinkDockerCommand(); return; }
	if (cmd === "map-api") { await handleMapApiCommand(); return; }
	if (cmd === "explain") {
		await handleExplainCommand(rawArgs[1]);
		return;
	}
	if (cmd === "i18n") {
		await handleI18nCommand(rawArgs[1]);
		return;
	}
	if (cmd === "mock") {
		await handleMockCommand(rawArgs[1]);
		return;
	}
	if (cmd === "migrate") {
		await handleMigrateCommand(rawArgs.slice(1).join(" "));
		return;
	}
	if (cmd === "dependency") {
		await handleDependencyCommand();
		return;
	}
	if (cmd === "lint-fix") {
		await handleLintFixCommand();
		return;
	}
	if (cmd === "env") {
		await handleEnvCommand();
		return;
	}
	if (cmd === "clean") {
		await handleCleanCommand();
		return;
	}
	if (cmd === "changelog") {
		await handleChangelogCommand();
		return;
	}
	if (cmd === "api") {
		await handleApiCommand(rawArgs[1], rawArgs[2]);
		return;
	}
	if (cmd === "bundle") {
		await handleBundleCommand();
		return;
	}
	if (cmd === "benchmark-ci") {
		await handleCicdCommand(rawArgs[1]);
		return;
	}
	if (cmd === "accessibility") {
		await handleAccessibilityCommand(rawArgs[1]);
		return;
	}
	if (cmd === "storybook") {
		await handleStorybookCommand(rawArgs[1]);
		return;
	}
	if (cmd === "telemetry") {
		await handleTelemetryCommand();
		return;
	}
	if (cmd === "watch") {
		await handleWatchCommand();
		return;
	}
	if (cmd === "git") {
		await handleGitCommand(rawArgs[1]);
		return;
	}
	if (cmd === "bench") {
		await handleBenchCommand(rawArgs[1]);
		return;
	}
	if (cmd === "docs") {
		await handleDocsCommand(rawArgs[1]);
		return;
	}
	if (cmd === "test") {
		await handleTestCommand(rawArgs[1]);
		return;
	}
	if (cmd === "security") {
		await handleSecurityCommand();
		return;
	}
	if (cmd === "refactor") {
		await handleRefactorCommand(rawArgs.slice(1).join(" "));
		return;
	}
	if (cmd === "voice") {
		await handleVoiceCommand();
		return;
	}
	if (cmd === "container") {
		await handleContainerCommand();
		return;
	}
	if (cmd === "db") {
		await handleDbCommand(rawArgs.slice(1).join(" "));
		return;
	}
	if (cmd === "swarm") {
		await handleSwarmCommand(rawArgs.slice(1).join(" "));
		return;
	}
	if (cmd === "plugin") {
		await handlePluginCommand(rawArgs[1]);
		return;
	}
	if (cmd === "fix") {
		await handleFixCommand(process.env.OC_LAST_CMD, process.env.OC_LAST_ERR);
		return;
	}
	if (cmd === "models") {
		await handleModelsCommand(rawArgs[1], rawArgs[2]);
		return;
	}
	if (cmd === "add-rule") {
		await handleAddRule(rawArgs.slice(1).join(" "));
		return;
	}
	if (cmd === "add-skill") {
		await handleAddSkill(rawArgs[1] || "", rawArgs.slice(2).join(" "));
		return;
	}
	if (cmd === "completion") {
		console.log(generateShellCompletion(rawArgs[1] || "bash"));
		return;
	}

	// Parse arguments for general prompt run
	let mode: Mode = "agent";
	let model: string | undefined;
	let autoApprove = false;
	let cwd: string | undefined;
	const promptParts: string[] = [];

	for (let i = 0; i < rawArgs.length; i++) {
		const arg = rawArgs[i];
		if (arg === "-m" || arg === "--mode") {
			mode = (rawArgs[++i] as Mode) || "agent";
		} else if (arg === "--model") {
			model = rawArgs[++i];
		} else if (arg === "-y" || arg === "--auto-approve" || arg === "--yes") {
			autoApprove = true;
		} else if (arg === "--cwd") {
			cwd = rawArgs[++i];
		} else if (!arg.startsWith("-")) {
			promptParts.push(arg);
		}
	}

	const prompt = promptParts.join(" ");

	if (!prompt) {
		await runInteractiveRepl({ mode, cwd, autoApprove });
		return;
	}

	// 1. Try connecting to VS Code Extension Host IPC Socket
	const client = new IpcClient(undefined, {
		onAgentEvent: (_id, event) => {
			if (event.type === "text-delta") {
				process.stdout.write(event.text);
			} else if (event.type === "tool-call-started") {
				console.log(`\n> Tool Call: ${event.name}`);
			} else if (event.type === "run-status" && event.status === "finished") {
				console.log("\n\nAgent finished (via VS Code host).");
				process.exit(0);
			}
		},
		onDisconnect: () => {
			console.log("\nDisconnected from VS Code host.");
		},
	});

	const connected = await client.connect();
	if (connected) {
		console.log("[oc] Connected to VS Code OpenCursor Extension Host.");
		client.submitPrompt(prompt, mode, model);
	} else {
		// 2. Fallback to Standalone Host execution
		console.log("[oc] Running in Standalone CLI Mode...");
		await runStandaloneAgent({
			prompt,
			mode,
			cwd,
			autoApprove,
		});
	}
}

main().catch((err) => {
	console.error("OpenCursor CLI Error:", err);
	process.exit(1);
});
