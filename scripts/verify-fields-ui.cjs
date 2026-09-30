/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// Exercises the production question controls against the local mock host only.
const { chromium } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

async function frame(locator) {
  return locator.evaluate(element => {
    const style = getComputedStyle(element), box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height, border: style.borderTopColor, borderWidth: style.borderTopWidth, borderStyle: style.borderTopStyle, outline: style.outlineStyle, shadow: style.boxShadow, background: style.backgroundColor, appearance: style.appearance };
  });
}

async function checkField(page, locator, label) {
  await locator.evaluate(element => element.blur()); await page.mouse.move(0, 0);
  const resting = await frame(locator);
  assert.equal(resting.borderWidth, '1px', `${label}: thin resting border`);
  assert.equal(resting.borderStyle, 'solid', `${label}: solid resting border`);
  assert.notEqual(resting.border, resting.background, `${label}: visible resting border`);
  assert(!/rgba\([^)]*, 0\)$/.test(resting.border), `${label}: border must not be transparent`);
  await locator.focus();
  const focused = await frame(locator);
  assert.equal(focused.outline, 'none', `${label}: field focus stays inside its border`);
  assert.equal(focused.shadow, 'none', `${label}: no colored focus glow`);
  const channels = focused.border.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  assert(channels && Math.max(...channels) - Math.min(...channels) < 2, `${label}: neutral focus border`);
  await locator.hover();
  const hovered = await frame(locator);
  for (const key of ['x', 'y', 'width', 'height']) assert.equal(hovered[key], focused[key], `${label}: no hover movement`);
  return { resting, focused };
}

async function main() {
  const origin = process.env.OPENCURSOR_PREVIEW_ORIGIN || 'http://127.0.0.1:4178';
  const output = path.resolve(__dirname, '../dist/visual-qa');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.OPENCURSOR_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const results = [];
  try {
    for (const theme of ['light', 'dark']) for (const width of [280, 375, 760]) {
      const page = await browser.newPage({ viewport: { width, height: 700 }, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        let factory;
        window.__fieldMessages = [];
        Object.defineProperty(window, 'acquireVsCodeApi', {
          configurable: true,
          get: () => factory,
          set: original => { factory = () => {
            const bridge = original(), post = bridge.postMessage;
            return { ...bridge, postMessage: message => { window.__fieldMessages.push(message); post(message); } };
          }; },
        });
      });
      await page.goto(`${origin}/sidebar?theme=${theme}`);
      await page.locator('.composer').waitFor();
      await page.waitForFunction(() => document.querySelector('.model-select')?.textContent.includes('Example model'));
      await page.evaluate(() => {
        document.documentElement.style.setProperty('--vscode-focusBorder', '#0066ff');
        window.dispatchEvent(new MessageEvent('message', { data: {
          type: 'initialState', activeId: 'fields-preview', mode: 'agent', selectedModel: 'preview-model',
          personas: [], activePersonaId: 'default', hasProviders: true, runningConvIds: ['fields-preview'],
          workspaceState: { openTabs: ['fields-preview'], drafts: {} },
          turns: [
            { role: 'user', text: 'Set the delivery details.' },
            { role: 'assistant', blocks: [
              { kind: 'text', text: Array.from({ length: 14 }, (_, index) => `Review step ${index + 1}: the next fields collect the delivery details.`).join('\n\n') },
              { kind: 'tool', name: 'AskQuestion', callId: 'fields-question', status: 'running', input: { header: 'Delivery details', questions: [
                { question: 'Delivery date', type: 'date', required: true },
                { question: 'Release notes', type: 'textArea', required: true },
                { question: 'Reviewers', type: 'number', required: true },
                { question: 'Release channel', type: 'choices', options: ['Preview', 'Stable'], required: true },
                { question: 'Release title', type: 'text', required: true },
              ] } },
            ] },
          ],
        } }));
      });
      const date = page.getByRole('textbox', { name: 'Delivery date', exact: true });
      await date.waitFor(); await date.scrollIntoViewIfNeeded();
      assert.equal(await page.locator('input[type="date"], select').count(), 0, 'Question controls must not use browser date/select popups');
      const dateFrame = await checkField(page, date, `${theme}/${width} date`);
      await date.fill('2024-02-30'); await date.press('Enter');
      assert.equal(await page.locator('.qc-next').isDisabled(), true, 'Invalid date cannot advance');
      assert.equal(await page.evaluate(() => window.__fieldMessages.filter(message => message.type === 'answerQuestion').length), 0);
      assert.equal(await date.getAttribute('aria-invalid'), 'true');
      await date.fill('2024-02-28');
      const before = await page.locator('.composer').boundingBox();
      await date.press('Alt+ArrowDown');
      const calendar = page.getByRole('dialog', { name: 'Delivery date calendar' });
      await calendar.waitFor();
      await page.waitForFunction(() => document.activeElement?.getAttribute('data-date') === '2024-02-28');
      await page.waitForFunction(() => document.querySelector('.oc-date-calendar')?.style.opacity === '1');
      await page.screenshot({ path: path.join(output, `fields-${theme}-${width}-calendar.png`) });
      const calendarBox = await calendar.boundingBox(), fieldBox = await date.boundingBox();
      assert(calendarBox && calendarBox.x >= 0 && calendarBox.y >= 0 && calendarBox.x + calendarBox.width <= width && calendarBox.y + calendarBox.height <= 700, `${theme}/${width}: calendar fits viewport ${JSON.stringify(calendarBox)} ${await calendar.getAttribute('style')}`);
      if (700 - fieldBox.y - fieldBox.height < calendarBox.height && fieldBox.y > calendarBox.height) assert(calendarBox.y < fieldBox.y, 'Calendar near the bottom opens above its field');
      assert.deepEqual(await page.locator('.composer').boundingBox(), before, 'Opening a calendar must not shift the composer');
      assert.equal(await calendar.getByRole('gridcell').count(), 42);
      await page.keyboard.press('Escape'); await calendar.waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => document.activeElement?.className), 'oc-date-trigger', 'Escape restores calendar trigger focus');
      await page.getByRole('button', { name: 'Delivery date: Choose date', exact: true }).click();
      await page.waitForFunction(() => document.activeElement?.getAttribute('data-date') === '2024-02-28');
      await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
      assert.equal(await date.inputValue(), '2024-02-29', 'Keyboard selection handles leap day');
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Delivery date');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      const notes = page.getByRole('textbox', { name: 'Release notes', exact: true });
      const notesFrame = await checkField(page, notes, `${theme}/${width} textarea`);
      await notes.fill('Custom controls support keyboard navigation.\nKeep the release notes readable.');
      await page.screenshot({ path: path.join(output, `fields-${theme}-${width}-textarea.png`) });
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      const number = page.getByRole('spinbutton', { name: 'Reviewers', exact: true });
      const numberFrame = await checkField(page, number, `${theme}/${width} number`);
      assert.equal(numberFrame.focused.appearance, 'textfield', 'Numbers use the same custom field surface');
      await number.fill('2'); await number.press('Enter');
      const choice = page.getByRole('button', { name: 'A Preview', exact: true });
      await choice.click(); assert.equal(await choice.getAttribute('aria-pressed'), 'true');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      const text = page.getByRole('textbox', { name: 'Release title', exact: true });
      const textFrame = await checkField(page, text, `${theme}/${width} text`);
      await text.fill('Accessible controls'); await text.press('Enter');
      await page.locator('.question-card.done').waitFor();
      const answer = await page.evaluate(() => window.__fieldMessages.find(message => message.type === 'answerQuestion'));
      assert.deepEqual(answer.answers, { 0: ['2024-02-29'], 1: ['Custom controls support keyboard navigation.\nKeep the release notes readable.'], 2: ['2'], 3: ['Preview'], 4: ['Accessible controls'] });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${theme}/${width}: no horizontal overflow`);
      assert.deepEqual(errors, []);
      results.push({ theme, width, calendarBox, date: dateFrame, textarea: notesFrame, number: numberFrame, text: textFrame, errors });
      await page.close();
    }
    await fs.writeFile(path.join(output, 'fields-ui-results.json'), JSON.stringify(results, null, 2));
    console.log(`Question controls verified in ${results.length} theme/width combinations. Screenshots: ${output}`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
