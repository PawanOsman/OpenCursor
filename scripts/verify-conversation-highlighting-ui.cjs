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

const examples = [
  { fence: 'javascript', language: 'javascript', code: 'const message = "<button onclick=\'noop()\'>مرحبا</button>";\nconsole.log(message);' },
  { fence: 'python', language: 'python', code: 'def greet(name):\n    return "Hello " + name' },
  { fence: '', language: 'javascript', code: 'console.log("pawan");' },
  { fence: 'auto', language: 'python', code: 'print("hello")' },
  { fence: 'plaintext', language: 'plaintext', code: 'const answer = 42;\nconsole.log("keep plain");' },
];
const markdown = 'مرحبا، هذه أمثلة برمجية.\n\n' + examples.map(example => `\`\`\`${example.fence}\n${example.code}\n\`\`\``).join('\n\n');
const state = {
  type: 'initialState', activeId: 'highlighting-fixture', mode: 'agent', selectedModel: 'preview-model',
  turns: [{ role: 'user', text: markdown }, { role: 'assistant', blocks: [{ kind: 'text', text: markdown }] }],
  personas: [], activePersonaId: 'default', hasProviders: true, runningConvIds: [],
  workspaceState: { openTabs: ['highlighting-fixture'], drafts: {} },
};
const send = (page, data) => page.evaluate(data => window.dispatchEvent(new MessageEvent('message', { data })), data);

async function assertConversation(page, label) {
  for (const role of ['user', 'assistant']) {
    const message = page.locator(`.msg.${role}:not(.editing) .bubble .markdown-content`).first();
    await message.waitFor({ timeout: 5000 }).catch(async error => {
      console.error(`${label}: ${await page.locator('.chat-messages').textContent()}`);
      throw error;
    });
    const codes = message.locator('pre > code');
    assert.equal(await codes.count(), examples.length, `${label}/${role}: all code blocks render`);
    assert.equal(await message.locator('p').first().evaluate(element => getComputedStyle(element).direction), 'rtl', `${label}/${role}: prose retains its own direction`);
    for (let index = 0; index < examples.length; index++) {
      const example = examples[index], code = codes.nth(index);
      assert.equal(await code.textContent(), example.code + '\n', `${label}/${role}/${index}: source text is preserved`);
      assert.equal(await code.getAttribute('class'), `language-${example.language}`, `${label}/${role}/${index}: selected or detected language`);
      assert.equal(await code.evaluate(element => getComputedStyle(element).direction), 'ltr', `${label}/${role}/${index}: code stays LTR`);
      const tokens = code.locator('[class^="code-token-"]');
      if (example.language === 'plaintext') {
        assert.equal(await tokens.count(), 0, `${label}/${role}: explicit plain text disables highlighting`);
      } else {
        assert(await tokens.count() > 0, `${label}/${role}/${index}: token spans render`);
        const colors = await tokens.first().evaluate(element => ({ token: getComputedStyle(element).color, code: getComputedStyle(element.closest('code')).color }));
        assert.notEqual(colors.token, colors.code, `${label}/${role}/${index}: syntax color is visible`);
      }
    }
    assert.equal(await message.locator('pre button, pre script').count(), 0, `${label}/${role}: HTML examples stay text`);
  }
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: no viewport overflow`);
  assert(await page.locator('.msg .markdown-content pre').evaluateAll(elements => elements.every(element => {
    const bounds = element.getBoundingClientRect(), parent = element.closest('.bubble').getBoundingClientRect();
    return bounds.left >= parent.left - 1 && bounds.right <= parent.right + 1;
  })), `${label}: code blocks fit their messages`);
}

async function main() {
  const output = path.resolve(__dirname, '../dist/visual-qa');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.OPENCURSOR_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    for (const theme of ['light', 'dark']) for (const width of [375, 900]) {
      const context = await browser.newContext({ viewport: { width, height: 950 }, reducedMotion: 'reduce' });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
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
      await page.goto(`${process.env.OPENCURSOR_PREVIEW_ORIGIN || 'http://127.0.0.1:4178'}/sidebar?theme=${theme}`);
      await page.waitForFunction(() => document.querySelector('.model-select')?.textContent.includes('Example model'));
      await send(page, state);
      await assertConversation(page, `${theme}/${width}/initial`);

      // Editing and cancelling must return to the highlighted conversation view.
      await page.locator('.msg.user .bubble').first().hover();
      await page.getByRole('button', { name: 'Edit message', exact: true }).first().click();
      const editor = page.getByRole('textbox', { name: 'Edit message', exact: true });
      await editor.waitFor();
      assert.equal(await editor.locator('.composer-code-block').count(), examples.length);
      await page.getByTitle('Cancel edit (Esc)', { exact: true }).click();
      await assertConversation(page, `${theme}/${width}/edit-off`);

      // Stored messages are highlighted as soon as the host restores them.
      await page.reload();
      await page.waitForFunction(() => document.querySelector('.model-select')?.textContent.includes('Example model'));
      await send(page, state);
      await assertConversation(page, `${theme}/${width}/restored`);
      await page.screenshot({ path: path.join(output, `conversation-highlighting-${theme}-${width}.png`), animations: 'disabled' });
      assert.deepEqual(errors, []);
      console.log(`Passed conversation highlighting ${theme}/${width}`);
      await context.close();
    }
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
