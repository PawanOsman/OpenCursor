/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import * as React from "react";
import { createPortal } from "react-dom";
import { usePresence } from "./usePresence";
import "./controls.css";

export interface SelectChangeEvent {
  target: { value: string; name: string };
  currentTarget: { value: string; name: string };
}

export interface SelectProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value" | "defaultValue" | "onChange" | "type"> {
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (event: SelectChangeEvent) => void;
  required?: boolean;
}

interface Choice { value: string; label: string; disabled: boolean; group?: number; title?: string }
interface ChoiceGroup { id: number; label: string }

function textContent(node: React.ReactNode): string {
  return React.Children.toArray(node).map(child => React.isValidElement<{ children?: React.ReactNode }>(child)
    ? textContent(child.props.children) : String(child)).join("");
}

function collectChoices(children: React.ReactNode) {
  const choices: Choice[] = [];
  const groups: ChoiceGroup[] = [];
  const walk = (nodes: React.ReactNode, group?: number, disabled = false) => {
    React.Children.forEach(nodes, child => {
      if (!React.isValidElement<React.OptionHTMLAttributes<HTMLOptionElement> & { children?: React.ReactNode }>(child)) return;
      if (child.type === "option") {
        if (child.props.hidden) return;
        const label = child.props.label ?? textContent(child.props.children);
        choices.push({ value: String(child.props.value ?? label), label, disabled: disabled || !!child.props.disabled, group, title: child.props.title });
      } else if (child.type === "optgroup") {
        const id = groups.length;
        groups.push({ id, label: child.props.label ?? "" });
        if (!child.props.hidden) walk(child.props.children, id, disabled || !!child.props.disabled);
      } else if (child.type === React.Fragment) walk(child.props.children, group, disabled);
    });
  };
  walk(children);
  return { choices, groups };
}

/** Single-value listbox with option/optgroup children and native-like change values. */
export function Select({ children, value, defaultValue, onChange, className, disabled, name = "", required,
  onClick, onKeyDown, onBlur, id, ...buttonProps }: SelectProps) {
  const generatedId = React.useId();
  const triggerId = id ?? `select-${generatedId}`;
  const listId = `${triggerId}-list`;
  const { choices, groups } = React.useMemo(() => collectChoices(children), [children]);
  const [uncontrolledValue, setUncontrolledValue] = React.useState(String(defaultValue ?? choices.find(choice => !choice.disabled)?.value ?? ""));
  const currentValue = value === undefined ? uncontrolledValue : String(value);
  const selectedIndex = choices.findIndex(choice => choice.value === currentValue);
  const [open, setOpen] = React.useState(false);
  const { present, exiting } = usePresence(open);
  const [side, setSide] = React.useState<"top" | "bottom">("bottom");
  const [activeValue, setActiveValue] = React.useState<string | null>(null);
  const active = choices.findIndex(choice => choice.value === activeValue && !choice.disabled);
  const setActive = (index: number) => setActiveValue(choices[index]?.value ?? null);
  const [position, setPosition] = React.useState<React.CSSProperties>({ left: 8, top: 8, visibility: "hidden" });
  const trigger = React.useRef<HTMLButtonElement>(null);
  const popup = React.useRef<HTMLDivElement>(null);
  const search = React.useRef({ text: "", at: 0 });
  const enabled = React.useMemo(() => choices.map((choice, index) => !choice.disabled ? index : -1).filter(index => index >= 0), [choices]);

  const close = (restoreFocus = false) => {
    setOpen(false);
    search.current = { text: "", at: 0 };
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  };
  const show = (index = selectedIndex) => {
    if (disabled) return;
    setActive(enabled.includes(index) ? index : enabled[0] ?? -1);
    setOpen(true);
  };
  const choose = (index: number) => {
    const choice = choices[index];
    if (!open || !choice || choice.disabled || disabled) return;
    if (value === undefined) setUncontrolledValue(choice.value);
    if (choice.value !== currentValue) {
      const target = { value: choice.value, name };
      onChange?.({ target, currentTarget: target });
    }
    close(true);
  };

  React.useLayoutEffect(() => {
    if (!open || !trigger.current || !popup.current) return;
    const anchor = trigger.current;
    const menu = popup.current;
    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect();
      const padding = 8;
      const gap = 4;
      const width = Math.min(Math.max(rect.width, 200), Math.max(0, window.innerWidth - padding * 2));
      const below = Math.max(0, window.innerHeight - rect.bottom - gap - padding);
      const above = Math.max(0, rect.top - gap - padding);
      // Measure wrapped labels at the final width before deciding which side fits.
      menu.style.width = `${width}px`;
      const desiredHeight = Math.min(menu.scrollHeight ? menu.scrollHeight + 2 : choices.length * 32 + groups.length * 26 + 12, 320);
      const upward = below < desiredHeight && above > below;
      setSide(upward ? "top" : "bottom");
      const maxHeight = Math.min(320, Math.max(0, window.innerHeight - padding * 2), upward ? above : below);
      const height = Math.min(desiredHeight, maxHeight);
      const preferredTop = upward ? rect.top - gap - height : rect.bottom + gap;
      setPosition({
        left: Math.max(padding, Math.min(rect.left, window.innerWidth - width - padding)),
        top: Math.max(padding, Math.min(preferredTop, window.innerHeight - padding - height)),
        width, maxHeight, visibility: "visible",
      });
    };
    updatePosition();
    const onScroll = (event: Event) => { if (!menu.contains(event.target as Node)) updatePosition(); };
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", onScroll, true);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(updatePosition);
    observer?.observe(anchor);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, choices.length, groups.length]);

  React.useLayoutEffect(() => {
    if (!open) return;
    const menu = popup.current;
    const option = menu?.querySelector<HTMLElement>(`[data-choice-index="${active}"]`);
    if (!menu || !option) return;
    // Scroll the list itself; scrolling ancestors would move the settings page.
    if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight)
      menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight;
  }, [open, active, position.maxHeight, position.width]);

  React.useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !popup.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open]);

  React.useLayoutEffect(() => {
    if (disabled) setOpen(false);
    else if (open && !enabled.includes(active)) {
      const fallback = enabled.includes(selectedIndex) ? selectedIndex : enabled[0] ?? -1;
      setActiveValue(choices[fallback]?.value ?? null);
    }
  }, [disabled, open, active, selectedIndex, enabled, choices]);

  const handleKey = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || disabled) return;
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === "Tab") { close(); return; }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "Home" || event.key === "End") show(event.key === "Home" ? enabled[0] : enabled[enabled.length - 1]);
      else if (!open) show(selectedIndex >= 0 ? selectedIndex : event.key === "ArrowUp" ? enabled[enabled.length - 1] : enabled[0]);
      else {
        const at = enabled.indexOf(active);
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setActive(enabled[(at + direction + enabled.length) % enabled.length] ?? -1);
      }
    } else if (event.key === "Enter" || (event.key === " " && (!search.current.text || Date.now() - search.current.at >= 700))) {
      event.preventDefault();
      if (open) choose(active); else show();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      const text = (now - search.current.at < 700 ? search.current.text : "") + event.key.toLocaleLowerCase();
      search.current = { text, at: now };
      const query = [...text].every(character => character === text[0]) ? text[0] : text;
      const start = query.length === 1 ? active + 1 : Math.max(active, 0);
      const match = choices.map((_, index) => (index + start + choices.length) % choices.length)
        .find(index => !choices[index].disabled && choices[index].label.toLocaleLowerCase().startsWith(query));
      if (match !== undefined) show(match);
    }
  };

  const option = (choice: Choice, index: number) => <div key={`${choice.value}-${index}`}
    id={`${listId}-${index}`} role="option" aria-selected={choice.value === currentValue} aria-disabled={choice.disabled || undefined}
    className="oc-select-option" data-choice-index={index} data-active={index === active || undefined} title={choice.title}
    onPointerMove={open ? () => { if (!choice.disabled) setActive(index); } : undefined} onClick={open ? () => choose(index) : undefined}>
    <span className="oc-select-option-label">{choice.label}</span>
    {choice.value === currentValue && <svg className="oc-select-check" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8 3 3 6-6" /></svg>}
  </div>;
  const renderedGroups = new Set<number>();

  return <>
    <button {...buttonProps} type="button" id={triggerId} ref={trigger} disabled={disabled}
      className={["oc-select-trigger", className].filter(Boolean).join(" ")}
      role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
      aria-required={required || undefined} aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
      onClick={event => { onClick?.(event); if (!event.defaultPrevented) { if (open) close(); else show(); } }}
      onKeyDown={handleKey} onBlur={event => { onBlur?.(event); if (!popup.current?.contains(event.relatedTarget as Node)) close(); }}>
      <span className="oc-select-value">{choices[selectedIndex]?.label ?? (currentValue || "Select…")}</span>
      <svg className="oc-select-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m5 6.5 3 3 3-3" /></svg>
    </button>
    {name && <input type="hidden" name={name} value={currentValue} disabled={disabled} form={buttonProps.form} />}
    {present && createPortal(<div ref={popup} id={listId} role="listbox" className="oc-select-popup" data-select-popup=""
      data-state={exiting ? "closing" : "open"} data-side={side} inert={exiting || undefined} aria-hidden={exiting || undefined}
      aria-label={buttonProps["aria-label"]} aria-labelledby={buttonProps["aria-label"] ? undefined : buttonProps["aria-labelledby"] ?? triggerId}
      style={{ ...position, pointerEvents: exiting ? "none" : undefined }} onMouseDown={open ? event => event.preventDefault() : undefined} onClick={open ? event => event.stopPropagation() : undefined}>
      {choices.map((choice, index) => {
        if (choice.group === undefined) return option(choice, index);
        if (renderedGroups.has(choice.group)) return null;
        renderedGroups.add(choice.group);
        return <div role="group" key={`group-${choice.group}`} aria-label={groups[choice.group].label}>
          <div className="oc-select-group">{groups[choice.group].label}</div>
          {choices.map((groupChoice, groupIndex) => groupChoice.group === choice.group ? option(groupChoice, groupIndex) : null)}
        </div>;
      })}
      {!choices.length && <div className="oc-select-empty">No options available</div>}
    </div>, document.body)}
  </>;
}
