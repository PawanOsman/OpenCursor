/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const longName = 'very_long_workspace_component_identifier_'.repeat(5);
const tool = (name, callId, input, extra = {}) => ({ kind: 'tool', name, callId, input, status: 'completed', ...extra });
const task = tool('Task', 'agent-1', {
  description: 'Config, package.json, README wiring', subagent_type: 'Backend Developer',
  model: 'provider/claude-opus-5.5', run_in_background: true,
}, { subStatus: 'running', subBlocks: [
  tool('Shell', 'child-1', { command: `Get-Content lib/readiness.js,lib/requestid.js,lib/shutdown.js | Select-Object -First 100 ${longName}` }),
  tool('Read', 'child-2', { path: `src/${longName}.ts` }, { status: 'running' }),
] });

async function send(page, data) {
  await page.evaluate(data => window.dispatchEvent(new MessageEvent('message', { data })), data);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function fixture(page, blocks, motion = 'reduced') {
  await send(page, {
    type: 'initialState', activeId: 'responsive-chat', mode: 'agent', selectedModel: 'preview-model',
    turns: [{ role: 'user', text: 'Upgrade the project.' }, { role: 'assistant', blocks }],
    personas: [], activePersonaId: 'default', hasProviders: true, runningConvIds: ['responsive-chat'],
    workspaceState: { openTabs: ['responsive-chat'], drafts: {} },
    uiPrefs: { motion, chatTextSize: 'default', maxTabCount: 0, completionSound: false },
  });
}

async function bounds(page, label) {
  const result = await page.evaluate(() => {
    const chat = document.querySelector('.chat-messages');
    const cards = [...document.querySelectorAll('.subagent-card,.tool-card,.question-card,.approval-card')];
    const clipped = cards.flatMap(card => {
      const outer = card.getBoundingClientRect();
      return [...card.querySelectorAll('.label,.sub-chip,.sub-status,.badge,button,.step-label,.todo-text,.qc-step,.ap-tool')].filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.left < outer.left - 1 || rect.right > outer.right + 1;
      }).map(element => element.className);
    });
    return {
      documentOverflow: document.documentElement.scrollWidth - innerWidth,
      chatOverflow: chat.scrollWidth - chat.clientWidth, clipped,
      offenders: [...chat.querySelectorAll('*')].filter(element => element.getBoundingClientRect().right > chat.getBoundingClientRect().right + 1).map(element => element.className).slice(0, 15),
    };
  });
  assert(result.documentOverflow <= 1 && result.chatOverflow <= 1 && !result.clipped.length, `${label}: ${JSON.stringify(result)}`);
}

async function motionChecks(page) {
  await fixture(page, [task], 'full');
  await page.waitForFunction(() => document.querySelector('.subagent-card .animated-disclosure')?.getAttribute('data-open') === 'true');
  const rotations = await page.evaluate(() => new Promise(resolve => {
    const samples = [], start = performance.now();
    function sample(now) {
      samples.push(getComputedStyle(document.querySelector('.subagent-card-actions .spinner')).transform);
      if (now - start < 260) requestAnimationFrame(sample); else resolve(samples);
    }
    requestAnimationFrame(sample);
  }));
  assert(new Set(rotations).size > 3, 'the task stop ring rotates');
  const frames = await page.evaluate(() => new Promise(resolve => {
    const samples = [], start = performance.now();
    window.dispatchEvent(new MessageEvent('message', { data: {
      type: 'agentEvent', convId: 'responsive-chat', event: {
        type: 'subagent-event', callId: 'agent-1', event: { type: 'run-status', status: 'finished' },
      },
    } }));
    function sample(now) {
      const card = document.querySelector('.subagent-card');
      const status = card.querySelector('.sub-status .t-text-swap');
      samples.push({ height: card.getBoundingClientRect().height, opacity: getComputedStyle(status).opacity });
      if (now - start < 420) requestAnimationFrame(sample); else resolve(samples);
    }
    requestAnimationFrame(sample);
  }));
  assert(new Set(frames.map(frame => frame.height.toFixed(1))).size > 3, 'live steps collapse smoothly');
  assert(new Set(frames.map(frame => frame.opacity)).size > 3, 'status text animates when the task finishes');
  assert.equal(await page.locator('.subagent-card .animated-disclosure').count(), 0, 'finished task releases its progress panel');
  assert.equal(await page.locator('.sub-status').innerText(), 'COMPLETED');
  await bounds(page, 'completed task');
  await fixture(page, [task], 'reduced');
  await send(page, { type: 'agentEvent', convId: 'responsive-chat', event: {
    type: 'subagent-event', callId: 'agent-1', event: { type: 'run-status', status: 'finished' },
  } });
  assert.equal(await page.locator('.subagent-card .animated-disclosure').count(), 0, 'reduced motion closes without waiting');
}

async function taskChecks(page, output, theme) {
  const result = '[x] Explore project and propose 5 upgrade ideas\n[~] Implement the 5 ideas via subagents\n[ ] Review changes\n[-] Optional follow-up';
  await fixture(page, [tool('TodoWrite', 'task-list', {}, { result })], 'full');
  const rotation = await page.locator('.todo-item.in_progress .todo-active').evaluate(async ring => {
    const first = getComputedStyle(ring).transform;
    await new Promise(resolve => setTimeout(resolve, 260));
    return { first, last: getComputedStyle(ring).transform };
  });
  assert.notEqual(rotation.first, rotation.last, 'active task has a rotating ring');
  assert.equal(await page.locator('.todo-item.pending .todo-ring').evaluate(ring => getComputedStyle(ring).fill), 'none', 'pending task ring is hollow');
  await bounds(page, 'task list');
  await page.screenshot({ path: path.join(output, `task-list-${theme}.png`) });
  const frames = await page.evaluate(async () => {
    const row = document.querySelector('.todo-item.in_progress');
    window.dispatchEvent(new MessageEvent('message', { data: {
      type: 'agentEvent', convId: 'responsive-chat', event: {
        type: 'tool-call-completed', callId: 'task-list', name: 'TodoWrite', status: 'completed',
        result: '[x] Explore project and propose 5 upgrade ideas\n[x] Implement the 5 ideas via subagents\n[ ] Review changes\n[-] Optional follow-up',
      },
    } }));
    const samples = [], start = performance.now();
    while (performance.now() - start < 400) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      samples.push(getComputedStyle(row.querySelector('.todo-check')).strokeDashoffset);
    }
    return { samples, retained: row.isConnected && row.classList.contains('completed') };
  });
  assert(frames.retained, 'task updates keep the same row');
  assert(new Set(frames.samples).size > 3, 'completion check draws smoothly');
  assert.equal(parseFloat(frames.samples.at(-1)), 0, 'completion check finishes fully drawn');
  assert.equal(await page.locator('.todo-count').innerText(), '2/4 completed');
  for (const status of ['cancelled', 'finished', 'error']) {
    await fixture(page, [tool('TodoWrite', 'task-list', {}, { result })], 'full');
    await send(page, { type: 'agentEvent', convId: 'responsive-chat', event: { type: 'run-status', status } });
    assert.equal(await page.locator('.todo-item.in_progress .todo-active').evaluate(ring => getComputedStyle(ring).animationName), 'none', `${status}: unfinished task stops spinning when the conversation settles`);
    assert.equal(await page.locator('.todo-item.in_progress .todo-mark').getAttribute('aria-label'), 'Started, unfinished', `${status}: stopped work has a distinct accessible state`);
    await page.waitForFunction(() => {
      const row = document.querySelector('.todo-item.unfinished');
      return row && getComputedStyle(row.querySelector('.todo-paused')).opacity === '1' && getComputedStyle(row.querySelector('.todo-active')).opacity === '0';
    });
    if (status === 'cancelled') await page.screenshot({ path: path.join(output, `task-list-${theme}-stopped.png`) });
    assert.equal(await page.locator('.todo-item.in_progress .todo-text').innerText(), 'Implement the 5 ideas via subagents', `${status}: stopping does not mark unfinished work complete`);
  }
  await fixture(page, [tool('TodoWrite', 'task-list', {}, { result })], 'reduced');
  assert.equal(await page.locator('.todo-active').evaluateAll(rings => rings.reduce((sum, ring) => sum + ring.getAnimations().length, 0)), 0, 'reduced motion keeps task indicators static');
}

async function main() {
  const output = path.resolve(__dirname, '../dist/visual-qa');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.OPENCURSOR_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    for (const theme of ['light', 'dark']) for (const width of [280, 375, 520, 900]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        let factory;
        window.__chatMessages = [];
        Object.defineProperty(window, 'acquireVsCodeApi', {
          configurable: true, get: () => factory,
          set: original => { factory = () => {
            const bridge = original();
            return { ...bridge, postMessage: message => {
              window.__chatMessages.push(message);
              if (message.type === 'ready' || message.type === 'getFileIcon') bridge.postMessage(message);
            } };
          }; },
        });
      });
      await page.goto(`${process.env.OPENCURSOR_PREVIEW_ORIGIN || 'http://127.0.0.1:4178'}/sidebar?theme=${theme}`);
      await page.waitForFunction(() => document.querySelector('.model-select')?.textContent.includes('Example model'));
      const label = `${theme}/${width}`;
      await fixture(page, [task, { ...task, callId: 'agent-2', input: { ...task.input, description: 'Wire features into proxy.js', subagent_type: longName } }]);
      await bounds(page, `${label}/agents`);
      await page.screenshot({ path: path.join(output, `responsive-chat-${theme}-${width}.png`) });
      await page.locator('.subagent-card-actions button').first().click();
      assert(await page.evaluate(() => window.__chatMessages.some(message => message.type === 'cancelSubagent' && message.callId === 'agent-1')), 'stop targets the selected task');
      assert.equal(await page.locator('.subagent-card').count(), 2, 'stop does not open the task tab');
      await page.locator('.subagent-card').first().focus();
      await page.keyboard.press('Enter');
      await page.locator('.subagent-view').waitFor();
      await bounds(page, `${label}/opened-agent`);
      await page.locator('.tab:not(.subagent-tab)').first().click();

      await fixture(page, [task]);
      await send(page, { type: 'approvalRequest', convId: 'responsive-chat', request: {
        requestId: 'approval-1', convId: 'responsive-chat', toolName: longName,
        actionType: 'mcp', subject: longName, detail: `Run ${longName}`, suggestion: longName,
      } });
      await bounds(page, `${label}/approval`);
      await page.locator('.ap-arrow').click();
      await bounds(page, `${label}/approval-menu`);
      assert(await page.locator('.ap-menu').evaluate(menu => {
        const rect = menu.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight && menu.scrollWidth <= menu.clientWidth;
      }), `${label}: approval options fit the viewport, including long patterns`);
      await send(page, { type: 'approvalResolved', convId: 'responsive-chat', requestId: 'approval-1', approved: false });

      const cases = [
        tool(`mcp__${longName}__search_files`, 'mcp', {}),
        tool('Shell', 'shell', { command: `node ${longName}.js --verify` }, { status: 'running' }),
        tool('TodoWrite', 'todos', {}, { result: `[~] Update ${longName}.ts\n[ ] Review changes\n[x] Inspect project\n[-] Optional task` }),
        tool('AskQuestion', 'question', { header: `Choose ${longName}`, questions: [
          { question: `Select a target ${longName}`, options: [`Use ${longName}`, 'Second option'] },
          { question: 'Confirm the change', options: ['Yes', 'No'] },
        ] }, { status: 'running' }),
        { kind: 'text', text: `Long identifier: ${longName}\n\n\`\`\`ts\nconst ${longName} = true;\n\`\`\`\n\n| File | Status |\n| --- | --- |\n| ${longName} | Ready |` },
      ];
      for (const block of cases) {
        await fixture(page, [block]);
        await bounds(page, `${label}/${block.callId || 'markdown'}`);
        if (block.callId === 'question') {
          await page.locator('.qc-next').click();
          await bounds(page, `${label}/question-last`);
        }
      }
      if (width === 375) {
        await motionChecks(page);
        await taskChecks(page, output, theme);
      }
      assert.deepEqual(errors, [], `${label}: no browser errors`);
      console.log(`Passed responsive chat ${label}`);
      await context.close();
    }
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
