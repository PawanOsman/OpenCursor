import { describe, expect, it } from "vitest";
import { PROVIDERS, PROVIDER_OAUTH } from "./index.js";
import { ANTIGRAVITY_IDE_USER_AGENT, ANTIGRAVITY_IDE_VERSION, mergeAnthropicBeta } from "./shared.js";

// Pinned to 9router v0.5.111 provider identities.
describe("provider registry identity (9router v0.5.111)", () => {
  it("uses the upstream Codex CLI identity", () => {
    expect(PROVIDERS.codex.cliVersion).toBe("0.159.0");
    expect(PROVIDERS.codex.headers).toMatchObject({ originator: "codex_cli_rs", "User-Agent": "codex_cli_rs/0.159.0", version: "0.159.0" });
    expect(PROVIDER_OAUTH.codex.refreshLeadMs).toBe(600000);
  });

  it("uses the Antigravity Hub 2.24.0 fingerprint", () => {
    expect(ANTIGRAVITY_IDE_VERSION).toBe("2.24.0");
    expect(ANTIGRAVITY_IDE_USER_AGENT).toBe("antigravity/hub/2.24.0 darwin/arm64");
    expect(PROVIDERS.antigravity.headers?.["User-Agent"]).toBe(ANTIGRAVITY_IDE_USER_AGENT);
    expect(PROVIDER_OAUTH.antigravity.loadCodeAssistUserAgent).toBe(ANTIGRAVITY_IDE_USER_AGENT);
  });

  it("uses the Grok CLI 1.0.44 identity", () => {
    expect(PROVIDERS["grok-cli"].clientVersion).toBe("1.0.44");
    expect(PROVIDERS["grok-cli"].headers?.["x-grok-client-version"]).toBe("1.0.44");
    expect(PROVIDERS["grok-cli"].headers?.["User-Agent"]).toBe("grok-shell/1.0.44 (linux; x86_64)");
  });

  it("dedupes merged anthropic-beta flags", () => {
    expect(mergeAnthropicBeta("a,b", " b ,c", undefined)).toBe("a,b,c");
  });
});
