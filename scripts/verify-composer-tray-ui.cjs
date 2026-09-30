/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// Check the production webview using an isolated local host bridge.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const changes = Array.from({ length: 15 }, (_, index) => ({
  path: index ? `src/components/ProjectSection${index}.tsx` : 'src/components/ProjectList.tsx',
  existedBefore: index !== 14,
  added: index === 14 ? 30 : 25,
  removed: index === 14 ? 8 : 6,
}));

async function send(page, data) {
  await page.evaluate(data => window.dispatchEvent(new MessageEvent('message', { data })), data);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function fixture(page, { queued = 0, interrupted = false, files = true, longText = false } = {}) {
  const convId = `tray-${queued}-${interrupted}-${files}-${longText}`;
  await send(page, {
    type: 'initialState', activeId: convId, mode: 'agent', selectedModel: 'preview-model',
    turns: [
      { role: 'user', text: 'Add search to the project list.' },
      { role: 'assistant', blocks: [{ kind: 'text', text: 'The search field is in place. I am checking the keyboard navigation and the remaining project views.' }] },
    ],
    personas: [], activePersonaId: 'default', hasProviders: true,
    runningConvIds: interrupted ? [] : [convId],
    workspaceState: { openTabs: [convId], drafts: {} },
    uiPrefs: { motion: 'reduced', chatTextSize: 'default', submitWithCtrlEnter: false, maxTabCount: 0, completionSound: false, perTabDrafts: false },
  });
  const queue = interrupted
    ? [{ id: 'interrupted', text: 'Finish the remaining checks.', status: 'interrupted', createdAt: 1 }]
    : Array.from({ length: queued }, (_, index) => ({
      id: `queued-${index + 1}`,
      text: longText ? 'Add accessible keyboard navigation and verify the very long nested component identifier '.repeat(5) : index ? 'message 2' : 'hello',
      status: 'queued', createdAt: index + 1,
    }));
  await send(page, { type: 'workflowState', queues: { [convId]: queue }, goals: {} });
  await send(page, { type: 'pendingChanges', changes: files ? changes : [] });
  await page.locator('.composer').waitFor();
  return convId;
}

async function geometry(page, label, rowCount, files = true) {
  const result = await page.evaluate(() => {
    const box = element => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const tray = document.querySelector('.composer-tray');
    const composer = document.querySelector('.bottom-stack .composer');
    return {
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      chatOverflow: document.querySelector('.chat-messages').scrollWidth - document.querySelector('.chat-messages').clientWidth,
      width: innerWidth, height: innerHeight,
      tray: box(tray), composer: box(composer),
      summary: box(document.querySelector('.review-head')),
      rows: [...document.querySelectorAll('.queue-item')].map(box),
      buttons: [...document.querySelectorAll('.composer-tray button')].filter(button => {
        const rect = button.getBoundingClientRect();
        return rect.width && rect.height;
      }).map(button => ({ label: button.getAttribute('aria-label') || button.textContent, ...box(button) })),
    };
  });
  assert(result.documentOverflow <= 1 && result.chatOverflow <= 1, `${label}: no horizontal overflow ${JSON.stringify(result)}`);
  assert.equal(result.rows.length, rowCount, `${label}: correct number of queue rows`);
  assert.equal(Boolean(result.summary), files, `${label}: changed-file summary visibility`);
  if (files || rowCount) {
    assert(result.tray, `${label}: tray is rendered`);
    assert(result.tray.left > result.composer.left && result.tray.right < result.composer.right, `${label}: tray is inset from composer edges`);
    assert(result.tray.bottom >= result.composer.top - 1 && result.tray.bottom <= result.composer.top + 24, `${label}: tray joins composer without an empty gap`);
    const lastRow = result.rows.at(-1) || result.summary;
    assert(lastRow.bottom <= result.composer.top + 1 && result.composer.top - lastRow.bottom <= 6, `${label}: last row sits directly above composer`);
    if (result.summary && result.rows.length) assert(Math.abs(result.rows[0].top - result.summary.bottom) <= 2, `${label}: summary and queued messages form one joined panel`);
    for (let index = 1; index < result.rows.length; index++) assert(Math.abs(result.rows[index].top - result.rows[index - 1].bottom) <= 2, `${label}: queue rows have no external gap`);
    assert(result.tray.top >= 0, `${label}: tray remains inside viewport`);
    for (const button of result.buttons) assert(button.left >= 0 && button.right <= result.width + 1, `${label}: ${button.label} remains visible`);
  } else assert.equal(result.tray, null, `${label}: empty tray is absent`);
  return result;
}

async function expectBridge(page, expected, label) {
  assert(await page.evaluate(expected => window.__trayMessages.some(message => Object.entries(expected).every(([key, value]) => message[key] === value)), expected), label);
}

async function reviewChecks(page, label) {
  const summary = page.locator('.review-head');
  assert.match(await summary.innerText(), /15 files changed/, `${label}: readable changed-file count`);
  assert.match(await summary.innerText(), /\+380/, `${label}: aggregate additions`);
  assert.match(await summary.innerText(), /-92/, `${label}: aggregate deletions`);
  assert.equal(await page.locator('.review-list').count(), 0, `${label}: file list starts collapsed`);
  assert.equal(await summary.getByRole('button', { name: 'Undo All', exact: true }).count(), 1, `${label}: Undo All is available while collapsed`);
  assert.equal(await summary.getByRole('button', { name: 'Keep All', exact: true }).count(), 1, `${label}: Keep All is available while collapsed`);
  await summary.getByRole('button', { name: 'Keep All', exact: true }).click();
  assert.equal(await page.locator('.review-list').count(), 0, `${label}: bulk action does not expand the panel`);
  const review = page.getByRole('button', { name: 'Changed files', exact: true });
  await summary.click({ position: { x: 3, y: 16 } });
  assert.equal(await review.getAttribute('aria-expanded'), 'true', `${label}: review exposes expanded state`);
  await page.locator('.review-list').waitFor();
  assert.equal(await page.locator('.review-item').count(), 15, `${label}: all files can be reviewed`);
  await page.locator('.rv-file').first().click();
  await expectBridge(page, { type: 'diffChange', path: changes[0].path }, `${label}: file opens the existing diff action`);
  await page.getByRole('button', { name: 'Undo All', exact: true }).click();
  await expectBridge(page, { type: 'rejectAllChanges' }, `${label}: Undo All reaches host`);
  await page.getByRole('button', { name: 'Keep All', exact: true }).click();
  await expectBridge(page, { type: 'acceptAllChanges' }, `${label}: Keep All reaches host`);
  assert.equal(await review.getAttribute('aria-expanded'), 'true', `${label}: bulk actions do not collapse the panel`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(overflow <= 1, `${label}: expanded review fits viewport`);
  await review.focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.review-list').count(), 0, `${label}: review collapses`);
}

async function queueChecks(page, convId, label) {
  const rows = page.locator('.queue-item');
  const first = rows.nth(0);
  const second = rows.nth(1);
  await first.getByRole('button', { name: 'Steer current run with queued message', exact: true }).click();
  await expectBridge(page, { type: 'queueAction', convId, id: 'queued-1', action: 'steer' }, `${label}: Steer targets selected queued message`);
  assert.equal(await first.getAttribute('aria-busy'), 'true', `${label}: steering stays visible while pending`);
  assert.equal(await first.locator('.queue-steering .spinner').count(), 1, `${label}: pending delivery shows a spinner`);
  await send(page, { type: 'queueSteeringResult', convId, requestId: 'queued-1', accepted: false });
  await first.getByRole('button', { name: 'Remove queued message', exact: true }).click();
  await expectBridge(page, { type: 'queueAction', convId, id: 'queued-1', action: 'remove' }, `${label}: Remove targets selected queued message`);
  const more = second.getByRole('button', { name: 'More queued message actions', exact: true });
  await more.click();
  const menu = page.locator('.queue-menu[role="menu"]');
  await menu.waitFor();
  const menuBox = await menu.boundingBox();
  const viewport = page.viewportSize();
  assert(menuBox.x >= 0 && menuBox.x + menuBox.width <= viewport.width + 1 && menuBox.y >= 0 && menuBox.y + menuBox.height <= viewport.height + 1, `${label}: more menu stays inside viewport`);
  assert(await menu.evaluate(element => element.contains(document.activeElement)), `${label}: opening menu focuses an item`);
  await page.keyboard.press('End');
  assert.match(await page.evaluate(() => document.activeElement.textContent), /Move earlier/, `${label}: End reaches Move earlier`);
  await page.keyboard.press('Home');
  assert.match(await page.evaluate(() => document.activeElement.textContent), /Send now/, `${label}: Home reaches Send now`);
  await page.keyboard.press('ArrowDown');
  assert.match(await page.evaluate(() => document.activeElement.textContent), /Edit message/, `${label}: ArrowDown moves to Edit`);
  await page.keyboard.press('Escape');
  assert.equal(await menu.count(), 0, `${label}: Escape closes menu`);
  assert(await more.evaluate(element => document.activeElement === element), `${label}: Escape restores trigger focus`);
  for (const [name, action] of [['Send queued request now', 'run'], ['Edit message', 'edit'], ['Move earlier', 'up']]) {
    await more.click();
    await page.locator('.queue-menu').getByRole('menuitem', { name, exact: true }).click();
    await expectBridge(page, { type: 'queueAction', convId, id: 'queued-2', action }, `${label}: ${name} reaches host`);
    assert.equal(await menu.count(), 0, `${label}: ${name} closes menu`);
  }
  await first.getByRole('button', { name: 'More queued message actions', exact: true }).click();
  const earlier = page.locator('.queue-menu').getByRole('menuitem', { name: 'Move earlier', exact: true });
  if (await earlier.count()) assert(await earlier.isDisabled(), `${label}: first message cannot move earlier`);
  await page.keyboard.press('Escape');
}

async function transitionChecks(page, output, theme) {
  const convId = await fixture(page, { queued: 2 });
  await send(page, { type: 'configState', hasProviders: true, uiPrefs: { motion: 'full' } });
  const summary = page.getByRole('button', { name: 'Changed files', exact: true });
  const sample = selector => page.evaluate(async selector => {
    const frames = [];
    const until = performance.now() + 360;
    while (performance.now() < until) {
      await new Promise(requestAnimationFrame);
      const element = document.querySelector(selector);
      frames.push(element ? { height: element.getBoundingClientRect().height, opacity: getComputedStyle(element).opacity, transform: getComputedStyle(element).transform } : { height: 0 });
    }
    return frames;
  }, selector);
  await summary.evaluate(element => element.click());
  const opening = await sample('.animated-disclosure');
  assert(new Set(opening.map(frame => frame.height.toFixed(1))).size > 3, 'panel height animates through intermediate values on expansion');
  assert(opening.at(-1).height > 30, 'expanded files remain visible');
  await summary.evaluate(element => element.click());
  assert(await page.locator('.animated-disclosure').evaluate(element => element.inert), 'collapsing file actions become inert immediately');
  const closing = await sample('.animated-disclosure');
  assert(new Set(closing.map(frame => frame.height.toFixed(1))).size > 3 && closing.at(-1).height === 0, `panel animates closed before removal: ${JSON.stringify(closing)}`);
  await send(page, { type: 'pendingChanges', changes: [...changes, { path: 'extra.ts', existedBefore: false, added: 4, removed: 0 }] });
  const text = await sample('.review-title > .t-text-swap');
  assert(text.some(frame => Number(frame.opacity) > 0 && Number(frame.opacity) < 1), 'file count text transitions through intermediate opacity');
  assert.match(await summary.innerText(), /16 files changed/, 'file count settles to the current total');

  const first = { id: 'queued-1', text: 'hello', status: 'queued', createdAt: 1 };
  const second = { id: 'queued-2', text: 'message 2', status: 'queued', createdAt: 2 };
  await page.locator('.queue-item').first().getByRole('button', { name: 'Steer current run with queued message' }).click();
  await send(page, { type: 'workflowState', queues: { [convId]: [second] }, steeringQueues: { [convId]: [first] }, goals: {} });
  await send(page, { type: 'queueSteeringResult', convId, requestId: first.id, accepted: true });
  assert.equal(await page.locator('.queue-item').count(), 2, 'accepted steering remains visible until consumed');
  const spinner = await sample('.queue-steering .spinner');
  assert(new Set(spinner.map(frame => frame.transform)).size > 3, 'pending steering spinner actually rotates');
  await page.screenshot({ path: path.join(output, `composer-tray-${theme}-steering.png`) });
  await send(page, { type: 'agentEvent', convId, event: { type: 'user-steering', text: first.text, requestId: first.id } });
  assert.equal(await page.locator('.queue-item').count(), 1, 'consumed steering leaves the tray');
  assert.match(await page.locator('.msg.user').last().innerText(), /hello/, 'the steered message is visible in the conversation');
  return { opening, closing, text, spinner };
}

async function main() {
  const origin = process.env.OPENCURSOR_PREVIEW_ORIGIN || 'http://127.0.0.1:4178';
  const output = path.resolve(__dirname, '../dist/visual-qa');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.OPENCURSOR_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const results = [];
  try {
    for (const theme of ['light', 'dark']) for (const width of process.env.OPENCURSOR_TRAY_MOTION_ONLY === '1' ? [375] : [280, 375, 540, 900]) {
      const context = await browser.newContext({ viewport: { width, height: 850 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        let factory;
        window.__trayMessages = [];
        Object.defineProperty(window, 'acquireVsCodeApi', {
          configurable: true, get: () => factory,
          set: original => { factory = () => {
            const bridge = original();
            return { ...bridge, postMessage: message => {
              window.__trayMessages.push(message);
              if (message.type === 'ready' || message.type === 'getFileIcon') bridge.postMessage(message);
            } };
          }; },
        });
      });
      await page.goto(`${origin}/sidebar?theme=${theme}`);
      await page.waitForFunction(() => document.querySelector('.model-select')?.textContent.includes('Example model'));
      const label = `${theme}/${width}`;
      for (const queued of [0, 1, 2]) {
        const convId = await fixture(page, { queued });
        const bounds = await geometry(page, `${label}/${queued}`, queued);
        await page.screenshot({ path: path.join(output, `composer-tray-${theme}-${width}-${queued}.png`) });
        if (queued === 2) {
          await reviewChecks(page, label);
          await queueChecks(page, convId, label);
        }
        results.push({ theme, width, queued, bounds });
      }
      const interruptedId = await fixture(page, { interrupted: true });
      const interrupted = page.locator('.queue-item');
      assert.match(await interrupted.innerText(), /Interrupted/, `${label}: interrupted request remains distinct`);
      assert.equal(await interrupted.getByRole('button', { name: 'Steer current run with queued message' }).count(), 0, `${label}: interrupted request has no Steer action`);
      await interrupted.getByRole('button', { name: 'Resume interrupted request', exact: true }).click();
      await expectBridge(page, { type: 'queueAction', convId: interruptedId, id: 'interrupted', action: 'run' }, `${label}: Resume reaches host`);
      await geometry(page, `${label}/interrupted`, 1);
      await page.screenshot({ path: path.join(output, `composer-tray-${theme}-${width}-interrupted.png`) });
      await fixture(page, { queued: 2, files: false, longText: true });
      await geometry(page, `${label}/long-queue-only`, 2, false);
      await fixture(page, { files: false });
      await geometry(page, `${label}/empty`, 0, false);
      if (width === 375) {
        const motion = await transitionChecks(page, output, theme);
        await fs.writeFile(path.join(output, `composer-tray-${theme}-transitions.json`), JSON.stringify(motion, null, 2));
      }
      if (theme === 'light' && width === 375) {
        await page.setViewportSize({ width: 375, height: 500 });
        await fixture(page, { queued: 10 });
        await page.getByRole('button', { name: 'Changed files', exact: true }).click();
        const compact = await page.evaluate(() => {
          const rect = selector => {
            const element = document.querySelector(selector);
            const bounds = element.getBoundingClientRect();
            return { top: bounds.top, bottom: bounds.bottom, height: bounds.height, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight };
          };
          return { header: rect('.chat-header'), tray: rect('.composer-tray'), composer: rect('.composer'), footer: rect('.composer-footer'), list: rect('.review-list'), queue: rect('.queue-bar'), width: document.documentElement.scrollWidth };
        });
        await page.screenshot({ path: path.join(output, 'composer-tray-light-375-short-expanded.png') });
        assert(compact.width <= 376, `short viewport: no horizontal overflow ${JSON.stringify(compact)}`);
        assert(compact.tray.top >= compact.header.bottom - 1, `short viewport: expanded tray stays below header ${JSON.stringify(compact)}`);
        assert(compact.composer.top >= compact.header.bottom && compact.composer.bottom <= 500 && compact.footer.bottom <= 500, `short viewport: composer and mode control remain entirely visible ${JSON.stringify(compact)}`);
        assert(compact.list.scrollHeight > compact.list.clientHeight && compact.queue.scrollHeight > compact.queue.clientHeight, 'short viewport: long review and queue lists scroll independently');
        results.push({ theme, width, height: 500, queued: 10, expanded: true, bounds: compact });
      }
      assert.deepEqual(errors, [], `${label}: no browser errors`);
      console.log(`Passed composer tray ${label}`);
      await context.close();
    }
  } finally {
    await browser.close();
    await fs.writeFile(path.join(output, 'composer-tray-results.json'), JSON.stringify(results, null, 2));
  }
  console.log(`Composer tray passed ${results.length} theme/width/queue combinations; review, queue, interrupted and empty states verified.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
