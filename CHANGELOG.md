# Change Log

All notable changes to the "ocursor" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.1.1] - 2026-08-01

### Added

- Terminal CLI Agent (`oc` / `open-cursor`) with interactive REPL mode and single-prompt support
- 47 specialized CLI subcommands (`oc review`, `scaffold`, `diagram`, `types`, `trace`, `ci-monitor`, `devcontainer`, `shrink-docker`, `audit-secrets`, `codemod`, `migrate`, `db`, `swarm`, `fix`, etc.)
- Bi-directional IPC socket server bridge (`/tmp/opencursor-ipc.sock` / `\\.\pipe\opencursor-ipc`) for seamless communication between CLI and VS Code host
- Standalone execution host fallback with headless `vscodeShim` when VS Code is not running
- Private SearXNG search engine support (`searxng_url`) in WebSearch with automatic DuckDuckGo fallback
- Workspace rules (`.cursor/rules/*.md`) and agent skills (`.cursor/skills/*.md`) integration
- Automatic rate-limit retry parser for OpenRouter `X-RateLimit-Reset` response headers

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
