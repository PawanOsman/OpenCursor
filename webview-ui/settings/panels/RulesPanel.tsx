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
import { vscode } from "../../shared/vscode";
import { RuleInfo, SkillInfo } from "../features";

export function RulesPanel({
  rules,
  skills,
}: {
  rules: RuleInfo[];
  skills: SkillInfo[];
}) {
  return (
    <>
      <h1 className="page-title" style={{ marginBottom: 4 }}>Rules &amp; Skills</h1>
      <p className="panel-hint" style={{ marginBottom: 24 }}>Provide domain-specific knowledge and workflows for the agent</p>

      <div className="rss-section-head">
        <span className="rss-title">Rules <span className="rss-help" title="Rules live in .cursor/rules/*.md and AGENTS.md. Always-apply rules are injected every turn.">?</span></span>
        <button className="btn-ghost sm" onClick={() => vscode.postMessage({ type: "createRule" })}>
          <Icon name="plus" size={12} /> New
        </button>
      </div>
      <p className="panel-hint">Use Rules to guide agent behavior, like enforcing best practices or coding standards. Rules can be applied always, by file path, or manually.</p>
      {rules.length === 0 ? (
        <div className="rss-empty">
          <div className="rss-empty-title">No Rules Yet</div>
          <div className="rss-empty-sub">Create rules to guide agent behavior</div>
          <button className="btn-secondary" onClick={() => vscode.postMessage({ type: "createRule" })}>New Rule</button>
        </div>
      ) : (
        <div className="rss-list">
          {rules.map((r) => (
            <div
              className="rss-row"
              key={r.file}
              title={r.path ? "Open " + r.file : undefined}
              onClick={() => r.path && vscode.postMessage({ type: "openWorkspaceFile", path: r.path })}
            >
              <div className="lr-text">
                <div className="lr-title">{r.description || r.file}</div>
                {r.description && <div className="lr-desc">{r.file}{r.globs ? ` · ${r.globs}` : ""}</div>}
              </div>
              <span className={"badge-tag " + (r.alwaysApply ? "always" : "glob")}>{r.alwaysApply ? "always" : r.globs ? "glob" : "manual"}</span>
              {r.path && (
                <button
                  className="icon-btn rss-del"
                  title="Delete rule"
                  onClick={(e) => { e.stopPropagation(); vscode.postMessage({ type: "deleteRule", path: r.path, name: r.file }); }}
                >
                  <Icon name="trash" size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="rss-section-head" style={{ marginTop: 28 }}>
        <span className="rss-title">Skills <span className="rss-help" title="Workspace, user and installed plugin skills provide SKILL.md instructions. The agent reads them when a task matches.">?</span></span>
        <button className="btn-ghost sm" onClick={() => vscode.postMessage({ type: "createSkill" })}>
          <Icon name="plus" size={12} /> New
        </button>
      </div>
      <p className="panel-hint">Skills are specialized capabilities that help the agent accomplish specific tasks. Skills will be invoked by the agent when relevant.</p>
      <div className="rss-section-head"><button className="btn-secondary" onClick={() => vscode.postMessage({ type: "managePlugins" })}>Manage plugins</button><button className="btn-ghost sm" onClick={() => vscode.postMessage({ type: "browserSettings" })}>Browser settings</button></div>
      <p className="panel-hint">Install, update or remove local skill and MCP packages.</p>
      {skills.length === 0 ? (
        <div className="rss-empty">
          <div className="rss-empty-title">No Skills Yet</div>
          <div className="rss-empty-sub">Create skills for specialized capabilities</div>
          <button className="btn-secondary" onClick={() => vscode.postMessage({ type: "createSkill" })}>New Skill</button>
        </div>
      ) : (
        <div className="rss-list">
          {skills.map((s) => (
            <div
              className="rss-row"
              key={s.path}
              title={"Open " + s.name}
              onClick={() => vscode.postMessage({ type: "openWorkspaceFile", path: s.path })}
            >
              <div className="lr-text">
                <div className="lr-title">{s.name}</div>
                <div className="lr-desc rss-clamp">{s.description}</div>
              </div>
              {!s.pluginId && <button
                className="icon-btn rss-del"
                title="Delete skill"
                onClick={(e) => { e.stopPropagation(); vscode.postMessage({ type: "deleteSkill", path: s.path, name: s.name }); }}
              >
                <Icon name="trash" size={13} />
              </button>}
            </div>
          ))}
        </div>
      )}

    </>
  );
}
