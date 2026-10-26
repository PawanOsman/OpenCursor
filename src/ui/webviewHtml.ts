/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as vscode from "vscode";
import { randomBytes } from "node:crypto";

function nonce(): string {
  // CSP nonces must be unpredictable; Math.random is not a CSPRNG.
  return randomBytes(24).toString("base64url");
}

/** The only extension folders a webview may load resources from. */
export function webviewResourceRoots(extensionUri: vscode.Uri): vscode.Uri[] {
  return [vscode.Uri.joinPath(extensionUri, "dist", "webview"), vscode.Uri.joinPath(extensionUri, "media")];
}

/** Thin HTML shell that loads a bundled React webview (dist/webview/<entry>.js/.css). */
export function renderWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  entry: "sidebar" | "settings",
  title: string
): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview", `${entry}.js`)
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview", `${entry}.css`)
  );
  const iconUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "icon.png")
  );
  const n = nonce();
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${n}'`,
    `font-src ${webview.cspSource} data:`,
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>${title}</title>
</head>
<body>
  <div id="root" data-icon="${iconUri}"></div>
  <script nonce="${n}" src="${scriptUri}"></script>
</body>
</html>`;
}
