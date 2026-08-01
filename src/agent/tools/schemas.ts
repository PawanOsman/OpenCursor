/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// Exact Cursor tool names, descriptions, and input_schemas (verbatim).
// Single source of truth so OpenCursor's request matches Cursor byte-for-byte
// AND so every Tool's schema is derived from here (see defineTool in types.ts).
// Handlers live in the sibling files and reference these specs by name.

export interface ToolSpec {
  name: string;
  description: string;
  parameters: object;
}

export const TOOL_SPECS: Record<string, ToolSpec> = {};

function def(spec: ToolSpec) {
  TOOL_SPECS[spec.name] = spec;
}

def({
  name: "Shell",
  description: "Executes a given command in a shell session with optional foreground timeout.\n\nIMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead.\n\nBefore executing the command, please follow these steps:\n\n1. Check for Running Processes:\n   - Before starting dev servers or long-running processes that should not be duplicated, list the terminals folder to check if they are already running in existing terminals.\n   - You can use this information to determine which terminal, if any, matches the command you want to run, contains the output from the command you want to inspect, or has changed since you last read them.\n   - Since these are text files, you can read any terminal's contents simply by reading the file, search using Grep, etc.\n2. Directory Verification:\n   - If the command will create new directories or files, first run ls to verify the parent directory exists and is the correct location\n   - For example, before running \"mkdir foo/bar\", first run 'ls' to check that \"foo\" exists and is the intended parent directory\n3. Command Execution:\n   - Always quote file paths that contain spaces with double quotes (e.g., cd \"path with spaces/file.txt\")\n   - Examples of proper quoting:\n     - cd \"/Users/name/My Documents\" (correct)\n     - cd /Users/name/My Documents (incorrect - will fail)\n     - python \"/path/with spaces/script.py\" (correct)\n     - python /path/with spaces/script.py (incorrect - will fail)\n   - After ensuring proper quoting, execute the command.\n   - Capture the output of the command.\n\nUsage notes:\n\n- The command argument is required.\n- The shell starts in the workspace root and is stateful across sequential calls. Current working directory and environment variables persist between calls. Use the `working_directory` parameter to run commands in different directories. Example: to run `npm install` in the `frontend` folder, set `working_directory: \"frontend\"` rather than using `cd frontend && npm install`.\n- It is very helpful if you write a clear, concise description of what this command does in 5-10 words.\n- VERY IMPORTANT: You MUST avoid using search commands like `find` and `grep`.Instead use Grep, Glob to search.You MUST avoid read tools like `cat`, `head`, and `tail`, and use Read to read files.Avoid editing files with tools like `sed` and `awk`, use StrReplace instead.\n- Don't pipe a command's output through `head`, `tail`, or `sed -n` (or similar) just to limit its length — large output is automatically written to a terminal file that you can read in full, so truncating only risks discarding information you need (especially for long-running commands).\n- If you _still_ need to run `grep`, STOP. ALWAYS USE ripgrep at `rg` first, which all users have pre-installed.\n- When issuing multiple commands:\n  - If the commands are independent and can run in parallel, make multiple Shell tool calls in a single message. For example, if you need to run \"git status\" and \"git diff\", send a single message with two Shell tool calls in parallel.\n  - If the commands depend on each other and must run sequentially, use a single Shell call with '&&' to chain them together (e.g., `git add . && git commit -m \"message\" && git push`). For instance, if one operation must complete before another starts (like mkdir before cp,Write before Shell for git operations, or git add before git commit), run these operations sequentially instead.\n  - Use ';' only when you need to run commands sequentially but don't care if earlier commands fail\n  - DO NOT use newlines to separate commands (newlines are ok in quoted strings)\n\nDependencies:\n\nWhen adding new dependencies, prefer using the package manager (e.g. npm, pip) to add the latest version. Do not make up dependency versions.\n\n<managing-long-running-commands>\n- Commands that don't complete within `block_until_ms` (default 30000ms / 30 seconds) are moved to background rather than treated as failures. Set `block_until_ms: 0` to immediately background (use for dev servers, watchers, or any long-running process).\n- You do not need to use '&' at the end of commands.\n- Make sure to set `block_until_ms` to higher than the command's expected runtime. Add some buffer since block_until_ms includes shell startup time; increase buffer next time based on `elapsed_ms` if you chose too low. E.g. if you sleep for 40s, recommended `block_until_ms` is 45s.\n- You'll be notified when the backgrounded command completes.\n- You can monitor commands by configuring `notify_on_output`. You will be notified at the end of your turn whenever the output matches the regex `pattern` (do not match all outputs). You will only receive notifications after ending your turn. Configure a 5 or less words `reason` which explains what you are watching for. The UI will prefix it as \"Monitored `reason`\". Configure `debounce_ms` to control how many milliseconds must elapse between notifications; the harness treats values less than 5000ms as 5000ms. Configure shell commands to emit stable sentinel lines and simple anchored regexes; pipe noisy output through jq/awk/scripts if needed. The system will terminate the watcher if the notifications are overly noisy, and you will be informed in this case.\n- Completion notifications are delivered separately from output-match notifications and do not require `notify_on_output` to be set.\n- Only poll with `AwaitShell` later if you have been asked to work on something that requires the result of a previous shell command. Using the `AwaitShell` is very disruptive because it prevents you from being able to multitask.\n</managing-long-running-commands>\n\n<scheduling-notifications>\n- You can schedule notifications for yourself by starting a background shell that sleeps and echos a reminder message. This can be very useful for reminding yourself to check on another shell or task and verify it is making progress. Always think about how long you expect something to take before scheduling a notification.\n</scheduling-notifications>\n\n<committing-changes-with-git>\nOnly create commits when requested by the user. If unclear, ask first. When the user asks you to create a new git commit, follow these steps carefully:\n\nGit Safety Protocol:\n\n- NEVER update the git config\n- NEVER run destructive/irreversible git commands (like push --force, hard reset, etc) unless the user explicitly requests them\n- NEVER skip hooks (--no-verify, --no-gpg-sign, etc) unless the user explicitly requests it\n- NEVER run force push to main/master, warn the user if they request it\n- Avoid git commit --amend. ONLY use --amend when ALL conditions are met:\n  1. User explicitly requested amend, OR commit SUCCEEDED but pre-commit hook auto-modified files that need including\n  2. HEAD commit was created by you in this conversation (verify: git log -1 --format='%an %ae')\n  3. Commit has NOT been pushed to remote (verify: git status shows \"Your branch is ahead\")\n- CRITICAL: If commit FAILED or was REJECTED by hook, NEVER amend - fix the issue and create a NEW commit\n- CRITICAL: If you already pushed to remote, NEVER amend unless the user explicitly requests it (requires force push)\n- NEVER commit changes unless the user explicitly asks you to. It is VERY IMPORTANT to only commit when explicitly asked, otherwise the user will feel that you are being too proactive.\n\n1. You can call multiple tools in a single response. When multiple independent pieces of information are requested, batch your tool calls together for optimal performance. ALWAYS run the following shell commands in parallel, each using the Shell tool:\n   - Run a git status command to see all untracked files.\n   - Run a git diff command to see both staged and unstaged changes that will be committed.\n   - Run a git log command to see recent commit messages, so that you can follow this repository's commit message style.\n2. Analyze all staged changes (both previously staged and newly added) and draft a commit message:\n   - Summarize the nature of the changes (eg. new feature, enhancement to an existing feature, bug fix, refactoring, test, docs, etc.). Ensure the message accurately reflects the changes and their purpose (i.e. \"add\" means a wholly new feature, \"update\" means an enhancement to an existing feature, \"fix\" means a bug fix, etc.).\n   - Do not commit files that likely contain secrets (.env, credentials.json, etc). Warn the user if they specifically request to commit those files\n   - Draft a concise (1-2 sentences) commit message that focuses on the \"why\" rather than the \"what\"\n   - Ensure it accurately reflects the changes and their purpose\n3. Run the following commands sequentially:\n   - Add relevant untracked files to the staging area.\n   - Commit the changes with the message.\n   - Run git status after the commit completes to verify success.\n4. If the commit fails due to pre-commit hook, fix the issue and create a NEW commit (see amend rules above)\n\nImportant notes:\n\n- NEVER update the git config\n- NEVER run additional commands to read or explore code, besides git shell commands\n- DO NOT push to the remote repository unless the user explicitly asks you to do so\n- IMPORTANT: Never use git commands with the -i flag (like git rebase -i or git add -i) since they require interactive input which is not supported.\n- If there are no changes to commit (i.e., no untracked files and no modifications), do not create an empty commit\n- In order to ensure good formatting, ALWAYS pass the commit message via a HEREDOC, a la this example:\n\n<example>git commit -m \"$(cat <<'EOF'\nCommit message here.\n\nEOF\n)\"</example>\n</committing-changes-with-git>\n\n<creating-pull-requests>\nUse the gh command via the Shell tool for ALL GitHub-related tasks including working with issues, pull requests, checks, and releases. If given a Github URL use the gh command to get the information needed.\n\nIMPORTANT: When the user asks you to create a pull request, follow these steps carefully:\n\n1. You have the capability to call multiple tools in a single response. When multiple independent pieces of information are requested, batch your tool calls together for optimal performance. ALWAYS run the following shell commands in parallel using the Shell tool, in order to understand the current state of the branch since it diverged from the main branch:\n   - Run a git status command to see all untracked files\n   - Run a git diff command to see both staged and unstaged changes that will be committed\n   - Check if the current branch tracks a remote branch and is up to date with the remote, so you know if you need to push to the remote\n   - Run a git log command and `git diff [base-branch]...HEAD` to understand the full commit history for the current branch (from the time it diverged from the base branch)\n2. Analyze all changes that will be included in the pull request, making sure to look at all relevant commits (NOT just the latest commit, but ALL commits that will be included in the pull request!!!), and draft a pull request summary\n3. Run the following commands sequentially:\n   - Create new branch if needed\n   - Push to remote with -u flag if needed\n   - Create PR using gh pr create with the format below. Use a HEREDOC to pass the body to ensure correct formatting.\n\n<example># First, push the branch (with required_permissions: [\"all\"])\ngit push -u origin HEAD\n\n# Then create the PR (with required_permissions: [\"all\"])\ngh pr create --title \"the pr title\" --body \"$(cat <<'EOF'\n## Summary\n<1-3 bullet points>\n\n## Test plan\n[Checklist of TODOs for testing the pull request...]\n\nEOF\n)\"</example>\n\nImportant:\n\n- NEVER update the git config\n- DO NOT use the TodoWrite or Task tools\n- Return the PR URL when you're done, so the user can see it\n</creating-pull-requests>\n\n<other-common-operations>\n- View comments on a Github PR: gh api repos/foo/bar/pulls/123/comments\n</other-common-operations>",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "The command to execute" },
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
  description: "\nTool to search for files matching a glob pattern\n\n- Works fast with codebases of any size\n- Returns matching file paths sorted by modification time\n- Use this tool when you need to find files by name patterns\n- You have the capability to call multiple tools in a single response. It is always better to speculatively perform multiple searches that are potentially useful as a batch.\n",
  parameters: {
    type: "object",
    properties: {
      target_directory: { type: "string", description: "Absolute path to directory to search for files in. If not provided, defaults to OpenCursor workspace root." },
      glob_pattern: { type: "string", description: "The glob pattern to match files against.\nPatterns not starting with \"**/\" are automatically prepended with \"**/\" to enable recursive searching.\n\nExamples:\n\t- \"*.js\" (becomes \"**/*.js\") - find all .js files\n\t- \"**/node_modules/**\" - find all node_modules directories\n\t- \"**/test/**/test_*.ts\" - find all test_*.ts files in any test directory" },
    },
    required: ["glob_pattern"],
  },
});

def({
  name: "Grep",
  description: "A powerful search tool built on ripgrep\nUsage:\n- Prefer using Grep for search tasks when you know the exact symbols or strings to search for. Whenever possible, use this tool instead of invoking grep or rg as a terminal command. The Grep tool has been optimized for speed and file restrictions inside OpenCursor.\n- Supports full regex syntax (e.g., \"log.*Error\", \"function\\s+\\w+\")\n- Filter files with glob parameter (e.g., \".js\", \"**/.tsx\") or type parameter (e.g., \"js\", \"py\", \"rust\")\n- Output modes: \"content\" shows matching lines (default), \"files_with_matches\" shows only file paths, \"count\" shows match counts\n- Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use interface\\{\\} to find interface{} in Go code)\n- Multiline matching: By default patterns match within single lines only. For cross-line patterns like struct \\{[\\s\\S]*?field, use multiline: true\n- Results are capped to several thousand output lines for responsiveness; when truncation occurs, the results report \"at least\" counts, but are otherwise accurate.\n- Content output formatting closely follows ripgrep output format: '-' for context lines, ':' for match lines, and all context/match lines below each file group.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "The regular expression pattern to search for in file contents" },
      path: { type: "string", description: "File or directory to search in (rg pattern -- PATH). Defaults to OpenCursor workspace root." },
      glob: { type: "string", description: "Glob pattern to filter files (e.g. \"*.js\", \"*.{ts,tsx}\") - maps to rg --glob" },
      output_mode: { type: "string", enum: ["content", "files_with_matches", "count"], description: "Output mode: \"content\" shows matching lines (supports -A/-B/-C context, -n line numbers, head_limit), \"files_with_matches\" shows file paths (supports head_limit), \"count\" shows match counts (supports head_limit). Defaults to \"content\"." },
      "-B": { type: "number", description: "Number of lines to show before each match (rg -B). Requires output_mode: \"content\", ignored otherwise." },
      "-A": { type: "number", description: "Number of lines to show after each match (rg -A). Requires output_mode: \"content\", ignored otherwise." },
      "-C": { type: "number", description: "Number of lines to show before and after each match (rg -C). Requires output_mode: \"content\", ignored otherwise." },
      "-i": { type: "boolean", description: "Case insensitive search (rg -i) Defaults to false" },
      type: { type: "string", description: "File type to search (rg --type). Common types: js, py, rust, go, java, etc. More efficient than include for standard file types." },
      head_limit: { type: "number", minimum: 0, description: "Limit output size. For \"content\" mode: limits total matches shown. For \"files_with_matches\" and \"count\" modes: limits number of files." },
      offset: { type: "number", minimum: 0, description: "Skip first N entries. For \"content\" mode: skips first N matches. For \"files_with_matches\" and \"count\" modes: skips first N files. Use with head_limit for pagination." },
      multiline: { type: "boolean", description: "Enable multiline mode where . matches newlines and patterns can span lines (rg -U --multiline-dotall). Default: false." },
    },
    required: ["pattern"],
  },
});

def({
  name: "AwaitShell",
  description: "Check or poll a backgrounded shell job. For work that does not have a shell id, you can omit the shell_id arg to sleep for the full `block_until_ms` duration (prefer this over sleeping in the shell, because it renders nicely to the user). At the end of your turn, you will be notified about any unawaited jobs that completed. If you think a job completed (e.g. because you killed it), observe it with Await to skip the notification, because stale notifications can confuse the user.\n\nPrefer NOT to poll reflexively with Await. Multitask on independent work while backgrounded jobs run, or finish your turn and rely on the end-of-turn completion notification. Poll with Await only when one of the following is true:\n- Your very next step is blocked on this specific job's result and you have no other productive work to do, OR\n- The task requires close monitoring (see shell guidance below).\n- Never poll a task whose tool result says it was \"manually backgrounded by the user\".\n- Shell: only poll with Await when the command requires close monitoring. Close monitoring means a long-running job that can silently hang, degrade, or need a course correction before it completes — e.g. training runs, eval runs, deployments, long builds, datagen pipelines, DB migrations, large data transfers. For fire-and-forget commands (tests, installs, dev servers/watchers, short scripts, etc.) the completion notification is enough — start them, keep working, and only poll with Await later if you end up blocked on the result.\n- Shell sanity check (regardless of close monitoring): when you spawn a command directly into the background (`block_until_ms: 0`), do a single status check by reading the output file to confirm the command didn't fail to start. This is a one-shot smoke check, not a polling loop.\n- Shell close-monitoring guidance (only applies in the close-monitoring case above):\n  - HARD STOPPING CONSTRAINT: once you've decided to actively poll, don't stop until (a) the job terminates, (b) the command reaches a healthy steady state (only for non-terminating commands, e.g. dev server/watcher), or (c) the command is hung — follow the hang guidance below.\n  - Waiting until a regex matches the output can be useful for e.g. known startup/status/error logs.\n  - Size `block_until_ms` to the command's expected runtime. When waiting further, avoid round 5-minute waits: prefer slices of 60–270s (keeps prompt cache warm) or 1200s+ (one cache miss buys a long wait).\n  - Output file header has `pid` and `running_for_ms` (updated every 5000ms).\n  - When finished, footer with `exit_code` and `elapsed_ms` appears (regex only matches the body, not header/footer).\n  - If the command is taking longer than expected and appears hung (use judgment based on command type), kill the process if safe to do so using the pid in the header. If possible, fix the hang and proceed.",
  parameters: {
    type: "object",
    properties: {
      shell_id: { type: "string", description: "Optional shell id to poll. If omitted, this tool sleeps for the full block_until_ms duration and then returns. Required when block_until_ms is 0." },
      block_until_ms: { type: "number", description: "Max sleep time to block before returning (in milliseconds). Defaults to 30000ms. Set to 0 for non-blocking status check." },
      pattern: { type: "string", description: "Block until the regex matches stdout/stderr stream (or task completes). Matches anywhere in the shell output, not just new output. Will not match terminal file headers or footers, e.g. exit_code. Accepts JavaScript regex patterns (compiled with the multiline `m` flag)." },
    },
  },
});

def({
  name: "Read",
  description: "Reads a file from the local filesystem. You can access any file directly by using this tool.\nIf the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.\n\nUsage:\n- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters\n- Lines in the output are numbered starting at 1, using following format: LINE_NUMBER|LINE_CONTENT\n- You have the capability to call multiple tools in a single response. It is always better to speculatively read multiple files as a batch that are potentially useful.\n- If you read a file that exists but has empty contents you will receive 'File is empty.'\n\nImage Support:\n- This tool can also read image files when called with the appropriate path.\n- Supported image formats: jpeg/jpg, png, gif, webp.\n\nPDF Support:\n- PDF files are converted into text content automatically (subject to the same character limits as other files).",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "The absolute path of the file to read." },
      offset: { type: "integer", description: "The line number to start reading from. Positive values are 1-indexed from the start of the file. Negative values count backwards from the end (e.g. -1 is the last line). Only provide if the file is too large to read at once." },
      limit: { type: "integer", description: "The number of lines to read. Only provide if the file is too large to read at once." },
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
  description: "Use this tool to create and manage a structured task list for your current coding session. This helps track progress, organize complex tasks, and demonstrate thoroughness.\n\nNote: Other than when first creating todos, don't tell the user you're updating todos, just do it.\n\n### When to Use This Tool\n\nUse proactively for:\n1. Complex multi-step tasks (3+ distinct steps)\n2. Non-trivial tasks requiring careful planning\n3. User explicitly requests todo list\n4. User provides multiple tasks (numbered/comma-separated)\n5. After receiving new instructions - capture requirements as todos (use merge=false to add new ones)\n6. After completing tasks - mark complete with merge=true and add follow-ups\n7. When starting new tasks - mark as in_progress (ideally only one at a time)\n\n### When NOT to Use\n\nSkip for:\n1. Single, straightforward tasks\n2. Trivial tasks with no organizational benefit\n3. Tasks completable in < 3 trivial steps\n4. Purely conversational/informational requests\n5. Don't add a task to test the change unless asked, or you'll overfocus on testing\n\n### Examples\n\n<example>\n  User: Add dark mode toggle to settings\n  Assistant:\n    - *Creates todo list:*\n      1. Add state management [in_progress]\n      2. Implement styles\n      3. Create toggle component\n      4. Update components\n    - [Immediately begins working on todo 1 in the same tool call batch]\n<reasoning>\n  Multi-step feature with dependencies.\n</reasoning>\n</example>\n\n<example>\n  User: Rename getCwd to getCurrentWorkingDirectory across my project\n  Assistant: *Searches codebase, finds 15 instances across 8 files*\n  *Creates todo list with specific items for each file that needs updating*\n\n<reasoning>\n  Complex refactoring requiring systematic tracking across multiple files.\n</reasoning>\n</example>\n\n<example>\n  User: Implement user registration, product catalog, shopping cart, checkout flow.\n  Assistant: *Creates todo list breaking down each feature into specific tasks*\n\n<reasoning>\n  Multiple complex features provided as list requiring organized task management.\n</reasoning>\n</example>\n\n<example>\n  User: Optimize my React app - it's rendering slowly.\n  Assistant: *Analyzes codebase, identifies issues*\n  *Creates todo list: 1) Memoization, 2) Virtualization, 3) Image optimization, 4) Fix state loops, 5) Code splitting*\n\n<reasoning>\n  Performance optimization requires multiple steps across different components.\n</reasoning>\n</example>\n\n### Examples of When NOT to Use the Todo List\n\n<example>\n  User: What does git status do?\n  Assistant: Shows current state of working directory and staging area...\n\n<reasoning>\n  Informational request with no coding task to complete.\n</reasoning>\n</example>\n\n<example>\n  User: Add comment to calculateTotal function.\n  Assistant: *Uses edit tool to add comment*\n\n<reasoning>\n  Single straightforward task in one location.\n</reasoning>\n</example>\n\n<example>\n  User: Run npm install for me.\n  Assistant: *Executes npm install* Command completed successfully...\n\n<reasoning>\n  Single command execution with immediate results.\n</reasoning>\n</example>\n\n### Task States and Management\n\n1. **Task States:**\n  - pending: Not yet started\n  - in_progress: Currently working on\n  - completed: Finished successfully\n  - cancelled: No longer needed\n\n2. **Task Management:**\n  - Update status in real-time\n  - Mark complete IMMEDIATELY after finishing\n  - Only ONE task in_progress at a time\n  - Complete current tasks before starting new ones\n\n3. **Task Breakdown:**\n  - Create specific, actionable items\n  - Break complex tasks into manageable steps\n  - Use clear, descriptive names\n\n4. **Parallel Todo Writes:**\n  - Prefer creating the first todo as in_progress\n  - Start working on todos by using tool calls in the same tool call batch as the todo write\n  - Batch todo updates with other tool calls for better latency and lower costs for the user\n\nWhen in doubt, use this tool. Proactive task management demonstrates attentiveness and ensures complete requirements.",
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
          required: ["id", "content", "status"],
        },
        minItems: 2,
        description: "Array of TODO items to update or create",
      },
      merge: { type: "boolean", description: "Whether to merge the todos with the existing todos. If true, the todos will be merged into the existing todos based on the id field. You can leave unchanged properties undefined. If false, the new todos will replace the existing todos." },
    },
    required: ["todos", "merge"],
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
  description: "`SemanticSearch`: semantic search that finds code by meaning, not exact text\n\n### When to Use This Tool\n\nUse `SemanticSearch` when you need to:\n- Explore unfamiliar codebases\n- Ask \"how / where / what\" questions to understand behavior\n- Find code by meaning rather than exact text\n\n### When NOT to Use\n\nSkip `SemanticSearch` for:\n1. Exact text matches (use `Grep`)\n2. Reading known files (use `Read`)\n3. Simple symbol lookups (use `Grep`)\n4. Find file by name (use `Glob`)\n\n### Examples\n\n<example>\n  Query: \"Where is interface MyInterface implemented in the frontend?\"\n<reasoning>\n  Good: Complete question asking about implementation location with specific context (frontend).\n</reasoning>\n</example>\n\n<example>\n  Query: \"Where do we encrypt user passwords before saving?\"\n<reasoning>\n  Good: Clear question about a specific process with context about when it happens.\n</reasoning>\n</example>\n\n<example>\n  Query: \"MyInterface frontend\"\n<reasoning>\n  BAD: Too vague; use a specific question instead. This would be better as \"Where is MyInterface used in the frontend?\"\n</reasoning>\n</example>\n\n<example>\n  Query: \"AuthService\"\n<reasoning>\n  BAD: Single word searches should use `Grep` for exact text matching instead.\n</reasoning>\n</example>\n\n<example>\n  Query: \"What is AuthService? How does AuthService work?\"\n<reasoning>\n  BAD: Combines two separate queries. A single semantic search is not good at looking for multiple things in parallel. Split into separate parallel searches: like \"What is AuthService?\" and \"How does AuthService work?\"\n</reasoning>\n</example>\n\n### Target Directories\n\n- Provide ONE directory or file path; [] searches the whole repo. No globs or wildcards.\n  Good:\n  - [\"backend/api/\"]   - focus directory\n  - [\"src/components/Button.tsx\"] - single file\n  - [] - search everywhere when unsure\n  BAD:\n  - [\"frontend/\", \"backend/\"] - multiple paths\n  - [\"src/**/utils/**\"] - globs\n  - [\"*.ts\"] or [\"**/*\"] - wildcard paths\n\n### Search Strategy\n\n1. Start with exploratory queries - semantic search is powerful and often finds relevant context in one go. Begin broad with [] if you're not sure where relevant code is.\n2. Review results; if a directory or file stands out, rerun with that as the target.\n3. Break large questions into smaller ones (e.g. auth roles vs session storage).\n4. For big files (>1K lines) run `SemanticSearch`, or `Grep` if you know the exact symbols you're looking for, scoped to that file instead of reading the entire file.\n\n<example>\n  Step 1: { \"query\": \"How does user authentication work?\", \"target_directories\": [], \"explanation\": \"Find auth flow\" }\n  Step 2: Suppose results point to backend/auth/ → rerun:\n          { \"query\": \"Where are user roles checked?\", \"target_directories\": [\"backend/auth/\"], \"explanation\": \"Find role logic\" }\n<reasoning>\n  Good strategy: Start broad to understand overall system, then narrow down to specific areas based on initial results.\n</reasoning>\n</example>\n\n<example>\n  Query: \"How are websocket connections handled?\"\n  Target: [\"backend/services/realtime.ts\"]\n<reasoning>\n  Good: We know the answer is in this specific file, but the file is too large to read entirely, so we use semantic search to find the relevant parts.\n</reasoning>\n</example>\n\n### Usage\n- When full chunk contents are provided, avoid re-reading the exact same chunk contents using the Read tool.\n- Sometimes, just the chunk signatures and not the full chunks will be shown. Chunk signatures are usually Class or Function signatures that chunks are contained in. Use the Read or Grep tools to explore these chunks or files if you think they might be relevant.\n- When reading chunks that weren't provided as full chunks (e.g. only as line ranges or signatures), you'll sometimes want to expand the chunk ranges to include the start of the file to see imports, expand the range to include lines from the signature, or expand the range to read multiple chunks from a file at once.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "A complete question about what you want to understand. Ask as if talking to a colleague: 'How does X work?', 'What happens when Y?', 'Where is Z handled?'" },
      target_directories: { type: "array", items: { type: "string" }, description: "Prefix directory paths to limit search scope (single directory only, no glob patterns)" },
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
  description: "Collect structured multiple-choice answers from the user. Use this tool only when you are blocked on a decision that is genuinely the user's to make: one you cannot resolve from the request, the code, or sensible defaults.\n\nUsage notes:\n- Each question should have at least 2 options for the user to choose from\n- Users will always be able to select \"Other\" to provide custom text input\n- Use allow_multiple: true to allow multiple answers to be selected for a question\n- If you recommend a specific option, make that the first option in the list and add \"(Recommended)\" at the end of the label\n\nPrefer this tool over listing options in your final response text (as letters, numbers, bullet points, etc).",
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
              description: "Array of answer options (minimum 2 required)",
            },
            allow_multiple: { type: "boolean", description: "If true, user can select multiple options. Defaults to false." },
          },
          required: ["id", "prompt", "options"],
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
  description: "Launch a new agent to handle complex, multi-step tasks autonomously.\n\nThe Task tool launches specialized subagents (subprocesses) that autonomously handle complex tasks. Each subagent_type has specific capabilities and tools available to it.\n\nWhen using the Task tool, you must specify a subagent_type parameter to select which agent type to use.\n\nVERY IMPORTANT: When broadly exploring the codebase to gather context for a large task, it is recommended that you use the Task tool with subagent_type=\"explore\" instead of running search commands directly.\n\nIf the query is a narrow or specific question, you should NOT use the Task and instead address the query directly using the other tools available to you.\n\nExamples:\n- user: \"Where is the ClientError class defined?\" assistant: [Uses Grep directly - this is a needle query for a specific class]\n- user: \"Run this query using my database API\" assistant: [Calls the MCP directly - this is not a broad exploration task]\n- user: \"What is the codebase structure?\" assistant: [Uses the Task tool with subagent_type=\"explore\"]\n\nIf it is possible to explore different areas of the codebase in parallel, you should launch multiple agents concurrently.\n\nWhen NOT to use the Task tool:\n- Simple, single or few-step tasks that can be performed by a single agent (using parallel or sequential tool calls) -- just call the tools directly instead.\n- For example:\n  - If you want to read a specific file path, use the Read or Glob tool instead of the Task tool, to find the match more quickly\n  - If you are searching for code within a specific file or set of 2-3 files, use the Read tool instead of the Task tool, to find the match more quickly\n  - If you are searching for a specific class definition like \"class Foo\", use the Glob tool instead, to find the match more quickly\n\nUsage notes:\n- Always include a short description (3-5 words) summarizing what the agent will do\n- Launch multiple agents concurrently whenever possible, to maximize performance; to do that, use a single message with multiple tool uses.\n- When the agent is done, it will return a single message back to you. Specify exactly what information the agent should return back in its final response to you. Background subagent completion messages already include a user-visible summary portion; do not summarize or restate a single background subagent's result by default. Respond only when the user asks, multiple background subagents need synthesis, or the background subagent reports a blocker requiring parent action outside of the user-visible high level summary.\n- Agents can be resumed using the `resume` parameter by passing the agent ID from a previous invocation. This sends a follow-up message after the agent has completed, preserving existing context. If the agent is still running, the request fails unless `interrupt` is true. Set `interrupt` to true only when the user explicitly wants to interrupt the running agent. You can also set `resume` to \"self\" to fork the current parent agent into a new child subagent. When NOT resuming, each invocation starts fresh and you should provide a detailed task description with all necessary context.\n- In user-facing responses, you may link to agents and subagents with markdown chat links in the `[label](id)` format, using the agent ID as the link target. Do not print raw agent IDs separately.\n- When using the Task tool, the subagent invocation does not have access to the user's message or prior assistant steps. Therefore, you should provide a highly detailed task description with all necessary context for the agent to perform its task autonomously.\n- The subagent's outputs should generally be trusted\n- Clearly tell the subagent which tasks you want it to perform, since it is not aware of the user's intent or your prior assistant steps (tool calls, thinking, or messages).\n- If the subagent description mentions that it should be used proactively, then you should try your best to use it without the user having to ask for it first. Use your judgement.\n- If the user specifies that they want you to run subagents \"in parallel\", you MUST send a single message with multiple Task tool use content blocks. For example, if you need to launch both a code-reviewer subagent and a test-runner subagent in parallel, send a single message with both tool calls.\n- Avoid delegating the full query to the Task tool and returning the result. In these cases, you should address the query using the other tools available to you.\n\nAvailable subagent_types and a quick description of what they do:\n- generalPurpose: General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. Use when searching for a keyword or file and not confident you'll find the match quickly.\n- explore: Fast, readonly agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. \"src/components/**/*.tsx\"), search code for keywords (eg. \"API endpoints\"), or answer questions about the codebase (eg. \"how do API endpoints work?\"). This agent operates in read-only mode and cannot modify files. When calling this agent, specify the desired thoroughness level: \"quick\" for basic searches, \"medium\" for moderate exploration, or \"very thorough\" for comprehensive analysis across multiple locations and naming conventions.\n- shell: Command execution specialist for running bash commands. Use this for git operations, command execution, and other terminal tasks.\n- cursor-guide: Read Cursor product documentation to answer questions about how Cursor Desktop, IDE, CLI, Cloud Agents, Bugbot, and other features work. Use when the user asks 'In Cursor, how do I...?' or similar questions about Cursor products.\n- ci-investigator: Investigate a single failing PR CI check and return a short root-cause summary. Use when the user asks to summarize, explain, diagnose, or investigate a specific failed check from a pull request.\n- bugbot: Use only when the user *explicitly* asks for a Bugbot-like review of local code changes.\n- security-review: Use only when the user *explicitly* asks for a security review of local code changes.\n- best-of-n-runner: Run a task in an isolated git worktree. Each best-of-n-runner gets its own branch and working directory. Use for best-of-N parallel attempts or isolated experiments.\n- docs-researcher: Lightweight agent for fetching library documentation without cluttering your main conversation context.\n- code-reviewer: Use this agent when a major project step has been completed and needs to be reviewed against the original plan and coding standards.\n\nWhen an agent runs in the background, you will be automatically notified when it completes after you end your own turn - do NOT AwaitShell, poll, or proactively check on its progress. Continue with other work or end your turn instead.",
  parameters: {
    type: "object",
    properties: {
      description: { type: "string", description: "A short, user-friendly title for the subagent. This appears in the UI as the subagent's name. Make it concrete and distinct, consider recent titles to avoid reuse. For resumed subagents which you are prompting to work on a separate task, give an updated description based on the latest work the subagent is performing. (Do not rename if the subagent is continuing work on the same high-level task.)" },
      prompt: { type: "string", description: "The task for the agent to perform" },
      model: { type: "string", description: "Optional model slug for this agent. Omit it unless the user explicitly named a model — by default the subagent inherits the parent agent's model. Never guess or invent a slug: an unknown slug is ignored and the parent model is used instead. Do not pass if resume field is set (prior model will be used)." },
      resume: { type: "string", description: "Optional agent ID to resume from. If provided, sends a follow-up message to the agent after it has completed. Requests to a currently running asynchronous agent fail unless `interrupt` is true; set `interrupt` to true only when you intend to interrupt the running agent. Use \"self\" to start a new agent with your own entire conversation history as a starting point (aka 'self-fork')." },
      readonly: { type: "boolean", description: "If true, the subagent will run in readonly mode (\"Ask mode\") with restricted write operations and no MCP or internet access." },
      subagent_type: {
        type: "string",
        description: "Subagent type to use for this task. Either one of the built-in types (generalPurpose, explore, shell, cursor-guide, ci-investigator, bugbot, security-review, best-of-n-runner, docs-researcher, code-reviewer) or the name of a configured subagent — including a member of an assigned team listed in <assigned_teams> or <subagents>.",
      },
      file_attachments: { type: "array", items: { type: "string" }, description: "Optional array of file paths to images or videos to pass to video-review subagents. Files are read and attached to the subagent's context. Use to forward relevant media (e.g. images sent by user) to subagents." },
      interrupt: { type: "boolean", description: "If true and `resume` targets a running async agent, interrupt the current run and send this prompt immediately. Only use when the user explicitly asks to interrupt or change what the running agent is doing." },
      run_in_background: { type: "boolean", description: "Run the agent in the background (returns output_file path to check later). If this is false, you will be blocked until the agent completes. If the user is currently in Multitask Mode, always set this parameter to True. When true, the background subagent will send a notification when it completes." },
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
  description: "Switch the interaction mode to better match the current task. Each mode is optimized for a specific type of work.\n\n## When to Switch Modes\n\nSwitch modes proactively when:\n1. **Task type changes** - User shifts from asking questions to requesting implementation, or vice versa\n2. **Complexity emerges** - What seemed simple reveals architectural decisions or multiple approaches\n3. **Debugging needed** - An error, bug, or unexpected behavior requires investigation\n4. **Planning needed** - The task is large, ambiguous, or has significant trade-offs to discuss\n5. **You're stuck** - Multiple attempts without progress suggest a different approach is needed\n\n## When NOT to Switch\n\nDo NOT switch modes for:\n- Simple, clear tasks that can be completed quickly in current mode\n- Mid-implementation when you're making good progress\n- Minor clarifying questions (just ask them)\n- Tasks where the current mode is working well\n\n## Available Modes\n\n### Agent Mode [switchable]\nDefault implementation mode with full access to all tools for making changes.\n\n### Plan Mode [switchable]\nRead-only collaborative mode for designing implementation approaches before coding.\n\n### Debug Mode (cannot switch to this mode)\nSystematic troubleshooting mode for investigating bugs, failures, and unexpected behavior with runtime evidence.\n\n### Ask Mode (cannot switch to this mode)\nRead-only mode for exploring code and answering questions without making changes.\n\n## Important Notes\n\n- **Be proactive**: Don't wait for the user to ask you to switch modes\n- **Explain briefly**: When switching, briefly explain why in your `explanation` parameter\n- **Don't over-switch**: If the current mode is working, stay in it\n- **User approval required**: Mode switches require user consent",
  parameters: {
    type: "object",
    properties: {
      target_mode_id: { type: "string", description: "The mode to switch to. Allowed values: 'plan', 'agent'." },
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
// OpenCursor-specific tools (not part of Cursor's request). Same description
// style and level of detail as the tools above.
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

