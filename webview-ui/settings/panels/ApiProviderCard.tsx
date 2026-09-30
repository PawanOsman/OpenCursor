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
import type { ProviderApiKey, ProviderConfig } from "../features";
import { providerLabel } from "./ProviderPickerDialog";
import { useApiKeyAction } from "./apiKeyActions";

export function apiKeysFor(provider: ProviderConfig): ProviderApiKey[] {
  return provider.apiKeys ?? (provider.hasKey ? [{ id: provider.id, label: "Key 1", hasKey: true }] : []);
}

export function ApiProviderCard({ provider, onAdd, onEdit, onToggle }: {
  provider: ProviderConfig; onAdd: () => void; onEdit: (key: ProviderApiKey) => void; onToggle: (enabled: boolean) => void;
}) {
  const { run, pending, error } = useApiKeyAction();
  const name = providerLabel(provider.kind);
  const keys = apiKeysFor(provider);
  const enabled = keys.filter(key => key.enabled !== false && key.hasKey !== false).length;
  return <section className="api-provider-card" aria-label={`${name} API provider`}>
    <div className="api-provider-head">
      <span className="provider-logo"><ProviderIcon provider={provider.kind} size={24} /></span>
      <div className="pr-text"><div className="pr-name">{name}</div><div className="pr-sub">{keys.length} {keys.length === 1 ? "key" : "keys"} · {enabled} enabled{provider.enabled === false ? " · provider disabled" : ""}</div></div>
      <button className="btn-ghost sm" onClick={onAdd} disabled={pending}><Icon name="plus" size={13} /> Add key</button>
      <label className="api-key-toggle"><input type="checkbox" aria-label={`Enable ${name}`} checked={provider.enabled !== false} onChange={event => onToggle(event.target.checked)} disabled={pending} /> Enabled</label>
      <button className="icon-btn" aria-label={`Remove ${name} provider`} title="Remove provider and its keys" disabled={pending} onClick={() => void run({ action: "removeProvider", providerId: provider.id })}><Icon name="trash" size={14} /></button>
    </div>
    <div className="api-provider-routing">
      <label><span>Load balancing</span><Select aria-label={`${name} load balancing`} value={provider.apiKeyBalance ?? "first"} disabled={pending}
        onChange={event => void run({ action: "setBalance", providerId: provider.id, strategy: event.target.value as "first" | "round-robin" })}>
        <option value="first">First available key</option><option value="round-robin">Round robin</option>
      </Select></label>
      <p className="panel-hint">Automatic failover uses another enabled key when a request fails before a response starts.</p>
    </div>
    <div className="api-key-list">
      {keys.map(key => <div className="api-key-row" key={key.id}>
        <Icon name="circleDot" size={16} />
        <div className="pr-text"><span className="pr-name">{key.label}</span><div className="pr-sub">{key.hasKey === false ? "Key missing — edit to reconnect" : key.enabled === false ? "Disabled" : "Enabled"}</div></div>
        <button className="btn-ghost sm" aria-label={`Edit ${name} ${key.label}`} disabled={pending} onClick={() => onEdit(key)}>Edit</button>
        <label className="api-key-toggle"><input type="checkbox" aria-label={`Enable ${name} ${key.label}`} checked={key.enabled !== false} disabled={pending || key.hasKey === false}
          onChange={event => void run({ action: "toggle", providerId: provider.id, keyId: key.id, enabled: event.target.checked })} /> Enabled</label>
        <button className="icon-btn" aria-label={`Remove ${name} ${key.label}`} title="Remove key" disabled={pending} onClick={() => void run({ action: "remove", providerId: provider.id, keyId: key.id })}><Icon name="trash" size={14} /></button>
      </div>)}
    </div>
    {error && <div className="fc-error" role="alert">{error}</div>}
  </section>;
}
