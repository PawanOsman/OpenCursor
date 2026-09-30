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

const convId = 'working-section';
const finalText = 'The task indicators now distinguish unfinished work. All targeted checks passed.';
const durationMs = 3_723_000;
const verification = { status: 'checks-passed', revision: 1, changedPaths: ['src/tasks.ts'], checks: [
  { command: 'npm test', revision: 1, status: 'completed', exitCode: 0, at: 1 },
] };
const message = event => ({ type: 'agentEvent', convId, event });

async function send(page, data) {
  await page.evaluate(data => window.dispatchEvent(new MessageEvent('message', { data })), data);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function settle(page) {
  await page.waitForFunction(() => !document.querySelector('.chat-turn-group:last-child .working-body'));
  await page.waitForFunction(() => document.querySelector('.chat-turn-group:last-child .working-title')?.getAttribute('aria-label') === 'Worked for 1h 2m 3s');
}

async function counterChecks(page, motion, label) {
  const epoch = 1_800_000_000_000;
  await page.evaluate(epoch => { window.__workingNow = epoch + 8000; }, epoch);
  await send(page, { type: 'loadConversation', activeId: 'working-counter', running: true, turns: [
    { role: 'user', text: 'Show elapsed work without animating its label.' },
    { role: 'assistant', startedAt: epoch, blocks: [{ kind: 'text', text: 'Checking the elapsed clock.' }] },
  ] });
  await page.waitForFunction(() => document.querySelector('.working-title')?.getAttribute('aria-label') === 'Working for 8s');
  await page.evaluate(() => {
    window.__workingPrefix = document.querySelector('.working-prefix');
    window.__workingSeconds = document.querySelector('.working-time-part[data-unit="s"]');
    window.__workingUnit = window.__workingSeconds.querySelector('.working-time-unit');
    window.__workingOnes = window.__workingSeconds.querySelector('.t-reel-col[data-place="0"]');
  });

  const tick = async (seconds, expected, sample = false) => {
    await page.evaluate(now => { window.__workingNow = now; }, epoch + seconds * 1000);
    await page.waitForFunction(expected => document.querySelector('.working-title')?.getAttribute('aria-label') === expected, expected);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const states = await page.evaluate(async sample => {
      const samples = [], start = performance.now();
      do {
        const title = document.querySelector('.working-title');
        const seconds = title.querySelector('.working-time-part[data-unit="s"]');
        const columns = [...seconds.querySelectorAll('.t-reel-col')];
        samples.push({
          prefixRetained: window.__workingPrefix === title.querySelector('.working-prefix'),
          secondsRetained: window.__workingSeconds === seconds,
          unitRetained: window.__workingUnit === seconds.querySelector('.working-time-unit'),
          onesRetained: window.__workingOnes === seconds.querySelector('.t-reel-col[data-place="0"]'),
          staticText: [...title.querySelectorAll('.working-prefix, .working-time-unit')].every(element => {
            const css = getComputedStyle(element);
            return css.opacity === '1' && css.transform === 'none' && element.getAnimations().length === 0;
          }),
          wholeLabelAnimation: title.classList.contains('t-text-swap') || title.getAnimations().length > 0,
          columns: columns.map(column => ({
            place: column.dataset.place, digit: column.dataset.digit, spinning: column.dataset.spinning === 'true',
            transform: getComputedStyle(column.querySelector('.t-reel-strip')).transform,
            filter: getComputedStyle(column.querySelector('.t-reel-strip')).filter,
          })),
          blur: [...title.querySelectorAll('feGaussianBlur')].map(element => element.getAttribute('stdDeviation').split(/[ ,]+/).map(Number)),
        });
        if (!sample) break;
        await new Promise(resolve => requestAnimationFrame(resolve));
      } while (performance.now() - start < 320);
      return samples;
    }, sample);
    for (const state of states) {
      assert(state.prefixRetained && state.secondsRetained && state.unitRetained && state.onesRetained,
        `${label}/${seconds}s: unchanged words, units and digit positions retain their DOM`);
      assert(state.staticText && !state.wholeLabelAnimation, `${label}/${seconds}s: only numeric digits animate`);
      assert(state.blur.every(([x, y = x]) => x === 0 && y >= 0), `${label}/${seconds}s: blur is vertical only`);
    }
    if (motion === 'reduced') {
      assert(states.every(state => state.columns.every(column => !column.spinning)), `${label}/${seconds}s: reduced motion updates immediately`);
      assert(states.every(state => state.blur.every(values => values.every(value => value === 0))), `${label}/${seconds}s: reduced motion has no blur`);
    }
    await page.waitForFunction(() => !document.querySelector('.working-title .t-reel-col[data-spinning="true"]'));
    const landed = await page.locator('.working-title .t-reel-col').evaluateAll(columns => columns.every(column => {
      const window = column.getBoundingClientRect();
      const center = (window.top + window.bottom) / 2;
      const digit = [...column.querySelectorAll('.t-reel-digit')].find(cell => {
        const bounds = cell.getBoundingClientRect();
        return bounds.top < center && bounds.bottom > center;
      });
      return window.width > 0 && digit?.textContent === column.dataset.digit;
    }));
    assert(landed, `${label}/${seconds}s: each reel settles on its displayed number`);
    return states;
  };

  const moving = await tick(9, 'Working for 9s', motion === 'full');
  if (motion === 'full') {
    assert(new Set(moving.map(state => state.columns.find(column => column.place === '0').transform)).size > 3,
      `${label}: an elapsed second genuinely spins its changing digit`);
    assert(moving.some(state => state.blur.some(([, y]) => y > 0)), `${label}: moving digits have a vertical motion streak`);
    assert(moving.some(state => state.columns.some(column => column.filter.startsWith('url('))), `${label}: the vertical blur filter is applied to the spinning strip`);
  }
  await tick(10, 'Working for 10s');
  await tick(12, 'Working for 12s');
  const tens = await page.locator('.working-time-part[data-unit="s"] .t-reel-col[data-place="1"] .t-reel-strip').evaluate(strip => {
    window.__workingTens = strip;
    return getComputedStyle(strip).transform;
  });
  const stableTens = await tick(13, 'Working for 13s', motion === 'full');
  assert(stableTens.every(state => {
    const column = state.columns.find(column => column.place === '1');
    return !column.spinning && column.transform === tens;
  }), `${label}: the unchanged tens digit does not spin on 12 to 13`);
  assert(await page.locator('.working-time-part[data-unit="s"] .t-reel-col[data-place="1"] .t-reel-strip').evaluate(strip => strip === window.__workingTens), `${label}: unchanged tens retains its strip`);
  await tick(59, 'Working for 59s');
  await tick(60, 'Working for 1m 0s', motion === 'full');
  assert.equal(await page.locator('.working-time-part[data-unit="m"] .working-time-unit').textContent(), 'm', `${label}: minutes are introduced at the carry`);
  await geometry(page, `${label}/counter`);
  await page.evaluate(() => { delete window.__workingNow; });
}

async function fixture(page, motion) {
  const turns = [
    { role: 'user', text: 'Earlier question.' },
    { role: 'assistant', blocks: [{ kind: 'text', text: 'Earlier answer.' }] },
    { role: 'user', text: 'Distinguish tasks that started but remain unfinished.' },
  ];
  await send(page, {
    type: 'initialState', activeId: convId, mode: 'agent', selectedModel: 'preview-model', turns,
    personas: [], activePersonaId: 'default', hasProviders: true, runningConvIds: [],
    workspaceState: { openTabs: [convId], drafts: {} },
    uiPrefs: { motion, chatTextSize: 'default', maxTabCount: 0, completionSound: false },
  });
  await send(page, { type: 'workflowState', goals: {}, queues: {} });
  await send(page, { type: 'pendingChanges', changes: [] });
  await send(page, { type: 'runStarted', convId, turns });
  await page.waitForFunction(() => document.querySelector('.chat-turn-group:last-child .working-head')?.textContent.includes('Working'));
  await send(page, message({ type: 'run-status', status: 'running' }));
  await send(page, message({ type: 'thinking-delta', text: 'Check the task state and the current rendering.' }));
  await send(page, message({ type: 'text-delta', text: 'I will update the task indicators and verify the result.' }));
  await send(page, message({ type: 'tool-call-started', callId: 'check-tasks', name: 'Read', input: { path: 'src/tasks.ts' } }));
  await page.locator('.chat-turn-group:last-child .working-body').waitFor();
  assert.equal(await page.locator('.chat-turn-group:last-child .working-head[aria-expanded]').getAttribute('aria-expanded'), 'true', 'work starts expanded');
  await send(page, message({ type: 'tool-call-completed', callId: 'check-tasks', name: 'Read', status: 'completed', result: 'Task state implementation.' }));
  await page.evaluate(({ convId }) => {
    const emit = event => window.dispatchEvent(new MessageEvent('message', { data: { type: 'agentEvent', convId, event } }));
    for (let index = 0; index < 16; index++) {
      emit({ type: 'text-delta', text: `Checking task state ${index + 1} and its accessible label.` });
      emit({ type: 'tool-call-started', callId: `check-${index}`, name: 'Shell', input: { command: `node check-task-state-${index + 1}.js` } });
      emit({ type: 'tool-call-completed', callId: `check-${index}`, name: 'Shell', status: 'completed', result: 'Passed.' });
    }
  }, { convId });
  await send(page, message({ type: 'text-delta', text: finalText }));
  await page.waitForFunction(() => document.querySelector('.chat-turn-group:last-child .working-body')?.textContent.includes('check-task-state-16'));
  await page.evaluate(() => {
    const chat = document.querySelector('.chat-messages');
    const group = chat.querySelector('.chat-turn-group:last-child');
    chat.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }));
    chat.scrollTop += group.getBoundingClientRect().top - chat.getBoundingClientRect().top;
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function geometry(page, label) {
  const result = await page.evaluate(() => {
    const rect = element => {
      const r = element.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height };
    };
    const chat = document.querySelector('.chat-messages');
    return {
      documentOverflow: document.documentElement.scrollWidth - innerWidth,
      chatOverflow: chat.scrollWidth - chat.clientWidth,
      viewportHeight: innerHeight, header: rect(document.querySelector('.chat-header')),
      composer: rect(document.querySelector('.bottom-stack .composer')), chat: rect(chat),
      prompt: rect(chat.querySelector('.chat-turn-group:last-child .msg.user')),
      group: rect(chat.querySelector('.chat-turn-group:last-child')),
      work: rect(chat.querySelector('.chat-turn-group:last-child .working-section')),
    };
  });
  assert(result.documentOverflow <= 1 && result.chatOverflow <= 1, `${label}: no horizontal overflow ${JSON.stringify(result)}`);
  assert(result.header.top >= -1 && result.composer.bottom <= result.viewportHeight + 1, `${label}: fixed chrome remains within the viewport`);
  assert(result.work.left >= result.chat.left - 1 && result.work.right <= result.chat.right + 1, `${label}: work fits transcript width`);
  return result;
}

async function complete(page, sampleMotion) {
  const events = [
    message({ type: 'run-status', status: 'finished' }),
    message({ type: 'verification', summary: verification }),
    message({ type: 'run-result', text: finalText, durationMs }),
  ];
  const heights = await page.evaluate(async ({ events, sampleMotion }) => {
    for (const data of events) window.dispatchEvent(new MessageEvent('message', { data }));
    if (!sampleMotion) return [];
    const samples = [], start = performance.now();
    while (performance.now() - start < 420) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const disclosure = document.querySelector('.chat-turn-group:last-child .working-body')?.parentElement;
      samples.push(disclosure?.getBoundingClientRect().height ?? 0);
    }
    return samples;
  }, { events, sampleMotion });
  if (sampleMotion) {
    assert(new Set(heights.map(value => value.toFixed(1))).size > 3, 'the working activity height transitions smoothly');
    assert.equal(heights.at(-1), 0, 'the collapsed activity releases its height');
  }
  await settle(page);
  assert.equal(await page.locator('.chat-turn-group:last-child .working-head[aria-expanded]').getAttribute('aria-expanded'), 'false', 'completed activity collapses automatically');
  assert.equal(await page.locator('.chat-turn-group:last-child .working-conclusion > .block-group').first().innerText(), finalText, 'the final conclusion remains visible');
  const copies = await page.locator('.chat-messages').evaluate((chat, text) => chat.textContent.split(text).length - 1, finalText);
  assert.equal(copies, 1, 'the final conclusion is displayed once');
  assert.equal(await page.locator('.phase-row').count(), 0, 'completed work has no live phase indicator');
}

async function disclosureChecks(page, label) {
  const head = page.locator('.chat-turn-group:last-child .working-head[aria-expanded]');
  await head.click();
  await page.locator('.chat-turn-group:last-child .working-body').waitFor();
  assert.equal(await head.getAttribute('aria-expanded'), 'true', `${label}: click expands the work history`);
  assert.match(await page.locator('.chat-turn-group:last-child .working-body').innerText(), /check-task-state-16/, `${label}: reopening restores all activity`);
  assert.equal(await page.locator('.chat-turn-group:last-child .working-conclusion > .block-group').first().innerText(), finalText, `${label}: reopening preserves the final reply`);
  assert.equal(await page.locator('.chat-turn-group:last-child .working-body').evaluate((body, text) => body.textContent.includes(text), finalText), false, `${label}: final reply is not duplicated inside activity`);
  await head.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('.chat-turn-group:last-child .working-body'));
  assert.equal(await head.getAttribute('aria-expanded'), 'false', `${label}: Enter collapses`);
  await page.keyboard.press('Space');
  await page.locator('.chat-turn-group:last-child .working-body').waitFor();
  assert.equal(await head.getAttribute('aria-expanded'), 'true', `${label}: Space expands`);
}

async function restoredChecks(page, motion, label) {
  const endedAt = Date.now() - 100_000;
  await send(page, { type: 'loadConversation', activeId: 'restored-work', running: false, turns: [
    { role: 'user', text: 'Earlier implementation request.' },
    { role: 'assistant', startedAt: endedAt - durationMs, endedAt, durationMs, finalText, blocks: [
      { kind: 'text', text: 'Progress from an earlier model step. ' + finalText },
      { kind: 'verification', summary: verification },
    ] },
  ] });
  await settle(page);
  assert.equal(await page.locator('.chat-turn-group:last-child .working-conclusion > .block-group').first().innerText(), finalText, `${label}: persisted final metadata splits a merged text block`);
  await page.locator('.chat-turn-group:last-child .working-head[aria-expanded]').click();
  await page.locator('.chat-turn-group:last-child .working-body').waitFor();
  assert.equal((await page.locator('.chat-turn-group:last-child .working-body').innerText()).trim(), 'Progress from an earlier model step.', `${label}: earlier text remains available separately`);
  await send(page, { type: 'loadConversation', activeId: 'plain-reply', running: false, turns: [
    { role: 'user', text: 'Hello.' }, { role: 'assistant', blocks: [{ kind: 'text', text: 'Hello! How can I help?' }] },
  ] });
  assert.match(await page.locator('.chat-messages').innerText(), /Hello! How can I help\?/, `${label}: untimed text-only history stays visible`);
  assert.equal(await page.locator('.chat-turn-group:last-child .working-head[aria-expanded="false"]').count(), 0, `${label}: a plain reply is not hidden in an empty disclosure`);
  if (motion === 'reduced') assert.equal(await page.locator('.chat-turn-group:last-child .working-section').evaluateAll(sections => sections.flatMap(section => section.getAnimations({ subtree: true })).length), 0, `${label}: reduced motion leaves no running activity animation`);
}

async function main() {
  const output = path.resolve(__dirname, '../dist/visual-qa');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.OPENCURSOR_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    for (const theme of ['light', 'dark']) for (const width of [375, 900]) {
      const motions = width === 375 ? ['reduced', 'full'] : ['reduced'];
      for (const motion of motions) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => {
          let factory;
          const realNow = Date.now.bind(Date);
          Date.now = () => window.__workingNow ?? realNow();
          window.__workingMessages = [];
          Object.defineProperty(window, 'acquireVsCodeApi', {
            configurable: true, get: () => factory,
            set: original => { factory = () => {
              const bridge = original();
              return { ...bridge, postMessage: message => {
                window.__workingMessages.push(message);
                if (message.type === 'ready' || message.type === 'getFileIcon') bridge.postMessage(message);
              } };
            }; },
          });
        });
        await page.goto(`${process.env.OPENCURSOR_PREVIEW_ORIGIN || 'http://127.0.0.1:4178'}/sidebar?theme=${theme}`);
        await page.waitForFunction(() => document.querySelector('.model-select')?.textContent.includes('Example model'));
        const label = `${theme}/${width}/${motion}`;
        const prefix = `working-${theme}-${width}-${motion}`;
        await fixture(page, motion);
        const before = await geometry(page, `${label}/running`);
        assert(before.group.height > before.chat.height, `${label}: tall activity genuinely overflows vertically`);
        await page.screenshot({ path: path.join(output, `${prefix}-running.png`) });
        await complete(page, motion === 'full');
        const after = await geometry(page, `${label}/completed`);
        assert(Math.abs(before.header.top - after.header.top) <= 1 && Math.abs(before.composer.top - after.composer.top) <= 1, `${label}: auto-collapse does not move fixed header/composer`);
        assert(Math.abs(before.prompt.top - after.prompt.top) <= 2, `${label}: the pinned user prompt stays in place when activity collapses`);
        await page.screenshot({ path: path.join(output, `${prefix}-completed.png`) });
        await disclosureChecks(page, label);
        await geometry(page, `${label}/reopened`);
        await page.screenshot({ path: path.join(output, `${prefix}-reopened.png`) });
        await restoredChecks(page, motion, label);
        if (width === 375) {
          await counterChecks(page, motion, label);
          await page.screenshot({ path: path.join(output, `${prefix}-counter.png`) });
        }
        assert.deepEqual(errors, [], `${label}: no browser errors`);
        console.log(`Passed working section ${label}`);
        await context.close();
      }
    }
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
