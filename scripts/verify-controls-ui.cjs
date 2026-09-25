/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// Production settings checks against preview-webviews.cjs; fixtures stay in the
// browser's mock bridge and never connect providers or launch local runtimes.
const { chromium } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

const sections = ['general', 'agents', 'behavior', 'providers', 'models', 'llamacpp', 'ollama', 'usage', 'personas', 'rules', 'subagents', 'mcp', 'hooks', 'indexing', 'advanced', 'about'];
const viewports = [
  { width: 2560, height: 1440 },
  { width: 1920, height: 1080 },
  { width: 1600, height: 1200 },
  { width: 1024, height: 900 },
  { width: 640, height: 900 },
  { width: 375, height: 800 },
];
const messages = [
  { type: 'features', features: {
    providers: [{ id: 'popular:deepseek', kind: 'deepseek', name: 'DeepSeek', enabled: true, hasKey: true, baseUrl: 'https://api.deepseek.com', apiKeyBalance: 'round-robin', apiKeys: [{ id: 'fixture-key', label: 'Preview key', hasKey: true }] }],
    subagents: [{ id: 'reviewer', name: 'Code Reviewer', description: 'Review changes and report actionable findings.', prompt: 'Inspect changes.', readonly: true }],
    teams: [{ id: 'team', name: 'Review team', description: 'Parallel review specialists', subagentIds: ['reviewer'] }],
    activeTeamIds: ['team'],
    hooks: [{ id: 'hook', event: 'afterRun', command: 'npm test', enabled: true }],
    mcpServers: [{ name: 'Preview tools', transport: 'stdio', command: 'node', args: ['tools.js'], enabled: true }],
    llamacppModels: [{ id: 'local-fixture', name: 'Local preview model', path: 'C:/Preview/model.gguf', size: 5000000000 }],
  },
    modelCatalog: [{ id: 'deepseek-chat', name: 'DeepSeek Chat', kind: 'deepseek', providerName: 'DeepSeek' }],
    mcpStatus: [{ name: 'Preview tools', connected: true, toolCount: 3 }],
    builtinPersonas: [{ id: 'default', name: 'Default', description: 'A helpful coding agent', prompt: '', builtin: true }],
    rules: [{ file: 'AGENTS.md', path: 'AGENTS.md', description: 'Project conventions', alwaysApply: true, globs: '' }],
    skills: [{ name: 'Project review', description: 'Review the current workspace and summarize findings.', path: 'skills/review/SKILL.md' }],
  },
  { type: 'llamacppStatus', status: { installed: true, running: {}, loading: {}, errors: {}, logs: {}, version: 'preview' } },
  { type: 'ollamaStatus', status: { installed: true, reachable: true, endpoint: 'http://localhost:11434', pulling: {}, errors: {}, loaded: {}, states: {} } },
  { type: 'ollamaModels', models: [{ name: 'local-preview:8b', size: 5000000000, details: { parameter_size: '8B', quantization_level: 'Q4_K_M' } }] },
  { type: 'oauthStatus', status: { accounts: [{ id: 'preview-account', kind: 'github', email: 'preview@example.test' }], errors: {} } },
  { type: 'usageData', usage: { 'preview-model': { promptTokens: 1024, completionTokens: 320, requests: 3, lastUsed: 1 } } },
];

async function send(page, data) {
  await page.evaluate(message => window.dispatchEvent(new MessageEvent('message', { data: message })), data);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function inspect(page, label, { atTop = false } = {}) {
  const state = await page.evaluate(() => {
    const content = document.querySelector('.content');
    const inner = document.querySelector('.content-inner');
    const pageStyle = getComputedStyle(document.querySelector('.settings-page'));
    const bodyStyle = getComputedStyle(document.body);
    const title = document.querySelector('.page-title');
    const save = document.querySelector('.btn-save');
    const bounds = element => {
      if (!element) return null;
      const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
      return { left, top, right, bottom, width, height };
    };
    const control = document.querySelector('input:not([type=hidden]):not([type=checkbox]), textarea, .oc-select-trigger');
    const style = control && getComputedStyle(control);
    const fields = [...document.querySelectorAll('input[type=checkbox]:not(.switch input)')].map(element => ({ appearance: getComputedStyle(element).appearance, width: element.getBoundingClientRect().width }));
    const overflow = [];
    const innerBounds = bounds(inner);
    const panelOverflow = [...document.querySelectorAll('.content-inner .settings-group, .content-inner .feature-card, .content-inner .cfg-table-scroll, .content-inner .rss-list')]
      .map(element => ({ element: element.className, bounds: bounds(element) }))
      .filter(item => item.bounds.width && (item.bounds.left < innerBounds.left - 1 || item.bounds.right > innerBounds.right + 1));
    const rows = [...document.querySelectorAll('.content .row')];
    for (const row of rows) {
      const rowBounds = bounds(row);
      for (const element of row.querySelectorAll('.row-control, .row-control > *, .row-text')) {
        const rect = bounds(element);
        if (!rect.width || !rect.height) continue;
        if (rect.left < rowBounds.left - 1 || rect.right > rowBounds.right + 1)
          overflow.push({ row: row.querySelector('.row-title')?.textContent, element: element.className || element.tagName, bounds: rect, rowBounds });
      }
    }
    return {
      title: title?.textContent,
      viewport: innerWidth, pageWidth: document.documentElement.scrollWidth,
      contentWidth: content?.clientWidth, contentScrollWidth: content?.scrollWidth,
      contentScrollTop: content?.scrollTop,
      contentBounds: bounds(content), innerBounds, titleBounds: bounds(title), saveBounds: bounds(save),
      layoutBounds: bounds(document.querySelector('.layout')),
      sidebarBounds: bounds(document.querySelector('.sidebar')),
      contentGutter: { left: parseFloat(pageStyle.paddingLeft), right: parseFloat(pageStyle.paddingRight) },
      bodyPadding: { left: parseFloat(bodyStyle.paddingLeft), right: parseFloat(bodyStyle.paddingRight) },
      hostDefaultsPresent: !!document.querySelector('[data-host-defaults]'),
      rowCount: rows.length, overflow, panelOverflow,
      nativeSelects: document.querySelectorAll('select').length,
      input: style ? { borderWidth: style.borderTopWidth, borderColor: style.borderTopColor, borderStyle: style.borderTopStyle, radius: style.borderRadius } : null,
      fields,
    };
  });
  assert.equal(state.nativeSelects, 0, `${label}: native select remains`);
  assert(state.hostDefaultsPresent, `${label}: webview host padding fixture is missing`);
  assert.deepEqual(state.bodyPadding, { left: 0, right: 0 }, `${label}: webview host padding leaves an outer gap`);
  assert(Math.abs(state.layoutBounds.left) <= 1 && Math.abs(state.layoutBounds.right - state.viewport) <= 1, `${label}: settings layout does not fill the viewport`);
  assert(Math.abs(state.sidebarBounds.left) <= 1, `${label}: navigation has an outer left gap`);
  assert(state.pageWidth <= state.viewport + 1, `${label}: page overflow`);
  assert(state.contentScrollWidth <= state.contentWidth + 1, `${label}: content overflow ${state.contentScrollWidth}/${state.contentWidth}`);
  assert.deepEqual(state.overflow, [], `${label}: setting text or controls overflow their row`);
  assert.deepEqual(state.panelOverflow, [], `${label}: settings panels extend outside the content column`);
  assert(state.innerBounds.left >= state.contentBounds.left, `${label}: content starts outside the scroll area`);
  assert(state.innerBounds.right <= state.contentBounds.left + state.contentWidth, `${label}: content overlaps the scrollbar`);
  assert(Math.abs(state.innerBounds.left - state.contentBounds.left - state.contentGutter.left) <= 1, `${label}: extra left space beyond the content gutter`);
  assert(Math.abs(state.contentBounds.left + state.contentWidth - state.innerBounds.right - state.contentGutter.right) <= 1, `${label}: extra right space beyond the content gutter`);
  assert(Math.abs(state.saveBounds.right - state.innerBounds.right) <= 2, `${label}: Save is not aligned to the content column`);
  assert(state.saveBounds.left >= state.contentBounds.left && state.saveBounds.right <= state.contentBounds.left + state.contentWidth, `${label}: Save extends outside the content area`);
  if (state.viewport >= 1600) {
    assert(state.innerBounds.width >= 1000, `${label}: content does not expand on a large screen`);
    assert(state.innerBounds.left - state.sidebarBounds.right <= 96, `${label}: excessive gap between navigation and settings`);
  }
  if (atTop) {
    assert(state.contentScrollTop <= 1, `${label}: section navigation retained the previous scroll position`);
    assert(state.titleBounds.top >= state.contentBounds.top && state.titleBounds.bottom <= state.contentBounds.bottom, `${label}: page title is not visible after navigation`);
  }
  if (state.input) { assert.equal(state.input.borderWidth, '1px', `${label}: missing field border`); assert.equal(state.input.borderStyle, 'solid'); }
  for (const field of state.fields) { assert.equal(field.appearance, 'none', `${label}: browser checkbox appearance`); assert(field.width >= 15 && field.width <= 18, `${label}: checkbox width ${field.width}`); }
  return state;
}

async function popupBounds(page, width) {
  const popup = page.locator('[data-select-popup]');
  await popup.waitFor();
  const bounds = await popup.boundingBox();
  assert(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, 'Select popup exceeds viewport');
  const border = await popup.evaluate(element => getComputedStyle(element).borderTopWidth);
  assert.equal(border, '1px');
}

async function main() {
  const origin = process.env.OPENCURSOR_PREVIEW_ORIGIN || 'http://127.0.0.1:4178';
  const output = path.resolve(__dirname, '../dist/visual-qa');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.OPENCURSOR_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const results = [];
  try {
    for (const theme of ['light', 'dark']) for (const viewport of viewports) {
      const { width, height } = viewport;
      const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route(url => url.pathname === '/settings', async route => {
        const response = await route.fetch();
        const html = await response.text();
        await route.fulfill({ response, body: html.replace('<head>', '<head><style data-host-defaults>body { padding: 0 20px; }</style>') });
      });
      await page.goto(`${origin}/settings?theme=${theme}`);
      await page.locator('.page-title').waitFor();
      await page.waitForTimeout(80);
      for (const message of messages) await send(page, message);
      const pages = [];
      for (const section of sections) {
        await send(page, { type: 'navigate', section });
        pages.push({ section, ...await inspect(page, `${theme}/${width}/${section}`, { atTop: true }) });
        if (['general', 'behavior', 'providers', 'models', 'subagents'].includes(section))
          await page.screenshot({ animations: 'disabled', path: path.join(output, `controls-${theme}-${width}-${section}.png`) });
        for (const scroller of await page.locator('.cfg-table-scroll').all()) {
          if (!await scroller.evaluate(element => element.scrollWidth > element.clientWidth + 1)) continue;
          assert.equal(await scroller.evaluate(element => getComputedStyle(element).overflowX), 'auto', `${theme}/${width}/${section}: wide table cannot scroll locally`);
          const actions = scroller.locator('.c-actions button');
          const actionCount = await actions.count();
          if (actionCount) {
            const action = actions.last();
            if (actionCount > 1) {
              await actions.nth(actionCount - 2).focus();
              await page.keyboard.press('Tab');
            } else await action.focus();
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            assert(await action.evaluate(element => element === document.activeElement), `${theme}/${width}/${section}: final table action cannot receive keyboard focus`);
            const actionBounds = await action.boundingBox();
            const tableBounds = await scroller.boundingBox();
            assert(actionBounds.x >= tableBounds.x - 1 && actionBounds.x + actionBounds.width <= tableBounds.x + tableBounds.width + 1, `${theme}/${width}/${section}: focused table action remains clipped`);
            assert.equal(await page.locator('.content').evaluate(element => element.scrollLeft), 0, `${theme}/${width}/${section}: table focus scrolls the entire page sideways`);
          }
        }
        await page.locator('.content').evaluate(element => { element.scrollTop = element.scrollHeight; });
        if (section === 'general') {
          const lastRow = page.locator('.settings-group .row').last();
          const rowBounds = await lastRow.boundingBox();
          const saveBounds = await page.locator('.btn-save').boundingBox();
          assert(rowBounds.y + rowBounds.height <= saveBounds.y, `${theme}/${width}: last setting is hidden behind Save`);
          await page.screenshot({ animations: 'disabled', path: path.join(output, `controls-${theme}-${width}-general-bottom.png`) });
        }
      }

      await send(page, { type: 'navigate', section: 'agents' });
      await page.locator('.content').evaluate(element => { element.scrollTop = element.scrollHeight; });
      await page.locator('.sidebar').getByRole('button', { name: 'General', exact: true }).click();
      await inspect(page, `${theme}/${width}/navigation-click`, { atTop: true });

      const titles = page.getByRole('switch', { name: 'Auto-Generate Chat Titles', exact: true });
      const checked = await titles.isChecked();
      await titles.focus();
      await titles.press('Space');
      assert.equal(await titles.isChecked(), !checked, 'Space did not toggle the custom switch');
      assert.equal(await titles.evaluate(element => getComputedStyle(element.nextElementSibling).outlineWidth), '2px', 'Missing switch keyboard focus');
      await titles.press('Space');

      await send(page, { type: 'navigate', section: 'agents' });
      const textSize = page.getByRole('combobox', { name: 'Text size' });
      await textSize.focus();
      await textSize.press('Enter');
      await popupBounds(page, width);
      await textSize.press('End');
      await textSize.press('Enter');
      assert.equal(await textSize.textContent(), 'Large');
      assert.equal(await page.locator('[data-select-popup]').count(), 0);
      assert(await textSize.evaluate(element => element === document.activeElement));

      await send(page, { type: 'navigate', section: 'providers' });
      await page.getByRole('button', { name: 'Custom Providers', exact: true }).click();
      await page.getByRole('button', { name: 'Add provider', exact: true }).click();
      await page.getByRole('button', { name: 'OpenAI-compatible endpoint', exact: true }).click();
      const providerDialog = page.getByRole('dialog');
      const protocol = providerDialog.getByRole('combobox');
      await protocol.click();
      await popupBounds(page, width);
      await page.screenshot({ animations: 'disabled', path: path.join(output, `controls-${theme}-${width}-provider-menu.png`) });
      await protocol.press('Escape');
      assert.equal(await page.locator('[data-select-popup]').count(), 0);
      assert.equal(await page.getByRole('dialog').count(), 1);
      await protocol.press('Escape');
      assert.equal(await page.getByRole('dialog').count(), 0);

      await send(page, { type: 'navigate', section: 'subagents' });
      await page.getByRole('button', { name: 'New', exact: true }).first().click();
      const parentDialog = page.getByRole('dialog');
      const name = parentDialog.getByPlaceholder('Backend Developer');
      assert(await name.evaluate(element => element === document.activeElement), 'Editor initial focus not on name');
      await parentDialog.locator('.msel-trigger').click();
      const modelDialog = page.locator('[data-model-dialog]');
      await modelDialog.waitFor();
      const search = modelDialog.getByPlaceholder('Search models…');
      await search.fill('Example');
      await page.screenshot({ animations: 'disabled', path: path.join(output, `controls-${theme}-${width}-nested-model.png`) });
      assert.equal(await page.getByRole('dialog').count(), 2);
      await search.press('Escape');
      assert.equal(await page.getByRole('dialog').count(), 1, 'Escape closed editor with nested model picker');
      assert(await parentDialog.locator('.msel-trigger').evaluate(element => element === document.activeElement));
      await parentDialog.locator('.msel-trigger').press('Enter');
      await modelDialog.getByPlaceholder('Search models…').fill('Example');
      await modelDialog.getByPlaceholder('Search models…').press('Enter');
      assert.equal(await page.getByRole('dialog').count(), 1);
      assert((await parentDialog.locator('.msel-trigger').textContent()).includes('Example model'));
      await parentDialog.locator('textarea').focus();
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('dialog').count(), 0);

      await send(page, { type: 'navigate', section: 'llamacpp' });
      await page.getByRole('button', { name: 'Config', exact: true }).click();
      await inspect(page, `${theme}/${width}/local-config`);
      await page.getByRole('combobox', { name: 'Flash attention' }).click();
      await popupBounds(page, width);
      await page.getByRole('option', { name: 'off', exact: true }).click();
      await page.screenshot({ animations: 'disabled', path: path.join(output, `controls-${theme}-${width}-runtime-config.png`) });
      await send(page, { type: 'features', features: { ...messages[0].features, indexingEnabled: false } });
      await send(page, { type: 'navigate', section: 'indexing' });
      const disabled = page.getByRole('switch', { name: 'Index New Folders', exact: true });
      assert(await disabled.isDisabled(), 'Disabled switch remains interactive');
      assert(Number(await disabled.evaluate(element => getComputedStyle(element.parentElement).opacity)) < 1, 'Disabled switch has no visible state');
      assert.deepEqual(errors, []);
      results.push({ theme, width, height, pages, navigationScroll: 'passed', rowBounds: 'passed', saveAlignment: 'passed', tableKeyboard: 'passed', customSelection: 'passed', switches: 'passed', disabled: 'passed', nestedDialogs: 'passed', localConfig: 'passed', errors });
      await page.close();
    }
  } finally {
    await browser.close();
    await fs.writeFile(path.join(output, 'controls-results.json'), JSON.stringify(results, null, 2));
  }
  console.log(`Settings controls passed ${results.length} theme/width combinations and ${results.reduce((total, result) => total + result.pages.length, 0)} page states. Screenshots: ${output}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
