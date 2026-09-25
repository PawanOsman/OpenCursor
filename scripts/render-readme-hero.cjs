/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor, AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// Build the webviews and run preview:ui first. Captures sample data only.
// OPENCURSOR_PREVIEW_ORIGIN and OPENCURSOR_BROWSER override local defaults.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const origin = process.env.OPENCURSOR_PREVIEW_ORIGIN || 'http://127.0.0.1:4173';
const stamp = 1_750_000_000_000;
const sample = {
  type: 'initialState', activeId: 'readme-preview', mode: 'agent', selectedModel: 'readme-local',
  turns: [
    { role: 'user', text: 'Add keyboard search to the project list.' },
    { role: 'assistant', durationMs: 83000, blocks: [
      { kind: 'text', text: 'I will check the existing list, add the search field, and verify keyboard access.' },
      { kind: 'tool', name: 'Read', callId: 'read-projects', status: 'completed', input: { path: 'src/ProjectList.tsx' }, output: 'Read src/ProjectList.tsx' },
      { kind: 'tool', name: 'Shell', callId: 'test-projects', status: 'completed', input: { command: 'pnpm test' }, output: '12 tests passed.' },
      { kind: 'text', text: 'Added accessible project search.\n\n- Results filter as you type.\n- Press **Escape** to clear the query.\n- The input has an accessible label.\n\n```tsx\n<input\n  aria-label="Search projects"\n  value={query}\n  onChange={updateQuery}\n/>\n```\n\nAll **12 tests** passed.' },
    ] },
  ],
  personas: [], activePersonaId: 'default', hasProviders: true, runningConvIds: [],
  workspaceState: { openTabs: ['readme-preview'], drafts: {} },
};

async function browserOptions() {
  if (process.env.OPENCURSOR_BROWSER) return { executablePath: process.env.OPENCURSOR_BROWSER };
  const candidates = process.platform === 'win32' ? [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ] : process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ] : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const executablePath of candidates) {
    try { await fs.access(executablePath); return { executablePath }; } catch { /* Try the next installed browser. */ }
  }
  throw new Error('Set OPENCURSOR_BROWSER to an installed Chrome or Edge executable.');
}

async function captureInterface() {
  const browser = await chromium.launch({ ...await browserOptions(), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 624, height: 744 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      let factory;
      Object.defineProperty(window, 'acquireVsCodeApi', {
        configurable: true, get: () => factory,
        set: original => { factory = () => {
          const bridge = original();
          return { ...bridge, postMessage: message => {
            if (message.type === 'ready' || message.type === 'getFileIcon') bridge.postMessage(message);
          } };
        }; },
      });
    });
    await page.goto(origin + '/sidebar?theme=dark');
    await page.waitForFunction(() => document.querySelector('.model-select')?.textContent.includes('Example model'));
    await page.evaluate(({ sample, stamp }) => {
      document.documentElement.dataset.motion = 'reduced';
      const send = data => window.dispatchEvent(new MessageEvent('message', { data }));
      send(sample);
      send({ type: 'modelsFetched', models: ['readme-local'], modelList: [{ id: 'readme-local', name: 'Local coding model', kind: 'ollama', providerName: 'Ollama', options: [] }] });
      send({ type: 'conversations', list: [{ id: 'readme-preview', title: 'Accessible project search', updatedAt: stamp }] });
      send({ type: 'pendingChanges', changes: [
        { path: 'src/ProjectList.tsx', existedBefore: true, added: 18, removed: 3 },
        { path: 'src/ProjectList.test.tsx', existedBefore: true, added: 12, removed: 0 },
      ] });
      send({ type: 'workflowState', queues: { 'readme-preview': [{ id: 'follow-up', text: 'Add a test for empty search results.', status: 'queued', createdAt: stamp }] }, goals: {} });
    }, { sample, stamp });
    await page.locator('.markdown-content .code-token-string').first().waitFor();
    await page.getByText('Add a test for empty search results.', { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('.model-select')?.textContent.includes('Local coding model'));
    await page.evaluate(() => document.fonts.ready);
    // Wait for the text-swap timers and layout to settle before capturing.
    await page.waitForTimeout(350);
    await page.locator('.chat-messages').evaluate(element => { element.scrollTop = 0; });
    await page.waitForTimeout(100);
    await page.mouse.move(0, 0);
    if (errors.length) throw new Error(errors.join('\n'));
    return await page.screenshot({ animations: 'disabled' });
  } finally { await browser.close(); }
}

function hero(screenshot) {
  const image = screenshot.toString('base64');
  return `<!--
Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>

This file is part of OpenCursor, AI coding agent chat inside VS Code.
https://github.com/PawanOsman/OpenCursor

Licensed under the MIT License. See LICENSE file in the project root.
-->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1440" height="980" viewBox="0 0 1440 980" role="img" aria-labelledby="title description" font-family="Segoe UI, Inter, Arial, sans-serif">
  <title id="title">OpenCursor, an AI coding agent for your workspace</title>
  <desc id="description">Build with your models and stay in control. An interface preview shows a sample conversation with highlighted code, a queued follow-up, and file review controls.</desc>
  <defs><clipPath id="preview"><rect x="752" y="154" width="624" height="744" rx="20"/></clipPath></defs>
  <rect x="1" y="1" width="1438" height="978" rx="26" fill="#17181d" stroke="#3b3c47"/>
  <g transform="translate(61 49) scale(1.65)" fill="#8b7cf8">
    <path d="M6 3l9.5 9-4.2.6 2.4 5-2.3 1-2.3-5-3.1 2.6V3z"/>
    <path d="M18.5 3l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1z"/>
    <circle cx="20.5" cy="11" r="1.1"/><rect x="4" y="19.5" width="5" height="2" rx="1"/>
  </g>
  <text x="111" y="79" font-size="28" font-weight="650" fill="#f5f5f8">OpenCursor</text>
  <text x="1376" y="76" text-anchor="end" font-size="15" letter-spacing="2" fill="#adaebc">OPEN SOURCE / VS CODE</text>
  <path d="M64 114H1376" stroke="#3b3c47"/>
  <text x="64" y="226" font-size="69" font-weight="650" letter-spacing="-2" fill="#f5f5f8">Build with</text>
  <text x="64" y="310" font-size="69" font-weight="650" letter-spacing="-2" fill="#f5f5f8">your models.</text>
  <text x="64" y="394" font-size="69" font-weight="650" letter-spacing="-2" fill="#a89afa">Stay in control.</text>
  <text x="66" y="465" font-size="25" fill="#adaebc">Read, edit, run, and review</text>
  <text x="66" y="503" font-size="25" fill="#adaebc">without leaving VS Code.</text>
  <g font-size="18" fill="#d4cfef">
    <rect x="64" y="547" width="150" height="40" rx="20" fill="#292536" stroke="#474054"/>
    <text x="139" y="574" text-anchor="middle">Local models</text>
    <rect x="226" y="547" width="128" height="40" rx="20" fill="#292536" stroke="#474054"/>
    <text x="290" y="574" text-anchor="middle">Accounts</text>
    <rect x="366" y="547" width="120" height="40" rx="20" fill="#292536" stroke="#474054"/>
    <text x="426" y="574" text-anchor="middle">API keys</text>
  </g>
  <path d="M64 641H652" stroke="#3b3c47"/>
  <circle cx="73" cy="695" r="5" fill="#9cddbe"/>
  <text x="94" y="703" font-size="24" font-weight="600" fill="#f5f5f8">Bring your own connections</text>
  <text x="94" y="739" font-size="21" fill="#adaebc">Choose the provider that fits each task.</text>
  <circle cx="73" cy="803" r="5" fill="#9cddbe"/>
  <text x="94" y="811" font-size="24" font-weight="600" fill="#f5f5f8">Keep every change reviewable</text>
  <text x="94" y="847" font-size="21" fill="#adaebc">Steer the agent. Keep or undo its edits.</text>
  <image x="752" y="154" width="624" height="744" clip-path="url(#preview)" xlink:href="data:image/png;base64,${image}"/>
  <rect x="751.5" y="153.5" width="625" height="745" rx="20.5" fill="none" stroke="#4c4c59"/>
  <text x="64" y="942" font-size="16" fill="#adaebc">YOUR WORKSPACE. YOUR WORKFLOW.</text>
  <text x="1376" y="942" text-anchor="end" font-size="16" fill="#adaebc">Interface preview with sample data</text>
</svg>
`;
}

async function main() {
  const svg = hero(await captureInterface());
  const output = path.join(root, 'media/readme');
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'hero.svg'), svg, 'utf8');
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(path.join(output, 'hero.png'));
  console.log('Rendered media/readme/hero.svg and hero.png');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
