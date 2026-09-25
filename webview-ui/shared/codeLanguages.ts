/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

export interface CodeLanguage { id: string; label: string; aliases?: readonly string[] }

export const CODE_LANGUAGES: readonly CodeLanguage[] = [
  { id: "plaintext", label: "Plain text", aliases: ["text", "txt", "plain", "none"] },
  { id: "arduino", label: "Arduino", aliases: ["ino"] },
  { id: "bash", label: "Bash", aliases: ["sh", "shell", "zsh", "shellscript"] },
  { id: "c", label: "C" },
  { id: "cpp", label: "C++", aliases: ["c++", "cc", "cxx"] },
  { id: "csharp", label: "C#", aliases: ["cs", "c#"] },
  { id: "css", label: "CSS" },
  { id: "diff", label: "Diff", aliases: ["patch"] },
  { id: "dockerfile", label: "Dockerfile", aliases: ["docker"] },
  { id: "go", label: "Go", aliases: ["golang"] },
  { id: "graphql", label: "GraphQL", aliases: ["gql"] },
  { id: "html", label: "HTML", aliases: ["htm"] },
  { id: "ini", label: "INI", aliases: ["conf", "cfg"] },
  { id: "java", label: "Java" },
  { id: "javascript", label: "JavaScript", aliases: ["js", "mjs", "cjs", "jsx"] },
  { id: "json", label: "JSON", aliases: ["jsonc", "json5"] },
  { id: "kotlin", label: "Kotlin", aliases: ["kt", "kts"] },
  { id: "lua", label: "Lua" },
  { id: "makefile", label: "Makefile", aliases: ["make"] },
  { id: "markdown", label: "Markdown", aliases: ["md", "mdx"] },
  { id: "perl", label: "Perl", aliases: ["pl"] },
  { id: "php", label: "PHP" },
  { id: "powershell", label: "PowerShell", aliases: ["ps", "ps1", "pwsh"] },
  { id: "python", label: "Python", aliases: ["py", "python3"] },
  { id: "r", label: "R" },
  { id: "ruby", label: "Ruby", aliases: ["rb"] },
  { id: "rust", label: "Rust", aliases: ["rs"] },
  { id: "scala", label: "Scala" },
  { id: "scss", label: "SCSS", aliases: ["sass"] },
  { id: "sql", label: "SQL" },
  { id: "swift", label: "Swift" },
  { id: "toml", label: "TOML" },
  { id: "typescript", label: "TypeScript", aliases: ["ts", "tsx", "mts", "cts"] },
  { id: "xml", label: "XML", aliases: ["svg", "xsl", "xhtml"] },
  { id: "yaml", label: "YAML", aliases: ["yml"] },
];

const byId = new Map<string, CodeLanguage>();
for (const language of CODE_LANGUAGES) {
  byId.set(language.id, language);
  for (const alias of language.aliases ?? []) byId.set(alias, language);
}

/** Unknown fence labels render as plain text; they never become HTML attributes. */
export function normalizeCodeLanguage(value = "auto"): string {
  const normalized = value.trim().toLowerCase();
  return !normalized || normalized === "auto" ? "auto" : byId.get(normalized)?.id ?? "plaintext";
}

/** Small, bounded signature checks keep typing and large pastes off the expensive parsing path. */
function detectLanguage(value: string): string {
  const code = value.slice(0, 24_000).trim();
  if (!code) return "plaintext";
  if (/^(?:HTTP\/\d(?:\.\d)?\s+\d{3}|(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S+\s+HTTP\/|(?:[\w.]+)?(?:Error|Exception):|(?:\d{4}-\d\d-\d\d[T ]|\[?(?:DEBUG|INFO|WARN|ERROR)\]?\s))/i.test(code)) return "plaintext";
  if (/^#![^\n]*\b(?:python\d*|pypy\d*)\b/.test(code)) return "python";
  if (/^#![^\n]*\b(?:ba|z|fi|da)?sh\b/.test(code)) return "bash";
  if (/^#![^\n]*\b(?:node|deno|bun)\b/.test(code)) return "javascript";
  if (/^#![^\n]*\b(?:ruby|perl)\b/.test(code)) return code.split("\n", 1)[0].includes("ruby") ? "ruby" : "perl";
  if (/^<\?php\b/i.test(code)) return "php";
  if (/^diff --git |^@@[ -+\d,]+@@/m.test(code) || /^--- [^\n]+\n\+\+\+ /m.test(code)) return "diff";
  if (/^\s*(?:FROM|ARG)\s+[^\n]+\n[\s\S]*\b(?:RUN|COPY|WORKDIR|CMD|ENTRYPOINT)\b/m.test(code)) return "dockerfile";
  if (/^\s*<\?xml\b/.test(code)) return "xml";
  if (/<!doctype\s+html|<(?:html|head|body|div|span|button|p|input|section|main|script)\b[^>]*>/i.test(code)) return "html";
  if (/^\s*<[A-Za-z][\w:-]*(?:\s[^<>]*|)\/?>(?:[\s\S]*<\/|\s*$)/.test(code)) return "xml";
  if (/^[{[]/.test(code)) {
    try { JSON.parse(code); return "json"; } catch { /* Incomplete objects still need a quoted key. */ }
    if (/^\{\s*"[^"\n]+"\s*:/.test(code) || /^\[\s*\{\s*"[^"\n]+"\s*:/.test(code)) return "json";
  }
  if (/\bvoid\s+(?:setup|loop)\s*\(\s*\)/.test(code) && /\b(?:pinMode|digitalWrite|Serial\.)/.test(code)) return "arduino";
  if (/\b(?:fn\s+\w+\s*\(|impl(?:<[^>]*>)?\s+\w+|use\s+\w+::|let\s+mut\s+\w+)|\bprintln!\s*\(/.test(code)) return "rust";
  if (/^\s*package\s+\w+[ \t]*\n/m.test(code) && /\bfunc\s+(?:\([^)]*\)\s*)?\w+\s*\(/.test(code)) return "go";
  if (/\bfunc\s+\w+\s*\([^)]*\)\s*(?:\w+\s*)?\{/.test(code) || /\bfmt\.Print(?:ln|f)?\(/.test(code)) return "go";
  if (/^\s*(?:async\s+)?def\s+\w+\s*\([^\n]*\)\s*(?:->[^:\n]+)?:|^\s*(?:from\s+[\w.]+\s+import\s|if\s+__name__\s*==)/m.test(code) || /^print\s*\(/.test(code)) return "python";
  if (/\b(?:interface\s+\w+\s*(?:extends\s+\w+\s*)?\{|type\s+\w+(?:<[^>]*>)?\s*=)|\b(?:const|let|var)\s+\w+\s*:\s*[\w{[]|\)\s*:\s*(?:string|number|boolean|void|Promise)\b/.test(code)) return "typescript";
  if (/\b(?:console\.(?:log|warn|error)|(?:JSON|Math|Object)\.\w+|document\.\w+|require)\s*\(|\b(?:const|let|var)\s+[\w$]+\s*=|\b(?:async\s+)?function\s*[\w$]*\s*\(|=>|\b(?:import|export)\s+(?:default\s+|\{|\*|const\s+)/.test(code)) return "javascript";
  if (/\busing\s+System\b|\bnamespace\s+[\w.]+\s*[;{]|\bConsole\.Write(?:Line)?\s*\(/.test(code)) return "csharp";
  if (/\b(?:public\s+class\s+\w+|System\.out\.print(?:ln)?\s*\(|import\s+java\.)/.test(code)) return "java";
  if (/\b(?:fun\s+\w+\s*\(|data\s+class\s+\w+|val\s+\w+\s*:[^\n=]+=)/.test(code)) return "kotlin";
  if (/\b(?:case\s+class\s+\w+|object\s+\w+\s+extends\s+App|def\s+\w+\([^)]*\)\s*:\s*\w+\s*=)/.test(code)) return "scala";
  if (/\b(?:import\s+(?:SwiftUI|Foundation)|func\s+\w+\([^)]*\)\s*->|guard\s+let\s+\w+)/.test(code)) return "swift";
  if (/\bstd::|#\s*include\s*<(?:iostream|vector|string|memory)>|\bcout\s*<</.test(code)) return "cpp";
  if (/^\s*#\s*include\s*[<"][^>"\n]+[>"]|\b(?:int|void)\s+main\s*\(/m.test(code)) return "c";
  if (/\b(?:Get|Set|Write|New|Remove|Invoke|Select|ForEach)-[A-Z]\w+|\$(?:env|PSVersionTable|Error|PSScriptRoot)\b/.test(code)) return "powershell";
  if (/^\s*(?:SELECT\s+[\s\S]{0,500}\bFROM|INSERT\s+INTO|CREATE\s+TABLE|UPDATE\s+\w+\s+SET|ALTER\s+TABLE|DELETE\s+FROM)\b/im.test(code)) return "sql";
  if (/^\s*(?:query|mutation|subscription|fragment)\s*(?:\w+\s*)?(?:\([^)]*\)\s*)?\{|^\s*type\s+\w+\s*\{[\s\S]*\w+\s*:\s*[A-Z]/m.test(code)) return "graphql";
  if (/\b(?:local\s+\w+\s*=|function\s+\w+\s*\([^)]*\)[ \t]*\n)|\bthen\s*\n[\s\S]*\bend\b/.test(code)) return "lua";
  if (/^\s*(?:def\s+[\w!?]+(?:\s*\([^)]*\))?[ \t]*\n|require(?:_relative)?\s+["']|puts\s+["'])/m.test(code)) return "ruby";
  if (/^\s*(?:use\s+(?:strict|warnings)\s*;|my\s+\$\w+\s*=|sub\s+\w+\s*\{)/m.test(code)) return "perl";
  if (/^\s*(?:library|require)\s*\([\w"']+\)|\w+\s*<-\s*(?:function\s*\(|c\s*\(|data\.frame\s*\()/m.test(code)) return "r";
  if (/^\s*(?:\$[\w-]+\s*:[^;\n]+;|@(?:mixin|include|use)\s+)/m.test(code)) return "scss";
  if (/(?:^|\n)\s*[^\n{}]+\{\s*(?:[\w-]+\s*:[^{};\n]+[;}]|--[\w-]+\s*:)/.test(code)) return "css";
  if (/^\s*\[\[[\w.-]+\]\]|^\s*\[[\w.-]+\]\s*\n[\s\S]*^\s*[\w.-]+\s*=\s*(?:["'[]|true\b|false\b)/m.test(code)) return "toml";
  if (/^\s*\[[\w .-]+\]\s*\n[\s\S]*^\s*[\w.-]+\s*=/m.test(code)) return "ini";
  if (/^(?:---\s*\n)?(?:[\w.-]+[ \t]*:[ \t]*[^\n]*(?:\n|$)){2}/.test(code) || /^\s*[\w.-]+\s*:\s*\n\s{2,}\S/m.test(code)) return "yaml";
  if (/^\s*(?:export\s+[A-Z_][A-Z_\d]*=|(?:npm|pnpm|yarn|git|curl|sudo|pip\d?|docker)\s+\S|echo\s+["']|if\s+\[)/m.test(code)) return "bash";
  if (/^\s*[\w./%+-]+\s*:[^\n]*\n\t\S/m.test(code)) return "makefile";
  if (/^#{1,6}\s+\S/m.test(code) || /\[[^\]\n]+\]\(https?:\/\/[^)\n]+\)/.test(code)) return "markdown";
  return "plaintext";
}

export function getCodeLanguage(code: string, explicit = "auto"): CodeLanguage {
  const normalized = normalizeCodeLanguage(explicit);
  return byId.get(normalized === "auto" ? detectLanguage(code) : normalized) ?? CODE_LANGUAGES[0];
}

export function escapeCodeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

const keywords = new Set(("abstract as async await auto bool boolean break case catch char class const continue crate data default defer delete do double else enum export extends extern false final finally float fn for from func function fun go guard if impl import in int interface internal is lambda let local long match module namespace new nil null nullptr object of override package pass private protected pub public raise readonly ref require return self short signed sizeof static string struct super switch synchronized template then this throw throws trait true try type typeof undefined union unsigned use using val var virtual void volatile when where while with yield end select from insert into update delete create table values set join where order by group having limit distinct and or not as on null".split(/\s+/)));
const hashComments = new Set(["bash", "python", "ruby", "perl", "powershell", "yaml", "toml", "ini", "r", "makefile", "dockerfile"]);

/** Lexical colors, rather than a compiler grammar. Output contains only escaped input and fixed span classes. */
export function highlightCode(code: string, explicit = "auto"): string {
  const language = getCodeLanguage(code, explicit).id;
  if (language === "plaintext" || language === "markdown") return escapeCodeHtml(code);
  const input = code.slice(0, 64_000);
  if (language === "diff") return input.split(/(\n)/).map(line => /^(?:\+[^+]|-[^-]|@@)/.test(line)
    ? `<span class="code-token-${line[0] === "+" ? "inserted" : line[0] === "-" ? "deleted" : "keyword"}">${escapeCodeHtml(line)}</span>` : escapeCodeHtml(line)).join("") + escapeCodeHtml(code.slice(input.length));
  const markup = language === "html" || language === "xml";
  const tokens = /<!--[\s\S]*?(?:-->|$)|\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`)|#[^\n]*|--[^\n]*|\b(?:0x[\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b|[A-Za-z_$][\w$-]*|[<>/][!?/]?/gi;
  let output = "", offset = 0;
  for (const match of input.matchAll(tokens)) {
    const token = match[0], index = match.index!;
    output += escapeCodeHtml(input.slice(offset, index));
    let kind = "";
    if (token.startsWith("<!--") || token.startsWith("/*") || token.startsWith("//") || token.startsWith("#") && hashComments.has(language) || token.startsWith("--") && (language === "sql" || language === "lua")) kind = "comment";
    else if (/^["'`]/.test(token)) kind = "string";
    else if (/^\d/.test(token)) kind = "number";
    else if (keywords.has(language === "sql" ? token.toLowerCase() : token)) kind = "keyword";
    else if (markup && /<\/?$/.test(input.slice(Math.max(0, index - 2), index))) kind = "tag";
    else if (/^[\w$]/.test(token) && /^\s*\(/.test(input.slice(index + token.length, index + token.length + 40))) kind = "function";
    output += kind ? `<span class="code-token-${kind}">${escapeCodeHtml(token)}</span>` : escapeCodeHtml(token);
    offset = index + token.length;
  }
  return output + escapeCodeHtml(input.slice(offset)) + escapeCodeHtml(code.slice(input.length));
}
