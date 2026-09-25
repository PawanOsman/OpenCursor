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
const prompt = '# This is a heading\n\nThis is normal text.\n\n```\nok\n```\n\nThis is JavaScript code.\n\n```\nconsole.log("test");\n```';
const send = (page, data) => page.evaluate(data => window.dispatchEvent(new MessageEvent('message', { data })), data);
async function paste(editor, text) {
  await editor.evaluate((element, text) => {
    element.focus();
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', text);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, text);
}
async function main() {
  const output = path.resolve(__dirname, '../dist/visual-qa');
  await fs.mkdir(output, { recursive: true });
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
      await page.waitForFunction(() => document.querySelector('.model-select')?.textContent.includes('Example model'));
      const editor = page.getByRole('textbox', { name: 'Message OpenCursor', exact: true });
      if (theme === 'light' && width === 375) {
        for (const [shortcut, modifiedPreference] of [['Enter', false], ['Control+Enter', false], ['Meta+Enter', false], ['Control+Enter', true]]) {
          if (modifiedPreference) await send(page, { type: 'configState', personas: [], activePersonaId: 'default', hasProviders: true,
            uiPrefs: { chatTextSize: 'default', submitWithCtrlEnter: true, maxTabCount: 0, completionSound: false, perTabDrafts: false, motion: 'reduced' } });
          await paste(editor, 'Keyboard submission');
          if (modifiedPreference) {
            await page.keyboard.press('Enter');
            assert.equal(await page.evaluate(() => window.__composerMessages.filter(m => m.type === 'sendMessage').length), 0, 'plain Enter inserts a newline when configured');
          }
          await page.keyboard.press(shortcut);
          const requests = await page.evaluate(() => window.__composerMessages.filter(m => m.type === 'sendMessage'));
          assert.equal(requests.length, 1, `${shortcut} submits exactly once`);
          assert.equal(requests[0].text, 'Keyboard submission');
          await page.reload();
          await page.waitForFunction(() => document.querySelector('.model-select')?.textContent.includes('Example model'));
        }
      }
      assert(await editor.evaluate(element => element.classList.contains('empty')), 'empty composer shows placeholder');
      await editor.click();
      await page.keyboard.type('```');
      await page.keyboard.press('Shift+Enter');
      const emptyCode = editor.locator('.composer-code-block');
      assert.equal(await emptyCode.count(), 1);
      assert(await editor.evaluate(element => getComputedStyle(element, '::before').content === 'none'), 'empty code hides placeholder');
      const border = await emptyCode.evaluate(element => {
        const style = getComputedStyle(element);
        return { width: style.borderTopWidth, style: style.borderTopStyle, color: style.borderTopColor, background: style.backgroundColor };
      });
      assert.equal(border.width, '1px');
      assert.equal(border.style, 'solid');
      assert.notEqual(border.color, 'rgba(0, 0, 0, 0)');
      assert.notEqual(border.color, border.background);
      await page.screenshot({ path: path.join(output, `composer-empty-code-${theme}-${width}.png`), animations: 'disabled' });
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Backspace');
      assert(await editor.evaluate(element => element.classList.contains('empty')), 'removing the block restores placeholder');
      if (theme === 'light' && width === 375) {
        await editor.click();
        await page.keyboard.type('#Hello');
        await page.keyboard.press('Shift+Enter');
        assert.equal(await editor.locator('p').first().textContent(), '#Hello');
        await page.keyboard.type('# Typed heading');
        assert.equal(await editor.locator('h1').textContent(), 'Typed heading');
        await page.keyboard.press('Shift+Enter');
        await page.keyboard.type('**bold**');
        assert.equal(await editor.locator('strong').textContent(), 'bold');
        await page.keyboard.press('Shift+Enter');
        await page.keyboard.type('```');
        await page.keyboard.press('Shift+Enter');
        await page.keyboard.type('console.log("typing");');
        assert.equal(await editor.locator('.code-language-trigger').textContent(), 'Auto (JavaScript)');
        await page.keyboard.press('Shift+Enter');
        await page.keyboard.type('```');
        await page.keyboard.press('Shift+Enter');
        assert.equal(await editor.locator('pre code').textContent(), 'console.log("typing");');
        assert.equal(await page.evaluate(() => window.__composerMessages.filter(m => m.type === 'sendMessage').length), 0);
        await page.keyboard.type('after code');
        assert.match(await editor.locator('p').last().textContent(), /after code/);
        await page.reload();
        await page.waitForFunction(() => document.querySelector('.model-select')?.textContent.includes('Example model'));
      }
      await paste(editor, prompt);
      assert.equal(await editor.locator('h1').textContent(), 'This is a heading');
      assert.equal(await editor.locator('.code-language-trigger').nth(0).textContent(), 'Auto (Plain text)');
      assert.equal(await editor.locator('.code-language-trigger').nth(1).textContent(), 'Auto (JavaScript)');
      await editor.locator('.code-token-function').first().waitFor();
      const code = editor.locator('pre code').nth(1);
      await code.click();
      await page.keyboard.press('Control+End');
      await page.keyboard.type(' // edited');
      await page.keyboard.press('Enter');
      await page.keyboard.type('const ready = true;');
      await page.waitForFunction(() => document.querySelector('.editor pre:last-child') || document.querySelector('.code-token-keyword'));
      assert.match(await code.textContent(), /edited\nconst ready = true;/);
      assert.equal(await page.evaluate(() => window.__composerMessages.filter(m => m.type === 'sendMessage').length), 0);
      const trigger = editor.locator('.code-language-trigger').nth(1);
      await trigger.click();
      const bounds = await page.locator('.code-language-menu').boundingBox();
      assert(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, 'picker fits viewport');
      await page.getByRole('combobox', { name: 'Search languages' }).fill('typescript');
      await page.keyboard.press('Enter');
      assert.equal(await trigger.textContent(), 'TypeScript');
      await page.keyboard.press('Control+z');
      assert.equal(await trigger.textContent(), 'Auto (JavaScript)');
      await trigger.click();
      await page.screenshot({ path: path.join(output, `composer-markdown-${theme}-${width}.png`), animations: 'disabled' });
      await page.keyboard.press('Escape');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no page overflow');
      // Recreate the webview, then deliver the saved draft for the same new-chat
      // focus key. Its Markdown must render without any input or tab switch.
      const savedDraft = await page.evaluate(() => [...window.__composerMessages].reverse()
        .find(message => message.type === 'updateChatWorkspace' && message.state.drafts?.['\u0000shared'])?.state.drafts['\u0000shared']);
      assert(savedDraft?.text.includes('# This is a heading'), 'draft was persisted as Markdown');
      await page.reload();
      await page.waitForFunction(() => document.querySelector('.model-select')?.textContent.includes('Example model'));
      await send(page, { type: 'initialState', mode: 'agent', selectedModel: 'preview-model', turns: [],
        personas: [], activePersonaId: 'default', hasProviders: true, runningConvIds: [],
        workspaceState: { openTabs: [], drafts: { '\u0000shared': savedDraft } } });
      await editor.locator('h1').waitFor();
      assert.equal(await editor.locator('h1').textContent(), 'This is a heading');
      assert.equal(await editor.locator('.composer-code-block').count(), 2);
      assert.equal(await editor.locator('.code-language-trigger').nth(1).textContent(), 'Auto (JavaScript)');
      await editor.locator('.code-token-function').first().waitFor();
      assert.match(await editor.locator('pre code').nth(1).textContent(), /const ready = true;/);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      const messages = await page.evaluate(() => window.__composerMessages);
      const sent = messages.find(m => (m.type === 'sendMessage' || m.type === 'send') && typeof m.text === 'string');
      assert(sent, `send protocol missing: ${messages.map(m => m.type).join(',')}`);
      assert.match(sent.text, /# This is a heading/);
      assert.match(sent.text, /```\nconsole\.log/);
      assert.match(sent.text, /const ready = true;/);
      assert(!sent.text.includes('Auto ('), 'toolbar labels never enter sent prompt');
      await send(page, { type: 'initialState', activeId: 'markdown-edit', mode: 'agent', selectedModel: 'preview-model', turns: [{ role: 'user', text: prompt }], personas: [], activePersonaId: 'default', hasProviders: true, runningConvIds: [], workspaceState: { openTabs: ['markdown-edit'], drafts: {} } });
      await page.locator('.msg.user .bubble').first().hover();
      await page.getByRole('button', { name: 'Edit message', exact: true }).first().click();
      const edit = page.getByRole('textbox', { name: 'Edit message', exact: true });
      assert.equal(await edit.locator('h1').textContent(), 'This is a heading');
      assert.equal(await edit.locator('.composer-code-block').count(), 2);
      assert.deepEqual(errors, []);
      console.log(`Passed Markdown composer ${theme}/${width}`);
      await context.close();
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
