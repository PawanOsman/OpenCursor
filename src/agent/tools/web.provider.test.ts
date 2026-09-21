import { afterEach, describe, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => ({ connect: vi.fn(), callTool: vi.fn(), dispose: vi.fn(), tools: [{ name: "web_search" }], configs: [] as any[] }));
vi.mock("../../integrations/mcpClient", () => ({ McpConnection: class {
  tools = bridge.tools; connect = bridge.connect; callTool = bridge.callTool; dispose = bridge.dispose;
  constructor(config: any) { bridge.configs.push(config); }
} }));
import { setWebSearchProvider, webSearchTool } from "./web";
afterEach(() => { setWebSearchProvider(undefined); vi.unstubAllGlobals(); vi.clearAllMocks(); bridge.configs.length = 0; });
describe("built-in WebSearch provider routing", () => {
  it("keeps DuckDuckGo by default without starting a bridge", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '<a href="https://example.com">Example result</a>' }); vi.stubGlobal("fetch", fetch);
    expect((await webSearchTool.execute({ search_term: "example" })).output).toContain("https://example.com");
    expect(fetch.mock.calls[0][0]).toContain("duckduckgo.com"); expect(bridge.configs).toHaveLength(0);
  });
  it("routes explicit selection through discovery and preserves citations", async () => {
    setWebSearchProvider("parallel", "0.1.4");
    bridge.callTool.mockResolvedValue(JSON.stringify({ results: [{ title: "Example", url: "https://example.com", excerpts: ["Useful evidence"] }], warnings: ["Query shortened"] }));
    const result = await webSearchTool.execute({ search_term: "example" });
    expect(result.output).toContain("Useful evidence"); expect(result.output).toContain("https://example.com"); expect(result.output).toContain("Query shortened");
    expect(bridge.callTool).toHaveBeenCalledWith("web_search", { objective: "example", search_queries: ["example"] }, undefined);
    expect(bridge.configs[0].args).toContain("User-Agent:OpenCursor/0.1.4"); expect(bridge.configs[0].args).toContain("https://search.parallel.ai/mcp"); expect(bridge.dispose).toHaveBeenCalledOnce();
  });
  it.each(["error: rate limited", "not JSON", JSON.stringify({ results: {} }), JSON.stringify({ results: [{ url: "https://example.com", excerpts: [42] }] })])("reports failure without fallback: %s", async (payload) => {
    setWebSearchProvider("parallel"); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); bridge.callTool.mockResolvedValue(payload);
    expect((await webSearchTool.execute({ search_term: "example" })).output).toMatch(/^error:/); expect(fetch).not.toHaveBeenCalled(); expect(bridge.dispose).toHaveBeenCalledOnce();
  });
  it("distinguishes empty success from failure", async () => {
    setWebSearchProvider("parallel"); bridge.callTool.mockResolvedValue(JSON.stringify({ results: [] })); expect((await webSearchTool.execute({ search_term: "example" })).output).toContain("No results found");
  });
  it("preserves structured warning messages and details", async () => {
    setWebSearchProvider("parallel");
    const warning = { type: "query_shortened", message: "Query shortened", detail: "Only the first 200 characters were searched" };
    bridge.callTool.mockResolvedValue(JSON.stringify({ results: [], warnings: [warning] }));
    const result = await webSearchTool.execute({ search_term: "example" });
    expect(result.output).toContain(warning.message);
    expect(result.output).toContain(warning.detail);
    expect(result.output).toContain(warning.type);
    expect(result.output).not.toContain("[object Object]");
  });
  it("cancels bridge initialization", async () => {
    setWebSearchProvider("parallel"); const abort = new AbortController(); bridge.connect.mockImplementationOnce(async () => { abort.abort(); });
    expect((await webSearchTool.execute({ search_term: "example" }, abort.signal)).output).toContain("aborted"); expect(bridge.callTool).not.toHaveBeenCalled(); expect(bridge.dispose).toHaveBeenCalled();
  });
  it("does not start a bridge after cancellation", async () => {
    setWebSearchProvider("parallel"); const abort = new AbortController(); abort.abort(); expect((await webSearchTool.execute({ search_term: "example" }, abort.signal)).output).toContain("aborted"); expect(bridge.configs).toHaveLength(0);
  });
  it("reports missing Node/npx", async () => {
    setWebSearchProvider("parallel"); bridge.connect.mockRejectedValueOnce(new Error("spawn npx ENOENT")); expect((await webSearchTool.execute({ search_term: "example" })).output).toContain("ENOENT"); expect(bridge.dispose).toHaveBeenCalledOnce();
  });
});
