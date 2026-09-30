/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as React from "react";
import { Icon } from "../../shared/icons";
import { ProviderIcon } from "../../shared/ProviderIcon";
import { vscode } from "../../shared/vscode";
import { uid, PROVIDER_PRESETS, type ProviderConfig, type ProviderApiKey } from "../features";
import { providerLabel } from "./ProviderPickerDialog";
import { SettingsDialog } from "./SettingsDialog";
import { useApiKeyAction } from "./apiKeyActions";

export function ApiKeyDialog({ provider, credential, onClose, onBack }: {
  provider: ProviderConfig; credential?: ProviderApiKey; onClose: () => void; onBack: () => void;
}) {
  const [label, setLabel] = React.useState(credential?.label ?? "");
  const [key, setKey] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState(provider.baseUrl);
  const [validationError, setValidationError] = React.useState("");
  const [test, setTest] = React.useState<{ status: "idle" | "testing" | "ok" | "error"; message?: string }>({ status: "idle" });
  const testRequest = React.useRef<{ id: string; timer: number; apiKey: string } | undefined>(undefined);
  const { run, pending, error } = useApiKeyAction();
  const name = providerLabel(provider.kind);
  const preset = PROVIDER_PRESETS[provider.kind];
  const editableEndpoint = !!preset.needsEndpoint && !credential && !provider.hasKey && !provider.apiKeys?.length;
  const credentialLabel = preset.authMode === "serviceAccount" ? "Service account JSON" : "API key";
  const validate = () => {
    try {
      const url = new URL(baseUrl.trim());
      if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash || /[{}<>]/.test(baseUrl)) throw new Error();
    } catch { setValidationError("Enter your complete provider endpoint without placeholders, credentials, query parameters or a fragment."); return false; }
    if (preset.authMode === "serviceAccount" && key.trim()) {
      try {
        const value = JSON.parse(key);
        if (typeof value.client_email !== "string" || typeof value.private_key !== "string") throw new Error();
      } catch { setValidationError("Enter valid service account JSON containing client_email and private_key."); return false; }
    }
    setValidationError(""); return true;
  };
  const clearTest = React.useCallback(() => {
    if (testRequest.current) window.clearTimeout(testRequest.current.timer);
    testRequest.current = undefined;
  }, []);
  const resetTest = React.useCallback(() => { clearTest(); setTest({ status: "idle" }); }, [clearTest]);
  React.useEffect(() => {
    resetTest();
    const receive = (event: MessageEvent) => {
      const message = event.data;
      const active = testRequest.current;
      if (!active || message?.type !== "modelsFetched" || message.providerId !== provider.id || message.requestId !== active.id) return;
      clearTest();
      const detail = String(message.error || "");
      const safeDetail = active.apiKey ? detail.split(active.apiKey).join("[redacted]") : detail;
      setTest(message.error ? { status: "error", message: safeDetail.slice(0, 200) }
        : { status: "ok", message: `${Array.isArray(message.models) ? message.models.length : 0} ${message.verified === false ? "catalog models available; connection not verified" : "models available"}` });
    };
    window.addEventListener("message", receive);
    return () => { window.removeEventListener("message", receive); clearTest(); };
  }, [provider.id, provider.baseUrl, provider.kind, credential?.id, resetTest, clearTest]);
  const runTest = () => {
    const apiKey = key.trim();
    if (pending || testRequest.current || (!apiKey && (!credential || credential.hasKey === false))) return;
    if (!validate()) return;
    const requestId = uid("provider-key-test");
    const timer = window.setTimeout(() => {
      if (testRequest.current?.id !== requestId) return;
      testRequest.current = undefined;
      setTest({ status: "error", message: "Connection test did not respond. Try again." });
    }, 30_000);
    testRequest.current = { id: requestId, timer, apiKey };
    setTest({ status: "testing" });
    vscode.postMessage({ type: "fetchModels", requestId, providerId: provider.id, providerKind: provider.kind, apiBaseUrl: baseUrl.trim(),
      anthropic: provider.kind === "anthropic", ...(apiKey ? { apiKey } : { keyId: credential!.id }) });
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending || (!credential && !key.trim())) return;
    if (!validate()) return;
    resetTest();
    const ok = await run({ action: credential ? "update" : "add", providerId: provider.id, kind: provider.kind,
      ...(editableEndpoint ? { baseUrl: baseUrl.trim().replace(/\/+$/, "") } : {}),
      ...(credential ? { keyId: credential.id } : {}), ...(label.trim() ? { label: label.trim() } : {}), ...(key.trim() ? { apiKey: key.trim() } : {}) });
    if (ok) onClose();
  };
  return <SettingsDialog title={credential ? `Edit ${name} key` : `Add ${name} key`} onClose={() => { if (!pending) onClose(); }} className="provider-connection">
    <form onSubmit={submit}>
      <div className="modal-body">
        <div className="provider-connection-heading"><span className="provider-logo"><ProviderIcon provider={provider.kind} size={26} /></span>
          <div><strong>{name}</strong><p className="panel-hint">{credential ? "Update this key without changing other keys." : "Add a key for automatic failover and load balancing."}</p></div>
        </div>
        <label className="fc-field"><span>Key name (optional)</span><input aria-label="Key name" value={label} disabled={pending} placeholder="For example, Work account" onChange={event => setLabel(event.target.value)} /></label>
        <label className="fc-field"><span>Base URL</span><input aria-label="Base URL" type="url" readOnly={!editableEndpoint} value={baseUrl} disabled={pending}
          onChange={event => { setBaseUrl(event.target.value); resetTest(); setValidationError(""); }} /></label>
        {preset.setupHint && <p className="panel-hint">{preset.setupHint}</p>}
        <label className="fc-field"><span>{credentialLabel}{credential?.hasKey !== false && credential ? " (saved)" : ""}</span>
          <input aria-label={credentialLabel} data-dialog-autofocus type="password" autoComplete="off" spellCheck={false} value={key} disabled={pending}
            placeholder={credential ? "Leave blank to keep the saved key" : "Enter API key"} onChange={event => { setKey(event.target.value); resetTest(); }} />
        </label>
        <p className="panel-hint">Keys stay in VS Code's secure storage. Only their names appear here.</p>
        {(error || validationError) && <div className="fc-error" role="alert">{validationError || error}</div>}
        <div className="test-row">
          <button type="button" className="btn-ghost" onClick={runTest}
            disabled={pending || test.status === "testing" || (!key.trim() && (!credential || credential.hasKey === false))}>
            {test.status === "testing" ? "Testing…" : "Test connection"}</button>
          {test.status === "ok" && <span className="test-result ok" role="status"><Icon name="check" size={13} /> {test.message}</span>}
          {test.status === "error" && <span className="test-result err" role="alert">{test.message}</span>}
        </div>
      </div>
      <div className="modal-foot provider-connection-actions">
        {!credential && <button type="button" className="btn-ghost provider-back" disabled={pending} onClick={onBack}><Icon name="chevL" size={14} /> Back to providers</button>}
        <button type="button" className="btn-ghost" disabled={pending} onClick={onClose}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={pending || (!credential && !key.trim())}>{pending ? "Saving…" : credential ? "Save" : "Add key"}</button>
      </div>
    </form>
  </SettingsDialog>;
}
