/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { useSyncExternalStore } from "react";

export type MotionPreference = "full" | "system" | "reduced";

let preference: MotionPreference = "full";
let reduced = false;
let initializers = 0;
let query: MediaQueryList | undefined;
let disconnect: (() => void) | undefined;
const listeners = new Set<() => void>();

function update() {
  const next = preference === "reduced" || preference === "system" && !!query?.matches;
  if (typeof document !== "undefined") document.documentElement.dataset.motion = next ? "reduced" : "full";
  if (next === reduced) return;
  reduced = next;
  listeners.forEach(listener => listener());
}

function connect() {
  if (!disconnect && typeof window !== "undefined" && typeof window.matchMedia === "function") {
    query = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      disconnect = () => query?.removeEventListener("change", update);
    } else if (typeof query.addListener === "function") {
      query.addListener(update);
      disconnect = () => query?.removeListener(update);
    }
  }
  update();
}

function release() {
  if (initializers || listeners.size) return;
  disconnect?.();
  disconnect = undefined;
  query = undefined;
}

/** Apply the saved extension preference to both CSS and component lifecycles. */
export function setMotionPreference(value?: MotionPreference) {
  preference = value === "system" || value === "reduced" ? value : "full";
  if (initializers || listeners.size) connect();
  else update();
}

/** Initialize before rendering so loading indicators use the same policy from their first frame. */
export function initializeMotionPreference(): () => void {
  initializers++;
  connect();
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    initializers--;
    release();
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  connect();
  return () => { listeners.delete(listener); release(); };
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => reduced, () => false);
}
