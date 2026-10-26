import { describe, expect, it, vi } from "vitest";
import { proxyAwareFetch } from "./proxyFetch.js";
import { __test__ } from "../services/opencodeTlsClient.js";

describe("proxyAwareFetch directFetch", () => {
  it("routes the request through the transport override", async () => {
    const directFetch = vi.fn(async () => new Response("ok", { status: 200 }));
    const init = { method: "POST", body: "{}" };
    const res = await proxyAwareFetch("https://opencode.ai/inference/v1/chat/completions", init, null, directFetch);
    expect(directFetch).toHaveBeenCalledWith("https://opencode.ai/inference/v1/chat/completions", init);
    expect(await res.text()).toBe("ok");
  });

  it("keeps the opencode cipher list verbatim (JA4 hash match)", () => {
    expect(__test__.OPENCODE_CIPHER_LIST.split(":")).toHaveLength(17);
    expect(__test__.OPENCODE_CIPHER_LIST.startsWith("TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384")).toBe(true);
  });
});
