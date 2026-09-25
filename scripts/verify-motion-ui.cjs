/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// Exercise production bundles with the local preview's isolated host bridge.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function send(page, data) {
  await page.evaluate(data => window.dispatchEvent(new MessageEvent('message', { data })), data);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

function uiPrefs(motion) {
  return { motion, chatTextSize: 'default', submitWithCtrlEnter: false, maxTabCount: 0, completionSound: false, perTabDrafts: false };
}

async function load(page, id, turns, running = false, motion = 'full') {
  await send(page, {
    type: 'initialState', activeId: id, mode: 'agent', selectedModel: 'preview-model', turns,
    personas: [], activePersonaId: 'default', hasProviders: true,
    runningConvIds: running ? [id] : [], workspaceState: { openTabs: [id], drafts: {} },
    uiPrefs: uiPrefs(motion),
  });
  await page.waitForTimeout(300);
}

async function expectStatus(page, text, label) {
  await page.waitForFunction(text => {
    const lines = [...document.querySelectorAll('.phase-row .t-think-text')];
    return lines.some(line => !line.classList.contains('is-exit') && line.dataset.text === text);
  }, text);
  await page.waitForTimeout(280);
  const status = await page.locator('.phase-row .t-think').evaluate(element => ({
    role: element.getAttribute('role'),
    sizer: element.querySelector('.t-think-sizer')?.textContent,
    lines: [...element.querySelectorAll('.t-think-text')].map(line => ({
      text: line.textContent, dataText: line.dataset.text, classes: line.className,
      opacity: getComputedStyle(line).opacity,
    })),
  }));
  assert.equal(status.role, 'status', `${label}: live state is announced accessibly`);
  assert(status.sizer, `${label}: hidden sizer reserves the label's width`);
  assert.equal(status.lines.length, 1, `${label}: outgoing state is removed after its exit`);
  assert.equal(status.lines[0].text, text, `${label}: current state is rendered`);
  assert.equal(status.lines[0].dataText, text, `${label}: shimmer copy matches state text`);
  assert.equal(status.lines[0].opacity, '1', `${label}: current state is fully visible`);
  assert(!/is-exit|is-enter-start/.test(status.lines[0].classes), `${label}: no stale transition class remains`);
  return status;
}

async function chatEntryChecks(page, convId, { motion, reduced }, label) {
  await load(page, convId, [{ role: 'user', text: 'Check appearing content.' }], true, motion);
  const before = await frame(page);
  async function sample(event, selector, shouldEnter = true) {
    const result = await page.evaluate(async ({ event, selector, convId }) => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'agentEvent', convId, event } }));
      const frames = [], start = performance.now();
      let target;
      while (performance.now() - start < 320) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        target = [...document.querySelectorAll(selector)].at(-1);
        if (target) frames.push({ opacity: Number(getComputedStyle(target).opacity), translate: getComputedStyle(target).translate });
      }
      return { frames, running: target?.getAnimations().filter(animation => animation.playState === 'running').length };
    }, { event, selector, convId });
    assert(result.frames.length > 0, `${label}: ${selector} appears`);
    assert.equal(result.frames.at(-1).opacity, 1, `${label}: ${selector} finishes fully visible`);
    assert.equal(result.running, 0, `${label}: ${selector} has no persistent entrance animation`);
    if (reduced || !shouldEnter) assert(result.frames.every(frame => frame.opacity === 1), `${label}: ${selector} stays stable without an entrance`);
    else {
      assert(result.frames.some(frame => frame.opacity > 0 && frame.opacity < 1), `${label}: ${selector} fades through intermediate frames`);
      assert(new Set(result.frames.map(frame => frame.translate)).size > 2, `${label}: ${selector} moves smoothly into place`);
    }
    return result;
  }
  await sample({ type: 'text-delta', text: 'The first paragraph is arriving.' }, '.block-group > .markdown-content');
  await sample({ type: 'text-delta', text: ' More tokens extend it.\n\nA second paragraph follows.' }, '.block-group > .markdown-content', false);
  await sample({ type: 'thinking-delta', text: 'Considering the next operation.' }, '.thinking-card');
  await sample({ type: 'tool-call-started', callId: 'entry-shell', name: 'Shell', input: { command: 'npm test' } }, '.shell-card');
  await sample({ type: 'tool-call-progress', callId: 'entry-shell', text: 'Checking the project...' }, '.shell-card', false);
  await sample({ type: 'tool-call-started', callId: 'entry-read', name: 'Read', input: { path: 'src/main.ts' } }, '.explore-section');
  await sample({ type: 'tool-call-started', callId: 'entry-question', name: 'AskQuestion', input: { questions: [{ question: 'Which option?', options: ['One', 'Two'] }] } }, '.question-card');
  await sample({ type: 'tool-call-started', callId: 'entry-task', name: 'Task', input: { description: 'Review changes', run_in_background: true } }, '.subagent-card');
  await sample({ type: 'tool-call-started', callId: 'entry-plan', name: 'WritePlan', input: { title: 'Implementation plan', content: 'Inspect and validate the changes.' } }, '.plan-card');
  await sample({ type: 'compaction', status: 'running' }, '.compaction-card');
  sameFrame(before, await frame(page), `${label}: entrances preserve composer and scrollport geometry`);
  await sample({ type: 'error', message: 'Example failure for presentation testing.' }, '.error-card');
  assert(await page.locator('.chat-turn-group > .msg.user').evaluate(element => getComputedStyle(element).translate === 'none' && getComputedStyle(element).transform === 'none'), `${label}: pinned prompt stays stationary`);
  const replay = await page.evaluate(async () => {
    const chat = document.querySelector('.chat-messages');
    chat.scrollTop = 0;
    await new Promise(resolve => requestAnimationFrame(resolve));
    chat.scrollTop = chat.scrollHeight;
    await new Promise(resolve => requestAnimationFrame(resolve));
    return chat.getAnimations({ subtree: true }).filter(animation => animation.animationName === 'chat-content-in').length;
  });
  assert.equal(replay, 0, `${label}: scrolling does not replay completed entrances`);
}

async function statusChecks(page, convId, { reduced }, label) {
  const emit = event => send(page, { type: 'agentEvent', convId, event });
  await emit({ type: 'thinking-delta', text: 'I will inspect the requested change.' });
  const thinking = await expectStatus(page, 'Thinking', label);
  const before = await frame(page);
  const sampled = await page.locator('.phase-row .activity-status').evaluate(async element => {
    const text = element.querySelector('.t-think-text');
    const matrix = element.querySelector('.t-matrix');
    const read = () => ({
      shimmerPosition: getComputedStyle(text, '::before').backgroundPosition,
      shimmerDisplay: getComputedStyle(text, '::before').display,
      matrixColors: [...matrix.querySelectorAll('i')].map(dot => getComputedStyle(dot).backgroundColor),
      matrixAnimations: [...matrix.querySelectorAll('i')].reduce((count, dot) => count + dot.getAnimations().length, 0),
      rect: JSON.stringify(element.getBoundingClientRect().toJSON()),
    });
    const first = read();
    await new Promise(resolve => setTimeout(resolve, 230));
    return { first, second: read(), dots: matrix.children.length, variant: matrix.dataset.variant };
  });
  assert.equal(sampled.dots, 16, `${label}: matrix builds all sixteen dots`);
  assert.equal(sampled.variant, 'scan', `${label}: live state uses scan matrix`);
  assert.equal(sampled.first.rect, sampled.second.rect, `${label}: status animation preserves its layout`);
  if (reduced) {
    assert.equal(sampled.second.shimmerDisplay, 'none', `${label}: reduced motion hides shimmering duplicate`);
    assert.deepEqual(sampled.first.matrixColors, sampled.second.matrixColors, `${label}: matrix stays static in reduced motion`);
    assert.equal(sampled.second.matrixAnimations, 0, `${label}: reduced matrix has no looping animation`);
  } else {
    assert.notEqual(sampled.first.shimmerPosition, sampled.second.shimmerPosition, `${label}: thinking shimmer visibly travels over glyphs`);
    assert.notDeepEqual(sampled.first.matrixColors, sampled.second.matrixColors, `${label}: matrix dots visibly pulse over time`);
    assert.equal(sampled.second.matrixAnimations, 16, `${label}: every scan dot participates in the cycle`);
  }

  await emit({ type: 'text-delta', text: ' I found the component to update.' });
  const swap = await page.locator('.phase-row .t-think').evaluate(element => ({
    outgoing: element.querySelectorAll('.is-exit').length,
    animationCount: element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length,
    lines: [...element.querySelectorAll('.t-think-text')].map(line => ({ text: line.textContent, dataText: line.dataset.text })),
  }));
  assert(swap.lines.every(line => line.text === line.dataText), `${label}: both animated copies keep their shimmer text synchronized`);
  if (reduced) assert.equal(swap.outgoing, 0, `${label}: reduced motion swaps text immediately`);
  else {
    assert.equal(swap.outgoing, 1, `${label}: outgoing status stays mounted while it exits`);
    assert(swap.animationCount > 0, `${label}: status text uses a live transition`);
  }
  const generating = await expectStatus(page, 'Generating', label);
  sameFrame(before, await frame(page), `${label} changing live states`);
  await emit({ type: 'tool-call-started', callId: 'motion-shell', name: 'Shell', input: { command: 'npm test' } });
  await page.locator('.spinner-stop .spinner').first().waitFor();
  const toolMotion = await page.locator('.spinner-stop .spinner').first().evaluate(async element => {
    const first = getComputedStyle(element).transform;
    await new Promise(resolve => setTimeout(resolve, 160));
    return { first, second: getComputedStyle(element).transform, animations: element.getAnimations().length };
  });
  if (reduced) {
    assert.equal(toolMotion.first, toolMotion.second, `${label}: tool progress ring stays static in reduced motion`);
    assert.equal(toolMotion.animations, 0, `${label}: reduced tool progress has no animation`);
  } else {
    assert.notEqual(toolMotion.first, toolMotion.second, `${label}: tool progress ring visibly rotates`);
    assert(toolMotion.animations > 0, `${label}: tool progress has a live animation`);
  }
  const toolStatus = await page.locator('.phase-row .t-think-text:not(.is-exit)').getAttribute('data-text');
  assert(toolStatus && toolStatus !== 'Generating' && toolStatus !== 'Thinking', `${label}: executing tool gets its own accurate status`);
  await page.locator('.spinner-stop').first().click();
  assert(await page.evaluate(() => window.__motionMessages.some(message => message.type === 'cancelSubagent' && message.callId === 'motion-shell')), `${label}: animated tool stop still sends cancellation immediately`);
  await emit({ type: 'tool-call-completed', callId: 'motion-shell', name: 'Shell', status: 'completed', result: 'All checks passed' });
  await page.waitForTimeout(35);
  await page.evaluate(id => {
    const emit = event => window.dispatchEvent(new MessageEvent('message', { data: { type: 'agentEvent', convId: id, event } }));
    emit({ type: 'thinking-delta', text: 'Reviewing the results.' });
    emit({ type: 'retry', attempt: 1, max: 3 });
    emit({ type: 'text-delta', text: ' The change is ready.' });
  }, convId);
  const rapid = await expectStatus(page, 'Generating', `${label} rapid events`);
  const longStatus = 'Waiting for output from ' + 'project/nested-module/'.repeat(20) + 'integration-tests';
  await emit({ type: 'shell-notify', message: longStatus });
  await expectStatus(page, longStatus, `${label} long status`);
  const overflow = await page.evaluate(() => {
    const chat = document.querySelector('.chat-messages');
    return { document: document.documentElement.scrollWidth - document.documentElement.clientWidth, chat: chat.scrollWidth - chat.clientWidth };
  });
  assert(overflow.document <= 1 && overflow.chat <= 1, `${label}: long activity state must not cause horizontal scrolling (${JSON.stringify(overflow)})`);
  await emit({ type: 'thinking-delta', text: 'Checking the final state.' });
  const finalThinking = await expectStatus(page, 'Thinking', `${label} final state`);
  await page.screenshot({ path: path.resolve(__dirname, '../dist/visual-qa', `activity-${label.replaceAll('/', '-')}.png`) });
  return { thinking, sampled, swap, generating, toolStatus, toolMotion, rapid, overflow, finalThinking };
}

async function openAndInspect(trigger, selector) {
  return trigger.evaluate(async (element, selector) => {
    element.focus({ preventScroll: true });
    element.click();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const popup = document.querySelector(selector);
    if (!popup) return null;
    const style = getComputedStyle(popup);
    return {
      state: popup.dataset.state,
      opacity: Number(style.opacity),
      animations: popup.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length,
      rect: { x: popup.getBoundingClientRect().x, right: popup.getBoundingClientRect().right },
    };
  }, selector);
}

async function escapeAndInspect(page, selector) {
  return page.evaluate(async selector => {
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await new Promise(resolve => requestAnimationFrame(resolve));
    const popup = document.querySelector(selector);
    if (!popup) return null;
    const box = popup.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      state: popup.dataset.state, inert: popup.inert,
      hidden: popup.getAttribute('aria-hidden'), pointer: getComputedStyle(popup).pointerEvents,
      interceptsPointer: !!hit && popup.contains(hit),
      activeInside: popup.contains(document.activeElement),
      animations: popup.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length,
      visibleCalendarDays: Array.from(popup.querySelectorAll('.oc-date-day')).filter(day => getComputedStyle(day).visibility !== 'hidden').length,
    };
  }, selector);
}

function verifyEntry(entry, reduced, width, label) {
  assert(entry, `${label}: popup opened`);
  assert(entry.rect.x >= -1 && entry.rect.right <= width + 1, `${label}: popup stays inside viewport`);
  if (reduced) assert.equal(entry.animations, 0, `${label}: reduced motion suppresses popup animation`);
  else assert(entry.animations > 0, `${label}: popup animates on entry`);
}

function verifyExit(exit, reduced, label) {
  if (reduced) { assert.equal(exit, null, `${label}: reduced motion removes popup immediately`); return; }
  assert(exit, `${label}: popup is retained for its exit`);
  assert.equal(exit.state, 'closing', `${label}: popup enters closing state`);
  assert.equal(exit.inert, true, `${label}: closing popup is inert`);
  assert.equal(exit.hidden, 'true', `${label}: closing popup is hidden from assistive technology`);
  assert.equal(exit.pointer, 'none', `${label}: closing popup stops receiving pointer events`);
  assert.equal(exit.interceptsPointer, false, `${label}: closing popup does not block underlying controls`);
  assert.equal(exit.activeInside, false, `${label}: focus leaves closing popup`);
  assert(exit.animations > 0, `${label}: popup animates on exit`);
}

async function frame(page) {
  return page.evaluate(() => Object.fromEntries(['.chat-messages', '.bottom-stack', '.composer', '.model-select'].map(selector => {
    const element = document.querySelector(selector), rect = element.getBoundingClientRect();
    return [selector, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }];
  })));
}

async function recipeChecks(page, options, label) {
  const { reduced, motion, width } = options;
  const tooltip = await page.locator('.ctx-ring').evaluate(async trigger => {
    trigger.focus({ preventScroll: true });
    const samples = [];
    const start = performance.now();
    while (performance.now() - start < 300) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const bubble = document.querySelector('.t-tt');
      if (bubble) samples.push(Number(getComputedStyle(bubble).opacity));
    }
    const bubble = document.querySelector('.t-tt'), rect = bubble.getBoundingClientRect();
    return {
      samples, id: bubble.id, describedBy: trigger.getAttribute('aria-describedby'),
      role: bubble.getAttribute('role'), show: bubble.dataset.show, opacity: Number(getComputedStyle(bubble).opacity),
      x: rect.x, right: rect.right, top: rect.top, bottom: rect.bottom,
    };
  });
  assert.equal(tooltip.role, 'tooltip', `${label}: supplied tooltip keeps semantic role`);
  assert.equal(tooltip.id, tooltip.describedBy, `${label}: tooltip is linked to its trigger`);
  assert.equal(tooltip.show, 'true', `${label}: tooltip enters visible state`);
  assert.equal(tooltip.opacity, 1, `${label}: tooltip reaches full visibility`);
  assert(tooltip.x >= -1 && tooltip.right <= width + 1 && tooltip.top >= -1, `${label}: tooltip fits the viewport`);
  if (reduced) assert(tooltip.samples.every(value => value === 1), `${label}: reduced tooltip opens immediately`);
  else assert(tooltip.samples.some(value => value > 0 && value < 1), `${label}: tooltip opacity has actual transition frames`);
  await page.locator('.ctx-ring').press('Escape');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.t-tt').count(), 0, `${label}: tooltip exits and releases its DOM`);

  await send(page, { type: 'modelSelected', model: 'local-model' });
  const swapStart = await page.locator('.model-select .t-text-swap').evaluate(element => ({ text: element.textContent, exiting: element.classList.contains('is-exit') }));
  if (reduced) assert.equal(swapStart.text, 'Local model', `${label}: reduced model label changes immediately`);
  else assert.equal(swapStart.exiting, true, `${label}: model label uses the supplied text-swap exit`);
  await page.waitForTimeout(380);
  assert.equal(await page.locator('.model-select .t-text-swap').textContent(), 'Local model', `${label}: model label finishes swapping`);
  await send(page, { type: 'modelSelected', model: 'preview-model' });
  await page.waitForTimeout(40);
  await send(page, { type: 'modelSelected', model: 'local-model' });
  await send(page, { type: 'modelSelected', model: 'preview-model' });
  await page.waitForTimeout(400);
  const finalSwap = await page.locator('.model-select .t-text-swap').evaluate(element => ({ text: element.textContent, opacity: getComputedStyle(element).opacity, className: element.className }));
  assert.equal(finalSwap.text, 'Example model', `${label}: rapid model changes settle to the newest selection`);
  assert.equal(finalSwap.opacity, '1', `${label}: swapped model label stays visible`);
  assert(!/is-exit|is-enter-start/.test(finalSwap.className), `${label}: model label clears all temporary classes`);
  return { tooltip, swapStart, finalSwap };
}

async function attachmentChecks(page, { reduced, width }, label) {
  const trigger = page.getByRole('button', { name: 'Attach images or files', exact: true });
  const before = await frame(page);
  const opening = await trigger.evaluate(async button => {
    button.focus({ preventScroll: true });
    button.click();
    const samples = [];
    const started = performance.now();
    while (performance.now() - started < 450) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const surface = document.querySelector('.attachment-menu-surface');
      if (surface) {
        const rect = surface.getBoundingClientRect();
        samples.push({ width: rect.width, height: rect.height, left: rect.left, right: rect.right, top: rect.top });
      }
    }
    const surface = document.querySelector('.attachment-menu-surface');
    return { samples, expanded: button.getAttribute('aria-expanded'), open: surface?.dataset.open, active: document.activeElement?.textContent };
  });
  assert.equal(opening.expanded, 'true', `${label}: attachment trigger announces the open menu`);
  assert.equal(opening.open, 'true', `${label}: attachment surface reaches its open state`);
  assert.equal(opening.active, 'Attach files', `${label}: attachment menu focuses the first item`);
  const last = opening.samples.at(-1);
  assert(last && Math.abs(last.width - 208) < 1 && Math.abs(last.height - 104) < 1, `${label}: attachment surface reaches its full dimensions`);
  assert(opening.samples.every(sample => sample.left >= -1 && sample.right <= width + 1 && sample.top >= -1), `${label}: attachment morph stays inside the viewport`);
  if (reduced) assert(opening.samples.every(sample => Math.abs(sample.width - 208) < 1), `${label}: reduced attachment menu opens immediately`);
  else assert(opening.samples.some(sample => sample.width > 35 && sample.width < 200 && sample.height > 30 && sample.height < 100), `${label}: attachment width and height visibly morph from the plus`);
  sameFrame(before, await frame(page), `${label} attachment menu opening`);
  const closing = await page.evaluate(async () => {
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    const samples = [];
    const started = performance.now();
    while (performance.now() - started < 290) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const surface = document.querySelector('.attachment-menu-surface');
      if (surface) samples.push({ width: surface.getBoundingClientRect().width, inert: surface.inert, hidden: surface.getAttribute('aria-hidden'), pointer: getComputedStyle(surface).pointerEvents });
    }
    return { samples, remaining: !!document.querySelector('.attachment-menu-surface'), focus: document.activeElement?.getAttribute('aria-label') };
  });
  assert.equal(closing.remaining, false, `${label}: attachment menu unmounts after closing`);
  assert.equal(closing.focus, 'Attach images or files', `${label}: attachment Escape restores trigger focus`);
  if (reduced) assert.equal(closing.samples.length, 0, `${label}: reduced attachment menu closes immediately`);
  else {
    assert(closing.samples.some(sample => sample.width > 35 && sample.width < 200), `${label}: attachment menu visibly shrinks on close`);
    assert(closing.samples.every(sample => sample.inert && sample.hidden === 'true' && sample.pointer === 'none'), `${label}: closing attachment menu is inert and never blocks controls`);
  }
  sameFrame(before, await frame(page), `${label} attachment menu closing`);

  await trigger.press('ArrowUp');
  await page.waitForTimeout(reduced ? 50 : 420);
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Attach images', `${label}: ArrowUp opens at the image item`);
  const [images] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: 'Attach images', exact: true }).press('Enter')]);
  const imageAccept = await images.element().getAttribute('accept');
  assert.equal(imageAccept, 'image/*', `${label}: images action invokes the native image file chooser`);
  await images.setFiles([]);
  await page.waitForTimeout(280);
  await trigger.click();
  const [files] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: 'Attach files', exact: true }).click()]);
  const fileAccept = await files.element().getAttribute('accept');
  assert.notEqual(fileAccept, 'image/*', `${label}: files action accepts more than images`);
  assert(files.isMultiple(), `${label}: file chooser retains multiple attachment support`);
  await files.setFiles([]);
  await page.waitForTimeout(280);
  return { opening, closing, imageAccept, fileAccept };
}

async function revealChecks(page, options, label) {
  await send(page, { type: 'initialState', activeId: `${label}-empty`, mode: 'agent', selectedModel: 'preview-model', turns: [], personas: [], activePersonaId: 'default', hasProviders: true, runningConvIds: [], uiPrefs: uiPrefs(options.motion) });
  const reveal = await page.locator('.empty .t-stagger, .empty-hero.t-stagger, .t-stagger').first().evaluate(async element => {
    const lines = [...element.querySelectorAll('.t-stagger-line')];
    const samples = [];
    const start = performance.now();
    while (performance.now() - start < 620) {
      samples.push(lines.map(line => Number(getComputedStyle(line).opacity)));
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    return { lines: lines.length, samples, final: lines.map(line => Number(getComputedStyle(line).opacity)), shown: element.classList.contains('is-shown') };
  });
  assert.equal(reveal.lines, 2, `${label}: welcome title and description use the supplied stagger`);
  assert(reveal.shown && reveal.final.every(value => value === 1), `${label}: welcome reveal finishes fully visible`);
  if (options.reduced) assert(reveal.samples.every(sample => sample.every(value => value === 1)), `${label}: reduced reveal appears immediately`);
  else assert(reveal.samples.some(sample => sample.some(value => value > 0 && value < 1)), `${label}: welcome reveal has visible intermediate frames`);
  return reveal;
}

function sameFrame(before, after, label) {
  for (const selector of Object.keys(before)) for (const key of ['x', 'y', 'width', 'height'])
    assert(Math.abs(before[selector][key] - after[selector][key]) <= .5, `${label}: ${selector} ${key} moved`);
}

async function sidebarChecks(page, { theme, width, reduced, motion, osReduced }) {
  const label = `${theme}/${width}/${motion}/os-${osReduced ? 'reduce' : 'normal'}`;
  const convId = `motion-${label}`;
  await chatEntryChecks(page, `${convId}-entrances`, { motion, reduced }, label);
  await load(page, `${convId}-starting`, [
    { role: 'user', text: 'Check the loading controls.' },
    { role: 'assistant', blocks: [{ kind: 'text', text: 'Ready for another pass.' }] },
  ], false, motion);
  await page.evaluate(() => { window.__motionHoldSend = true; });
  await page.locator('.msg.user').first().hover();
  await page.getByRole('button', { name: 'Resend message', exact: true }).click();
  const starting = await expectStatus(page, 'Starting', `${label} starting a request`);
  await page.evaluate(() => { window.__motionHoldSend = false; });
  await load(page, convId, [
    { role: 'user', text: 'Check the loading controls.' },
    { role: 'assistant', blocks: [{ kind: 'text', text: 'I am checking the current implementation.' }] },
  ], true, motion);
  assert.equal(await page.locator('html').getAttribute('data-motion'), reduced ? 'reduced' : 'full', `${label}: CSS receives the effective motion policy`);
  const stop = page.locator('.send-btn.stop');
  assert.equal(await stop.getAttribute('aria-label'), 'Stop', `${label}: loading control keeps its action label`);
  const sampled = await stop.evaluate(async button => {
    const ring = button.querySelector('.composer-stop-ring');
    const square = button.querySelector('.composer-stop-square');
    const read = () => ({
      ring: getComputedStyle(ring).transform, square: getComputedStyle(square).transform,
      squareAnimations: square.getAnimations().length,
      box: JSON.stringify(button.getBoundingClientRect().toJSON()),
    });
    const first = read();
    await new Promise(resolve => setTimeout(resolve, 160));
    return { first, second: read(), ringAnimations: ring.getAnimations().length };
  });
  assert.equal(sampled.first.box, sampled.second.box, `${label}: loading animation does not move the Stop target`);
  assert.equal(sampled.first.square, sampled.second.square, `${label}: Stop square remains stationary`);
  assert.equal(sampled.second.squareAnimations, 0, `${label}: Stop square has no rotating animation`);
  if (reduced) {
    assert.equal(sampled.first.ring, sampled.second.ring, `${label}: reduced motion leaves loading ring static`);
    assert.equal(sampled.ringAnimations, 0, `${label}: reduced motion disables loading animation`);
  } else {
    assert.notEqual(sampled.first.ring, sampled.second.ring, `${label}: loading ring visibly rotates over time`);
    assert(sampled.ringAnimations > 0, `${label}: loading ring has an active animation`);
  }
  const statuses = await statusChecks(page, convId, { reduced }, label);
  await stop.click();
  assert(await page.evaluate(id => window.__motionMessages.some(message => message.type === 'cancelRun' && message.convId === id), convId), `${label}: Stop reaches the host without waiting for animation`);
  await send(page, { type: 'agentEvent', convId, event: { type: 'run-status', status: 'finished' } });
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.phase-row .activity-status').count(), 0, `${label}: completed run removes its activity status`);
  const recipes = await recipeChecks(page, { reduced, motion, width }, label);
  const attachments = await attachmentChecks(page, { reduced, width }, label);

  const before = await frame(page);
  const picker = await openAndInspect(page.locator('.model-select'), '.model-picker');
  verifyEntry(picker, reduced, width, `${label} model picker`);
  await page.waitForTimeout(260);
  sameFrame(before, await frame(page), `${label} opening model picker`);
  const pickerExit = await escapeAndInspect(page, '.model-picker');
  verifyExit(pickerExit, reduced, `${label} model picker`);
  assert(await page.locator('.model-select').evaluate(element => document.activeElement === element), `${label}: closing model picker restores focus`);
  await page.waitForTimeout(200);
  sameFrame(before, await frame(page), `${label} closing model picker`);

  await load(page, `${convId}-date`, [
    { role: 'user', text: 'Choose the release date.' },
    { role: 'assistant', blocks: [{ kind: 'tool', name: 'AskQuestion', callId: 'motion-date', status: 'running', input: { questions: [{ question: 'Release date', type: 'date', required: true }] } }] },
  ], true, motion);
  const calendarTrigger = page.getByRole('button', { name: 'Release date: Choose date', exact: true });
  const calendarEntry = await openAndInspect(calendarTrigger, '.oc-date-calendar');
  verifyEntry(calendarEntry, reduced, width, `${label} calendar`);
  await page.waitForTimeout(240);
  assert(await page.locator('.oc-date-calendar').evaluate(element => element.contains(document.activeElement)), `${label}: calendar focuses the selected day`);
  const calendarExit = await escapeAndInspect(page, '.oc-date-calendar');
  verifyExit(calendarExit, reduced, `${label} calendar`);
  if (!reduced) assert(calendarExit.visibleCalendarDays >= 28, `${label}: calendar keeps its date grid visible throughout the exit fade`);
  assert(await calendarTrigger.evaluate(element => document.activeElement === element), `${label}: calendar Escape restores trigger focus`);
  await page.waitForTimeout(180);
  assert.equal(await page.locator('.oc-date-calendar').count(), 0, `${label}: calendar leaves DOM after exit`);
  const reveal = await revealChecks(page, { reduced, motion }, label);
  return { starting, ring: sampled, statuses, recipes, attachments, reveal, modelEntry: picker, modelExit: pickerExit, calendarEntry, calendarExit };
}

async function settingsChecks(page, { theme, width, reduced, motion, osReduced }) {
  const label = `${theme}/${width}/${motion}/os-${osReduced ? 'reduce' : 'normal'}`;
  await send(page, { type: 'features', features: { motion } });
  assert.equal(await page.locator('html').getAttribute('data-motion'), reduced ? 'reduced' : 'full', `${label}: settings uses the same effective motion policy`);
  const toggle = page.getByRole('switch', { name: 'Auto-Generate Chat Titles', exact: true });
  await toggle.scrollIntoViewIfNeeded();
  await page.waitForTimeout(240);
  const toggleMotion = await toggle.evaluate(async input => {
    const thumb = input.parentElement.querySelector('.thumb');
    const read = () => new DOMMatrix(getComputedStyle(thumb).transform).m41;
    const before = read(), checked = input.checked;
    input.click();
    const samples = [];
    const started = performance.now();
    while (performance.now() - started < 260) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      samples.push(read());
    }
    return { before, after: read(), samples, checked, afterChecked: input.checked };
  });
  assert.notEqual(toggleMotion.checked, toggleMotion.afterChecked, `${label}: switch updates its value immediately`);
  assert(Math.abs(toggleMotion.after - toggleMotion.before) > 5, `${label}: switch thumb reaches the other state`);
  const intermediate = toggleMotion.samples.filter(value => Math.abs(value - toggleMotion.before) > .1 && Math.abs(value - toggleMotion.after) > .1);
  if (reduced) assert.equal(intermediate.length, 0, `${label}: reduced motion changes switch directly`);
  else assert(intermediate.length > 0, `${label}: switch has visible intermediate transition positions`);

  await send(page, { type: 'navigate', section: 'agents' });
  await page.waitForTimeout(240);
  const select = page.getByRole('combobox', { name: 'Text size', exact: true });
  await select.scrollIntoViewIfNeeded();
  const entry = await openAndInspect(select, '[data-select-popup]');
  verifyEntry(entry, reduced, width, `${label} select`);
  await page.waitForTimeout(240);
  const exit = await escapeAndInspect(page, '[data-select-popup]');
  verifyExit(exit, reduced, `${label} select`);
  assert(await select.evaluate(element => document.activeElement === element), `${label}: select Escape restores trigger focus`);
  assert.equal(await select.getAttribute('aria-expanded'), 'false', `${label}: select collapses before its exit completes`);
  await page.waitForTimeout(180);
  assert.equal(await page.locator('[data-select-popup]').count(), 0, `${label}: select leaves DOM after exit`);
  await select.press('Enter');
  await select.press('End');
  await select.press('Enter');
  assert.equal((await select.textContent()).trim(), 'Large', `${label}: animated select still supports keyboard selection`);
  await page.waitForTimeout(180);
  assert.equal(await page.locator('[data-select-popup]').count(), 0, `${label}: selection dismisses popup`);

  await send(page, { type: 'navigate', section: 'subagents' });
  await page.waitForTimeout(220);
  await page.getByRole('button', { name: 'New', exact: true }).first().click();
  await page.getByPlaceholder('Backend Developer').waitFor();
  await page.waitForTimeout(220);
  const modelTrigger = page.locator('.modal-overlay .msel-trigger');
  const modelEntry = await openAndInspect(modelTrigger, '[data-model-dialog]');
  verifyEntry(modelEntry, reduced, width, `${label} settings model dialog`);
  await page.waitForTimeout(240);
  assert(await page.locator('[data-model-dialog]').evaluate(element => element.contains(document.activeElement)), `${label}: model dialog receives keyboard focus`);
  const modelExit = await escapeAndInspect(page, '[data-model-dialog]');
  verifyExit(modelExit, reduced, `${label} settings model dialog`);
  assert(await modelTrigger.evaluate(element => document.activeElement === element), `${label}: nested model dialog restores its trigger`);
  assert.equal(await page.locator('.modal-overlay').count(), 1, `${label}: closing nested model picker preserves its parent dialog`);
  await page.waitForTimeout(180);
  assert.equal(await page.locator('[data-model-dialog]').count(), 0, `${label}: settings model dialog leaves DOM after exit`);
  await modelTrigger.press('Escape');
  assert.equal(await page.locator('.modal-overlay').count(), 0, `${label}: Escape still closes parent dialog afterward`);
  return { switch: toggleMotion, selectEntry: entry, selectExit: exit, modelEntry, modelExit };
}

async function main() {
  const origin = process.env.OPENCURSOR_PREVIEW_ORIGIN || 'http://127.0.0.1:4178';
  const output = path.resolve(__dirname, '../dist/visual-qa');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.OPENCURSOR_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const results = [];
  try {
    const policies = [
      { motion: 'full', osReduced: false, reduced: false },
      { motion: 'full', osReduced: true, reduced: false },
      { motion: 'system', osReduced: false, reduced: false },
      { motion: 'system', osReduced: true, reduced: true },
      { motion: 'reduced', osReduced: false, reduced: true },
    ];
    const smoke = process.env.OPENCURSOR_MOTION_SMOKE === '1';
    for (const theme of ['light', 'dark']) for (const width of smoke ? [375] : [375, 900]) for (const policy of smoke ? policies.filter(policy => policy.motion === 'full' && policy.osReduced || policy.motion === 'reduced') : policies) {
      const options = { theme, width, ...policy };
      const context = await browser.newContext({ viewport: { width, height: 850 }, reducedMotion: policy.osReduced ? 'reduce' : 'no-preference' });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        let factory;
        window.__motionMessages = [];
        window.__motionFeaturesReady = false;
        window.addEventListener('message', event => {
          if (event.data?.type === 'features') window.__motionFeaturesReady = true;
        });
        Object.defineProperty(window, 'acquireVsCodeApi', {
          configurable: true, get: () => factory,
          set: original => { factory = () => {
            const bridge = original();
            return { ...bridge, postMessage: message => {
              window.__motionMessages.push(message);
              if (!(window.__motionHoldSend && message.type === 'sendMessage')) bridge.postMessage(message);
            } };
          }; },
        });
      });
      await page.goto(`${origin}/sidebar?theme=${theme}`);
      await page.waitForFunction(() => document.querySelector('.model-select')?.textContent.includes('Example model'));
      assert.equal(await page.locator('html').getAttribute('data-motion'), 'full', `${theme}/${width}: unset motion preference animates regardless of OS preference`);
      const sidebar = await sidebarChecks(page, options);
      const capture = `motion-${theme}-${width}-${policy.motion}-os-${policy.osReduced ? 'reduce' : 'normal'}`;
      await page.screenshot({ path: path.join(output, `${capture}-sidebar.png`) });
      await page.goto(`${origin}/settings?theme=${theme}`);
      await page.locator('.page-title').waitFor();
      await page.waitForFunction(() => window.__motionFeaturesReady);
      const settings = await settingsChecks(page, options);
      await page.screenshot({ path: path.join(output, `${capture}-settings.png`) });
      assert.deepEqual(errors, [], `${theme}/${width}: browser errors`);
      results.push({ ...options, sidebar, settings, errors });
      console.log(`Passed ${theme}/${width}/${policy.motion}/os-${policy.osReduced ? 'reduce' : 'normal'}`);
      await context.close();
    }
  } finally {
    await browser.close();
    await fs.writeFile(path.join(output, process.env.OPENCURSOR_MOTION_SMOKE === '1' ? 'motion-additional-results.json' : 'motion-results.json'), JSON.stringify(results, null, 2));
  }
  console.log(`Motion controls passed ${results.length} theme/width/motion combinations across ${results.length * 2} view states. Results: ${output}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
