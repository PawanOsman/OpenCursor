/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { parseTodos } from "../../../src/shared/todoPresentation";
import * as React from "react";
import { AnimatedDisclosure } from "../../shared/AnimatedDisclosure";
import { TextSwap } from "../../shared/TextTransitions";
import { DateField, isValidDate } from "../../shared/DateField";
import { Icon, IconName } from "../../shared/icons";
import { basename, renderMarkdown } from "../../shared/markdown";
import { vscode } from "../../shared/vscode";
import type { ToolBlock, OutMessage, AssistantBlock, FileIconInfo } from "../types";

function post(msg: OutMessage) {
  vscode.postMessage(msg);
}

// ---- IDE file icons (resolved by the host from the active icon theme) ----
const iconCache = new Map<string, FileIconInfo | null>();
const iconWaiters = new Map<string, ((i: FileIconInfo | null) => void)[]>();
const loadedFonts = new Set<string>();

window.addEventListener("message", (e: MessageEvent) => {
  const m = e.data;
  if (m?.type !== "fileIcon") return;
  const icon: FileIconInfo | null = m.icon || null;
  iconCache.set(m.filename, icon);
  if (icon?.kind === "font" && !loadedFonts.has(icon.fontFamily)) {
    loadedFonts.add(icon.fontFamily);
    const style = document.createElement("style");
    style.textContent = `@font-face { font-family: "${icon.fontFamily}"; src: url("${icon.src}") format("${icon.format}"); }`;
    document.head.appendChild(style);
  }
  (iconWaiters.get(m.filename) || []).forEach((fn) => fn(icon));
  iconWaiters.delete(m.filename);
});

// fontCharacter is either a literal glyph ("") or an escape like "\\E001".
function decodeFontChar(ch: string): string {
  const m = ch.match(/^\\+([0-9a-fA-F]{4,6})$/);
  return m ? String.fromCodePoint(parseInt(m[1], 16)) : ch;
}

function FileIcon({ path, fallback }: { path: string; fallback: IconName }) {
  const filename = basename(path || "").toLowerCase();
  const [icon, setIcon] = React.useState<FileIconInfo | null>(() => iconCache.get(filename) ?? null);
  React.useEffect(() => {
    // filename changes while the tool args stream in ("" → partial → final):
    // always re-sync from the cache, and (re)request when unknown.
    if (!filename) { setIcon(null); return; }
    if (iconCache.has(filename)) { setIcon(iconCache.get(filename) ?? null); return; }
    let live = true;
    const fn = (i: FileIconInfo | null) => live && setIcon(i);
    iconWaiters.set(filename, [...(iconWaiters.get(filename) || []), fn]);
    post({ type: "getFileIcon", filename });
    return () => { live = false; };
  }, [filename]);

  if (icon?.kind === "img") return <img className="file-icon-img" src={icon.src} alt="" />;
  if (icon?.kind === "font") {
    return (
      <span
        className="file-icon-font"
        style={{ fontFamily: icon.fontFamily, color: icon.color, fontSize: icon.size }}
      >
        {decodeFontChar(icon.char)}
      </span>
    );
  }
  return <Icon name={fallback} />;
}

// Read-only subagent types (mirror of the backend set in agent/tools/agent.ts).
// A subagent is read-only ("Explore") only if it explicitly opts in OR uses a
// read-only subagent_type; otherwise it can edit and is shown as "Agent".
const RO_SUBAGENT_TYPES = new Set([
  "explore",
  "cursor-guide",
  "docs-researcher",
  "code-reviewer",
  "bugbot",
  "security-review",
  "ci-investigator",
]);
export function isReadonlySubagent(i: any): boolean {
  if (!i) return false;
  if (i.readonly === true) return true;
  if (i.readonly === false) return false;
  return RO_SUBAGENT_TYPES.has(String(i.subagent_type || ""));
}

function toolMeta(name: string, i: any): { icon: IconName; label: string; badge: string; cls: string } {
  if (typeof name !== "string" || !name.trim()) {
    return { icon: "file", label: "Tool", badge: "Tool", cls: "badge-read" };
  }
  i = i || {};
  switch (name) {
    case "read_file":
    case "Read":
      return { icon: "file", label: "Read " + basename(i.path), badge: "Read", cls: "badge-read" };
    case "list_dir":
    case "ListDir":
      return { icon: "folder", label: "List " + (i.path || "."), badge: "Read", cls: "badge-read" };
    case "glob":
    case "Glob":
      return { icon: "search", label: "Glob " + (i.pattern || ""), badge: "Read", cls: "badge-read" };
    case "grep":
    case "Grep":
      return { icon: "search", label: 'Grep "' + (i.pattern || "") + '"', badge: "Read", cls: "badge-read" };
    case "Rg":
      return { icon: "search", label: "rg " + (Array.isArray(i.args) ? i.args.join(" ") : ""), badge: "Read", cls: "badge-read" };
    case "Wait":
      return { icon: "task", label: "Wait " + (Number(i.ms) || 0) + "ms" + (i.reason ? " — " + i.reason : ""), badge: "Wait", cls: "badge-read" };
    case "SemanticSearch":
      return { icon: "search", label: "Search " + (i.query || ""), badge: "Read", cls: "badge-read" };
    case "SearchDocs":
      return { icon: "book", label: "Search " + (i.doc ? i.doc + " docs" : "docs") + (i.query ? ' "' + i.query + '"' : ""), badge: "Read", cls: "badge-read" };
    case "file_search":
    case "FileSearch":
      return { icon: "fileSearch", label: "Find " + (i.query || ""), badge: "Read", cls: "badge-read" };
    case "read_lints":
    case "ReadLints":
      return { icon: "ruler", label: "Lints" + (i.path ? " " + basename(i.path) : ""), badge: "Read", cls: "badge-read" };
    case "todo_read":
    case "TodoRead":
      return { icon: "todo", label: "Read todos", badge: "Read", cls: "badge-read" };
    case "todo_write":
    case "TodoWrite":
      return { icon: "todo", label: "Update todos", badge: "Plan", cls: "badge-plan" };
    case "web_search":
    case "WebSearch":
      return { icon: "globe", label: 'Search web "' + (i.search_term || "") + '"', badge: "Web", cls: "badge-web" };
    case "web_fetch":
    case "WebFetch":
      return { icon: "link", label: "Fetch " + (i.url || ""), badge: "Web", cls: "badge-web" };
    case "task":
    case "Task":
      return { icon: "task", label: i.description || "Subagent", badge: "Agent", cls: "badge-agent" };
    case "edit_file":
    case "StrReplace":
    case "Write":
      return { icon: "file", label: basename(i.path || ""), badge: "Edit", cls: "badge-edit" };
    case "delete_file":
    case "Delete":
      return { icon: "trash", label: "Delete " + basename(i.path), badge: "Edit", cls: "badge-edit" };
    case "run_terminal":
    case "Shell":
      return { icon: "terminal", label: i.command || "", badge: "Terminal", cls: "badge-term" };
    default: {
      // MCP tools arrive as "mcp__<Server>__<tool_name>"; prettify to "Server · tool name".
      const mcp = name.match(/^mcp__(.+?)__(.+)$/);
      if (mcp) {
        const server = mcp[1];
        const tool = mcp[2].replace(/[_-]+/g, " ").trim();
        return { icon: "link", label: `${server} · ${tool}`, badge: server, cls: "badge-web" };
      }
      return { icon: "file", label: name, badge: "Tool", cls: "badge-read" };
    }
  }
}

export const TaskActivityContext = React.createContext(false);

function TodoList({ block }: { block: ToolBlock }) {
  const running = React.useContext(TaskActivityContext);
  const items = parseTodos(block.result || "");
  const completed = items.filter(item => item.status === "completed").length;
  const occurrences = new Map<string, number>();
  const statusLabels: Record<string, string> = { pending: "Pending", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled" };
  return (
    <div className="tool-card todo-card">
      <div className="tool-card-header todo-header">
        <span className="ticon">
          <Icon name="todo" />
        </span>
        <span className="label">Tasks</span>
        <span className="right">
          {items.length > 0 && <span className="todo-count"><TextSwap text={`${completed}/${items.length} completed`} /></span>}
          <TimeoutBadge block={block} />
          {block.status !== "completed" && <StatusIcon status={block.status} callId={block.callId} />}
        </span>
      </div>
      <div className="todo-list" role="list" aria-label="Tasks">
        {items.length === 0 ? (
          <div className="todo-empty">{block.status === "running" ? "Updating…" : "(no todos)"}</div>
        ) : (
          items.map((t) => {
            const occurrence = occurrences.get(t.content) || 0;
            occurrences.set(t.content, occurrence + 1);
            const unfinished = t.status === "in_progress" && !running;
            const label = unfinished ? "Started, unfinished" : statusLabels[t.status];
            return <div key={`${t.content}:${occurrence}`} className={"todo-item " + t.status + (unfinished ? " unfinished" : "")} role="listitem">
              <span className="todo-mark" role="img" aria-label={label} title={label}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
                  <circle className="todo-ring" cx="8" cy="8" r="5.5" />
                  <circle className="todo-active" cx="8" cy="8" r="5.5" strokeDasharray="12 23" />
                  <path className="todo-check" d="m4 8 2.5 2.5L12 5" pathLength="1" />
                  <path className="todo-cancel" d="M5 8h6" />
                  <path className="todo-paused" d="M6 5.5v5M10 5.5v5" />
                </svg>
              </span>
              <span className="todo-text">{t.content}</span>
            </div>;
          })
        )}
      </div>
    </div>
  );
}

function SubagentCard({ block, onOpen, awaitingApproval }: { block: ToolBlock; onOpen?: (callId: string) => void; awaitingApproval?: boolean }) {
  const i = block.input || {};
  // Background subagents complete the parent tool-call immediately while they keep
  // streaming, so drive "running" off the subagent's own status, not the tool status.
  const subDone = block.subStatus === "finished" || block.subStatus === "cancelled" || block.subStatus === "error";
  const running = !subDone && (block.status === "running" || !!block.subStatus || (block.subBlocks?.length ?? 0) > 0);
  const steps = (block.subBlocks ?? []).filter((b) => b.kind === "tool").length;
  const subtitle = awaitingApproval
    ? "Waiting for approval…"
    : running
      ? subagentActivity(block.subBlocks)
      : undefined;
  // Live progress inline while it works; folds away once the subagent settles.
  // Steps follow the run itself — no manual disclosure on subagent cards.
  const open = running;
  const toolSteps = (block.subBlocks ?? []).filter((b): b is ToolBlock => b.kind === "tool");
  // Keep the card small: only the two most recent steps.
  const recent = toolSteps.slice(-2);
  const model = shortModelName(i.model);
  // Named subagent (built-in type or a configured team member) — "generalPurpose"
  // carries no information, so it stays hidden.
  const subType = String(i.subagent_type || "").trim();
  const subName = subType && subType !== "generalPurpose" ? subType : "";
  const statusKind = awaitingApproval
    ? "approval"
    : running
      ? (i.run_in_background === true ? "background" : "running")
      : block.subStatus === "error" || block.status === "error"
        ? "error"
        : block.subStatus === "cancelled"
          ? "cancelled"
          : "done";

  return (
    <div className={"subagent-card" + (awaitingApproval ? " needs-approval" : "")} onClick={() => onOpen?.(block.callId)} role="button" tabIndex={0} title="Open subagent"
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault(); event.currentTarget.click();
        }
      }}>
      <div className="subagent-card-main">
        <span className="ticon"><Icon name="task" /></span>
        <span className="label">{i.description || subName || "Subagent"}</span>
        <span className="subagent-card-actions">
          {running ? <RunningStop callId={block.callId} /> : <StatusIcon status={block.subStatus === "error" ? "error" : "completed"} />}
          <Icon name="chevR" size={14} className="sub-open-chev" />
        </span>
      </div>
      <div className="subagent-card-meta">
        <span className={"sub-status sub-status-" + statusKind}><TextSwap text={STATUS_LABELS[statusKind]} /></span>
        {subName ? <span className="sub-chip sub-type" title={`Subagent: ${subName}`}>{subName}</span> : null}
        {model ? <span className="sub-chip sub-model" title={String(i.model)}>{model}</span> : null}
        <span className="sub-chip sub-steps"><TextSwap text={`${steps} ${steps === 1 ? "step" : "steps"}`} /></span>
        <span className="badge badge-agent">{isReadonlySubagent(i) ? "Explore" : "Agent"}</span>
        {awaitingApproval ? <span className="badge badge-ask">Approve</span> : null}
      </div>
      {subtitle && !open ? <div className="subagent-card-subtitle">{subtitle}</div> : null}
      <AnimatedDisclosure open={open}>
        <div className="subagent-steps">
          {recent.length === 0 ? (
            <div className="subagent-step muted">{subtitle || (running ? "Starting…" : "No steps")}</div>
          ) : (
            recent.map((s) => {
              const m = toolMeta(s.name, s.input || {});
              return (
                <div key={s.callId} className={"subagent-step " + s.status}>
                  <span className="step-icon"><Icon name={m.icon} size={11} /></span>
                  <span className="step-label" title={m.label}>{m.label || s.name}</span>
                  <StatusIcon status={s.status} callId={s.callId} />
                </div>
              );
            })
          )}
          {recent.length > 0 && subtitle ? (
            <div className="subagent-step activity">
              <span className="step-icon"><span className="spinner" /></span>
              <span className="step-label" title={subtitle}><TextSwap text={subtitle} /></span>
            </div>
          ) : null}
        </div>
      </AnimatedDisclosure>
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  approval: "Needs approval",
  running: "Running",
  background: "In background",
  error: "Failed",
  cancelled: "Stopped",
  done: "Completed",
};

/** Compact model label: drop provider scope and any trailing version noise. */
function shortModelName(model: unknown): string {
  const raw = typeof model === "string" ? model.trim() : "";
  if (!raw) return "";
  const tail = raw.split("/").pop() || raw;
  return tail.length > 24 ? tail.slice(0, 23) + "…" : tail;
}

// Human-readable "what is the subagent doing right now" line, derived from the
// most recent streamed sub-block (tool call / thinking / text).
function subagentActivity(blocks?: AssistantBlock[]): string {
  const last = blocks && blocks.length ? blocks[blocks.length - 1] : undefined;
  if (!last) return "Starting…";
  if (last.kind === "thinking") return "Planning next move…";
  if (last.kind === "text") return "Generating…";
  if (last.kind === "tool") {
    const label = SUBAGENT_TOOL_ACTIVITY[last.name] || "Working…";
    return last.status === "running" ? label : "Planning next move…";
  }
  return "Working…";
}

const SUBAGENT_TOOL_ACTIVITY: Record<string, string> = {
  Read: "Reading files…", read_file: "Reading files…",
  ListDir: "Listing files…", list_dir: "Listing files…",
  Glob: "Finding files…", glob: "Finding files…",
  FileSearch: "Searching files…", file_search: "Searching files…",
  Grep: "Searching code…", grep: "Searching code…",
  SemanticSearch: "Searching codebase…", semantic_search: "Searching codebase…",
  SearchDocs: "Searching docs…",
  StrReplace: "Editing files…", Write: "Writing files…", edit_file: "Editing files…",
  Delete: "Deleting files…", delete_file: "Deleting files…",
  EditNotebook: "Editing notebook…",
  Shell: "Running command…", run_terminal: "Running command…",
  AwaitShell: "Waiting on command…",
  WebSearch: "Searching web…", web_search: "Searching web…",
  WebFetch: "Fetching page…", web_fetch: "Fetching page…",
  Task: "Delegating…", task: "Delegating…",
  TodoWrite: "Updating plan…", todo_write: "Updating plan…",
  ReadLints: "Checking lints…",
};

function PlanCard({ block, onImplement }: { block: ToolBlock; onImplement?: (path: string) => void }) {
  const i = block.input || {};
  const title: string = i.title || "Plan";
  const content: string = i.content || "";
  // The write_plan result is "wrote plan to .plans/<file>.md".
  const planPath = (block.result || "").replace(/^wrote plan to\s+/, "").trim() || undefined;
  const [open, toggleOpen] = useLiveDisclosure(block.status === "running");
  const done = block.status === "completed";

  return (
    <div className="plan-card">
      <div className="plan-header" onClick={toggleOpen} role="button" tabIndex={0} aria-expanded={open}
        onKeyDown={(event) => {
          if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault(); event.currentTarget.click();
          }
        }}>
        <span className={"tchev" + (open ? " open" : "")}>
          <Icon name="chevD" />
        </span>
        <span className="ticon">
          <Icon name="todo" />
        </span>
        <span className="plan-title">{title}</span>
        <TimeoutBadge block={block} />
        <span className="badge badge-plan">Plan</span>
        <StatusIcon status={block.status} callId={block.callId} />
      </div>
      {open && (
        <div className="plan-body">
          {content ? (
            <div className="markdown-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
          ) : (
            <div className="plan-empty">{block.status === "running" ? "Writing plan…" : "(empty plan)"}</div>
          )}
        </div>
      )}
      {done && (
        <div className="plan-actions">
          {planPath && (
            <button className="plan-open" onClick={() => post({ type: "openFile", path: planPath })}>
              <Icon name="file" /> {basename(planPath)}
            </button>
          )}
          <button className="plan-implement" onClick={() => onImplement && onImplement(planPath || "")}>
            <Icon name="agent" /> Implement plan
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Disclosure that follows the work: expanded while the block is live, collapsed
 * once it settles. A manual toggle wins until the block's live state changes
 * again, so the user is never fighting the automatic behaviour.
 */
export function useLiveDisclosure(live: boolean): [boolean, () => void] {
  const [open, setOpen] = React.useState(live);
  const manual = React.useRef(false);
  const prevLive = React.useRef(live);
  React.useEffect(() => {
    if (prevLive.current === live) return;
    prevLive.current = live;
    manual.current = false;
    setOpen(live);
  }, [live]);
  const toggle = React.useCallback(() => {
    manual.current = true;
    setOpen((o) => !o);
  }, []);
  return [open, toggle];
}

function StatusIcon({ status, callId }: { status: ToolBlock["status"]; callId?: string }) {
  if (status === "running") return <RunningStop callId={callId} />;
  return status === "completed" ? <Icon name="check" className="ok-icon" /> : <Icon name="close" className="err-icon" />;
}

/**
 * Visible stop button with a progress ring. The host registers an abort
 * for every in-flight tool and subagent under its call id, so one message
 * terminates any kind of running work.
 */
export function RunningStop({ callId }: { callId?: string }) {
  if (!callId) return <span className="spinner" />;
  return (
    <button
      type="button"
      className="spinner-stop"
      aria-label="Stop this task"
      title="Stop this task"
      onClick={(e) => {
        e.stopPropagation();
        post({ type: "cancelSubagent", callId, reason: "user" });
      }}
    >
      <span className="spinner" />
      <Icon name="stop" className="stop-icon" size={10} />
    </button>
  );
}

/** True while this tool/task should show a live timeout countdown. */
export function isToolCountdownActive(block: ToolBlock): boolean {
  if (block.name === "AskQuestion" || block.name === "ask_question") return false;
  // Task/subagent: no outer countdown — nested tools carry their own timeouts.
  if (block.name === "Task" || block.name === "task") return false;
  if (block.status === "completed" || block.status === "error") return false;
  return block.status === "running";
}

/**
 * Live display of the extension host's timeout deadline. The host exclusively
 * owns cancellation so webview timer throttling cannot race tool completion.
 */
export function useToolCountdown(block: ToolBlock): number | null {
  const budget = block.timeoutMs && block.timeoutMs > 0 ? block.timeoutMs : 0;
  const hostStarted = block.startedAt && block.startedAt > 0 ? block.startedAt : 0;
  const running = isToolCountdownActive(block);
  const localStart = React.useRef(0);
  const [left, setLeft] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!running || !budget || !block.callId) {
      localStart.current = 0;
      setLeft(null);
      return;
    }
    // Prefer host clock; fall back to first UI observation of this run.
    if (hostStarted) localStart.current = hostStarted;
    else if (!localStart.current) localStart.current = Date.now();
    const tick = () => {
      const start = hostStarted || localStart.current;
      if (!start) return;
      const sec = Math.max(0, Math.ceil((start + budget - Date.now()) / 1000));
      setLeft(sec);
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [budget, hostStarted, running, block.callId, block.status, block.subStatus, block.timeoutMs, block.name]);

  if (!running || !budget || left == null) return null;
  return left;
}

function formatCountdown(sec: number): string {
  if (sec >= 60) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }
  return `${sec}s`;
}

/** Visible countdown badge for the host-owned deadline. */
export function TimeoutBadge({ block }: { block: ToolBlock }) {
  const left = useToolCountdown(block);
  if (left == null) return null;
  const urgent = left <= 5;
  return (
    <span
      className={"tool-timeout" + (urgent ? " urgent" : "") + (left === 0 ? " zero" : "")}
      title="Timeout remaining — enforced by the extension host"
    >
      {left === 0 ? "timeout" : formatCountdown(left)}
    </span>
  );
}

/** Silent countdown state update for collapsed explore groups. */
export function ToolTimeoutWatch({ block }: { block: ToolBlock }) {
  useToolCountdown(block);
  return null;
}

function Diff({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  const needsExpand = lines.length > 6;
  const [expanded, setExpanded] = React.useState(!needsExpand);
  return (
    <>
      <div className={"tool-diff " + (expanded ? "expanded" : "collapsed")}>
        {lines.map((line, idx) => {
          const cls = line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "ctx";
          return (
            <div key={idx} className={"dl " + cls}>
              {line}
            </div>
          );
        })}
      </div>
      {needsExpand && (
        <button type="button" className="diff-expand" aria-expanded={expanded} aria-label={expanded ? "Collapse diff" : "Expand diff"} title={expanded ? "Collapse diff" : "Expand diff"} onClick={(e) => { e.stopPropagation(); setExpanded((x) => !x); }}>
          <Icon name="chevD" size={12} className={expanded ? "flip" : ""} />
        </button>
      )}
    </>
  );
}

// +N / -M counts from a unified diff.
function diffStats(diff: string): { add: number; del: number } {
  let add = 0, del = 0;
  for (const l of diff.split("\n")) {
    if (l.startsWith("+")) add++;
    else if (l.startsWith("-")) del++;
  }
  return { add, del };
}

export function ReadLine({ block }: { block: ToolBlock }) {
  const i = block.input || {};
  const start = block.startLine || i.start_line || "";
  const end = block.endLine || i.end_line || "";
  const rangeTxt = start && end ? start + "-" + end : start ? start + "-" : "";
  return (
    <div
      className="read-line"
      role="button"
      tabIndex={0}
      title={i.path || ""}
      aria-label={`Open ${i.path || "file"}${rangeTxt ? `, lines ${rangeTxt}` : ""}`}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault(); event.currentTarget.click();
        }
      }}
      onClick={() =>
        post({
          type: "openFile",
          path: i.path || "",
          startLine: start ? Number(start) : undefined,
          endLine: end ? Number(end) : undefined,
        })
      }
    >
      <span className="ricon">
        <Icon name="file" />
      </span>
      <span className="read-verb">Read </span>
      <span className="rname">{basename(i.path)}</span>
      <span className="rlines">{rangeTxt ? "L" + rangeTxt : ""}</span>
      <TimeoutBadge block={block} />
      <span className="rstatus">
        <StatusIcon status={block.status} callId={block.callId} />
      </span>
    </div>
  );
}

interface QItem { question: string; options?: string[]; multiple?: boolean; type?: "choices" | "text" | "textArea" | "number" | "date"; required?: boolean; placeholder?: string; id?: string }

// Normalize plain strings and {id,label} option objects to strings.
function optLabel(o: any): string {
  return typeof o === "string" ? o : String(o?.label ?? o?.id ?? "");
}

function QuestionCard({ block }: { block: ToolBlock }) {
  const header: string = block.input?.header || block.input?.title || "Questions";
  const questions: QItem[] = (Array.isArray(block.input?.questions) ? block.input.questions : []).map((q: any) => ({
    question: String(q?.question ?? q?.prompt ?? ""),
    options: Array.isArray(q?.options) ? q.options.map(optLabel) : undefined,
    multiple: !!(q?.multiple ?? q?.allow_multiple),
    type: typeof q?.type === "string" ? q.type : undefined,
    required: q?.required === true,
    placeholder: typeof q?.placeholder === "string" ? q.placeholder : undefined,
    id: typeof q?.id === "string" ? q.id : undefined,
  }));
  const answered = block.status !== "running";
  const [step, setStep] = React.useState(0);
  const [answers, setAnswers] = React.useState<Record<string, string[]>>(block.answers ?? {});
  const [custom, setCustom] = React.useState<Record<string, string>>({});
  const [customMode, setCustomMode] = React.useState<Record<string, boolean>>({});
  const [sent, setSent] = React.useState(false);

  if (questions.length === 0) return null;

  const q = questions[step];
  const opts = q.options || [];
  const sel = answers[String(step)] || [];
  const customText = custom[String(step)] || "";
  const customSelected = customMode[String(step)] || false;
  const setCustomSelected = (on: boolean) => setCustomMode((c) => ({ ...c, [String(step)]: on }));
  const isChoices = !q.type || q.type === "choices";
  const structuredValue = custom[String(step)] || "";
  const answerFor = (index: number): string[] => {
    const item = questions[index];
    const key = String(index);
    const text = (custom[key] || "").trim();
    if (item.type && item.type !== "choices") return text ? [text] : [];
    const selected = answers[key] || [];
    if (!customMode[key]) return selected;
    const choices = item.multiple ? selected : [];
    return text ? [...new Set([...choices, text])] : choices;
  };
  const validAnswer = (item: QItem, answer: string[]) => (!item.required || answer.length > 0)
    && (item.type !== "date" || !answer.length || isValidDate(answer[0]));
  const isValid = validAnswer(q, answerFor(step));

  const toggle = (opt: string) => {
    if (!q.multiple) setCustomSelected(false);
    setAnswers((a) => {
      const cur = a[String(step)] || [];
      if (q.multiple) {
        return { ...a, [String(step)]: cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt] };
      }
      return { ...a, [String(step)]: [opt] };
    });
  };
  const pickCustom = () => {
    if (!q.multiple) setAnswers((a) => ({ ...a, [String(step)]: [] }));
    setCustomSelected(true);
  };
  const submit = (skipCurrent = false) => {
    if (sent || (skipCurrent && q.required)) return;
    const final = Object.fromEntries(questions.map((_, i) => [String(i), skipCurrent && i === step ? [] : answerFor(i)]));
    const missing = questions.findIndex((item, i) => !validAnswer(item, final[String(i)]));
    if (missing !== -1) {
      setStep(missing);
      return;
    }
    setAnswers(final);
    setSent(true);
    post({ type: "answerQuestion", callId: block.callId, answers: final });
  };
  const advance = () => {
    if (!isValid) return;
    setStep((s) => s + 1);
  };
  const last = step === questions.length - 1;
  const skip = () => {
    if (q.required) return;
    if (last) {
      submit(true);
    } else {
      setAnswers((a) => ({ ...a, [String(step)]: [] }));
      setCustom((c) => ({ ...c, [String(step)]: "" }));
      setCustomSelected(false);
      setStep((s) => s + 1);
    }
  };

  if (answered || sent) {
    return (
      <div className="question-card done">
        <div className="qc-head"><Icon name="chat" size={14} /> {header}</div>
        {questions.map((qq, i) => {
          const a = (block.answers ?? answers)[String(i)] || [];
          return (
            <div className="qc-answered" key={i}>
              <div className="qc-q">{i + 1}. {qq.question}</div>
              <div className="qc-a">{a.length ? a.join(", ") : "(skipped)"}</div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="question-card">
      <div className="qc-head">
        <span><Icon name="chat" size={14} /> {header}</span>
        <span className="qc-step">{step + 1} of {questions.length}</span>
      </div>
      <div className="qc-question">{step + 1}. {q.question}{q.required && <span className="qc-required">*</span>}</div>
      {isChoices ? (
        <>
          {opts.map((opt, oi) => (
            <button
              key={oi}
              className={"qc-option" + (sel.includes(opt) && !(!q.multiple && customSelected) ? " selected" : "")}
              aria-pressed={sel.includes(opt) && !(!q.multiple && customSelected)}
              onClick={() => toggle(opt)}
            >
              <span className="qc-key">{String.fromCharCode(65 + oi)}</span>
              <span>{opt}</span>
            </button>
          ))}
          <button
            className={"qc-option qc-option-custom" + (customSelected ? " selected" : "")}
            aria-pressed={customSelected}
            onClick={() => (customSelected ? setCustomSelected(false) : pickCustom())}
          >
            <span className="qc-key">{String.fromCharCode(65 + opts.length)}</span>
            <span>Other…</span>
          </button>
          {customSelected && (
            <input
              className="qc-custom"
              aria-label={`${q.question}: Custom answer`}
              placeholder="Type a custom answer…"
              autoFocus
              value={customText}
              onChange={(e) => setCustom((c) => ({ ...c, [String(step)]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") (last ? submit() : advance());
              }}
            />
          )}
        </>
      ) : (
        <div className="qc-structured">
          {q.type === "textArea" ? (
            <textarea
              className="qc-textarea"
              aria-label={q.question}
              aria-required={q.required || undefined}
              placeholder={q.placeholder || "Type your answer…"}
              autoFocus
              value={structuredValue}
              onChange={(e) => setCustom((c) => ({ ...c, [String(step)]: e.target.value }))}
            />
          ) : q.type === "date" ? (
            <DateField value={structuredValue} label={q.question} placeholder={q.placeholder}
              autoFocus required={q.required} onChange={value => setCustom(c => ({ ...c, [String(step)]: value }))}
              onKeyDown={event => { if (event.key === "Enter") (last ? submit() : advance()); }} />
          ) : (
            <input
              className="qc-input"
              type={q.type === "number" ? "number" : "text"}
              aria-label={q.question}
              aria-required={q.required || undefined}
              placeholder={q.placeholder || "Type your answer…"}
              autoFocus
              value={structuredValue}
              onChange={(e) => setCustom((c) => ({ ...c, [String(step)]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") (last ? submit() : advance());
              }}
            />
          )}
        </div>
      )}
      <div className="qc-foot">
        {step > 0 && <button className="qc-nav" onClick={() => setStep((s) => s - 1)}>Back</button>}
        <span className="qc-spacer" />
        {!q.required && <button className="qc-skip" onClick={skip}>Skip</button>}
        <button className="qc-next" disabled={!isValid} onClick={() => (last ? submit() : advance())}>
          {last ? "Submit" : "Continue"}
        </button>
      </div>
    </div>
  );
}

// The code being written, pulled from whichever arg the edit tool streams.
function editPreview(name: string, i: any): string {
  if (name === "Write" || name === "edit_file") return String(i.contents ?? i.content ?? "");
  if (name === "StrReplace") return String(i.new_string ?? "");
  return "";
}

function ToolCardInner({ block, onImplement, onOpenSubagent, awaitingApproval }: { block: ToolBlock; onImplement?: (path: string) => void; onOpenSubagent?: (callId: string) => void; awaitingApproval?: boolean }) {
  if (block.name === "write_plan" || block.name === "WritePlan") return <PlanCard block={block} onImplement={onImplement} />;
  if (block.name === "ask_question" || block.name === "AskQuestion") return <QuestionCard block={block} />;
  if (block.name === "read_file" || block.name === "Read") return <ReadLine block={block} />;
  if (block.name === "todo_write" || block.name === "todo_read" || block.name === "TodoWrite" || block.name === "TodoRead") return <TodoList block={block} />;
  if (block.name === "task" || block.name === "Task") return <SubagentCard block={block} onOpen={onOpenSubagent} awaitingApproval={awaitingApproval} />;

  const i = block.input || {};
  const meta = toolMeta(block.name, i);
  const isEdit = block.name === "edit_file" || block.name === "StrReplace" || block.name === "Write";
  const isShell = block.name === "run_terminal" || block.name === "Shell" || block.name === "AwaitShell";
  // Expanded while the tool works, collapsed the moment it settles.
  const [open, toggleOpen] = useLiveDisclosure(block.status === "running");

  const onHeaderClick = () => {
    if (isEdit) {
      post({ type: "openFile", path: i.path || "", startLine: block.startLine });
    } else {
      toggleOpen();
    }
  };
  // Edit cards always show their body — the diff has its own expander.
  const showBody = isEdit || open;
  const shellCmd = isShell ? String(i.command || meta.label || "") : "";
  const shellParsed = isShell ? parseShellResult(block.result, shellCmd) : null;

  return (
    <div className={"tool-card " + (isEdit ? "edit-card" : "compact-card") + (isShell ? " shell-card" : "")}>
      <div className={"tool-card-header " + (isEdit ? "edit-header" : "compact") + (isShell ? " shell-header" : "")}
        role="button" tabIndex={0} aria-expanded={isEdit ? undefined : open} aria-label={isEdit ? `Open ${meta.label}` : meta.label}
        onKeyDown={(event) => {
          if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onHeaderClick(); }
        }} onClick={onHeaderClick}>
        <div className="left">
          {!isEdit && (
            <span className={"tchev" + (open ? " open" : "")}>
              <Icon name="chevD" />
            </span>
          )}
          <span className="ticon">
            {isEdit ? <FileIcon path={i.path || ""} fallback={meta.icon} /> : <Icon name={meta.icon} />}
          </span>
          {isShell ? (
            <span className="shell-prompt-line" title={shellCmd}>
              <span className="shell-prompt">$</span>
              <span className="shell-cmd">{shellCmd || "…"}</span>
            </span>
          ) : (
            <span className="label">{meta.label}</span>
          )}
          {isEdit && block.diff && (() => {
            const s = diffStats(block.diff);
            return (
              <span className="edit-stats">
                {s.add > 0 && <span className="stat-add">+{s.add}</span>}
                {s.del > 0 && <span className="stat-del">-{s.del}</span>}
              </span>
            );
          })()}
        </div>
        <div className="right">
          {isShell && shellCmd ? <CopyCommandButton command={shellCmd} /> : null}
          <TimeoutBadge block={block} />
          {!isEdit && <span className={"badge " + meta.cls} title={meta.badge}>{meta.badge}</span>}
          <StatusIcon status={block.status} callId={block.callId} />
        </div>
      </div>
      {showBody && (
        <div className="tool-card-body">
          {block.diff ? (
            <Diff diff={block.diff} />
          ) : isEdit && block.status === "running" ? (
            // Stream the code as the model writes it; swapped for the diff on completion.
            <pre className="tool-result streaming">{editPreview(block.name, i) || "Writing…"}</pre>
          ) : isShell && shellParsed ? (
            <TerminalBody parsed={shellParsed} running={block.status === "running"} />
          ) : (
            <pre className="tool-result">{block.status === "running" ? "Running…" : (block.result || "").slice(0, 4000)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

// Tool cards are the most numerous nodes in a long chat and their content is
// immutable once the call settles. Re-render only when this block's own
// identity/state changes, not on every stream frame elsewhere in the run.
export const ToolCard = React.memo(ToolCardInner, (a, b) =>
  a.block === b.block && a.onImplement === b.onImplement && a.onOpenSubagent === b.onOpenSubagent && a.awaitingApproval === b.awaitingApproval,
);

/** Terminal pane: streams live output and sticks to the bottom while running. */
function TerminalBody({
  parsed,
  running,
}: {
  parsed: { meta: string; body: string; footer: string; ok: boolean | null };
  running: boolean;
}) {
  const ref = React.useRef<HTMLPreElement>(null);
  React.useEffect(() => {
    if (!running) return;
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [parsed.body, running]);
  return (
    <div className={"shell-body" + (running ? " live" : "")}>
      {parsed.meta ? <div className="shell-meta">{parsed.meta}</div> : null}
      <pre className={"terminal-output" + (running ? " streaming" : "")} ref={ref}>
        {parsed.body || (running ? "Running…" : "")}
        {running ? <span className="term-caret" /> : null}
      </pre>
      {parsed.footer ? (
        <div className={"shell-footer" + (parsed.ok === false ? " err" : parsed.ok ? " ok" : "")}>
          {parsed.ok === true ? <Icon name="check" size={11} /> : null}
          <span>{parsed.footer}</span>
        </div>
      ) : null}
    </div>
  );
}

function CopyCommandButton({ command }: { command: string }) {
  const [copied, setCopied] = React.useState(false);
  const onCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    };
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(command).then(done).catch(() => {
        // fallback below
        try {
          const ta = document.createElement("textarea");
          ta.value = command;
          ta.style.position = "fixed";
          ta.style.left = "-9999px";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
          done();
        } catch { /* ignore */ }
      });
    } else {
      try {
        const ta = document.createElement("textarea");
        ta.value = command;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        done();
      } catch { /* ignore */ }
    }
  };
  return (
    <button
      type="button"
      className={"shell-copy-btn" + (copied ? " copied" : "")}
      title={copied ? "Copied" : "Copy command"}
      aria-label={copied ? "Copied" : "Copy command"}
      onClick={onCopy}
    >
      <Icon name={copied ? "check" : "copy"} size={12} />
    </button>
  );
}

/** Strip duplicated `$ command` lines from shell tool output for cleaner card body. */
function parseShellResult(raw: string | undefined, command: string): {
  meta: string;
  body: string;
  footer: string;
  ok: boolean | null;
} {
  if (!raw) return { meta: "", body: "", footer: "", ok: null };
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  let meta = "";
  let footer = "";
  let ok: boolean | null = null;
  const bodyLines: string[] = [];
  const cmdNorm = command.trim();
  for (const line of lines) {
    if (!meta && /^\[shell\s/.test(line)) {
      meta = line.replace(/^\[shell\s+/, "").replace(/\]\s*$/, "").trim();
      continue;
    }
    if (/^\(exit_code=/.test(line) || /^\(still running/.test(line)) {
      footer = line.replace(/^\(/, "").replace(/\)$/, "");
      const m = line.match(/exit_code=(-?\d+)/);
      if (m) ok = Number(m[1]) === 0;
      continue;
    }
    // Drop the echo of the command (header already shows it).
    const t = line.trim();
    if (t === `$ ${cmdNorm}` || t === cmdNorm || (cmdNorm && t === `$ ${cmdNorm}`)) continue;
    if (t.startsWith("$ ") && cmdNorm && t.slice(2).trim() === cmdNorm) continue;
    bodyLines.push(line);
  }
  // Trim leading/trailing blank lines from body.
  while (bodyLines.length && !bodyLines[0].trim()) bodyLines.shift();
  while (bodyLines.length && !bodyLines[bodyLines.length - 1].trim()) bodyLines.pop();
  return { meta, body: bodyLines.join("\n"), footer, ok };
}
