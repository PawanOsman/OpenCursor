/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { AgentEvent, Mode } from "../agent/types";

export const DEFAULT_SOCKET_PATH = process.platform === "win32"
	? "\\\\.\\pipe\\opencursor-ipc"
	: "/tmp/opencursor-ipc.sock";

export type IpcClientMessage =
	| { type: "handshake"; clientVersion: string; cwd: string }
	| { type: "submitPrompt"; prompt: string; mode?: Mode; model?: string; conversationId?: string }
	| { type: "resolveApproval"; requestId: string; approve: boolean }
	| { type: "answerQuestion"; callId: string; answers: Record<string, string[]> }
	| { type: "cancelRun"; conversationId?: string }
	| { type: "ping" };

export type IpcServerMessage =
	| { type: "handshakeAck"; serverVersion: string; activeWorkspace: string; activeId?: string }
	| { type: "agentEvent"; conversationId: string; event: AgentEvent }
	| { type: "approvalRequest"; conversationId: string; requestId: string; toolName: string; input: any; detail: string }
	| { type: "questionRequest"; conversationId: string; callId: string; header?: string; questions: Array<{ id: string; prompt: string; options?: string[] }> }
	| { type: "pong" }
	| { type: "error"; message: string };

export function serializeIpcMessage(msg: IpcClientMessage | IpcServerMessage): string {
	return JSON.stringify(msg) + "\n";
}

export function parseIpcMessage<T = IpcClientMessage | IpcServerMessage>(line: string): T | undefined {
	const trimmed = line.trim();
	if (!trimmed) return undefined;
	try {
		return JSON.parse(trimmed) as T;
	} catch {
		return undefined;
	}
}
