/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

/**
 * Safe fallback shim for `vscode` namespace when running in standalone Node.js CLI mode.
 */
export class EventEmitter<T = any> {
	private listeners: Array<(e: T) => any> = [];
	get event() {
		return (listener: (e: T) => any) => {
			this.listeners.push(listener);
			return {
				dispose: () => {
					this.listeners = this.listeners.filter((l) => l !== listener);
				},
			};
		};
	}
	fire(data: T) {
		for (const l of this.listeners) {
			try {
				l(data);
			} catch {
				/* ignore */
			}
		}
	}
	dispose() {
		this.listeners = [];
	}
}

export class Disposable {
	constructor(private call: () => void) {}
	dispose() {
		this.call?.();
	}
	static from(...disposables: Array<{ dispose(): any }>) {
		return new Disposable(() => disposables.forEach((d) => d?.dispose?.()));
	}
}

export class Range {
	constructor(public startLine: number, public startCharacter: number, public endLine: number, public endCharacter: number) {}
}

export class Selection extends Range {}

export const workspace = {
	workspaceFolders: undefined,
	asRelativePath: (uri: any) => (typeof uri === "string" ? uri : uri?.fsPath || ""),
	getConfiguration: () => ({ get: () => undefined }),
	onDidChangeConfiguration: () => ({ dispose: () => {} }),
	createFileSystemWatcher: () => ({
		onDidChange: () => ({ dispose: () => {} }),
		onDidCreate: () => ({ dispose: () => {} }),
		onDidDelete: () => ({ dispose: () => {} }),
		dispose: () => {},
	}),
	openTextDocument: () => Promise.resolve({ getText: () => "", lineCount: 0 }),
	fs: {
		writeFile: () => Promise.resolve(),
		readFile: () => Promise.resolve(Buffer.from("")),
	},
};

export const window = {
	visibleTextEditors: [],
	activeTextEditor: undefined,
	tabGroups: { all: [] },
	terminals: [],
	createOutputChannel: () => ({
		appendLine: (s: string) => console.log(s),
		append: (s: string) => process.stdout.write(s),
		clear: () => {},
		show: () => {},
		hide: () => {},
		dispose: () => {},
	}),
	showInformationMessage: () => Promise.resolve(),
	showErrorMessage: () => Promise.resolve(),
	showWarningMessage: () => Promise.resolve(),
	showSaveDialog: () => Promise.resolve(undefined),
};

export const Uri = {
	file: (p: string) => ({ fsPath: p, scheme: "file" }),
	parse: (u: string) => ({ fsPath: u.replace(/^file:\/\//i, ""), scheme: "file" }),
	joinPath: (base: any, ...paths: string[]) => ({ fsPath: require("path").join(base?.fsPath || "", ...paths), scheme: "file" }),
};

export const commands = {
	registerCommand: () => ({ dispose: () => {} }),
	executeCommand: () => Promise.resolve(),
};

export const languages = {
	getDiagnostics: () => [],
};

export const DiagnosticSeverity = {
	Error: 0,
	Warning: 1,
	Information: 2,
	Hint: 3,
};
