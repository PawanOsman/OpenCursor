/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// Shared tool contracts with concise model-facing descriptions.
// Every Tool schema is derived from here (see defineTool in types.ts).
// Handlers live in the sibling files and reference these specs by name.
import { LANGUAGE_TOOL_SPECS } from "./languageSchemas";
import { BROWSER_TOOL_SPECS } from "./browserSchemas";

export interface ToolSpec {
  name: string;
  description: string;
  parameters: object;
}

export const TOOL_SPECS: Record<string, ToolSpec> = {};

function def(spec: ToolSpec) {
  TOOL_SPECS[spec.name] = spec;
}
for (const spec of LANGUAGE_TOOL_SPECS) def(spec);
for (const spec of BROWSER_TOOL_SPECS) def(spec);
def({ name: "WriteStdin", description: "Write characters to an owned interactive terminal, resize it, or terminate it. Characters can execute commands and require shell permission. Use a shell_id returned by Shell with tty=true. Output is bounded; use ReadContext for the transcript.", parameters: { type: "object", properties: { shell_id: { type: "string", minLength: 1 }, chars: { type: "string", maxLength: 65536 }, cols: { type: "integer", minimum: 20, maximum: 500 }, rows: { type: "integer", minimum: 5, maximum: 200 }, terminate: { type: "boolean" }, block_until_ms: { type: "integer", minimum: 0, maximum: 30000 } }, required: ["shell_id"] } });
def({ name: "ListAgents", description: "List this conversation's collaborators with stable IDs, status, models, and queued messages.", parameters: { type: "object", properties: {} } });
for (const name of ["SendAgentMessage", "FollowupAgent"]) def({ name, description: name === "FollowupAgent" ? "Send a follow-up to an existing collaborator. Starts an idle/interrupted agent with its saved history; steers a running agent at its next safe boundary." : "Queue a message for a collaborator. Running agents consume it at their next safe boundary; idle agents require FollowupAgent to resume.", parameters: { type: "object", properties: { id: { type: "string", minLength: 1 }, message: { type: "string", minLength: 1, maxLength: 30000 } }, required: ["id", "message"] } });
def({ name: "InterruptAgent", description: "Interrupt an owned collaborator and await its cleanup; preserve its transcript for a future follow-up.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } });
def({ name: "WaitForAgent", description: "Wait for a collaborator result, up to the bounded timeout. An interrupted wait does not cancel the collaborator.", parameters: { type: "object", properties: { id: { type: "string" }, timeout_ms: { type: "integer", minimum: 0, maximum: 60000 } }, required: ["id"] } });
def({ name: "GetGoal", description: "Read the persisted conversation goal and budget, if configured.", parameters: { type: "object", properties: {} } });
def({ name: "UpdateGoal", description: "Update an existing goal status. Complete only when the requested work is achieved; report verification limits in the answer. Pause only when the user asks.", parameters: { type: "object", properties: { status: { type: "string", enum: ["active", "paused", "blocked", "complete"] } }, required: ["status"] } });
def({ name: "GetVerificationEvidence", description: "Read checks and their observed exit codes for this run. Checks become stale after a subsequent known file edit; passing checks do not prove all requirements.", parameters: { type: "object", properties: {} } });
def({ name: "RunChecks", description: "Run a user-authorized test, build, lint or other verification command and record actual exit-code evidence. Follow no-test instructions. Use AwaitShell if still running.", parameters: { type: "object", properties: { command: { type: "string", minLength: 1 }, working_directory: { type: "string" }, block_until_ms: { type: "number", minimum: 0, maximum: 30000 }, description: { type: "string" } }, required: ["command"] } });

def({
  name: "ReadContext",
  description: "Read or search archived context by id, history for the full conversation, capabilities for current availability, tools for optional built-in schemas, mcp for its tool catalog, or a shell_ job id for retained terminal output. Read a catalog entry's schema id to enable it. Returns a bounded excerpt; use next_line/next_column to continue. Load only the details needed for the current task.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Archive or shell_ job id from a previous result, history, capabilities, tools, or mcp" },
      start_line: { type: "integer", minimum: 1, description: "First line, 1-based" },
      end_line: { type: "integer", minimum: 1, description: "Last line, inclusive" },
      start_column: { type: "integer", minimum: 1, description: "Resume a long line from next_column" },
      pattern: { type: "string", description: "Literal text to find in the archived content" },
    },
    required: ["id"],
  },
});

def({
  name: "Shell",
  description: "Execute a command in the workspace shell. Each command starts a fresh shell; a successful standalone cd carries its directory to the next call in this run. Environment changes do not persist. Use working_directory to select a directory and quote paths. Use specialized tools for reading, searching and editing files. Dependent commands can use &&. Commands run serially until their foreground wait ends. block_until_ms defaults to 30000 and is capped at 30000; 0 returns immediately. A command still running becomes a background job; use AwaitShell with its shell_id for status. The result includes explicit running/completed/failed/aborted/timed_out status and real exit code when available. Output cards contain a bounded preview; use the opaque ReadContext transcript reference to retrieve exact retained output. Each transcript retains up to 8 MiB; output beyond that cap is explicitly marked incomplete. Up to 32 jobs are retained per extension host, for at most 24 hours; capacity may evict finished jobs earlier. Finished transcripts remain available in later turns of this conversation until expiry or extension restart. Active processes live only for this agent run, have a 10-minute lifetime, and are killed on Stop or run completion. notify_on_output emits selective matches while the process is active, with debounce_ms at least 5000. Commit, push, change branches, or run destructive commands only when authorized by the user.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "The command to execute" },
      tty: { type: "boolean", description: "Use a native interactive pseudoterminal; WriteStdin can supply input and resize. Available for local execution." },
      cols: { type: "integer", minimum: 20, maximum: 500 },
      rows: { type: "integer", minimum: 5, maximum: 200 },
      working_directory: { type: "string", description: "The absolute path to the working directory to execute the command in (defaults to current directory)" },
      block_until_ms: { type: "number", description: "How long to block and wait for the command to complete before moving it to background (in milliseconds). Defaults to 30000ms (30 seconds). Set to 0 to immediately run the command in the background. The timer includes the shell startup time." },
      description: { type: "string", description: "Clear, concise description of what this command does in 5-10 words" },
      notify_on_output: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regex pattern matched against stdout/stderr output. Do not match all outputs." },
          reason: { type: "string", description: "5 or less words describing why you are watching for this output. The UI (only visible to user) will prefix it as 'Monitored `reason`'." },
          debounce_ms: { type: "number", description: "Milliseconds that must elapse between notifications. The harness enforces a minimum of 5000ms." },
        },
        required: ["pattern", "reason"],
        description: "Optional output notification config. Each terminal output which matches the pattern will notify you. ONLY set this when the user explicitly requests monitoring.",
      },
      request_smart_mode_approval: { type: "boolean", description: "Set to true when immediately retrying the exact same command after Auto-review blocks it and you decide the user should approve it through the native approval card." },
      smart_mode_block_reason: { type: "string", description: "Provide the exact block reason returned by Auto-review in the prior rejection. Required when request_smart_mode_approval is true so the approval card shows the original classifier reason without re-running the classifier." },
    },
    required: ["command"],
  },
});

def({
  name: "Glob",
  description: "Find files by name pattern; scope target_directory and glob_pattern to the task before widening the search. Results are bounded. Batch independent searches when useful.",
  parameters: {
    type: "object",
    properties: {
      target_directory: { type: "string", description: "Directory to search for files in. Defaults to the workspace root; scope to a known task directory when possible." },
      glob_pattern: { type: "string", description: "The glob pattern to match files against.\nPatterns not starting with \"**/\" are automatically prepended with \"**/\" to enable recursive searching.\n\nExamples:\n\t- \"*.js\" (becomes \"**/*.js\") - find all .js files\n\t- \"**/node_modules/**\" - find all node_modules directories\n\t- \"**/test/**/test_*.ts\" - find all test_*.ts files in any test directory" },
    },
    required: ["glob_pattern"],
  },
});

def({
  name: "Grep",
  description: "Search file contents with a regex, scoped by path/glob/type; batch independent searches. Results are sorted by file path from the first page. Content is grouped under each file: N: marks matching lines and N- marks context; overlapping context appears once. head_limit/offset paginate content rows (including context, excluding file headers), or files in files_with_matches/count mode. Follow next_offset when present; narrow the query when scan limits are reported. Long lines are clipped; use Read for exact text. Multiline enables cross-line patterns.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "The regular expression pattern to search for in file contents" },
      path: { type: "string", description: "File or directory to search. Defaults to the workspace root; prefer a known task directory." },
      glob: { type: "string", description: "Glob pattern to filter files (e.g. \"*.js\", \"*.{ts,tsx}\") - maps to rg --glob" },
      output_mode: { type: "string", enum: ["content", "files_with_matches", "count"], description: "Output mode: content shows matching/context rows, files_with_matches shows paths, count shows matching-line counts per file. Defaults to content." },
      "-B": { type: "number", description: "Number of lines to show before each match (rg -B). Requires output_mode: \"content\", ignored otherwise." },
      "-A": { type: "number", description: "Number of lines to show after each match (rg -A). Requires output_mode: \"content\", ignored otherwise." },
      "-C": { type: "number", description: "Number of lines to show before and after each match (rg -C). Requires output_mode: \"content\", ignored otherwise." },
      "-i": { type: "boolean", description: "Case insensitive search (rg -i) Defaults to false" },
      type: { type: "string", description: "File type to search (rg --type). Common types: js, py, rust, go, java, etc. More efficient than include for standard file types." },
      head_limit: { type: "number", minimum: 0, description: "Maximum content rows (match and context lines) or files for other modes; default 200, maximum 2000. File headers do not count." },
      offset: { type: "number", minimum: 0, description: "Skip N content rows, including context, or N files in other modes. Keep the same query and use the returned next_offset to continue." },
      multiline: { type: "boolean", description: "Enable multiline mode where . matches newlines and patterns can span lines (rg -U --multiline-dotall). Default: false." },
    },
    required: ["pattern"],
  },
});

def({
  name: "Rg",
  description: "Run ripgrep directly with raw arguments, cross-platform, without going through a shell. Use this instead of Shell when Grep's structured options are not enough (e.g. -l, -c, -o, --files, -w, -F, -t/-T, --iglob, -z, --stats, -e with several patterns). Do not pass a command name or shell syntax: args is the argv list after 'rg' and no globbing or quoting is applied. The workspace root is the default search location. Output is capped; narrow the query or paginate with ReadContext when truncated. Exit code 1 means no matches, 2 means an argument or IO error.",
  parameters: {
    type: "object",
    properties: {
      args: { type: "array", items: { type: "string" }, description: "Arguments passed verbatim to ripgrep, one per element, e.g. [\"-n\", \"-w\", \"TODO\", \"src\"]. Flags and paths are separate elements." },
      working_directory: { type: "string", description: "Directory to run in; relative paths in args resolve from here. Defaults to the workspace root." },
    },
    required: ["args"],
  },
});

def({
  name: "Wait",
  description: "Sleep for a fixed number of milliseconds and return. Use when a short delay is genuinely needed (e.g. letting a server start, debouncing a watcher) before the next action. Not for waiting on terminal jobs (use AwaitShell) or subagents (end your turn and the system waits for them). Cancelled immediately when the run is stopped.",
  parameters: {
    type: "object",
    properties: {
      ms: { type: "number", minimum: 0, description: "Milliseconds to wait. Capped at 120000." },
      reason: { type: "string", description: "Short note about why waiting is needed (shown in the UI)." },
    },
    required: ["ms"],
  },
});

def({
  name: "AwaitShell",
  description: "Observe or wait for a terminal job owned by this conversation, using the shell_id returned by Shell. Finished job metadata remains readable in later turns until its retention expires or the extension restarts. Omit shell_id to sleep for block_until_ms without a command. The default is 30000ms, the maximum is 120000ms, and 65000ms waits are supported. Set 0 with a shell_id for an immediate status check. Waits are cancellable; the outer configured tool timeout may end a wait earlier. A wait ending while the process remains active returns status running, not success. Work on independent tasks instead of repeatedly polling. Await when the next step needs this result. Output cards contain a bounded head/tail preview and an opaque ReadContext reference for exact retained transcript pages. Regex waits check the retained in-memory preview and subsequent output, not transcript headers or footers; use ReadContext with a literal pattern to search older output omitted from the preview. Active jobs end with the run; retained transcripts do not keep their processes alive.",
  parameters: {
    type: "object",
    properties: {
      shell_id: { type: "string", description: "Optional shell id to poll. If omitted, this tool sleeps for the full block_until_ms duration and then returns. Required when block_until_ms is 0." },
      block_until_ms: { type: "number", description: "Maximum wait in milliseconds. Defaults to 30000; capped at 120000. Set to 0 for a non-blocking job status check." },
      pattern: { type: "string", description: "Block until the regex matches the bounded output preview or the job completes. Older output omitted from the preview can be searched with ReadContext. Headers and footers are excluded. Accepts JavaScript regex patterns with the multiline m flag." },
    },
  },
});

def({
  name: "Read",
  description: "Read a local file with numbered lines; default 200 lines even when offset is supplied. Prefer scoped ranges and batch independent reads. Explicit limits allow larger ranges within a 20000-character page. The header gives total_lines, start_line, end_line and next_line; follow next_column using start_column to resume a long line. Large text files are streamed. Images (jpeg/png/gif/webp) and PDFs up to 8 MiB are supported.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "The absolute path of the file to read." },
      offset: { type: "integer", description: "First line, 1-based. Negative values count from EOF (-1 is the last line). Defaults to 1." },
      limit: { type: "integer", description: "Maximum lines to read; defaults to 200. Explicit larger values are allowed within the character page limit." },
      start_column: { type: "integer", minimum: 1, description: "1-based UTF-16 column on the first selected line; use the returned next_column to resume a long line. Defaults to 1." },
    },
    required: ["path"],
  },
});

def({
  name: "Delete",
  description: "Deletes a file at the specified path. The operation will fail gracefully if:\n    - The file doesn't exist\n    - The operation is rejected for security reasons\n    - The file cannot be deleted",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "The absolute path of the file to delete" },
    },
    required: ["path"],
  },
});

def({
  name: "StrReplace",
  description: "Performs exact string replacements in files.\n\nUsage:\n- When editing text, ensure you preserve the exact indentation (tabs/spaces) as it appears before.\n- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.\n- The edit will FAIL if old_string is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use replace_all to change every instance of old_string.\n- Use replace_all for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.\n- Optional parameter: replace_all (boolean, default false) — if true, replaces all occurrences of old_string in the file.\n\nIf you want to create a new file, use the Write tool instead.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "The absolute path to the file to modify" },
      old_string: { type: "string", description: "The text to replace" },
      new_string: { type: "string", description: "The text to replace it with (must be different from old_string)" },
      replace_all: { type: "boolean", description: "Replace all occurrences of old_string (default false)" },
    },
    required: ["path", "old_string", "new_string"],
  },
});

def({
  name: "Write",
  description: "Writes a file to the local filesystem.\n\nUsage:\n- This tool will overwrite the existing file if there is one at the provided path.\n- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.\n- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "The absolute path to the file to modify" },
      contents: { type: "string", description: "The contents to write to the file" },
    },
    required: ["path", "contents"],
  },
});

def({
  name: "EditNotebook",
  description: "Use this tool to edit a jupyter notebook cell. Use ONLY this tool to edit notebooks.\n\nThis tool supports editing existing cells and creating new cells:\n\t- If you need to edit an existing cell, set 'is_new_cell' to false and provide the 'old_string' and 'new_string'.\n\t\t-- The tool will replace ONE occurrence of 'old_string' with 'new_string' in the specified cell.\n\t- If you need to create a new cell, set 'is_new_cell' to true and provide the 'new_string' (and keep 'old_string' empty).\n\t- It's critical that you set the 'is_new_cell' flag correctly!\n\t- This tool does NOT support cell deletion, but you can delete the content of a cell by passing an empty string as the 'new_string'.\n\nOther requirements:\n\t- Cell indices are 0-based.\n\t- 'old_string' and 'new_string' should be a valid cell content, i.e. WITHOUT any JSON syntax that notebook files use under the hood.\n\t- The old_string MUST uniquely identify the specific instance you want to change. This means:\n\t\t-- Include AT LEAST 3-5 lines of context BEFORE the change point\n\t\t-- Include AT LEAST 3-5 lines of context AFTER the change point\n\t- This tool can only change ONE instance at a time. If you need to change multiple instances:\n\t\t-- Make separate calls to this tool for each instance\n\t\t-- Each call must uniquely identify its specific instance using extensive context\n\t- This tool might save markdown cells as \"raw\" cells. Don't try to change it, it's fine. We need it to properly display the diff.\n\t- If you need to create a new notebook, just set 'is_new_cell' to true and cell_idx to 0.\n\t- ALWAYS generate arguments in the following order: target_notebook, cell_idx, is_new_cell, cell_language, old_string, new_string.\n\t- Prefer editing existing cells over creating new ones!\n\t- ALWAYS provide ALL required arguments (including BOTH old_string and new_string). NEVER call this tool without providing 'new_string'.",
  parameters: {
    type: "object",
    properties: {
      target_notebook: { type: "string", description: "The path to the notebook file you want to edit. You can use either a relative path in the workspace or an absolute path. If an absolute path is provided, it will be preserved as is." },
      cell_idx: { type: "number", description: "The index of the cell to edit (0-based)" },
      is_new_cell: { type: "boolean", description: "If true, a new cell will be created at the specified cell index. If false, the cell at the specified cell index will be edited." },
      cell_language: { type: "string", description: "The language of the cell to edit. Should be STRICTLY one of these: 'python', 'markdown', 'javascript', 'typescript', 'r', 'sql', 'shell', 'raw' or 'other'." },
      old_string: { type: "string", description: "The text to replace (must be unique within the cell, and must match the cell contents exactly, including all whitespace and indentation)." },
      new_string: { type: "string", description: "The edited text to replace the old_string or the content for the new cell." },
    },
    required: ["target_notebook", "cell_idx", "is_new_cell", "cell_language", "old_string", "new_string"],
  },
});

def({
  name: "TodoWrite",
  description: "Manage a structured task list for complex work (three or more distinct steps), nontrivial planning, multiple user requests, or an explicitly requested todo list. Skip trivial single tasks and informational conversation. Do not add a separate testing task unless requested.\n\nUse specific, actionable items and capture new requirements as they arrive. merge=false replaces the entire list; merge=true merges by id, preserving omitted fields. Mark the first current task in_progress, keep only one in_progress at a time, and complete it before starting another. States: pending (not started), in_progress (working), completed (finished successfully), cancelled (no longer needed). Mark completion immediately and add follow-ups when needed.\n\nBatch updates with related tool calls and start the actual work in the same batch as the initial list. Apart from initially creating the list, update silently without announcing todo maintenance.",
  parameters: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Unique identifier for the TODO item" },
            content: { type: "string", description: "The description/content of the todo item" },
            status: { type: "string", enum: ["pending", "in_progress", "completed", "cancelled"], description: "The current status of the TODO item" },
          },
          required: ["id"],
        },
        description: "Array of TODO items to update or create. Can be a single item.",
      },
      merge: { type: "boolean", description: "Whether to merge the todos with the existing todos. If true, the todos will be merged into the existing todos based on the id field. You can leave unchanged properties undefined. If false, the new todos will replace the existing todos." },
    },
    required: ["todos"],
  },
});

def({
  name: "ReadLints",
  description: "Read and display linter errors from the current workspace. You can provide paths to specific files or directories, or omit the argument to get diagnostics for all files.\n\n- If a file path is provided, returns diagnostics for that file only\n- If a directory path is provided, returns diagnostics for all files within that directory\n- If no path is provided, returns diagnostics for all files in the workspace\n- This tool can return linter errors that were already present before your edits, so avoid calling it with a very wide scope of files\n- NEVER call this tool on a file unless you've edited it or are about to edit it",
  parameters: {
    type: "object",
    properties: {
      paths: { type: "array", items: { type: "string" }, description: "Optional. An array of paths to files or directories to read linter errors for. You can use either relative paths in the workspace or absolute paths. If provided, returns diagnostics for the specified files/directories only. If not provided, returns diagnostics for all files in the workspace." },
    },
  },
});

def({
  name: "SemanticSearch",
  description: "Find relevant code by fusing current lexical matches with version-checked semantic embeddings. Supports multiple file/directory scopes and unsaved editor buffers. Rankings are retrieval scores, not confidence. Results and scans are bounded; use Grep for exhaustive exact matches, language tools for symbols, and Read for more lines.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "A complete question about what you want to understand. Ask as if talking to a colleague: 'How does X work?', 'What happens when Y?', 'Where is Z handled?'" },
      target_directories: { type: "array", items: { type: "string" }, description: "File or directory paths to limit search scope; no glob patterns" },
      num_results: { type: "integer", minimum: 1, maximum: 15, description: "The number of results to return. Defaults to 15. Do not specify a value larger than 15." },
    },
    required: ["query", "target_directories"],
  },
});

def({
  name: "SearchDocs",
  description: "Semantic search over user-indexed external documentation sources (added in Settings > Indexing & Docs).\n\nUse this tool when the user mentions an indexed doc (e.g. an <attached type=\"doc\" /> tag in their message) or asks about a library/service whose docs are indexed. Prefer this over WebSearch/WebFetch for indexed sources — it is faster and returns only relevant excerpts.\n\n- `doc` is the doc source name or id (from the mention tag's title/content, or omit to search all indexed docs).\n- Returns the top matching excerpts with their page URLs; call again with a refined query for more.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "A complete question or topic to search for in the documentation." },
      doc: { type: "string", description: "Doc source name or id to search. Omit to search all indexed docs." },
      num_results: { type: "integer", minimum: 1, maximum: 12, description: "Max excerpts to return (default 6)." },
    },
    required: ["query"],
  },
});

def({
  name: "WebSearch",
  description: "Search the web for real-time information about any topic. Returns summarized information from search results and relevant URLs.\n\nUse this tool when you need up-to-date information that might not be available or correct in your training data, or when you need to verify current facts.\nThis includes queries about:\n- Libraries, frameworks, and tools whose APIs, best practices, or usage instructions are frequently updated. (\"How do I run Postgres in a container?\")\n- Current events or technology news. (\"Which AI model is best for coding?\")\n- Informational queries similar to what you might Google (\"kubernetes operator for mysql\")\n\nIMPORTANT - Use the correct year in search queries:\n- Today's date is 2026-06-27. You MUST use this year when searching for recent information, documentation, or current events.\n- Example: If today is 2026-06-27 and the user asks for \"latest React docs\", search for \"React documentation 2026\", NOT \"React documentation 2025\"",
  parameters: {
    type: "object",
    properties: {
      search_term: { type: "string", description: "The search term to look up on the web. Be specific and include relevant keywords for better results. For technical queries, include version numbers or dates if relevant." },
      explanation: { type: "string", description: "One sentence explanation as to why this tool is being used, and how it contributes to the goal." },
    },
    required: ["search_term"],
  },
});

def({
  name: "WebFetch",
  description: "Fetch content from a specified URL and return its contents in a readable markdown format. Use this tool when you need to retrieve and analyze webpage content.\n\n- The URL must be a fully-formed, valid URL.\n- This tool is read-only and will not work for requests intended to have side effects.\n- This fetch tries to return live results but may return previously cached content.\n- Authentication is not supported, and an error will be returned if the URL requires authentication.\n- If the URL is returning a non-200 status code, e.g. 404, the tool will not return the content and will instead return an error message.\n- This fetch runs from an isolated server. Hosts like localhost or private IPs will not work.\n- This tool does not support fetching binary content, e.g. media or PDFs.\n- For static assets and non-webpage URLs, use the `Shell` tool instead.\n",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to fetch. The content will be converted to a readable markdown format." },
      requestSmartModeApproval: { type: "boolean", description: "Set to true when immediately retrying the exact same fetch after Auto-review blocks it and you decide the user should approve it through the native approval card." },
      smartModeBlockReason: { type: "string", description: "Provide the exact block reason returned by Auto-review in the prior rejection. Required when requestSmartModeApproval is true so the approval card shows the original classifier reason without re-running the classifier." },
    },
    required: ["url"],
  },
});

def({
  name: "AskQuestion",
  description: "Collect answers from the user through the chat UI. Use this tool only when you are blocked on a decision that is genuinely the user's to make: one you cannot resolve from the request, the code, or sensible defaults.\n\nEach question can ask for a choice (multiple-choice options, with an optional free-text \"Other\") or for structured input (text, textArea, number, date).\n\nUsage notes:\n- For choice questions define at least 2 options; the user can always type \"Other\".\n- Use allow_multiple: true to allow multiple answers to be selected for a question\n- Use type: \"text\" / \"textArea\" / \"number\" / \"date\" (without options) when you need typed input, and set required: true when an answer is mandatory\n- If you recommend a specific option, make that the first option in the list and add \"(Recommended)\" at the end of the label\n- Prefer this tool over listing options in your final response text (as letters, numbers, bullet points, etc)",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Optional title for the questions form" },
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Unique identifier for this question" },
            prompt: { type: "string", description: "The question text to display to the user, without the options." },
            type: {
              type: "string",
              enum: ["choices", "text", "textArea", "number", "date"],
              description: "Input kind for this question. \"choices\" (default) renders the listed options; the others render a plain input field. Required questions can be marked with required: true.",
            },
            required: { type: "boolean", description: "If true, the user must answer before submitting (default false)." },
            placeholder: { type: "string", description: "Placeholder text for text/textArea/number/date questions." },
            options: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string", description: "Unique identifier for this option" },
                  label: { type: "string", description: "Display text for this option" },
                },
                required: ["id", "label"],
              },
              minItems: 2,
              description: "Answer options for a \"choices\" question (minimum 2 required)",
            },
            allow_multiple: { type: "boolean", description: "If true, user can select multiple options. Defaults to false." },
          },
          required: ["id", "prompt"],
        },
        minItems: 1,
        description: "Array of questions to present to the user (minimum 1 required)",
      },
    },
    required: ["questions"],
  },
});

def({
  name: "Task",
  description: "Delegate an independent task. Children inherit permissions and enabled tools; explore/review types are read-only. resume continues a saved collaborator; fork copies parent history into a new child. Use ListAgents/SendAgentMessage/FollowupAgent/WaitForAgent/InterruptAgent to coordinate stable IDs. Up to four active collaborators share the workspace; assign separate files. Background results arrive automatically; all live child work stops with the parent run, with history retained for explicit resume.",
  parameters: {
    type: "object",
    properties: {
      description: { type: "string", description: "A short, concrete title for the subagent shown in the UI." },
      prompt: { type: "string", description: "The task for the agent to perform" },
      resume: { type: "string", description: "Existing collaborator ID to continue with its saved history" },
      fork: { type: "boolean", description: "Copy parent history into a new collaborator" },
      model: { type: "string", description: "Optional model slug for this agent. Omit it unless the user explicitly named a model — by default the subagent inherits the parent agent's model. Never guess or invent a slug: an unknown slug is ignored and the parent model is used instead." },
      readonly: { type: "boolean", description: "If true, the subagent will run in readonly mode (\"Ask mode\") without filesystem mutations or MCP execution. Web access follows the parent settings." },
      subagent_type: {
        type: "string",
        description: "Subagent type to use for this task. Either one of the built-in types (generalPurpose, explore, shell, cursor-guide, ci-investigator, bugbot, security-review, best-of-n-runner, docs-researcher, code-reviewer) or the name of a configured subagent — including a member of an assigned team listed in <assigned_teams> or <subagents>.",
      },
      file_attachments: { type: "array", items: { type: "string" }, description: "File paths to include in the child prompt. The child must read them with its permitted tools; file bytes are not attached automatically." },
      run_in_background: { type: "boolean", description: "false (default): block until the child finishes and return its report inline — use when the next step depends on the result. true: return immediately while the child works; its report is delivered automatically, and ending your turn waits for it. Use true for independent subtasks that can run alongside your own work." },
    },
    required: ["description", "prompt"],
  },
});

def({
  name: "FetchMcpResource",
  description: "Reads a specific resource from an MCP server, identified by server name and resource URI. Optionally, set downloadPath (relative to the workspace) to save the resource to disk; when set, the resource will be downloaded and not returned to the model.",
  parameters: {
    type: "object",
    properties: {
      server: { type: "string", description: "The MCP server identifier" },
      uri: { type: "string", description: "The resource URI to read" },
      downloadPath: { type: "string", description: "Optional relative path in the workspace to save the resource to. When set, the resource is written to disk and is not returned to the model." },
      requestSmartModeApproval: { type: "boolean", description: "Set to true when immediately retrying the exact same resource fetch after Auto-review blocks it and you decide the user should approve it through the native approval card." },
      smartModeBlockReason: { type: "string", description: "Provide the exact block reason returned by Auto-review in the prior rejection. Required when requestSmartModeApproval is true so the approval card shows the original classifier reason without re-running the classifier." },
    },
    required: ["server", "uri"],
  },
});

def({
  name: "SwitchMode",
  description: "Change the working mode within the permissions selected by the user when this run began. A mode that grants additional tools is refused. Ask the user to select the broader mode in the chat controls and send a new message when implementation requires additional permissions. Explain why a change is useful.",
  parameters: {
    type: "object",
    properties: {
      target_mode_id: { type: "string", description: "The mode to switch to. Allowed values: 'plan', 'agent', 'debug', 'multitask', 'project'." },
      explanation: { type: "string", description: "Optional explanation for why the mode switch is requested. This helps the user understand why you're switching modes." },
    },
    required: ["target_mode_id"],
  },
});

def({
  name: "ListMcpResources",
  description: "Lists the resources exposed by connected MCP servers. Resources are addressable pieces of context (files, database rows, API responses, etc.) that a server makes available, identified by a server name and a resource URI. Use this to discover what is available before reading a specific resource with FetchMcpResource.\n\nUsage:\n- Returns one entry per resource: the owning server, the resource URI, an optional human-readable name, and the MIME type when provided.\n- Pass `server` to limit the listing to a single MCP server; omit it to list resources across every connected server.\n- If no servers are connected or none expose resources, the result will say so.\n- Pair with FetchMcpResource: list to discover URIs, then fetch the specific URI you need.",
  parameters: {
    type: "object",
    properties: {
      server: { type: "string", description: "Optional MCP server identifier to filter the listing to a single server. Omit to list resources from all connected servers." },
    },
  },
});

def({
  name: "CallMcpTool",
  description: "Call an MCP tool by server identifier and tool name with arbitrary JSON arguments. IMPORTANT: Always read the tool's schema/descriptor BEFORE calling to ensure correct parameters.\n\nExample:\n{\n  \"server\": \"my-mcp-server\",\n  \"toolName\": \"search\",\n  \"arguments\": { \"query\": \"example\", \"limit\": 10 },\n  \"description\": \"Search the docs for the example API\"\n}",
  parameters: {
    type: "object",
    properties: {
      server: { type: "string", description: "Identifier of the MCP server hosting the tool." },
      toolName: { type: "string", description: "Name of the MCP tool to invoke." },
      arguments: { type: "object", description: "Arguments to pass to the MCP tool, as described in the tool descriptor." },
      description: { type: "string", description: "Clear, concise description of what this call does in 5-10 words" },
      requestSmartModeApproval: { type: "boolean", description: "Set to true when immediately retrying the exact same MCP call after Auto-review blocks it and you decide the user should approve it through the native approval card." },
      smartModeBlockReason: { type: "string", description: "Provide the exact block reason returned by Auto-review in the prior rejection. Required when requestSmartModeApproval is true so the approval card shows the original classifier reason without re-running the classifier." },
    },
    required: ["server", "toolName"],
  },
});

// ---------------------------------------------------------------------------
// Additional workspace tools.
// ---------------------------------------------------------------------------

def({
  name: "ListDir",
  description: "Lists the files and subdirectories contained directly within a single directory. The fastest way to understand the shape of an unfamiliar part of the codebase before diving in.\n\nUsage:\n- Returns one entry per line; directories are suffixed with a trailing slash (e.g. `src/`) and files are not. Never pass a slash-suffixed entry to Read — list or glob it instead.\n- Lists only the immediate children of the given directory; it is NOT recursive. Use Glob for recursive name matching or Grep to search file contents.\n- Common noise directories (`.git`, `node_modules`, `dist`, `out`) are omitted from the listing.\n- Prefer this over a `Shell` `ls` call: it is faster and respects the workspace's ignore rules.\n- You have the capability to call multiple tools in a single response. Batch independent listings together.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative path of the directory to list. Defaults to the workspace root when omitted." },
    },
  },
});

def({
  name: "FileSearch",
  description: "Fuzzy search for files by name when you know part of a filename but not its exact path. Matches a query fragment against every file path in the workspace using a subsequence/substring fuzzy score and returns the best matches, most relevant first.\n\nUsage:\n- Use this when you remember roughly what a file is called (e.g. `sidebar`, `authmiddleware`) but not where it lives.\n- For exact directory/name patterns prefer Glob; for searching file CONTENTS prefer Grep or SemanticSearch.\n- Returns up to 30 matching workspace-relative paths. If you get too many results, provide a longer, more specific fragment.\n- The query is matched case-insensitively against the full relative path, so you can include directory hints (e.g. `agent/tools`).",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Filename fragment to match against file paths (case-insensitive). May include path separators to narrow results (e.g. \"agent/loop\")." },
    },
    required: ["query"],
  },
});

def({
  name: "TodoRead",
  description: "Read the current structured task list for this session exactly as it was last written with TodoWrite.\n\nUsage:\n- Use to re-orient yourself on a long task: it returns every todo with its current status (pending, in_progress, completed, cancelled).\n- This is a read-only companion to TodoWrite; it never modifies the list.\n- Returns `(no todos)` when no task list has been created yet.\n- You normally do NOT need to call this right after TodoWrite, since you already know the list you just wrote.",
  parameters: {
    type: "object",
    properties: {},
  },
});

def({
  name: "WritePlan",
  description: "Write the implementation plan for the current task to a Markdown file under `.plans/`. This is the deliverable of PLAN MODE and the ONLY file you are allowed to create while in plan mode.\n\nUsage:\n- Call this exactly once, after you have finished investigating the codebase, with the complete plan as Markdown.\n- The plan should contain: a one-line goal, then an ordered list of steps where each step names the file(s) to touch and the precise change to make, plus any risks or verification steps.\n- The file is named from a slugified version of `title` (e.g. \"Add auth\" -> `.plans/add-auth.md`). Writing the same title again overwrites the previous plan.\n- After it succeeds, give the user a brief summary and tell them to switch to agent mode to execute the plan.\n- Never reply with the plan as plain text instead of calling this tool, and never end a plan-mode turn without having called it.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short plan title, used to generate the filename under `.plans/`." },
      content: { type: "string", description: "The full implementation plan as Markdown." },
    },
    required: ["title", "content"],
  },
});
