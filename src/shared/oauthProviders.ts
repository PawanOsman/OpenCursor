/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

/** Public account-provider metadata; no credentials or Node dependencies. */
export const OAUTH_PROVIDER_DEFINITIONS = [
  { kind: "claude-code", label: "Claude Code", sub: "Anthropic account", loginMethod: "browser" },
  { kind: "codex", label: "OpenAI Codex", sub: "ChatGPT account", loginMethod: "browser" },
  { kind: "antigravity", label: "Google Antigravity", sub: "Google account", loginMethod: "browser" },
  { kind: "xai", label: "xAI", sub: "xAI account", loginMethod: "browser" },
  { kind: "grok-cli", label: "Grok CLI", sub: "Grok CLI account", loginMethod: "device-code" },
  { kind: "gemini-cli", label: "Gemini CLI", sub: "Google account", loginMethod: "browser" },
  { kind: "iflow", label: "iFlow", sub: "iFlow account", loginMethod: "browser" },
  { kind: "qoder", label: "Qoder", sub: "Qoder account", loginMethod: "device-code" },
  { kind: "qoder-cn", label: "Qoder China", sub: "Qoder China account", loginMethod: "device-code" },
  { kind: "github", label: "GitHub Copilot", sub: "GitHub account", loginMethod: "device-code" },
  { kind: "kiro", label: "Kiro", sub: "AWS Builder ID", loginMethod: "device-code" },
  { kind: "cursor", label: "Cursor", sub: "Import your account token", loginMethod: "import-token" },
  { kind: "kimi", label: "Kimi Code", sub: "Kimi account", loginMethod: "device-code" },
  { kind: "kilocode", label: "Kilo Code", sub: "Kilo account", loginMethod: "device-code" },
  { kind: "cline", label: "Cline", sub: "Cline account", loginMethod: "browser" },
  { kind: "clinepass", label: "Cline Pass", sub: "Cline Pass account", loginMethod: "browser" },
  { kind: "gitlab", label: "GitLab Duo", sub: "GitLab OAuth application", loginMethod: "browser" },
  { kind: "codebuddy-cn", label: "CodeBuddy China", sub: "CodeBuddy China account", loginMethod: "device-code" },
  { kind: "codebuddy-intl", label: "CodeBuddy", sub: "CodeBuddy account", loginMethod: "device-code" },
  { kind: "kimchi", label: "Kimchi", sub: "Import your account token", loginMethod: "import-token" },
  { kind: "trae", label: "Trae", sub: "Trae account · Chat only", loginMethod: "browser" },
  { kind: "windsurf", label: "Windsurf", sub: "Windsurf account · Chat only", loginMethod: "browser" },
  { kind: "zed", label: "Zed", sub: "Zed account", loginMethod: "browser" },
  { kind: "xiaomi-mimo", label: "Xiaomi MiMo", sub: "Xiaomi account", loginMethod: "browser" },
] as const;
export type OAuthProviderKind = typeof OAUTH_PROVIDER_DEFINITIONS[number]["kind"];
/** The currently implemented transports expose text chat only for these accounts. */
export function supportsOAuthTools(kind: OAuthProviderKind): boolean {
  return kind !== "trae" && kind !== "windsurf";
}
/** Providers whose live quota endpoints support quota-aware account selection. */
export function supportsOAuthQuota(kind: OAuthProviderKind): boolean {
  return kind === "claude-code" || kind === "codex" || kind === "antigravity";
}
export const OAUTH_KINDS: OAuthProviderKind[] = OAUTH_PROVIDER_DEFINITIONS.map(provider => provider.kind);
export function isOAuthProviderKind(value: unknown): value is OAuthProviderKind { return typeof value === "string" && OAUTH_KINDS.includes(value as OAuthProviderKind); }
