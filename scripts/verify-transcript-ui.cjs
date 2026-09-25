/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

const { chromium } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

const paragraph = 'The implementation keeps the project behavior consistent, preserves keyboard access, and checks each boundary before applying the next change.';
const answer = (label, count = 24) => Array.from({ length: count }, (_, index) => `${label} step ${index + 1}. ${paragraph}`).join('\n\n');
const turns = Array.from({ length: 4 }, (_, index) => [
  { role: 'user', text: `Request ${index + 1}: review the next project change.` },
  { role: 'assistant', blocks: [{ kind: 'text', text: answer(`Response ${index + 1}`) }] },
]).flat();

async function send(page, data) {
  await page.evaluate(data => window.dispatchEvent(new MessageEvent('message', { data })), data);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function load(page, activeId, fixture, running = false) {
  await send(page, {
    type: 'initialState', activeId, mode: 'agent', selectedModel: 'preview-model', turns: fixture,
    personas: [], activePersonaId: 'default', hasProviders: true,
    uiPrefs: { motion: 'reduced' },
    runningConvIds: running ? [activeId] : [],
    workspaceState: { openTabs: [activeId], drafts: {} },
  });
  await page.waitForTimeout(300);
}

async function snapshot(page) {
  return page.locator('.chat-messages').evaluate(chat => {
    const bounds = chat.getBoundingClientRect();
    const users = Array.from(chat.querySelectorAll('.msg.user:not(.editing)')).map((user, index) => {
      const box = user.getBoundingClientRect();
      const bubble = user.querySelector('.bubble').getBoundingClientRect();
      const pointX = Math.max(bounds.left + 1, Math.min(bubble.right - 2, bounds.right - 2));
      const pointY = Math.max(bounds.top + 1, Math.min(bubble.top + 2, bounds.bottom - 1));
      return {
        index, top: box.top, bottom: box.bottom, height: box.height,
        bubbleHeight: bubble.height, text: user.querySelector('.bubble').textContent,
        hit: user.contains(document.elementFromPoint(pointX, pointY)),
        position: getComputedStyle(user).position,
      };
    });
    return { top: bounds.top, stickyTop: bounds.top + Number.parseFloat(getComputedStyle(chat).paddingTop), bottom: bounds.bottom, height: bounds.height, scrollTop: chat.scrollTop, scrollHeight: chat.scrollHeight, clientHeight: chat.clientHeight, users };
  });
}

function assertPinned(state, index, label) {
  const user = state.users[index];
  assert(user, `${label}: expected user message ${index}`);
  assert.equal(user.position, 'sticky', `${label}: user header is sticky`);
  assert(Math.abs(user.top - state.stickyTop) <= 1, `${label}: user header stays at transcript top: ${JSON.stringify(state)}`);
  assert(user.hit, `${label}: sticky user header is painted and reachable`);
  const atTop = state.users.filter(item => Math.abs(item.top - state.stickyTop) <= 1);
  assert.equal(atTop.length, 1, `${label}: user headers must not stack`);
  assert(user.bottom < state.bottom - 80, `${label}: assistant content remains readable below the header`);
}

async function readGroup(page, index) {
  // A distant historical group can still have an estimated intrinsic height.
  // Reveal it first, then position within its measured response after layout.
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.locator('.chat-messages').evaluate((chat, { target, reveal }) => {
      chat.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }));
      const group = chat.querySelectorAll('.chat-turn-group')[target];
      chat.scrollTop += group.getBoundingClientRect().top - chat.getBoundingClientRect().top + (reveal ? 0 : group.offsetHeight / 2);
    }, { target: index, reveal: attempt === 0 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
}

async function checkActions(page, message, label) {
  const actions = message.locator('.message-actions');
  await page.evaluate(() => document.activeElement?.blur());
  await page.mouse.move(0, 0);
  const idle = await actions.evaluate(element => ({ opacity: getComputedStyle(element).opacity, pointer: getComputedStyle(element).pointerEvents }));
  assert.equal(Number(idle.opacity), 0, `${label}: actions stay hidden at rest`);
  const before = await message.boundingBox();
  await message.locator('.bubble').hover({ position: { x: 8, y: 8 } });
  assert.equal(await actions.evaluate(element => Number(getComputedStyle(element).opacity)), 1, `${label}: hovering reveals actions`);
  assert.deepEqual(await message.boundingBox(), before, `${label}: revealing actions does not shift the message`);
  await page.mouse.move(0, 0);
  await actions.getByRole('button', { name: 'Copy message', exact: true }).focus();
  assert.equal(await actions.evaluate(element => Number(getComputedStyle(element).opacity)), 1, `${label}: keyboard focus reveals actions`);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => navigator.clipboard.readText().then(text => text.length > 0));
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert(copied.length > 0, `${label}: keyboard copy works`);
  await page.evaluate(() => document.activeElement?.blur());
  return { idle, hover: 'visible', keyboard: 'passed', copiedCharacters: copied.length };
}

async function main() {
  const origin = process.env.OPENCURSOR_PREVIEW_ORIGIN || 'http://127.0.0.1:4178';
  const output = path.resolve(__dirname, '../dist/visual-qa');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.OPENCURSOR_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const results = [];
  try {
    for (const theme of ['light', 'dark']) for (const width of [375, 900]) {
      const context = await browser.newContext({ viewport: { width, height: 850 }, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        let factory;
        window.__transcriptMessages = [];
        Object.defineProperty(window, 'acquireVsCodeApi', {
          configurable: true, get: () => factory,
          set: original => { factory = () => {
            const bridge = original(), post = bridge.postMessage;
            return { ...bridge, postMessage: message => {
              window.__transcriptMessages.push(message);
              if (message.type !== 'sendMessage') post(message);
            } };
          }; },
        });
      });
      await page.goto(`${origin}/sidebar?theme=${theme}`);
      await page.waitForFunction(() => document.querySelector('.model-select')?.textContent.includes('Example model'));
      const convId = `transcript-${theme}-${width}`;
      await load(page, convId, turns, true);
      assert.equal(await page.locator('.chat-turn-group').count(), 4);
      const initial = await snapshot(page);
      assertPinned(initial, 3, `${theme}/${width} loaded tail`);
      assert(initial.scrollHeight - initial.scrollTop - initial.clientHeight < 3, 'Loaded transcript follows the tail');

      await send(page, { type: 'agentEvent', convId, event: { type: 'text-delta', text: `\n\n${answer('Streaming continuation', 12)}` } });
      const grown = await snapshot(page);
      assert(grown.scrollHeight > initial.scrollHeight + 200, 'Fixture must grow beyond one viewport during streaming');
      assertPinned(grown, 3, `${theme}/${width} streaming tail`);
      assert(grown.scrollHeight - grown.scrollTop - grown.clientHeight < 3, 'Streaming follows the tail when the user has not scrolled away');
      await page.screenshot({ path: path.join(output, `transcript-${theme}-${width}-tail.png`) });

      await page.locator('.chat-turn-group').last().locator('.msg.user > .bubble').focus();
      await page.keyboard.press('PageUp');
      await page.waitForTimeout(200);
      const bubbleReading = await snapshot(page);
      assert(bubbleReading.scrollTop < grown.scrollTop - 20, 'PageUp scrolls history while the user bubble has focus');
      await send(page, { type: 'agentEvent', convId, event: { type: 'text-delta', text: `\n\n${answer('Bubble focused continuation', 4)}` } });
      assert(Math.abs((await snapshot(page)).scrollTop - bubbleReading.scrollTop) <= 1, 'Streaming respects PageUp from a focused user bubble');
      await page.evaluate(() => document.activeElement?.blur());
      await page.getByRole('button', { name: 'Scroll to bottom', exact: true }).click();
      await page.waitForTimeout(500);
      const beforeKeyboard = await snapshot(page);
      await page.locator('.chat-messages').focus();
      await page.keyboard.press('PageUp');
      await page.waitForTimeout(200);
      const keyboardReading = await snapshot(page);
      assert(keyboardReading.scrollTop < beforeKeyboard.scrollTop - 20, 'PageUp reads earlier response text');
      await send(page, { type: 'agentEvent', convId, event: { type: 'text-delta', text: `\n\n${answer('Keyboard reading continuation', 4)}` } });
      assert(Math.abs((await snapshot(page)).scrollTop - keyboardReading.scrollTop) <= 1, 'Streaming respects keyboard history navigation');
      await page.evaluate(() => document.activeElement?.blur());

      const handoff = [];
      for (const index of [3, 2, 1, 0]) {
        await readGroup(page, index);
        const state = await snapshot(page);
        assertPinned(state, index, `${theme}/${width} history group ${index + 1}`);
        handoff.push({ index, scrollTop: state.scrollTop, top: state.users[index].top });
      }
      await readGroup(page, 1);
      const reading = await snapshot(page);
      await send(page, { type: 'agentEvent', convId, event: { type: 'text-delta', text: `\n\n${answer('Background continuation', 8)}` } });
      const afterGrowth = await snapshot(page);
      assert(Math.abs(afterGrowth.scrollTop - reading.scrollTop) <= 1, 'Streaming must not pull the reader away from history');
      assertPinned(afterGrowth, 1, `${theme}/${width} history remains anchored`);
      await page.screenshot({ path: path.join(output, `transcript-${theme}-${width}-history.png`) });

      await page.getByRole('button', { name: 'Scroll to bottom', exact: true }).click();
      await page.waitForTimeout(500);
      const returned = await snapshot(page);
      assertPinned(returned, 3, `${theme}/${width} return to latest`);
      assert(returned.scrollHeight - returned.scrollTop - returned.clientHeight < 3, `Returning to the latest response reaches the tail: ${JSON.stringify(returned)}`);
      const userActions = await checkActions(page, page.locator('.chat-turn-group').last().locator('.msg.user'), `${theme}/${width} user`);
      await page.locator('.chat-turn-group').last().locator('.msg.user > .bubble').hover();
      await page.screenshot({ path: path.join(output, `transcript-${theme}-${width}-user-actions.png`) });
      // The assistant action row is at the response end; hovering there avoids
      // scrolling the entire tall bubble back toward its first paragraph.
      const assistant = page.locator('.chat-turn-group').last().locator('.msg.assistant').last();
      await page.evaluate(() => document.activeElement?.blur()); await page.mouse.move(0, 0);
      const assistantActions = assistant.locator('.message-actions');
      assert.equal(await assistantActions.evaluate(element => Number(getComputedStyle(element).opacity)), 0, 'Assistant actions stay hidden at rest');
      const actionBox = await assistantActions.boundingBox();
      await page.mouse.move(actionBox.x + actionBox.width / 2, actionBox.y + actionBox.height / 2);
      assert.equal(await assistantActions.evaluate(element => Number(getComputedStyle(element).opacity)), 1, `Assistant hover reveals actions: ${JSON.stringify({ actionBox, state: await snapshot(page), point: await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.outerHTML.slice(0, 300), { x: actionBox.x + actionBox.width / 2, y: actionBox.y + actionBox.height / 2 }) })}`);
      await page.mouse.move(0, 0);
      await assistantActions.getByRole('button', { name: 'Copy message', exact: true }).focus();
      assert.equal(await assistantActions.evaluate(element => Number(getComputedStyle(element).opacity)), 1, 'Assistant keyboard focus reveals actions');
      await page.keyboard.press('Enter');
      assert((await page.evaluate(() => navigator.clipboard.readText())).includes('Response 4'), 'Assistant copy contains the response text');
      await page.screenshot({ path: path.join(output, `transcript-${theme}-${width}-assistant-actions.png`) });
      await page.evaluate(() => document.activeElement?.blur());

      await send(page, { type: 'agentEvent', convId, event: { type: 'run-status', status: 'finished' } });
      await readGroup(page, 0);
      const editor = page.locator('.bottom-stack .composer .editor');
      await editor.fill('A new follow-up request.'); await editor.press('Enter');
      await page.waitForTimeout(500);
      assert.equal(await page.locator('.chat-turn-group').count(), 5, 'Sending creates a new exchange');
      const sent = await snapshot(page);
      assertPinned(sent, 4, `${theme}/${width} newly sent request`);
      assert(await page.evaluate(() => window.__transcriptMessages.some(message => message.type === 'sendMessage' && message.text === 'A new follow-up request.')), 'Sending reaches the host bridge');

      const longUser = Array.from({ length: 45 }, (_, index) => `Requirement ${index + 1}: ${paragraph}`).join('\n');
      await load(page, `${convId}-long`, [{ role: 'user', text: longUser }, { role: 'assistant', blocks: [{ kind: 'text', text: answer('Long prompt response') }] }]);
      const long = await snapshot(page);
      assertPinned(long, 0, `${theme}/${width} long first request`);
      assert(long.users[0].bubbleHeight <= 151, 'A long sticky prompt stays bounded');
      await page.screenshot({ path: path.join(output, `transcript-${theme}-${width}-long-prompt.png`) });
      await load(page, `${convId}-short`, [{ role: 'user', text: 'Hello' }, { role: 'assistant', blocks: [{ kind: 'text', text: 'Hello. How can I help with the project?' }] }]);
      const short = await snapshot(page);
      assert(short.users[0].top >= short.top && short.users[0].bottom < short.bottom, 'A short conversation keeps its prompt visible');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.querySelector('.chat-messages').scrollWidth > document.querySelector('.chat-messages').clientWidth), false, 'No horizontal overflow');
      assert.deepEqual(errors, [], 'No browser errors');
      results.push({ theme, width, stickyLatest: 'passed', streaming: 'passed', historyPreservation: 'passed', keyboardHistory: 'passed', handoff, userActions, assistantActions: 'passed', send: 'passed', longPrompt: 'passed', shortPrompt: 'passed', errors });
      await context.close();
    }
    await fs.writeFile(path.join(output, 'transcript-ui-results.json'), JSON.stringify(results, null, 2));
    console.log(`Passed ${results.length} transcript theme/width combinations. Screenshots: ${output}`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
