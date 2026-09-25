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

const emptyCode = '```\n\n```';
const code = 'const answer = 42;';
const send = (page, data) => page.evaluate(data => window.dispatchEvent(new MessageEvent('message', { data })), data);

async function restore(page, text) {
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.model-select')?.textContent.includes('Example model'));
  await send(page, { type: 'initialState', mode: 'agent', selectedModel: 'preview-model', turns: [],
    personas: [], activePersonaId: 'default', hasProviders: true, runningConvIds: [],
    workspaceState: { openTabs: [], drafts: { '\u0000shared': { text, attachments: [] } } } });
  const editor = page.getByRole('textbox', { name: 'Message OpenCursor', exact: true });
  await editor.locator('.composer-code-block').waitFor();
  await editor.locator('pre code').click();
  return editor;
}

async function assertEmpty(editor, label) {
  assert.equal(await editor.locator('.composer-code-block').count(), 0, `${label}: removes the code wrapper`);
  assert.equal(await editor.textContent(), '', `${label}: leaves an empty paragraph`);
  assert(await editor.evaluate(element => element.classList.contains('empty')), `${label}: restores the placeholder`);
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.OPENCURSOR_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    for (const theme of ['light', 'dark']) for (const width of [375, 900]) {
      const context = await browser.newContext({ viewport: { width, height: 950 }, reducedMotion: 'reduce' });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        let factory;
        window.__composerMessages = [];
        Object.defineProperty(window, 'acquireVsCodeApi', {
          configurable: true, get: () => factory,
          set: original => { factory = () => {
            const bridge = original();
            return { ...bridge, postMessage: message => {
              window.__composerMessages.push(message);
              if (message.type === 'ready' || message.type === 'getFileIcon') bridge.postMessage(message);
            } };
          }; },
        });
      });
      await page.goto(`${process.env.OPENCURSOR_PREVIEW_ORIGIN || 'http://127.0.0.1:4178'}/sidebar?theme=${theme}`);

      // Restoring a lone empty block must leave every normal deletion path usable.
      for (const key of ['Backspace', 'Delete']) {
        let editor = await restore(page, emptyCode);
        await page.keyboard.press(key);
        await assertEmpty(editor, `${key} in empty block`);
        editor = await restore(page, emptyCode);
        await page.evaluate(() => document.execCommand('selectAll'));
        // Let the native selectionchange finish, as it does between two user actions.
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.keyboard.press(key);
        await assertEmpty(editor, `native Select All + ${key}`);
        editor = await restore(page, emptyCode);
        await page.keyboard.press('Control+a');
        await page.keyboard.press(key);
        await assertEmpty(editor, `Ctrl+A + ${key}`);
      }
      let editor = await restore(page, emptyCode);
      await page.evaluate(() => document.execCommand('selectAll'));
      await page.evaluate(() => document.execCommand('delete'));
      await assertEmpty(editor, 'native delete command');

      // Boundary arrows make space for prose without modifying or submitting code.
      for (const direction of ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']) {
        editor = await restore(page, `\`\`\`js\n${code}\n\`\`\``);
        const before = direction === 'ArrowUp' || direction === 'ArrowLeft';
        await page.keyboard.press(before ? 'Home' : 'End');
        await page.keyboard.press(direction);
        await page.keyboard.type(before ? 'Before code' : 'After code');
        assert.equal(await editor.locator('pre code').textContent(), code, `${direction}: keeps code intact`);
        const children = await editor.evaluate(element => [...element.children].map(child => ({ tag: child.tagName, text: child.textContent })));
        assert.equal((before ? children[0] : children.at(-1)).text, before ? 'Before code' : 'After code');
        assert.equal((before ? children[0] : children.at(-1)).tag, 'P');
        assert.equal(await page.evaluate(() => window.__composerMessages.filter(message => message.type === 'sendMessage').length), 0, `${direction}: does not submit`);
      }

      // Mouse and keyboard-accessible controls work when code is the only block.
      editor = await restore(page, `\`\`\`js\n${code}\n\`\`\``);
      await editor.locator('.composer-code-block').hover();
      await editor.getByRole('button', { name: 'Insert text before code block', exact: true }).click();
      await page.keyboard.type('Before code');
      await editor.locator('.composer-code-block').hover();
      await editor.getByRole('button', { name: 'Insert text after code block', exact: true }).click();
      await page.keyboard.type('After code');
      assert.equal(await editor.locator('pre code').textContent(), code);
      await editor.locator('.composer-code-block').hover();
      await editor.getByRole('button', { name: 'Remove code block', exact: true }).click();
      assert.equal(await editor.locator('.composer-code-block').count(), 0);
      assert.match(await editor.textContent(), /Before code/);
      assert.match(await editor.textContent(), /After code/);
      await page.keyboard.press('Control+z');
      assert.equal(await editor.locator('pre code').textContent(), code, 'Undo restores the removed block');

      const clipped = await editor.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        return [...element.querySelectorAll('.composer-code-header button')].some(button => {
          const rect = button.getBoundingClientRect();
          return rect.left < bounds.left - 1 || rect.right > bounds.right + 1;
        });
      });
      assert.equal(clipped, false, 'code controls fit the composer');
      await editor.locator('.code-language-trigger').focus();
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Backspace');
      await assertEmpty(editor, 'Select All while code language control is focused');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no page overflow');
      assert.deepEqual(errors, []);
      console.log(`Passed code block navigation ${theme}/${width}`);
      await context.close();
    }
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
