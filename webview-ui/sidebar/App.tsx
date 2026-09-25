/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { sendMessageIntent, restoreTurns, type QueuedMessage, type ConversationGoal } from "../../src/shared/chatSession";
import { setQuestionAnswers } from "../../src/shared/turns";
import * as React from "react";
import { Icon } from "../shared/icons";
import { Select } from "../shared/Select";
import { ImagePreview } from "../shared/ImagePreview";
import { renderMarkdown } from "../shared/markdown";
import { vscode } from "../shared/vscode";
import { Composer, KIND_SVG, applyFileIconTo, type ComposerDraft } from "./components/Composer";
import { ToolCard, TaskActivityContext, isReadonlySubagent, TimeoutBadge, ToolTimeoutWatch, isToolCountdownActive, useLiveDisclosure } from "./components/Tool";
import { History } from "./components/History";
import { MessageActions } from "./components/MessageActions";
import { WorkingSection } from "./components/WorkingSection";
import { splitWork, hasLiveWork } from "./workPresentation";
import { QueuedMessageRow } from "./components/QueuedMessageRow";
import { ThinkingStatus } from "../shared/ThinkingStatus";
import { StaggerReveal, TextSwap } from "../shared/TextTransitions";
import { AnimatedDisclosure } from "../shared/AnimatedDisclosure";
import { setMotionPreference, type MotionPreference } from "../shared/motionPreference";
import { WorkflowDialog, GoalBanner, VerificationCard } from "./components/Workflow";
import type { AgentEvent, ApprovalMode, ApprovalPolicy, ApprovalRequestInfo, AssistantBlock, AssistantTurn, Attachment, ConversationSummary, ErrorBlock, InMessage, MentionItem, Mode, ModelDef, ModelOption, OutMessage, PendingChangeInfo, PersonaInfo, TeamInfo, ThinkingBlock, ToolBlock, Turn, UserTurn } from "./types";
import { applyEvent, applyToBlocks, closeTrailingThinking, forceSettleOpenWork, parsePartialArgs, renderMentionTokens } from "./types";

function post(msg: OutMessage) {
  vscode.postMessage(msg);
}

// Catches render exceptions so a transient error (e.g. opening/closing a subagent
// tab) shows a recoverable panel instead of blanking the whole webview.
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    post({ type: "logError", message: String(error?.stack || error), info: info?.componentStack || undefined } as any);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <div className="eb-title"><Icon name="close" size={16} /> Something went wrong</div>
          <pre className="eb-msg">{String(this.state.error?.message || this.state.error)}</pre>
          <div className="eb-actions">
            <button className="eb-btn" onClick={() => this.setState({ error: null })}>Recover</button>
            <button className="eb-btn ghost" onClick={() => post({ type: "openLog" })}>View log</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Present-tense labels for tool activity.
const TOOL_LABELS: Record<string, string> = {
  // Read
  read_file: "Reading file",
  Read: "Reading file",
  // LS (list directory)
  list_dir: "Listing directory",
  ListDir: "Listing directory",
  // Glob (file name search)
  glob: "Searching files",
  Glob: "Searching files",
  file_search: "Searching files",
  FileSearch: "Searching files",
  // Grep (content search)
  grep: "Grepping",
  Grep: "Grepping",
  // SemanticSearch (codebase)
  SemanticSearch: "Searching codebase",
  // SearchDocs (external docs)
  SearchDocs: "Searching docs",
  // ReadLints
  read_lints: "Reading lints",
  ReadLints: "Reading lints",
  // TodoWrite / read
  todo_read: "Reading todos",
  TodoRead: "Reading todos",
  todo_write: "Updating todos",
  TodoWrite: "Updating todos",
  // WebSearch / WebFetch
  web_search: "Searching the web",
  WebSearch: "Searching the web",
  web_fetch: "Fetching page",
  WebFetch: "Fetching page",
  // Task (subagent)
  task: "Running subagent",
  Task: "Running subagent",
  // AskQuestion
  ask_question: "Waiting for your answer",
  AskQuestion: "Waiting for your answer",
  // Edit
  edit_file: "Editing file",
  StrReplace: "Editing file",
  Write: "Writing file",
  // Delete
  delete_file: "Deleting file",
  Delete: "Deleting file",
  // EditNotebook
  EditNotebook: "Editing notebook",
  // Shell (terminal)
  run_terminal: "Running command",
  Shell: "Running command",
  AwaitShell: "Waiting for shell",
  // CreatePlan
  WritePlan: "Creating plan",
  // SwitchMode
  SwitchMode: "Switching mode",
  // MCP
  CallMcpTool: "Running MCP tool",
  FetchMcpResource: "Fetching MCP resource",
  ListMcpResources: "Listing MCP resources",
  BrowserNavigate: "Opening browser page",
  BrowserInspect: "Inspecting browser page",
  BrowserScreenshot: "Taking browser screenshot",
  BrowserInteract: "Interacting with browser page",
  BrowserClose: "Closing browser",
};
function toolLabel(name: string): string {
  if (name.startsWith("mcp__")) return "Running MCP tool";
  return TOOL_LABELS[name] || name;
}
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Read-only "explore the codebase" tools. Consecutive runs of these are folded
// into a single collapsible "Exploring" section so the chat isn't flooded.
const EXPLORE_TOOLS = new Set([
  "read_file", "Read",
  "list_dir", "ListDir",
  "glob", "Glob",
  "file_search", "FileSearch",
  "grep", "Grep",
  "SemanticSearch",
  "SearchDocs",
  "read_lints", "ReadLints",
  "todo_read", "TodoRead",
]);
function isExploreBlock(b: AssistantBlock): b is ToolBlock {
  return b.kind === "tool" && EXPLORE_TOOLS.has(b.name);
}

type RenderItem = AssistantBlock | { kind: "explore-group"; tools: ToolBlock[] };

// Fold consecutive explore tool-calls into explore-group items. A lone explore
// call (run length 1) is left as a normal block.
function groupBlocks(blocks: AssistantBlock[]): RenderItem[] {
  const out: RenderItem[] = [];
  let run: ToolBlock[] = [];
  const flush = () => {
    if (run.length >= 1) out.push({ kind: "explore-group", tools: run });
    run = [];
  };
  for (const b of blocks) {
    if (isExploreBlock(b)) run.push(b);
    else {
      flush();
      out.push(b);
    }
  }
  flush();
  return out;
}

// Each user prompt stays pinned within its own response. Leading assistant
// turns form a separate group without a pinned prompt.
function groupTurns(turns: Turn[]): { turn: Turn; index: number }[][] {
  const groups: { turn: Turn; index: number }[][] = [];
  turns.forEach((turn, index) => {
    if (turn.role === "user" || groups.length === 0) groups.push([{ turn, index }]);
    else groups[groups.length - 1].push({ turn, index });
  });
  return groups;
}

function responseText(blocks: AssistantBlock[]): string {
  return blocks.flatMap(block => block.kind === "text" ? [block.text] : block.kind === "error" ? [block.message] : []).join("\n\n");
}

// Summarize a finished explore group, e.g. "Explored 3 files · 2 searches".
function exploreSummary(tools: ToolBlock[]): string {
  let reads = 0;
  let searches = 0;
  let lints = 0;
  for (const t of tools) {
    if (t.name === "Read" || t.name === "read_file" || t.name === "ListDir" || t.name === "list_dir") reads++;
    else if (t.name === "ReadLints" || t.name === "read_lints" || t.name === "TodoRead" || t.name === "todo_read") lints++;
    else searches++;
  }
  const parts: string[] = [];
  if (reads) parts.push(`${reads} ${reads === 1 ? "file" : "files"}`);
  if (searches) parts.push(`${searches} ${searches === 1 ? "search" : "searches"}`);
  if (lints) parts.push(`${lints} ${lints === 1 ? "check" : "checks"}`);
  return "Explored " + (parts.join(" · ") || "codebase");
}

function ExploringSection({
  tools,
  live,
  onImplement,
  onOpenSubagent,
  approvals,
}: {
  tools: ToolBlock[];
  /** True when this is the trailing group of an in-flight run (keeps the
   *  "Exploring" header up between fast tool completions). */
  live?: boolean;
  onImplement?: (path: string) => void;
  onOpenSubagent?: (callId: string) => void;
  /** Pending approval requests keyed by tool callId (rendered on the tool card). */
  approvals?: Record<string, ApprovalRequestInfo>;
}) {
  const running = tools.some((t) => t.status === "running") || !!live;
  // Expanded while exploring, collapsed into the summary once the group settles.
  const [autoOpen, toggleOpen] = useLiveDisclosure(running);
  // A pending approval inside must be visible — force the section open.
  const hasApproval = !!approvals && tools.some((t) => t.callId && approvals[t.callId]);
  const open = autoOpen || hasApproval;
  const current = [...tools].reverse().find((t) => t.status === "running") ?? tools[tools.length - 1];
  const subtitle = running ? capitalize(toolLabel(current.name)) : exploreSummary(tools);
  // Keep kill-at-zero active even when the group is collapsed (no ToolCard mount).
  const timed = tools.filter((t) => isToolCountdownActive(t) && t.timeoutMs && t.timeoutMs > 0);
  const headTimed = timed[0] ?? (current && isToolCountdownActive(current) ? current : null);

  return (
    <div className={"explore-section" + (open ? " open" : "")}>
      {/* Always watch every timed tool so countdown-0 kills even when collapsed. */}
      {timed.map((t) => (
        <ToolTimeoutWatch key={`watch-${t.callId}`} block={t} />
      ))}
      <button type="button" className="explore-head" onClick={toggleOpen} aria-expanded={open}>
        <span className={"tchev" + (open ? " open" : "")}>
          <Icon name="chevD" size={14} />
        </span>
        <Icon name="search" size={14} className="explore-icon" />
        <span className="explore-title">{running ? "Exploring" : exploreSummary(tools)}</span>
        {headTimed ? <TimeoutBadge block={headTimed} /> : null}
        {running ? <span className="spinner" /> : <span className="explore-count">{tools.length}</span>}
      </button>
      {!open && running && <div className="explore-subtitle">{subtitle}</div>}
      {open && (
        <div className="explore-body">
          {tools.map((t, i) => (
            <div className="block-group" key={t.callId || i}>
              <ToolCard
                block={t}
                onImplement={onImplement}
                onOpenSubagent={onOpenSubagent}
                awaitingApproval={!!(t.callId && approvals?.[t.callId])}
              />
              {t.callId && approvals?.[t.callId] && <ApprovalCard request={approvals[t.callId]} inline />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Memoized: during streaming the whole turn list re-renders on every frame, but
// only the trailing block's text actually changes. Without this, every earlier
// message in the conversation re-parses its markdown on each delta.
const Markdown = React.memo(function Markdown({ text }: { text: string }) {
  return <div className="markdown-content" dir="auto" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
});

// Render <attached /> tags as the SAME pill as the composer editor:
// [kind icon] name — shares .mention CSS and KIND_SVG icons.
function renderMentionHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&amp;/g, "&");
  return text.replace(/<attached\s+([^>]*?)\/?>/g, (_s, attrs: string) => {
    const a: Record<string, string> = {};
    for (const m of attrs.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) a[m[1]] = unesc(m[2]);
    const kind = a.type || "file";
    const name = a.title || a.content || "";
    // data-path lets the post-render pass swap in the IDE's exact file icon.
    const pathAttr = (kind === "file" || kind === "code") && a.content ? ` data-path="${esc(a.content)}"` : "";
    return `<span class="mention" data-kind="${esc(kind)}"${pathAttr} title="${esc(a.content || "")}"><span class="mention-icon">${KIND_SVG[kind] || KIND_SVG.file}</span><span class="mention-label">${esc(name)}</span></span>`;
  });
}

/** Message text with mention pills; swaps generic SVGs for the IDE's exact
 *  file icons after every render (innerHTML is replaced on re-render). */
const MentionText = React.memo(function MentionText({ text }: { text: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    ref.current?.querySelectorAll<HTMLElement>(".mention[data-path] .mention-icon").forEach((icon) => {
      const path = icon.parentElement?.dataset.path;
      if (path) applyFileIconTo(icon, path);
    });
  });
  return (
    <div ref={ref}>
      <Markdown text={renderMentionHtml(text)} />
    </div>
  );
});

/** Run paused at the step limit: Continue button with an "always auto continue" dropdown. */
function MaxStepsCard({ block, running }: { block: import("./types").AssistantBlock & { kind: "max-steps" }; running: boolean }) {
  const [menu, setMenu] = React.useState(false);
  const [resumed, setResumed] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);
  const go = (always?: boolean) => { setMenu(false); setResumed(true); post({ type: "continueRun", always }); };
  return (
    <div className="approval-card inline">
      <div className="ap-head">
        <Icon name="clock" size={14} />
        <span className="ap-title">Paused after {block.steps} steps</span>
      </div>
      {!resumed && !running && (
        <div className="ap-actions">
          <div className="ap-approve-group" ref={menuRef}>
            <button className="ap-btn allow" onClick={() => go()}>Continue</button>
            <button className="ap-btn allow ap-arrow" title="Continue options" onClick={() => setMenu((v) => !v)}>
              <Icon name="chevD" size={11} />
            </button>
            {menu && (
              <div className="ap-menu">
                <button
                  className="ap-menu-item"
                  title="Continue and always auto continue from now on (updates General settings)"
                  onClick={() => go(true)}
                >
                  Always auto continue
                </button>
                <button className="ap-menu-item" onClick={() => post({ type: "openSettings", section: "general" })}>
                  <Icon name="settings" size={12} /> General settings…
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** In-chat marker: earlier conversation auto-summarized to free context. */
function CompactionCard({ block }: { block: import("./types").AssistantBlock & { kind: "compaction" } }) {
  const [open, setOpen] = React.useState(false);
  if (block.status === "running") {
    return (
      <div className="compaction-card running">
        <span className="spinner" /> Summarizing earlier conversation to free context…
      </div>
    );
  }
  if (block.status === "failed") {
    return <div className="compaction-card failed">Context summarization failed — older messages were trimmed instead.</div>;
  }
  return (
    <div className={"compaction-card done" + (open ? " open" : "")}>
      <div className="compaction-head" onClick={() => setOpen((o) => !o)}>
        <Icon name={open ? "chevD" : "chevR"} size={12} />
        <span>Earlier conversation summarized to free context</span>
      </div>
      {open && block.summary && <div className="compaction-body"><Markdown text={block.summary} /></div>}
    </div>
  );
}

function ThinkingCard({ block }: { block: ThinkingBlock }) {
  const live = !block.endedAt;
  const [open, toggleOpen] = useLiveDisclosure(live);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const followLatest = React.useRef(true);
  React.useLayoutEffect(() => {
    if (!open || !live) return;
    followLatest.current = true;
    const body = bodyRef.current;
    if (!body) return;
    const follow = () => { if (followLatest.current) body.scrollTop = body.scrollHeight; };
    follow();
    // Wrapped text and loaded content can change height without a new delta.
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(follow) : undefined;
    observer?.observe(body);
    if (body.firstElementChild) observer?.observe(body.firstElementChild);
    return () => observer?.disconnect();
  }, [open, live]);
  React.useLayoutEffect(() => {
    const body = bodyRef.current;
    if (open && live && followLatest.current && body) body.scrollTop = body.scrollHeight;
  }, [block.text, open, live]);
  const secs = block.endedAt && block.startedAt ? Math.max(1, Math.round((block.endedAt - block.startedAt) / 1000)) : 0;
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const duration = [hours ? `${hours}h` : "", hours || minutes ? `${minutes}m` : "", `${secs % 60}s`].filter(Boolean).join(" ");
  const title = live ? "Thinking" : secs ? `Thought for ${duration}` : "Thought";
  return (
    <div className={"thinking-card" + (open ? " open" : "") + (live ? " live" : "")}>
      <div className="thinking-head" onClick={toggleOpen}>
        <Icon name="brain" size={12} className="thinking-spark" />
        <span className="thinking-title">{title}</span>
        <Icon name={open ? "chevD" : "chevR"} size={12} className="thinking-chev" />
      </div>
      {open && <div className="thinking-body" ref={bodyRef} onScroll={event => {
        const body = event.currentTarget;
        followLatest.current = body.scrollHeight - body.scrollTop - body.clientHeight <= 24;
      }}><Markdown text={block.text} /></div>}
    </div>
  );
}

function ErrorCard({ block }: { block: ErrorBlock }) {
  if (block.retrying) {
    return (
      <div className="error-card retrying">
        <Icon name="brain" size={12} className="error-spark" />
        <span>Request failed, retrying ({block.retrying.attempt}/{block.retrying.max})… </span>
        <span className="error-detail">{block.message}</span>
      </div>
    );
  }
  return (
    <div className="error-card">
      <div className="error-card-head">Request failed</div>
      <div className="error-card-body">{block.message}</div>
    </div>
  );
}

function PersonaSelect({
  personas,
  personaId,
  onSelect,
}: {
  personas: PersonaInfo[];
  personaId: string;
  onSelect: (id: string) => void;
}) {
  if (!personas.length) return null;
  return (
    <div className="persona-select">
      <div className="persona-select-label">Persona</div>
      <Select aria-label="Persona" value={personaId} onChange={event => onSelect(event.target.value)}>
        {personas.map(persona => <option key={persona.id} value={persona.id} title={persona.description}>{persona.name}</option>)}
      </Select>
      <div className="persona-description">{personas.find(persona => persona.id === personaId)?.description}</div>
    </div>
  );
}

/** Approvals whose callId belongs to a tool inside this Task block. */
function approvalsForSubagent(block: ToolBlock, approvals?: Record<string, ApprovalRequestInfo>): ApprovalRequestInfo[] {
  if (!approvals) return [];
  const ids = new Set(
    (block.subBlocks ?? []).filter((b): b is ToolBlock => b.kind === "tool").map((b) => b.callId),
  );
  return Object.values(approvals).filter((r) => r.callId && ids.has(r.callId));
}

/** Map nested tool callId → parent Task callId. */
function parentTaskCallId(turns: Turn[], nestedCallId: string): string | undefined {
  for (const t of turns) {
    if (t.role !== "assistant") continue;
    for (const b of t.blocks) {
      if (b.kind !== "tool" || (b.name !== "Task" && b.name !== "task")) continue;
      for (const sb of b.subBlocks ?? []) {
        if (sb.kind === "tool" && sb.callId === nestedCallId) return b.callId;
      }
    }
  }
  return undefined;
}

const AssistantContent = React.memo(function AssistantContent({ turn, running, phase, onImplement, onOpenSubagent, approvals, taskApprovals }: {
  turn: AssistantTurn; running: boolean; phase?: string;
  onImplement?: (path: string) => void; onOpenSubagent?: (callId: string) => void;
  approvals: Record<string, ApprovalRequestInfo>; taskApprovals: Record<string, ApprovalRequestInfo[]>;
}) {
  const { activity, conclusion } = splitWork(turn, running);
  const forceOpen = turn.blocks.some(block => block.kind === "tool" && (
    !!approvals[block.callId] || !!taskApprovals[block.callId]?.length ||
    block.status === "running" && (block.name === "AskQuestion" || block.name === "ask_question")
  ));
  const render = (blocks: AssistantBlock[], live: boolean) => {
    const items = groupBlocks(blocks);
    return items.map((block, index) => {
      if (block.kind === "explore-group") return <ExploringSection key={index} tools={block.tools}
        live={live && index === items.length - 1} onImplement={onImplement} onOpenSubagent={onOpenSubagent} approvals={approvals} />;
      if (block.kind === "text") return <div className="block-group" key={index}><Markdown text={block.text} /></div>;
      if (block.kind === "thinking") return <ThinkingCard key={index} block={block} />;
      if (block.kind === "error") return <div className="block-group" key={index}><ErrorCard block={block} /></div>;
      if (block.kind === "compaction") return <div className="block-group" key={index}><CompactionCard block={block} /></div>;
      if (block.kind === "max-steps") return <div className="block-group" key={index}><MaxStepsCard block={block} running={running} /></div>;
      if (block.kind === "verification") return <VerificationCard key={index} summary={block.summary} />;
      return <div className="block-group" key={index}>
        <ToolCard block={block} onImplement={onImplement} onOpenSubagent={onOpenSubagent} awaitingApproval={!!taskApprovals[block.callId]?.length} />
        {approvals[block.callId] && <ApprovalCard request={approvals[block.callId]} inline />}
        {taskApprovals[block.callId]?.map(request => <ApprovalCard key={request.requestId} request={request} />)}
      </div>;
    });
  };
  return <WorkingSection running={running} startedAt={turn.startedAt} endedAt={turn.endedAt} durationMs={turn.durationMs}
    hasActivity={activity.length > 0} forceOpen={forceOpen} activity={render(activity, running)}
    conclusion={conclusion.length ? render(conclusion, false) : undefined}
    status={phase ? <div className="phase-row"><ThinkingStatus text={phase} /></div> : undefined} />;
});

function SubagentChat({
  block,
  approvals,
}: {
  block: import("./types").ToolBlock;
  approvals?: Record<string, ApprovalRequestInfo>;
}) {
  const parentRunning = React.useContext(TaskActivityContext);
  const subDone = block.subStatus === "finished" || block.subStatus === "cancelled" || block.subStatus === "error";
  const running = !subDone && (block.status === "running" || !!block.subStatus || (block.subBlocks?.length ?? 0) > 0);
  const sub = block.subBlocks ?? [];
  const taskPrompt = String(block.input?.prompt || "").trim();
  const subType = String(block.input?.subagent_type || "").trim();
  const subName = subType && subType !== "generalPurpose" ? subType : "";
  const [promptOpen, setPromptOpen] = React.useState(false);
  const pinnedApprovals = React.useMemo(() => approvalsForSubagent(block, approvals), [block, approvals]);

  return (
    <div className="subagent-view" data-running={running}>
      <TaskActivityContext.Provider value={parentRunning && running}>
      <div className="msg user subagent-task-msg message-shell">
        <div className="role">
          <Icon name="task" /> Task
          {subName ? <span className="sub-chip sub-type" title={`Subagent: ${subName}`}>{subName}</span> : null}
        </div>
        {taskPrompt ? (
          <div
            className={"subagent-prompt" + (promptOpen ? " open" : " clamp")}
            onClick={() => setPromptOpen((o) => !o)}
            role="button"
            title={promptOpen ? "Click to collapse" : "Click to expand"}
          >
            <Markdown text={taskPrompt} />
          </div>
        ) : (
          <span className="subagent-prompt-empty">(no task prompt)</span>
        )}
        <MessageActions variant="user" text={taskPrompt} />
      </div>
      <div className="msg assistant message-shell">
        <div className="role"><Icon name="bot" /> Subagent</div>
        <div className="bubble">
          {sub.length === 0 ? (
            <div className="sub-empty">{running ? "Starting…" : "No activity"}</div>
          ) : (
            groupBlocks(sub).map((b, bi) =>
              b.kind === "explore-group" ? (
                <ExploringSection key={bi} tools={b.tools} />
              ) : b.kind === "text" ? (
                <div className="block-group" key={bi}><Markdown text={b.text} /></div>
              ) : b.kind === "thinking" ? (
                <ThinkingCard key={bi} block={b} />
              ) : b.kind === "error" ? (
                <div className="block-group" key={bi}><ErrorCard block={b} /></div>
              ) : b.kind === "compaction" ? (
                <div className="block-group" key={bi}><CompactionCard block={b} /></div>
              ) : b.kind === "max-steps" ? (
                <div className="block-group" key={bi}><MaxStepsCard block={b} running={false} /></div>
              ) : b.kind === "verification" ? (
                <VerificationCard key={bi} summary={b.summary} />
              ) : (
                <div className="block-group" key={bi}><ToolCard block={b} /></div>
              )
            )
          )}
          {running && (
            <div className="phase-row"><ThinkingStatus text="Working" /></div>
          )}
          {pinnedApprovals.length > 0 && (
            <div className="subagent-approvals">
              {pinnedApprovals.map((r) => (
                <ApprovalCard key={r.requestId} request={r} />
              ))}
            </div>
          )}
          {!running && block.result && (
            <div className="sub-summary">
              <div className="sub-summary-label">Summary</div>
              <Markdown text={block.result} />
            </div>
          )}
        </div>
        <MessageActions variant="assistant" text={[responseText(sub), !running ? block.result : ""].filter(Boolean).join("\n\n")} />
      </div>
      </TaskActivityContext.Provider>
    </div>
  );
}

interface ChatSession {
  turns: Turn[];
  running: boolean;
  status: { text: string; error?: boolean };
  /** Tokens used in the last request (context consumption). */
  usedTokens?: number;
}
const NO_APPROVALS: ApprovalRequestInfo[] = [];
const NO_TASK_APPROVALS: Record<string, ApprovalRequestInfo[]> = {};
const ACTION_LABEL: Record<ApprovalRequestInfo["actionType"], string> = {
  shell: "Terminal command",
  edits: "File edit",
  delete: "File delete",
  outside: "Outside-workspace access",
  mcp: "MCP tool",
  web: "Web access",
};

/** In-chat approval prompt rendered on the tool/action card. Approve has a
 *  dropdown mirroring the Behavior settings for this action type (options
 *  update the global policy too). The agent stays blocked until resolved. */
function ApprovalCard({ request, inline }: { request: ApprovalRequestInfo; inline?: boolean }) {
  const [menu, setMenu] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);
  const resolve = (msg: Omit<Extract<OutMessage, { type: "resolveApproval" }>, "type" | "requestId">) =>
    post({ type: "resolveApproval", requestId: request.requestId, ...msg });
  const label = ACTION_LABEL[request.actionType].toLowerCase();
  return (
    <div className={"approval-card" + (inline ? " inline" : "")} onClick={(e) => e.stopPropagation()}>
      <div className="ap-head">
        <Icon name="tools" size={14} />
        <span className="ap-title">{ACTION_LABEL[request.actionType]} needs approval</span>
        <span className="ap-tool">{request.toolName}</span>
      </div>
      {!inline && <div className="ap-detail"><code>{request.detail}</code></div>}
      <div className="ap-actions">
        <div className="ap-approve-group" ref={menuRef}>
          <button className="ap-btn allow" onClick={() => resolve({ approve: true })}>Approve</button>
          <button className="ap-btn allow ap-arrow" title="Approve options (these also update Behavior settings)" onClick={() => setMenu((v) => !v)}>
            <Icon name="chevD" size={11} />
          </button>
          {menu && (
            <div className="ap-menu">
              {request.suggestion && (
                <button
                  className="ap-menu-item"
                  title={`Approve and add "${request.suggestion}" to the ${label} allow list`}
                  onClick={() => resolve({ approve: true, pattern: request.suggestion, addPattern: "allow" })}
                >
                  Always allow <code>{request.suggestion}</code>
                </button>
              )}
              <button
                className="ap-menu-item"
                title={`Approve and only ask for risky-looking ${label}s from now on`}
                onClick={() => resolve({ approve: true, setMode: "review" })}
              >
                Auto review {label}s
              </button>
              <button
                className="ap-menu-item"
                title={`Approve and run every ${label} without asking from now on`}
                onClick={() => resolve({ approve: true, setMode: "allow" })}
              >
                Run everything ({label}s)
              </button>
              {request.suggestion && (
                <button
                  className="ap-menu-item danger"
                  title={`Reject and add "${request.suggestion}" to the deny list`}
                  onClick={() => resolve({ approve: false, pattern: request.suggestion, addPattern: "deny" })}
                >
                  Always deny <code>{request.suggestion}</code>
                </button>
              )}
              <button className="ap-menu-item" onClick={() => post({ type: "openSettings", section: "behavior" })}>
                <Icon name="settings" size={12} /> Behavior settings…
              </button>
            </div>
          )}
        </div>
        <button className="ap-btn deny" onClick={() => resolve({ approve: false })}>Reject</button>
      </div>
    </div>
  );
}

/** Short two-tone chime via WebAudio (no asset files needed). */
function playCompletionSound() {
  try {
    const ctx = new AudioContext();
    const play = (freq: number, at: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      o.type = "sine";
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.25);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + 0.3);
    };
    play(660, 0);
    play(880, 0.12);
    setTimeout(() => ctx.close(), 800);
  } catch { /* audio unavailable */ }
}

export function App() {
  const [mode, setMode] = React.useState<Mode>("agent");
  const [models, setModels] = React.useState<string[]>([]);
  const [modelList, setModelList] = React.useState<ModelDef[]>([]);
  const [selectedModel, setSelectedModel] = React.useState("");
  const [conversations, setConversations] = React.useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = React.useState<string | undefined>(undefined);
  const [workspaceRoot, setWorkspaceRoot] = React.useState<string>();
  const [approvalPolicy, setApprovalPolicy] = React.useState<ApprovalPolicy>();
  const [openTabs, setOpenTabs] = React.useState<string[]>([]); // IDs of tabs visible in tab bar
  const workspaceReady = React.useRef(false);
  const [goals, setGoals] = React.useState<Record<string, ConversationGoal>>({});
  const [workflowDialog, setWorkflowDialog] = React.useState<"goal" | "review" | "steer" | null>(null);
  const [historyResults, setHistoryResults] = React.useState<{ requestId: number; list: ConversationSummary[] }>();
  // Per-tab composer drafts. Key "" = brand-new chat (no backend id yet).
  const draftsRef = React.useRef<Map<string, ComposerDraft>>(new Map());
  const [, setDraftTick] = React.useReducer((n: number) => n + 1, 0);
  const hasDraft = (id: string) => {
    const d = draftsRef.current.get(id);
    return !!(d && (d.text.trim() || d.attachments.length));
  };
  // Shared-draft key: one composer draft follows the user across tabs unless
  // the Per-Tab Composer Drafts setting is on.
  const SHARED_DRAFT = "\u0000shared";
  const setTabDraft = React.useCallback((id: string, d: ComposerDraft) => {
    const empty = !d.text.trim() && d.attachments.length === 0;
    if (empty) draftsRef.current.delete(id);
    else draftsRef.current.set(id, d);
    if (workspaceReady.current) post({ type: "updateChatWorkspace", state: { drafts: Object.fromEntries(draftsRef.current) } });
    // Keep a New Chat tab pinned while its composer has content.
    if (id === "") {
      setOpenTabs((t) => {
        if (!empty && !t.includes("")) return [...t, ""];
        if (empty && t.includes("") && activeIdRef.current) return t.filter((x) => x !== "");
        return t;
      });
      setDraftTick();
    }
  }, []);
  React.useEffect(() => {
    if (workspaceReady.current) post({ type: "updateChatWorkspace", state: { openTabs } });
  }, [openTabs]);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const moreRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [moreOpen]);
  const [personas, setPersonas] = React.useState<PersonaInfo[]>([]);
  const [personaId, setPersonaId] = React.useState("default");
  const [hasProviders, setHasProviders] = React.useState(true);
  const [teams, setTeams] = React.useState<TeamInfo[]>([]);
  const [activeTeamIds, setActiveTeamIds] = React.useState<string[]>([]);
  const [uiPrefs, setUiPrefs] = React.useState<{ chatTextSize: string; submitWithCtrlEnter: boolean; maxTabCount: number; completionSound: boolean; perTabDrafts: boolean; motion?: MotionPreference }>({ chatTextSize: "default", submitWithCtrlEnter: false, maxTabCount: 0, completionSound: false, perTabDrafts: false, motion: "full" });
  React.useEffect(() => { setMotionPreference(uiPrefs.motion); }, [uiPrefs.motion]);
  const uiPrefsRef = React.useRef(uiPrefs);
  React.useEffect(() => { uiPrefsRef.current = uiPrefs; }, [uiPrefs]);
  const draftKey = uiPrefs.perTabDrafts ? (activeId ?? "") : SHARED_DRAFT;
  const [pendingChanges, setPendingChanges] = React.useState<PendingChangeInfo[]>([]);
  // Pending in-chat approval requests, keyed by conversation id.
  const [approvals, setApprovals] = React.useState<Record<string, ApprovalRequestInfo[]>>({});
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const reviewDetailsId = React.useId();
  const changeTotals = pendingChanges.reduce((total, change) => ({
    added: total.added + (change.added ?? 0), removed: total.removed + (change.removed ?? 0),
  }), { added: 0, removed: 0 });
  // Editing an earlier user message: index of that turn. The edit composer
  // shares the global model/mode selection (one selection for all composers).
  const [editingIndex, setEditingIndex] = React.useState<number | null>(null);
  const [imagePreview, setImagePreview] = React.useState<{ images: Attachment[]; activeId: string } | null>(null);
  React.useEffect(() => { setImagePreview(null); }, [activeId]);
  // Pending edit awaiting the revert-confirm dialog. `restore` = return the
  // message to the bottom composer instead of resending it.
  const [revertPrompt, setRevertPrompt] = React.useState<{ index: number; text: string; attachments: Attachment[]; restore?: boolean } | null>(null);
  // Message restored into the bottom composer (as if not yet sent).
  const [draft, setDraft] = React.useState<{ text: string; attachments?: Attachment[] } | null>(null);
  // callId of the subagent currently opened as its own tab (null = parent chat).
  const [subTab, setSubTab] = React.useState<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  // Single source of truth: one independent session per conversation id. The
  // visible chat just renders the active session. Avoids any snapshot races.
  const sessionsRef = React.useRef<Map<string, ChatSession>>(new Map());
  const [, force] = React.useReducer((n) => n + 1, 0);
  // Mirror of activeId readable inside the stable message handler.
  const activeIdRef = React.useRef<string | undefined>(undefined);
  React.useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  // Enforce Max Tab Count (0 = unlimited): drop oldest non-active tabs when over.
  React.useEffect(() => {
    const max = uiPrefs.maxTabCount;
    if (!max || max < 1 || openTabs.length <= max) return;
    setOpenTabs((tabs) => {
      const keep = [...tabs];
      while (keep.length > max) {
        // Prefer dropping real chats over a New Chat tab that still has typed text.
        const idx = keep.findIndex((id) => id !== activeIdRef.current && !(id === "" && hasDraft("")));
        if (idx === -1) break;
        keep.splice(idx, 1);
      }
      return keep;
    });
  }, [openTabs, uiPrefs.maxTabCount]);

  // Scroll the active tab into view when it changes (new/opened from history).
  const tabBarRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    tabBarRef.current?.querySelector(".tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, openTabs]);

  // Brand-new (id-less) chats use the "" key until the backend assigns an id.
  const sessionFor = (id: string | undefined): ChatSession => {
    const key = id ?? "";
    let s = sessionsRef.current.get(key);
    if (!s) { s = { turns: [], running: false, status: { text: "" } }; sessionsRef.current.set(key, s); }
    return s;
  };
  const active = sessionFor(activeId);
  const turns = active.turns;
  const isRunning = active.running;
  const status = active.status;
  // The host supplies a fresh transcript whenever a conversation is selected.
  // Keep only the visible chat and live background runs instead of retaining
  // every transcript (including attachments and tool output) ever opened.
  React.useEffect(() => {
    for (const [id, session] of sessionsRef.current) {
      if (id !== (activeId ?? "") && !session.running) sessionsRef.current.delete(id);
    }
  });
  // Whether the view is pinned to the bottom. Starts true; flips off ONLY on an
  // explicit user gesture scrolling up (wheel/touch/scrollbar drag), back on
  // when the user returns to the bottom (gesture or the jump button). Mirrored
  // in state so the "scroll to bottom" button can render.
  const stickRef = React.useRef(true);
  const [following, setFollowing] = React.useState(true);
  const setStick = React.useCallback((v: boolean) => {
    stickRef.current = v;
    setFollowing(v);
  }, []);
  // When the user sends a message, pin that new user bubble to the top of the
  // viewport (fresh-chat feel) instead of the default stick-to-bottom.
  const pinTopRef = React.useRef(false);
  // True while we're performing a programmatic scroll, so onScroll ignores the
  // resulting events (otherwise stick-state flip-flops → back-and-forth jank).
  const selfScrollRef = React.useRef(false);
  // Detects conversation switches so we can reset to the bottom on switch.
  const prevActiveIdRef = React.useRef<string | undefined>(activeId);
  // Host-owned durable queue. UI snapshots never trigger execution.
  const queueRef = React.useRef<Map<string, (QueuedMessage & { steering?: boolean; optimisticSteering?: boolean })[]>>(new Map());
  const pendingSteeringRef = React.useRef(new Map<string, Map<string, QueuedMessage>>());
  // The last group gets a min-height = viewport so it can be pinned to the top
  // without any real spacer element (purely visual "virtual" space that grows no
  // extra scrollable height beyond one viewport). Set imperatively so it tracks
  // the scroll area size. Never applied to the first group (already at top).
  const lastGroupRef = React.useRef<HTMLDivElement>(null);

  // Give the last group a min-height of one viewport so its user message can be
  // scrolled to the top ("virtual space") without adding real extra scroll beyond
  // one screen. Not applied to a lone first group (it already sits at the top).
  const sizeSpacer = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Clear stale virtual space from groups that are no longer last.
    el.querySelectorAll<HTMLElement>(".chat-turn-group").forEach((g) => {
      if (g !== lastGroupRef.current && g.style.minHeight) g.style.minHeight = "";
    });
    const group = lastGroupRef.current;
    if (!group) return;
    // Grow the last group so the max scroll position lands exactly with the
    // group's top at the viewport top — no more (no overscroll under the sticky
    // header) and no less. `trailing` = space after the group (container bottom
    // padding) and is invariant to the group's own height, so this is stable.
    const gTop = group.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
    const trailing = el.scrollHeight - gTop - group.offsetHeight;
    const minH = Math.max(0, Math.round(el.clientHeight - trailing));
    const target = `${minH}px`;
    if (group.style.minHeight !== target) group.style.minHeight = target;
  }, []);

  React.useEffect(() => {
    window.addEventListener("resize", sizeSpacer);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(sizeSpacer);
    if (scrollRef.current) observer?.observe(scrollRef.current);
    return () => { window.removeEventListener("resize", sizeSpacer); observer?.disconnect(); };
  }, [sizeSpacer]);

  // Stick-to-bottom may ONLY be re-armed by an explicit user gesture that lands
  // at the bottom (wheel down / touch / scrollbar drag). Scroll *events* alone
  // are never trusted: after a send the pinned-to-top position IS the scroll
  // bottom (the spacer sizes it that way), and layout shifts (tool cards
  // collapsing, scrollTop clamping when content shrinks, trailing smooth-scroll
  // frames) fire bottom-position scroll events that used to flip follow mode
  // back on and drag the pinned message up as the run streamed.
  const draggingRef = React.useRef(false);
  // Whether the user scrolled at all since the last send (any gesture). Gates
  // the end-of-run "reveal": we only auto-scroll to the tail if they never moved.
  const userScrolledRef = React.useRef(false);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight < 8;
    // Evaluate after the browser applies the gesture's scroll (next frame).
    const evalStick = () => requestAnimationFrame(() => { setStick(atBottom()); });
    const onWheel = (e: WheelEvent) => {
      userScrolledRef.current = true;
      if (e.deltaY < 0) setStick(false); // scrolling up always unsticks
      else evalStick(); // scrolling down re-arms only if it lands at the bottom
    };
    const onDown = () => { draggingRef.current = true; }; // possible scrollbar drag
    const onUp = () => { draggingRef.current = false; };
    const onTouch = () => { userScrolledRef.current = true; evalStick(); };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.target instanceof Element)) return;
      if (event.target.closest('input, textarea, select, [contenteditable="true"], [role="combobox"]')) return;
      if (event.key === " " && event.target.closest('button, [role="button"], summary')) return;
      if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) return;
      userScrolledRef.current = true;
      if (["ArrowUp", "PageUp", "Home"].includes(event.key) || event.key === " " && event.shiftKey) setStick(false);
      else evalStick();
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchmove", onTouch, { passive: true });
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("keydown", onKey);
    window.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchmove", onTouch);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerup", onUp);
    };
  }, [setStick]);

  const onScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Ignore scroll events we triggered ourselves (prevents feedback loops that
    // make the stick-to-bottom state flip-flop → visible back-and-forth jank).
    if (selfScrollRef.current) return;
    // Scroll events alone never change follow state — layout shifts during
    // streaming (cards collapsing, clamping) fire them constantly. Only a
    // scrollbar drag (pointer held) is treated as user-driven here; wheel and
    // touch are handled by their own listeners above.
    if (!draggingRef.current) return;
    userScrolledRef.current = true;
    setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 8);
  }, [setStick]);

  // Jump-to-bottom button: scroll to the end and re-arm follow mode.
  const scrollToBottom = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setStick(true);
    selfScrollRef.current = true;
    el.scrollTo({ top: el.scrollHeight - el.clientHeight, behavior: "smooth" });
    window.setTimeout(() => { selfScrollRef.current = false; }, 450);
  }, [setStick]);

  // Returning to the main chat (close subagent tab / Back button): snap to bottom.
  // The chat list is remounted, so wait for layout (rAF) before measuring height.
  const prevSubTabRef = React.useRef<string | null>(subTab);
  React.useEffect(() => {
    const wasOpen = prevSubTabRef.current;
    prevSubTabRef.current = subTab;
    if (subTab || !wasOpen) return; // only fire on close (had a subTab, now null)
    setStick(true);
    userScrolledRef.current = false;
    pinTopRef.current = false;
    const snap = () => {
      const el = scrollRef.current;
      if (!el) return;
      selfScrollRef.current = true;
      el.scrollTop = el.scrollHeight;
      window.setTimeout(() => { selfScrollRef.current = false; }, 60);
    };
    // Two frames: after remount paints and after spacer sizing settles.
    requestAnimationFrame(() => { snap(); requestAnimationFrame(snap); });
  }, [subTab, setStick]);

  // Keep the view anchored as content changes: pin a freshly sent message to the
  // top once, otherwise follow the bottom only while the user is already there.
  // Runs after every render (streaming deltas); all scrolls are instant/idempotent
  // so re-running is cheap and never fights itself.
  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Switching conversations: cancel any pending pin and land at the bottom.
    if (prevActiveIdRef.current !== activeId) {
      prevActiveIdRef.current = activeId;
      pinTopRef.current = false;
      userScrolledRef.current = false;
      setStick(true);
      // Synchronous snap in the layout effect = the first painted frame is
      // already at the end (no visible travel from the top).
      selfScrollRef.current = true;
      sizeSpacer();
      el.scrollTop = el.scrollHeight;
      selfScrollRef.current = false;
      // A long transcript keeps growing after this pass (markdown, code blocks,
      // tool cards laying out), so re-snap for a few frames until it settles.
      // ponytail: frame-count heuristic; swap for a ResizeObserver if it drifts.
      let n = 12;
      const snap = () => {
        const c = scrollRef.current;
        if (!c || !stickRef.current) return;
        selfScrollRef.current = true;
        c.scrollTop = c.scrollHeight;
        selfScrollRef.current = false;
        if (n-- > 0) requestAnimationFrame(snap);
      };
      requestAnimationFrame(snap);
    }
    sizeSpacer();
    if (pinTopRef.current) {
      pinTopRef.current = false;
      // Autoscroll stays ON by default after a send: the pinned-to-top position
      // IS the scroll bottom (the spacer sizes it that way), so follow mode and
      // the pin agree. Only a manual scroll-up turns follow off.
      setStick(true);
      userScrolledRef.current = false;
      const last = el.querySelector<HTMLElement>(".chat-turn-group:last-child");
      if (last) {
        const top = el.scrollTop + (last.getBoundingClientRect().top - el.getBoundingClientRect().top);
        selfScrollRef.current = true;
        el.scrollTo({ top, behavior: "smooth" });
        // Release the self-scroll guard after the smooth animation settles.
        window.setTimeout(() => { selfScrollRef.current = false; }, 450);
      }
      return;
    }
    if (stickRef.current) {
      selfScrollRef.current = true;
      el.scrollTop = el.scrollHeight; // instant; no-op when already at the bottom
      requestAnimationFrame(() => { selfScrollRef.current = false; });
    }
  });


  // Auto-scroll already handled below; persistence happens on settle per session.

  // Throttled per-conversation persistence of live turns (max ~1/sec each) so the
  // host store stays close to the on-screen state during a run.
  const persistTimers = React.useRef(new Map<string, number>());
  const schedulePersist = (id: string, s: ChatSession) => {
    if (!id || persistTimers.current.has(id)) return;
    // While a run is live the HOST owns turns and persists them itself; it drops
    // webview snapshots for such conversations. Sending them anyway would
    // structured-clone the whole transcript (tool results included) across the
    // bridge every 800ms just to be discarded.
    if (s.running) return;
    const t = window.setTimeout(() => {
      persistTimers.current.delete(id);
      post({ type: "persistTurns", convId: id, turns: s.turns });
    }, 800);
    persistTimers.current.set(id, t);
  };

  // Reconcile each session's `running` flag with the host's authoritative set of
  // in-flight runs (after a webview reload the agent may still be working).
  const markRunning = (ids?: string[]) => {
    if (!ids) return;
    const set = new Set(ids);
    for (const [id, s] of sessionsRef.current) {
      if (!id) continue;
      const live = set.has(id);
      if (live && !s.running) {
        s.running = true;
        s.turns = applyEvent(s.turns, { type: "run-status", status: "running" });
        if (!s.status.text) s.status = { text: "Thinking" };
      } else if (!live && s.running) {
        // Host no longer has this run (stop, crash, IDE reopen) — clear Working.
        s.running = false;
        s.status = { text: "" };
        s.turns = forceSettleOpenWork(closeTrailingThinking(s.turns), "cancelled");
      }
    }
  };

  // Seed a session's turns from persisted data without clobbering a live run.
  const seedSession = (id: string | undefined, persisted: Turn[], usedTokens?: number, running = false) => {
    if (!id) return;
    // Stale "running" tools left on disk after IDE close → settle them.
    const restored = restoreTurns(persisted, running);
    const clean = running ? applyEvent(restored, { type: "run-status", status: "running" }) : restored;
    const s = sessionsRef.current.get(id);
    if (!s) {
      sessionsRef.current.set(id, { turns: clean, running, status: { text: running ? "Working" : "" }, usedTokens });
    } else {
      // The host owns live snapshots as well as persisted history.
      s.running = running;
      s.turns = clean;
      if (usedTokens !== undefined) s.usedTokens = usedTokens;
    }
  };

  React.useEffect(() => {
    // rAF-batch stream-driven re-renders so tool/args/text deltas don't thrash React.
    let raf = 0;
    const scheduleForce = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        force();
      });
    };
    const handler = (event: MessageEvent<InMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case "initialState":
          setWorkspaceRoot(msg.workspaceRoot);
          setApprovalPolicy(msg.approvalPolicy);
          setMode(msg.mode);
          setSelectedModel(msg.selectedModel || "");
          seedSession(msg.activeId, msg.turns || [], msg.usedTokens, msg.runningConvIds?.includes(msg.activeId ?? "") ?? false);
          markRunning(msg.runningConvIds);
          setActiveId(msg.activeId);
          setPersonas(msg.personas || []);
          setPersonaId(msg.activePersonaId || "default");
          setHasProviders(!!msg.hasProviders);
          if (msg.teams) setTeams(msg.teams);
          if (msg.activeTeamIds) setActiveTeamIds(msg.activeTeamIds);
          if (msg.uiPrefs) setUiPrefs(msg.uiPrefs);
          if (msg.workspaceState) {
            draftsRef.current = new Map(Object.entries(msg.workspaceState.drafts));
            setOpenTabs([...new Set([...msg.workspaceState.openTabs, ...msg.activeId ? [msg.activeId] : []])]);
            setDraftTick();
          } else if (msg.activeId) setOpenTabs((t) => t.includes(msg.activeId!) ? t : [...t, msg.activeId!]);
          workspaceReady.current = true;
          force();
          break;
        case "workflowState": {
          const next = new Map<string, (QueuedMessage & { steering?: boolean; optimisticSteering?: boolean })[]>();
          const ids = new Set([...Object.keys(msg.queues), ...Object.keys(msg.steeringQueues ?? {}), ...pendingSteeringRef.current.keys()]);
          for (const id of ids) {
            const rows = [...msg.queues[id] ?? []] as (QueuedMessage & { steering?: boolean; optimisticSteering?: boolean })[];
            const previous = queueRef.current.get(id) ?? [];
            const mailbox = msg.steeringQueues?.[id] ?? [];
            const waiting = new Map((pendingSteeringRef.current.get(id) ?? new Map()).entries());
            for (const item of mailbox) waiting.set(item.id, item);
            for (const item of waiting.values()) {
              if (rows.some(row => row.id === item.id)) continue;
              const index = previous.findIndex(row => row.id === item.id);
              rows.splice(index < 0 ? rows.length : Math.min(index, rows.length), 0, {
                ...item, steering: mailbox.some(entry => entry.id === item.id),
                optimisticSteering: !mailbox.some(entry => entry.id === item.id),
              });
            }
            next.set(id, rows);
          }
          queueRef.current = next;
          setGoals(msg.goals);
          force();
          break;
        }
        case "queueSteeringResult":
          pendingSteeringRef.current.get(msg.convId)?.delete(msg.requestId);
          if (!msg.accepted) queueRef.current.set(msg.convId, (queueRef.current.get(msg.convId) ?? [])
            .filter(item => item.id !== msg.requestId || !item.optimisticSteering));
          force();
          break;
        case "conversationSearchResults":
          setHistoryResults({ requestId: msg.requestId, list: msg.list });
          break;
        case "requestAccepted":
          if (msg.created) {
            const pending = sessionsRef.current.get("");
            if (pending) { sessionsRef.current.set(msg.convId, pending); sessionsRef.current.delete(""); }
            activeIdRef.current = msg.convId;
            setActiveId(msg.convId);
            setOpenTabs((tabs) => [...new Set([...tabs.filter((id) => id !== ""), msg.convId])]);
          }
          break;
        case "steeringAccepted":
          sessionFor(msg.convId).status = { text: "Update will apply at the next agent step" };
          force();
          break;
        case "queueDraft": {
          const key = uiPrefsRef.current.perTabDrafts ? msg.convId : SHARED_DRAFT;
          draftsRef.current.set(key, msg.draft);
          if (activeIdRef.current === msg.convId) setDraft(msg.draft);
          setDraftTick();
          break;
        }
        case "modelSelected":
          setSelectedModel(msg.model || ""); // auto hidden for now
          break;
        case "configState":
          if (msg.approvalPolicy) setApprovalPolicy(msg.approvalPolicy);
          setPersonas(msg.personas || []);
          setHasProviders(!!msg.hasProviders);
          if (msg.teams) setTeams(msg.teams);
          if (msg.activeTeamIds) setActiveTeamIds(msg.activeTeamIds);
          if (msg.uiPrefs) setUiPrefs(msg.uiPrefs);
          // Only follow the global default persona for brand-new (empty) chats.
          if (sessionFor(activeIdRef.current).turns.length === 0) setPersonaId(msg.activePersonaId || "default");
          break;
        case "modelsFetched":
          setModels(msg.models || []);
          if (msg.modelList) setModelList(msg.modelList);
          break;
        case "pendingChanges":
          setPendingChanges(msg.changes || []);
          break;
        case "conversations":
          setConversations(msg.list || []);
          { const ids = new Set((msg.list || []).map((c: ConversationSummary) => c.id));
            setOpenTabs((t) => t.filter((id) => id === "" || ids.has(id)));
            // Keep the "" pending session (brand-new chat awaiting its id).
            for (const k of [...sessionsRef.current.keys()]) if (k !== "" && !ids.has(k)) sessionsRef.current.delete(k);
          }
          if (msg.activeId) setOpenTabs((t) => t.includes(msg.activeId!) ? t : [...t, msg.activeId!]);
          markRunning(msg.runningConvIds);
          break;
        case "loadConversation":
          setWorkspaceRoot(msg.workspaceRoot);
          if (!msg.activeId) sessionsRef.current.set("", { turns: [], running: false, status: { text: "" } });
          else seedSession(msg.activeId, msg.turns || [], msg.usedTokens, msg.running === true);
          setActiveId(msg.activeId);
          setHistoryOpen(false);
          if (msg.personaId) setPersonaId(msg.personaId);
          setOpenTabs((t) => {
            let next = t;
            if (msg.activeId && !next.includes(msg.activeId)) next = [...next, msg.activeId];
            // Brand-new chat (no id yet): show a New Chat tab.
            if (!msg.activeId && !next.includes("")) next = [...next, ""];
            // Drop empty New Chat tab when leaving it for a real conversation (draft keeps it).
            if (msg.activeId && next.includes("") && !hasDraft("")) next = next.filter((id) => id !== "");
            return next;
          });
          force();
          break;
        case "runStarted": {
          // First message in a brand-new chat: migrate the pending (id-less) session.
          if (msg.created) {
            const pending = sessionsRef.current.get("") ;
            if (pending) { sessionsRef.current.set(msg.convId, pending); sessionsRef.current.delete(""); }
            const queued = queueRef.current.get("");
            if (queued) { queueRef.current.set(msg.convId, queued); queueRef.current.delete(""); }
            const d = draftsRef.current.get("");
            if (d) { draftsRef.current.set(msg.convId, d); draftsRef.current.delete(""); }
            if (!activeIdRef.current) {
              activeIdRef.current = msg.convId;
              setActiveId(msg.convId);
            }
            setOpenTabs((t) => {
              const next = t.filter((id) => id !== "");
              return next.includes(msg.convId) ? next : [...next, msg.convId];
            });
          }
          const s = sessionFor(msg.convId);
          if (msg.turns) s.turns = msg.turns;
          s.running = true;
          s.turns = applyEvent(s.turns, { type: "run-status", status: "running" });
          s.status = { text: "Thinking" };
          force();
          break;
        }
        case "error": {
          const s = sessionFor(msg.convId ?? activeIdRef.current);
          s.running = false;
          s.turns = applyEvent(s.turns, { type: "run-status", status: "error" });
          s.status = { text: "Error: " + msg.message, error: true };
          force();
          break;
        }
        case "questionAnswered": {
          const s = sessionFor(msg.convId);
          s.turns = setQuestionAnswers(s.turns, msg.callId, msg.answers);
          force();
          break;
        }
        case "approvalRequest":
          setApprovals((a) => {
            const list = a[msg.convId] || [];
            if (list.some((r) => r.requestId === msg.request.requestId)) return a;
            return { ...a, [msg.convId]: [...list, msg.request] };
          });
          break;
        case "approvalResolved":
          setApprovals((a) => ({ ...a, [msg.convId]: (a[msg.convId] || []).filter((r) => r.requestId !== msg.requestId) }));
          break;
        case "agentEvent": {
          const ev = msg.event;
          const s = sessionFor(msg.convId);
          const settled = ev.type === "run-status" && (ev.status === "finished" || ev.status === "cancelled" || ev.status === "error");
          if (ev.type === "run-status") {
            s.turns = applyEvent(s.turns, ev);
            s.status = { text: ev.status === "running" ? "Planning next moves" : ev.status === "finished" ? "" : ev.status };
            if (settled) {
              const wasRunning = s.running;
              s.running = false;
              if (wasRunning && ev.status === "finished" && uiPrefsRef.current.completionSound) playCompletionSound();
              // Close open thinking + cancel any still-spinning tools/subagents.
              s.turns = forceSettleOpenWork(
                closeTrailingThinking(s.turns),
                ev.status === "error" ? "error" : "cancelled",
              );
              post({ type: "persistTurns", convId: msg.convId, turns: s.turns });
            }
          } else {
            s.turns = applyEvent(s.turns, ev);
            if (ev.type === "user-steering" && ev.requestId) {
              pendingSteeringRef.current.get(msg.convId)?.delete(ev.requestId);
              queueRef.current.set(msg.convId, (queueRef.current.get(msg.convId) ?? []).filter(item => item.id !== ev.requestId));
            }
            // Throttle-persist live turns so a pane move / remount (which destroys
            // the webview without a reliable pagehide) restores the in-flight chat.
            schedulePersist(msg.convId, s);
            if (ev.type === "thinking-delta") s.status = { text: "Thinking" };
            else if (ev.type === "text-delta") s.status = { text: "Generating" };
            else if (ev.type === "tool-call-started") s.status = { text: capitalize(toolLabel(ev.name)) };
            else if (ev.type === "tool-call-args") {/* keep current tool label while args stream */}
            else if (ev.type === "tool-call-completed") s.status = { text: "Planning next moves" };
            else if (ev.type === "retry") s.status = { text: `Retrying (${ev.attempt}/${ev.max})…` };
            else if (ev.type === "usage" && (!ev.source || ev.source === "parent")) s.usedTokens = ev.totalTokens;
            else if (ev.type === "compaction") s.status = { text: ev.status === "running" ? "Summarizing conversation" : "Planning next moves" };
            else if (ev.type === "shell-notify") s.status = { text: ev.message };
            else if (ev.type === "error") {
              // Keep the rendered error block; persist so the chat survives reloads.
              s.status = { text: "Error: " + ev.message, error: true };
              post({ type: "persistTurns", convId: msg.convId, turns: s.turns });
            }             else if (ev.type === "mode-changed") {
              setMode(ev.mode);
              post({ type: "setMode", mode: ev.mode });
            }
          }
          // Background runs update their session without rerendering the visible
          // transcript on every token. Settling still updates the tab indicator.
          if (msg.convId !== activeIdRef.current && !settled) break;
          // Immediate paint on settle / tool complete; coalesce stream deltas.
          if (
            settled ||
            ev.type === "tool-call-completed" ||
            ev.type === "tool-call-started" ||
            ev.type === "user-steering" ||
            ev.type === "error" ||
            ev.type === "run-result"
          ) {
            force();
          } else {
            scheduleForce();
          }
          break;
        }
      }
    };
    window.addEventListener("message", handler);
    // Last-chance flush: if the webview is torn down (window close / extension
    // reload) mid-run, persist every session's current turns so reopening shows
    // the live state instead of a stale/blank chat.
    const flush = () => {
      for (const [id, s] of sessionsRef.current) {
        if (id && s.turns.length) post({ type: "persistTurns", convId: id, turns: s.turns });
      }
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    post({ type: "ready" });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      flush();
      for (const timer of persistTimers.current.values()) window.clearTimeout(timer);
      persistTimers.current.clear();
      window.removeEventListener("message", handler);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
    };
  }, []);

  const sendNow = React.useCallback((convId: string | undefined, text: string, attachments?: Attachment[], model?: string, mode2?: Mode) => {
    const s = sessionFor(convId);
    if (!s.running && !(queueRef.current.get(convId ?? "") ?? []).some(item => item.status !== "running")) {
      s.turns = [...s.turns, { role: "user", text, attachments, model, mode: mode2 }];
      s.running = true;
      s.turns = applyEvent(s.turns, { type: "run-status", status: "running" });
    }
    pinTopRef.current = true;
    force();
    post({ ...sendMessageIntent(convId, text, attachments, model, mode2), requestId: crypto.randomUUID() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = (text: string, attachments: Attachment[]) => {
    sendNow(activeIdRef.current, text, attachments.length ? attachments : undefined, selectedModel, mode);
  };

  // Queue item actions.
  const queued = (queueRef.current.get(activeId ?? "") ?? []).filter((item) => item.status !== "running");
  const isQueuedSteering = (item: typeof queued[number]) => !!item.steering || !!pendingSteeringRef.current.get(activeId ?? "")?.has(item.id);
  const removeQueued = (i: number) => {
    const item = queued[i];
    if (activeId && item && !isQueuedSteering(item)) post({ type: "queueAction", convId: activeId, id: item.id, action: "remove" });
  };
  const editQueued = (i: number) => {
    const item = queued[i];
    if (activeId && item && !isQueuedSteering(item)) post({ type: "queueAction", convId: activeId, id: item.id, action: "edit" });
  };
  const runQueuedNow = (i: number) => {
    const item = queued[i];
    if (activeId && item && !isQueuedSteering(item)) post({ type: "queueAction", convId: activeId, id: item.id, action: "run" });
  };
  const steerQueued = (item: QueuedMessage) => {
    if (activeId && isRunning && item.status === "queued" && item.text.trim() && !item.attachments?.length) {
      const pending = pendingSteeringRef.current.get(activeId) ?? new Map<string, QueuedMessage>();
      if (pending.has(item.id) || queueRef.current.get(activeId)?.find(row => row.id === item.id)?.steering) return;
      pending.set(item.id, item);
      pendingSteeringRef.current.set(activeId, pending);
      force();
      post({ type: "queueAction", convId: activeId, id: item.id, action: "steer" });
    }
  };

  // Clicking outside the inline edit composer cancels the edit.
  React.useEffect(() => {
    if (editingIndex === null) return;
    const h = (e: MouseEvent) => {
      // Portaled dropdowns (model picker / mode menu) live in document.body.
      if (!(e.target as HTMLElement).closest(".msg.user.editing, .modal-overlay, .model-picker, .mode-dropdown")) setEditingIndex(null);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [editingIndex]);

  const startEdit = (index: number, _turn: UserTurn) => {
    if (isRunning) return;
    setEditingIndex(index);
  };

  // Resend an edited earlier message. If there are file changes below it, ask the
  // user whether to revert them first; otherwise resend straight away.
  const requestEditSubmit = (index: number, text: string, attachments: Attachment[]) => {
    if (isRunning) return;
    if (pendingChanges.length > 0) {
      setRevertPrompt({ index, text, attachments });
    } else {
      commitEdit(index, text, attachments, false);
    }
  };

  // Revert to a message: drop it + everything after, put its text back into the
  // bottom composer as an unsent draft.
  const requestRevert = (index: number, turn: UserTurn) => {
    if (isRunning) return;
    if (pendingChanges.length > 0) {
      setRevertPrompt({ index, text: turn.text, attachments: turn.attachments ?? [], restore: true });
    } else {
      restoreMessage(index, turn.text, turn.attachments ?? [], false);
    }
  };

  const restoreMessage = (index: number, text: string, attachments: Attachment[], revertFiles: boolean) => {
    const s = sessionFor(activeIdRef.current);
    if (s.running) return;
    s.turns = s.turns.slice(0, index);
    setDraft({ text, attachments: attachments.length ? attachments : undefined });
    setRevertPrompt(null);
    setEditingIndex(null);
    force();
    post({ type: "revertToMessage", index, revertFiles });
  };

  const commitEdit = (index: number, text: string, attachments: Attachment[], revertFiles: boolean) => {
    const s = sessionFor(activeIdRef.current);
    if (s.running) return;
    // Drop this turn and everything after it, then append the edited message.
    s.turns = [...s.turns.slice(0, index), { role: "user", text, attachments: attachments.length ? attachments : undefined, model: selectedModel, mode }];
    s.running = true;
    s.turns = applyEvent(s.turns, { type: "run-status", status: "running" });
    s.status = { text: "Starting" };
    setEditingIndex(null);
    setRevertPrompt(null);
    pinTopRef.current = true;
    force();
    post({ type: "sendMessage", convId: activeIdRef.current ?? null, text, attachments: attachments.length ? attachments : undefined, fromIndex: index, model: selectedModel, mode, revertFiles });
  };

  const retryResponse = (index: number) => {
    for (let preceding = index - 1; preceding >= 0; preceding--) {
      const turn = turns[preceding];
      if (turn.role === "user") {
        requestEditSubmit(preceding, turn.text, turn.attachments ?? []);
        return;
      }
    }
  };

  // Switch to agent mode and kick off implementation of a written plan.
  // Stable identity so memoized tool cards aren't invalidated every frame.
  const onImplement = React.useCallback((planPath: string) => {
    setMode("agent");
    post({ type: "setMode", mode: "agent" });
    const text = planPath
      ? `Implement the plan in \`${planPath}\`. Read it first, then execute every step. Keep going until it is fully done.`
      : "Implement the plan you just wrote. Execute every step until it is fully done.";
    const s = sessionFor(activeIdRef.current);
    s.turns = [...s.turns, { role: "user", text }];
    pinTopRef.current = true;
    force();
    post(sendMessageIntent(activeIdRef.current, text, undefined, undefined, "agent"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onOpenSubagent = React.useCallback((id: string) => setSubTab(id), []);

  // Locate the subagent (task) ToolBlock for the open sub-tab.
  const findSub = (callId: string): import("./types").ToolBlock | undefined => {
    for (const t of turns) {
      if (t.role !== "assistant") continue;
      for (const b of t.blocks) {
        if (b.kind === "tool" && b.callId === callId) return b;
      }
    }
    return undefined;
  };
  const subBlock = subTab ? findSub(subTab) : undefined;
  // Pending approvals for the active conversation, keyed by tool callId so
  // the prompt renders directly on its tool card. Requests without a callId
  // (e.g. beforeSubmit) fall back to the bottom stack.
  const activeApprovals = approvals[activeId ?? ""] || NO_APPROVALS;
  const approvalsByCall = React.useMemo(() => {
    const m: Record<string, ApprovalRequestInfo> = {};
    for (const r of activeApprovals) if (r.callId) m[r.callId] = r;
    return m;
  }, [activeApprovals]);
  // Nested tool approvals → parent Task callId (shown on the subagent card).
  const approvalsByTask = React.useMemo(() => {
    if (!activeApprovals.length) return NO_TASK_APPROVALS;
    const m: Record<string, ApprovalRequestInfo[]> = {};
    for (const r of activeApprovals) {
      if (!r.callId) continue;
      const parent = parentTaskCallId(turns, r.callId);
      if (!parent) continue;
      (m[parent] ??= []).push(r);
    }
    return m;
  }, [activeApprovals, turns]);
  const orphanApprovals = activeApprovals.filter((r) => !r.callId);
  // If the sub-tab's block vanished (new conversation loaded), drop back to parent.
  React.useEffect(() => {
    if (subTab && !subBlock) setSubTab(null);
  }, [subTab, subBlock]);

  const closeTab = (id: string) => {
    if (uiPrefsRef.current.perTabDrafts) draftsRef.current.delete(id);
    setOpenTabs((tabs) => {
      const next = tabs.filter((t) => t !== id);
      // If we closed the active tab, switch to another or start fresh
      const wasActive = id === activeId || (id === "" && !activeId);
      if (wasActive) {
        const idx = tabs.indexOf(id);
        const fallback = next[Math.min(idx, next.length - 1)];
        if (fallback !== undefined) {
          if (fallback === "") post({ type: "newConversation" });
          else post({ type: "selectConversation", id: fallback });
        } else {
          // No tabs left → new conversation
          post({ type: "newConversation" });
        }
      }
      return next;
    });
  };

  return (
    <div className={"app" + (uiPrefs.chatTextSize !== "default" ? ` text-${uiPrefs.chatTextSize}` : "")}>
      <div className="chat-header">
        <div
          className="tab-bar"
          ref={tabBarRef}
          onWheel={(e) => {
            if (e.deltaY === 0) return;
            e.currentTarget.scrollLeft += e.deltaY;
          }}
        >
          {openTabs.map((tabId) => {
            const c = tabId ? conversations.find((x) => x.id === tabId) : undefined;
            const title = c ? c.title : "New Chat";
            const isActive = tabId === "" ? !activeId && !subTab : tabId === activeId && !subTab;
            return (
              <div
                key={tabId || "new"}
                className={"tab" + (isActive ? " active" : "")}
                onClick={() => {
                  if (subTab) setSubTab(null);
                  if (tabId === "") {
                    if (activeId) post({ type: "newConversation" });
                  } else if (tabId !== activeId) {
                    post({ type: "selectConversation", id: tabId });
                  }
                }}
                onMouseDown={(e) => {
                  // middle-click closes tab (not delete)
                  if (e.button === 1) {
                    e.preventDefault();
                    closeTab(tabId);
                  }
                }}
              >
                {tabId !== activeId && sessionsRef.current.get(tabId)?.running && <span className="status-spinner tab-spin" />}
                <span className="tab-title">{title}</span>
                <span
                  className="tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tabId);
                  }}
                >
                  <Icon name="close" size={12} />
                </span>
              </div>
            );
          })}
          {/* Fallback New Chat tab when nothing is open and no draft tab exists */}
          {openTabs.length === 0 && !activeId && (
            <div className={"tab" + (!subTab ? " active" : "")}>
              <span className="tab-title">New Chat</span>
            </div>
          )}
          {/* Virtual tab for an opened subagent run. */}
          {subBlock && (
            <div className="tab subagent-tab active" title="Subagent">
              <span className="tab-icon"><Icon name="task" size={12} /></span>
              <span className="tab-title">{subBlock.input?.description || "Subagent"}</span>
              <span className="tab-close" onClick={(e) => { e.stopPropagation(); setSubTab(null); }}>
                <Icon name="close" size={12} />
              </span>
            </div>
          )}
        </div>
        <div className="actions">
          <button className="hicon" title="New Chat" onClick={() => post({ type: "newConversation" })}>
            <Icon name="plus" size={14} />
          </button>
          <button className="hicon" title="History" onClick={() => setHistoryOpen(true)}>
            <Icon name="history" size={14} />
          </button>
          <button className="hicon" title="Settings" onClick={() => post({ type: "openSettings" })}>
            <Icon name="settings" size={14} />
          </button>
          <div className="more-menu-wrap" ref={moreRef}>
            <button className="hicon" title="More" onClick={() => setMoreOpen((v) => !v)}>
              <Icon name="more" size={14} />
            </button>
            {moreOpen && (
              <div className="more-menu">
                <button title="Create an isolated checkout from committed HEAD. Uncommitted changes stay in this checkout." onClick={() => { setMoreOpen(false); post({ type: "createWorktreeConversation" }); }}><Icon name="gitBranch" size={13} /> New worktree chat</button>
                <button onClick={() => { setMoreOpen(false); setWorkflowDialog("review"); }}><Icon name="code" size={13} /> Review code</button>
                <button disabled={!!activeId && !!goals[activeId] && goals[activeId].status !== "complete"} onClick={() => { setMoreOpen(false); setWorkflowDialog("goal"); }}><Icon name="list" size={13} /> Start a goal</button>
                <button disabled={!isRunning || !activeId} onClick={() => { setMoreOpen(false); setWorkflowDialog("steer"); }}><Icon name="edit" size={13} /> Update active task</button>
                <button disabled={!activeId || isRunning} onClick={() => { setMoreOpen(false); if (activeId) post({ type: "forkConversation", id: activeId }); }}><Icon name="plus" size={13} /> Fork conversation</button>
                <button disabled={!activeId || isRunning} onClick={() => { setMoreOpen(false); if (activeId) post({ type: "archiveConversation", id: activeId, archived: true }); }}><Icon name="history" size={13} /> Archive conversation</button>
                <button onClick={() => { setMoreOpen(false); post({ type: "openBrowserTab" }); }}>
                  <Icon name="globe" size={13} /> Open Browser Tab
                </button>
                <button
                  disabled={!activeId}
                  onClick={() => { setMoreOpen(false); post({ type: "exportConversation", convId: activeId }); }}
                >
                  <Icon name="download" size={13} /> Export Conversation
                </button>
                <button
                  disabled={openTabs.length === 0}
                  onClick={() => { setMoreOpen(false); draftsRef.current.clear(); post({ type: "updateChatWorkspace", state: { drafts: {} } }); setOpenTabs([]); post({ type: "newConversation" }); }}
                >
                  <Icon name="close" size={13} /> Close All Tabs
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {historyOpen && (
        <History
          list={conversations}
          activeId={activeId}
          onSelect={(id) => post({ type: "selectConversation", id })}
          onDelete={(id) => post({ type: "deleteConversation", id })}
          onArchive={(id, archived) => post({ type: "archiveConversation", id, archived })}
          onFork={(id) => post({ type: "forkConversation", id })}
          onSearch={(query, archived, requestId) => post({ type: "searchConversations", query, archived, requestId })}
          results={historyResults}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      {activeId && goals[activeId] && <GoalBanner goal={goals[activeId]} onStatus={(status) => post({ type: "setGoalStatus", convId: activeId, status })} />}
      {workspaceRoot && <div className="worktree-banner" title={workspaceRoot}><Icon name="gitBranch" size={12} /><span>Isolated worktree · {workspaceRoot.split(/[\\/]/).pop()}</span><button className="btn-ghost" onClick={() => post({ type: "openMention", kind: "folder", path: workspaceRoot })}>Show folder</button></div>}
      {workflowDialog && <WorkflowDialog kind={workflowDialog} onClose={() => setWorkflowDialog(null)}
        onGoal={(objective, tokenBudget) => post({ type: "setGoal", convId: activeId, objective, tokenBudget })}
        onReview={(target) => post({ type: "startReview", target })}
        onSteer={(text) => { if (activeId) post({ type: "steerMessage", convId: activeId, text }); }} />}

      <div className={"chat-messages" + (!subBlock && hasProviders && turns.length === 0 ? " is-empty" : "")} data-running={isRunning} ref={scrollRef} onScroll={onScroll} tabIndex={0} role="region" aria-label="Conversation">
        <TaskActivityContext.Provider value={isRunning}>
        {subBlock ? (
          <SubagentChat block={subBlock} approvals={approvalsByCall} />
        ) : !hasProviders ? (
          <div className="setup-screen">
            <img className="app-logo" src={document.getElementById("root")?.dataset.icon} alt="OpenCursor" />
            <StaggerReveal>
              <h1 className="setup-title t-stagger-line">Build with OpenCursor</h1>
              <div className="setup-desc t-stagger-line t-stagger-line--2">Connect your account, add an API key, or run a local model to start building.</div>
            </StaggerReveal>
            <button className="setup-btn" onClick={() => post({ type: "openSettings", section: "providers" })}>
              Get started <Icon name="chevR" size={14} />
            </button>
          </div>
        ) : turns.length === 0 ? (
          <div className="chat-empty">
            <img className="app-logo" src={document.getElementById("root")?.dataset.icon} alt="OpenCursor" />
            <StaggerReveal>
              <h1 className="empty-title t-stagger-line">Let’s build something</h1>
              <div className="empty-hint t-stagger-line t-stagger-line--2">Turn an idea into code.</div>
            </StaggerReveal>
            <div className="empty-actions">
              {([
                { icon: "code", label: "Explore code", text: "Give me an overview of this codebase and explain how the main parts fit together." },
                { icon: "tools", label: "Find a bug", text: "Look through this codebase for a bug and explain how to fix it." },
                { icon: "list", label: "Make a plan", text: "Help me plan a change to this project. First, ask me what I want to build." },
              ] as const).map((suggestion) => (
                <button className="empty-action" key={suggestion.label} onClick={() => setDraft({ text: suggestion.text })}>
                  <Icon name={suggestion.icon} size={14} /> {suggestion.label}
                </button>
              ))}
            </div>
            <PersonaSelect
              personas={personas}
              personaId={personaId}
              onSelect={(p) => {
                setPersonaId(p);
                post({ type: "setPersona", personaId: p });
              }}
            />
          </div>
        ) : (
          // Keep each user message and its assistant response in one scroll group.
          groupTurns(turns).map((group, gi, all) => (
            // Pin-to-top space only on the last group when it isn't the first one.
            <div className="chat-turn-group" key={gi} ref={gi === all.length - 1 && all.length > 1 ? lastGroupRef : undefined}>
              {group.map(({ turn, index }) =>
                turn.role === "user" ? (
                  editingIndex === index ? (
                    <div className="msg user editing" key={index}>
                      <Composer
                        editing
                        initialText={turn.text}
                        initialAttachments={turn.attachments}
                        focusKey={`edit-${index}`}
                        mode={mode}
                        onMode={(m) => {
                          setMode(m);
                          post({ type: "setMode", mode: m });
                        }}
                        teams={teams}
                        activeTeamIds={activeTeamIds}
                        onTeams={(ids) => {
                          setActiveTeamIds(ids);
                          post({ type: "setActiveTeams", teamIds: ids });
                        }}
                        models={models}
                        modelList={modelList}
                        selectedModel={selectedModel}
                        onSelectModel={(m) => {
                          setSelectedModel(m);
                          post({ type: "selectModel", model: m });
                        }}
                        onSaveModelOptions={(modelId, options) => {
                          setModelList((prev) => prev.map((m) => (m.id === modelId ? { ...m, options } : m)));
                          post({ type: "saveModelOptions", modelId, options });
                        }}
                        onResetModelOptions={(modelId) => post({ type: "resetModelOptions", modelId })}
                        isRunning={isRunning}
                        onSubmit={(text, attachments) => requestEditSubmit(index, text, attachments)}
                        onCancel={() => setEditingIndex(null)}
                        onCancelEdit={() => setEditingIndex(null)}
                        submitWithCtrlEnter={uiPrefs.submitWithCtrlEnter}
                      />
                    </div>
                  ) : (
                    <div className="msg user message-shell" key={index} data-turn-index={index}>
                      <div
                        className="bubble"
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                            event.preventDefault(); event.currentTarget.click();
                          }
                        }}
                        onClick={() => startEdit(index, turn)}
                        aria-disabled={isRunning || undefined}
                        title={isRunning ? "User message" : "Click to edit & resend"}
                        ref={(el) => { if (el) el.classList.toggle("clamped", el.scrollHeight > el.clientHeight + 1); }}
                      >
                        {turn.attachments && turn.attachments.length > 0 && (
                          <div className="msg-attachments">
                            {turn.attachments.map((a) =>
                              a.kind === "image" ? (
                                <button key={a.id} type="button" className="image-attachment-trigger"
                                  aria-label={`Preview image ${a.name}`} aria-haspopup="dialog" title={a.name}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setImagePreview({ images: turn.attachments!.filter(attachment => attachment.kind === "image"), activeId: a.id });
                                  }}>
                                  <img className="msg-attach-img" src={a.data} alt="" />
                                </button>
                              ) : (
                                <span key={a.id} className="msg-attach-file">
                                  <Icon name="file" /> {a.name}
                                </span>
                              )
                            )}
                          </div>
                        )}
                        {turn.text && <MentionText text={turn.text} />}
                      </div>
                      <MessageActions variant="user" text={turn.text} disabled={isRunning}
                        onEdit={() => startEdit(index, turn)}
                        onRetry={() => requestEditSubmit(index, turn.text, turn.attachments ?? [])}
                        onRevert={() => requestRevert(index, turn)} />
                    </div>
                  )
                ) : (
                  <div className="msg assistant message-shell" key={index} data-turn-index={index}>
                    <div className="role">
                      <Icon name="bot" /> Agent
                    </div>
                    <div className="bubble">
                      <AssistantContent turn={turn} running={isRunning && (turn === turns[turns.length - 1] || hasLiveWork(turn.blocks))}
                        phase={isRunning && turn === turns[turns.length - 1] && !status.error ? status.text : undefined}
                        onImplement={onImplement} onOpenSubagent={onOpenSubagent} approvals={approvalsByCall} taskApprovals={approvalsByTask} />
                    </div>
                    <MessageActions variant="assistant" text={responseText(turn.blocks)} disabled={isRunning}
                      onRetry={group[0].turn.role === "user" ? () => retryResponse(index) : undefined} />
                  </div>
                )
              )}

            </div>
          ))
        )}
        </TaskActivityContext.Provider>
      </div>

      <div className="bottom-stack" style={hasProviders && !subBlock ? undefined : { display: "none" }}>
        {!following && turns.length > 0 && (
          <button className="scroll-bottom-btn" title="Scroll to bottom" onClick={scrollToBottom}>
            <Icon name="chevD" size={14} />
          </button>
        )}
        {orphanApprovals.map((r) => (
          <ApprovalCard key={r.requestId} request={r} />
        ))}
        {status.error && (
          <div className="status" style={{ padding: "0 14px" }}>
            <span className="error">{status.text}</span>
          </div>
        )}
        {(pendingChanges.length > 0 || queued.length > 0) && <div className="composer-tray">
        {pendingChanges.length > 0 && (
          <div className="review-bar">
            <div className="review-head" onClick={() => setReviewOpen((open) => !open)}>
              <div className="review-title" role="button" tabIndex={0} aria-label="Changed files"
                aria-expanded={reviewOpen} aria-controls={reviewDetailsId} onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setReviewOpen((open) => !open);
                  }
                }}>
                <TextSwap text={`${pendingChanges.length} file${pendingChanges.length === 1 ? "" : "s"} changed`} />
                <span className="rv-stats">
                  {changeTotals.added > 0 && <span className="rv-add" aria-label={`${changeTotals.added} lines added`}><TextSwap text={`+${changeTotals.added}`} /></span>}
                  {changeTotals.removed > 0 && <span className="rv-del" aria-label={`${changeTotals.removed} lines removed`}><TextSwap text={`-${changeTotals.removed}`} /></span>}
                </span>
              </div>
              <div className="review-actions">
                <button className="rv-link" onClick={(event) => { event.stopPropagation(); post({ type: "rejectAllChanges" }); }}>Undo All</button>
                <button className="rv-link" onClick={(event) => { event.stopPropagation(); post({ type: "acceptAllChanges" }); }}>Keep All</button>
              </div>
            </div>
            <AnimatedDisclosure open={reviewOpen}>
            <div className="review-details" id={reviewDetailsId}>
            <div className="review-list">
              {pendingChanges.map((c) => {
                const name = c.path.split(/[\\/]/).pop() || c.path;
                return (
                  <div className="review-item" key={c.path}>
                    <button className="rv-file" title={c.path} aria-label={`Review changes to ${c.path}`} onClick={() => post({ type: "diffChange", path: c.path })}>
                      <Icon name="file" size={13} />
                      <span className="rv-name">{name}</span>
                      {!c.existedBefore && <span className="rv-tag">new</span>}
                      <span className="rv-stats">
                        {(c.added ?? 0) > 0 && <span className="rv-add">+{c.added}</span>}
                        {(c.removed ?? 0) > 0 && <span className="rv-del">-{c.removed}</span>}
                      </span>
                    </button>
                    <span className="rv-item-actions">
                      <button className="rv-icon reject" title="Undo" onClick={() => post({ type: "rejectChange", path: c.path })}>
                        <Icon name="close" size={13} />
                      </button>
                      <button className="rv-icon accept" title="Keep" onClick={() => post({ type: "acceptChange", path: c.path })}>
                        <Icon name="check" size={13} />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
            </div>
            </AnimatedDisclosure>
          </div>
        )}
        {queued.length > 0 && (
          <div className="queue-bar">
            {queued.map((q, i) => (
              <QueuedMessageRow key={q.id} item={q} running={isRunning} canMoveUp={queued.slice(0, i).some(item => !isQueuedSteering(item))}
                steering={isQueuedSteering(q)}
                onSteer={() => steerQueued(q)} onRun={() => runQueuedNow(i)}
                onEdit={() => editQueued(i)} onRemove={() => removeQueued(i)}
                onMoveUp={() => activeId && post({ type: "queueAction", convId: activeId, id: q.id, action: "up" })} />
            ))}
          </div>
        )}
        </div>}
        <Composer
          focusKey={activeId ?? "new"}
          approvalPolicy={approvalPolicy}
          persona={turns.length ? personas.find(persona => persona.id === personaId) : undefined}
          mode={mode}
          onMode={(m) => {
            setMode(m);
            post({ type: "setMode", mode: m });
          }}
          teams={teams}
          activeTeamIds={activeTeamIds}
          onTeams={(ids) => {
            setActiveTeamIds(ids);
            post({ type: "setActiveTeams", teamIds: ids });
          }}
          models={models}
          modelList={modelList}
          selectedModel={selectedModel}
          onSelectModel={(m) => {
            setSelectedModel(m);
            post({ type: "selectModel", model: m });
          }}
          onSaveModelOptions={(modelId, options) => {
            setModelList((prev) => prev.map((m) => (m.id === modelId ? { ...m, options } : m)));
            post({ type: "saveModelOptions", modelId, options });
          }}
          onResetModelOptions={(modelId) => post({ type: "resetModelOptions", modelId })}
          isRunning={isRunning}
          isFirst={turns.length === 0}
          usedTokens={active.usedTokens}
          queuedCount={queued.filter(item => !isQueuedSteering(item)).length}
          onRunNextQueued={() => runQueuedNow(queued.findIndex(item => !isQueuedSteering(item)))}
          draft={draft}
          tabDraft={draftsRef.current.get(draftKey) ?? null}
          onTabDraft={(d) => setTabDraft(draftKey, d)}
          onSubmit={(text, attachments) => {
            setDraft(null);
            draftsRef.current.delete(draftKey);
            post({ type: "updateChatWorkspace", state: { drafts: Object.fromEntries(draftsRef.current) } });
            onSubmit(text, attachments);
          }}
          onCancel={() => post({ type: "cancelRun", convId: activeId })}
          submitWithCtrlEnter={uiPrefs.submitWithCtrlEnter}
        />
      </div>

      <ImagePreview images={imagePreview?.images ?? []} activeId={imagePreview?.activeId ?? null} onClose={() => setImagePreview(null)} />
      {revertPrompt && (
        <div className="modal-overlay" onClick={() => setRevertPrompt(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Revert file changes?</div>
            <div className="modal-body">
              Resending from an earlier message will remove the messages after it. You have {pendingChanges.length} pending file change{pendingChanges.length > 1 ? "s" : ""} — revert them too?
            </div>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setRevertPrompt(null)}>Cancel</button>
              <button className="btn-ghost" disabled={isRunning} onClick={() => (revertPrompt.restore ? restoreMessage : commitEdit)(revertPrompt.index, revertPrompt.text, revertPrompt.attachments, false)}>Don't revert</button>
              <button className="btn-primary" disabled={isRunning} onClick={() => (revertPrompt.restore ? restoreMessage : commitEdit)(revertPrompt.index, revertPrompt.text, revertPrompt.attachments, true)}>Revert</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
