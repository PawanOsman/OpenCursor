/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// Turn model, agent events, and the streaming reducer are shared with the host
// (host owns authoritative state; the webview just renders it).
import type {
  Mode,
  AgentEvent,
  Attachment,
  ToolBlock,
  TextBlock,
  ThinkingBlock,
  ErrorBlock,
  AssistantBlock,
  UserTurn,
  AssistantTurn,
  Turn,
} from "../../src/shared/turns";
import type { ChatWorkspaceState, ConversationGoal, GoalStatus, QueuedMessage, ReviewTarget } from "../../src/shared/chatSession";
import type { ApprovalPolicy } from "../../src/agent/approvalPolicy";
export type { ApprovalPolicy } from "../../src/agent/approvalPolicy";
export type {
  Mode,
  AgentEvent,
  Attachment,
  ToolBlock,
  TextBlock,
  ThinkingBlock,
  ErrorBlock,
  AssistantBlock,
  UserTurn,
  AssistantTurn,
  Turn,
};
export { applyEvent, applyToBlocks, parsePartialArgs, closeTrailingThinking, forceSettleOpenWork, renderMentionTokens, parseMentionTokens } from "../../src/shared/turns";

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
  archivedAt?: number;
  excerpt?: string;
}

export interface PersonaInfo {
  id: string;
  name: string;
  description: string;
}

export interface ModelOption {
  key: string;
  label: string;
  description?: string;
  type: "select" | "toggle";
  values?: string[];
  value: string;
}

export type ModelKind = "openai" | "anthropic" | "google" | "openrouter" | "ollama" | "llamacpp" | "mimo" | "atlascloud" | "astraflow" | "claude-code" | "codex" | "antigravity";

export interface ModelDef {
  id: string;
  name: string;
  kind: ModelKind | ModelKind[];
  options: ModelOption[];
  group?: "default" | "other";
  /** Provider display name (for grouping in the picker). */
  providerName?: string;
  /** Provider id this model is served by. */
  providerId?: string;
}

export type MentionKind =
  | "file" | "folder" | "code" | "doc" | "git" | "composer"
  | "terminal" | "rule" | "branch_diff" | "link";

/** Categories shown in the top-level @ menu. */
export type MentionCategory = "files" | "code" | "docs" | "git" | "terminals" | "rules" | "chats" | "branch" | "link";

export interface MentionItem {
  path: string;
  name: string;
  kind: MentionKind;
  detail?: string;
}

export interface PendingChangeInfo {
  path: string;
  existedBefore: boolean;
  added?: number;
  removed?: number;
}

// Extension -> webview
export type UiPrefs = { chatTextSize: string; motion?: "full" | "system" | "reduced"; submitWithCtrlEnter: boolean; maxTabCount: number; completionSound: boolean; perTabDrafts: boolean };
/** A subagent team as shown in the composer's Project-mode picker. */
export type TeamInfo = { id: string; name: string; description: string; members: string[] };
export type InMessage =
  | { type: "initialState"; mode: Mode; selectedModel: string; activeId?: string; turns: Turn[]; personas: PersonaInfo[]; activePersonaId: string; hasProviders: boolean; teams?: TeamInfo[]; activeTeamIds?: string[]; runningConvIds?: string[]; uiPrefs?: UiPrefs; usedTokens?: number; workspaceState?: ChatWorkspaceState; workspaceRoot?: string; approvalPolicy?: ApprovalPolicy }
  | { type: "workflowState"; queues: Record<string, QueuedMessage[]>; steeringQueues?: Record<string, QueuedMessage[]>; goals: Record<string, ConversationGoal> }
  | { type: "queueSteeringResult"; convId: string; requestId: string; accepted: boolean }
  | { type: "requestAccepted"; requestId: string; convId: string; created: boolean }
  | { type: "steeringAccepted"; convId: string }
  | { type: "queueDraft"; convId: string; draft: { text: string; attachments: Attachment[] } }
  | { type: "conversationSearchResults"; requestId: number; list: ConversationSummary[] }
  | { type: "configState"; personas: PersonaInfo[]; activePersonaId: string; hasProviders: boolean; teams?: TeamInfo[]; activeTeamIds?: string[]; uiPrefs?: UiPrefs; approvalPolicy?: ApprovalPolicy }
  | { type: "modelsFetched"; models: string[]; modelList?: ModelDef[] }
  | { type: "modelSelected"; model: string }
  | { type: "conversations"; list: ConversationSummary[]; activeId?: string; runningConvIds?: string[] }
  | { type: "loadConversation"; activeId?: string; turns: Turn[]; personaId?: string; usedTokens?: number; running?: boolean; workspaceRoot?: string }
  | { type: "error"; convId?: string; message: string }
  | { type: "attachmentsPicked"; attachments: Attachment[] }
  | { type: "fileSearchResults"; requestId: number; items: MentionItem[] }
  | { type: "mentionSearchResults"; requestId: number; kind: MentionCategory; items: MentionItem[] }
  | { type: "insertMention"; mention: MentionItem }
  | { type: "pasteResolved"; requestId: number; mention?: MentionItem }
  | { type: "pendingChanges"; changes: PendingChangeInfo[] }
  | { type: "runStarted"; convId: string; prompt: string; created?: boolean; turns?: Turn[] }
  | { type: "agentEvent"; convId: string; event: AgentEvent }
  | { type: "questionAnswered"; convId: string; callId: string; answers: Record<string, string[]> }
  | { type: "approvalRequest"; convId: string; request: ApprovalRequestInfo }
  | { type: "approvalResolved"; convId: string; requestId: string; approved: boolean }
  | { type: "fileIcon"; filename: string; icon?: FileIconInfo };

/** Icon resolved from the IDE's active file-icon theme (data-URI assets). */
export type FileIconInfo =
  | { kind: "img"; src: string }
  | { kind: "font"; fontFamily: string; src: string; format: string; char: string; color?: string; size?: string };

export type ApprovalActionType = "shell" | "edits" | "delete" | "mcp" | "web" | "outside";
export type ApprovalMode = "allow" | "ask" | "review" | "deny";

export interface ApprovalRequestInfo {
  requestId: string;
  convId: string;
  /** Tool call this approval belongs to, so the prompt renders on that tool card. */
  callId?: string;
  toolName: string;
  actionType: ApprovalActionType;
  subject: string;
  detail: string;
  suggestion?: string;
}

// webview -> extension
export type OutMessage =
  | { type: "ready" }
  | { type: "sendMessage"; convId?: string | null; text: string; attachments?: Attachment[]; fromIndex?: number; model?: string; mode?: Mode; revertFiles?: boolean; requestId?: string }
  | { type: "updateChatWorkspace"; state: Partial<ChatWorkspaceState> }
  | { type: "queueAction"; convId: string; id: string; action: "remove" | "run" | "steer" | "up" | "down" | "edit" }
  | { type: "steerMessage"; convId: string; text: string }
  | { type: "forkConversation"; id: string }
  | { type: "archiveConversation"; id: string; archived: boolean }
  | { type: "searchConversations"; query: string; archived: boolean; requestId: number }
  | { type: "setGoal"; convId?: string; objective: string; tokenBudget?: number }
  | { type: "setGoalStatus"; convId: string; status: GoalStatus }
  | { type: "startReview"; target: ReviewTarget }
  | { type: "createWorktreeConversation"; title?: string }
  | { type: "continueRun"; always?: boolean }
  | { type: "revertToMessage"; index: number; revertFiles?: boolean }
  | { type: "browseAttachments" }
  | { type: "openSettings"; section?: string }
  | { type: "setApprovalPreset"; preset: "ask" | "review" | "allow" }
  | { type: "openBrowserTab"; url?: string }
  | { type: "exportConversation"; convId?: string }
  | { type: "newConversation"; personaId?: string }
  | { type: "setPersona"; personaId: string }
  | { type: "selectConversation"; id: string }
  | { type: "deleteConversation"; id: string }
  | { type: "persistTurns"; convId?: string; turns: Turn[] }
  | { type: "cancelRun"; convId?: string }
  | { type: "cancelSubagent"; callId: string; reason?: "timeout" | "user" }
  | { type: "answerQuestion"; callId: string; answers: Record<string, string[]> }
  | { type: "resolveApproval"; requestId: string; approve?: boolean; pattern?: string; addPattern?: "allow" | "deny"; setMode?: ApprovalMode }
  | { type: "setMode"; mode: Mode }
  | { type: "setActiveTeams"; teamIds: string[] }
  | { type: "fetchModels" }
  | { type: "selectModel"; model: string }
  | { type: "saveModelOptions"; modelId: string; options: ModelOption[] }
  | { type: "resetModelOptions"; modelId: string }
  | { type: "searchFiles"; query: string; requestId: number }
  | { type: "searchMentions"; kind: MentionCategory; query: string; requestId: number }
  | { type: "openFile"; path: string; startLine?: number; endLine?: number }
  | { type: "openMention"; kind: MentionKind; path: string }
  | { type: "acceptChange"; path: string }
  | { type: "rejectChange"; path: string }
  | { type: "acceptAllChanges" }
  | { type: "rejectAllChanges" }
  | { type: "diffChange"; path: string }
  | { type: "logError"; message: string; info?: string }
  | { type: "openLog" }
  | { type: "getFileIcon"; filename: string }
  | { type: "resolvePastedCode"; text: string; requestId: number };

