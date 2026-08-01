/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import { DEFAULT_SOCKET_PATH, serializeIpcMessage, parseIpcMessage, type IpcClientMessage, type IpcServerMessage } from "./protocol";
import { getWorkspaceRoot } from "../context/workspaceUtils";
import { getLog, logError } from "../logging";
import type { AgentEvent } from "../agent/types";

export interface IpcServerDelegate {
	onSubmitPrompt: (data: { prompt: string; mode?: any; model?: string; conversationId?: string }) => void;
	onResolveApproval: (requestId: string, approve: boolean) => void;
	onAnswerQuestion: (callId: string, answers: Record<string, string[]>) => void;
	onCancelRun: (conversationId?: string) => void;
}

export class IpcSocketServer {
	private server?: net.Server;
	private clients = new Set<net.Socket>();
	private socketPath: string;

	constructor(private delegate: IpcServerDelegate, socketPath = DEFAULT_SOCKET_PATH) {
		this.socketPath = socketPath;
	}

	public start(): void {
		// On Unix systems, remove stale socket file if it exists
		if (process.platform !== "win32" && fs.existsSync(this.socketPath)) {
			try {
				fs.unlinkSync(this.socketPath);
			} catch (e) {
				logError("ipc.start.unlink", e);
			}
		}

		this.server = net.createServer((socket) => this.handleConnection(socket));

		this.server.on("error", (err) => {
			logError("ipc.server.error", err);
		});

		this.server.listen(this.socketPath, () => {
			if (process.platform !== "win32") {
				try { fs.chmodSync(this.socketPath, 0o600); } catch (e) { logError("ipc.start.chmod", e); }
			}
			getLog().appendLine(`[IPC] OpenCursor socket server listening on ${this.socketPath}`);
		});
	}

	private handleConnection(socket: net.Socket): void {
		this.clients.add(socket);
		let buffer = "";

		socket.on("data", (chunk) => {
			buffer += chunk.toString("utf-8");
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				const msg = parseIpcMessage<IpcClientMessage>(line);
				if (msg) this.handleMessage(socket, msg);
			}
		});

		socket.on("close", () => {
			this.clients.delete(socket);
		});

		socket.on("error", (err) => {
			logError("ipc.client.error", err);
			this.clients.delete(socket);
		});
	}

	private handleMessage(socket: net.Socket, msg: IpcClientMessage): void {
		if (msg.type === "handshake") {
			const ack: IpcServerMessage = {
				type: "handshakeAck",
				serverVersion: "0.1.0",
				activeWorkspace: getWorkspaceRoot(),
			};
			socket.write(serializeIpcMessage(ack));
		} else if (msg.type === "submitPrompt") {
			this.delegate.onSubmitPrompt(msg);
		} else if (msg.type === "resolveApproval") {
			this.delegate.onResolveApproval(msg.requestId, msg.approve);
		} else if (msg.type === "answerQuestion") {
			this.delegate.onAnswerQuestion(msg.callId, msg.answers);
		} else if (msg.type === "cancelRun") {
			this.delegate.onCancelRun(msg.conversationId);
		} else if (msg.type === "ping") {
			socket.write(serializeIpcMessage({ type: "pong" }));
		}
	}

	public broadcastEvent(conversationId: string, event: AgentEvent): void {
		const payload: IpcServerMessage = { type: "agentEvent", conversationId, event };
		const data = serializeIpcMessage(payload);
		for (const socket of this.clients) {
			try {
				socket.write(data);
			} catch {
				this.clients.delete(socket);
			}
		}
	}

	public broadcastApprovalRequest(conversationId: string, requestId: string, toolName: string, input: any, detail: string): void {
		const payload: IpcServerMessage = { type: "approvalRequest", conversationId, requestId, toolName, input, detail };
		const data = serializeIpcMessage(payload);
		for (const socket of this.clients) {
			try {
				socket.write(data);
			} catch {
				this.clients.delete(socket);
			}
		}
	}

	public broadcastQuestionRequest(conversationId: string, callId: string, header?: string, questions?: any[]): void {
		const payload: IpcServerMessage = { type: "questionRequest", conversationId, callId, header, questions: questions ?? [] };
		const data = serializeIpcMessage(payload);
		for (const socket of this.clients) {
			try {
				socket.write(data);
			} catch {
				this.clients.delete(socket);
			}
		}
	}

	public stop(): void {
		for (const socket of this.clients) {
			socket.destroy();
		}
		this.clients.clear();

		if (this.server) {
			this.server.close();
			this.server = undefined;
		}

		if (process.platform !== "win32" && fs.existsSync(this.socketPath)) {
			try {
				fs.unlinkSync(this.socketPath);
			} catch {
				/* ignore */
			}
		}
	}
}
