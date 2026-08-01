/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

function getVscode() {
  try {
    return require("vscode");
  } catch {
    return undefined;
  }
}

let output: any | undefined;

const fallbackChannel: any = {
  name: "OpenCursor",
  appendLine: (value: string) => console.log(value),
  append: (value: string) => process.stdout.write(value),
  clear: () => {},
  show: () => {},
  hide: () => {},
  dispose: () => {},
};

export function initLog(context: any): any {
  const vsc = getVscode();
  if (vsc?.window?.createOutputChannel) {
    output ??= vsc.window.createOutputChannel("OpenCursor");
    context?.subscriptions?.push?.(output);
  } else {
    output ??= fallbackChannel;
  }
  return output;
}

export function getLog(): any {
  if (output) return output;
  const vsc = getVscode();
  if (vsc?.window?.createOutputChannel) {
    return (output = vsc.window.createOutputChannel("OpenCursor"));
  }
  return (output = fallbackChannel);
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.stack || `${error.name}: ${error.message}`;
  try {
    return typeof error === "string" ? error : JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function logError(scope: string, error: unknown, context?: Record<string, unknown>): void {
  let details = "";
  try {
    if (context) details = ` ${JSON.stringify(context)}`;
  } catch {
    details = " [unserializable context]";
  }
  try {
    getLog().appendLine(`[${new Date().toISOString()}] [error] [${scope}]${details} ${errorText(error)}`);
  } catch {
    console.error(`[OpenCursor] [${scope}]`, error);
  }
}
