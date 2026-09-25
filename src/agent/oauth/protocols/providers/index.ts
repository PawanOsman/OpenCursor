/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { ProtocolRecord, ProviderTransport, ProviderModel } from "../wireTypes.js";
export const PROVIDERS: Record<string, ProviderTransport> = {
    "gemini-cli": {
        "format": "gemini-cli",
        "baseUrl": "https://cloudcode-pa.googleapis.com/v1internal",
        "cliVersion": "0.34.0",
        "apiClient": "google-genai-sdk/1.41.0 gl-node/v22.19.0",
        "usage": {
            "quotaUrl": "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
            "loadCodeAssistUrl": "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist"
        },
        "clientId": "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com",
        "clientSecret": "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",
        "tokenUrl": "https://oauth2.googleapis.com/token"
    },
    "github": {
        "format": "openai",
        "baseUrl": "https://api.githubcopilot.com/chat/completions",
        "responsesUrl": "https://api.githubcopilot.com/responses",
        "messagesUrl": "https://api.githubcopilot.com/v1/messages",
        "headers": {
            "copilot-integration-id": "vscode-chat",
            "editor-version": "vscode/1.110.0",
            "editor-plugin-version": "copilot-chat/0.38.0",
            "user-agent": "GitHubCopilotChat/0.38.0",
            "openai-intent": "conversation-panel",
            "x-github-api-version": "2025-04-01",
            "x-vscode-user-agent-library-version": "electron-fetch",
            "X-Initiator": "user",
            "Accept": "application/json",
            "Content-Type": "application/json"
        },
        "copilot": {
            "vscodeVersion": "1.110.0",
            "chatVersion": "0.38.0",
            "userAgent": "GitHubCopilotChat/0.38.0",
            "apiVersion": "2025-04-01"
        },
        "usage": {
            "url": "https://api.github.com/copilot_internal/user"
        },
        "clientId": "Iv1.b507a08c87ecfe98",
        "tokenUrl": "https://github.com/login/oauth/access_token"
    },
    "iflow": {
        "format": "openai",
        "baseUrl": "https://apis.iflow.cn/v1/chat/completions",
        "thinkingFormat": "openai",
        "headers": {
            "User-Agent": "iFlow-Cli"
        },
        "clientId": "10009311001",
        "clientSecret": "4Z3YjXycVsQvyGF1etiNlIBB4RsqSDtW",
        "tokenUrl": "https://iflow.cn/oauth/token"
    },
    "qoder": {
        "format": "openai",
        "baseUrl": "https://api3.qoder.sh/algo/api/v2/service/pro/sse/agent_chat_generation",
        "headers": {},
        "timeoutMs": 120000,
        "stallTimeoutMs": 120000,
        "usage": {
            "url": "https://openapi.qoder.sh/api/v2/quota/usage"
        }
    },
    "qoder-cn": {
        "format": "openai",
        "baseUrl": "https://gateway.qoder.com.cn/algo/api/v2/service/pro/sse/agent_chat_generation",
        "headers": {},
        "timeoutMs": 120000,
        "stallTimeoutMs": 120000,
        "usage": {
            "url": "https://openapi.qoder.com.cn/api/v2/quota/usage"
        }
    },
    "kiro": {
        "format": "kiro",
        "baseUrl": "https://runtime.us-east-1.kiro.dev/generateAssistantResponse",
        "baseUrls": [
            "https://runtime.us-east-1.kiro.dev/generateAssistantResponse",
            "https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse",
            "https://q.us-east-1.amazonaws.com/generateAssistantResponse"
        ],
        "retry": {
            "429": 0
        },
        "headers": {
            "Content-Type": "application/json",
            "Accept": "application/vnd.amazon.eventstream",
            "User-Agent": "AWS-SDK-JS/3.0.0 kiro-ide/1.0.0",
            "X-Amz-User-Agent": "aws-sdk-js/3.0.0 kiro-ide/1.0.0"
        },
        "tokenUrl": "https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken",
        "authUrl": "https://prod.us-east-1.auth.desktop.kiro.dev",
        "usage": {
            "cwHost": "https://codewhisperer.us-east-1.amazonaws.com",
            "qHost": "https://q.us-east-1.amazonaws.com",
            "limitsPath": "/getUsageLimits"
        }
    },
    "cursor": {
        "format": "cursor",
        "baseUrl": "https://api2.cursor.sh",
        "chatPath": "/aiserver.v1.ChatService/StreamUnifiedChatWithTools",
        "headers": {
            "connect-accept-encoding": "gzip",
            "connect-protocol-version": "1",
            "Content-Type": "application/connect+proto",
            "User-Agent": "connect-es/1.6.1"
        },
        "clientVersion": "3.12.17"
    },
    "grok-cli": {
        "format": "openai-responses",
        "baseUrl": "https://cli-chat-proxy.grok.com/v1/responses",
        "forceStream": true,
        "modelsUrl": "https://cli-chat-proxy.grok.com/v1/models",
        "userUrl": "https://cli-chat-proxy.grok.com/v1/user",
        "billingUrl": "https://cli-chat-proxy.grok.com/v1/billing",
        "clientVersion": "0.2.99",
        "clientIdentifier": "grok-shell",
        "tokenAuth": "xai-grok-cli",
        "headers": {
            "User-Agent": "grok-shell/0.2.99 (linux; x86_64)",
            "x-grok-client-identifier": "grok-shell",
            "x-grok-client-version": "0.2.99"
        },
        "usage": {
            "url": "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
            "userUrl": "https://cli-chat-proxy.grok.com/v1/user?include=subscription"
        },
        "retry": {
            "429": {
                "attempts": 2,
                "delayMs": 2000
            },
            "502": {
                "attempts": 2,
                "delayMs": 1500
            },
            "503": {
                "attempts": 2,
                "delayMs": 1500
            }
        },
        "clientId": "b1a00492-073a-47ea-816f-4c329264a828",
        "tokenUrl": "https://auth.x.ai/oauth2/token"
    },
    "codebuddy-cn": {
        "format": "openai",
        "baseUrl": "https://copilot.tencent.com/v2/chat/completions",
        "forceStream": true,
        "thinkingFormat": "openai",
        "headers": {
            "User-Agent": "CLI/2.108.1 CodeBuddy/2.108.1",
            "X-Product": "SaaS",
            "X-IDE-Type": "CLI",
            "X-IDE-Name": "CLI",
            "x-requested-with": "XMLHttpRequest",
            "x-codebuddy-request": "1"
        },
        "auth": {
            "combined": true,
            "header": "Authorization",
            "scheme": "bearer"
        },
        "usage": {
            "url": "https://copilot.tencent.com/v2/billing/meter/get-user-resource"
        },
        "tokenUrl": "https://copilot.tencent.com/v2/plugin/auth/token"
    },
    "codebuddy-intl": {
        "format": "openai",
        "baseUrl": "https://www.codebuddy.ai/v2/chat/completions",
        "forceStream": true,
        "thinkingFormat": "openai",
        "headers": {
            "User-Agent": "IDE/2.108.1 CodeBuddy/2.108.1",
            "X-Product": "SaaS",
            "X-IDE-Type": "IDE",
            "X-IDE-Name": "IDE",
            "x-requested-with": "XMLHttpRequest",
            "x-codebuddy-request": "1"
        },
        "auth": {
            "combined": true,
            "header": "Authorization",
            "scheme": "bearer"
        },
        "usage": {
            "url": "https://www.codebuddy.ai/v2/billing/meter/get-user-resource"
        },
        "tokenUrl": "https://www.codebuddy.ai/v2/plugin/auth/token"
    },
    "trae": {
        "format": "openai",
        "baseUrl": "https://core-normal.trae.ai/api/remote/v1",
        "headers": {
            "X-Trae-Client-Type": "web",
            "X-Preferenced-Language": "en",
            "Referer": "https://solo.trae.ai/"
        },
        "auth": {
            "combined": true,
            "header": "Authorization",
            "scheme": "Cloud-IDE-JWT"
        },
        "usage": {
            "url": "https://api.marscode.com/cloudide/api/v3/trae/GetUserInfo"
        },
        "regions": {
            "cn": "https://api.marscode.com",
            "sg": "https://api.trae.ai",
            "us": "https://www.trae.ai"
        },
        "defaultRegion": "cn",
        "clientId": "ono9krqynydwx5",
        "clientSecret": "-",
        "tokenUrl": "https://api.marscode.com/cloudide/api/v3/trae/oauth/ExchangeToken"
    },
    "zed": {
        "format": "openai",
        "baseUrl": "https://cloud.zed.dev/completions",
        "forceStream": true,
        "headers": {
            "content-type": "application/json"
        },
        "auth": {
            "combined": true,
            "header": "Authorization",
            "scheme": "<user_id> <access_token>"
        },
        "usage": {
            "url": "https://cloud.zed.dev/client/users/me"
        },
        "modelsUrl": "https://cloud.zed.dev/models"
    },
    "windsurf": {
        "format": "openai",
        "baseUrl": "https://server.codeium.com/exa.language_server_pb.LanguageServerService/GetChatMessage",
        "headers": {
            "Content-Type": "application/grpc-web+proto",
            "Accept": "application/grpc-web+proto",
            "X-Grpc-Web": "1"
        },
        "auth": {
            "combined": true,
            "header": "Authorization",
            "scheme": "Bearer"
        },
        "clientId": "3GUryQ7ldAeKEuD2obYnppsnmj58eP5u"
    },
    "cline": {
        "format": "openai",
        "baseUrl": "https://api.cline.bot/api/v1/chat/completions",
        "headers": {
            "HTTP-Referer": "https://cline.bot",
            "X-Title": "Cline"
        },
        "quirks": {
            "clineEnvelope": true
        },
        "tokenUrl": "https://api.cline.bot/api/v1/auth/token",
        "refreshUrl": "https://api.cline.bot/api/v1/auth/refresh",
        "auth": {
            "combined": true,
            "header": "Authorization",
            "scheme": "bearer",
            "hooks": [
                "clineHeaders"
            ]
        }
    },
    "clinepass": {
        "format": "openai",
        "baseUrl": "https://api.cline.bot/api/v1/chat/completions",
        "headers": {
            "HTTP-Referer": "https://cline.bot",
            "X-Title": "Cline"
        },
        "quirks": {
            "clineEnvelope": true
        },
        "auth": {
            "combined": true,
            "header": "Authorization",
            "scheme": "bearer",
            "hooks": [
                "clineHeaders"
            ]
        },
        "tokenUrl": "https://api.cline.bot/api/v1/auth/token"
    },
    "kilocode": {
        "format": "openai",
        "baseUrl": "https://api.kilo.ai/api/openrouter/chat/completions",
        "headers": {},
        "auth": {
            "combined": true,
            "header": "Authorization",
            "scheme": "bearer",
            "hooks": [
                "kilocodeOrg"
            ]
        }
    },
    "kimi": {
        "format": "claude",
        "baseUrl": "https://api.kimi.com/coding/v1/messages",
        "urlSuffix": "?beta=true",
        "headers": {
            "Anthropic-Version": "2023-06-01",
            "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
        },
        "clientId": "17e5f671-d194-4dfb-9706-5516cb48c098",
        "tokenUrl": "https://auth.kimi.com/api/oauth/token",
        "refreshUrl": "https://auth.kimi.com/api/oauth/token",
        "auth": {
            "combined": true,
            "header": "x-api-key",
            "scheme": "raw",
            "hooks": [
                "kimiHeaders"
            ]
        },
        "transports": [
            {
                "format": "openai",
                "baseUrl": "https://api.kimi.com/coding/v1/chat/completions",
                "auth": {
                    "combined": true,
                    "header": "Authorization",
                    "scheme": "bearer",
                    "hooks": [
                        "kimiHeaders"
                    ]
                }
            },
            {
                "format": "claude",
                "baseUrl": "https://api.kimi.com/coding/v1/messages",
                "urlSuffix": "?beta=true",
                "headers": {
                    "Anthropic-Version": "2023-06-01",
                    "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
                },
                "auth": {
                    "combined": true,
                    "header": "x-api-key",
                    "scheme": "raw",
                    "hooks": [
                        "kimiHeaders"
                    ]
                }
            }
        ]
    },
    "xiaomi-mimo": {
        "format": "openai",
        "baseUrl": "https://api.xiaomimimo.com/v1/chat/completions",
        "validateUrl": "https://api.xiaomimimo.com/v1/models",
        "transports": [
            {
                "format": "openai",
                "baseUrl": "https://api.xiaomimimo.com/v1/chat/completions",
                "auth": {
                    "combined": true,
                    "header": "Authorization",
                    "scheme": "bearer"
                }
            },
            {
                "format": "claude",
                "baseUrl": "https://api.xiaomimimo.com/anthropic/v1/messages",
                "headers": {
                    "Anthropic-Version": "2023-06-01",
                    "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
                },
                "auth": {
                    "combined": true,
                    "header": "x-api-key",
                    "scheme": "raw"
                }
            }
        ]
    },
    "xai": {
        "format": "openai",
        "baseUrl": "https://api.x.ai/v1/chat/completions",
        "validateUrl": "https://api.x.ai/v1/models",
        "responsesUrl": "https://api.x.ai/v1/responses",
        "clientId": "b1a00492-073a-47ea-816f-4c329264a828",
        "tokenUrl": "https://auth.x.ai/oauth2/token",
        "refreshUrl": "https://auth.x.ai/oauth2/token"
    },
    "gitlab": {
        "format": "openai",
        "baseUrl": "https://gitlab.com/api/v4/chat/completions",
        "auth": {
            "combined": true,
            "header": "Authorization",
            "scheme": "bearer"
        }
    },
    "kimchi": {
        "format": "openai",
        "baseUrl": "https://llm.kimchi.dev/openai/v1/chat/completions",
        "headers": {
            "User-Agent": "kimchi/0.1.50"
        },
        "auth": {
            "combined": true,
            "header": "Authorization",
            "scheme": "bearer"
        }
    },
    "codex": {
        "format": "openai-responses",
        "baseUrl": "https://chatgpt.com/backend-api/codex/responses",
        "forceStream": true,
        "cliVersion": "0.154.0",
        "headers": {
            "originator": "codex_cli_rs",
            "User-Agent": "codex_cli_rs/0.154.0"
        },
        "usage": {
            "url": "https://chatgpt.com/backend-api/wham/usage",
            "resetCreditsUrl": "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits",
            "resetCreditsConsumeUrl": "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume"
        },
        "clientId": "app_EMoamEEZ73f0CkXaXp7hrann",
        "tokenUrl": "https://auth.openai.com/oauth/token"
    },
    "claude": {
        "format": "claude",
        "baseUrl": "https://api.anthropic.com/v1/messages",
        "urlSuffix": "?beta=true",
        "headers": {
            "Anthropic-Version": "2023-06-01",
            "Anthropic-Beta": "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,advanced-tool-use-2025-11-20,effort-2025-11-24,structured-outputs-2025-12-15,fast-mode-2026-02-01,redact-thinking-2026-02-12,token-efficient-tools-2026-03-28",
            "Anthropic-Dangerous-Direct-Browser-Access": "true",
            "User-Agent": "claude-cli/2.1.280 (external, sdk-cli)",
            "X-App": "cli",
            "X-Stainless-Helper-Method": "stream",
            "X-Stainless-Retry-Count": "0",
            "X-Stainless-Runtime-Version": "v24.14.0",
            "X-Stainless-Package-Version": "0.80.0",
            "X-Stainless-Runtime": "node",
            "X-Stainless-Lang": "js",
            "X-Stainless-Arch": "arm64",
            "X-Stainless-Os": "MacOS",
            "X-Stainless-Timeout": "600"
        },
        "quirks": {
            "cloakToolsOnOAuth": true
        },
        "auth": {
            "apiKey": {
                "header": "x-api-key",
                "scheme": "raw"
            },
            "oauth": {
                "header": "Authorization",
                "scheme": "bearer"
            }
        },
        "usage": {
            "oauthUrl": "https://api.anthropic.com/api/oauth/usage",
            "orgUrl": "https://api.anthropic.com/v1/organizations/{org_id}/usage",
            "settingsUrl": "https://api.anthropic.com/v1/settings"
        },
        "clientId": "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
        "tokenUrl": "https://api.anthropic.com/v1/oauth/token"
    },
    "antigravity": {
        "format": "antigravity",
        "baseUrls": [
            "https://daily-cloudcode-pa.googleapis.com"
        ],
        "headers": {
            "User-Agent": "antigravity/ide/2.11.0 darwin/arm64"
        },
        "retry": {
            "429": {
                "attempts": 3
            },
            "500": {
                "attempts": 3
            },
            "503": {
                "attempts": 3
            }
        },
        "usage": {
            "quotaApiUrl": "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
            "quotaSummaryApiUrl": "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
            "loadProjectApiUrl": "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
            "tokenUrl": "https://oauth2.googleapis.com/token"
        },
        "clientId": "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
        "clientSecret": "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",
        "tokenUrl": "https://oauth2.googleapis.com/token"
    },
    "openai": {
        "format": "openai",
        "baseUrl": "https://api.openai.com/v1/chat/completions",
        "forceStream": true
    },
    "anthropic": {
        "format": "claude",
        "baseUrl": "https://api.anthropic.com/v1/messages",
        "headers": {
            "anthropic-version": "2023-06-01",
            "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
        }
    },
    "gemini": {
        "format": "gemini",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta/models",
        "clientId": "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com",
        "clientSecret": "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",
        "auth": {
            "apiKey": {
                "header": "x-goog-api-key",
                "scheme": "raw"
            },
            "oauth": {
                "header": "Authorization",
                "scheme": "bearer"
            }
        }
    },
    "openrouter": {
        "format": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "thinkingFormat": "openai",
        "headers": {
            "HTTP-Referer": "https://endpoint-proxy.local",
            "X-Title": "Endpoint Proxy"
        }
    },
    "ollama-local": {
        "format": "ollama",
        "baseUrl": "http://localhost:11434/api/chat"
    },
    "xiaomi-tokenplan": {
        "format": "openai",
        "baseUrl": "https://token-plan-sgp.xiaomimimo.com/v1/chat/completions",
        "regions": {
            "sgp": "https://token-plan-sgp.xiaomimimo.com/v1",
            "cn": "https://token-plan-cn.xiaomimimo.com/v1",
            "ams": "https://token-plan-ams.xiaomimimo.com/v1"
        },
        "defaultRegion": "sgp",
        "transports": [
            {
                "format": "openai",
                "auth": {
                    "combined": true,
                    "header": "Authorization",
                    "scheme": "bearer"
                }
            },
            {
                "format": "claude",
                "headers": {
                    "Anthropic-Version": "2023-06-01",
                    "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
                },
                "auth": {
                    "combined": true,
                    "header": "x-api-key",
                    "scheme": "raw"
                }
            }
        ]
    },
    "deepseek": {
        "format": "openai",
        "baseUrl": "https://api.deepseek.com/chat/completions",
        "validateUrl": "https://api.deepseek.com/models",
        "reasoningInject": {
            "scope": "all"
        },
        "quirks": {
            "claudeSupportedToolTypes": [
                "web_search_20250305",
                "web_search_20260209"
            ]
        },
        "transports": [
            {
                "format": "openai",
                "baseUrl": "https://api.deepseek.com/chat/completions",
                "auth": {
                    "combined": true,
                    "header": "Authorization",
                    "scheme": "bearer"
                }
            },
            {
                "format": "claude",
                "baseUrl": "https://api.deepseek.com/anthropic/v1/messages",
                "headers": {
                    "Anthropic-Version": "2023-06-01",
                    "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
                },
                "auth": {
                    "combined": true,
                    "header": "x-api-key",
                    "scheme": "raw"
                }
            }
        ]
    },
    "minimax": {
        "format": "claude",
        "baseUrl": "https://api.minimax.io/anthropic/v1/messages",
        "urlSuffix": "?beta=true",
        "headers": {
            "Anthropic-Version": "2023-06-01",
            "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
        },
        "quirks": {
            "dropOutputConfig": true,
            "requireClaudeToolType": true
        },
        "reasoningInject": {
            "scope": "all"
        },
        "auth": {
            "combined": true,
            "header": "x-api-key",
            "scheme": "raw"
        },
        "usage": {
            "urls": [
                "https://www.minimax.io/v1/token_plan/remains",
                "https://api.minimax.io/v1/api/openplatform/coding_plan/remains"
            ]
        },
        "transports": [
            {
                "format": "openai",
                "baseUrl": "https://api.minimax.io/v1/chat/completions",
                "auth": {
                    "combined": true,
                    "header": "Authorization",
                    "scheme": "bearer"
                }
            },
            {
                "format": "claude",
                "baseUrl": "https://api.minimax.io/anthropic/v1/messages",
                "urlSuffix": "?beta=true",
                "headers": {
                    "Anthropic-Version": "2023-06-01",
                    "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
                },
                "auth": {
                    "combined": true,
                    "header": "x-api-key",
                    "scheme": "raw"
                }
            }
        ]
    },
    "alicode-intl": {
        "format": "openai",
        "baseUrl": "https://coding-intl.dashscope.aliyuncs.com/v1/chat/completions",
        "headers": {},
        "quirks": {
            "preserveCacheControl": true
        }
    },
    "alicode": {
        "format": "openai",
        "baseUrl": "https://coding.dashscope.aliyuncs.com/v1/chat/completions",
        "headers": {},
        "quirks": {
            "preserveCacheControl": true
        }
    },
    "azure": {
        "format": "openai",
        "baseUrl": "",
        "headers": {}
    },
    "blackbox": {
        "format": "openai",
        "baseUrl": "https://api.blackbox.ai/v1/chat/completions",
        "thinkingFormat": "openai"
    },
    "byteplus": {
        "format": "openai",
        "baseUrl": "https://ark.ap-southeast.bytepluses.com/api/coding/v3/chat/completions",
        "headers": {}
    },
    "cerebras": {
        "format": "openai",
        "baseUrl": "https://api.cerebras.ai/v1/chat/completions",
        "validateUrl": "https://api.cerebras.ai/v1/models",
        "quirks": {
            "dropClientMetadata": true
        }
    },
    "chutes": {
        "format": "openai",
        "baseUrl": "https://llm.chutes.ai/v1/chat/completions",
        "validateUrl": "https://llm.chutes.ai/v1/models"
    },
    "cloudflare-ai": {
        "format": "openai",
        "baseUrl": "https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1/chat/completions",
        "thinkingFormat": "openai"
    },
    "cohere": {
        "format": "openai",
        "baseUrl": "https://api.cohere.ai/v1/chat/completions",
        "validateUrl": "https://api.cohere.ai/v1/models"
    },
    "commandcode": {
        "format": "commandcode",
        "baseUrl": "https://api.commandcode.ai/alpha/generate",
        "forceStream": true,
        "headers": {
            "x-command-code-version": "0.25.7",
            "x-cli-environment": "cli"
        }
    },
    "featherless": {
        "format": "openai",
        "baseUrl": "https://api.featherless.ai/v1/chat/completions",
        "validateUrl": "https://api.featherless.ai/v1/models"
    },
    "fireworks": {
        "format": "openai",
        "baseUrl": "https://api.fireworks.ai/inference/v1/chat/completions",
        "validateUrl": "https://api.fireworks.ai/inference/v1/models"
    },
    "glm-cn": {
        "format": "openai",
        "baseUrl": "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions",
        "headers": {},
        "usage": {
            "url": "https://open.bigmodel.cn/api/monitor/usage/quota/limit"
        }
    },
    "glm": {
        "format": "claude",
        "baseUrl": "https://api.z.ai/api/anthropic/v1/messages",
        "urlSuffix": "?beta=true",
        "headers": {
            "Anthropic-Version": "2023-06-01",
            "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
        },
        "auth": {
            "combined": true,
            "header": "x-api-key",
            "scheme": "raw"
        },
        "usage": {
            "url": "https://api.z.ai/api/monitor/usage/quota/limit"
        },
        "transports": [
            {
                "format": "openai",
                "baseUrl": "https://api.z.ai/api/coding/paas/v4/chat/completions",
                "auth": {
                    "combined": true,
                    "header": "Authorization",
                    "scheme": "bearer"
                }
            },
            {
                "format": "claude",
                "baseUrl": "https://api.z.ai/api/anthropic/v1/messages",
                "urlSuffix": "?beta=true",
                "headers": {
                    "Anthropic-Version": "2023-06-01",
                    "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
                },
                "auth": {
                    "combined": true,
                    "header": "x-api-key",
                    "scheme": "raw"
                }
            }
        ]
    },
    "groq": {
        "format": "openai",
        "baseUrl": "https://api.groq.com/openai/v1/chat/completions",
        "validateUrl": "https://api.groq.com/openai/v1/models",
        "usage": {
            "url": "https://api.groq.com/openai/v1/models"
        }
    },
    "hyperbolic": {
        "format": "openai",
        "baseUrl": "https://api.hyperbolic.xyz/v1/chat/completions",
        "validateUrl": "https://api.hyperbolic.xyz/v1/models"
    },
    "minimax-cn": {
        "format": "claude",
        "baseUrl": "https://api.minimaxi.com/anthropic/v1/messages",
        "urlSuffix": "?beta=true",
        "headers": {
            "Anthropic-Version": "2023-06-01",
            "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
        },
        "quirks": {
            "dropOutputConfig": true,
            "requireClaudeToolType": true
        },
        "reasoningInject": {
            "scope": "all"
        },
        "auth": {
            "combined": true,
            "header": "x-api-key",
            "scheme": "raw"
        },
        "usage": {
            "urls": [
                "https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains",
                "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains"
            ]
        },
        "transports": [
            {
                "format": "openai",
                "baseUrl": "https://api.minimaxi.com/v1/chat/completions",
                "auth": {
                    "combined": true,
                    "header": "Authorization",
                    "scheme": "bearer"
                }
            },
            {
                "format": "claude",
                "baseUrl": "https://api.minimaxi.com/anthropic/v1/messages",
                "urlSuffix": "?beta=true",
                "headers": {
                    "Anthropic-Version": "2023-06-01",
                    "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
                },
                "auth": {
                    "combined": true,
                    "header": "x-api-key",
                    "scheme": "raw"
                }
            }
        ]
    },
    "mistral": {
        "format": "openai",
        "baseUrl": "https://api.mistral.ai/v1/chat/completions",
        "validateUrl": "https://api.mistral.ai/v1/models",
        "quirks": {
            "dropClientMetadata": true
        }
    },
    "nebius": {
        "format": "openai",
        "baseUrl": "https://api.studio.nebius.ai/v1/chat/completions",
        "validateUrl": "https://api.studio.nebius.ai/v1/models"
    },
    "nvidia": {
        "format": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "validateUrl": "https://integrate.api.nvidia.com/v1/models"
    },
    "ollama": {
        "format": "ollama",
        "baseUrl": "https://ollama.com/api/chat",
        "validateUrl": "https://ollama.com/api/tags"
    },
    "opencode-go": {
        "format": "openai",
        "baseUrl": "https://opencode.ai/zen/go/v1/chat/completions",
        "headers": {},
        "usage": {
            "url": "https://opencode.ai/zen/go/v1/usage"
        },
        "transports": [
            {
                "format": "openai",
                "baseUrl": "https://opencode.ai/zen/go/v1/chat/completions",
                "auth": {
                    "combined": true,
                    "header": "Authorization",
                    "scheme": "bearer"
                }
            },
            {
                "format": "claude",
                "baseUrl": "https://opencode.ai/zen/go/v1/messages",
                "auth": {
                    "combined": true,
                    "header": "x-api-key",
                    "scheme": "raw",
                    "anthropicVersion": true
                }
            },
            {
                "format": "openai-responses",
                "baseUrl": "https://opencode.ai/zen/go/v1/responses",
                "auth": {
                    "combined": true,
                    "header": "Authorization",
                    "scheme": "bearer"
                }
            }
        ]
    },
    "opencode-zen": {
        "format": "openai",
        "baseUrl": "https://opencode.ai/zen/v1/chat/completions",
        "headers": {},
        "usage": {
            "url": "https://opencode.ai/zen/v1/usage"
        },
        "transports": [
            {
                "format": "openai",
                "baseUrl": "https://opencode.ai/zen/v1/chat/completions",
                "auth": {
                    "combined": true,
                    "header": "Authorization",
                    "scheme": "bearer"
                }
            },
            {
                "format": "claude",
                "baseUrl": "https://opencode.ai/zen/v1/messages",
                "auth": {
                    "combined": true,
                    "header": "x-api-key",
                    "scheme": "raw",
                    "anthropicVersion": true
                }
            },
            {
                "format": "openai-responses",
                "baseUrl": "https://opencode.ai/zen/v1/responses",
                "auth": {
                    "combined": true,
                    "header": "Authorization",
                    "scheme": "bearer"
                }
            }
        ]
    },
    "perplexity": {
        "format": "openai",
        "baseUrl": "https://api.perplexity.ai/chat/completions",
        "validateUrl": "https://api.perplexity.ai/models"
    },
    "perplexity-agent": {
        "format": "openai-responses",
        "baseUrl": "https://api.perplexity.ai/v1/responses",
        "validateUrl": "https://api.perplexity.ai/v1/models"
    },
    "siliconflow": {
        "format": "openai",
        "baseUrl": "https://api.siliconflow.com/v1/chat/completions",
        "validateUrl": "https://api.siliconflow.com/v1/models",
        "thinkingFormat": "openai"
    },
    "together": {
        "format": "openai",
        "baseUrl": "https://api.together.xyz/v1/chat/completions",
        "validateUrl": "https://api.together.xyz/v1/models"
    },
    "venice": {
        "format": "openai",
        "baseUrl": "https://api.venice.ai/api/v1/chat/completions",
        "validateUrl": "https://api.venice.ai/api/v1/models",
        "thinkingFormat": "openai"
    },
    "vercel-ai-gateway": {
        "format": "openai",
        "baseUrl": "https://ai-gateway.vercel.sh/v1/chat/completions",
        "thinkingFormat": "openai",
        "retry": {
            "429": 2
        },
        "usage": {
            "url": "https://ai-gateway.vercel.sh/v1/credits"
        }
    },
    "vertex-partner": {
        "format": "openai",
        "baseUrl": "https://aiplatform.googleapis.com"
    },
    "vertex": {
        "format": "vertex",
        "baseUrl": "https://aiplatform.googleapis.com"
    },
    "volcengine-ark": {
        "format": "openai",
        "baseUrl": "https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions",
        "headers": {}
    },
    "alims-intl": {
        "format": "openai",
        "baseUrl": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
        "headers": {},
        "quirks": {
            "preserveCacheControl": true
        }
    },
    "api-airforce": {
        "format": "openai",
        "baseUrl": "https://api.airforce/v1/chat/completions",
        "validateUrl": "https://api.airforce/v1/models",
        "headers": {
            "HTTP-Referer": "https://endpoint-proxy.local",
            "X-Title": "Endpoint Proxy"
        },
        "forceStream": true
    },
    "baidu": {
        "format": "openai",
        "baseUrl": "https://qianfan.baidubce.com/v2/chat/completions",
        "validateUrl": "https://qianfan.baidubce.com/v2/models"
    },
    "bazaarlink": {
        "format": "openai",
        "baseUrl": "https://bazaarlink.ai/api/v1/chat/completions",
        "validateUrl": "https://bazaarlink.ai/api/v1/models"
    },
    "kilo-gateway": {
        "format": "openai",
        "baseUrl": "https://api.kilo.ai/api/gateway/chat/completions",
        "validateUrl": "https://api.kilo.ai/api/gateway/models"
    },
    "llm7": {
        "format": "openai",
        "baseUrl": "https://api.llm7.io/v1/chat/completions",
        "validateUrl": "https://api.llm7.io/v1/models"
    },
    "tencent": {
        "format": "openai",
        "baseUrl": "https://api.hunyuan.cloud.tencent.com/v1/chat/completions",
        "validateUrl": "https://api.hunyuan.cloud.tencent.com/v1/models"
    },
    "morph": {
        "format": "openai",
        "baseUrl": "https://api.morphllm.com/v1/chat/completions",
        "validateUrl": "https://api.morphllm.com/v1/models"
    },
    "poolside": {
        "format": "openai",
        "baseUrl": "https://inference.poolside.ai/v1/chat/completions",
        "validateUrl": "https://inference.poolside.ai/v1/models"
    },
    "tokenrouter": {
        "format": "openai",
        "baseUrl": "https://api.tokenrouter.com/v1/chat/completions",
        "validateUrl": "https://api.tokenrouter.com/v1/models",
        "thinkingFormat": "tokenrouter"
    },
    "alitp-intl": {
        "format": "openai",
        "baseUrl": "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
        "headers": {},
        "quirks": {
            "preserveCacheControl": true
        }
    },
    "opencode": {
        "format": "openai",
        "baseUrl": "https://opencode.ai",
        "headers": {
            "x-opencode-client": "desktop"
        },
        "forceStream": true,
        "noAuth": true,
        "quirks": {
            "forceAutoToolChoiceModels": [
                "muse-spark-1.3-contributor-free"
            ]
        }
    }
};
export const PROVIDER_MODELS: Record<string, ProviderModel[]> = {
    "gemini-cli": [
        {
            "id": "gemini-3.1-pro-preview",
            "name": "Gemini 3.1 Pro Preview"
        },
        {
            "id": "gemini-3-pro-preview",
            "name": "Gemini 3 Pro Preview"
        },
        {
            "id": "gemini-3-flash-preview",
            "name": "Gemini 3 Flash Preview"
        },
        {
            "id": "gemini-3.1-flash-lite-preview",
            "name": "Gemini 3.1 Flash Lite Preview"
        },
        {
            "id": "gemini-2.5-pro",
            "name": "Gemini 2.5 Pro"
        },
        {
            "id": "gemini-2.5-flash",
            "name": "Gemini 2.5 Flash"
        },
        {
            "id": "gemini-2.5-flash-lite",
            "name": "Gemini 2.5 Flash Lite"
        }
    ],
    "gc": [
        {
            "id": "gemini-3.1-pro-preview",
            "name": "Gemini 3.1 Pro Preview"
        },
        {
            "id": "gemini-3-pro-preview",
            "name": "Gemini 3 Pro Preview"
        },
        {
            "id": "gemini-3-flash-preview",
            "name": "Gemini 3 Flash Preview"
        },
        {
            "id": "gemini-3.1-flash-lite-preview",
            "name": "Gemini 3.1 Flash Lite Preview"
        },
        {
            "id": "gemini-2.5-pro",
            "name": "Gemini 2.5 Pro"
        },
        {
            "id": "gemini-2.5-flash",
            "name": "Gemini 2.5 Flash"
        },
        {
            "id": "gemini-2.5-flash-lite",
            "name": "Gemini 2.5 Flash Lite"
        }
    ],
    "github": [
        {
            "id": "gpt-5.2",
            "name": "GPT-5.2"
        },
        {
            "id": "gpt-5.2-codex",
            "name": "GPT-5.2 Codex"
        },
        {
            "id": "gpt-5.3-codex",
            "name": "GPT-5.3 Codex"
        },
        {
            "id": "gpt-5.4",
            "name": "GPT-5.4"
        },
        {
            "id": "gpt-5.4-mini",
            "name": "GPT-5.4 Mini"
        },
        {
            "id": "claude-haiku-4.5",
            "name": "Claude Haiku 4.5"
        },
        {
            "id": "claude-opus-4.5",
            "name": "Claude Opus 4.5"
        },
        {
            "id": "claude-sonnet-4.5",
            "name": "Claude Sonnet 4.5"
        },
        {
            "id": "claude-sonnet-4.6",
            "name": "Claude Sonnet 4.6"
        },
        {
            "id": "claude-opus-4.6",
            "name": "Claude Opus 4.6"
        },
        {
            "id": "claude-opus-4.7",
            "name": "Claude Opus 4.7"
        },
        {
            "id": "gemini-2.5-pro",
            "name": "Gemini 2.5 Pro"
        },
        {
            "id": "gemini-3-flash-preview",
            "name": "Gemini 3 Flash"
        },
        {
            "id": "gemini-3.1-pro-preview",
            "name": "Gemini 3.1 Pro"
        },
        {
            "id": "grok-code-fast-1",
            "name": "Grok Code Fast 1"
        },
        {
            "id": "oswe-vscode-prime",
            "name": "Raptor Mini"
        },
        {
            "id": "goldeneye-free-auto",
            "name": "GoldenEye"
        },
        {
            "id": "text-embedding-3-small",
            "name": "Text Embedding 3 Small (GitHub)",
            "kind": "embedding"
        },
        {
            "id": "text-embedding-3-large",
            "name": "Text Embedding 3 Large (GitHub)",
            "kind": "embedding"
        }
    ],
    "gh": [
        {
            "id": "gpt-5.2",
            "name": "GPT-5.2"
        },
        {
            "id": "gpt-5.2-codex",
            "name": "GPT-5.2 Codex"
        },
        {
            "id": "gpt-5.3-codex",
            "name": "GPT-5.3 Codex"
        },
        {
            "id": "gpt-5.4",
            "name": "GPT-5.4"
        },
        {
            "id": "gpt-5.4-mini",
            "name": "GPT-5.4 Mini"
        },
        {
            "id": "claude-haiku-4.5",
            "name": "Claude Haiku 4.5"
        },
        {
            "id": "claude-opus-4.5",
            "name": "Claude Opus 4.5"
        },
        {
            "id": "claude-sonnet-4.5",
            "name": "Claude Sonnet 4.5"
        },
        {
            "id": "claude-sonnet-4.6",
            "name": "Claude Sonnet 4.6"
        },
        {
            "id": "claude-opus-4.6",
            "name": "Claude Opus 4.6"
        },
        {
            "id": "claude-opus-4.7",
            "name": "Claude Opus 4.7"
        },
        {
            "id": "gemini-2.5-pro",
            "name": "Gemini 2.5 Pro"
        },
        {
            "id": "gemini-3-flash-preview",
            "name": "Gemini 3 Flash"
        },
        {
            "id": "gemini-3.1-pro-preview",
            "name": "Gemini 3.1 Pro"
        },
        {
            "id": "grok-code-fast-1",
            "name": "Grok Code Fast 1"
        },
        {
            "id": "oswe-vscode-prime",
            "name": "Raptor Mini"
        },
        {
            "id": "goldeneye-free-auto",
            "name": "GoldenEye"
        },
        {
            "id": "text-embedding-3-small",
            "name": "Text Embedding 3 Small (GitHub)",
            "kind": "embedding"
        },
        {
            "id": "text-embedding-3-large",
            "name": "Text Embedding 3 Large (GitHub)",
            "kind": "embedding"
        }
    ],
    "iflow": [
        {
            "id": "qwen3-coder-plus",
            "name": "Qwen3 Coder Plus"
        },
        {
            "id": "qwen3-max",
            "name": "Qwen3 Max"
        },
        {
            "id": "qwen3-vl-plus",
            "name": "Qwen3 VL Plus"
        },
        {
            "id": "qwen3-max-preview",
            "name": "Qwen3 Max Preview"
        },
        {
            "id": "qwen3-235b",
            "name": "Qwen3 235B A22B"
        },
        {
            "id": "qwen3-235b-a22b-instruct",
            "name": "Qwen3 235B A22B Instruct"
        },
        {
            "id": "qwen3-235b-a22b-thinking-2507",
            "name": "Qwen3 235B A22B Thinking"
        },
        {
            "id": "qwen3-32b",
            "name": "Qwen3 32B"
        },
        {
            "id": "kimi-k2",
            "name": "Kimi K2"
        },
        {
            "id": "deepseek-v3.2",
            "name": "DeepSeek V3.2 Exp"
        },
        {
            "id": "deepseek-v3.1",
            "name": "DeepSeek V3.1 Terminus"
        },
        {
            "id": "deepseek-v3",
            "name": "DeepSeek V3 671B"
        },
        {
            "id": "deepseek-r1",
            "name": "DeepSeek R1"
        },
        {
            "id": "glm-4.7",
            "name": "GLM 4.7"
        },
        {
            "id": "iflow-rome-30ba3b",
            "name": "iFlow ROME"
        }
    ],
    "if": [
        {
            "id": "qwen3-coder-plus",
            "name": "Qwen3 Coder Plus"
        },
        {
            "id": "qwen3-max",
            "name": "Qwen3 Max"
        },
        {
            "id": "qwen3-vl-plus",
            "name": "Qwen3 VL Plus"
        },
        {
            "id": "qwen3-max-preview",
            "name": "Qwen3 Max Preview"
        },
        {
            "id": "qwen3-235b",
            "name": "Qwen3 235B A22B"
        },
        {
            "id": "qwen3-235b-a22b-instruct",
            "name": "Qwen3 235B A22B Instruct"
        },
        {
            "id": "qwen3-235b-a22b-thinking-2507",
            "name": "Qwen3 235B A22B Thinking"
        },
        {
            "id": "qwen3-32b",
            "name": "Qwen3 32B"
        },
        {
            "id": "kimi-k2",
            "name": "Kimi K2"
        },
        {
            "id": "deepseek-v3.2",
            "name": "DeepSeek V3.2 Exp"
        },
        {
            "id": "deepseek-v3.1",
            "name": "DeepSeek V3.1 Terminus"
        },
        {
            "id": "deepseek-v3",
            "name": "DeepSeek V3 671B"
        },
        {
            "id": "deepseek-r1",
            "name": "DeepSeek R1"
        },
        {
            "id": "glm-4.7",
            "name": "GLM 4.7"
        },
        {
            "id": "iflow-rome-30ba3b",
            "name": "iFlow ROME"
        }
    ],
    "qoder": [
        {
            "id": "ultimate",
            "name": "Ultimate"
        },
        {
            "id": "auto",
            "name": "Auto"
        },
        {
            "id": "performance",
            "name": "Performance"
        },
        {
            "id": "efficient",
            "name": "Efficient"
        },
        {
            "id": "lite",
            "name": "Lite"
        },
        {
            "id": "qmodel_38max",
            "name": "Qwen3.8-Max"
        },
        {
            "id": "qmodel_latest",
            "name": "Qwen3.7-Max"
        },
        {
            "id": "qmodel",
            "name": "Qwen3.7-Plus"
        },
        {
            "id": "qfmodel",
            "name": "Qwen3.8-Flash"
        },
        {
            "id": "kmodel_latest",
            "name": "Kimi-K3"
        },
        {
            "id": "kmodel",
            "name": "Kimi-K2.7-Code"
        },
        {
            "id": "gmodel",
            "name": "GLM-5.3"
        },
        {
            "id": "gfmodel",
            "name": "GLM-5.3-Flash"
        },
        {
            "id": "dmodel",
            "name": "DeepSeek-V4-Pro"
        },
        {
            "id": "dfmodel",
            "name": "DeepSeek-V4-Flash"
        },
        {
            "id": "mmodel",
            "name": "MiniMax-M3"
        }
    ],
    "qd": [
        {
            "id": "ultimate",
            "name": "Ultimate"
        },
        {
            "id": "auto",
            "name": "Auto"
        },
        {
            "id": "performance",
            "name": "Performance"
        },
        {
            "id": "efficient",
            "name": "Efficient"
        },
        {
            "id": "lite",
            "name": "Lite"
        },
        {
            "id": "qmodel_38max",
            "name": "Qwen3.8-Max"
        },
        {
            "id": "qmodel_latest",
            "name": "Qwen3.7-Max"
        },
        {
            "id": "qmodel",
            "name": "Qwen3.7-Plus"
        },
        {
            "id": "qfmodel",
            "name": "Qwen3.8-Flash"
        },
        {
            "id": "kmodel_latest",
            "name": "Kimi-K3"
        },
        {
            "id": "kmodel",
            "name": "Kimi-K2.7-Code"
        },
        {
            "id": "gmodel",
            "name": "GLM-5.3"
        },
        {
            "id": "gfmodel",
            "name": "GLM-5.3-Flash"
        },
        {
            "id": "dmodel",
            "name": "DeepSeek-V4-Pro"
        },
        {
            "id": "dfmodel",
            "name": "DeepSeek-V4-Flash"
        },
        {
            "id": "mmodel",
            "name": "MiniMax-M3"
        }
    ],
    "qoder-cn": [
        {
            "id": "ultimate",
            "name": "Ultimate"
        },
        {
            "id": "auto",
            "name": "Auto"
        },
        {
            "id": "performance",
            "name": "Performance"
        },
        {
            "id": "efficient",
            "name": "Efficient"
        },
        {
            "id": "lite",
            "name": "Lite"
        },
        {
            "id": "qmodel_38max",
            "name": "Qwen3.8-Max"
        },
        {
            "id": "qmodel_latest",
            "name": "Qwen3.7-Max"
        },
        {
            "id": "qmodel",
            "name": "Qwen3.7-Plus"
        },
        {
            "id": "qfmodel",
            "name": "Qwen3.8-Flash"
        },
        {
            "id": "kmodel_latest",
            "name": "Kimi-K3"
        },
        {
            "id": "kmodel",
            "name": "Kimi-K2.7-Code"
        },
        {
            "id": "gmodel",
            "name": "GLM-5.3"
        },
        {
            "id": "gfmodel",
            "name": "GLM-5.3-Flash"
        },
        {
            "id": "dmodel",
            "name": "DeepSeek-V4-Pro"
        },
        {
            "id": "dfmodel",
            "name": "DeepSeek-V4-Flash"
        },
        {
            "id": "mmodel",
            "name": "MiniMax-M3"
        }
    ],
    "qdcn": [
        {
            "id": "ultimate",
            "name": "Ultimate"
        },
        {
            "id": "auto",
            "name": "Auto"
        },
        {
            "id": "performance",
            "name": "Performance"
        },
        {
            "id": "efficient",
            "name": "Efficient"
        },
        {
            "id": "lite",
            "name": "Lite"
        },
        {
            "id": "qmodel_38max",
            "name": "Qwen3.8-Max"
        },
        {
            "id": "qmodel_latest",
            "name": "Qwen3.7-Max"
        },
        {
            "id": "qmodel",
            "name": "Qwen3.7-Plus"
        },
        {
            "id": "qfmodel",
            "name": "Qwen3.8-Flash"
        },
        {
            "id": "kmodel_latest",
            "name": "Kimi-K3"
        },
        {
            "id": "kmodel",
            "name": "Kimi-K2.7-Code"
        },
        {
            "id": "gmodel",
            "name": "GLM-5.3"
        },
        {
            "id": "gfmodel",
            "name": "GLM-5.3-Flash"
        },
        {
            "id": "dmodel",
            "name": "DeepSeek-V4-Pro"
        },
        {
            "id": "dfmodel",
            "name": "DeepSeek-V4-Flash"
        },
        {
            "id": "mmodel",
            "name": "MiniMax-M3"
        }
    ],
    "kiro": [
        {
            "id": "claude-opus-5",
            "name": "Claude Opus 5"
        },
        {
            "id": "claude-opus-5-thinking",
            "name": "Claude Opus 5 (Thinking)"
        },
        {
            "id": "claude-opus-5-agentic",
            "name": "Claude Opus 5 (Agentic)"
        },
        {
            "id": "claude-opus-5-thinking-agentic",
            "name": "Claude Opus 5 (Thinking + Agentic)"
        },
        {
            "id": "claude-opus-4.8",
            "name": "Claude Opus 4.8"
        },
        {
            "id": "claude-opus-4.8-thinking",
            "name": "Claude Opus 4.8 (Thinking)"
        },
        {
            "id": "claude-opus-4.8-agentic",
            "name": "Claude Opus 4.8 (Agentic)"
        },
        {
            "id": "claude-opus-4.8-thinking-agentic",
            "name": "Claude Opus 4.8 (Thinking + Agentic)"
        },
        {
            "id": "claude-opus-4.7",
            "name": "Claude Opus 4.7"
        },
        {
            "id": "claude-opus-4.7-thinking",
            "name": "Claude Opus 4.7 (Thinking)"
        },
        {
            "id": "claude-opus-4.7-agentic",
            "name": "Claude Opus 4.7 (Agentic)"
        },
        {
            "id": "claude-opus-4.7-thinking-agentic",
            "name": "Claude Opus 4.7 (Thinking + Agentic)"
        },
        {
            "id": "claude-opus-4.5",
            "name": "Claude Opus 4.5"
        },
        {
            "id": "claude-opus-4.5-thinking",
            "name": "Claude Opus 4.5 (Thinking)"
        },
        {
            "id": "claude-opus-4.5-agentic",
            "name": "Claude Opus 4.5 (Agentic)"
        },
        {
            "id": "claude-opus-4.5-thinking-agentic",
            "name": "Claude Opus 4.5 (Thinking + Agentic)"
        },
        {
            "id": "claude-sonnet-5",
            "name": "Claude Sonnet 5"
        },
        {
            "id": "claude-sonnet-4.5",
            "name": "Claude Sonnet 4.5"
        },
        {
            "id": "claude-haiku-4.5",
            "name": "Claude Haiku 4.5"
        },
        {
            "id": "deepseek-3.2",
            "name": "DeepSeek 3.2",
            "strip": [
                "image",
                "audio"
            ]
        },
        {
            "id": "qwen3-coder-next",
            "name": "Qwen3 Coder Next",
            "strip": [
                "image",
                "audio"
            ]
        },
        {
            "id": "glm-5",
            "name": "GLM 5"
        },
        {
            "id": "MiniMax-M2.5",
            "name": "MiniMax M2.5"
        },
        {
            "id": "gpt-5.6-sol",
            "name": "GPT 5.6 Sol",
            "contextLength": 272000,
            "rateMultiplier": 2.4,
            "upstreamModelId": "gpt-5.6-sol",
            "description": "Experimental preview of OpenAI GPT 5.6 Sol with 272k context window"
        },
        {
            "id": "gpt-5.6-terra",
            "name": "GPT 5.6 Terra",
            "contextLength": 272000,
            "rateMultiplier": 1.2,
            "upstreamModelId": "gpt-5.6-terra",
            "description": "Experimental preview of OpenAI GPT 5.6 Terra with 272k context window"
        },
        {
            "id": "gpt-5.6-luna",
            "name": "GPT 5.6 Luna",
            "contextLength": 272000,
            "rateMultiplier": 0.6,
            "upstreamModelId": "gpt-5.6-luna",
            "description": "Experimental preview of OpenAI GPT 5.6 Luna with 272k context window"
        },
        {
            "id": "claude-sonnet-5-thinking",
            "name": "Claude Sonnet 5 (Thinking)"
        },
        {
            "id": "claude-sonnet-4.5-thinking",
            "name": "Claude Sonnet 4.5 (Thinking)"
        },
        {
            "id": "claude-haiku-4.5-thinking",
            "name": "Claude Haiku 4.5 (Thinking)"
        },
        {
            "id": "gpt-5.6-sol-thinking",
            "name": "GPT 5.6 Sol (Thinking)",
            "contextLength": 272000,
            "rateMultiplier": 2.4,
            "upstreamModelId": "gpt-5.6-sol",
            "description": "Experimental preview of OpenAI GPT 5.6 Sol with 272k context window"
        },
        {
            "id": "gpt-5.6-terra-thinking",
            "name": "GPT 5.6 Terra (Thinking)",
            "contextLength": 272000,
            "rateMultiplier": 1.2,
            "upstreamModelId": "gpt-5.6-terra",
            "description": "Experimental preview of OpenAI GPT 5.6 Terra with 272k context window"
        },
        {
            "id": "gpt-5.6-luna-thinking",
            "name": "GPT 5.6 Luna (Thinking)",
            "contextLength": 272000,
            "rateMultiplier": 0.6,
            "upstreamModelId": "gpt-5.6-luna",
            "description": "Experimental preview of OpenAI GPT 5.6 Luna with 272k context window"
        },
        {
            "id": "claude-sonnet-5-agentic",
            "name": "Claude Sonnet 5 (Agentic)"
        },
        {
            "id": "claude-sonnet-4.5-agentic",
            "name": "Claude Sonnet 4.5 (Agentic)"
        },
        {
            "id": "claude-haiku-4.5-agentic",
            "name": "Claude Haiku 4.5 (Agentic)"
        },
        {
            "id": "gpt-5.6-sol-agentic",
            "name": "GPT 5.6 Sol (Agentic)",
            "contextLength": 272000,
            "rateMultiplier": 2.4,
            "upstreamModelId": "gpt-5.6-sol",
            "description": "Experimental preview of OpenAI GPT 5.6 Sol with 272k context window"
        },
        {
            "id": "gpt-5.6-terra-agentic",
            "name": "GPT 5.6 Terra (Agentic)",
            "contextLength": 272000,
            "rateMultiplier": 1.2,
            "upstreamModelId": "gpt-5.6-terra",
            "description": "Experimental preview of OpenAI GPT 5.6 Terra with 272k context window"
        },
        {
            "id": "gpt-5.6-luna-agentic",
            "name": "GPT 5.6 Luna (Agentic)",
            "contextLength": 272000,
            "rateMultiplier": 0.6,
            "upstreamModelId": "gpt-5.6-luna",
            "description": "Experimental preview of OpenAI GPT 5.6 Luna with 272k context window"
        },
        {
            "id": "claude-sonnet-5-thinking-agentic",
            "name": "Claude Sonnet 5 (Thinking + Agentic)"
        },
        {
            "id": "claude-sonnet-4.5-thinking-agentic",
            "name": "Claude Sonnet 4.5 (Thinking + Agentic)"
        },
        {
            "id": "claude-haiku-4.5-thinking-agentic",
            "name": "Claude Haiku 4.5 (Thinking + Agentic)"
        },
        {
            "id": "gpt-5.6-sol-thinking-agentic",
            "name": "GPT 5.6 Sol (Thinking + Agentic)",
            "contextLength": 272000,
            "rateMultiplier": 2.4,
            "upstreamModelId": "gpt-5.6-sol",
            "description": "Experimental preview of OpenAI GPT 5.6 Sol with 272k context window"
        },
        {
            "id": "gpt-5.6-terra-thinking-agentic",
            "name": "GPT 5.6 Terra (Thinking + Agentic)",
            "contextLength": 272000,
            "rateMultiplier": 1.2,
            "upstreamModelId": "gpt-5.6-terra",
            "description": "Experimental preview of OpenAI GPT 5.6 Terra with 272k context window"
        },
        {
            "id": "gpt-5.6-luna-thinking-agentic",
            "name": "GPT 5.6 Luna (Thinking + Agentic)",
            "contextLength": 272000,
            "rateMultiplier": 0.6,
            "upstreamModelId": "gpt-5.6-luna",
            "description": "Experimental preview of OpenAI GPT 5.6 Luna with 272k context window"
        }
    ],
    "kr": [
        {
            "id": "claude-opus-5",
            "name": "Claude Opus 5"
        },
        {
            "id": "claude-opus-5-thinking",
            "name": "Claude Opus 5 (Thinking)"
        },
        {
            "id": "claude-opus-5-agentic",
            "name": "Claude Opus 5 (Agentic)"
        },
        {
            "id": "claude-opus-5-thinking-agentic",
            "name": "Claude Opus 5 (Thinking + Agentic)"
        },
        {
            "id": "claude-opus-4.8",
            "name": "Claude Opus 4.8"
        },
        {
            "id": "claude-opus-4.8-thinking",
            "name": "Claude Opus 4.8 (Thinking)"
        },
        {
            "id": "claude-opus-4.8-agentic",
            "name": "Claude Opus 4.8 (Agentic)"
        },
        {
            "id": "claude-opus-4.8-thinking-agentic",
            "name": "Claude Opus 4.8 (Thinking + Agentic)"
        },
        {
            "id": "claude-opus-4.7",
            "name": "Claude Opus 4.7"
        },
        {
            "id": "claude-opus-4.7-thinking",
            "name": "Claude Opus 4.7 (Thinking)"
        },
        {
            "id": "claude-opus-4.7-agentic",
            "name": "Claude Opus 4.7 (Agentic)"
        },
        {
            "id": "claude-opus-4.7-thinking-agentic",
            "name": "Claude Opus 4.7 (Thinking + Agentic)"
        },
        {
            "id": "claude-opus-4.5",
            "name": "Claude Opus 4.5"
        },
        {
            "id": "claude-opus-4.5-thinking",
            "name": "Claude Opus 4.5 (Thinking)"
        },
        {
            "id": "claude-opus-4.5-agentic",
            "name": "Claude Opus 4.5 (Agentic)"
        },
        {
            "id": "claude-opus-4.5-thinking-agentic",
            "name": "Claude Opus 4.5 (Thinking + Agentic)"
        },
        {
            "id": "claude-sonnet-5",
            "name": "Claude Sonnet 5"
        },
        {
            "id": "claude-sonnet-4.5",
            "name": "Claude Sonnet 4.5"
        },
        {
            "id": "claude-haiku-4.5",
            "name": "Claude Haiku 4.5"
        },
        {
            "id": "deepseek-3.2",
            "name": "DeepSeek 3.2",
            "strip": [
                "image",
                "audio"
            ]
        },
        {
            "id": "qwen3-coder-next",
            "name": "Qwen3 Coder Next",
            "strip": [
                "image",
                "audio"
            ]
        },
        {
            "id": "glm-5",
            "name": "GLM 5"
        },
        {
            "id": "MiniMax-M2.5",
            "name": "MiniMax M2.5"
        },
        {
            "id": "gpt-5.6-sol",
            "name": "GPT 5.6 Sol",
            "contextLength": 272000,
            "rateMultiplier": 2.4,
            "upstreamModelId": "gpt-5.6-sol",
            "description": "Experimental preview of OpenAI GPT 5.6 Sol with 272k context window"
        },
        {
            "id": "gpt-5.6-terra",
            "name": "GPT 5.6 Terra",
            "contextLength": 272000,
            "rateMultiplier": 1.2,
            "upstreamModelId": "gpt-5.6-terra",
            "description": "Experimental preview of OpenAI GPT 5.6 Terra with 272k context window"
        },
        {
            "id": "gpt-5.6-luna",
            "name": "GPT 5.6 Luna",
            "contextLength": 272000,
            "rateMultiplier": 0.6,
            "upstreamModelId": "gpt-5.6-luna",
            "description": "Experimental preview of OpenAI GPT 5.6 Luna with 272k context window"
        },
        {
            "id": "claude-sonnet-5-thinking",
            "name": "Claude Sonnet 5 (Thinking)"
        },
        {
            "id": "claude-sonnet-4.5-thinking",
            "name": "Claude Sonnet 4.5 (Thinking)"
        },
        {
            "id": "claude-haiku-4.5-thinking",
            "name": "Claude Haiku 4.5 (Thinking)"
        },
        {
            "id": "gpt-5.6-sol-thinking",
            "name": "GPT 5.6 Sol (Thinking)",
            "contextLength": 272000,
            "rateMultiplier": 2.4,
            "upstreamModelId": "gpt-5.6-sol",
            "description": "Experimental preview of OpenAI GPT 5.6 Sol with 272k context window"
        },
        {
            "id": "gpt-5.6-terra-thinking",
            "name": "GPT 5.6 Terra (Thinking)",
            "contextLength": 272000,
            "rateMultiplier": 1.2,
            "upstreamModelId": "gpt-5.6-terra",
            "description": "Experimental preview of OpenAI GPT 5.6 Terra with 272k context window"
        },
        {
            "id": "gpt-5.6-luna-thinking",
            "name": "GPT 5.6 Luna (Thinking)",
            "contextLength": 272000,
            "rateMultiplier": 0.6,
            "upstreamModelId": "gpt-5.6-luna",
            "description": "Experimental preview of OpenAI GPT 5.6 Luna with 272k context window"
        },
        {
            "id": "claude-sonnet-5-agentic",
            "name": "Claude Sonnet 5 (Agentic)"
        },
        {
            "id": "claude-sonnet-4.5-agentic",
            "name": "Claude Sonnet 4.5 (Agentic)"
        },
        {
            "id": "claude-haiku-4.5-agentic",
            "name": "Claude Haiku 4.5 (Agentic)"
        },
        {
            "id": "gpt-5.6-sol-agentic",
            "name": "GPT 5.6 Sol (Agentic)",
            "contextLength": 272000,
            "rateMultiplier": 2.4,
            "upstreamModelId": "gpt-5.6-sol",
            "description": "Experimental preview of OpenAI GPT 5.6 Sol with 272k context window"
        },
        {
            "id": "gpt-5.6-terra-agentic",
            "name": "GPT 5.6 Terra (Agentic)",
            "contextLength": 272000,
            "rateMultiplier": 1.2,
            "upstreamModelId": "gpt-5.6-terra",
            "description": "Experimental preview of OpenAI GPT 5.6 Terra with 272k context window"
        },
        {
            "id": "gpt-5.6-luna-agentic",
            "name": "GPT 5.6 Luna (Agentic)",
            "contextLength": 272000,
            "rateMultiplier": 0.6,
            "upstreamModelId": "gpt-5.6-luna",
            "description": "Experimental preview of OpenAI GPT 5.6 Luna with 272k context window"
        },
        {
            "id": "claude-sonnet-5-thinking-agentic",
            "name": "Claude Sonnet 5 (Thinking + Agentic)"
        },
        {
            "id": "claude-sonnet-4.5-thinking-agentic",
            "name": "Claude Sonnet 4.5 (Thinking + Agentic)"
        },
        {
            "id": "claude-haiku-4.5-thinking-agentic",
            "name": "Claude Haiku 4.5 (Thinking + Agentic)"
        },
        {
            "id": "gpt-5.6-sol-thinking-agentic",
            "name": "GPT 5.6 Sol (Thinking + Agentic)",
            "contextLength": 272000,
            "rateMultiplier": 2.4,
            "upstreamModelId": "gpt-5.6-sol",
            "description": "Experimental preview of OpenAI GPT 5.6 Sol with 272k context window"
        },
        {
            "id": "gpt-5.6-terra-thinking-agentic",
            "name": "GPT 5.6 Terra (Thinking + Agentic)",
            "contextLength": 272000,
            "rateMultiplier": 1.2,
            "upstreamModelId": "gpt-5.6-terra",
            "description": "Experimental preview of OpenAI GPT 5.6 Terra with 272k context window"
        },
        {
            "id": "gpt-5.6-luna-thinking-agentic",
            "name": "GPT 5.6 Luna (Thinking + Agentic)",
            "contextLength": 272000,
            "rateMultiplier": 0.6,
            "upstreamModelId": "gpt-5.6-luna",
            "description": "Experimental preview of OpenAI GPT 5.6 Luna with 272k context window"
        }
    ],
    "cursor": [
        {
            "id": "default",
            "name": "Auto (Server Picks)"
        },
        {
            "id": "claude-4.5-opus-high-thinking",
            "name": "Claude 4.5 Opus High Thinking"
        },
        {
            "id": "claude-4.5-opus-high",
            "name": "Claude 4.5 Opus High"
        },
        {
            "id": "claude-4.5-sonnet-thinking",
            "name": "Claude 4.5 Sonnet Thinking"
        },
        {
            "id": "claude-4.5-sonnet",
            "name": "Claude 4.5 Sonnet"
        },
        {
            "id": "claude-4.5-haiku",
            "name": "Claude 4.5 Haiku"
        },
        {
            "id": "claude-4.5-opus",
            "name": "Claude 4.5 Opus"
        },
        {
            "id": "gpt-5.2-codex",
            "name": "GPT 5.2 Codex"
        },
        {
            "id": "claude-4.6-opus-max",
            "name": "Claude 4.6 Opus Max"
        },
        {
            "id": "claude-4.6-sonnet-medium-thinking",
            "name": "Claude 4.6 Sonnet Medium Thinking"
        },
        {
            "id": "kimi-k2.5",
            "name": "Kimi K2.5"
        },
        {
            "id": "gemini-3-flash-preview",
            "name": "Gemini 3 Flash Preview"
        },
        {
            "id": "gpt-5.2",
            "name": "GPT 5.2"
        },
        {
            "id": "gpt-5.3-codex",
            "name": "GPT 5.3 Codex"
        }
    ],
    "cu": [
        {
            "id": "default",
            "name": "Auto (Server Picks)"
        },
        {
            "id": "claude-4.5-opus-high-thinking",
            "name": "Claude 4.5 Opus High Thinking"
        },
        {
            "id": "claude-4.5-opus-high",
            "name": "Claude 4.5 Opus High"
        },
        {
            "id": "claude-4.5-sonnet-thinking",
            "name": "Claude 4.5 Sonnet Thinking"
        },
        {
            "id": "claude-4.5-sonnet",
            "name": "Claude 4.5 Sonnet"
        },
        {
            "id": "claude-4.5-haiku",
            "name": "Claude 4.5 Haiku"
        },
        {
            "id": "claude-4.5-opus",
            "name": "Claude 4.5 Opus"
        },
        {
            "id": "gpt-5.2-codex",
            "name": "GPT 5.2 Codex"
        },
        {
            "id": "claude-4.6-opus-max",
            "name": "Claude 4.6 Opus Max"
        },
        {
            "id": "claude-4.6-sonnet-medium-thinking",
            "name": "Claude 4.6 Sonnet Medium Thinking"
        },
        {
            "id": "kimi-k2.5",
            "name": "Kimi K2.5"
        },
        {
            "id": "gemini-3-flash-preview",
            "name": "Gemini 3 Flash Preview"
        },
        {
            "id": "gpt-5.2",
            "name": "GPT 5.2"
        },
        {
            "id": "gpt-5.3-codex",
            "name": "GPT 5.3 Codex"
        }
    ],
    "grok-cli": [
        {
            "id": "grok-build",
            "name": "Grok Build",
            "contextLength": 500000,
            "maxOutputTokens": 64000
        },
        {
            "id": "grok-4.5",
            "name": "Grok 4.5"
        },
        {
            "id": "grok-4.5-high",
            "name": "Grok 4.5 (High)",
            "upstreamModelId": "grok-4.5"
        },
        {
            "id": "grok-4.5-medium",
            "name": "Grok 4.5 (Medium)",
            "upstreamModelId": "grok-4.5"
        },
        {
            "id": "grok-4.5-low",
            "name": "Grok 4.5 (Low)",
            "upstreamModelId": "grok-4.5"
        }
    ],
    "gcli": [
        {
            "id": "grok-build",
            "name": "Grok Build",
            "contextLength": 500000,
            "maxOutputTokens": 64000
        },
        {
            "id": "grok-4.5",
            "name": "Grok 4.5"
        },
        {
            "id": "grok-4.5-high",
            "name": "Grok 4.5 (High)",
            "upstreamModelId": "grok-4.5"
        },
        {
            "id": "grok-4.5-medium",
            "name": "Grok 4.5 (Medium)",
            "upstreamModelId": "grok-4.5"
        },
        {
            "id": "grok-4.5-low",
            "name": "Grok 4.5 (Low)",
            "upstreamModelId": "grok-4.5"
        }
    ],
    "codebuddy-cn": [
        {
            "id": "glm-5.2",
            "name": "GLM-5.2"
        },
        {
            "id": "glm-5.1",
            "name": "GLM-5.1"
        },
        {
            "id": "glm-5v-turbo",
            "name": "GLM-5v-Turbo"
        },
        {
            "id": "minimax-m3",
            "name": "MiniMax-M3"
        },
        {
            "id": "kimi-k2.7",
            "name": "Kimi-K2.7-Code"
        },
        {
            "id": "kimi-k2.6",
            "name": "Kimi-K2.6"
        },
        {
            "id": "hy3",
            "name": "Hy3"
        },
        {
            "id": "hy4-preview",
            "name": "Hy4-Preview"
        },
        {
            "id": "glm-5.3",
            "name": "GLM-5.3"
        },
        {
            "id": "glm-5.3-flash",
            "name": "GLM-5.3-Flash"
        },
        {
            "id": "kimi-k3-1",
            "name": "Kimi-K3"
        },
        {
            "id": "deepseek-v4-pro",
            "name": "DeepSeek-V4-Pro"
        },
        {
            "id": "deepseek-v4.1-flash",
            "name": "DeepSeek-V4.1-Flash"
        }
    ],
    "cbcn": [
        {
            "id": "glm-5.2",
            "name": "GLM-5.2"
        },
        {
            "id": "glm-5.1",
            "name": "GLM-5.1"
        },
        {
            "id": "glm-5v-turbo",
            "name": "GLM-5v-Turbo"
        },
        {
            "id": "minimax-m3",
            "name": "MiniMax-M3"
        },
        {
            "id": "kimi-k2.7",
            "name": "Kimi-K2.7-Code"
        },
        {
            "id": "kimi-k2.6",
            "name": "Kimi-K2.6"
        },
        {
            "id": "hy3",
            "name": "Hy3"
        },
        {
            "id": "hy4-preview",
            "name": "Hy4-Preview"
        },
        {
            "id": "glm-5.3",
            "name": "GLM-5.3"
        },
        {
            "id": "glm-5.3-flash",
            "name": "GLM-5.3-Flash"
        },
        {
            "id": "kimi-k3-1",
            "name": "Kimi-K3"
        },
        {
            "id": "deepseek-v4-pro",
            "name": "DeepSeek-V4-Pro"
        },
        {
            "id": "deepseek-v4.1-flash",
            "name": "DeepSeek-V4.1-Flash"
        }
    ],
    "codebuddy-intl": [
        {
            "id": "glm-5.2",
            "name": "GLM-5.2"
        },
        {
            "id": "glm-5.1",
            "name": "GLM-5.1"
        },
        {
            "id": "glm-5.0",
            "name": "GLM-5.0"
        },
        {
            "id": "glm-5.0-turbo",
            "name": "GLM-5.0-Turbo"
        },
        {
            "id": "glm-5v-turbo",
            "name": "GLM-5v-Turbo"
        },
        {
            "id": "glm-4.7",
            "name": "GLM-4.7"
        },
        {
            "id": "minimax-m3",
            "name": "MiniMax-M3"
        },
        {
            "id": "minimax-m2.7",
            "name": "MiniMax-M2.7"
        },
        {
            "id": "kimi-k2.7",
            "name": "Kimi-K2.7-Code"
        },
        {
            "id": "kimi-k2.6",
            "name": "Kimi-K2.6"
        },
        {
            "id": "kimi-k2.5",
            "name": "Kimi-K2.5"
        },
        {
            "id": "hy3-preview",
            "name": "Hy3 Preview"
        },
        {
            "id": "deepseek-v4-pro",
            "name": "DeepSeek-V4-Pro"
        },
        {
            "id": "deepseek-v4.1-flash",
            "name": "DeepSeek-V4.1-Flash"
        },
        {
            "id": "deepseek-v3-2-volc",
            "name": "DeepSeek-V3.2"
        }
    ],
    "cbai": [
        {
            "id": "glm-5.2",
            "name": "GLM-5.2"
        },
        {
            "id": "glm-5.1",
            "name": "GLM-5.1"
        },
        {
            "id": "glm-5.0",
            "name": "GLM-5.0"
        },
        {
            "id": "glm-5.0-turbo",
            "name": "GLM-5.0-Turbo"
        },
        {
            "id": "glm-5v-turbo",
            "name": "GLM-5v-Turbo"
        },
        {
            "id": "glm-4.7",
            "name": "GLM-4.7"
        },
        {
            "id": "minimax-m3",
            "name": "MiniMax-M3"
        },
        {
            "id": "minimax-m2.7",
            "name": "MiniMax-M2.7"
        },
        {
            "id": "kimi-k2.7",
            "name": "Kimi-K2.7-Code"
        },
        {
            "id": "kimi-k2.6",
            "name": "Kimi-K2.6"
        },
        {
            "id": "kimi-k2.5",
            "name": "Kimi-K2.5"
        },
        {
            "id": "hy3-preview",
            "name": "Hy3 Preview"
        },
        {
            "id": "deepseek-v4-pro",
            "name": "DeepSeek-V4-Pro"
        },
        {
            "id": "deepseek-v4.1-flash",
            "name": "DeepSeek-V4.1-Flash"
        },
        {
            "id": "deepseek-v3-2-volc",
            "name": "DeepSeek-V3.2"
        }
    ],
    "trae": [
        {
            "id": "auto",
            "name": "Auto (Server Picks)"
        },
        {
            "id": "work",
            "name": "Work (Fast)"
        },
        {
            "id": "gemini-3.1-pro",
            "name": "Gemini 3.1 Pro"
        },
        {
            "id": "gemini-3-flash-solo",
            "name": "Gemini 3 Flash"
        },
        {
            "id": "minimax-m3",
            "name": "MiniMax M3"
        },
        {
            "id": "minimax-m2.7",
            "name": "MiniMax M2.7"
        },
        {
            "id": "kimi-k2.5",
            "name": "Kimi K2.5"
        },
        {
            "id": "gpt-5.4",
            "name": "GPT 5.4"
        },
        {
            "id": "gpt-5.2",
            "name": "GPT 5.2"
        }
    ],
    "tr": [
        {
            "id": "auto",
            "name": "Auto (Server Picks)"
        },
        {
            "id": "work",
            "name": "Work (Fast)"
        },
        {
            "id": "gemini-3.1-pro",
            "name": "Gemini 3.1 Pro"
        },
        {
            "id": "gemini-3-flash-solo",
            "name": "Gemini 3 Flash"
        },
        {
            "id": "minimax-m3",
            "name": "MiniMax M3"
        },
        {
            "id": "minimax-m2.7",
            "name": "MiniMax M2.7"
        },
        {
            "id": "kimi-k2.5",
            "name": "Kimi K2.5"
        },
        {
            "id": "gpt-5.4",
            "name": "GPT 5.4"
        },
        {
            "id": "gpt-5.2",
            "name": "GPT 5.2"
        }
    ],
    "zed": [],
    "zd": [],
    "windsurf": [
        {
            "id": "swe-1.6-fast",
            "name": "SWE-1.6 Fast"
        },
        {
            "id": "swe-1.6",
            "name": "SWE-1.6"
        },
        {
            "id": "swe-1.5-fast",
            "name": "SWE-1.5 Fast"
        },
        {
            "id": "swe-1.5",
            "name": "SWE-1.5"
        },
        {
            "id": "claude-opus-4.7-max",
            "name": "Claude Opus 4.7 Max"
        },
        {
            "id": "claude-opus-4.7-xhigh",
            "name": "Claude Opus 4.7 XHigh"
        },
        {
            "id": "claude-opus-4.7-high",
            "name": "Claude Opus 4.7 High"
        },
        {
            "id": "claude-opus-4.7-medium",
            "name": "Claude Opus 4.7 Medium"
        },
        {
            "id": "claude-opus-4.7-low",
            "name": "Claude Opus 4.7 Low"
        },
        {
            "id": "claude-opus-4.7-review",
            "name": "Claude Opus 4.7 Review"
        },
        {
            "id": "claude-sonnet-4.6-thinking-1m",
            "name": "Claude Sonnet 4.6 Thinking 1M"
        },
        {
            "id": "claude-sonnet-4.6-1m",
            "name": "Claude Sonnet 4.6 1M"
        },
        {
            "id": "claude-sonnet-4.6-thinking",
            "name": "Claude Sonnet 4.6 Thinking"
        },
        {
            "id": "claude-sonnet-4.6",
            "name": "Claude Sonnet 4.6"
        },
        {
            "id": "claude-opus-4.6-thinking",
            "name": "Claude Opus 4.6 Thinking"
        },
        {
            "id": "claude-opus-4.6",
            "name": "Claude Opus 4.6"
        },
        {
            "id": "claude-opus-4.5-thinking",
            "name": "Claude Opus 4.5 Thinking"
        },
        {
            "id": "claude-opus-4.5",
            "name": "Claude Opus 4.5"
        },
        {
            "id": "claude-sonnet-4.5-thinking",
            "name": "Claude Sonnet 4.5 Thinking"
        },
        {
            "id": "claude-sonnet-4.5",
            "name": "Claude Sonnet 4.5"
        },
        {
            "id": "claude-haiku-4.5",
            "name": "Claude Haiku 4.5"
        },
        {
            "id": "gpt-5.5-xhigh-fast",
            "name": "GPT-5.5 XHigh Fast"
        },
        {
            "id": "gpt-5.5-xhigh",
            "name": "GPT-5.5 XHigh"
        },
        {
            "id": "gpt-5.5-high-fast",
            "name": "GPT-5.5 High Fast"
        },
        {
            "id": "gpt-5.5-high",
            "name": "GPT-5.5 High"
        },
        {
            "id": "gpt-5.5-medium-fast",
            "name": "GPT-5.5 Medium Fast"
        },
        {
            "id": "gpt-5.5-medium",
            "name": "GPT-5.5 Medium"
        },
        {
            "id": "gpt-5.5-low-fast",
            "name": "GPT-5.5 Low Fast"
        },
        {
            "id": "gpt-5.5-low",
            "name": "GPT-5.5 Low"
        },
        {
            "id": "gpt-5.5-none-fast",
            "name": "GPT-5.5 None Fast"
        },
        {
            "id": "gpt-5.5-none",
            "name": "GPT-5.5 None"
        },
        {
            "id": "gpt-5.4-xhigh-fast",
            "name": "GPT-5.4 XHigh Fast"
        },
        {
            "id": "gpt-5.4-xhigh",
            "name": "GPT-5.4 XHigh"
        },
        {
            "id": "gpt-5.4-high-fast",
            "name": "GPT-5.4 High Fast"
        },
        {
            "id": "gpt-5.4-high",
            "name": "GPT-5.4 High"
        },
        {
            "id": "gpt-5.4-medium-fast",
            "name": "GPT-5.4 Medium Fast"
        },
        {
            "id": "gpt-5.4-medium",
            "name": "GPT-5.4 Medium"
        },
        {
            "id": "gpt-5.4-low-fast",
            "name": "GPT-5.4 Low Fast"
        },
        {
            "id": "gpt-5.4-low",
            "name": "GPT-5.4 Low"
        },
        {
            "id": "gpt-5.4-none-fast",
            "name": "GPT-5.4 None Fast"
        },
        {
            "id": "gpt-5.4-none",
            "name": "GPT-5.4 None"
        },
        {
            "id": "gpt-5.4-mini-xhigh",
            "name": "GPT-5.4 Mini XHigh"
        },
        {
            "id": "gpt-5.4-mini-high",
            "name": "GPT-5.4 Mini High"
        },
        {
            "id": "gpt-5.4-mini-medium",
            "name": "GPT-5.4 Mini Medium"
        },
        {
            "id": "gpt-5.4-mini-low",
            "name": "GPT-5.4 Mini Low"
        },
        {
            "id": "gpt-5.3-codex-xhigh-fast",
            "name": "GPT-5.3 Codex XHigh Fast"
        },
        {
            "id": "gpt-5.3-codex-xhigh",
            "name": "GPT-5.3 Codex XHigh"
        },
        {
            "id": "gpt-5.3-codex-high-fast",
            "name": "GPT-5.3 Codex High Fast"
        },
        {
            "id": "gpt-5.3-codex-high",
            "name": "GPT-5.3 Codex High"
        },
        {
            "id": "gpt-5.3-codex-medium-fast",
            "name": "GPT-5.3 Codex Medium Fast"
        },
        {
            "id": "gpt-5.3-codex-medium",
            "name": "GPT-5.3 Codex Medium"
        },
        {
            "id": "gpt-5.3-codex-low-fast",
            "name": "GPT-5.3 Codex Low Fast"
        },
        {
            "id": "gpt-5.3-codex-low",
            "name": "GPT-5.3 Codex Low"
        },
        {
            "id": "gpt-5.2-xhigh",
            "name": "GPT-5.2 XHigh"
        },
        {
            "id": "gpt-5.2-high",
            "name": "GPT-5.2 High"
        },
        {
            "id": "gpt-5.2-medium",
            "name": "GPT-5.2 Medium"
        },
        {
            "id": "gpt-5.2-low",
            "name": "GPT-5.2 Low"
        },
        {
            "id": "gpt-5.2-none",
            "name": "GPT-5.2 None"
        },
        {
            "id": "gpt-5",
            "name": "GPT-5"
        },
        {
            "id": "gpt-4.1",
            "name": "GPT-4.1"
        },
        {
            "id": "gpt-4.1-mini",
            "name": "GPT-4.1 Mini"
        },
        {
            "id": "gpt-4.1-nano",
            "name": "GPT-4.1 Nano"
        },
        {
            "id": "gpt-4o",
            "name": "GPT-4o"
        },
        {
            "id": "gpt-4o-mini",
            "name": "GPT-4o Mini"
        },
        {
            "id": "gemini-3.1-pro-high",
            "name": "Gemini 3.1 Pro High"
        },
        {
            "id": "gemini-3.1-pro-low",
            "name": "Gemini 3.1 Pro Low"
        },
        {
            "id": "gemini-3.0-flash-high",
            "name": "Gemini 3 Flash High"
        },
        {
            "id": "gemini-3.0-flash-medium",
            "name": "Gemini 3 Flash Medium"
        },
        {
            "id": "gemini-3.0-flash-low",
            "name": "Gemini 3 Flash Low"
        },
        {
            "id": "gemini-3.0-flash-minimal",
            "name": "Gemini 3 Flash Minimal"
        },
        {
            "id": "gemini-2.5-pro",
            "name": "Gemini 2.5 Pro"
        },
        {
            "id": "deepseek-v4",
            "name": "DeepSeek V4"
        },
        {
            "id": "kimi-k2.6",
            "name": "Kimi K2.6"
        },
        {
            "id": "kimi-k2.5",
            "name": "Kimi K2.5"
        },
        {
            "id": "glm-5.1",
            "name": "GLM-5.1"
        }
    ],
    "ws": [
        {
            "id": "swe-1.6-fast",
            "name": "SWE-1.6 Fast"
        },
        {
            "id": "swe-1.6",
            "name": "SWE-1.6"
        },
        {
            "id": "swe-1.5-fast",
            "name": "SWE-1.5 Fast"
        },
        {
            "id": "swe-1.5",
            "name": "SWE-1.5"
        },
        {
            "id": "claude-opus-4.7-max",
            "name": "Claude Opus 4.7 Max"
        },
        {
            "id": "claude-opus-4.7-xhigh",
            "name": "Claude Opus 4.7 XHigh"
        },
        {
            "id": "claude-opus-4.7-high",
            "name": "Claude Opus 4.7 High"
        },
        {
            "id": "claude-opus-4.7-medium",
            "name": "Claude Opus 4.7 Medium"
        },
        {
            "id": "claude-opus-4.7-low",
            "name": "Claude Opus 4.7 Low"
        },
        {
            "id": "claude-opus-4.7-review",
            "name": "Claude Opus 4.7 Review"
        },
        {
            "id": "claude-sonnet-4.6-thinking-1m",
            "name": "Claude Sonnet 4.6 Thinking 1M"
        },
        {
            "id": "claude-sonnet-4.6-1m",
            "name": "Claude Sonnet 4.6 1M"
        },
        {
            "id": "claude-sonnet-4.6-thinking",
            "name": "Claude Sonnet 4.6 Thinking"
        },
        {
            "id": "claude-sonnet-4.6",
            "name": "Claude Sonnet 4.6"
        },
        {
            "id": "claude-opus-4.6-thinking",
            "name": "Claude Opus 4.6 Thinking"
        },
        {
            "id": "claude-opus-4.6",
            "name": "Claude Opus 4.6"
        },
        {
            "id": "claude-opus-4.5-thinking",
            "name": "Claude Opus 4.5 Thinking"
        },
        {
            "id": "claude-opus-4.5",
            "name": "Claude Opus 4.5"
        },
        {
            "id": "claude-sonnet-4.5-thinking",
            "name": "Claude Sonnet 4.5 Thinking"
        },
        {
            "id": "claude-sonnet-4.5",
            "name": "Claude Sonnet 4.5"
        },
        {
            "id": "claude-haiku-4.5",
            "name": "Claude Haiku 4.5"
        },
        {
            "id": "gpt-5.5-xhigh-fast",
            "name": "GPT-5.5 XHigh Fast"
        },
        {
            "id": "gpt-5.5-xhigh",
            "name": "GPT-5.5 XHigh"
        },
        {
            "id": "gpt-5.5-high-fast",
            "name": "GPT-5.5 High Fast"
        },
        {
            "id": "gpt-5.5-high",
            "name": "GPT-5.5 High"
        },
        {
            "id": "gpt-5.5-medium-fast",
            "name": "GPT-5.5 Medium Fast"
        },
        {
            "id": "gpt-5.5-medium",
            "name": "GPT-5.5 Medium"
        },
        {
            "id": "gpt-5.5-low-fast",
            "name": "GPT-5.5 Low Fast"
        },
        {
            "id": "gpt-5.5-low",
            "name": "GPT-5.5 Low"
        },
        {
            "id": "gpt-5.5-none-fast",
            "name": "GPT-5.5 None Fast"
        },
        {
            "id": "gpt-5.5-none",
            "name": "GPT-5.5 None"
        },
        {
            "id": "gpt-5.4-xhigh-fast",
            "name": "GPT-5.4 XHigh Fast"
        },
        {
            "id": "gpt-5.4-xhigh",
            "name": "GPT-5.4 XHigh"
        },
        {
            "id": "gpt-5.4-high-fast",
            "name": "GPT-5.4 High Fast"
        },
        {
            "id": "gpt-5.4-high",
            "name": "GPT-5.4 High"
        },
        {
            "id": "gpt-5.4-medium-fast",
            "name": "GPT-5.4 Medium Fast"
        },
        {
            "id": "gpt-5.4-medium",
            "name": "GPT-5.4 Medium"
        },
        {
            "id": "gpt-5.4-low-fast",
            "name": "GPT-5.4 Low Fast"
        },
        {
            "id": "gpt-5.4-low",
            "name": "GPT-5.4 Low"
        },
        {
            "id": "gpt-5.4-none-fast",
            "name": "GPT-5.4 None Fast"
        },
        {
            "id": "gpt-5.4-none",
            "name": "GPT-5.4 None"
        },
        {
            "id": "gpt-5.4-mini-xhigh",
            "name": "GPT-5.4 Mini XHigh"
        },
        {
            "id": "gpt-5.4-mini-high",
            "name": "GPT-5.4 Mini High"
        },
        {
            "id": "gpt-5.4-mini-medium",
            "name": "GPT-5.4 Mini Medium"
        },
        {
            "id": "gpt-5.4-mini-low",
            "name": "GPT-5.4 Mini Low"
        },
        {
            "id": "gpt-5.3-codex-xhigh-fast",
            "name": "GPT-5.3 Codex XHigh Fast"
        },
        {
            "id": "gpt-5.3-codex-xhigh",
            "name": "GPT-5.3 Codex XHigh"
        },
        {
            "id": "gpt-5.3-codex-high-fast",
            "name": "GPT-5.3 Codex High Fast"
        },
        {
            "id": "gpt-5.3-codex-high",
            "name": "GPT-5.3 Codex High"
        },
        {
            "id": "gpt-5.3-codex-medium-fast",
            "name": "GPT-5.3 Codex Medium Fast"
        },
        {
            "id": "gpt-5.3-codex-medium",
            "name": "GPT-5.3 Codex Medium"
        },
        {
            "id": "gpt-5.3-codex-low-fast",
            "name": "GPT-5.3 Codex Low Fast"
        },
        {
            "id": "gpt-5.3-codex-low",
            "name": "GPT-5.3 Codex Low"
        },
        {
            "id": "gpt-5.2-xhigh",
            "name": "GPT-5.2 XHigh"
        },
        {
            "id": "gpt-5.2-high",
            "name": "GPT-5.2 High"
        },
        {
            "id": "gpt-5.2-medium",
            "name": "GPT-5.2 Medium"
        },
        {
            "id": "gpt-5.2-low",
            "name": "GPT-5.2 Low"
        },
        {
            "id": "gpt-5.2-none",
            "name": "GPT-5.2 None"
        },
        {
            "id": "gpt-5",
            "name": "GPT-5"
        },
        {
            "id": "gpt-4.1",
            "name": "GPT-4.1"
        },
        {
            "id": "gpt-4.1-mini",
            "name": "GPT-4.1 Mini"
        },
        {
            "id": "gpt-4.1-nano",
            "name": "GPT-4.1 Nano"
        },
        {
            "id": "gpt-4o",
            "name": "GPT-4o"
        },
        {
            "id": "gpt-4o-mini",
            "name": "GPT-4o Mini"
        },
        {
            "id": "gemini-3.1-pro-high",
            "name": "Gemini 3.1 Pro High"
        },
        {
            "id": "gemini-3.1-pro-low",
            "name": "Gemini 3.1 Pro Low"
        },
        {
            "id": "gemini-3.0-flash-high",
            "name": "Gemini 3 Flash High"
        },
        {
            "id": "gemini-3.0-flash-medium",
            "name": "Gemini 3 Flash Medium"
        },
        {
            "id": "gemini-3.0-flash-low",
            "name": "Gemini 3 Flash Low"
        },
        {
            "id": "gemini-3.0-flash-minimal",
            "name": "Gemini 3 Flash Minimal"
        },
        {
            "id": "gemini-2.5-pro",
            "name": "Gemini 2.5 Pro"
        },
        {
            "id": "deepseek-v4",
            "name": "DeepSeek V4"
        },
        {
            "id": "kimi-k2.6",
            "name": "Kimi K2.6"
        },
        {
            "id": "kimi-k2.5",
            "name": "Kimi K2.5"
        },
        {
            "id": "glm-5.1",
            "name": "GLM-5.1"
        }
    ],
    "cline": [
        {
            "id": "anthropic/claude-opus-4.7",
            "name": "Claude Opus 4.7"
        },
        {
            "id": "anthropic/claude-sonnet-4.6",
            "name": "Claude Sonnet 4.6"
        },
        {
            "id": "anthropic/claude-opus-4.6",
            "name": "Claude Opus 4.6"
        },
        {
            "id": "openai/gpt-5.3-codex",
            "name": "GPT-5.3 Codex"
        },
        {
            "id": "openai/gpt-5.4",
            "name": "GPT-5.4"
        },
        {
            "id": "google/gemini-3.1-pro-preview",
            "name": "Gemini 3.1 Pro Preview"
        },
        {
            "id": "google/gemini-3.1-flash-lite-preview",
            "name": "Gemini 3.1 Flash Lite Preview"
        },
        {
            "id": "kwaipilot/kat-coder-pro",
            "name": "KAT Coder Pro"
        }
    ],
    "cl": [
        {
            "id": "anthropic/claude-opus-4.7",
            "name": "Claude Opus 4.7"
        },
        {
            "id": "anthropic/claude-sonnet-4.6",
            "name": "Claude Sonnet 4.6"
        },
        {
            "id": "anthropic/claude-opus-4.6",
            "name": "Claude Opus 4.6"
        },
        {
            "id": "openai/gpt-5.3-codex",
            "name": "GPT-5.3 Codex"
        },
        {
            "id": "openai/gpt-5.4",
            "name": "GPT-5.4"
        },
        {
            "id": "google/gemini-3.1-pro-preview",
            "name": "Gemini 3.1 Pro Preview"
        },
        {
            "id": "google/gemini-3.1-flash-lite-preview",
            "name": "Gemini 3.1 Flash Lite Preview"
        },
        {
            "id": "kwaipilot/kat-coder-pro",
            "name": "KAT Coder Pro"
        }
    ],
    "clinepass": [
        {
            "id": "cline-pass/glm-5.2",
            "name": "GLM-5.2 (ClinePass)"
        },
        {
            "id": "cline-pass/kimi-k2.7-code",
            "name": "Kimi K2.7 Code (ClinePass)"
        },
        {
            "id": "cline-pass/kimi-k2.6",
            "name": "Kimi K2.6 (ClinePass)"
        },
        {
            "id": "cline-pass/deepseek-v4-pro",
            "name": "DeepSeek V4 Pro (ClinePass)"
        },
        {
            "id": "cline-pass/deepseek-v4-flash",
            "name": "DeepSeek V4 Flash (ClinePass)"
        },
        {
            "id": "cline-pass/mimo-v2.5",
            "name": "MiMo-V2.5 (ClinePass)"
        },
        {
            "id": "cline-pass/mimo-v2.5-pro",
            "name": "MiMo-V2.5-Pro (ClinePass)"
        },
        {
            "id": "cline-pass/minimax-m3",
            "name": "MiniMax M3 (ClinePass)"
        },
        {
            "id": "cline-pass/qwen3.7-max",
            "name": "Qwen3.7 Max (ClinePass)"
        },
        {
            "id": "cline-pass/qwen3.7-plus",
            "name": "Qwen3.7 Plus (ClinePass)"
        }
    ],
    "kilocode": [
        {
            "id": "anthropic/claude-sonnet-4-20250514",
            "name": "Claude Sonnet 4"
        },
        {
            "id": "anthropic/claude-opus-4-20250514",
            "name": "Claude Opus 4"
        },
        {
            "id": "google/gemini-2.5-pro",
            "name": "Gemini 2.5 Pro"
        },
        {
            "id": "google/gemini-2.5-flash",
            "name": "Gemini 2.5 Flash"
        },
        {
            "id": "openai/gpt-4.1",
            "name": "GPT-4.1"
        },
        {
            "id": "openai/o3",
            "name": "o3"
        },
        {
            "id": "deepseek/deepseek-chat",
            "name": "DeepSeek Chat"
        },
        {
            "id": "deepseek/deepseek-reasoner",
            "name": "DeepSeek Reasoner"
        }
    ],
    "kc": [
        {
            "id": "anthropic/claude-sonnet-4-20250514",
            "name": "Claude Sonnet 4"
        },
        {
            "id": "anthropic/claude-opus-4-20250514",
            "name": "Claude Opus 4"
        },
        {
            "id": "google/gemini-2.5-pro",
            "name": "Gemini 2.5 Pro"
        },
        {
            "id": "google/gemini-2.5-flash",
            "name": "Gemini 2.5 Flash"
        },
        {
            "id": "openai/gpt-4.1",
            "name": "GPT-4.1"
        },
        {
            "id": "openai/o3",
            "name": "o3"
        },
        {
            "id": "deepseek/deepseek-chat",
            "name": "DeepSeek Chat"
        },
        {
            "id": "deepseek/deepseek-reasoner",
            "name": "DeepSeek Reasoner"
        }
    ],
    "kimi": [
        {
            "id": "kimi-k3",
            "name": "Kimi K3"
        },
        {
            "id": "k3",
            "name": "Kimi K3 (Code)"
        },
        {
            "id": "kimi-for-coding",
            "name": "Kimi for Coding"
        },
        {
            "id": "kimi-for-coding-highspeed",
            "name": "Kimi for Coding Highspeed"
        },
        {
            "id": "kimi-k2.7-code",
            "name": "Kimi K2.7 Code"
        },
        {
            "id": "kimi-k2.7-code-highspeed",
            "name": "Kimi K2.7 Code Highspeed"
        },
        {
            "id": "kimi-k2.6",
            "name": "Kimi K2.6"
        },
        {
            "id": "kimi-k2.5",
            "name": "Kimi K2.5"
        },
        {
            "id": "kimi-k2.5-thinking",
            "name": "Kimi K2.5 Thinking"
        },
        {
            "id": "kimi-latest",
            "name": "Kimi Latest"
        }
    ],
    "xiaomi-mimo": [
        {
            "id": "mimo-v2.6-pro",
            "name": "MiMo V2.6 Pro",
            "upstreamModelId": "xiaomi/mimo-v2.6-pro",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "mimo-v2.6-flash",
            "name": "MiMo V2.6 Flash",
            "upstreamModelId": "xiaomi/mimo-v2.6-flash",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "mimo-v2.6-pro-ultraspeed",
            "name": "MiMo V2.6 Pro UltraSpeed",
            "upstreamModelId": "xiaomi/mimo-v2.6-pro-ultraspeed",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "mimo-v2.5-pro",
            "name": "MiMo V2.5 Pro"
        },
        {
            "id": "mimo-v2.5",
            "name": "MiMo V2.5"
        },
        {
            "id": "mimo-v2-omni",
            "name": "MiMo V2 Omni"
        },
        {
            "id": "mimo-v2-flash",
            "name": "MiMo V2 Flash"
        },
        {
            "id": "mimo-v2.5-tts",
            "name": "MiMo V2.5 TTS",
            "kind": "tts"
        }
    ],
    "xai": [
        {
            "id": "grok-4.6",
            "name": "Grok 4.6"
        },
        {
            "id": "grok-4.5",
            "name": "Grok 4.5"
        },
        {
            "id": "grok-4",
            "name": "Grok 4"
        },
        {
            "id": "grok-4-fast-reasoning",
            "name": "Grok 4 Fast Reasoning"
        },
        {
            "id": "grok-code-fast-1",
            "name": "Grok Code Fast"
        },
        {
            "id": "grok-3",
            "name": "Grok 3"
        },
        {
            "id": "grok-2-image-1212",
            "name": "Grok 2 Image",
            "params": [
                "n",
                "response_format"
            ],
            "kind": "image"
        },
        {
            "id": "grok-imagine-video",
            "name": "Grok Imagine Video",
            "params": [
                "duration",
                "aspect_ratio",
                "resolution"
            ],
            "kind": "video"
        }
    ],
    "gitlab": [],
    "kimchi": [
        {
            "id": "minimax-m3",
            "name": "MiniMax-M3"
        },
        {
            "id": "kimi-k2.7",
            "name": "Kimi-K2.7"
        },
        {
            "id": "kimi-k2.6",
            "name": "Kimi-K2.6"
        },
        {
            "id": "kimi-k2.5",
            "name": "Kimi-K2.5"
        },
        {
            "id": "nemotron-3-ultra-fp4",
            "name": "Nemotron 3 Ultra FP4"
        },
        {
            "id": "minimax-m2.7",
            "name": "MiniMax-M2.7"
        },
        {
            "id": "claude-opus-4-6",
            "name": "Claude Opus 4.6"
        },
        {
            "id": "claude-sonnet-4-6",
            "name": "Claude Sonnet 4.6"
        }
    ],
    "codex": [
        {
            "id": "gpt-6-astra",
            "name": "GPT 6.0 Astra"
        },
        {
            "id": "gpt-5.6-sol",
            "name": "GPT 5.6 Sol"
        },
        {
            "id": "gpt-5.6-sol-review",
            "name": "GPT 5.6 Sol Review",
            "upstreamModelId": "gpt-5.6-sol",
            "quotaFamily": "review"
        },
        {
            "id": "gpt-5.6-terra",
            "name": "GPT 5.6 Terra"
        },
        {
            "id": "gpt-5.6-terra-review",
            "name": "GPT 5.6 Terra Review",
            "upstreamModelId": "gpt-5.6-terra",
            "quotaFamily": "review"
        },
        {
            "id": "gpt-5.6-luna",
            "name": "GPT 5.6 Luna"
        },
        {
            "id": "gpt-5.6-luna-review",
            "name": "GPT 5.6 Luna Review",
            "upstreamModelId": "gpt-5.6-luna",
            "quotaFamily": "review"
        },
        {
            "id": "gpt-5.5",
            "name": "GPT 5.5"
        },
        {
            "id": "gpt-5.5-review",
            "name": "GPT 5.5 Review",
            "upstreamModelId": "gpt-5.5",
            "quotaFamily": "review"
        },
        {
            "id": "gpt-5.4",
            "name": "GPT 5.4"
        },
        {
            "id": "gpt-5.4-review",
            "name": "GPT 5.4 Review",
            "upstreamModelId": "gpt-5.4",
            "quotaFamily": "review"
        },
        {
            "id": "gpt-5.4-mini",
            "name": "GPT 5.4 Mini"
        },
        {
            "id": "gpt-5.4-mini-review",
            "name": "GPT 5.4 Mini Review",
            "upstreamModelId": "gpt-5.4-mini",
            "quotaFamily": "review"
        },
        {
            "id": "gpt-5.3-codex-spark",
            "name": "GPT 5.3 Codex Spark"
        },
        {
            "id": "gpt-5.3-codex-spark-review",
            "name": "GPT 5.3 Codex Spark Review",
            "upstreamModelId": "gpt-5.3-codex-spark",
            "quotaFamily": "review"
        },
        {
            "id": "codex-auto-review",
            "name": "Codex Auto Review",
            "upstreamModelId": "codex-auto-review",
            "quotaFamily": "review"
        },
        {
            "id": "gpt-image-2.5",
            "name": "GPT Image 2.5",
            "capabilities": [
                "text2img",
                "edit",
                "multiImage"
            ],
            "params": [
                "size",
                "quality",
                "background",
                "image_detail",
                "output_format"
            ],
            "kind": "image"
        },
        {
            "id": "gpt-image-2.5-flare",
            "name": "GPT Image 2.5 Flare",
            "capabilities": [
                "text2img",
                "edit",
                "multiImage"
            ],
            "params": [
                "size",
                "quality",
                "background",
                "image_detail",
                "output_format"
            ],
            "kind": "image"
        },
        {
            "id": "gpt-image-2.5-sunburst",
            "name": "GPT Image 2.5 Sunburst",
            "capabilities": [
                "text2img",
                "edit",
                "multiImage"
            ],
            "params": [
                "size",
                "quality",
                "background",
                "image_detail",
                "output_format"
            ],
            "kind": "image"
        },
        {
            "id": "gpt-image-2",
            "name": "GPT Image 2",
            "capabilities": [
                "text2img",
                "edit",
                "multiImage"
            ],
            "params": [
                "size",
                "quality",
                "background",
                "image_detail",
                "output_format"
            ],
            "kind": "image"
        },
        {
            "id": "gpt-image-1.5",
            "name": "GPT Image 1.5",
            "capabilities": [
                "text2img",
                "edit",
                "multiImage"
            ],
            "params": [
                "size",
                "quality",
                "background",
                "image_detail",
                "output_format"
            ],
            "kind": "image"
        },
        {
            "id": "gpt-5.6-sol-image",
            "name": "GPT 5.6 Sol Image",
            "capabilities": [
                "text2img",
                "edit"
            ],
            "params": [
                "size",
                "quality",
                "background",
                "image_detail",
                "output_format"
            ],
            "kind": "image"
        },
        {
            "id": "gpt-5.6-terra-image",
            "name": "GPT 5.6 Terra Image",
            "capabilities": [
                "text2img",
                "edit"
            ],
            "params": [
                "size",
                "quality",
                "background",
                "image_detail",
                "output_format"
            ],
            "kind": "image"
        },
        {
            "id": "gpt-5.6-luna-image",
            "name": "GPT 5.6 Luna Image",
            "capabilities": [
                "text2img",
                "edit"
            ],
            "params": [
                "size",
                "quality",
                "background",
                "image_detail",
                "output_format"
            ],
            "kind": "image"
        },
        {
            "id": "gpt-5.5-image",
            "name": "GPT 5.5 Image",
            "capabilities": [
                "text2img",
                "edit"
            ],
            "params": [
                "size",
                "quality",
                "background",
                "image_detail",
                "output_format"
            ],
            "kind": "image"
        },
        {
            "id": "gpt-5.4-image",
            "name": "GPT 5.4 Image",
            "capabilities": [
                "text2img",
                "edit"
            ],
            "params": [
                "size",
                "quality",
                "background",
                "image_detail",
                "output_format"
            ],
            "kind": "image"
        },
        {
            "id": "gpt-5.3-image",
            "name": "GPT 5.3 Image",
            "capabilities": [
                "text2img",
                "edit"
            ],
            "params": [
                "size",
                "quality",
                "background",
                "image_detail",
                "output_format"
            ],
            "kind": "image"
        }
    ],
    "cx": [
        {
            "id": "gpt-6-astra",
            "name": "GPT 6.0 Astra"
        },
        {
            "id": "gpt-5.6-sol",
            "name": "GPT 5.6 Sol"
        },
        {
            "id": "gpt-5.6-sol-review",
            "name": "GPT 5.6 Sol Review",
            "upstreamModelId": "gpt-5.6-sol",
            "quotaFamily": "review"
        },
        {
            "id": "gpt-5.6-terra",
            "name": "GPT 5.6 Terra"
        },
        {
            "id": "gpt-5.6-terra-review",
            "name": "GPT 5.6 Terra Review",
            "upstreamModelId": "gpt-5.6-terra",
            "quotaFamily": "review"
        },
        {
            "id": "gpt-5.6-luna",
            "name": "GPT 5.6 Luna"
        },
        {
            "id": "gpt-5.6-luna-review",
            "name": "GPT 5.6 Luna Review",
            "upstreamModelId": "gpt-5.6-luna",
            "quotaFamily": "review"
        },
        {
            "id": "gpt-5.5",
            "name": "GPT 5.5"
        },
        {
            "id": "gpt-5.5-review",
            "name": "GPT 5.5 Review",
            "upstreamModelId": "gpt-5.5",
            "quotaFamily": "review"
        },
        {
            "id": "gpt-5.4",
            "name": "GPT 5.4"
        },
        {
            "id": "gpt-5.4-review",
            "name": "GPT 5.4 Review",
            "upstreamModelId": "gpt-5.4",
            "quotaFamily": "review"
        },
        {
            "id": "gpt-5.4-mini",
            "name": "GPT 5.4 Mini"
        },
        {
            "id": "gpt-5.4-mini-review",
            "name": "GPT 5.4 Mini Review",
            "upstreamModelId": "gpt-5.4-mini",
            "quotaFamily": "review"
        },
        {
            "id": "gpt-5.3-codex-spark",
            "name": "GPT 5.3 Codex Spark"
        },
        {
            "id": "gpt-5.3-codex-spark-review",
            "name": "GPT 5.3 Codex Spark Review",
            "upstreamModelId": "gpt-5.3-codex-spark",
            "quotaFamily": "review"
        },
        {
            "id": "codex-auto-review",
            "name": "Codex Auto Review",
            "upstreamModelId": "codex-auto-review",
            "quotaFamily": "review"
        },
        {
            "id": "gpt-image-2.5",
            "name": "GPT Image 2.5",
            "capabilities": [
                "text2img",
                "edit",
                "multiImage"
            ],
            "params": [
                "size",
                "quality",
                "background",
                "image_detail",
                "output_format"
            ],
            "kind": "image"
        },
        {
            "id": "gpt-image-2.5-flare",
            "name": "GPT Image 2.5 Flare",
            "capabilities": [
                "text2img",
                "edit",
                "multiImage"
            ],
            "params": [
                "size",
                "quality",
                "background",
                "image_detail",
                "output_format"
            ],
            "kind": "image"
        },
        {
            "id": "gpt-image-2.5-sunburst",
            "name": "GPT Image 2.5 Sunburst",
            "capabilities": [
                "text2img",
                "edit",
                "multiImage"
            ],
            "params": [
                "size",
                "quality",
                "background",
                "image_detail",
                "output_format"
            ],
            "kind": "image"
        },
        {
            "id": "gpt-image-2",
            "name": "GPT Image 2",
            "capabilities": [
                "text2img",
                "edit",
                "multiImage"
            ],
            "params": [
                "size",
                "quality",
                "background",
                "image_detail",
                "output_format"
            ],
            "kind": "image"
        },
        {
            "id": "gpt-image-1.5",
            "name": "GPT Image 1.5",
            "capabilities": [
                "text2img",
                "edit",
                "multiImage"
            ],
            "params": [
                "size",
                "quality",
                "background",
                "image_detail",
                "output_format"
            ],
            "kind": "image"
        },
        {
            "id": "gpt-5.6-sol-image",
            "name": "GPT 5.6 Sol Image",
            "capabilities": [
                "text2img",
                "edit"
            ],
            "params": [
                "size",
                "quality",
                "background",
                "image_detail",
                "output_format"
            ],
            "kind": "image"
        },
        {
            "id": "gpt-5.6-terra-image",
            "name": "GPT 5.6 Terra Image",
            "capabilities": [
                "text2img",
                "edit"
            ],
            "params": [
                "size",
                "quality",
                "background",
                "image_detail",
                "output_format"
            ],
            "kind": "image"
        },
        {
            "id": "gpt-5.6-luna-image",
            "name": "GPT 5.6 Luna Image",
            "capabilities": [
                "text2img",
                "edit"
            ],
            "params": [
                "size",
                "quality",
                "background",
                "image_detail",
                "output_format"
            ],
            "kind": "image"
        },
        {
            "id": "gpt-5.5-image",
            "name": "GPT 5.5 Image",
            "capabilities": [
                "text2img",
                "edit"
            ],
            "params": [
                "size",
                "quality",
                "background",
                "image_detail",
                "output_format"
            ],
            "kind": "image"
        },
        {
            "id": "gpt-5.4-image",
            "name": "GPT 5.4 Image",
            "capabilities": [
                "text2img",
                "edit"
            ],
            "params": [
                "size",
                "quality",
                "background",
                "image_detail",
                "output_format"
            ],
            "kind": "image"
        },
        {
            "id": "gpt-5.3-image",
            "name": "GPT 5.3 Image",
            "capabilities": [
                "text2img",
                "edit"
            ],
            "params": [
                "size",
                "quality",
                "background",
                "image_detail",
                "output_format"
            ],
            "kind": "image"
        }
    ],
    "claude": [
        {
            "id": "claude-opus-5-5",
            "name": "Claude Opus 5.5"
        },
        {
            "id": "claude-opus-5",
            "name": "Claude Opus 5"
        },
        {
            "id": "claude-fable-5-1",
            "name": "Claude Fable 5.1"
        },
        {
            "id": "claude-fable-5",
            "name": "Claude Fable 5"
        },
        {
            "id": "claude-sonnet-5",
            "name": "Claude Sonnet 5"
        },
        {
            "id": "claude-haiku-4-5-20251001",
            "name": "Claude 4.5 Haiku"
        }
    ],
    "cc": [
        {
            "id": "claude-opus-5-5",
            "name": "Claude Opus 5.5"
        },
        {
            "id": "claude-opus-5",
            "name": "Claude Opus 5"
        },
        {
            "id": "claude-fable-5-1",
            "name": "Claude Fable 5.1"
        },
        {
            "id": "claude-fable-5",
            "name": "Claude Fable 5"
        },
        {
            "id": "claude-sonnet-5",
            "name": "Claude Sonnet 5"
        },
        {
            "id": "claude-haiku-4-5-20251001",
            "name": "Claude 4.5 Haiku"
        }
    ],
    "antigravity": [
        {
            "id": "gemini-3.8-flash-high",
            "name": "Gemini 3.8 Flash (High)",
            "upstreamModelId": "gemini-3.8-flash-high(high)"
        },
        {
            "id": "gemini-3.8-flash-medium",
            "name": "Gemini 3.8 Flash (Medium)",
            "upstreamModelId": "gemini-3.8-flash-medium(medium)"
        },
        {
            "id": "gemini-3.8-flash-low",
            "name": "Gemini 3.8 Flash (Low)",
            "upstreamModelId": "gemini-3.8-flash-low(low)"
        },
        {
            "id": "gemini-3.8-flash",
            "name": "Gemini 3.8 Flash",
            "upstreamModelId": "gemini-3.8-flash-medium(medium)"
        },
        {
            "id": "gemini-3.7-flash-high",
            "name": "Gemini 3.7 Flash (High)",
            "upstreamModelId": "gemini-3.7-flash-tiered(high)"
        },
        {
            "id": "gemini-3.7-flash-medium",
            "name": "Gemini 3.7 Flash (Medium)",
            "upstreamModelId": "gemini-3.7-flash-tiered(medium)"
        },
        {
            "id": "gemini-3.7-flash-low",
            "name": "Gemini 3.7 Flash (Low)",
            "upstreamModelId": "gemini-3.7-flash-tiered(low)"
        },
        {
            "id": "gemini-3.6-flash-high",
            "name": "Gemini 3.6 Flash (High)",
            "upstreamModelId": "gemini-3.6-flash-tiered(high)"
        },
        {
            "id": "gemini-3.6-flash-medium",
            "name": "Gemini 3.6 Flash (Medium)",
            "upstreamModelId": "gemini-3.6-flash-tiered(medium)"
        },
        {
            "id": "gemini-3.6-flash-low",
            "name": "Gemini 3.6 Flash (Low)",
            "upstreamModelId": "gemini-3.6-flash-tiered(low)"
        },
        {
            "id": "gemini-3.5-flash-high",
            "name": "Gemini 3.5 Flash (High)"
        },
        {
            "id": "gemini-3-flash-agent",
            "name": "Gemini 3.5 Flash (High)"
        },
        {
            "id": "gemini-3.5-flash-low",
            "name": "Gemini 3.5 Flash (Medium)"
        },
        {
            "id": "gemini-3.5-flash-extra-low",
            "name": "Gemini 3.5 Flash (Low)"
        },
        {
            "id": "gemini-pro-agent",
            "name": "Gemini 3.1 Pro (High)"
        },
        {
            "id": "gemini-3.1-pro-low",
            "name": "Gemini 3.1 Pro (Low)"
        },
        {
            "id": "claude-sonnet-4-6",
            "name": "Claude Sonnet 4.6 (Thinking)"
        },
        {
            "id": "claude-opus-4-6-thinking",
            "name": "Claude Opus 4.6 (Thinking)"
        },
        {
            "id": "gpt-oss-120b-medium",
            "name": "GPT-OSS 120B (Medium)"
        },
        {
            "id": "gemini-3-flash",
            "name": "Gemini 3 Flash",
            "thinking": false
        },
        {
            "id": "gemini-3.1-flash-image",
            "name": "Gemini 3.1 Flash (Image)",
            "kind": "image",
            "imageGen": true,
            "capabilities": [
                "textToImage"
            ]
        }
    ],
    "ag": [
        {
            "id": "gemini-3.8-flash-high",
            "name": "Gemini 3.8 Flash (High)",
            "upstreamModelId": "gemini-3.8-flash-high(high)"
        },
        {
            "id": "gemini-3.8-flash-medium",
            "name": "Gemini 3.8 Flash (Medium)",
            "upstreamModelId": "gemini-3.8-flash-medium(medium)"
        },
        {
            "id": "gemini-3.8-flash-low",
            "name": "Gemini 3.8 Flash (Low)",
            "upstreamModelId": "gemini-3.8-flash-low(low)"
        },
        {
            "id": "gemini-3.8-flash",
            "name": "Gemini 3.8 Flash",
            "upstreamModelId": "gemini-3.8-flash-medium(medium)"
        },
        {
            "id": "gemini-3.7-flash-high",
            "name": "Gemini 3.7 Flash (High)",
            "upstreamModelId": "gemini-3.7-flash-tiered(high)"
        },
        {
            "id": "gemini-3.7-flash-medium",
            "name": "Gemini 3.7 Flash (Medium)",
            "upstreamModelId": "gemini-3.7-flash-tiered(medium)"
        },
        {
            "id": "gemini-3.7-flash-low",
            "name": "Gemini 3.7 Flash (Low)",
            "upstreamModelId": "gemini-3.7-flash-tiered(low)"
        },
        {
            "id": "gemini-3.6-flash-high",
            "name": "Gemini 3.6 Flash (High)",
            "upstreamModelId": "gemini-3.6-flash-tiered(high)"
        },
        {
            "id": "gemini-3.6-flash-medium",
            "name": "Gemini 3.6 Flash (Medium)",
            "upstreamModelId": "gemini-3.6-flash-tiered(medium)"
        },
        {
            "id": "gemini-3.6-flash-low",
            "name": "Gemini 3.6 Flash (Low)",
            "upstreamModelId": "gemini-3.6-flash-tiered(low)"
        },
        {
            "id": "gemini-3.5-flash-high",
            "name": "Gemini 3.5 Flash (High)"
        },
        {
            "id": "gemini-3-flash-agent",
            "name": "Gemini 3.5 Flash (High)"
        },
        {
            "id": "gemini-3.5-flash-low",
            "name": "Gemini 3.5 Flash (Medium)"
        },
        {
            "id": "gemini-3.5-flash-extra-low",
            "name": "Gemini 3.5 Flash (Low)"
        },
        {
            "id": "gemini-pro-agent",
            "name": "Gemini 3.1 Pro (High)"
        },
        {
            "id": "gemini-3.1-pro-low",
            "name": "Gemini 3.1 Pro (Low)"
        },
        {
            "id": "claude-sonnet-4-6",
            "name": "Claude Sonnet 4.6 (Thinking)"
        },
        {
            "id": "claude-opus-4-6-thinking",
            "name": "Claude Opus 4.6 (Thinking)"
        },
        {
            "id": "gpt-oss-120b-medium",
            "name": "GPT-OSS 120B (Medium)"
        },
        {
            "id": "gemini-3-flash",
            "name": "Gemini 3 Flash",
            "thinking": false
        },
        {
            "id": "gemini-3.1-flash-image",
            "name": "Gemini 3.1 Flash (Image)",
            "kind": "image",
            "imageGen": true,
            "capabilities": [
                "textToImage"
            ]
        }
    ],
    "openai": [
        {
            "id": "gpt-5.5",
            "name": "GPT-5.5"
        },
        {
            "id": "gpt-5.4",
            "name": "GPT-5.4"
        },
        {
            "id": "gpt-5.4-mini",
            "name": "GPT-5.4 Mini"
        },
        {
            "id": "gpt-5.4-nano",
            "name": "GPT-5.4 Nano"
        },
        {
            "id": "gpt-5.2",
            "name": "GPT-5.2"
        },
        {
            "id": "gpt-5.1",
            "name": "GPT-5.1"
        },
        {
            "id": "gpt-5",
            "name": "GPT-5"
        },
        {
            "id": "gpt-5-mini",
            "name": "GPT-5 Mini"
        },
        {
            "id": "gpt-5-nano",
            "name": "GPT-5 Nano"
        },
        {
            "id": "gpt-4o",
            "name": "GPT-4o"
        },
        {
            "id": "gpt-4o-mini",
            "name": "GPT-4o Mini"
        },
        {
            "id": "gpt-4-turbo",
            "name": "GPT-4 Turbo"
        },
        {
            "id": "gpt-4.1",
            "name": "GPT-4.1"
        },
        {
            "id": "gpt-4.1-mini",
            "name": "GPT-4.1 Mini"
        },
        {
            "id": "gpt-4.1-nano",
            "name": "GPT-4.1 Nano"
        },
        {
            "id": "o3",
            "name": "O3"
        },
        {
            "id": "o3-mini",
            "name": "O3 Mini"
        },
        {
            "id": "o3-pro",
            "name": "O3 Pro"
        },
        {
            "id": "o4-mini",
            "name": "O4 Mini"
        },
        {
            "id": "o1",
            "name": "O1"
        },
        {
            "id": "o1-mini",
            "name": "O1 Mini"
        },
        {
            "id": "text-embedding-3-large",
            "name": "Text Embedding 3 Large",
            "kind": "embedding"
        },
        {
            "id": "text-embedding-3-small",
            "name": "Text Embedding 3 Small",
            "kind": "embedding"
        },
        {
            "id": "text-embedding-ada-002",
            "name": "Text Embedding Ada 002",
            "kind": "embedding"
        },
        {
            "id": "tts-1",
            "name": "TTS-1",
            "kind": "tts"
        },
        {
            "id": "tts-1-hd",
            "name": "TTS-1 HD",
            "kind": "tts"
        },
        {
            "id": "gpt-4o-mini-tts",
            "name": "GPT-4o Mini TTS",
            "kind": "tts"
        },
        {
            "id": "whisper-1",
            "name": "Whisper 1",
            "params": [
                "language",
                "response_format",
                "temperature",
                "prompt"
            ],
            "kind": "stt"
        },
        {
            "id": "gpt-4o-transcribe",
            "name": "GPT-4o Transcribe",
            "params": [
                "language",
                "response_format",
                "temperature",
                "prompt"
            ],
            "kind": "stt"
        },
        {
            "id": "gpt-4o-mini-transcribe",
            "name": "GPT-4o Mini Transcribe",
            "params": [
                "language",
                "response_format",
                "temperature",
                "prompt"
            ],
            "kind": "stt"
        },
        {
            "id": "gpt-image-2.5",
            "name": "GPT Image 2.5",
            "params": [
                "n",
                "size",
                "quality",
                "response_format"
            ],
            "kind": "image"
        },
        {
            "id": "gpt-image-2.5-flare",
            "name": "GPT Image 2.5 Flare",
            "params": [
                "n",
                "size",
                "quality",
                "response_format"
            ],
            "kind": "image"
        },
        {
            "id": "gpt-image-2.5-sunburst",
            "name": "GPT Image 2.5 Sunburst",
            "params": [
                "n",
                "size",
                "quality",
                "response_format"
            ],
            "kind": "image"
        },
        {
            "id": "gpt-image-1",
            "name": "GPT Image 1",
            "params": [
                "n",
                "size",
                "quality",
                "response_format"
            ],
            "kind": "image"
        },
        {
            "id": "dall-e-3",
            "name": "DALL-E 3",
            "params": [
                "size",
                "quality",
                "style",
                "response_format"
            ],
            "kind": "image"
        },
        {
            "id": "dall-e-2",
            "name": "DALL-E 2",
            "params": [
                "n",
                "size",
                "response_format"
            ],
            "kind": "image"
        }
    ],
    "anthropic": [
        {
            "id": "claude-sonnet-4-20250514",
            "name": "Claude Sonnet 4"
        },
        {
            "id": "claude-opus-4-20250514",
            "name": "Claude Opus 4"
        },
        {
            "id": "claude-3-5-sonnet-20241022",
            "name": "Claude 3.5 Sonnet"
        }
    ],
    "gemini": [
        {
            "id": "gemini-3.8-flash",
            "name": "Gemini 3.8 Flash"
        },
        {
            "id": "gemini-3.7-flash",
            "name": "Gemini 3.7 Flash"
        },
        {
            "id": "gemini-3.6-flash",
            "name": "Gemini 3.6 Flash"
        },
        {
            "id": "gemini-3.5-flash-lite",
            "name": "Gemini 3.5 Flash Lite"
        },
        {
            "id": "gemini-3.1-pro-preview",
            "name": "Gemini 3.1 Pro Preview"
        },
        {
            "id": "gemini-3.1-flash-lite-preview",
            "name": "Gemini 3.1 Flash Lite Preview"
        },
        {
            "id": "gemini-3-flash-preview",
            "name": "Gemini 3 Flash Preview"
        },
        {
            "id": "gemini-2.5-pro",
            "name": "Gemini 2.5 Pro"
        },
        {
            "id": "gemini-2.5-flash",
            "name": "Gemini 2.5 Flash"
        },
        {
            "id": "gemini-2.5-flash-lite",
            "name": "Gemini 2.5 Flash Lite"
        },
        {
            "id": "gemma-4-31b-it",
            "name": "Gemma 4 31B IT"
        },
        {
            "id": "gemini-embedding-2-preview",
            "name": "Gemini Embedding 2 Preview",
            "kind": "embedding"
        },
        {
            "id": "gemini-embedding-001",
            "name": "Gemini Embedding 001",
            "kind": "embedding"
        },
        {
            "id": "text-embedding-005",
            "name": "Text Embedding 005",
            "kind": "embedding"
        },
        {
            "id": "text-embedding-004",
            "name": "Text Embedding 004 (Legacy)",
            "kind": "embedding"
        },
        {
            "id": "gemini-3.1-flash-image-preview",
            "name": "Gemini 3.1 Flash Image (Nano Banana 2)",
            "params": [],
            "kind": "image"
        },
        {
            "id": "gemini-3-pro-image-preview",
            "name": "Gemini 3 Pro Image (Nano Banana Pro)",
            "params": [],
            "kind": "image"
        },
        {
            "id": "gemini-2.5-flash-image",
            "name": "Gemini 2.5 Flash Image (Nano Banana)",
            "params": [],
            "kind": "image"
        },
        {
            "id": "gemini-2.5-pro",
            "name": "Gemini 2.5 Pro (Best)",
            "params": [
                "language",
                "prompt"
            ],
            "kind": "stt"
        },
        {
            "id": "gemini-2.5-flash",
            "name": "Gemini 2.5 Flash",
            "params": [
                "language",
                "prompt"
            ],
            "kind": "stt"
        },
        {
            "id": "gemini-2.5-flash-lite",
            "name": "Gemini 2.5 Flash Lite (Cheapest)",
            "params": [
                "language",
                "prompt"
            ],
            "kind": "stt"
        },
        {
            "id": "gemini-2.0-flash",
            "name": "Gemini 2.0 Flash",
            "params": [
                "language",
                "prompt"
            ],
            "kind": "stt"
        },
        {
            "id": "gemini-3.1-flash-tts-preview",
            "name": "Gemini 3.1 Flash TTS",
            "kind": "tts"
        },
        {
            "id": "gemini-2.5-flash-preview-tts",
            "name": "Gemini 2.5 Flash TTS",
            "kind": "tts"
        },
        {
            "id": "gemini-2.5-pro-preview-tts",
            "name": "Gemini 2.5 Pro TTS",
            "kind": "tts"
        },
        {
            "id": "embedding-001",
            "name": "Embedding 001",
            "dimensions": 768,
            "kind": "embedding"
        }
    ],
    "openrouter": [
        {
            "id": "openai/text-embedding-3-large",
            "name": "OpenAI Text Embedding 3 Large",
            "kind": "embedding"
        },
        {
            "id": "openai/text-embedding-3-small",
            "name": "OpenAI Text Embedding 3 Small",
            "kind": "embedding"
        },
        {
            "id": "openai/text-embedding-ada-002",
            "name": "OpenAI Text Embedding Ada 002",
            "kind": "embedding"
        },
        {
            "id": "qwen/qwen3-embedding-8b",
            "name": "Qwen3 Embedding 8B",
            "kind": "embedding"
        },
        {
            "id": "perplexity/pplx-embed-v1-4b",
            "name": "Perplexity Embed V1 4B",
            "kind": "embedding"
        },
        {
            "id": "perplexity/pplx-embed-v1-0.6b",
            "name": "Perplexity Embed V1 0.6B",
            "kind": "embedding"
        },
        {
            "id": "nvidia/llama-nemotron-embed-vl-1b-v2:free",
            "name": "NVIDIA Nemotron Embed VL 1B V2 (Free)",
            "kind": "embedding"
        },
        {
            "id": "openai/gpt-4o-mini-tts",
            "name": "GPT-4o Mini TTS",
            "kind": "tts"
        },
        {
            "id": "openai/tts-1-hd",
            "name": "TTS-1 HD",
            "kind": "tts"
        },
        {
            "id": "openai/tts-1",
            "name": "TTS-1",
            "kind": "tts"
        },
        {
            "id": "openai/dall-e-3",
            "name": "DALL-E 3 (via OpenRouter)",
            "params": [
                "size",
                "quality",
                "style",
                "response_format"
            ],
            "kind": "image"
        },
        {
            "id": "openai/gpt-image-1",
            "name": "GPT Image 1 (via OpenRouter)",
            "params": [
                "n",
                "size",
                "quality",
                "response_format"
            ],
            "kind": "image"
        },
        {
            "id": "google/imagen-3.0-generate-002",
            "name": "Imagen 3 (via OpenRouter)",
            "params": [
                "n",
                "size"
            ],
            "kind": "image"
        },
        {
            "id": "black-forest-labs/FLUX.1-schnell",
            "name": "FLUX.1 Schnell (via OpenRouter)",
            "params": [
                "n",
                "size"
            ],
            "kind": "image"
        },
        {
            "id": "google/veo-3.1",
            "name": "Veo 3.1 (via OpenRouter)",
            "params": [
                "duration",
                "aspect_ratio",
                "resolution"
            ],
            "kind": "video"
        },
        {
            "id": "openai/sora-2-pro",
            "name": "Sora 2 Pro (via OpenRouter)",
            "params": [
                "duration",
                "aspect_ratio",
                "resolution"
            ],
            "kind": "video"
        },
        {
            "id": "bytedance/seedance-2.0",
            "name": "Seedance 2.0 (via OpenRouter)",
            "params": [
                "duration",
                "aspect_ratio",
                "resolution"
            ],
            "kind": "video"
        },
        {
            "id": "typesafe/jev-1.13",
            "name": "Jev 1.13",
            "kind": "systemone"
        }
    ],
    "ollama-local": [],
    "xiaomi-tokenplan": [
        {
            "id": "mimo-v2.5-pro",
            "name": "MiMo V2.5 Pro"
        },
        {
            "id": "mimo-v2.5-pro-claude",
            "name": "MiMo V2.5 Pro (Claude Native)",
            "targetFormat": "claude",
            "upstreamModelId": "mimo-v2.5-pro"
        },
        {
            "id": "mimo-v2.5",
            "name": "MiMo V2.5"
        },
        {
            "id": "mimo-v2-pro",
            "name": "MiMo V2 Pro"
        },
        {
            "id": "mimo-v2-omni",
            "name": "MiMo V2 Omni"
        },
        {
            "id": "mimo-v2-tts",
            "name": "MiMo V2 TTS"
        },
        {
            "id": "mimo-v2.5-tts",
            "name": "MiMo V2.5 TTS"
        },
        {
            "id": "mimo-v2.5-tts-voiceclone",
            "name": "MiMo V2.5 TTS Voice Clone"
        },
        {
            "id": "mimo-v2.5-tts-voicedesign",
            "name": "MiMo V2.5 TTS Voice Design"
        }
    ],
    "deepseek": [
        {
            "id": "deepseek-v4-pro",
            "name": "DeepSeek V4 Pro"
        },
        {
            "id": "deepseek-v4-pro-max",
            "name": "DeepSeek V4 Pro Max",
            "upstreamModelId": "deepseek-v4-pro"
        },
        {
            "id": "deepseek-v4-pro-none",
            "name": "DeepSeek V4 Pro No Thinking",
            "upstreamModelId": "deepseek-v4-pro"
        },
        {
            "id": "deepseek-v4.1-flash",
            "name": "DeepSeek V4.1 Flash"
        },
        {
            "id": "deepseek-v4-flash",
            "name": "DeepSeek V4 Flash"
        },
        {
            "id": "deepseek-v4-flash-vision-exp",
            "name": "DeepSeek V4 Flash Vision (Exp)"
        },
        {
            "id": "deepseek-chat",
            "name": "DeepSeek V3.2 Chat"
        },
        {
            "id": "deepseek-reasoner",
            "name": "DeepSeek V3.2 Reasoner"
        }
    ],
    "minimax": [
        {
            "id": "MiniMax-M3",
            "name": "MiniMax M3",
            "targetFormat": "claude"
        },
        {
            "id": "MiniMax-M2.7",
            "name": "MiniMax M2.7"
        },
        {
            "id": "MiniMax-M2.5",
            "name": "MiniMax M2.5"
        },
        {
            "id": "MiniMax-M2.1",
            "name": "MiniMax M2.1"
        },
        {
            "id": "minimax-image-01",
            "name": "MiniMax Image 01",
            "params": [
                "n",
                "size",
                "response_format"
            ],
            "kind": "image"
        },
        {
            "id": "speech-2.8-hd",
            "name": "Speech 2.8 HD",
            "kind": "tts"
        },
        {
            "id": "speech-2.8-turbo",
            "name": "Speech 2.8 Turbo",
            "kind": "tts"
        },
        {
            "id": "speech-2.6-hd",
            "name": "Speech 2.6 HD",
            "kind": "tts"
        },
        {
            "id": "speech-2.6-turbo",
            "name": "Speech 2.6 Turbo",
            "kind": "tts"
        },
        {
            "id": "speech-02-hd",
            "name": "Speech 02 HD",
            "kind": "tts"
        },
        {
            "id": "speech-02-turbo",
            "name": "Speech 02 Turbo",
            "kind": "tts"
        },
        {
            "id": "speech-01-hd",
            "name": "Speech 01 HD",
            "kind": "tts"
        },
        {
            "id": "speech-01-turbo",
            "name": "Speech 01 Turbo",
            "kind": "tts"
        }
    ],
    "alicode-intl": [
        {
            "id": "qwen3.5-plus",
            "name": "Qwen3.5 Plus"
        },
        {
            "id": "kimi-k2.5",
            "name": "Kimi K2.5"
        },
        {
            "id": "glm-5",
            "name": "GLM 5"
        },
        {
            "id": "MiniMax-M2.5",
            "name": "MiniMax M2.5"
        },
        {
            "id": "qwen3-coder-next",
            "name": "Qwen3 Coder Next"
        },
        {
            "id": "qwen3-coder-plus",
            "name": "Qwen3 Coder Plus"
        },
        {
            "id": "glm-4.7",
            "name": "GLM 4.7"
        }
    ],
    "alicode": [
        {
            "id": "qwen3.5-plus",
            "name": "Qwen3.5 Plus"
        },
        {
            "id": "kimi-k2.5",
            "name": "Kimi K2.5"
        },
        {
            "id": "glm-5",
            "name": "GLM 5"
        },
        {
            "id": "MiniMax-M2.5",
            "name": "MiniMax M2.5"
        },
        {
            "id": "qwen3-max-2026-01-23",
            "name": "Qwen3 Max"
        },
        {
            "id": "qwen3-coder-next",
            "name": "Qwen3 Coder Next"
        },
        {
            "id": "qwen3-coder-plus",
            "name": "Qwen3 Coder Plus"
        },
        {
            "id": "glm-4.7",
            "name": "GLM 4.7"
        }
    ],
    "azure": [],
    "blackbox": [
        {
            "id": "claude-fable-5",
            "name": "Claude Fable 5",
            "upstreamModelId": "blackboxai/anthropic/claude-fable-5"
        },
        {
            "id": "claude-opus-4.8",
            "name": "Claude Opus 4.8",
            "upstreamModelId": "blackboxai/anthropic/claude-opus-4.8"
        },
        {
            "id": "claude-sonnet-4.6",
            "name": "Claude Sonnet 4.6",
            "upstreamModelId": "blackboxai/anthropic/claude-sonnet-4.6"
        },
        {
            "id": "gpt-5.5",
            "name": "GPT-5.5",
            "upstreamModelId": "blackboxai/openai/gpt-5.5"
        },
        {
            "id": "gpt-5.4-pro",
            "name": "GPT-5.4 Pro",
            "upstreamModelId": "blackboxai/openai/gpt-5.4-pro"
        },
        {
            "id": "gpt-5.4",
            "name": "GPT-5.4",
            "upstreamModelId": "blackboxai/openai/gpt-5.4"
        },
        {
            "id": "gpt-5.3-codex",
            "name": "GPT-5.3 Codex",
            "upstreamModelId": "blackboxai/openai/gpt-5.3-codex"
        },
        {
            "id": "gpt-5.4-nano",
            "name": "GPT-5.4 Nano",
            "upstreamModelId": "blackboxai/openai/gpt-5.4-nano"
        },
        {
            "id": "deepseek-v4-flash",
            "name": "DeepSeek V4 Flash",
            "upstreamModelId": "blackboxai/deepseek/deepseek-v4-flash"
        },
        {
            "id": "grok-4.3",
            "name": "Grok 4.3",
            "upstreamModelId": "blackboxai/x-ai/grok-4.3"
        }
    ],
    "byteplus": [
        {
            "id": "seed-2-0-pro-260328",
            "name": "Seed 2.0 Pro"
        },
        {
            "id": "seed-2-0-code-preview-260328",
            "name": "Seed 2.0 Code Preview"
        },
        {
            "id": "seed-2-0-mini-260215",
            "name": "Seed 2.0 Mini"
        },
        {
            "id": "seed-2-0-lite-260228",
            "name": "Seed 2.0 Lite"
        },
        {
            "id": "kimi-k2-thinking-251104",
            "name": "Kimi K2 Thinking"
        },
        {
            "id": "glm-4-7-251222",
            "name": "GLM 4.7"
        },
        {
            "id": "gpt-oss-120b-250805",
            "name": "GPT-OSS-120B"
        }
    ],
    "cerebras": [
        {
            "id": "gpt-oss-120b",
            "name": "GPT OSS 120B"
        },
        {
            "id": "zai-glm-4.7",
            "name": "ZAI GLM 4.7"
        },
        {
            "id": "llama-3.3-70b",
            "name": "Llama 3.3 70B"
        },
        {
            "id": "llama-4-scout-17b-16e-instruct",
            "name": "Llama 4 Scout"
        },
        {
            "id": "qwen-3-235b-a22b-instruct-2507",
            "name": "Qwen3 235B A22B"
        },
        {
            "id": "qwen-3-32b",
            "name": "Qwen3 32B"
        }
    ],
    "chutes": [],
    "cloudflare-ai": [
        {
            "id": "@cf/meta/llama-3.2-1b-instruct",
            "name": "Llama 3.2 1B Instruct"
        },
        {
            "id": "@cf/meta/llama-3.2-3b-instruct",
            "name": "Llama 3.2 3B Instruct"
        },
        {
            "id": "@cf/meta/llama-3.1-8b-instruct-fp8-fast",
            "name": "Llama 3.1 8B Instruct FP8 Fast"
        },
        {
            "id": "@cf/meta/llama-3.1-8b-instruct-awq",
            "name": "Llama 3.1 8B Instruct AWQ"
        },
        {
            "id": "@cf/mistralai/mistral-small-3.1-24b-instruct",
            "name": "Mistral Small 3.1 24B Instruct"
        },
        {
            "id": "@cf/meta/llama-3.1-70b-instruct-fp8-fast",
            "name": "Llama 3.1 70B Instruct FP8 Fast"
        },
        {
            "id": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
            "name": "Llama 3.3 70B Instruct FP8 Fast"
        },
        {
            "id": "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
            "name": "DeepSeek R1 Distill Qwen 32B"
        },
        {
            "id": "@cf/moonshotai/kimi-k2.5",
            "name": "Kimi K2.5"
        },
        {
            "id": "@cf/moonshotai/kimi-k2.6",
            "name": "Kimi K2.6"
        },
        {
            "id": "@cf/zai-org/glm-4.7-flash",
            "name": "GLM 4.7 Flash"
        },
        {
            "id": "@cf/qwen/qwq-32b",
            "name": "QwQ 32B"
        },
        {
            "id": "@cf/qwen/qwen2.5-coder-32b-instruct",
            "name": "Qwen 2.5 Coder 32B Instruct"
        },
        {
            "id": "@cf/black-forest-labs/flux-2-klein-9b",
            "name": "FLUX.2 Klein 9B",
            "params": [
                "size"
            ],
            "kind": "image"
        },
        {
            "id": "@cf/black-forest-labs/flux-2-klein-4b",
            "name": "FLUX.2 Klein 4B",
            "params": [
                "size"
            ],
            "kind": "image"
        },
        {
            "id": "@cf/black-forest-labs/flux-2-dev",
            "name": "FLUX.2 Dev",
            "params": [
                "size"
            ],
            "kind": "image"
        },
        {
            "id": "@cf/leonardo/lucid-origin",
            "name": "Lucid Origin",
            "params": [
                "size"
            ],
            "kind": "image"
        },
        {
            "id": "@cf/leonardo/phoenix-1.0",
            "name": "Phoenix 1.0",
            "params": [
                "size"
            ],
            "kind": "image"
        },
        {
            "id": "@cf/black-forest-labs/flux-1-schnell",
            "name": "FLUX.1 Schnell",
            "params": [
                "size"
            ],
            "kind": "image"
        },
        {
            "id": "@cf/bytedance/stable-diffusion-xl-lightning",
            "name": "SDXL Lightning",
            "params": [
                "size"
            ],
            "kind": "image"
        },
        {
            "id": "@cf/lykon/dreamshaper-8-lcm",
            "name": "DreamShaper 8 LCM",
            "params": [
                "size"
            ],
            "kind": "image"
        },
        {
            "id": "@cf/runwayml/stable-diffusion-v1-5-img2img",
            "name": "Stable Diffusion v1.5 Img2Img",
            "params": [
                "size"
            ],
            "capabilities": [
                "edit"
            ],
            "kind": "image"
        },
        {
            "id": "@cf/runwayml/stable-diffusion-v1-5-inpainting",
            "name": "Stable Diffusion v1.5 Inpainting",
            "params": [
                "size"
            ],
            "capabilities": [
                "edit",
                "mask"
            ],
            "kind": "image"
        },
        {
            "id": "@cf/stabilityai/stable-diffusion-xl-base-1.0",
            "name": "SDXL Base 1.0",
            "params": [
                "size"
            ],
            "kind": "image"
        }
    ],
    "cohere": [
        {
            "id": "command-r-plus-08-2024",
            "name": "Command R+ (Aug 2024)"
        },
        {
            "id": "command-r-08-2024",
            "name": "Command R (Aug 2024)"
        },
        {
            "id": "command-a-03-2025",
            "name": "Command A (Mar 2025)"
        }
    ],
    "commandcode": [
        {
            "id": "deepseek/deepseek-v4-pro",
            "name": "DeepSeek V4 Pro"
        },
        {
            "id": "deepseek/deepseek-v4-flash",
            "name": "DeepSeek V4 Flash"
        },
        {
            "id": "moonshotai/Kimi-K2.7-Code",
            "name": "Kimi K2.7 Code"
        },
        {
            "id": "moonshotai/Kimi-K2.7-Code-Highspeed",
            "name": "Kimi K2.7 Code HighSpeed"
        },
        {
            "id": "moonshotai/Kimi-K2.6",
            "name": "Kimi K2.6"
        },
        {
            "id": "moonshotai/Kimi-K2.5",
            "name": "Kimi K2.5"
        },
        {
            "id": "zai-org/GLM-5.2",
            "name": "GLM 5.2"
        },
        {
            "id": "zai-org/GLM-5.2-Fast",
            "name": "GLM 5.2 Fast"
        },
        {
            "id": "zai-org/GLM-5.1",
            "name": "GLM 5.1"
        },
        {
            "id": "zai-org/GLM-5",
            "name": "GLM 5"
        },
        {
            "id": "MiniMaxAI/MiniMax-M3",
            "name": "MiniMax M3"
        },
        {
            "id": "MiniMaxAI/MiniMax-M2.7",
            "name": "MiniMax M2.7"
        },
        {
            "id": "MiniMaxAI/MiniMax-M2.5",
            "name": "MiniMax M2.5"
        },
        {
            "id": "xiaomi/mimo-v2.5-pro",
            "name": "MiMo V2.5 Pro"
        },
        {
            "id": "xiaomi/mimo-v2.5",
            "name": "MiMo V2.5"
        },
        {
            "id": "Qwen/Qwen3.6-Max-Preview",
            "name": "Qwen 3.6 Max Preview"
        },
        {
            "id": "Qwen/Qwen3.6-Plus",
            "name": "Qwen 3.6 Plus"
        },
        {
            "id": "Qwen/Qwen3.7-Max",
            "name": "Qwen 3.7 Max"
        },
        {
            "id": "Qwen/Qwen3.7-Plus",
            "name": "Qwen 3.7 Plus"
        },
        {
            "id": "stepfun/Step-3.7-Flash",
            "name": "Step 3.7 Flash"
        },
        {
            "id": "stepfun/Step-3.5-Flash",
            "name": "Step 3.5 Flash"
        },
        {
            "id": "nvidia/nemotron-3-ultra-550b-a55b",
            "name": "Nemotron 3 Ultra"
        }
    ],
    "featherless": [
        {
            "id": "deepseek-ai/DeepSeek-V4-Pro",
            "name": "DeepSeek V4 Pro"
        },
        {
            "id": "deepseek-ai/DeepSeek-V4-Flash",
            "name": "DeepSeek V4 Flash"
        },
        {
            "id": "zai-org/GLM-5.2",
            "name": "GLM 5.2"
        },
        {
            "id": "zai-org/GLM-5.1",
            "name": "GLM 5.1"
        },
        {
            "id": "moonshotai/Kimi-K2.7-Code",
            "name": "Kimi K2.7 Code"
        },
        {
            "id": "moonshotai/Kimi-K2.6",
            "name": "Kimi K2.6"
        },
        {
            "id": "moonshotai/Kimi-K2.5",
            "name": "Kimi K2.5"
        }
    ],
    "fireworks": [
        {
            "id": "accounts/fireworks/models/deepseek-v3p1",
            "name": "DeepSeek V3.1"
        },
        {
            "id": "accounts/fireworks/models/llama-v3p3-70b-instruct",
            "name": "Llama 3.3 70B"
        },
        {
            "id": "accounts/fireworks/models/qwen3-235b-a22b",
            "name": "Qwen3 235B"
        },
        {
            "id": "nomic-ai/nomic-embed-text-v1.5",
            "name": "Nomic Embed Text v1.5",
            "kind": "embedding"
        }
    ],
    "glm-cn": [
        {
            "id": "glm-5.3",
            "name": "GLM 5.3"
        },
        {
            "id": "glm-5.3-flash",
            "name": "GLM 5.3 Flash (Vision)"
        },
        {
            "id": "glm-5.2",
            "name": "GLM 5.2"
        },
        {
            "id": "glm-5.1",
            "name": "GLM 5.1"
        },
        {
            "id": "glm-5-turbo",
            "name": "GLM 5 Turbo"
        },
        {
            "id": "glm-5",
            "name": "GLM 5"
        },
        {
            "id": "glm-4.7",
            "name": "GLM-4.7"
        },
        {
            "id": "glm-4.6v",
            "name": "GLM 4.6V (Vision)"
        },
        {
            "id": "glm-4.6",
            "name": "GLM-4.6"
        },
        {
            "id": "glm-4.5-air",
            "name": "GLM-4.5-Air"
        }
    ],
    "glm": [
        {
            "id": "glm-5.3",
            "name": "GLM 5.3"
        },
        {
            "id": "glm-5.3-flash",
            "name": "GLM 5.3 Flash (Vision)"
        },
        {
            "id": "glm-5.2",
            "name": "GLM 5.2"
        },
        {
            "id": "glm-5.1",
            "name": "GLM 5.1"
        },
        {
            "id": "glm-5-turbo",
            "name": "GLM 5 Turbo"
        },
        {
            "id": "glm-5",
            "name": "GLM 5"
        },
        {
            "id": "glm-4.7",
            "name": "GLM 4.7"
        },
        {
            "id": "glm-4.6v",
            "name": "GLM 4.6V (Vision)"
        }
    ],
    "groq": [
        {
            "id": "llama-3.3-70b-versatile",
            "name": "Llama 3.3 70B"
        },
        {
            "id": "meta-llama/llama-4-maverick-17b-128e-instruct",
            "name": "Llama 4 Maverick"
        },
        {
            "id": "qwen/qwen3-32b",
            "name": "Qwen3 32B"
        },
        {
            "id": "openai/gpt-oss-120b",
            "name": "GPT-OSS 120B"
        },
        {
            "id": "whisper-large-v3",
            "name": "Whisper Large v3",
            "params": [
                "language",
                "response_format",
                "temperature",
                "prompt"
            ],
            "kind": "stt"
        },
        {
            "id": "whisper-large-v3-turbo",
            "name": "Whisper Large v3 Turbo",
            "params": [
                "language",
                "response_format",
                "temperature",
                "prompt"
            ],
            "kind": "stt"
        },
        {
            "id": "distil-whisper-large-v3-en",
            "name": "Distil Whisper Large v3 EN",
            "params": [
                "language",
                "response_format",
                "temperature",
                "prompt"
            ],
            "kind": "stt"
        }
    ],
    "hyperbolic": [
        {
            "id": "Qwen/QwQ-32B",
            "name": "QwQ 32B"
        },
        {
            "id": "deepseek-ai/DeepSeek-R1",
            "name": "DeepSeek R1"
        },
        {
            "id": "deepseek-ai/DeepSeek-V3",
            "name": "DeepSeek V3"
        },
        {
            "id": "meta-llama/Llama-3.3-70B-Instruct",
            "name": "Llama 3.3 70B"
        },
        {
            "id": "meta-llama/Llama-3.2-3B-Instruct",
            "name": "Llama 3.2 3B"
        },
        {
            "id": "Qwen/Qwen2.5-72B-Instruct",
            "name": "Qwen 2.5 72B"
        },
        {
            "id": "Qwen/Qwen2.5-Coder-32B-Instruct",
            "name": "Qwen 2.5 Coder 32B"
        },
        {
            "id": "NousResearch/Hermes-3-Llama-3.1-70B",
            "name": "Hermes 3 70B"
        }
    ],
    "minimax-cn": [
        {
            "id": "MiniMax-M3",
            "name": "MiniMax M3",
            "targetFormat": "claude"
        },
        {
            "id": "MiniMax-M2.7",
            "name": "MiniMax M2.7"
        },
        {
            "id": "MiniMax-M2.5",
            "name": "MiniMax M2.5"
        },
        {
            "id": "MiniMax-M2.1",
            "name": "MiniMax M2.1"
        },
        {
            "id": "speech-2.8-hd",
            "name": "Speech 2.8 HD",
            "kind": "tts"
        },
        {
            "id": "speech-2.8-turbo",
            "name": "Speech 2.8 Turbo",
            "kind": "tts"
        },
        {
            "id": "speech-2.6-hd",
            "name": "Speech 2.6 HD",
            "kind": "tts"
        },
        {
            "id": "speech-2.6-turbo",
            "name": "Speech 2.6 Turbo",
            "kind": "tts"
        },
        {
            "id": "speech-02-hd",
            "name": "Speech 02 HD",
            "kind": "tts"
        },
        {
            "id": "speech-02-turbo",
            "name": "Speech 02 Turbo",
            "kind": "tts"
        },
        {
            "id": "speech-01-hd",
            "name": "Speech 01 HD",
            "kind": "tts"
        },
        {
            "id": "speech-01-turbo",
            "name": "Speech 01 Turbo",
            "kind": "tts"
        }
    ],
    "mistral": [
        {
            "id": "mistral-large-latest",
            "name": "Mistral Large 3"
        },
        {
            "id": "codestral-latest",
            "name": "Codestral"
        },
        {
            "id": "mistral-medium-latest",
            "name": "Mistral Medium 3"
        },
        {
            "id": "mistral-embed",
            "name": "Mistral Embed",
            "kind": "embedding"
        }
    ],
    "nebius": [
        {
            "id": "meta-llama/Llama-3.3-70B-Instruct",
            "name": "Llama 3.3 70B Instruct"
        },
        {
            "id": "Qwen/Qwen3-Embedding-8B",
            "name": "Qwen3 Embedding 8B",
            "kind": "embedding"
        }
    ],
    "nvidia": [
        {
            "id": "minimaxai/minimax-m2.7",
            "name": "MiniMax M2.7"
        },
        {
            "id": "minimaxai/minimax-m3",
            "name": "MiniMax M3"
        },
        {
            "id": "z-ai/glm-5.2",
            "name": "GLM 5.2"
        },
        {
            "id": "deepseek-ai/deepseek-v4-pro",
            "name": "DeepSeek V4 Pro"
        },
        {
            "id": "deepseek-ai/deepseek-v4-flash",
            "name": "DeepSeek V4 Flash"
        },
        {
            "id": "moonshotai/kimi-k2.6",
            "name": "Kimi K2.6"
        },
        {
            "id": "nvidia/nemotron-3-ultra-550b-a55b",
            "name": "Nemotron 3 Ultra"
        },
        {
            "id": "nvidia/nv-embedqa-e5-v5",
            "name": "NV EmbedQA E5 v5",
            "kind": "embedding"
        },
        {
            "id": "nvidia/parakeet-ctc-1.1b-asr",
            "name": "Parakeet CTC 1.1B",
            "params": [
                "language"
            ],
            "kind": "stt"
        },
        {
            "id": "fastpitch",
            "name": "FastPitch",
            "kind": "tts"
        },
        {
            "id": "tacotron2",
            "name": "Tacotron2",
            "kind": "tts"
        }
    ],
    "ollama": [
        {
            "id": "gpt-oss:120b",
            "name": "GPT OSS 120B"
        },
        {
            "id": "kimi-k2.5",
            "name": "Kimi K2.5"
        },
        {
            "id": "glm-5",
            "name": "GLM 5"
        },
        {
            "id": "minimax-m2.5",
            "name": "MiniMax M2.5"
        },
        {
            "id": "glm-4.7-flash",
            "name": "GLM 4.7 Flash"
        },
        {
            "id": "qwen3.5",
            "name": "Qwen3.5"
        },
        {
            "id": "minimax-m3",
            "name": "MiniMax M3"
        },
        {
            "id": "deepseek-v4.1-flash:cloud",
            "name": "DeepSeek V4.1 Flash"
        }
    ],
    "opencode-go": [
        {
            "id": "deepseek-flash",
            "name": "DeepSeek V4.1 Flash",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "glm-5.3-flash",
            "name": "GLM 5.3 Flash (Vision)",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "glm-5.3",
            "name": "GLM 5.3",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "glm-5.2",
            "name": "GLM 5.2",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "glm-5.1",
            "name": "GLM 5.1",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "kimi-k2.7-code",
            "name": "Kimi K2.7 Code",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "kimi-k2.6",
            "name": "Kimi K2.6",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "kimi-k3",
            "name": "Kimi K3",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "deepseek-v4-pro",
            "name": "DeepSeek V4 Pro",
            "supportedFormats": [
                "openai",
                "claude",
                "openai-responses"
            ]
        },
        {
            "id": "deepseek-v4-flash",
            "name": "DeepSeek V4 Flash",
            "supportedFormats": [
                "openai",
                "claude",
                "openai-responses"
            ]
        },
        {
            "id": "deepseek-v4-flash-vision-exp",
            "name": "DeepSeek V4 Flash Vision (Exp)",
            "supportedFormats": [
                "openai",
                "claude",
                "openai-responses"
            ]
        },
        {
            "id": "longcat-2.0",
            "name": "LongCat 2.0",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "mimo-v2.5",
            "name": "MiMo V2.5",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "mimo-v2.5-pro",
            "name": "MiMo V2.5 Pro",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "minimax-m3",
            "name": "MiniMax M3",
            "supportedFormats": [
                "openai",
                "claude"
            ]
        },
        {
            "id": "minimax-m2.7",
            "name": "MiniMax M2.7",
            "supportedFormats": [
                "openai",
                "claude"
            ]
        },
        {
            "id": "minimax-m2.5",
            "name": "MiniMax M2.5",
            "supportedFormats": [
                "openai",
                "claude"
            ]
        },
        {
            "id": "qwen3.8-max",
            "name": "Qwen 3.8 Max",
            "supportedFormats": [
                "openai",
                "claude"
            ]
        },
        {
            "id": "qwen3.8-flash",
            "name": "Qwen 3.8 Flash",
            "supportedFormats": [
                "openai",
                "claude"
            ]
        },
        {
            "id": "qwen3.7-max",
            "name": "Qwen 3.7 Max",
            "supportedFormats": [
                "openai",
                "claude"
            ]
        },
        {
            "id": "qwen3.7-plus",
            "name": "Qwen 3.7 Plus",
            "supportedFormats": [
                "openai",
                "claude"
            ]
        },
        {
            "id": "qwen3.6-plus",
            "name": "Qwen 3.6 Plus",
            "supportedFormats": [
                "openai",
                "claude"
            ]
        },
        {
            "id": "hy4-preview",
            "name": "Hy4 Preview",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "hy3",
            "name": "Hy3",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "grok-4.6",
            "name": "Grok 4.6",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.6-luna",
            "name": "GPT 5.6 Luna",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "muse-spark-1.2-contributor",
            "name": "Muse Spark 1.2 Contributor",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "muse-spark-1.3-contributor",
            "name": "Muse Spark 1.3 Contributor",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        }
    ],
    "opencode-zen": [
        {
            "id": "claude-fable-5",
            "name": "Claude Fable 5",
            "supportedFormats": [
                "claude"
            ]
        },
        {
            "id": "claude-fable-5-1",
            "name": "Claude Fable 5.1",
            "supportedFormats": [
                "claude"
            ]
        },
        {
            "id": "claude-opus-5",
            "name": "Claude Opus 5",
            "supportedFormats": [
                "claude"
            ]
        },
        {
            "id": "claude-opus-4-8",
            "name": "Claude Opus 4.8",
            "supportedFormats": [
                "claude"
            ]
        },
        {
            "id": "claude-opus-4-7",
            "name": "Claude Opus 4.7",
            "supportedFormats": [
                "claude"
            ]
        },
        {
            "id": "claude-opus-4-6",
            "name": "Claude Opus 4.6",
            "supportedFormats": [
                "claude"
            ]
        },
        {
            "id": "claude-opus-4-5",
            "name": "Claude Opus 4.5",
            "supportedFormats": [
                "claude"
            ]
        },
        {
            "id": "claude-sonnet-5",
            "name": "Claude Sonnet 5",
            "supportedFormats": [
                "claude"
            ]
        },
        {
            "id": "claude-sonnet-4-6",
            "name": "Claude Sonnet 4.6",
            "supportedFormats": [
                "claude"
            ]
        },
        {
            "id": "claude-sonnet-4-5",
            "name": "Claude Sonnet 4.5",
            "supportedFormats": [
                "claude"
            ]
        },
        {
            "id": "claude-sonnet-4",
            "name": "Claude Sonnet 4",
            "supportedFormats": [
                "claude"
            ]
        },
        {
            "id": "claude-haiku-4-5",
            "name": "Claude Haiku 4.5",
            "supportedFormats": [
                "claude"
            ]
        },
        {
            "id": "gemini-3.6-flash",
            "name": "Gemini 3.6 Flash",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "gemini-3.8-flash",
            "name": "Gemini 3.8 Flash",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "gemini-3.7-flash",
            "name": "Gemini 3.7 Flash",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "gemini-3.5-flash-lite",
            "name": "Gemini 3.5 Flash Lite",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "gemini-3.5-flash",
            "name": "Gemini 3.5 Flash",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "gemini-3.1-pro",
            "name": "Gemini 3.1 Pro",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "gemini-3-flash",
            "name": "Gemini 3 Flash",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "gpt-6-astra",
            "name": "GPT 6 Astra",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.6-sol",
            "name": "GPT 5.6 Sol",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.6-terra",
            "name": "GPT 5.6 Terra",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.6-luna",
            "name": "GPT 5.6 Luna",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.5",
            "name": "GPT 5.5",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.5-pro",
            "name": "GPT 5.5 Pro",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.4",
            "name": "GPT 5.4",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.4-pro",
            "name": "GPT 5.4 Pro",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.4-mini",
            "name": "GPT 5.4 Mini",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.4-nano",
            "name": "GPT 5.4 Nano",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.3-codex-spark",
            "name": "GPT 5.3 Codex Spark",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.3-codex",
            "name": "GPT 5.3 Codex",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.2",
            "name": "GPT 5.2",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.2-codex",
            "name": "GPT 5.2 Codex",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.1",
            "name": "GPT 5.1",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.1-codex-max",
            "name": "GPT 5.1 Codex Max",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.1-codex",
            "name": "GPT 5.1 Codex",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.1-codex-mini",
            "name": "GPT 5.1 Codex Mini",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5",
            "name": "GPT 5",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5-codex",
            "name": "GPT 5 Codex",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5-nano",
            "name": "GPT 5 Nano",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "grok-build-0.1",
            "name": "Grok Build 0.1",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "grok-4.6",
            "name": "Grok 4.6",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "grok-4.5",
            "name": "Grok 4.5",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "muse-spark-1.3",
            "name": "Muse Spark 1.3",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "muse-spark-1.2",
            "name": "Muse Spark 1.2",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "qwen3.6-plus",
            "name": "Qwen 3.6 Plus",
            "supportedFormats": [
                "claude"
            ]
        },
        {
            "id": "qwen3.5-plus",
            "name": "Qwen 3.5 Plus",
            "supportedFormats": [
                "claude"
            ]
        },
        {
            "id": "deepseek-v4-pro",
            "name": "DeepSeek V4 Pro",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "deepseek-v4-flash",
            "name": "DeepSeek V4 Flash",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "deepseek-v4-flash-vision-exp",
            "name": "DeepSeek V4 Flash Vision Exp",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "glm-5.3-flash",
            "name": "GLM 5.3 Flash (Vision)",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "glm-5.3",
            "name": "GLM 5.3",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "glm-5.2",
            "name": "GLM 5.2",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "glm-5.1",
            "name": "GLM 5.1",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "glm-5",
            "name": "GLM 5",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "minimax-m3",
            "name": "MiniMax M3",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "minimax-m2.7",
            "name": "MiniMax M2.7",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "minimax-m2.5",
            "name": "MiniMax M2.5",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "kimi-k3",
            "name": "Kimi K3",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "kimi-k2.7-code",
            "name": "Kimi K2.7 Code",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "kimi-k2.6",
            "name": "Kimi K2.6",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "kimi-k2.5",
            "name": "Kimi K2.5",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "big-pickle",
            "name": "Big Pickle",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "union-alpha",
            "name": "Union Alpha",
            "supportedFormats": [
                "claude"
            ]
        },
        {
            "id": "deepseek-v4-flash-free",
            "name": "DeepSeek V4 Flash Free",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "mimo-v2.6-flash-free",
            "name": "MiMo V2.6 Flash Free",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "mimo-v2.5-free",
            "name": "MiMo V2.5 Free",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "ling-3.0-flash-fin-free",
            "name": "Ling 3.0 Flash Fin Free",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "nemotron-3-ultra-free",
            "name": "Nemotron 3 Ultra Free",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "nemotron-3.5-lightning-free",
            "name": "Nemotron 3.5 Lightning Free",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "muse-spark-1.3-contributor-free",
            "name": "Muse Spark 1.3 Contributor Free",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "muse-spark-1.2-contributor-free",
            "name": "Muse Spark 1.2 Contributor Free",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "jev-1.13",
            "name": "Jev 1.13",
            "kind": "systemone"
        },
        {
            "id": "jev-1.13-free",
            "name": "Jev 1.13 Free",
            "kind": "systemone"
        }
    ],
    "ocz": [
        {
            "id": "claude-fable-5",
            "name": "Claude Fable 5",
            "supportedFormats": [
                "claude"
            ]
        },
        {
            "id": "claude-fable-5-1",
            "name": "Claude Fable 5.1",
            "supportedFormats": [
                "claude"
            ]
        },
        {
            "id": "claude-opus-5",
            "name": "Claude Opus 5",
            "supportedFormats": [
                "claude"
            ]
        },
        {
            "id": "claude-opus-4-8",
            "name": "Claude Opus 4.8",
            "supportedFormats": [
                "claude"
            ]
        },
        {
            "id": "claude-opus-4-7",
            "name": "Claude Opus 4.7",
            "supportedFormats": [
                "claude"
            ]
        },
        {
            "id": "claude-opus-4-6",
            "name": "Claude Opus 4.6",
            "supportedFormats": [
                "claude"
            ]
        },
        {
            "id": "claude-opus-4-5",
            "name": "Claude Opus 4.5",
            "supportedFormats": [
                "claude"
            ]
        },
        {
            "id": "claude-sonnet-5",
            "name": "Claude Sonnet 5",
            "supportedFormats": [
                "claude"
            ]
        },
        {
            "id": "claude-sonnet-4-6",
            "name": "Claude Sonnet 4.6",
            "supportedFormats": [
                "claude"
            ]
        },
        {
            "id": "claude-sonnet-4-5",
            "name": "Claude Sonnet 4.5",
            "supportedFormats": [
                "claude"
            ]
        },
        {
            "id": "claude-sonnet-4",
            "name": "Claude Sonnet 4",
            "supportedFormats": [
                "claude"
            ]
        },
        {
            "id": "claude-haiku-4-5",
            "name": "Claude Haiku 4.5",
            "supportedFormats": [
                "claude"
            ]
        },
        {
            "id": "gemini-3.6-flash",
            "name": "Gemini 3.6 Flash",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "gemini-3.8-flash",
            "name": "Gemini 3.8 Flash",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "gemini-3.7-flash",
            "name": "Gemini 3.7 Flash",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "gemini-3.5-flash-lite",
            "name": "Gemini 3.5 Flash Lite",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "gemini-3.5-flash",
            "name": "Gemini 3.5 Flash",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "gemini-3.1-pro",
            "name": "Gemini 3.1 Pro",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "gemini-3-flash",
            "name": "Gemini 3 Flash",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "gpt-6-astra",
            "name": "GPT 6 Astra",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.6-sol",
            "name": "GPT 5.6 Sol",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.6-terra",
            "name": "GPT 5.6 Terra",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.6-luna",
            "name": "GPT 5.6 Luna",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.5",
            "name": "GPT 5.5",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.5-pro",
            "name": "GPT 5.5 Pro",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.4",
            "name": "GPT 5.4",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.4-pro",
            "name": "GPT 5.4 Pro",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.4-mini",
            "name": "GPT 5.4 Mini",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.4-nano",
            "name": "GPT 5.4 Nano",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.3-codex-spark",
            "name": "GPT 5.3 Codex Spark",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.3-codex",
            "name": "GPT 5.3 Codex",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.2",
            "name": "GPT 5.2",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.2-codex",
            "name": "GPT 5.2 Codex",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.1",
            "name": "GPT 5.1",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.1-codex-max",
            "name": "GPT 5.1 Codex Max",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.1-codex",
            "name": "GPT 5.1 Codex",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5.1-codex-mini",
            "name": "GPT 5.1 Codex Mini",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5",
            "name": "GPT 5",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5-codex",
            "name": "GPT 5 Codex",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "gpt-5-nano",
            "name": "GPT 5 Nano",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "grok-build-0.1",
            "name": "Grok Build 0.1",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "grok-4.6",
            "name": "Grok 4.6",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "grok-4.5",
            "name": "Grok 4.5",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "muse-spark-1.3",
            "name": "Muse Spark 1.3",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "muse-spark-1.2",
            "name": "Muse Spark 1.2",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "qwen3.6-plus",
            "name": "Qwen 3.6 Plus",
            "supportedFormats": [
                "claude"
            ]
        },
        {
            "id": "qwen3.5-plus",
            "name": "Qwen 3.5 Plus",
            "supportedFormats": [
                "claude"
            ]
        },
        {
            "id": "deepseek-v4-pro",
            "name": "DeepSeek V4 Pro",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "deepseek-v4-flash",
            "name": "DeepSeek V4 Flash",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "deepseek-v4-flash-vision-exp",
            "name": "DeepSeek V4 Flash Vision Exp",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "glm-5.3-flash",
            "name": "GLM 5.3 Flash (Vision)",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "glm-5.3",
            "name": "GLM 5.3",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "glm-5.2",
            "name": "GLM 5.2",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "glm-5.1",
            "name": "GLM 5.1",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "glm-5",
            "name": "GLM 5",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "minimax-m3",
            "name": "MiniMax M3",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "minimax-m2.7",
            "name": "MiniMax M2.7",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "minimax-m2.5",
            "name": "MiniMax M2.5",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "kimi-k3",
            "name": "Kimi K3",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "kimi-k2.7-code",
            "name": "Kimi K2.7 Code",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "kimi-k2.6",
            "name": "Kimi K2.6",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "kimi-k2.5",
            "name": "Kimi K2.5",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "big-pickle",
            "name": "Big Pickle",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "union-alpha",
            "name": "Union Alpha",
            "supportedFormats": [
                "claude"
            ]
        },
        {
            "id": "deepseek-v4-flash-free",
            "name": "DeepSeek V4 Flash Free",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "mimo-v2.6-flash-free",
            "name": "MiMo V2.6 Flash Free",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "mimo-v2.5-free",
            "name": "MiMo V2.5 Free",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "ling-3.0-flash-fin-free",
            "name": "Ling 3.0 Flash Fin Free",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "nemotron-3-ultra-free",
            "name": "Nemotron 3 Ultra Free",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "nemotron-3.5-lightning-free",
            "name": "Nemotron 3.5 Lightning Free",
            "supportedFormats": [
                "openai"
            ]
        },
        {
            "id": "muse-spark-1.3-contributor-free",
            "name": "Muse Spark 1.3 Contributor Free",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "muse-spark-1.2-contributor-free",
            "name": "Muse Spark 1.2 Contributor Free",
            "targetFormat": "openai-responses",
            "supportedFormats": [
                "openai-responses"
            ]
        },
        {
            "id": "jev-1.13",
            "name": "Jev 1.13",
            "kind": "systemone"
        },
        {
            "id": "jev-1.13-free",
            "name": "Jev 1.13 Free",
            "kind": "systemone"
        }
    ],
    "perplexity": [
        {
            "id": "sonar-pro",
            "name": "Sonar Pro"
        },
        {
            "id": "sonar",
            "name": "Sonar"
        }
    ],
    "perplexity-agent": [
        {
            "id": "perplexity/sonar",
            "name": "Perplexity Sonar"
        },
        {
            "id": "openai/gpt-5.5",
            "name": "GPT-5.5"
        },
        {
            "id": "openai/gpt-5.4",
            "name": "GPT-5.4"
        },
        {
            "id": "openai/gpt-5.4-mini",
            "name": "GPT-5.4 Mini"
        },
        {
            "id": "anthropic/claude-sonnet-4-6",
            "name": "Claude Sonnet 4.6"
        },
        {
            "id": "anthropic/claude-opus-4-8",
            "name": "Claude Opus 4.8"
        },
        {
            "id": "google/gemini-3.1-pro-preview",
            "name": "Gemini 3.1 Pro"
        },
        {
            "id": "xai/grok-4.20-reasoning",
            "name": "Grok 4.20 Reasoning"
        },
        {
            "id": "perplexity/glm-5.2",
            "name": "GLM 5.2"
        },
        {
            "id": "perplexity/kimi-k2.7-code",
            "name": "Kimi K2.7 Code"
        },
        {
            "id": "nvidia/nemotron-3-super-120b-a12b",
            "name": "Nemotron 3 Super 120B"
        }
    ],
    "siliconflow": [
        {
            "id": "deepseek-ai/DeepSeek-V4-Pro",
            "name": "DeepSeek V4 Pro"
        },
        {
            "id": "deepseek-ai/DeepSeek-V4-Flash",
            "name": "DeepSeek V4 Flash"
        },
        {
            "id": "deepseek-ai/DeepSeek-V3.2",
            "name": "DeepSeek V3.2"
        },
        {
            "id": "deepseek-ai/DeepSeek-V3.2-Exp",
            "name": "DeepSeek V3.2 Exp"
        },
        {
            "id": "deepseek-ai/DeepSeek-V3.1",
            "name": "DeepSeek V3.1"
        },
        {
            "id": "deepseek-ai/DeepSeek-V3.1-Terminus",
            "name": "DeepSeek V3.1 Terminus"
        },
        {
            "id": "deepseek-ai/DeepSeek-R1",
            "name": "DeepSeek R1"
        },
        {
            "id": "Qwen/Qwen3.5-397B-A17B",
            "name": "Qwen 3.5 397B A17B"
        },
        {
            "id": "Qwen/Qwen3.5-122B-A10B",
            "name": "Qwen 3.5 122B A10B"
        },
        {
            "id": "zai-org/GLM-5.1",
            "name": "GLM 5.1"
        },
        {
            "id": "zai-org/GLM-5",
            "name": "GLM 5"
        },
        {
            "id": "moonshotai/Kimi-K2.6",
            "name": "Kimi K2.6"
        },
        {
            "id": "moonshotai/Kimi-K2.5",
            "name": "Kimi K2.5"
        },
        {
            "id": "openai/gpt-oss-120b",
            "name": "GPT OSS 120B"
        },
        {
            "id": "MiniMaxAI/MiniMax-M2.5",
            "name": "MiniMax M2.5"
        },
        {
            "id": "inclusionAI/Ling-flash-2.0",
            "name": "Ling Flash 2.0"
        }
    ],
    "together": [
        {
            "id": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
            "name": "Llama 3.3 70B Turbo"
        },
        {
            "id": "deepseek-ai/DeepSeek-R1",
            "name": "DeepSeek R1"
        },
        {
            "id": "Qwen/Qwen3-235B-A22B",
            "name": "Qwen3 235B"
        },
        {
            "id": "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
            "name": "Llama 4 Maverick"
        },
        {
            "id": "BAAI/bge-large-en-v1.5",
            "name": "BGE Large EN v1.5",
            "kind": "embedding"
        },
        {
            "id": "togethercomputer/m2-bert-80M-8k-retrieval",
            "name": "M2 BERT 80M 8K",
            "kind": "embedding"
        }
    ],
    "venice": [
        {
            "id": "venice-uncensored-1-2",
            "name": "Venice Uncensored 1.2"
        },
        {
            "id": "zai-org-glm-5",
            "name": "GLM-5"
        },
        {
            "id": "qwen3-235b-a22b-instruct-2507",
            "name": "Qwen3 235B A22B Instruct"
        },
        {
            "id": "qwen3-coder-480b-a35b-instruct-turbo",
            "name": "Qwen3 Coder 480B A35B Turbo"
        },
        {
            "id": "qwen3-vl-235b-a22b",
            "name": "Qwen3 VL 235B A22B"
        },
        {
            "id": "deepseek-v4-pro",
            "name": "DeepSeek V4 Pro"
        },
        {
            "id": "llama-3.3-70b",
            "name": "Llama 3.3 70B"
        },
        {
            "id": "hermes-3-llama-3.1-405b",
            "name": "Hermes 3 Llama 3.1 405B"
        },
        {
            "id": "mistral-small-3-2-24b-instruct",
            "name": "Mistral Small 3.2 24B"
        },
        {
            "id": "text-embedding-3-large",
            "name": "Text Embedding 3 Large",
            "kind": "embedding"
        },
        {
            "id": "text-embedding-bge-m3",
            "name": "BGE-M3 Embedding",
            "kind": "embedding"
        },
        {
            "id": "text-embedding-qwen3-8b",
            "name": "Qwen3 8B Embedding",
            "kind": "embedding"
        },
        {
            "id": "venice-sd35",
            "name": "Venice SD3.5",
            "params": [
                "n",
                "size"
            ],
            "kind": "image"
        },
        {
            "id": "flux-2-pro",
            "name": "FLUX.2 Pro",
            "params": [
                "n",
                "size"
            ],
            "kind": "image"
        },
        {
            "id": "gpt-image-2",
            "name": "GPT Image 2 (via Venice)",
            "params": [
                "n",
                "size",
                "quality"
            ],
            "kind": "image"
        }
    ],
    "vercel-ai-gateway": [],
    "vertex-partner": [
        {
            "id": "deepseek-ai/deepseek-v3.2-maas",
            "name": "DeepSeek V3.2 (Vertex)"
        },
        {
            "id": "qwen/qwen3-next-80b-a3b-thinking-maas",
            "name": "Qwen3 Next 80B Thinking (Vertex)"
        },
        {
            "id": "qwen/qwen3-next-80b-a3b-instruct-maas",
            "name": "Qwen3 Next 80B Instruct (Vertex)"
        },
        {
            "id": "zai-org/glm-5-maas",
            "name": "GLM-5 (Vertex)"
        }
    ],
    "vertex": [
        {
            "id": "gemini-3.1-pro-preview",
            "name": "Gemini 3.1 Pro Preview"
        },
        {
            "id": "gemini-3.1-flash-lite-preview",
            "name": "Gemini 3.1 Flash Lite Preview"
        },
        {
            "id": "gemini-3-flash-preview",
            "name": "Gemini 3 Flash Preview"
        },
        {
            "id": "gemini-2.5-flash",
            "name": "Gemini 2.5 Flash"
        },
        {
            "id": "veo-3.1-generate-preview",
            "name": "Veo 3.1 (Preview)",
            "params": [
                "duration",
                "aspect_ratio",
                "resolution",
                "negative_prompt",
                "seed",
                "storage_uri",
                "generate_audio"
            ],
            "kind": "video"
        },
        {
            "id": "veo-3.1-fast-generate-preview",
            "name": "Veo 3.1 Fast (Preview)",
            "params": [
                "duration",
                "aspect_ratio",
                "resolution",
                "negative_prompt",
                "seed",
                "storage_uri",
                "generate_audio"
            ],
            "kind": "video"
        },
        {
            "id": "veo-3.0-generate-001",
            "name": "Veo 3",
            "params": [
                "duration",
                "aspect_ratio",
                "resolution",
                "negative_prompt",
                "seed",
                "storage_uri",
                "generate_audio"
            ],
            "kind": "video"
        },
        {
            "id": "veo-2.0-generate-001",
            "name": "Veo 2",
            "params": [
                "duration",
                "aspect_ratio",
                "negative_prompt",
                "seed",
                "storage_uri"
            ],
            "kind": "video"
        }
    ],
    "volcengine-ark": [
        {
            "id": "Doubao-Seed-2.0-Code",
            "name": "Doubao-Seed-2.0-Code"
        },
        {
            "id": "Doubao-Seed-2.0-pro",
            "name": "Doubao-Seed-2.0-pro"
        },
        {
            "id": "Doubao-Seed-2.0-lite",
            "name": "Doubao-Seed-2.0-lite"
        },
        {
            "id": "Doubao-Seed-Code",
            "name": "Doubao-Seed-Code"
        },
        {
            "id": "DeepSeek-V4-Flash",
            "name": "DeepSeek-V4-Flash"
        },
        {
            "id": "DeepSeek-V4-Pro",
            "name": "DeepSeek-V4-Pro"
        },
        {
            "id": "GLM-5.1",
            "name": "GLM-5.1"
        },
        {
            "id": "MiniMax-M2.7",
            "name": "MiniMax-M2.7"
        },
        {
            "id": "Kimi-K2.6",
            "name": "Kimi-K2.6"
        }
    ],
    "alims-intl": [
        {
            "id": "qwen3.5-plus",
            "name": "Qwen3.5 Plus"
        },
        {
            "id": "kimi-k2.5",
            "name": "Kimi K2.5"
        },
        {
            "id": "glm-5",
            "name": "GLM 5"
        },
        {
            "id": "MiniMax-M2.5",
            "name": "MiniMax M2.5"
        },
        {
            "id": "qwen3-coder-next",
            "name": "Qwen3 Coder Next"
        },
        {
            "id": "qwen3-coder-plus",
            "name": "Qwen3 Coder Plus"
        },
        {
            "id": "glm-4.7",
            "name": "GLM 4.7"
        }
    ],
    "api-airforce": [
        {
            "id": "gpt-oss-120b",
            "name": "GPT-OSS 120B (Free)",
            "contextLength": 131072
        },
        {
            "id": "gpt-oss-20b",
            "name": "GPT-OSS 20B (Free)",
            "contextLength": 131072
        },
        {
            "id": "kimi-k2.7-code",
            "name": "Kimi K2.7 Code (Free)",
            "contextLength": 262144
        }
    ],
    "af": [
        {
            "id": "gpt-oss-120b",
            "name": "GPT-OSS 120B (Free)",
            "contextLength": 131072
        },
        {
            "id": "gpt-oss-20b",
            "name": "GPT-OSS 20B (Free)",
            "contextLength": 131072
        },
        {
            "id": "kimi-k2.7-code",
            "name": "Kimi K2.7 Code (Free)",
            "contextLength": 262144
        }
    ],
    "baidu": [
        {
            "id": "deepseek-v4-pro",
            "name": "DeepSeek V4 Pro",
            "contextLength": 1048576
        },
        {
            "id": "deepseek-v4-flash",
            "name": "DeepSeek V4 Flash",
            "contextLength": 1048576
        },
        {
            "id": "glm-5.2",
            "name": "GLM 5.2",
            "contextLength": 512000
        },
        {
            "id": "glm-5.1",
            "name": "GLM 5.1",
            "contextLength": 198000
        },
        {
            "id": "kimi-k2.6",
            "name": "Kimi K2.6",
            "contextLength": 262144
        },
        {
            "id": "qwen3.5-397b-a17b",
            "name": "Qwen 3.5 397B A17B",
            "contextLength": 262144
        },
        {
            "id": "qwen3.5-27b",
            "name": "Qwen 3.5 27B",
            "contextLength": 262144
        }
    ],
    "qianfan": [
        {
            "id": "deepseek-v4-pro",
            "name": "DeepSeek V4 Pro",
            "contextLength": 1048576
        },
        {
            "id": "deepseek-v4-flash",
            "name": "DeepSeek V4 Flash",
            "contextLength": 1048576
        },
        {
            "id": "glm-5.2",
            "name": "GLM 5.2",
            "contextLength": 512000
        },
        {
            "id": "glm-5.1",
            "name": "GLM 5.1",
            "contextLength": 198000
        },
        {
            "id": "kimi-k2.6",
            "name": "Kimi K2.6",
            "contextLength": 262144
        },
        {
            "id": "qwen3.5-397b-a17b",
            "name": "Qwen 3.5 397B A17B",
            "contextLength": 262144
        },
        {
            "id": "qwen3.5-27b",
            "name": "Qwen 3.5 27B",
            "contextLength": 262144
        }
    ],
    "bazaarlink": [
        {
            "id": "auto:free",
            "name": "Auto Free (Zero Cost)"
        },
        {
            "id": "claude-opus-4.7",
            "name": "Claude Opus 4.7",
            "contextLength": 1000000
        },
        {
            "id": "claude-sonnet-4.6",
            "name": "Claude Sonnet 4.6",
            "contextLength": 1000000
        },
        {
            "id": "claude-haiku-4.5",
            "name": "Claude Haiku 4.5",
            "contextLength": 200000
        },
        {
            "id": "gpt-5.5",
            "name": "GPT-5.5",
            "contextLength": 1050000
        },
        {
            "id": "gpt-5.4",
            "name": "GPT-5.4",
            "contextLength": 1050000
        },
        {
            "id": "gpt-5.4-mini",
            "name": "GPT-5.4 Mini",
            "contextLength": 400000
        },
        {
            "id": "gpt-5.4-nano",
            "name": "GPT-5.4 Nano",
            "contextLength": 400000
        },
        {
            "id": "grok-4.3",
            "name": "Grok 4.3",
            "contextLength": 1000000
        },
        {
            "id": "grok-4.20",
            "name": "Grok 4.20",
            "contextLength": 2000000
        },
        {
            "id": "gemini-3.1-pro-preview",
            "name": "Gemini 3.1 Pro",
            "contextLength": 1048576
        },
        {
            "id": "gemini-3-flash-preview",
            "name": "Gemini 3 Flash",
            "contextLength": 1048576
        },
        {
            "id": "gemini-3.1-flash-lite-preview",
            "name": "Gemini 3.1 Flash Lite",
            "contextLength": 1048576
        },
        {
            "id": "kimi-k2.6",
            "name": "Kimi K2.6",
            "contextLength": 262144
        },
        {
            "id": "kimi-k2.5",
            "name": "Kimi K2.5",
            "contextLength": 262144
        },
        {
            "id": "glm-5.1",
            "name": "GLM 5.1",
            "contextLength": 204800
        },
        {
            "id": "glm-5",
            "name": "GLM 5",
            "contextLength": 204800
        },
        {
            "id": "mimo-v2.5-pro",
            "name": "MiMo-V2.5-Pro",
            "contextLength": 1050000
        },
        {
            "id": "mimo-v2.5",
            "name": "MiMo-V2.5",
            "contextLength": 1050000
        },
        {
            "id": "minimax-m3",
            "name": "MiniMax M3",
            "contextLength": 1048576
        },
        {
            "id": "minimax-m2.7",
            "name": "MiniMax M2.7",
            "contextLength": 204800
        },
        {
            "id": "minimax-m2.5",
            "name": "MiniMax M2.5",
            "contextLength": 204800
        },
        {
            "id": "qwen3.6-plus",
            "name": "Qwen 3.6 Plus",
            "contextLength": 1000000
        },
        {
            "id": "nemotron-3-super-120b-a12b",
            "name": "Nemotron 3 Super",
            "contextLength": 1000000
        }
    ],
    "bzl": [
        {
            "id": "auto:free",
            "name": "Auto Free (Zero Cost)"
        },
        {
            "id": "claude-opus-4.7",
            "name": "Claude Opus 4.7",
            "contextLength": 1000000
        },
        {
            "id": "claude-sonnet-4.6",
            "name": "Claude Sonnet 4.6",
            "contextLength": 1000000
        },
        {
            "id": "claude-haiku-4.5",
            "name": "Claude Haiku 4.5",
            "contextLength": 200000
        },
        {
            "id": "gpt-5.5",
            "name": "GPT-5.5",
            "contextLength": 1050000
        },
        {
            "id": "gpt-5.4",
            "name": "GPT-5.4",
            "contextLength": 1050000
        },
        {
            "id": "gpt-5.4-mini",
            "name": "GPT-5.4 Mini",
            "contextLength": 400000
        },
        {
            "id": "gpt-5.4-nano",
            "name": "GPT-5.4 Nano",
            "contextLength": 400000
        },
        {
            "id": "grok-4.3",
            "name": "Grok 4.3",
            "contextLength": 1000000
        },
        {
            "id": "grok-4.20",
            "name": "Grok 4.20",
            "contextLength": 2000000
        },
        {
            "id": "gemini-3.1-pro-preview",
            "name": "Gemini 3.1 Pro",
            "contextLength": 1048576
        },
        {
            "id": "gemini-3-flash-preview",
            "name": "Gemini 3 Flash",
            "contextLength": 1048576
        },
        {
            "id": "gemini-3.1-flash-lite-preview",
            "name": "Gemini 3.1 Flash Lite",
            "contextLength": 1048576
        },
        {
            "id": "kimi-k2.6",
            "name": "Kimi K2.6",
            "contextLength": 262144
        },
        {
            "id": "kimi-k2.5",
            "name": "Kimi K2.5",
            "contextLength": 262144
        },
        {
            "id": "glm-5.1",
            "name": "GLM 5.1",
            "contextLength": 204800
        },
        {
            "id": "glm-5",
            "name": "GLM 5",
            "contextLength": 204800
        },
        {
            "id": "mimo-v2.5-pro",
            "name": "MiMo-V2.5-Pro",
            "contextLength": 1050000
        },
        {
            "id": "mimo-v2.5",
            "name": "MiMo-V2.5",
            "contextLength": 1050000
        },
        {
            "id": "minimax-m3",
            "name": "MiniMax M3",
            "contextLength": 1048576
        },
        {
            "id": "minimax-m2.7",
            "name": "MiniMax M2.7",
            "contextLength": 204800
        },
        {
            "id": "minimax-m2.5",
            "name": "MiniMax M2.5",
            "contextLength": 204800
        },
        {
            "id": "qwen3.6-plus",
            "name": "Qwen 3.6 Plus",
            "contextLength": 1000000
        },
        {
            "id": "nemotron-3-super-120b-a12b",
            "name": "Nemotron 3 Super",
            "contextLength": 1000000
        }
    ],
    "kilo-gateway": [
        {
            "id": "kilo-auto/free",
            "name": "Kilo Auto Free",
            "contextLength": 256000
        },
        {
            "id": "nvidia/nemotron-3-super-120b-a12b:free",
            "name": "Nemotron 3 Super 120B (Free)",
            "contextLength": 262144
        },
        {
            "id": "nvidia/nemotron-3-ultra-550b-a55b:free",
            "name": "Nemotron 3 Ultra 550B (Free)",
            "contextLength": 1000000
        },
        {
            "id": "kwaipilot/kat-coder-pro-v2.5:free",
            "name": "Kat Coder Pro v2.5 (Free)",
            "contextLength": 256000
        },
        {
            "id": "kilo-auto/frontier",
            "name": "Kilo Auto Frontier",
            "contextLength": 1000000
        },
        {
            "id": "kilo-auto/balanced",
            "name": "Kilo Auto Balanced",
            "contextLength": 1000000
        }
    ],
    "kgw": [
        {
            "id": "kilo-auto/free",
            "name": "Kilo Auto Free",
            "contextLength": 256000
        },
        {
            "id": "nvidia/nemotron-3-super-120b-a12b:free",
            "name": "Nemotron 3 Super 120B (Free)",
            "contextLength": 262144
        },
        {
            "id": "nvidia/nemotron-3-ultra-550b-a55b:free",
            "name": "Nemotron 3 Ultra 550B (Free)",
            "contextLength": 1000000
        },
        {
            "id": "kwaipilot/kat-coder-pro-v2.5:free",
            "name": "Kat Coder Pro v2.5 (Free)",
            "contextLength": 256000
        },
        {
            "id": "kilo-auto/frontier",
            "name": "Kilo Auto Frontier",
            "contextLength": 1000000
        },
        {
            "id": "kilo-auto/balanced",
            "name": "Kilo Auto Balanced",
            "contextLength": 1000000
        }
    ],
    "llm7": [
        {
            "id": "gpt-5.5",
            "name": "GPT-5.5 (LLM7)",
            "contextLength": 1050000
        },
        {
            "id": "claude-opus-5",
            "name": "Claude Opus 5 (LLM7)",
            "contextLength": 1000000
        },
        {
            "id": "deepseek-v4-flash",
            "name": "DeepSeek V4 Flash (LLM7)",
            "contextLength": 1000000
        },
        {
            "id": "grok-4.5",
            "name": "Grok 4.5 (LLM7)",
            "contextLength": 500000
        },
        {
            "id": "kimi-k3",
            "name": "Kimi K3 (LLM7)",
            "contextLength": 1000000
        }
    ],
    "tencent": [
        {
            "id": "hunyuan-turbos-latest",
            "name": "Hunyuan TurboS Latest",
            "contextLength": 200000
        },
        {
            "id": "hunyuan-t1-latest",
            "name": "Hunyuan T1 Latest",
            "contextLength": 256000
        }
    ],
    "hunyuan": [
        {
            "id": "hunyuan-turbos-latest",
            "name": "Hunyuan TurboS Latest",
            "contextLength": 200000
        },
        {
            "id": "hunyuan-t1-latest",
            "name": "Hunyuan T1 Latest",
            "contextLength": 256000
        }
    ],
    "morph": [
        {
            "id": "morph-v3-large",
            "name": "Morph v3 Large"
        },
        {
            "id": "morph-v3-fast",
            "name": "Morph v3 Fast"
        },
        {
            "id": "morph-qwen35-397b",
            "name": "Qwen 3.5 397B (Morph)",
            "contextLength": 262144
        },
        {
            "id": "morph-minimax27-230b",
            "name": "MiniMax M2.7 (Morph)",
            "contextLength": 200704
        },
        {
            "id": "morph-qwen36-27b",
            "name": "Qwen 3.6 27B (Morph)",
            "contextLength": 262144
        },
        {
            "id": "morph-dsv4flash",
            "name": "DeepSeek V4 Flash (Morph)",
            "contextLength": 1048576
        }
    ],
    "poolside": [
        {
            "id": "poolside/laguna-s-2.1",
            "name": "Laguna S 2.1"
        },
        {
            "id": "poolside/laguna-xs-2.1",
            "name": "Laguna XS 2.1"
        }
    ],
    "tokenrouter": [
        {
            "id": "anthropic/claude-haiku-4.5",
            "name": "Claude Haiku 4.5"
        },
        {
            "id": "anthropic/claude-sonnet-4.6",
            "name": "Claude Sonnet 4.6"
        },
        {
            "id": "anthropic/claude-opus-4.8",
            "name": "Claude Opus 4.8"
        },
        {
            "id": "anthropic/claude-opus-4.8-fast",
            "name": "Claude Opus 4.8 Fast"
        },
        {
            "id": "openai/gpt-5.4",
            "name": "Gpt 5.4"
        },
        {
            "id": "openai/gpt-5.4-mini",
            "name": "Gpt 5.4 Mini"
        },
        {
            "id": "openai/gpt-5.4-pro",
            "name": "Gpt 5.4 Pro"
        },
        {
            "id": "openai/gpt-5.5",
            "name": "Gpt 5.5"
        },
        {
            "id": "openai/gpt-5.6-sol",
            "name": "Gpt 5.6 Sol"
        },
        {
            "id": "google/gemini-3.5-flash",
            "name": "Gemini 3.5 Flash"
        },
        {
            "id": "google/gemini-3.6-flash",
            "name": "Gemini 3.6 Flash"
        },
        {
            "id": "deepseek/deepseek-v4-flash",
            "name": "Deepseek V4 Flash"
        },
        {
            "id": "deepseek/deepseek-v4-pro",
            "name": "Deepseek V4 Pro"
        },
        {
            "id": "qwen/qwen3-coder-next",
            "name": "Qwen3 Coder Next"
        },
        {
            "id": "qwen/qwen3.7-max",
            "name": "Qwen3.7 Max"
        },
        {
            "id": "qwen/qwen3.8-max",
            "name": "Qwen3.8 Max"
        },
        {
            "id": "moonshotai/kimi-k2.7-code",
            "name": "Kimi K2.7 Code"
        },
        {
            "id": "moonshotai/kimi-k3-free",
            "name": "Kimi K3 Free"
        },
        {
            "id": "z-ai/glm-5.3-free",
            "name": "Glm 5.3 Free"
        },
        {
            "id": "z-ai/glm-5.2",
            "name": "Glm 5.2"
        },
        {
            "id": "z-ai/glm-5-turbo",
            "name": "Glm 5 Turbo"
        },
        {
            "id": "x-ai/grok-4.5",
            "name": "Grok 4.5"
        }
    ],
    "alitp-intl": [
        {
            "id": "qwen3.8-max-preview",
            "name": "Qwen3.8 Max Preview"
        },
        {
            "id": "qwen3.7-max",
            "name": "Qwen3.7 Max"
        },
        {
            "id": "qwen3.7-plus",
            "name": "Qwen3.7 Plus"
        },
        {
            "id": "qwen3.6-flash",
            "name": "Qwen3.6 Flash"
        },
        {
            "id": "glm-5.2",
            "name": "GLM 5.2"
        },
        {
            "id": "deepseek-v4-pro",
            "name": "DeepSeek V4 Pro"
        }
    ],
    "opencode": [
        {
            "id": "muse-spark-1.2-contributor-free",
            "name": "Muse Spark 1.2 Contributor Free",
            "targetFormat": "openai-responses"
        },
        {
            "id": "muse-spark-1.3-contributor-free",
            "name": "Muse Spark 1.3 Contributor Free",
            "targetFormat": "openai-responses"
        },
        {
            "id": "union-alpha",
            "name": "Union Alpha Free",
            "targetFormat": "claude"
        },
        {
            "id": "jev-1.13-free",
            "name": "Jev 1.13 Free",
            "kind": "systemone"
        }
    ],
    "oc": [
        {
            "id": "muse-spark-1.2-contributor-free",
            "name": "Muse Spark 1.2 Contributor Free",
            "targetFormat": "openai-responses"
        },
        {
            "id": "muse-spark-1.3-contributor-free",
            "name": "Muse Spark 1.3 Contributor Free",
            "targetFormat": "openai-responses"
        },
        {
            "id": "union-alpha",
            "name": "Union Alpha Free",
            "targetFormat": "claude"
        },
        {
            "id": "jev-1.13-free",
            "name": "Jev 1.13 Free",
            "kind": "systemone"
        }
    ]
};
export const PROVIDER_OAUTH: Record<string, ProtocolRecord> = {
    "gemini-cli": {
        "authorizeUrl": "https://accounts.google.com/o/oauth2/v2/auth",
        "tokenUrl": "https://oauth2.googleapis.com/token",
        "userInfoUrl": "https://www.googleapis.com/oauth2/v1/userinfo",
        "scopes": [
            "https://www.googleapis.com/auth/cloud-platform",
            "https://www.googleapis.com/auth/userinfo.email",
            "https://www.googleapis.com/auth/userinfo.profile"
        ],
        "refresh": {
            "encoding": "form"
        }
    },
    "github": {
        "clientId": "Iv1.b507a08c87ecfe98",
        "authorizeUrl": "https://github.com/login/oauth/authorize",
        "deviceCodeUrl": "https://github.com/login/device/code",
        "tokenUrl": "https://github.com/login/oauth/access_token",
        "userInfoUrl": "https://api.github.com/user",
        "scopes": "read:user",
        "apiVersion": "2022-11-28",
        "copilotTokenUrl": "https://api.github.com/copilot_internal/v2/token",
        "userAgent": "GitHubCopilotChat/0.26.7",
        "editorVersion": "vscode/1.85.0",
        "editorPluginVersion": "copilot-chat/0.26.7"
    },
    "iflow": {
        "clientId": "10009311001",
        "clientSecret": "4Z3YjXycVsQvyGF1etiNlIBB4RsqSDtW",
        "authorizeUrl": "https://iflow.cn/oauth",
        "tokenUrl": "https://iflow.cn/oauth/token",
        "userInfoUrl": "https://iflow.cn/api/oauth/getUserInfo",
        "extraParams": {
            "loginMethod": "phone",
            "type": "phone"
        },
        "refreshLeadMs": 86400000
    },
    "qoder": {
        "openApiBaseUrl": "https://openapi.qoder.sh",
        "centerBaseUrl": "https://center.qoder.sh",
        "chatBaseUrl": "https://api3.qoder.sh",
        "deviceTokenUrl": "https://openapi.qoder.sh/api/v1/deviceToken/poll",
        "refreshUrl": "https://center.qoder.sh/algo/api/v3/user/refresh_token",
        "userInfoUrl": "https://openapi.qoder.sh/api/v1/userinfo",
        "quotaUsageUrl": "https://openapi.qoder.sh/api/v2/quota/usage",
        "loginUrl": "https://qoder.com/device/selectAccounts"
    },
    "qoder-cn": {
        "openApiBaseUrl": "https://openapi.qoder.com.cn",
        "centerBaseUrl": "https://gateway.qoder.com.cn",
        "chatBaseUrl": "https://gateway.qoder.com.cn",
        "deviceTokenUrl": "https://openapi.qoder.com.cn/api/v1/deviceToken/poll",
        "refreshUrl": "https://gateway.qoder.com.cn/algo/api/v3/user/refresh_token",
        "userInfoUrl": "https://openapi.qoder.com.cn/api/v1/userinfo",
        "quotaUsageUrl": "https://openapi.qoder.com.cn/api/v2/quota/usage",
        "loginUrl": "https://qoder.com.cn/device/selectAccounts"
    },
    "kiro": {
        "ssoOidcEndpoint": "https://oidc.us-east-1.amazonaws.com",
        "registerClientUrl": "https://oidc.us-east-1.amazonaws.com/client/register",
        "deviceAuthUrl": "https://oidc.us-east-1.amazonaws.com/device_authorization",
        "tokenUrl": "https://oidc.us-east-1.amazonaws.com/token",
        "startUrl": "https://view.awsapps.com/start",
        "clientName": "kiro-oauth-client",
        "clientType": "public",
        "scopes": [
            "codewhisperer:completions",
            "codewhisperer:analysis",
            "codewhisperer:conversations"
        ],
        "grantTypes": [
            "urn:ietf:params:oauth:grant-type:device_code",
            "refresh_token"
        ],
        "issuerUrl": "https://identitycenter.amazonaws.com/ssoins-722374e8c3c8e6c6",
        "socialAuthEndpoint": "https://prod.us-east-1.auth.desktop.kiro.dev",
        "socialLoginUrl": "https://prod.us-east-1.auth.desktop.kiro.dev/login",
        "socialTokenUrl": "https://prod.us-east-1.auth.desktop.kiro.dev/oauth/token",
        "socialRefreshUrl": "https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken",
        "authMethods": [
            "builder-id",
            "idc",
            "google",
            "github",
            "import"
        ]
    },
    "cursor": {
        "apiEndpoint": "https://api2.cursor.sh",
        "chatEndpoint": "/aiserver.v1.ChatService/StreamUnifiedChatWithTools",
        "modelsEndpoint": "/agent.v1.AgentService/GetUsableModels",
        "api3Endpoint": "https://api3.cursor.sh",
        "agentEndpoint": "https://agent.api5.cursor.sh",
        "agentNonPrivacyEndpoint": "https://agentn.api5.cursor.sh",
        "clientVersion": "3.12.17",
        "clientType": "ide",
        "dbKeys": {
            "accessToken": "cursorAuth/accessToken",
            "machineId": "storage.serviceMachineId"
        }
    },
    "grok-cli": {
        "clientId": "b1a00492-073a-47ea-816f-4c329264a828",
        "deviceCodeUrl": "https://auth.x.ai/oauth2/device/code",
        "tokenUrl": "https://auth.x.ai/oauth2/token",
        "refreshUrl": "https://auth.x.ai/oauth2/token",
        "scope": "openid profile email offline_access grok-cli:access api:access conversations:read conversations:write",
        "referrer": "grok-build",
        "refreshLeadMs": 300000
    },
    "codebuddy-cn": {
        "baseUrl": "https://copilot.tencent.com",
        "stateUrl": "https://copilot.tencent.com/v2/plugin/auth/state",
        "tokenUrl": "https://copilot.tencent.com/v2/plugin/auth/token",
        "refreshUrl": "https://copilot.tencent.com/v2/plugin/auth/token/refresh",
        "userAgent": "CLI/2.63.2 CodeBuddy/2.63.2",
        "platform": "CLI",
        "pollInterval": 5000
    },
    "codebuddy-intl": {
        "baseUrl": "https://www.codebuddy.ai",
        "stateUrl": "https://www.codebuddy.ai/v2/plugin/auth/state",
        "tokenUrl": "https://www.codebuddy.ai/v2/plugin/auth/token",
        "refreshUrl": "https://www.codebuddy.ai/v2/plugin/auth/token/refresh",
        "userAgent": "IDE/2.63.2 CodeBuddy/2.63.2",
        "platform": "ide",
        "pollInterval": 5000
    },
    "trae": {
        "clientId": "ono9krqynydwx5",
        "clientSecret": "-",
        "platform": "trae",
        "pollInterval": 1500,
        "loginGuidanceUrl": "https://api.marscode.com/cloudide/api/v3/trae/GetLoginGuidance",
        "tokenUrl": "https://api.marscode.com/cloudide/api/v3/trae/oauth/ExchangeToken",
        "exchangeTokenUrl": "https://api.marscode.com/cloudide/api/v3/trae/oauth/ExchangeToken",
        "refreshUrl": "https://api.marscode.com/cloudide/api/v3/trae/oauth/ExchangeToken",
        "userInfoUrl": "https://api.marscode.com/cloudide/api/v3/trae/GetUserInfo",
        "refresh": {
            "encoding": "json"
        }
    },
    "zed": {
        "authorizeUrl": "https://zed.dev/native_app_signin",
        "platform": "zed",
        "rsaKeyExchange": true
    },
    "windsurf": {
        "clientId": "3GUryQ7ldAeKEuD2obYnppsnmj58eP5u",
        "firebaseApiKey": "AIzaSyDsOl-1XpT5err0Tcn0TFFod1H8gVGIycY",
        "firebaseSignInUrl": "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword",
        "registerUrl": "https://register.windsurf.com/exa.seat_management_pb.SeatManagementService/RegisterUser",
        "apiServerUrl": "https://server.codeium.com",
        "auth1ApiServerUrl": "https://server.self-serve.windsurf.com",
        "platform": "windsurf",
        "quotaUrl": "https://windsurf.com/_backend/exa.seat_management_pb.SeatManagementService/GetPlanStatus"
    },
    "cline": {
        "appBaseUrl": "https://app.cline.bot",
        "apiBaseUrl": "https://api.cline.bot",
        "authorizeUrl": "https://api.cline.bot/api/v1/auth/authorize",
        "tokenExchangeUrl": "https://api.cline.bot/api/v1/auth/token",
        "refreshUrl": "https://api.cline.bot/api/v1/auth/refresh"
    },
    "clinepass": {
        "appBaseUrl": "https://app.cline.bot",
        "apiBaseUrl": "https://api.cline.bot",
        "authorizeUrl": "https://api.cline.bot/api/v1/auth/authorize",
        "tokenUrl": "https://api.cline.bot/api/v1/auth/token",
        "refreshUrl": "https://api.cline.bot/api/v1/auth/refresh"
    },
    "kilocode": {
        "apiBaseUrl": "https://api.kilo.ai",
        "initiateUrl": "https://api.kilo.ai/api/device-auth/codes",
        "pollUrlBase": "https://api.kilo.ai/api/device-auth/codes"
    },
    "kimi": {
        "clientId": "17e5f671-d194-4dfb-9706-5516cb48c098",
        "deviceCodeUrl": "https://auth.kimi.com/api/oauth/device_authorization",
        "tokenUrl": "https://auth.kimi.com/api/oauth/token",
        "refreshUrl": "https://auth.kimi.com/api/oauth/token",
        "refreshLeadMs": 300000,
        "authorizeDeviceUrl": "https://www.kimi.com/code/authorize_device"
    },
    "xiaomi-mimo": {
        "custom": true,
        "authorizeUrl": "https://platform.xiaomimimo.com/authorize",
        "callbackParam": "u",
        "kn": "mimocode"
    },
    "gitlab": {
        "defaultBaseUrl": "https://gitlab.com",
        "authorizeUrlPath": "/oauth/authorize",
        "tokenUrlPath": "/oauth/token",
        "userInfoUrlPath": "/api/v4/user",
        "scope": "api read_user",
        "codeChallengeMethod": "S256"
    },
    "kimchi": {
        "webAppUrl": "https://app.kimchi.dev",
        "validationUrl": "https://api.cast.ai/v1/llm/openai/supported-providers",
        "userInfoUrl": "https://app.kimchi.dev/api/v1/me",
        "modelsUrl": "https://llm.kimchi.dev/v1/models/metadata?include_in_cli=true"
    },
    "codex": {
        "clientId": "app_EMoamEEZ73f0CkXaXp7hrann",
        "authorizeUrl": "https://auth.openai.com/oauth/authorize",
        "tokenUrl": "https://auth.openai.com/oauth/token",
        "scope": "openid profile email offline_access",
        "codeChallengeMethod": "S256",
        "fixedPort": 1455,
        "callbackPath": "/auth/callback",
        "extraParams": {
            "id_token_add_organizations": "true",
            "codex_cli_simplified_flow": "true",
            "originator": "codex_cli_rs"
        },
        "refreshLeadMs": 432000000,
        "refresh": {
            "encoding": "form",
            "scope": "openid profile email offline_access"
        },
        "maxRefreshAgeMs": 691200000,
        "trackRefreshAt": true
    },
    "claude": {
        "clientId": "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
        "authorizeUrl": "https://claude.ai/oauth/authorize",
        "tokenUrl": "https://api.anthropic.com/v1/oauth/token",
        "scopes": [
            "org:create_api_key",
            "user:profile",
            "user:inference"
        ],
        "codeChallengeMethod": "S256",
        "refreshLeadMs": 14400000,
        "refresh": {
            "encoding": "json"
        }
    },
    "antigravity": {
        "authorizeUrl": "https://accounts.google.com/o/oauth2/v2/auth",
        "tokenUrl": "https://oauth2.googleapis.com/token",
        "userInfoUrl": "https://www.googleapis.com/oauth2/v1/userinfo",
        "scopes": [
            "https://www.googleapis.com/auth/cloud-platform",
            "https://www.googleapis.com/auth/userinfo.email",
            "https://www.googleapis.com/auth/userinfo.profile",
            "https://www.googleapis.com/auth/cclog",
            "https://www.googleapis.com/auth/experimentsandconfigs"
        ],
        "apiEndpoint": "https://daily-cloudcode-pa.googleapis.com",
        "apiVersion": "v1internal",
        "loadCodeAssistEndpoint": "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
        "onboardUserEndpoint": "https://cloudcode-pa.googleapis.com/v1internal:onboardUser",
        "loadCodeAssistUserAgent": "antigravity/ide/2.11.0 darwin/arm64",
        "refreshLeadMs": 300000
    }
};
