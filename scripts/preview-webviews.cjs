/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// Local visual preview of the production webview bundles with a mock VS Code
// bridge. No providers, credentials, files, or external services are used.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.OPENCURSOR_PREVIEW_PORT || 4173);

function mockHost() {
  const params = new URLSearchParams(location.search);
  const state = params.get('state') || 'welcome';
  const populated = ['conversation', 'workflow', 'activity'].includes(state);
  const models = [
    { id: 'preview-model', name: 'Example model', kind: 'openai', providerName: 'Preview provider', options: [{ key: 'reasoning_effort', label: 'Reasoning effort', type: 'select', value: 'medium', values: ['low', 'medium', 'high'] }] },
    { id: 'local-model', name: 'Local model', kind: 'ollama', options: [] },
  ];
  const turns = [
    { role: 'user', text: 'Add a search field to the project list and keep it accessible.' },
    { role: 'assistant', blocks: [
      { kind: 'text', text: 'I’ll check the project list and its existing controls, then add a search field that works with the keyboard.' },
      { kind: 'tool', name: 'Read', callId: 'read-1', status: 'completed', input: { path: 'src/components/ProjectList.tsx' }, output: 'Read 84 lines from src/components/ProjectList.tsx' },
      { kind: 'tool', name: 'Shell', callId: 'shell-1', status: 'completed', input: { command: 'pnpm test' }, output: 'Tests: 12 passed, 12 total\nTime: 1.42s' },
      { kind: 'text', text: 'Added search to the project list. Results update as you type, and the field has an accessible label.\n\n```tsx\n<input\n  aria-label="Search projects"\n  placeholder="Search projects…"\n  value={query}\n  onChange={(e) => setQuery(e.target.value)}\n/>\n```\n\nAll **12 tests** pass.' },
    ] },
  ];
  if (state === 'activity') turns.splice(0, turns.length,
    { role: 'user', text: 'create a proxy script supports all OpenAI API endpoints' },
    { role: 'assistant', blocks: [
      { kind: 'text', text: "I'll check the workspace first, then create the proxy." },
      { kind: 'tool', name: 'ListDir', callId: 'list-1', status: 'completed', input: { path: '.' }, result: 'package.json\nproxy.js' },
      { kind: 'tool', name: 'Read', callId: 'read-package', status: 'completed', input: { path: 'package.json' }, startLine: 1, endLine: 14 },
      { kind: 'tool', name: 'Read', callId: 'read-proxy', status: 'completed', input: { path: 'proxy.js' }, startLine: 1, endLine: 200 },
      { kind: 'text', text: 'A proxy already exists here. Let me see the rest and the path allowlist config.' },
    ] });
  if (state === 'workflow') turns[1].blocks.push({ kind: 'verification', summary: { status: 'checks-passed', revision: 1, changedPaths: ['src/components/ProjectList.tsx'], checks: [{ command: 'pnpm test', status: 'passed', exitCode: 0, revision: 1, at: Date.now() }] } });
  let conversations = [
    { id: 'preview', title: state === 'activity' ? 'Create an API proxy' : 'Add project search', updatedAt: Date.now() },
    { id: 'earlier', title: 'Explain the authentication flow', updatedAt: Date.now() - 86400000 },
    { id: 'older', title: 'Refactor the settings page', updatedAt: Date.now() - 86400000 * 3 },
  ];
  let saved;
  const send = (data) => window.dispatchEvent(new MessageEvent('message', { data }));
  const list = () => send({ type: 'conversations', list: conversations });
  window.acquireVsCodeApi = () => ({
    getState: () => saved,
    setState: (value) => { saved = value; },
    postMessage: (message) => {
      setTimeout(() => {
        switch (message.type) {
          case 'ready':
            send({ type: 'initialState', activeId: populated ? 'preview' : undefined, mode: 'agent', selectedModel: 'preview-model', turns: populated ? turns : [], personas: [], activePersonaId: 'default', hasProviders: state !== 'setup', runningConvIds: [], workspaceRoot: state === 'workflow' ? 'C:/Projects/worktrees/project-search' : undefined, workspaceState: { openTabs: populated ? ['preview'] : [], drafts: {} } });
            send({ type: 'modelsFetched', models: models.map((m) => m.id), modelList: models });
            list();
            if (populated && state !== 'activity') send({ type: 'pendingChanges', changes: [{ path: 'src/components/ProjectList.tsx', existedBefore: true, added: 18, removed: 3 }] });
            if (state === 'workflow') send({ type: 'workflowState', queues: { preview: [{ id: 'recovery', text: 'Confirm the migration completed before retrying any operation.', status: 'interrupted', createdAt: Date.now() }, { id: 'next', text: 'Add keyboard navigation tests.', status: 'queued', createdAt: Date.now() }] }, goals: { preview: { objective: 'Make project search accessible and reliable', status: 'paused', tokenBudget: 50000, tokensUsed: 12340, updatedAt: Date.now() } } });
            // Optional visual fixture states exercise the real controls.
            setTimeout(() => {
              const selectors = { history: '[title="History"]', model: '.model-select', mode: '.mode-pill', draft: '.empty-action' };
              if (selectors[state]) document.querySelector(selectors[state])?.click();
            }, 100);
            break;
          case 'newConversation': send({ type: 'loadConversation', turns: [] }); break;
          case 'selectConversation': send({ type: 'loadConversation', activeId: message.id, turns }); break;
          case 'deleteConversation': conversations = conversations.filter((c) => c.id !== message.id); list(); break;
          case 'searchConversations': send({ type: 'conversationSearchResults', query: message.query, archived: message.archived, list: conversations.filter((c) => !message.query || c.title.toLowerCase().includes(message.query.toLowerCase())) }); break;
          case 'selectModel': send({ type: 'modelSelected', model: message.model }); break;
          case 'sendMessage': send({ type: 'loadConversation', activeId: 'preview', turns: [{ role: 'user', text: message.text }, { role: 'assistant', blocks: [{ kind: 'text', text: 'This is a local design preview. Your message stays in this browser.' }] }] }); break;
          case 'getFileIcon': send({ type: 'fileIcon', filename: message.filename }); break;
          case 'getSettings':
            send({ type: 'loadSettings', settings: { model: 'preview-model', enableWorkspaceContext: true, enableFileReading: true, enableTerminalSuggestions: true } });
            if (params.get('section')) send({ type: 'navigate', section: params.get('section') });
            break;
          case 'getFeatures': send({ type: 'features', features: {} }); break;
          case 'fetchAllModels': send({ type: 'modelsFetched', models: models.map((m) => m.id), modelList: models }); break;
          case 'openSettings': location.href = '/settings' + location.search; break;
          case 'acceptAllChanges': case 'rejectAllChanges': send({ type: 'pendingChanges', changes: [] }); break;
        }
      }, 20);
    },
  });
}

const themes = {
  dark: { 'editor-background': '#181818', foreground: '#e6e6e6', descriptionForeground: '#a0a0a0', 'sideBar-background': '#202020', 'input-background': '#252525', 'menu-background': '#252525', 'dropdown-background': '#252525', 'list-hoverBackground': '#ffffff0d', 'textCodeBlock-background': '#222222', 'textLink-foreground': '#85b7eb', focusBorder: '#818181', 'charts-green': '#73bd83', errorForeground: '#f48771', 'editor-selectionBackground': '#ffffff26', 'scrollbarSlider-background': '#ffffff22' },
  light: { 'editor-background': '#ffffff', foreground: '#242424', descriptionForeground: '#737373', 'sideBar-background': '#f8f8f8', 'input-background': '#f7f7f7', 'menu-background': '#ffffff', 'dropdown-background': '#ffffff', 'list-hoverBackground': '#00000008', 'textCodeBlock-background': '#f5f5f5', 'textLink-foreground': '#2667b1', focusBorder: '#777777', 'charts-green': '#238636', errorForeground: '#c72e38', 'editor-selectionBackground': '#0000001c', 'scrollbarSlider-background': '#00000022' },
};

http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const assets = { '/sidebar.js': 'dist/webview/sidebar.js', '/sidebar.css': 'dist/webview/sidebar.css', '/settings.js': 'dist/webview/settings.js', '/settings.css': 'dist/webview/settings.css', '/icon.png': 'media/icon.png' };
  const asset = assets[url.pathname];
  if (asset) {
    res.setHeader('Content-Type', asset.endsWith('.css') ? 'text/css' : asset.endsWith('.js') ? 'text/javascript' : 'image/png');
    fs.createReadStream(path.join(root, asset)).on('error', () => { res.statusCode = 404; res.end('Run pnpm compile first.'); }).pipe(res);
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/') {
    const view = url.searchParams.get('view') === 'settings' ? 'settings' : 'sidebar';
    const width = Math.max(240, Math.min(1400, Number(url.searchParams.get('width')) || (view === 'settings' ? 1000 : 380)));
    const frame = new URLSearchParams(url.searchParams);
    res.end(`<!doctype html><html><head><title>OpenCursor design preview</title><style>body{margin:0;background:#303030;color:#ddd;font:12px system-ui}nav{padding:14px 20px;display:flex;gap:18px;align-items:center}a{color:inherit;text-decoration:none}a:hover{text-decoration:underline}iframe{display:block;width:min(${width}px,100%);height:calc(100vh - 48px);border:0;margin:auto;box-shadow:0 0 0 1px #ffffff15}</style></head><body><nav><strong>OpenCursor · UI preview</strong><a href="/?state=welcome">Welcome</a><a href="/?state=conversation">Conversation</a><a href="/?state=setup">Setup</a><a href="/?view=settings">Settings</a><a href="/?${new URLSearchParams({ ...Object.fromEntries(url.searchParams), theme: url.searchParams.get('theme') === 'light' ? 'dark' : 'light' })}">Toggle theme</a></nav><iframe title="OpenCursor webview" src="/${view}?${frame}"></iframe></body></html>`);
    return;
  }
  if (!['/sidebar', '/settings'].includes(url.pathname)) { res.statusCode = 404; res.end(); return; }
  const theme = url.searchParams.get('theme') === 'light' ? 'light' : 'dark';
  const entry = url.pathname.slice(1);
  const variables = Object.entries(themes[theme]).map(([k, v]) => `--vscode-${k}:${v}`).join(';');
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenCursor ${entry}</title><style>:root{${variables};--vscode-font-family:system-ui;--vscode-editor-font-family:Consolas,monospace}</style><link rel="stylesheet" href="/${entry}.css"></head><body class="vscode-${theme}"><div id="root" data-icon="/icon.png"></div><script>(${mockHost.toString()})();</script><script src="/${entry}.js"></script></body></html>`);
}).listen(port, '127.0.0.1', () => console.log(`Webview preview: http://127.0.0.1:${port}`));
