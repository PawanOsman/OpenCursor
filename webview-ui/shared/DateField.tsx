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
import { Icon } from "./icons";
import { usePresence } from "./usePresence";
import "./date-field.css";

interface Day { year: number; month: number; day: number }
const daysInMonth = (year: number, month: number) => [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
const format = ({ year, month, day }: Day) => `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const parse = (value: string): Day => { const [year, month, day] = value.split("-").map(Number); return { year, month, day }; };
const inBounds = (day: Day) => day.year >= 1 && day.year <= 9999;
const asDate = ({ year, month, day }: Day) => { const date = new Date(0); date.setUTCFullYear(year, month - 1, day); return date; };
const shiftDays = (day: Day, count: number): Day => { const date = asDate(day); date.setUTCDate(date.getUTCDate() + count); return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }; };
const shiftMonths = (day: Day, count: number): Day => {
  const date = asDate({ ...day, day: 1 }); date.setUTCMonth(date.getUTCMonth() + count);
  const year = date.getUTCFullYear(), month = date.getUTCMonth() + 1;
  return { year, month, day: Math.min(day.day, daysInMonth(year, month)) };
};
const today = (): Day => { const date = new Date(); return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }; };

/** Strict date-only validation, including leap years and years 0001 through 9999. */
export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const day = parse(value);
  return inBounds(day) && day.month >= 1 && day.month <= 12 && day.day >= 1 && day.day <= daysInMonth(day.year, day.month);
}

export interface DateFieldProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  autoFocus?: boolean;
  required?: boolean;
  disabled?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  id?: string;
  className?: string;
}

/** Date-only text editing and a keyboard-accessible calendar share one value. */
export function DateField({ value, onChange, label, placeholder = "YYYY-MM-DD", autoFocus, required, disabled, onKeyDown, id, className }: DateFieldProps) {
  const generatedId = React.useId();
  const inputId = id ?? `date-${generatedId}`;
  const calendarId = `${inputId}-calendar`;
  const input = React.useRef<HTMLInputElement>(null);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const field = React.useRef<HTMLDivElement>(null);
  const calendar = React.useRef<HTMLDivElement>(null);
  const pendingFocus = React.useRef(false);
  const [open, setOpen] = React.useState(false);
  const { present, exiting } = usePresence(open);
  const [side, setSide] = React.useState<"top" | "bottom">("bottom");
  const [activeDay, setActiveDay] = React.useState<Day>(() => isValidDate(value) ? parse(value) : today());
  const [month, setMonth] = React.useState<Day>(activeDay);
  const [position, setPosition] = React.useState<React.CSSProperties>({ left: 8, top: 8, opacity: 0, pointerEvents: "none" });
  const activeValue = format(activeDay);
  const todayValue = format(today());

  const close = (focus?: "input" | "trigger") => {
    setOpen(false);
    pendingFocus.current = false;
    if (focus) (focus === "input" ? input : trigger).current?.focus({ preventScroll: true });
  };
  const show = () => {
    if (disabled) return;
    const selected = isValidDate(value) ? parse(value) : today();
    setActiveDay(selected); setMonth(selected);
    setPosition({ left: 8, top: 8, opacity: 0, pointerEvents: "none" });
    pendingFocus.current = true; setOpen(true);
  };
  const choose = (day: Day) => {
    if (!open || disabled || !inBounds(day)) return;
    onChange(format(day)); close("input");
  };
  const moveMonth = (count: number) => {
    if (!open) return;
    const next = shiftMonths({ ...month, day: activeDay.day }, count);
    if (!inBounds(next)) return;
    setMonth(next); setActiveDay(next);
  };

  React.useLayoutEffect(() => { if (autoFocus && !disabled) input.current?.focus({ preventScroll: true }); }, [autoFocus, disabled]);
  React.useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  React.useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = field.current?.getBoundingClientRect();
      if (!anchor || !calendar.current) return;
      const margin = 8, gap = 6;
      const width = Math.min(280, Math.max(0, window.innerWidth - margin * 2));
      const height = Math.min(calendar.current.scrollHeight, Math.max(0, window.innerHeight - margin * 2));
      const below = window.innerHeight - anchor.bottom - margin - gap;
      const downward = below >= height || below >= anchor.top - margin - gap;
      const top = downward ? anchor.bottom + gap : anchor.top - height - gap;
      setSide(downward ? "bottom" : "top");
      setPosition({ width, maxHeight: Math.max(0, window.innerHeight - margin * 2), left: Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin)), top: Math.max(margin, Math.min(top, window.innerHeight - height - margin)), opacity: 1, pointerEvents: "auto" });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(place);
    if (field.current) observer?.observe(field.current);
    if (calendar.current) observer?.observe(calendar.current);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); observer?.disconnect(); };
  }, [open]);
  React.useLayoutEffect(() => {
    if (!open || !pendingFocus.current || position.opacity !== 1) return;
    // Position before focusing, without inherited visibility hiding the target
    // through the browser's next paint.
    const target = calendar.current?.querySelector<HTMLButtonElement>(`[data-date="${activeValue}"]`);
    if (target) { target.focus({ preventScroll: true }); pendingFocus.current = document.activeElement !== target; }
  }, [open, activeValue, position.opacity]);
  React.useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!calendar.current?.contains(event.target as Node) && !field.current?.contains(event.target as Node)) close();
    };
    const blur = (event: FocusEvent) => {
      if (!calendar.current?.contains(event.target as Node) && !field.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", blur);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("focusin", blur); };
  }, [open]);

  const onCalendarKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close("trigger"); return; }
    if (event.key === "Tab") {
      const stops = [...calendar.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled):not([tabindex="-1"])')];
      const index = stops.indexOf(document.activeElement as HTMLButtonElement);
      if (event.shiftKey && index <= 0 || !event.shiftKey && index === stops.length - 1) {
        event.preventDefault(); stops[event.shiftKey ? stops.length - 1 : 0]?.focus({ preventScroll: true });
      }
      return;
    }
    if (!(event.target as HTMLElement).hasAttribute("data-date")) return;
    const weekday = (asDate(activeDay).getUTCDay() + 6) % 7;
    let next: Day | undefined;
    if (event.key === "ArrowLeft") next = shiftDays(activeDay, -1);
    if (event.key === "ArrowRight") next = shiftDays(activeDay, 1);
    if (event.key === "ArrowUp") next = shiftDays(activeDay, -7);
    if (event.key === "ArrowDown") next = shiftDays(activeDay, 7);
    if (event.key === "Home") next = shiftDays(activeDay, -weekday);
    if (event.key === "End") next = shiftDays(activeDay, 6 - weekday);
    if (event.key === "PageUp") next = shiftMonths(activeDay, event.shiftKey ? -12 : -1);
    if (event.key === "PageDown") next = shiftMonths(activeDay, event.shiftKey ? 12 : 1);
    if (!next) return;
    event.preventDefault(); event.stopPropagation();
    if (!inBounds(next)) return;
    pendingFocus.current = true; setActiveDay(next); setMonth(next);
  };

  const monthStart = { ...month, day: 1 };
  const start = shiftDays(monthStart, -((asDate(monthStart).getUTCDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, index) => shiftDays(start, index));
  const monthLabel = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(asDate(monthStart));

  return <div className={`oc-date-field${className ? ` ${className}` : ""}`} ref={field}>
    <input ref={input} id={inputId} type="text" inputMode="numeric" autoComplete="off" maxLength={10}
      value={value} onChange={event => onChange(event.target.value)} aria-label={label} placeholder={placeholder}
      required={required} disabled={disabled} aria-invalid={value !== "" && !isValidDate(value) ? true : undefined}
      onKeyDown={event => { onKeyDown?.(event); if (!event.defaultPrevented && event.altKey && event.key === "ArrowDown") { event.preventDefault(); show(); } }} />
    <button ref={trigger} type="button" className="oc-date-trigger" disabled={disabled}
      aria-label={`${label}: Choose date`} title="Choose date" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? calendarId : undefined}
      onClick={() => open ? close("trigger") : show()}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="10" rx="2" /><path d="M5 2v3m6-3v3M3 7h10M5 9h1m2 0h1m2 0h1M5 11h1m2 0h1" /></svg>
    </button>
    {present && createPortal(<div ref={calendar} id={calendarId} className="oc-date-calendar" style={{ ...position, pointerEvents: exiting ? "none" : position.pointerEvents }}
      data-state={exiting ? "closing" : "open"} data-side={side} inert={exiting || undefined} aria-hidden={exiting || undefined}
      role="dialog" aria-label={`${label} calendar`} onKeyDown={open ? onCalendarKey : undefined}>
      <div className="oc-date-heading">
        <button type="button" className="oc-date-nav" aria-label="Previous month" disabled={month.year === 1 && month.month === 1} onClick={open ? () => moveMonth(-1) : undefined}><Icon name="chevL" /></button>
        <span id={`${calendarId}-month`} aria-live="polite">{monthLabel}</span>
        <button type="button" className="oc-date-nav" aria-label="Next month" disabled={month.year === 9999 && month.month === 12} onClick={open ? () => moveMonth(1) : undefined}><Icon name="chevR" /></button>
      </div>
      <div role="grid" aria-labelledby={`${calendarId}-month`}>
        <div role="row" className="oc-date-weekdays">{["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((day, index) => <span role="columnheader" key={day} aria-label={["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][index]}>{day}</span>)}</div>
        {Array.from({ length: 6 }, (_, week) => <div role="row" className="oc-date-week" key={week}>
          {days.slice(week * 7, week * 7 + 7).map(day => {
            const date = format(day);
            return <button key={date} type="button" role="gridcell" className="oc-date-day" data-date={date}
              data-outside={day.month !== month.month || undefined} data-today={date === todayValue || undefined}
              aria-label={date} aria-selected={date === value} aria-current={date === todayValue ? "date" : undefined}
              disabled={!inBounds(day)} tabIndex={open && date === activeValue ? 0 : -1} onFocus={open ? () => setActiveDay(day) : undefined} onClick={open ? () => choose(day) : undefined}>{day.day}</button>;
          })}
        </div>)}
      </div>
      <div className="oc-date-footer"><button type="button" onClick={open ? () => choose(today()) : undefined}>Today</button><span>YYYY-MM-DD</span></div>
    </div>, document.body)}
  </div>;
}
