import { McpConnection } from "./mcpClient";

/** Uses the host's stdio MCP client, without registering extra generic MCP tools. */
export async function parallelSearch(term: string, signal?: AbortSignal, version?: string): Promise<string> {
  if (signal?.aborted) throw new Error("aborted: web search");
  const connection = new McpConnection({
    name: "parallel-search",
    transport: "stdio",
    command: "npx",
    args: ["-y", "mcp-remote@0.14.3", "https://search.parallel.ai/mcp", "--transport", "http-only", "--header", `User-Agent:OpenCursor${version ? `/${version}` : ""}`],
    enabled: true,
  });
  // Disposing also rejects initialization, so cancellation covers bridge startup.
  const abort = () => connection.dispose();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await connection.connect(30_000);
    if (signal?.aborted) throw new Error("aborted: web search");
    if (!connection.tools.some((tool) => tool.name === "web_search")) throw new Error("Parallel MCP did not expose web_search");
    const text = await connection.callTool("web_search", { objective: term, search_queries: [term] }, signal);
    if (text.startsWith("error:")) throw new Error(text);
    const payload = JSON.parse(text);
    if (!Array.isArray(payload.results)) throw new Error("Invalid Parallel search result");
    const lines = [`Web results for "${term}" (Parallel):`];
    if (Array.isArray(payload.warnings)) lines.push(...payload.warnings.map((warning: unknown) => `Warning: ${typeof warning === "string" ? warning : JSON.stringify(warning)}`));
    for (const result of payload.results.slice(0, 10)) {
      if (typeof result.url !== "string" || !/^https?:\/\//.test(result.url) || !Array.isArray(result.excerpts) || !result.excerpts.every((excerpt: unknown) => typeof excerpt === "string")) {
        throw new Error("Invalid Parallel search result");
      }
      lines.push(`${result.title || "(untitled)"}\n${result.url}\n${result.excerpts.join("\n")}`);
    }
    if (payload.results.length === 0) lines.push("No results found. Try rephrasing the query.");
    const output = lines.join("\n\n");
    return output.length > 20_000 ? `${output.slice(0, 20_000)}\n[Search output truncated]` : output;
  } finally {
    signal?.removeEventListener("abort", abort);
    connection.dispose();
  }
}
