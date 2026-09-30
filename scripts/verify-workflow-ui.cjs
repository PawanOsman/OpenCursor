/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// Visual regression harness for production bundles served by preview-webviews.cjs.
const { chromium } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

async function main() {
  const executablePath = process.env.OPENCURSOR_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const origin = process.env.OPENCURSOR_PREVIEW_ORIGIN || 'http://127.0.0.1:4174';
  const output = path.resolve(__dirname, '../dist/visual-qa');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    for (const width of [380, 280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${origin}/sidebar?state=workflow&theme=dark`);
      await page.getByRole('region', { name: 'Conversation goal' }).waitFor();
      await page.getByText('Interrupted:', { exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, `workflow-${width}.png`) });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `Overflow at ${width}px`);
      await page.getByTitle('More', { exact: true }).click();
      await page.getByRole('button', { name: 'Review code', exact: true }).click();
      await page.getByRole('dialog').waitFor();
      await page.getByRole('combobox', { name: 'Review scope' }).click();
      await page.getByRole('option', { name: 'Compare with a branch' }).click();
      await page.getByLabel('Base branch').fill('main');
      await page.screenshot({ path: path.join(output, `review-${width}.png`) });
      const box = await page.getByRole('dialog').boundingBox();
      assert(box && box.x >= 0 && box.x + box.width <= width, `Dialog outside ${width}px viewport`);
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      assert.deepEqual(errors, []);
      await page.close();
    }
    const settings = await browser.newPage({ viewport: { width: 1024, height: 900 } });
    const errors = []; settings.on('pageerror', error => errors.push(error.message));
    await settings.goto(`${origin}/settings?section=rules&theme=light`);
    await settings.getByRole('button', { name: 'Manage plugins' }).waitFor();
    await settings.getByRole('button', { name: 'Browser settings' }).waitFor();
    await settings.screenshot({ path: path.join(output, 'settings-1024.png') });
    assert.deepEqual(errors, []);
    console.log('Workflow, review keyboard dismissal, 280/380px bounds and plugin settings verified. Screenshots: ' + output);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
