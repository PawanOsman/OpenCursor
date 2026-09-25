/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MessageActions, type MessageActionsProps } from "./MessageActions";

let root: Root, container: HTMLDivElement;
const writeText = vi.fn<(text: string) => Promise<void>>();
const execCommand = vi.fn<(command: string) => boolean>();
const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const status = () => container.querySelector('[role="status"]')!.textContent;
const render = (props: Partial<MessageActionsProps> = {}) => act(() => root.render(<div className="message-shell"><MessageActions variant="user" text="Hello **world**" {...props} /></div>));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  writeText.mockReset().mockResolvedValue(undefined);
  execCommand.mockReset().mockReturnValue(false);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (navigator as unknown as Record<string, unknown>).clipboard;
  delete (document as unknown as Record<string, unknown>).execCommand;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("copies the original message and reports success only after the clipboard resolves", async () => {
  let finish!: () => void;
  writeText.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  render();
  act(() => button("Copy message").click());
  expect(writeText).toHaveBeenCalledWith("Hello **world**");
  expect(button("Copy message").getAttribute("aria-disabled")).toBe("true");
  act(() => button("Copy message").click());
  expect(writeText).toHaveBeenCalledTimes(1);
  expect(status()).toBe("");
  expect(button("Copy message").title).toBe("Copy message");
  await act(async () => finish());
  expect(status()).toBe("Message copied");
  expect(button("Copy message").title).toBe("Copied");
  expect(button("Copy message").disabled).toBe(false);
  act(() => vi.advanceTimersByTime(1800));
  expect(status()).toBe("");
});

it("uses the fallback when clipboard access is denied and restores focus and selection", async () => {
  writeText.mockRejectedValue(new Error("Access denied"));
  execCommand.mockReturnValue(true);
  render();
  const source = document.createElement("p");
  source.textContent = "Previously selected text";
  container.appendChild(source);
  const range = document.createRange();
  range.selectNodeContents(source);
  button("Copy message").focus();
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  await act(async () => button("Copy message").click());
  expect(execCommand).toHaveBeenCalledWith("copy");
  expect(status()).toBe("Message copied");
  expect(document.activeElement).toBe(button("Copy message"));
  expect(window.getSelection()!.toString()).toBe(source.textContent);
  expect(document.querySelector("textarea")).toBeNull();
});

it("reports a failed copy without a false success and allows another attempt", async () => {
  writeText.mockRejectedValue(new Error("Access denied"));
  render();
  await act(async () => button("Copy message").click());
  expect(status()).toBe("Could not copy the message. Try again.");
  expect(button("Copy message").title).toBe("Copy failed. Try again");
  expect(button("Copy message").disabled).toBe(false);
  writeText.mockResolvedValue(undefined);
  await act(async () => button("Copy message").click());
  expect(status()).toBe("Message copied");
});

it("exposes optional actions with distinct labels and prevents disabled mutations", async () => {
  const onEdit = vi.fn(), onRetry = vi.fn(), onRevert = vi.fn();
  render({ onEdit, onRetry, onRevert, disabled: true });
  for (const label of ["Edit message", "Resend message", "Revert to this message"]) act(() => button(label).click());
  expect(onEdit).not.toHaveBeenCalled();
  expect(onRetry).not.toHaveBeenCalled();
  expect(onRevert).not.toHaveBeenCalled();
  await act(async () => button("Copy message").click());
  expect(writeText).toHaveBeenCalledTimes(1);
  render({ onEdit, onRetry, onRevert });
  for (const label of ["Edit message", "Resend message", "Revert to this message"]) act(() => button(label).click());
  expect(onEdit).toHaveBeenCalledTimes(1);
  expect(onRetry).toHaveBeenCalledTimes(1);
  expect(onRevert).toHaveBeenCalledTimes(1);
});

it("labels assistant retries separately and disables copying messages without text", () => {
  const onRetry = vi.fn();
  render({ variant: "assistant", text: "", onRetry });
  expect(button("Copy message").disabled).toBe(true);
  expect(container.querySelector('[aria-label="User message actions"]')).toBeNull();
  expect(container.querySelector('[aria-label="Assistant message actions"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Edit message"]')).toBeNull();
  expect(container.querySelector('[aria-label="Revert to this message"]')).toBeNull();
  act(() => button("Retry response").click());
  expect(onRetry).toHaveBeenCalledTimes(1);
});

it("safely finishes a pending clipboard operation after its message unmounts", async () => {
  let finish!: () => void;
  writeText.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  render();
  act(() => button("Copy message").click());
  act(() => root.render(null));
  await act(async () => finish());
  expect(vi.getTimerCount()).toBe(0);
});
