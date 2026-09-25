/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as React from "react";
import { Select } from "../../shared/Select";
import { Icon } from "../../shared/icons";
import { ProviderIcon } from "../../shared/ProviderIcon";
import { ProviderPickerDialog, providerLabel, type ProviderChoice, type ProviderPickerScope } from "./ProviderPickerDialog";
import { SettingsDialog } from "./SettingsDialog";
import { vscode } from "../../shared/vscode";
import {
  BALANCE_OPTIONS,
  FeatureConfig,
  OAUTH_LABEL,
  OAUTH_PROVIDERS,
  OAuthAccountInfo,
  OAuthKind,
  OAuthLimit,
  OAuthStatus,
  PROVIDER_PRESETS,
  ProviderConfig,
  ProviderApiKey,
  ProviderKind,
  uid,
} from "../features";
import { Toggle } from "./Toggle";
import { ApiProviderCard, apiKeysFor } from "./ApiProviderCard";
import { ApiKeyDialog } from "./ApiKeyDialog";
import { useApiKeyAction } from "./apiKeyActions";
import { supportsOAuthQuota } from "../../../src/shared/oauthProviders";

// Custom providers are OpenAI- or Anthropic-compatible endpoints only.
const KIND_ORDER: ProviderKind[] = ["openai", "anthropic"];

const customKindLabel = (kind: ProviderKind): string =>
  kind === "anthropic" ? "Anthropic-compatible" : PROVIDER_PRESETS[kind].label;

type TestState = { status: "idle" | "testing" | "ok" | "error"; message?: string };

function ProviderModal({ provider, method, isNew, onClose, onBack, onSave }: {
  provider: ProviderConfig;
  method: "api" | "local" | "custom";
  isNew: boolean;
  onClose: () => void;
  onBack: () => void;
  onSave: (provider: ProviderConfig, apiKey?: string) => void;
}) {
  const [draft, setDraft] = React.useState<ProviderConfig>(provider);
  const [keyDraft, setKeyDraft] = React.useState("");
  const [test, setTest] = React.useState<TestState>({ status: "idle" });
  const [error, setError] = React.useState("");
  const testRequest = React.useRef<{ id: string; timer: number } | undefined>(undefined);
  const clearTest = React.useCallback(() => {
    if (testRequest.current) window.clearTimeout(testRequest.current.timer);
    testRequest.current = undefined;
  }, []);
  const resetTest = () => { clearTest(); setTest({ status: "idle" }); setError(""); };
  const set = (patch: Partial<ProviderConfig>) => { setDraft(current => ({ ...current, ...patch })); resetTest(); };
  const label = method === "custom" ? "custom provider" : providerLabel(draft.kind);
  const showKey = PROVIDER_PRESETS[draft.kind].needsKey;
  const requiresKey = method === "api" && !draft.hasKey;
  const valid = () => {
    if (!draft.name.trim()) { setError("Enter a provider name."); return false; }
    try {
      const url = new URL(draft.baseUrl.trim());
      if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) throw new Error();
    } catch { setError("Enter a valid HTTP or HTTPS base URL without credentials, query parameters or a fragment."); return false; }
    if (requiresKey && !keyDraft.trim()) { setError("Enter your API key to connect."); return false; }
    setError(""); return true;
  };
  React.useEffect(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data;
      if (message?.type !== "modelsFetched" || message.providerId !== draft.id || !testRequest.current || message.requestId !== testRequest.current.id) return;
      clearTest();
      setTest(message.error ? { status: "error", message: String(message.error).slice(0, 200) }
        : { status: "ok", message: `${(message.models || []).length} models available` });
    };
    window.addEventListener("message", handler);
    return () => { window.removeEventListener("message", handler); clearTest(); };
  }, [draft.id, clearTest]);
  const runTest = () => {
    if (!valid()) return;
    clearTest();
    const requestId = uid("provider-test");
    const timer = window.setTimeout(() => {
      if (testRequest.current?.id !== requestId) return;
      testRequest.current = undefined;
      setTest({ status: "error", message: "Connection test did not respond. Try again." });
    }, 30_000);
    testRequest.current = { id: requestId, timer };
    setTest({ status: "testing" });
    vscode.postMessage({ type: "fetchModels", requestId, apiBaseUrl: draft.baseUrl.trim(), providerId: draft.id,
      anthropic: draft.kind === "anthropic", apiKey: keyDraft.trim() || undefined });
  };
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid()) return;
    onSave({ ...draft, name: draft.name.trim(), baseUrl: draft.baseUrl.trim().replace(/\/+$/, ""),
      hasKey: !!draft.hasKey || !!keyDraft.trim(), enabled: isNew ? true : draft.enabled }, keyDraft.trim() || undefined);
    onClose();
  };
  return <SettingsDialog title={isNew ? `Connect ${label}` : `Edit ${label}`} onClose={onClose} className="provider-connection">
    <form onSubmit={save}>
      <div className="modal-body">
        <div className="provider-connection-heading"><span className="provider-logo"><ProviderIcon provider={draft.kind} size={26} /></span>
          <div><strong>{method === "custom" ? "Custom endpoint" : providerLabel(draft.kind)}</strong>
            <p className="panel-hint">{method === "local" ? "Connect to a running local server. No account is required."
              : method === "custom" ? "Connect your own compatible server or gateway."
              : "Connect using an API key from your provider account."}</p></div>
        </div>
        {method !== "api" && <label className="fc-field"><span>Name</span>
          <input data-dialog-autofocus value={draft.name} onChange={event => set({ name: event.target.value })} placeholder="My provider" />
        </label>}
        {method === "custom" && <label className="fc-field"><span>Type</span>
          <Select value={draft.kind} onChange={event => { const kind = event.target.value as ProviderKind; set({ kind, baseUrl: PROVIDER_PRESETS[kind].baseUrl }); }}>
            {KIND_ORDER.map(kind => <option key={kind} value={kind}>{customKindLabel(kind)}</option>)}
          </Select>
        </label>}
        <label className="fc-field"><span>Base URL</span>
          <input type="url" readOnly={method === "api"} value={draft.baseUrl} onChange={event => set({ baseUrl: event.target.value })} placeholder="https://example.com/v1" />
        </label>
        {showKey && <label className="fc-field"><span>API key{draft.hasKey ? " (saved)" : method === "custom" ? " (optional)" : ""}</span>
          <input aria-label="API key" type="password" autoComplete="off" spellCheck={false} data-dialog-autofocus={method === "api" || undefined}
            value={keyDraft} placeholder={draft.hasKey ? "Leave blank to keep the saved key" : "Enter API key"}
            onChange={event => { setKeyDraft(event.target.value); resetTest(); }} />
        </label>}
        {showKey && <p className="panel-hint">Keys are stored in VS Code's secure storage.</p>}
        {error && <div className="fc-error" role="alert">{error}</div>}
        <div className="test-row">
          <button type="button" className="btn-ghost" onClick={runTest} disabled={test.status === "testing" || (requiresKey && !keyDraft.trim())}>
            {test.status === "testing" ? "Testing…" : "Test connection"}</button>
          {test.status === "ok" && <span className="test-result ok" role="status"><Icon name="check" size={13} /> {test.message}</span>}
          {test.status === "error" && <span className="test-result err" role="alert">{test.message || "Connection failed"}</span>}
        </div>
      </div>
      <div className="modal-foot provider-connection-actions">
        <button type="button" className="btn-ghost provider-back" onClick={onBack}><Icon name="chevL" size={14} /> Back to providers</button>
        <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={requiresKey && !keyDraft.trim()}>{isNew ? "Connect" : "Save"}</button>
      </div>
    </form>
  </SettingsDialog>;
}

/** A connected OAuth account card, expandable to show usage limits. */
export function OAuthAccountCard({ account, defaultOpen, refreshToken = 0, grouped = false }: { account: OAuthAccountInfo; defaultOpen?: boolean; refreshToken?: number; grouped?: boolean }) {
  const [open, setOpen] = React.useState(!!defaultOpen);
  const [limits, setLimits] = React.useState<OAuthLimit[] | null>(null);
  const [resetCredits, setResetCredits] = React.useState<number | undefined>(undefined);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [loading, setLoading] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);
  const [resetMsg, setResetMsg] = React.useState<string | undefined>(undefined);
  const [resetNeedsRefresh, setResetNeedsRefresh] = React.useState(false);
  const limitsRequest = React.useRef<{ requestId: string; timer: number } | undefined>(undefined);
  const resetRequest = React.useRef<{ requestId: string; timer: number } | undefined>(undefined);
  const previousRefresh = React.useRef(refreshToken);
  const waitForLimits = React.useCallback((requestId: string) => {
    if (limitsRequest.current) window.clearTimeout(limitsRequest.current.timer);
    setLoading(true);
    setError(undefined);
    const timer = window.setTimeout(() => {
      if (limitsRequest.current?.requestId !== requestId) return;
      limitsRequest.current = undefined;
      setLoading(false);
      setError("Quota refresh did not respond. Try Refresh limits again.");
    }, 30_000);
    limitsRequest.current = { requestId, timer };
  }, []);
  const load = React.useCallback(() => {
    // The host refreshes quota after a reset; avoid racing the reset operation.
    if (resetRequest.current) return;
    const requestId = uid("quota");
    waitForLimits(requestId);
    vscode.postMessage({ type: "oauthLimits", id: account.id, requestId });
  }, [account.id, waitForLimits]);
  React.useEffect(() => {
    const handler = (e: MessageEvent) => {
      const m = e.data;
      if (m?.type === "oauthLimits" && m.id === account.id) {
        const active = limitsRequest.current;
        if (!active || m.requestId !== active.requestId) return;
        window.clearTimeout(active.timer);
        limitsRequest.current = undefined;
        if (!m.error) {
          setLimits(m.limits || []);
          setResetCredits(m.resetCredits);
          setResetNeedsRefresh(false);
        }
        setError(m.error);
        setLoading(false);
      } else if (m?.type === "oauthResetResult" && m.id === account.id) {
        const active = resetRequest.current;
        if (!active || m.requestId !== active.requestId) return;
        window.clearTimeout(active.timer);
        resetRequest.current = undefined;
        setResetting(false);
        setResetMsg(m.ok ? "Windows reset." : (m.message || "Reset failed."));
        // A reset can consume a credit; cached pre-reset credits must not
        // enable another operation if the follow-up quota refresh fails.
        setResetNeedsRefresh(true);
        // Host sends a quota reply with this same ID after the reset result.
        waitForLimits(active.requestId);
      }
    };
    window.addEventListener("message", handler);
    return () => {
      window.removeEventListener("message", handler);
      if (limitsRequest.current) window.clearTimeout(limitsRequest.current.timer);
      if (resetRequest.current) window.clearTimeout(resetRequest.current.timer);
      limitsRequest.current = undefined;
      resetRequest.current = undefined;
    };
  }, [account.id, waitForLimits]);
  // Auto-load limits when rendered open (the Usage & Quota page).
  React.useEffect(() => { if (defaultOpen) load(); }, [defaultOpen, load]);
  React.useEffect(() => {
    if (previousRefresh.current === refreshToken) return;
    previousRefresh.current = refreshToken;
    if (open) load();
  }, [refreshToken, open, load]);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && limits === null) load();
  };
  const refresh = (e: React.MouseEvent) => { e.stopPropagation(); load(); };
  const doReset = () => {
    if (resetRequest.current || resetNeedsRefresh) return;
    if (limitsRequest.current) window.clearTimeout(limitsRequest.current.timer);
    limitsRequest.current = undefined;
    setLoading(false);
    const requestId = uid("quota-reset");
    const timer = window.setTimeout(() => {
      if (resetRequest.current?.requestId !== requestId) return;
      resetRequest.current = undefined;
      setResetting(false);
      setResetNeedsRefresh(true);
      setResetMsg("Reset result not received. Refresh limits before retrying.");
    }, 30_000);
    resetRequest.current = { requestId, timer };
    setResetting(true);
    setResetMsg(undefined);
    vscode.postMessage({ type: "oauthResetCredit", id: account.id, requestId });
  };
  const enabled = account.disabled !== true;
  return (
    <div className="feature-card" style={enabled ? undefined : { opacity: 0.55 }}>
      <div className="fc-head" style={{ cursor: "pointer" }} onClick={toggle}>
        <div className="fc-title-input" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name={open ? "chevD" : "chevR"} size={14} />
          {!grouped && <><ProviderIcon provider={account.kind} size={20} /><span>{OAUTH_LABEL[account.kind]}</span></>}
          <span className={grouped ? "oauth-account-name" : "row-desc"}>{!grouped && "· "}{account.email || account.accountId || `Account ${account.id.slice(-6)}`}</span>
          {!enabled && <span className="badge-tag">Disabled</span>}
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
          {open && (
            <button className="icon-btn" onClick={refresh} title="Refresh limits" disabled={loading || resetting}>
              <Icon name="reset" size={14} />
            </button>
          )}
          <button className="icon-btn" onClick={() => vscode.postMessage({ type: "oauthDisconnect", id: account.id })} title="Sign out">
            <Icon name="trash" size={14} />
          </button>
          <Toggle label={`Enable ${OAUTH_LABEL[account.kind]} ${account.email || account.accountId || "account"}`} checked={enabled} onChange={(v) => vscode.postMessage({ type: "oauthSetEnabled", id: account.id, enabled: v })} />
        </div>
      </div>
      {open && (
        <div className="fc-body">
          {loading && <div className="row-desc" role="status">{limits === null ? "Loading limits…" : "Refreshing limits…"}</div>}
          {error && <div className="row-desc" role="alert">{error}{limits !== null && " Showing the last available limits."}</div>}
          {limits && limits.length === 0 ? (
            <div className="row-desc">No usage limits available.</div>
          ) : (
            (limits || []).map((l) => {
              const pct = Math.max(0, Math.min(100, Math.round(l.remaining)));
              return (
                <div key={l.label}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
                    <span className="row-desc">{l.label}</span>
                    <span className="row-desc">
                      {pct}% left{l.resetsAt ? ` · resets ${new Date(l.resetsAt).toLocaleString()}` : ""}
                    </span>
                  </div>
                  <div className="index-bar"><div className="index-bar-fill" style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })
          )}
          {account.kind === "codex" && resetCredits !== undefined && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, paddingTop: 10, borderTop: "1px solid var(--vscode-panel-border, #333)" }}>
              <span className="row-desc">Reset credits: {resetCredits}{resetMsg ? ` · ${resetMsg}` : ""}</span>
              <button className="btn-ghost" onClick={doReset} disabled={resetting || loading || resetNeedsRefresh || resetCredits <= 0} title="Spend one credit to reset your rate-limit windows now">
                {resetting ? "Resetting…" : "Reset windows"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Existing browser/manual completion controls remain visible during login. */
function OAuthLoginProgress({ status, starting, onCancel }: { status: OAuthStatus; starting?: OAuthKind; onCancel: () => void }) {
  const [manual, setManual] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  const pending = status.pending ?? starting;
  const deviceLogin = status.loginMethod === "device-code";
  const importLogin = status.loginMethod === "import-token";
  React.useEffect(() => { setManual(""); setCopied(false); }, [pending, status.authorizationUrl]);
  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message?.type === "oauthLinkCopied" && message.kind === pending && message.authorizationUrl === status.authorizationUrl) setCopied(true);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [pending, status.authorizationUrl]);
  const submitManual = () => {
    if (!manual.trim() || !pending) return;
    vscode.postMessage({ type: "oauthManualCallback", kind: pending, url: manual.trim() });
  };
  if (!pending) return null;
  return <div className="oauth-progress" role="region" aria-label="Account sign-in"><div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>{status.pending ? "Signing in to" : "Starting sign-in to"} {OAUTH_LABEL[pending]}…</span>
            <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          </div>
          {status.userCode && <label className="fc-field"><span>Device sign-in code</span><input aria-label="Device sign-in code" readOnly value={status.userCode} onFocus={event => event.currentTarget.select()} /></label>}
          {status.authorizationUrl && (
            <>
              <p className="panel-hint" style={{ margin: 0 }}>If the browser did not open, open or copy this link.</p>
              <input aria-label="Authorization URL" readOnly value={status.authorizationUrl} onFocus={(event) => event.currentTarget.select()} style={{ width: "100%", boxSizing: "border-box" }} />
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn-ghost" onClick={() => vscode.postMessage({ type: "oauthOpenLogin", kind: pending })}>Open browser</button>
                <button className="btn-ghost" onClick={() => vscode.postMessage({ type: "oauthCopyLogin", kind: pending })}>{copied ? "Copied" : "Copy link"}</button>
              </div>
            </>
          )}
          {deviceLogin ? <p className="panel-hint" style={{ margin: 0 }}>Enter the code in your browser. OpenCursor will finish connecting when you approve the sign-in.</p> : <>
          <p className="panel-hint" style={{ margin: 0 }}>{importLogin ? "Paste your provider access token to connect this account. It will be saved in VS Code's secure storage." : "After signing in, if the browser cannot return to VS Code, paste the full callback URL from its address bar below."}</p>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <input
              aria-label={importLogin ? "Account access token" : "Callback URL or authorization code"}
              type={importLogin ? "password" : "text"} autoComplete="off" spellCheck={false}
              style={{ minWidth: 260, flex: 1 }}
              placeholder={importLogin ? "Account access token" : "Callback URL or authorization code"}
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitManual(); }}
            />
            <button className="btn-ghost" disabled={!manual.trim()} onClick={submitManual}>Submit</button>
          </div>
          </>}
        </div></div>;
}

function GitLabAccountSetup({ onClose, onConnect }: { onClose: () => void; onConnect: (options: { clientId: string; baseUrl: string }) => void }) {
  const [clientId, setClientId] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("https://gitlab.com");
  const [error, setError] = React.useState("");
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const url = new URL(baseUrl.trim());
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error();
      if (!clientId.trim()) { setError("Enter your GitLab OAuth application ID."); return; }
      onConnect({ clientId: clientId.trim(), baseUrl: url.href.replace(/\/+$/, "") });
    } catch { setError("Enter an HTTPS GitLab URL without credentials or query parameters."); }
  };
  return <SettingsDialog title="Connect GitLab Duo" onClose={onClose} className="provider-connection"><form onSubmit={submit}>
    <div className="modal-body">
      <p className="panel-hint">Use the application ID for your GitLab OAuth application, then sign in through your browser.</p>
      <label className="fc-field"><span>GitLab URL</span><input aria-label="GitLab URL" type="url" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} /></label>
      <label className="fc-field"><span>Application ID</span><input aria-label="GitLab application ID" data-dialog-autofocus value={clientId} onChange={event => setClientId(event.target.value)} /></label>
      {error && <div className="fc-error" role="alert">{error}</div>}
    </div><div className="modal-foot"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn-primary" disabled={!clientId.trim()}>Continue to sign in</button></div>
  </form></SettingsDialog>;
}

export function ProvidersPanel({ features, setFeatures, oauthStatus }: {
  features: FeatureConfig; setFeatures: (features: Partial<FeatureConfig>) => void; oauthStatus: OAuthStatus;
}) {
  const [pickerScope, setPickerScope] = React.useState<ProviderPickerScope | null>(null);
  const [editing, setEditing] = React.useState<{ provider: ProviderConfig; method: "api" | "local" | "custom"; isNew: boolean } | null>(null);
  const [apiEditing, setApiEditing] = React.useState<{ provider: ProviderConfig; credential?: ProviderApiKey } | null>(null);
  const [starting, setStarting] = React.useState<OAuthKind>();
  const [gitLabSetup, setGitLabSetup] = React.useState(false);
  const [tab, setTab] = React.useState<ProviderPickerScope>("api");
  const pending = oauthStatus.pending ?? starting;
  const customActions = useApiKeyAction();
  React.useEffect(() => { vscode.postMessage({ type: "oauthGet" }); }, []);
  React.useEffect(() => { setStarting(undefined); }, [oauthStatus]);
  const remove = (id: string) => {
    void customActions.run({ action: "removeProvider", providerId: id });
  };
  const toggleEnabled = (id: string, enabled: boolean) =>
    setFeatures({ providers: features.providers.map(provider => provider.id === id ? { ...provider, enabled } : provider) });
  const save = (provider: ProviderConfig, apiKey?: string) => {
    if (apiKey) vscode.postMessage({ type: "saveProviderKey", providerId: provider.id, apiKey });
    const exists = features.providers.some(current => current.id === provider.id);
    setFeatures({ providers: exists ? features.providers.map(current => current.id === provider.id ? provider : current) : [...features.providers, provider] });
    setTab(provider.id.startsWith("popular:") ? "api" : "custom");
  };
  const startOAuth = (kind: OAuthKind) => {
    if (pending) return;
    setTab("accounts");
    if (kind === "gitlab") { setGitLabSetup(true); return; }
    setStarting(kind);
    vscode.postMessage({ type: "oauthLogin", kind });
  };
  const choose = (choice: ProviderChoice) => {
    setPickerScope(null);
    if (choice.method === "oauth") {
      startOAuth(choice.kind);
      return;
    }
    if (choice.method === "api") {
      const provider = features.providers.find(current => current.id === `popular:${choice.kind}`) ?? {
        id: `popular:${choice.kind}`, name: choice.label, kind: choice.kind, baseUrl: PROVIDER_PRESETS[choice.kind].baseUrl,
      };
      setApiEditing({ provider });
      return;
    }
    if (choice.method === "free") {
      setTab("free");
      void customActions.run({ action: "connect", providerId: `popular:${choice.kind}`, kind: choice.kind });
      return;
    }
    setEditing({ method: choice.method, isNew: true, provider: {
      id: uid("prov"), name: choice.label, kind: choice.kind, baseUrl: PROVIDER_PRESETS[choice.kind].baseUrl,
    } });
  };
  const cancelLogin = () => {
    if (pending) vscode.postMessage({ type: "oauthCancel", kind: pending });
    setStarting(undefined);
  };
  const apiProviders = features.providers.filter(provider => provider.id.startsWith("popular:") && PROVIDER_PRESETS[provider.kind].needsKey && apiKeysFor(provider).length > 0);
  const freeProviders = features.providers.filter(provider => provider.id.startsWith("popular:") && !PROVIDER_PRESETS[provider.kind].needsKey);
  const customProviders = features.providers.filter(provider => !provider.id.startsWith("popular:"));
  return <>
    <div className="providers-heading"><h1 className="page-title">Providers</h1>
      <button className="btn-primary" onClick={() => setPickerScope(tab)}><Icon name="plus" size={14} /> Add provider</button>
    </div>
    <div className="sub-tabs">
      <button className={"sub-tab" + (tab === "api" ? " active" : "")} onClick={() => setTab("api")}>API Providers</button>
      <button className={"sub-tab" + (tab === "accounts" ? " active" : "")} onClick={() => setTab("accounts")}>OAuth Accounts</button>
      <button className={"sub-tab" + (tab === "free" ? " active" : "")} onClick={() => setTab("free")}>No-auth Providers</button>
      <button className={"sub-tab" + (tab === "custom" ? " active" : "")} onClick={() => setTab("custom")}>Custom Providers</button>
    </div>
    {pending && <OAuthLoginProgress status={oauthStatus} starting={starting} onCancel={cancelLogin} />}
    {tab === "api" && <>
      <p className="panel-hint">Add your providers, then manage their keys and load balancing here.</p>
      {!apiProviders.length && <div className="empty-card">No API providers added. Click Add provider to connect your first key.</div>}
      {apiProviders.map(provider => <ApiProviderCard key={provider.id} provider={provider}
        onAdd={() => setApiEditing({ provider })} onEdit={credential => setApiEditing({ provider, credential })}
        onToggle={enabled => toggleEnabled(provider.id, enabled)} />)}
    </>}
    {tab === "accounts" && <>
          <div className="oauth-warning">
            ⚠️ This isn't an official integration. Your provider's terms may not allow it, so the account could be rate-limited, restricted, or banned. Use at your own risk.
          </div>
          <p className="panel-hint">Sign in with your existing subscription. Tokens are stored securely and refreshed automatically. You can add multiple accounts.</p>
          {[...OAUTH_PROVIDERS].sort((a, b) => Number(b.kind === oauthStatus.pending) - Number(a.kind === oauthStatus.pending))
            .filter((provider) => oauthStatus.errors[provider.kind])
            .map((provider) => <div className="fc-error" role="alert" key={provider.kind}><strong>{provider.label}:</strong> {oauthStatus.errors[provider.kind]}</div>)}
          {oauthStatus.accounts.length === 0 ? (
            <div className="empty-card">No accounts connected. Click “Add account”.</div>
          ) : (
            [...new Set(oauthStatus.accounts.map(account => account.kind))].map(kind => {
              const accounts = oauthStatus.accounts.filter(account => account.kind === kind);
              const label = OAUTH_LABEL[kind] || kind;
              const options = BALANCE_OPTIONS.filter(option => supportsOAuthQuota(kind) || option.value === "first" || option.value === "round-robin");
              const savedStrategy = oauthStatus.balanceStrategies?.[kind] ?? oauthStatus.balanceStrategy ?? "first";
              const strategy = options.some(option => option.value === savedStrategy) ? savedStrategy : "first";
              return <section key={kind} className="api-provider-card oauth-provider-card" aria-label={`${label} accounts`}>
                <div className="api-provider-head">
                  <span className="provider-logo"><ProviderIcon provider={kind} size={24} /></span>
                  <div className="pr-text"><div className="pr-name">{label}</div><div className="pr-sub">{accounts.length} {accounts.length === 1 ? "account" : "accounts"} · {accounts.filter(account => !account.disabled).length} enabled</div></div>
                  <button className="btn-ghost sm" disabled={!!pending} onClick={() => startOAuth(kind)}>
                    <Icon name="plus" size={13} /> Add account</button>
                </div>
                <div className="api-provider-routing">
                  <label><span>Load balancing</span><Select aria-label={`${label} account load balancing`} value={strategy}
                    onChange={event => vscode.postMessage({ type: "oauthSetBalance", kind, strategy: event.target.value })}>
                    {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </Select></label>
                  <p className="panel-hint">{options.find(option => option.value === strategy)?.desc}. Automatic failover uses another enabled {label} account before a response starts.</p>
                </div>
                <div className="oauth-account-list">{accounts.map(account => <OAuthAccountCard key={account.id} account={account} grouped />)}</div>
              </section>;
            })
          )}
      <div className="panel-actions"><button className="btn-ghost" onClick={() => setPickerScope("accounts")}>
        <Icon name="plus" size={14} /> Add account</button></div>
    </>}
    {tab === "free" && <>
      <p className="panel-hint">Connect providers that accept requests without an API key or account.</p>
      {customActions.error && <div className="fc-error" role="alert">{customActions.error}</div>}
      {!freeProviders.length && <div className="empty-card">No no-auth providers added. Click Add provider to choose one.</div>}
      {freeProviders.map(provider => <section className="api-provider-card" key={provider.id} aria-label={`${provider.name} no-auth provider`}>
        <div className="api-provider-head">
          <span className="provider-logo"><ProviderIcon provider={provider.kind} size={24} /></span>
          <div className="pr-text"><div className="pr-name">{provider.name}</div><div className="pr-sub">No authentication required · {provider.baseUrl}</div></div>
          <label className="api-key-toggle"><input type="checkbox" aria-label={`Enable ${provider.name}`} checked={provider.enabled !== false}
            onChange={event => toggleEnabled(provider.id, event.target.checked)} disabled={customActions.pending} /> Enabled</label>
          <button className="icon-btn" aria-label={`Remove ${provider.name} provider`} title="Remove provider" disabled={customActions.pending} onClick={() => remove(provider.id)}><Icon name="trash" size={14} /></button>
        </div>
      </section>)}
    </>}
    {tab === "custom" && <>
      <p className="panel-hint">Connect your own OpenAI-compatible or Anthropic-compatible server or gateway.</p>
      {customActions.error && <div className="fc-error" role="alert">{customActions.error}</div>}
      {!customProviders.length && <div className="empty-card">No custom providers yet.</div>}
      {customProviders.map(provider => <div className={"provider-row" + (provider.enabled !== false ? " active" : "")} key={provider.id}>
        <span className="provider-logo"><ProviderIcon provider={provider.kind} size={24} /></span>
        <div className="pr-text"><div className="pr-name">{provider.name || "(unnamed)"}</div>
          <div className="pr-sub">{customKindLabel(provider.kind)} · {provider.baseUrl}{provider.hasKey ? " · key set" : ""}</div></div>
        <button className="btn-ghost sm" onClick={() => setEditing({ provider, isNew: false, method: PROVIDER_PRESETS[provider.kind].needsKey ? "custom" : "local" })}>
          <Icon name="settings" size={13} /> Edit</button>
        <button className="icon-btn" disabled={customActions.pending} onClick={() => remove(provider.id)} title={`Remove ${provider.name}`}><Icon name="trash" size={14} /></button>
        <Toggle label={`Enable ${provider.name}`} checked={provider.enabled !== false} onChange={value => toggleEnabled(provider.id, value)} />
      </div>)}
      <div className="panel-actions"><button className="btn-ghost" onClick={() => setPickerScope("custom")}><Icon name="plus" size={14} /> Add Custom Provider</button></div>
    </>}
    {pickerScope && <ProviderPickerDialog scope={pickerScope} features={features} status={{ ...oauthStatus, pending }} onSelect={choose} onClose={() => setPickerScope(null)} />}
    {gitLabSetup && <GitLabAccountSetup onClose={() => setGitLabSetup(false)} onConnect={options => {
      setGitLabSetup(false); setStarting("gitlab"); vscode.postMessage({ type: "oauthLogin", kind: "gitlab", options });
    }} />}
    {apiEditing && <ApiKeyDialog key={`${apiEditing.provider.id}:${apiEditing.credential?.id ?? "new"}`} {...apiEditing}
      onClose={() => setApiEditing(null)} onBack={() => { setApiEditing(null); setPickerScope("api"); }} />}
    {editing && <ProviderModal key={editing.provider.id} {...editing} onClose={() => setEditing(null)} onSave={save}
      onBack={() => { setPickerScope(editing.method === "api" ? "api" : "custom"); setEditing(null); }} />}
  </>;
}
