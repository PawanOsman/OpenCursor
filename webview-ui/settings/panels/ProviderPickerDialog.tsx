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
import { OAUTH_PROVIDERS, POPULAR_KINDS, FREE_KINDS, PROVIDER_PRESETS, type FeatureConfig, type OAuthKind, type OAuthStatus, type ProviderKind } from "../features";
import { SettingsDialog } from "./SettingsDialog";

export type ProviderChoice =
  | { method: "oauth"; kind: OAuthKind; label: string }
  | { method: "api" | "local" | "custom" | "free"; kind: ProviderKind; label: string };

export type ProviderPickerScope = "accounts" | "api" | "custom" | "free";
const PICKER_COPY: Record<ProviderPickerScope, { title: string; hint: string }> = {
  accounts: { title: "Add account", hint: "Choose an account provider to sign in with your subscription." },
  api: { title: "Add API provider", hint: "Choose an API provider to connect with your API key." },
  custom: { title: "Add custom provider", hint: "Choose the API format supported by your custom server or gateway." },
  free: { title: "Add no-auth provider", hint: "Connect a free provider without an account or API key." },
};

export const providerLabel = (kind: ProviderKind) => kind === "openai" ? "OpenAI" : PROVIDER_PRESETS[kind].label;

export function ProviderPickerDialog({ scope, features, status, onSelect, onClose }: {
  scope: ProviderPickerScope; features: FeatureConfig; status: OAuthStatus; onSelect: (choice: ProviderChoice) => void; onClose: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const needle = query.trim().toLowerCase();
  const groups: { scope: ProviderPickerScope; label: string; items: (ProviderChoice & { description: string })[] }[] = [
    { scope: "accounts", label: "Sign in with your account", items: OAUTH_PROVIDERS.map(provider => ({ method: "oauth", kind: provider.kind, label: provider.label, description: provider.sub })) },
    { scope: "api", label: "Connect with an API key", items: POPULAR_KINDS.map(kind => ({ method: "api", kind, label: providerLabel(kind), description: "API key" })) },
    { scope: "free", label: "No account or key required", items: FREE_KINDS.map(kind => ({ method: "free", kind, label: providerLabel(kind), description: "No sign-in needed" })) },
    { scope: "custom", label: "Custom endpoints", items: [
      { method: "custom", kind: "openai", label: "OpenAI-compatible endpoint", description: "Custom server or gateway" },
      { method: "custom", kind: "anthropic", label: "Anthropic-compatible endpoint", description: "Custom server or gateway" },
    ] },
  ];
  const filtered = groups.filter(group => group.scope === scope).map(group => ({ ...group, items: group.items.filter(item =>
    `${item.label} ${item.kind} ${item.description} ${group.label}`.toLowerCase().includes(needle)) })).filter(group => group.items.length);
  return <SettingsDialog title={PICKER_COPY[scope].title} onClose={onClose} className="provider-picker">
    <div className="provider-picker-intro">
      <p className="panel-hint">{PICKER_COPY[scope].hint}</p>
      <div className="provider-search">
        <Icon name="search" size={16} />
        <input type="search" aria-label="Search providers" placeholder="Search providers…" data-dialog-autofocus value={query} onChange={event => setQuery(event.target.value)} />
      </div>
    </div>
    <div className="provider-picker-list">
      {filtered.map(group => <section key={group.label} className="provider-picker-group" aria-label={group.label}>
        <h3>{group.label}</h3>
        <div className="provider-choice-grid">
          {group.items.map(choice => {
            const id = `${choice.method}:${choice.kind}`;
            const count = choice.method === "oauth" ? status.accounts.filter(account => account.kind === choice.kind).length : 0;
            const connected = choice.method === "api" && features.providers.some(provider => provider.id === `popular:${choice.kind}` && provider.hasKey);
            return <button type="button" key={id} data-provider-id={id} aria-label={choice.label} className="provider-choice" onClick={() => onSelect(choice)} disabled={choice.method === "oauth" && !!status.pending}>
              <span className="provider-logo"><ProviderIcon provider={choice.kind} size={24} /></span>
              <span className="provider-choice-text"><span className="provider-choice-name">{choice.label}</span>
                <span className="provider-choice-description">{count ? `${count} connected · add another` : connected ? "Connected · add another key" : choice.description}</span>
              </span>
              <Icon name="chevR" size={14} />
            </button>;
          })}
        </div>
      </section>)}
      {!filtered.length && <div className="provider-picker-empty" role="status">No providers match “{query}” in this section. Try another search.</div>}
    </div>
    <div className="modal-foot"><button className="btn-ghost" onClick={onClose}>Cancel</button></div>
  </SettingsDialog>;
}
