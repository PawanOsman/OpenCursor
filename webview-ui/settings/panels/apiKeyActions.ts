/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as React from "react";
import { vscode } from "../../shared/vscode";
import { uid, type ProviderKind } from "../features";

export interface ApiKeyAction {
  action: "add" | "update" | "remove" | "toggle" | "setBalance" | "removeProvider" | "connect";
  providerId: string;
  kind?: ProviderKind;
  keyId?: string;
  label?: string;
  apiKey?: string;
  baseUrl?: string;
  enabled?: boolean;
  strategy?: "first" | "round-robin";
}

/** Await the host's secure-storage result before claiming a key was saved. */
export function useApiKeyAction() {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");
  const request = React.useRef<{ id: string; timer: number; resolve: (ok: boolean) => void } | undefined>(undefined);
  React.useEffect(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data;
      const active = request.current;
      if (!active || message?.type !== "providerKeyActionResult" || message.requestId !== active.id) return;
      window.clearTimeout(active.timer);
      request.current = undefined;
      setPending(false);
      setError(message.ok ? "" : message.error || "Could not update this API key. Try again.");
      active.resolve(message.ok === true);
    };
    window.addEventListener("message", handler);
    return () => {
      window.removeEventListener("message", handler);
      if (request.current) { window.clearTimeout(request.current.timer); request.current.resolve(false); request.current = undefined; }
    };
  }, []);
  const run = (action: ApiKeyAction): Promise<boolean> => {
    if (request.current) return Promise.resolve(false);
    setPending(true); setError("");
    return new Promise(resolve => {
      const id = uid("provider-key");
      const timer = window.setTimeout(() => {
        if (request.current?.id !== id) return;
        request.current = undefined;
        setPending(false);
        setError("The update has not responded. Check the provider's saved keys before retrying.");
        resolve(false);
      }, 30_000);
      request.current = { id, timer, resolve };
      vscode.postMessage({ type: "providerKeyAction", requestId: id, ...action });
    });
  };
  return { run, pending, error };
}
