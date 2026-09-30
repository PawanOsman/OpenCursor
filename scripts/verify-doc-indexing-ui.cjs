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

const origin = process.env.OPENCURSOR_PREVIEW_ORIGIN || 'http://127.0.0.1:4178';
const screenshots = path.resolve(__dirname, '../dist/visual-qa');
const source = { id: 'doc-fixture', name: 'Streaming reference', url: 'https://example.test/docs/api', scope: 'section', scopePath: '/docs/api', maxPages: 30,
  focus: 'Streaming, retries', excludePaths: ['/docs/api/archive'], useAi: false, pages: 12, chunks: 42, indexedAt: 1_800_000_000_000,
  resolvedScope: 'https://example.test/docs/api', stopReason: 'Previous plan completed', error: 'Old attempt failed' };

const send = (page, data) => page.evaluate(data => window.dispatchEvent(new MessageEvent('message', { data })), data);
async function fits(page, label) {
  const overflow = await page.evaluate(() => ({ document: document.documentElement.scrollWidth > innerWidth,
    docs: [...document.querySelectorAll('.docs-card, .doc-form, .doc-row, .doc-field, .doc-actions')].filter(node => node.scrollWidth > node.clientWidth + 2).map(node => node.className) }));
  assert.equal(overflow.document, false, `${label}: document overflow`);
  assert.deepEqual(overflow.docs, [], `${label}: docs overflow`);
}

async function failureLogChecks(page, label) {
  const failure = 'The documentation source did not return readable content. Check the source URL and try again.';
  await send(page, { type: 'docSources', docs: [{ ...source, error: 'A previous attempt failed.' }], status: {
    sourceId: source.id, phase: 'error', done: 20, total: 20, error: failure, stopReason: failure, scope: source.resolvedScope,
  } });
  await page.getByRole('alert').filter({ hasText: failure }).waitFor();
  assert.equal(await page.getByText(failure, { exact: true }).count(), 1, `${label}: failure explanation should appear once`);
  assert.equal(await page.getByText('A previous attempt failed.', { exact: true }).count(), 0, `${label}: old failure should be replaced`);
  await page.getByText('Indexing failed — previous index kept', { exact: true }).waitFor();

  const log = page.getByRole('log', { name: `Indexing logs for ${source.name}`, exact: true });
  const toggle = page.getByRole('button', { name: `Indexing logs for ${source.name}`, exact: true });
  const lines = Array.from({ length: 80 }, (_, index) => `INDEX https://example.test/docs/api/section-${index + 1} — reading selected documentation`);
  lines.push('FAILED Indexing finished without new usable pages; previous index preserved.');
  const receiveLogs = async () => {
    await send(page, { type: 'docLogs', id: source.id, lines });
    await page.waitForFunction(last => document.querySelector('.doc-logs .doc-log-line:last-child')?.textContent === last, lines[lines.length - 1]);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const waitAtEnd = async () => {
    await page.waitForFunction(() => {
      const viewport = document.querySelector('.doc-logs');
      return viewport && viewport.scrollHeight > viewport.clientHeight && viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 2;
    });
  };
  await receiveLogs();
  await waitAtEnd();
  await log.scrollIntoViewIfNeeded();
  const latestVisible = await log.evaluate(viewport => {
    const latest = viewport.lastElementChild.getBoundingClientRect();
    const clip = viewport.getBoundingClientRect();
    return latest.top >= clip.top && latest.bottom <= clip.bottom + 1;
  });
  assert.equal(latestVisible, true, `${label}: latest failure log should be visible`);

  await log.evaluate(viewport => viewport.scrollTo({ top: 20, behavior: 'instant' }));
  await page.waitForFunction(() => document.querySelector('.doc-logs')?.scrollTop <= 21);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const readingPosition = await log.evaluate(viewport => viewport.scrollTop);
  lines.push('INFO Additional diagnostic information arrived.');
  await receiveLogs();
  assert.ok(Math.abs(await log.evaluate(viewport => viewport.scrollTop) - readingPosition) <= 2, `${label}: incoming logs must not pull a reader to the end`);

  await log.evaluate(viewport => viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'instant' }));
  await waitAtEnd();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  lines.push('INFO Logs are following the latest entry again.');
  await receiveLogs();
  await waitAtEnd();

  await log.evaluate(viewport => viewport.scrollTo({ top: 20, behavior: 'instant' }));
  await page.waitForFunction(() => document.querySelector('.doc-logs')?.scrollTop <= 21);
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await toggle.click();
  await waitAtEnd();
  await fits(page, `${label} failure logs`);
  await log.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(screenshots, `docs-failure-${label}.png`), fullPage: true });
}

(async () => {
  await fs.mkdir(screenshots, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    for (const theme of ['light', 'dark']) for (const width of [375, 900, 2048]) {
      const label = `${theme}-${width}`;
      const page = await browser.newPage({ viewport: { width, height: 1100 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        window.__docPosts = [];
        let factory;
        Object.defineProperty(window, 'acquireVsCodeApi', {
          configurable: true, set(value) { factory = value; },
          get() { return () => { const api = factory(); const original = api.postMessage;
            api.postMessage = message => { window.__docPosts.push(message); original(message); }; return api; }; },
        });
      });
      await page.goto(`${origin}/settings?theme=${theme}&section=indexing`);
      await page.getByRole('button', { name: 'Add Doc', exact: true }).click();
      await page.getByLabel('Name', { exact: true }).fill('Streaming reference');
      await page.getByLabel('Documentation URL', { exact: true }).fill('https://example.test/docs');
      await page.getByLabel(/Topics to prioritize/).fill('Streaming, retries');
      await page.getByRole('switch', { name: 'AI-assisted page selection' }).uncheck();
      await page.getByRole('combobox', { name: /Index scope/ }).click();
      await page.getByRole('option', { name: 'This page only', exact: true }).click();
      await page.getByRole('combobox', { name: /Index scope/ }).click();
      await page.getByRole('option', { name: 'Documentation section', exact: true }).click();
      await page.getByRole('button', { name: 'Advanced limits', exact: true }).click();
      await page.getByLabel(/Section path/).fill('/docs/api');
      await page.getByLabel(/Page budget/).fill('30');
      await page.getByLabel(/Excluded paths/).fill('/docs/api/archive');
      await page.locator('.doc-form').scrollIntoViewIfNeeded();
      await fits(page, `${label} form`);
      await page.screenshot({ path: path.join(screenshots, `docs-form-${label}.png`), fullPage: true });
      await page.getByRole('button', { name: 'Add and index', exact: true }).click();
      const request = await page.evaluate(() => window.__docPosts.find(message => message.type === 'addDoc'));
      assert.ok(request?.requestId);
      assert.equal(request.scope, 'section'); assert.equal(request.useAi, false); assert.equal(request.maxPages, 30);
      assert.deepEqual(request.excludePaths, ['/docs/api/archive']);
      await send(page, { type: 'docActionResult', requestId: request.requestId, ok: true });
      await send(page, { type: 'docSources', docs: [source], status: { indexing: source.id, sourceId: source.id, phase: 'indexing', done: 7, total: 20, indexed: 5, fetched: 9, skipped: 3, scope: 'https://example.test/docs/api' } });
      await page.getByText('Indexing selected pages', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: `Edit ${source.name}`, exact: true }).isDisabled(), true);
      assert.equal(await page.getByText('Previous plan completed', { exact: true }).count(), 0);
      await page.getByRole('button', { name: `Indexing logs for ${source.name}`, exact: true }).click();
      await send(page, { type: 'docLogs', id: source.id, lines: ['Discovery completed with a fixed 20-page plan.', 'SKIP https://example.test/docs/api/archive — excluded path', 'INDEX https://example.test/docs/api/streaming'] });
      await page.getByText('Discovery completed with a fixed 20-page plan.', { exact: true }).waitFor();
      await fits(page, `${label} progress`);
      await page.locator('.doc-entry').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(screenshots, `docs-progress-${label}.png`), fullPage: true });
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Cancelling…', exact: true }).isDisabled(), true);
      const cancels = await page.evaluate(() => window.__docPosts.filter(message => message.type === 'cancelDocIndex'));
      assert.deepEqual(cancels, [{ type: 'cancelDocIndex', id: source.id }]);
      await send(page, { type: 'docsStatus', status: { sourceId: source.id, phase: 'cancelled', done: 7, total: 20, scope: 'https://example.test/docs/api', stopReason: 'Stopped by user' } });
      await page.getByText('Cancelled — previous index kept', { exact: true }).waitFor();
      await send(page, { type: 'docSources', docs: [{ ...source, error: undefined, stopReason: 'Selected plan completed', pages: 18 }], status: { sourceId: source.id, phase: 'complete', done: 20, total: 20, scope: 'https://example.test/docs/api', stopReason: 'Selected plan completed' } });
      await page.getByText('Selected plan completed', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: `Edit ${source.name}`, exact: true }).isEnabled(), true);
      await fits(page, `${label} complete`);
      await failureLogChecks(page, label);
      assert.deepEqual(errors, [], `${label}: browser errors`);
      await page.close();
      process.stdout.write(`${label}: form, selection, progress, cancellation, saved scope, single failure, latest log, scroll follow, no overflow\n`);
    }
  } finally { await browser.close(); }
})().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
