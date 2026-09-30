/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as React from "react";

export const ControlLabelContext = React.createContext<string | undefined>(undefined);

export function Toggle({ checked, onChange, disabled, label }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  const rowLabel = React.useContext(ControlLabelContext);
  return (
    <label className={`switch${disabled ? " is-disabled" : ""}`}>
      <input type="checkbox" role="switch" aria-label={label ?? rowLabel ?? "Enable setting"} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden="true" />
      <span className="thumb" aria-hidden="true" />
    </label>
  );
}
