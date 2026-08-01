/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as net from "net";
import { DEFAULT_SOCKET_PATH, serializeIpcMessage, parseIpcMessage, type IpcClientMessage, type IpcServerMessage } from "../bridge/protocol";
import type { AgentEvent, Mode } from "../agent/types";

export interface IpcClientHandlers {
	onAgentEvent?: (conversationId: string, event: AgentEvent) => void;
	onApprovalRequest?: (conversationId: string, requestId: string, toolName: string, input: any, detail: string) => void;
	onQuestionRequest?: (conversationId: string, callId: string, header?: string, questions?: any[]) => void;
	onDisconnect?: () => void;
}

export class IpcClient {
	private socket?: net.Socket;
	private connected = false;

	constructor(private socketPath = DEFAULT_SOCKET_PATH, private handlers: IpcClientHandlers = {}) {}

	public connect(): Promise<boolean> {
		return new Promise((resolve) => {
			const socket = net.createConnection(this.socketPath, () => {
				this.socket = socket;
				this.connected = true;

				// Send handshake
				const handshake: IpcClientMessage = {
					type: "handshake",
					clientVersion: "0.1.0",
					cwd: process.cwd(),
				};
				socket.write(serializeIpcMessage(handshake));
				resolve(true);
			});

			socket.on("error", () => {
				this.connected = false;
				resolve(false);
			});

			let buffer = "";
			socket.on("data", (chunk) => {
				buffer += chunk.toString("utf-8");
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					const msg = parseIpcMessage<IpcServerMessage>(line);
					if (msg) this.handleServerMessage(msg);
				}
			});

			socket.on("close", () => {
				this.connected = false;
				this.handlers.onDisconnect?.();
			});
		});
	}

	public isConnected(): boolean {
		return this.connected;
	}

	private handleServerMessage(msg: IpcServerMessage): void {
		if (msg.type === "agentEvent") {
			this.handlers.onAgentEvent?.(msg.conversationId, msg.event);
		} else if (msg.type === "approvalRequest") {
			this.handlers.onApprovalRequest?.(msg.conversationId, msg.requestId, msg.toolName, msg.input, msg.detail);
		} else if (msg.type === "questionRequest") {
			this.handlers.onQuestionRequest?.(msg.conversationId, msg.callId, msg.header, msg.questions);
		}
	}

	public submitPrompt(prompt: string, mode?: Mode, model?: string): void {
		if (!this.socket || !this.connected) return;
		const msg: IpcClientMessage = { type: "submitPrompt", prompt, mode, model };
		this.socket.write(serializeIpcMessage(msg));
	}

	public resolveApproval(requestId: string, approve: boolean): void {
		if (!this.socket || !this.connected) return;
		const msg: IpcClientMessage = { type: "resolveApproval", requestId, approve };
		this.socket.write(serializeIpcMessage(msg));
	}

	public answerQuestion(callId: string, answers: Record<string, string[]>): void {
		if (!this.socket || !this.connected) return;
		const msg: IpcClientMessage = { type: "answerQuestion", callId, answers };
		this.socket.write(serializeIpcMessage(msg));
	}

	public disconnect(): void {
		if (this.socket) {
			this.socket.destroy();
			this.socket = undefined;
			this.connected = false;
		}
	}
}
