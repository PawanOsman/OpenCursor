<!--
Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>

This file is part of OpenCursor — AI coding agent chat inside VS Code.
https://github.com/PawanOsman/OpenCursor

Licensed under the MIT License. See LICENSE file in the project root.
-->

# Change Log

All notable changes to the "ocursor" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.2.0] - 2026-09-24

### Added

- Rich Markdown editing in the composer, with headings, lists, outlined code blocks, a searchable language picker, automatic language detection, and syntax highlighting in both editable drafts and sent messages.
- Image attachment previews and content-aware RTL/LTR rendering for user and assistant messages.
- Collapsible working sections that retain the final response, elapsed time in hours/minutes/seconds, animated activity indicators, and a subtle transition for changing timer digits.
- Sticky user messages with a fading lower edge, message actions, and a combined changed-files and queued-message tray with Keep All and Undo All controls.
- Provider selection dialogs with icons, separate account/API/custom provider groups, and no-auth connections such as OpenCode Free.
- Multiple API keys and OAuth accounts per provider, grouped credential management, provider-level load balancing, and failover for eligible failures before response content begins.
- Expanded OAuth provider support and model catalogs, including GPT-6 Astra/Sol/Luna, Claude Opus 5.5, Gemini, Grok, DeepSeek, Kimi, GLM, MiniMax, and Qwen families, with provider-specific reasoning, thinking, and context options.
- Provider-prefixed models on custom gateways inherit supported reasoning, thinking, and context controls while preserving the full model ID used for routing.
- Standard and Fast processing choices for supported GPT and Claude models in the model picker, saved per model and provider independently of reasoning settings. Standard remains the default; Fast requires account support, can use extra credits or higher API rates, and depends on custom gateways forwarding the setting.
- Finite documentation discovery and indexing plans with optional AI-assisted page selection, topic priorities, scope and exclusion controls, progress logs, and request/download/time limits. Indexed pages cannot recursively expand the plan.
- Conversation fork/archive, full-history search, persistent queue editing and steering, goals, target-based code review, TODO actions, and isolated conversation worktrees.
- Interactive terminals with stdin, resize, session ownership, and awaited cleanup, plus optional Docker command execution with workspace, network, and resource boundaries.
- Language definition/reference/symbol navigation and rename previews, scoped workspace instructions, and user/workspace skill discovery.
- Persistent collaborator histories and mailboxes, follow-up/resume/list/wait/interrupt tools, and shared goal budget checks.
- Revision-linked verification evidence, durable run journals, restart-safe edit backups, and conflict-aware undo.
- Browser inspection, interaction, screenshots, and console/network evidence using installed Chrome or Edge.
- MCP HTTP/SSE connections, explicit OAuth sign-in, elicitation, resource templates, and typed text/image/binary results.
- Versioned local plugin installation, updates, enable/disable controls, and removal, with namespaced skills and MCP dependencies.
- Authenticated worker jobs pinned to repository revisions, patch export, remote-job controls, and an external-grader evaluation runner.
- Local CPU/RAM/disk/NVIDIA reporting and advisory model-fit guidance.

### Changed

- Unified chat and settings controls, fields, selectors, buttons, switches, icons, borders, and focus states across light, dark, and high-contrast themes. Improved wide-screen settings layouts and narrow chat/subagent layouts.
- Replaced new-chat persona cards with a compact dropdown and selected-persona description. The empty chat adapts to shorter panels without a page scrollbar.
- Added component entrances, panel expansion, tooltips, thinking text, and loading animations with reduced-motion support.
- Provider lists show configured API connections; model settings show enabled, connected providers. Newly added catalog defaults remain available alongside saved choices while explicit disables and valid smaller context budgets are preserved.
- Updated OAuth request formats, model discovery, and provider-specific transport handling. OAuth protocols are maintained as internal TypeScript modules.
- Built-in subagents can be edited and reset to their defaults, but cannot be deleted.
- Expanded thinking panels follow new output while the reader remains at the bottom, pause when scrolled upward, and resume when reopened or returned to the bottom.
- Task lists distinguish pending, running, completed, and paused unfinished work. Unfinished tasks stop animating when the run ends.
- Reduced repeated conversation persistence, indexing work, and webview processing to improve memory use and responsiveness during active and idle sessions.
- Improved lexical/vector retrieval freshness and optional tool-schema loading to reduce context overhead.
- Improved Ollama health/capability reporting, loaded-model memory information, load/unload controls, and cancellable pulls.
- Improved llama.cpp readiness checks, port handling, startup cancellation, shutdown, configuration validation, and resumable GGUF downloads.
- Rewrote the README and recreated interface artwork and feature diagrams, with project credits collected in the README.

### Fixed

- Unrelated settings edits no longer overwrite model options changed in another view. Local Ollama and llama.cpp models retain their provider identity when resolving options, preventing unsupported Fast controls.
- Empty queues send new messages directly without briefly displaying them as queued. Steering keeps a queued message visible with a loading state until it appears in the conversation.
- Manual Stop and deliberate interruption no longer create unwanted continuation requests in the queue.
- Composer keyboard submission now handles Enter, Ctrl/Cmd+Enter, configured send behavior, and IME composition correctly.
- Restored drafts render Markdown immediately. Empty code blocks hide the placeholder, support navigation before and after the block, and can be selected and deleted.
- Code blocks retain syntax highlighting in sent messages, using the selected language or automatic detection.
- Corrected clipped field outlines, model-picker layout shifts, excessive focus outlines, sticky-message gaps, and spacing between changed files and attention notices.
- Verification summaries no longer appear on ordinary responses without relevant work or evidence. Task-list updates handle missing names and preserve useful item text.
- Fixed extension startup/debug launch handling and reduced UI stalls during long conversations and indexing.
- Documentation fetching handles HTML and Markdown sources, deduplicates eligible URLs, and preserves the previous index when fetching or extraction fails.
- Improved Antigravity model availability handling and provider-scoped model routing; models no longer fall through to unrelated providers.
- Corrected public OpenAI Responses routing and supported request options, plus provider-specific reasoning replay for multi-turn tool conversations. Replayed reasoning is included in context budgets.
- Tool calls validate their names and arguments before execution. Repeated trailing `_ide` suffixes resolve only to complete registered built-in tool names and are removed before display. Normalized names remain consistent in streaming activity, timeout handling, and replayed history; unknown-tool errors list available names for recovery.
- Improved provider stream deadlines, Windows process teardown, hook exit-code handling, and reporting of interrupted actions and failed evaluations.

## [0.1.5] - 2026-09-12

### Fixed

- Terminal Commands set to Allow no longer prompts for approval on variables, substitutions, or shell scripts solely because unrelated deny-list rules exist; matching deny rules still block commands

## [0.1.4] - 2026-09-11

### Added

- `Rg` tool runs ripgrep directly with raw arguments on every platform, using the binary bundled with VS Code, so agents no longer shell out to `rg`/`grep`/`findstr`; read-only flags only, capped output, and clear no-match/error exit reporting
- `Wait` tool sleeps for a fixed number of milliseconds (up to two minutes) when a short delay is genuinely needed, and cancels immediately on Stop
- Introduced retrieval evidence tracking to detect repetitive search/read cycles and guide recovery behavior during investigations
- Added session resume continuity for live model history and context state, including persisted todos, so interrupted runs can continue cleanly
- Added integration coverage for interrupted/continued runs, retrieval progress behavior, and the new `Rg`/`Wait` tools

### Changed

- Clarified Task guidance: `run_in_background=false` blocks for a dependent result, `run_in_background=true` runs alongside the parent and the built-in wait delivers results when the turn ends; launch receipts and mode prompts no longer point agents at `AwaitShell` for subagents
- Improved message construction to avoid emitting empty assistant turns in Anthropic flows when only display-only thinking was present
- Updated prompt guidance to emphasize reading file content before editing changes
- Refined run-loop control so repeated unchanged retrieval signals trigger recovery, wrap-up, and pause transitions before continuing
- Persisted live turns, step history, and context state together for reload-safe conversation resumption

### Fixed

- Approval prompts already showing in the chat now resolve immediately when the Behavior policy is changed to Allow or Deny in Settings, instead of waiting for a click on the card
- Prevented premature or repeated investigation loops by detecting unchanged retrieval evidence and nudging the agent toward concrete next action
- Ensured unfinished tool calls are marked and surfaced when runs are interrupted, preserving known results while warning about unconfirmed completions
- Improved session cancellation/cleanup behavior so follow-up messages wait for stop cleanup before resuming

## [0.1.3] - 2026-09-07

### Added

- Provider presets and API key connection cards for Xiaomi MIMO, Atlas Cloud, and Astraflow, plus updated OpenAI, Codex, Claude, and Gemini model catalogs and reasoning/context options
- `ReadContext` tool to search and page through archived conversation content, tool results, edit arguments, and retained terminal output; large MCP tool catalogs load full schemas on demand
- Optional per-tab composer drafts preserve unsent text and attachments when switching chats, including a New Chat tab with an unfinished draft
- Structured question inputs for text, multiline text, numbers, and dates, with required-answer validation and persisted answers
- Live per-model cache usage details distinguish cached, non-cached, and unknown-cache input tokens, and show cache-write tokens when reported
- Automated regression tests and CI checks for provider protocols, agent workflows, runtime installation, packaged extension activation, and leaked secrets

### Changed

- Minimum supported VS Code version lowered from 1.125 to 1.96 for compatibility with IDEs using older extension APIs
- Context compaction saves a separate working checkpoint and todo state while preserving the full chat transcript; archived content remains retrievable and repeated prompt/context payloads are reduced
- Default agent step limit increased from 50 to 200; background subagents deliver results as they finish, and the parent waits for outstanding work before completing
- Provider transports updated for OpenAI Responses and Codex reasoning continuity, Gemini thought signatures, and Anthropic thinking/tool history; transient provider failures retry with backoff
- OAuth sign-in exposes authorization links with Open browser and Copy link actions, clearer errors, and manual recovery when the callback port is unavailable
- Local feature runtimes install on demand from a pinned dependency manifest with integrity verification and recovery from interrupted or concurrent installs
- Large text reads use bounded memory and paginated output; line diffs bound processing work and display clearer truncation notices

### Fixed

- Todo updates tolerate provider field variants, missing fields, and partial updates without wiping existing tasks or freezing the run; continuation handling avoids premature completion and repetitive task loops
- Approval rules remain enforced across mode changes, subagents, compound shell commands, and symlinked external paths; saved user approval preferences survive activation
- File edits and undo operations preserve unsaved editor content and newer changes, serialize concurrent writes, and retain original bytes for restoration; reverting an earlier message only targets edits owned by that chat and turn range
- Pending edit reviews clear when tracked changes become clean after a Git commit
- Queued messages retain their original conversation, model, and mode across tab switches; Stop and chat deletion wait for run cleanup, and restored live questions remain answerable
- Switching chats reliably scrolls to the latest content as long transcripts finish rendering
- Cancelled or replaced OAuth sign-ins cannot save stale accounts; token refresh and account persistence preserve settings and avoid restoring disconnected accounts
- Usage totals retain concurrent parent, subagent, summary, and title requests without double-counting streamed updates; quota refresh/reset controls recover from timeouts, ignore stale replies, and prevent duplicate credit resets
- Provider requests preserve tool and image history, report incomplete streams, and respect explicit provider selections; model discovery retains duplicate model IDs across providers and times out unresponsive catalogs
- Background shell output ordering, cancellation, timeout, and exit-status reporting are more reliable; Grep pagination/counts and web-search result parsing handle incomplete scans and changing result layouts
- Semantic indexes preserve existing data after failed embeddings or incomplete scans and refresh when ignore rules change; semantic and documentation searches reject incompatible embedding configurations. GGUF downloads and model startup handle filename collisions and concurrent loads
- MCP requests and lifecycle hooks honor cancellation and timeouts, surface failures, and apply hook permission decisions; MCP connections refresh after server configuration changes

## [0.1.2] - 2026-08-01

### Changed

- Context pruning removed: tool results and edit args stay verbatim for the full run (thinking still stripped as UI-only)
- Auto-compaction deferred until ~85–92% fill, keeps a larger verbatim tail (~55%), and cools down longer between summaries
- `fitStepsToBudget` drops whole call groups when over budget instead of stubbing dump bodies
- Agent edits never open or focus an editor: diffs open only from an explicit click in the review bar or on an edit card; already-open diffs refresh in place

## [0.1.1] - 2026-07-30

### Added

- Project mode: the agent acts as a project lead and delegates work to a team of subagents, with team selection in the composer and the active team shown in the sidebar
- `TeamDef` teams with built-in presets (Product Manager, and the rest of the default crew) sharing a common protocol for context isolation, role discipline, and code quality
- Built-in subagents and teams can be cloned into editable copies; duplicates get unique names automatically, and custom entities are kept separate from built-ins via a `builtin` flag
- Subagent and team management UI in the settings panel with a table layout for subagents and more responsive modals
- Task and Subagent cards show the subagent type name as a chip for clearer run context
- Durable `ActivityLedger` that records tool actions outside the message history, so past work stays visible without bloating context

### Changed

- Context economy reworked: history is economized around retained recent work, steps are grouped before budget fitting, and system messages carry synthetic markers
- `fitStepsToBudget` now accounts for overhead tokens (system prompt and tool schemas) so requests fit the real budget
- Semantic index throttles rebuilds and delays the startup build during activation; index data structures were reworked for lower memory use, and the search tool avoids unnecessary rebuilds
- Cache invalidation for the index is more precise, with new chunking and embedding constants

## [0.1.0] - 2026-07-27

### Added

- Live terminal output: Shell/AwaitShell stream stdout+stderr into the tool card as it is produced, with auto-scroll and a blinking caret (new `tool-call-progress` event)
- Shell result footer reports the real exit code and outcome (`exit_code=0 success in 1.2s`, failed / aborted / timed out / backgrounded); the card colors itself green or red from it
- Working directory persists across Shell calls in a run — a bare `cd <dir>` moves it, `working_directory` still applies to a single call
- Cards follow the work: thinking, plan, terminal, generic tool, subagent, and grouped explore cards expand while running and collapse when they settle (a manual toggle wins until the state changes)
- Subagent cards show a status badge, the resolved model name and step count as separate chips, a compact list of the two most recent steps, and a live activity line ("Planning next move…")
- Running spinners double as kill switches: hovering any in-flight tool, terminal, or subagent spinner turns it into a stop button that force-terminates that task
- `ListDir` output opens with a one-line legend (`trailing / = directory`) so directories are never mistaken for files
- Centralized `OpenCursor` output channel with structured `logError` reporting, replacing silently swallowed startup/index/tool failures
- Portable `/workspace` path alias accepted from the model on every host OS

### Fixed

- Commands no longer hang after finishing: each command runs in its own child shell and settles on process close, instead of waiting on a persistent REPL that never reported completion
- Killing a command kills its children too (`taskkill /T /F` on Windows, process-group SIGKILL elsewhere), so `pnpm`/`npm` scripts leave no orphans holding the pipe open
- Commands that prompt for input get EOF immediately instead of blocking forever
- Denied shell commands can no longer be smuggled through chaining: `git add -A; git commit …` is checked per command (`;`, `&&`, `||`, `|`, newlines, sub-shells), and the denial names the command that actually tripped the rule
- Todos are per-run context instead of a module global, so concurrent chats no longer clobber each other's task lists
- Outside-workspace detection covers every path-bearing tool input (ListDir, Glob, Grep, SemanticSearch, Shell `working_directory`, …) and resolves paths properly on Windows
- `dir/**` allow rules also match the directory itself, so listing an approved folder no longer re-prompts
- Antigravity and Codex OAuth transports updated (host-correct platform metadata, request ids, model list, Codex `client_version` and prompt cache key); Claude Code sends the CLI beta set
- Gemini tool results are sent with the tool's name instead of its call id

### Changed

- Denied approvals report the blocked subject back to the model so it can pick another approach
- Inline diff review consolidated onto a single diff-view path (virtual original-content provider removed) with more reliable editor refresh
- Antigravity max output tokens raised to 64k
- Subagent tabs render as plain chats — the "Back to chat" header, read-only tag, and Stop button were removed
- Subagent cards expand and collapse with the run itself; the manual chevron toggle is gone
- Quieter chat surface: hover shadows, lift/scale animations, and accent left borders removed from tool cards, message bubbles, approval and error cards, and composer buttons
- Collapsed terminal cards align their prompt, command, and badges on a single vertical center line

## [0.0.9] - 2026-07-25

### Added

- Opus 5 in the model catalog (flagship); curated Claude 5 aliases (Opus / Sonnet / Fable) stay selectable when `/v1/models` lags
- Dynamic default `max_tokens` from model capabilities and reasoning effort
- Adaptive-thinking guards: Opus 5 clamps effort when thinking is disabled; Fable 5 / Mythos reject disable

### Fixed

- Anthropic in-band stream `error` events (overloaded, invalid model, mid-stream rejection) surface instead of empty turns
- Safety-classifier `refusal` finish reason throws a clear error instead of a silent end

### Changed

- 1M context is native default on Opus 5 / Fable 5 / Sonnet 5 / 4.6+; `context-1m` beta header only on older models that still gate it
- Fable 5, Opus 5, and Sonnet 5 offer both 300k and 1M context options (1M default); Sonnet 4.6 offers 200k and 1M

## [0.0.8] - 2026-07-21

### Fixed

- Agents/subagents no longer infinite-loop from mid-task amnesia: live-turn tool results and edit args stay verbatim until the next user message

### Changed

- Context pruning only touches older turns; live turn is fully protected (12 prior results + 6 call batches kept verbatim)
- Auto-compaction soft boundary at 65% / hard at 78%; verbatim tail after summarize raised to 50%

## [0.0.7] - 2026-07-21

### Added

- Lossless persisted chat history for export; pruning, compaction, and thinking removal now affect only the disposable model context
- Context economy layer prunes stale tool dumps during active runs and slims old Write/StrReplace args (keeps four latest results + two latest call batches verbatim)
- Signal-aware stale-output summaries preserve errors, warnings, diffs, and line-addressed evidence
- Compact tool schemas keep every tool callable while removing repeated long descriptions after the initial turn
- Latest-wins dedup: older Read/ListDir/Grep/WebFetch results for the same target become one-line supersede stubs
- Per-run frozen timestamp keeps the cached query block byte-stable across steps (prompt-cache friendly)
- Shell output collapses runs of identical lines into "line ×N" (RTK-style)

### Fixed

- Background subagents no longer false-timeout while still working (removed wall-clock wait; parent awaits real settle or user Stop)
- Parent loop no longer resumes / re-dispatches while a prior Task wave is still running

### Changed

- Auto-compaction starts at safe subtask boundaries after 55% fill; 72% remains the hard safety trigger
- Thinking text no longer counted toward context budget (UI-only; never on the wire)

## [0.0.6] - 2026-07-18

### Added

- Subagents inherit the main agent's context-size limit (auto-compaction applies)
- Expandable, collapsed-by-default task prompt inside the subagent chat view

### Fixed

- Delete tool timing out but not stopping (abort-aware `unlink`/backup read)
- Read supports paths with spaces; directory paths return a clear error
- Chat scrolls to the very bottom when returning to the main agent (tab switch / Back)

### Removed

- Outer timeout budget on subagent Tasks (nested tools already have their own timeouts)

### Changed

- TodoWrite / TodoRead timeout tripled
- Tool outputs trimmed to send fewer tokens to the model (only tools; prompts unchanged)
- Shell result drops pid/running-for/echoed-command header when done; middle-truncated 12k body with collapsed blank lines
- Read caps whole-file reads at 1500 lines with a continue hint (was uncapped)
- ListDir caps at 300 entries (dirs first) with a "more" hint
- SemanticSearch returns 8 hits (was 12), each chunk snippet-capped at 1200 chars
- SearchDocs excerpts snippet-capped at 1200 chars
- Grep abort/timeout output cap 50k → 12k

## [0.0.5] - 2026-07-15

### Added

- Live timeout countdown badges on tools/tasks; kill at zero via host abort
- Shell tool card redesign: full command wrap, meta/body/footer, copy-command button
- Hard budgets for foreground/background subagents so Tasks cannot hang forever
- Stream coalescing for high-frequency agent/UI events (text/thinking/tool args)
- Read tool wall-clock timeouts (`stat` + I/O) and abort-aware path access
- Path normalizer for spaces, quotes, `file://` URIs, and mixed separators

### Fixed

- Tools stuck “Working” after timeout (immediate UI settle + cancel path)
- Read hanging on missing/unreachable/network paths (timeout could not terminate)
- Shell stuck on paths with spaces; PowerShell framing + session queue races
- Invalid path throws in Read/ListDir/Glob and related tools (user-friendly errors)
- Directory paths on Read return a clear error (suggest ListDir/Glob)
- UI freezes from high-frequency stream postMessage / React re-renders
- Read-only tools thrashing CPU/IO when many run in parallel (concurrency cap)

### Changed

- TodoWrite / TodoRead default timeout 5s → 15s
- Read default timeout tightened to match inner I/O budget
- Task tool included in configurable timeouts with countdown UI

## [0.0.4] - 2026-07-15

### Added

- Per-tool hard timeouts so hung Grep/Glob/Shell/etc. cannot block the agent loop forever
- Abort-signal support for long-running tools (walk, grep, shell) so Stop cancels mid-work
- Configurable per-tool timeout seconds in Settings → Agents
- GPU-accelerated local embeddings when available (DirectML / CUDA / CoreML / WebGPU), with CPU fallback
- Indexing page shows GPU/CPU badge plus model and runtime technical details (repo, dtype, ONNX EP, platform)
- Stricter indexable-file filters (source extensions only; skip lockfiles, minified bundles, binaries)

### Changed

- Expanded ignored directories for tools and indexing (`node_modules`, build caches, venvs, vendor, etc.)
- Semantic index walk and file watcher skip non-source trees earlier for faster indexing

## [0.0.3] - 2026-07-15

### Added

- Indexing enable/disable toggle in settings (fully turns off semantic indexing)
- Persistent semantic index across VS Code restarts (warm load from disk)
- Incremental re-index of only changed files on sync/reopen
- Real-time auto-index of new/modified files via workspace file watcher
- Context size dropdown beside the model picker for models without catalog presets
- Default context options (`32k`–`1m`) injected for uncatalogued models

### Changed

- Smart conversation summarization triggers at 80% of the usable context budget
- Subagents run with isolated history (empty parent context); parent only receives the final Task result
- Multitask/background Task waves wait for completion before the parent continues
- Stop/cancel aborts all linked subagents and force-settles open tools, thinking, and compaction UI

### Fixed

- Stuck “working” subagent spinners and unresponsive stop in multitask mode
- Orphaned shell processes when a run is aborted mid-command
- Context ring default aligned with resolved `max_context` (fallback `128k`)

## [0.0.2] - 2026-07-05

### Added

- Per-workspace conversations (existing global conversations migrate automatically)
- GGUF models auto-load on first message with a "loading model" card in chat
- llama.cpp server uses random free ports with retry on bind failure

### Changed

- Composer dropdowns (model picker, mode menu) now position themselves within the viewport and work in edit mode
- All composers share one selected model and mode
- Auto model selection hidden for now; first enabled model is the default

### Fixed

- Production error: `Cannot find package '@huggingface/hub'` (runtime deps now resolved via file URLs)

### Removed

- MCP tool marketplace

## [0.0.1] - 2026-07-05

### Added

- Initial release
- Agent chat sidebar with multi-turn conversations and streaming responses
- Tool suite: file read/write/edit, glob/grep search, shell commands, web search/fetch
- Local model providers: Ollama and llama.cpp, plus OAuth-based cloud providers
- Semantic codebase index for meaning-based search
- MCP (Model Context Protocol) client with external server support
- Approval policy engine with allow/ask/deny rules per tool (shell, edits, web, MCP)
- Inline diff review for AI-proposed edits
- Context mentions, workspace context, and custom rules/hooks
- Settings panel (React webview) for models, features, and approval configuration
- `Ctrl+L` / `Cmd+L` to add editor selection to chat
