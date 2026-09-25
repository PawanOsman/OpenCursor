/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// Production visual/interaction checks for resting-state controls and activity.
// Run after pnpm package, with scripts/preview-webviews.cjs on port 4174.
const { chromium } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

async function frameSnapshot(locator) {
  return locator.evaluate(el => {
    const style = getComputedStyle(el);
    const bounds = el.getBoundingClientRect();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const rgba = color => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    };
    // Resolve translucent surfaces over their ancestors to assess the actual
    // adjacent surface, rather than comparing against "transparent".
    const ancestors = [];
    for (let node = el; node; node = node.parentElement) ancestors.unshift(node);
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 1, 1);
    for (const node of ancestors) {
      context.fillStyle = getComputedStyle(node).backgroundColor;
      context.fillRect(0, 0, 1, 1);
    }
    const background = Array.from(context.getImageData(0, 0, 1, 1).data);
    return {
      borders: ['Top', 'Right', 'Bottom', 'Left'].map(side => ({
        side,
        width: style[`border${side}Width`],
        style: style[`border${side}Style`],
        color: style[`border${side}Color`],
        rgba: rgba(style[`border${side}Color`]),
      })),
      background,
      geometry: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    };
  });
}

function contrast(first, second) {
  const luminance = rgb => rgb.slice(0, 3).map(value => {
    const channel = value / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}

function assertVisibleFrame(snapshot, label) {
  for (const border of snapshot.borders) {
    assert.equal(border.width, '1px', `${label}: ${border.side} edge must be 1px`);
    assert.equal(border.style, 'solid', `${label}: ${border.side} edge must be solid`);
    assert.equal(border.rgba[3], 255, `${label}: ${border.side} edge must be opaque`);
    assert(contrast(border.rgba, snapshot.background) >= 1.25, `${label}: ${border.side} edge is too faint against its surface`);
  }
}

async function checkStableFrame(page, locator, label) {
  await page.evaluate(() => document.activeElement?.blur());
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200); // Let any existing hover transition finish.
  const resting = await frameSnapshot(locator);
  assertVisibleFrame(resting, label);
  await locator.hover();
  await page.waitForTimeout(200);
  const hovered = await frameSnapshot(locator);
  assertVisibleFrame(hovered, `${label} hovered`);
  assert.deepEqual(hovered.borders, resting.borders, `${label}: hover changed the frame`);
  assert.deepEqual(hovered.geometry, resting.geometry, `${label}: hover shifted the layout`);
  await page.mouse.move(0, 0);
  return resting;
}

async function main() {
  const origin = process.env.OPENCURSOR_PREVIEW_ORIGIN || 'http://127.0.0.1:4174';
  const output = path.resolve(__dirname, '../dist/visual-qa');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.OPENCURSOR_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const results = [];
  try {
    for (const theme of ['light', 'dark', 'high-contrast', 'high-contrast-light']) for (const width of [280, 380, 900]) {
      const page = await browser.newPage({ viewport: { width, height: 850 }, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${origin}/sidebar?state=activity&theme=${theme.endsWith('light') ? 'light' : 'dark'}`);
      if (theme.startsWith('high-contrast')) await page.evaluate(themeName => {
        document.body.className = `vscode-${themeName}`;
        const light = themeName.endsWith('light');
        const vars = {
          'editor-background': light ? '#fff' : '#000', foreground: light ? '#000' : '#fff',
          descriptionForeground: light ? '#333' : '#ddd', contrastBorder: light ? '#0f4a85' : '#fff',
          contrastActiveBorder: light ? '#0f4a85' : '#f38518', focusBorder: light ? '#0f4a85' : '#f38518',
          'input-background': light ? '#fff' : '#000', 'sideBar-background': light ? '#fff' : '#000',
          'menu-background': light ? '#fff' : '#000', 'dropdown-background': light ? '#fff' : '#000',
        };
        for (const [key, value] of Object.entries(vars)) document.documentElement.style.setProperty(`--vscode-${key}`, value);
      }, theme);
      const header = page.locator('.explore-head');
      await header.waitFor();
      assert.equal(await header.getAttribute('aria-expanded'), 'false');
      const collapsed = await checkStableFrame(page, page.locator('.explore-section'), `${theme}/${width} collapsed activity`);
      await page.screenshot({ path: path.join(output, `activity-${theme}-${width}-collapsed.png`) });
      await header.focus();
      await page.keyboard.press('Enter');
      assert.equal(await header.getAttribute('aria-expanded'), 'true');
      assert.equal(await page.locator('.read-line').count(), 2);
      assert.equal(await page.locator('.read-line').first().getAttribute('aria-label'), 'Open package.json, lines 1-14');
      await page.locator('.read-line').first().focus();
      assert.notEqual(await page.locator('.read-line').first().evaluate(el => getComputedStyle(el).outlineStyle), 'none');
      await page.locator('.read-line').first().press('Enter');
      // Blur focus to compare genuinely resting and pointer-hovered styles.
      await page.evaluate(() => document.activeElement.blur());
      await page.mouse.move(0, 0);
      const resting = await checkStableFrame(page, page.locator('.explore-section'), `${theme}/${width} expanded activity`);
      const readFrames = [];
      for (const [index, row] of (await page.locator('.read-line').all()).entries()) {
        readFrames.push(await checkStableFrame(page, row, `${theme}/${width} read row ${index + 1}`));
      }
      const listCards = page.locator('.explore-body .tool-card.compact-card');
      assert.equal(await listCards.count(), 1, 'The activity fixture must include a List tool card');
      const listFrame = await checkStableFrame(page, listCards.first(), `${theme}/${width} List card`);
      for (const selector of ['.explore-head .tchev', '.read-line .ricon']) {
        const visible = await page.locator(selector).first().evaluate(el => {
          const c = getComputedStyle(el); return c.visibility !== 'hidden' && c.display !== 'none' && Number(c.opacity) > .5;
        });
        assert(visible, `${selector} invisible at rest (${theme}/${width})`);
      }
      const message = page.locator('.msg.user').first();
      const actions = message.locator('.message-actions');
      await page.mouse.move(0, 0);
      assert.equal(await actions.evaluate(el => Number(getComputedStyle(el).opacity)), 0, 'Message actions are hidden at rest');
      await message.hover();
      assert.equal(await actions.evaluate(el => Number(getComputedStyle(el).opacity)), 1, 'Message hover reveals its actions');
      await page.mouse.move(0, 0);
      await page.screenshot({ path: path.join(output, `activity-${theme}-${width}-idle.png`) });
      await header.hover();
      const hovered = await frameSnapshot(page.locator('.explore-section'));
      assert.deepEqual(hovered.borders, resting.borders, 'Header hover must not change the activity frame');
      assert.deepEqual(hovered.geometry, resting.geometry, 'Header hover must not shift activity layout');
      await page.screenshot({ path: path.join(output, `activity-${theme}-${width}-hover.png`) });
      await header.focus();
      await page.keyboard.press('Space');
      assert.equal(await header.getAttribute('aria-expanded'), 'false');
      assert.equal(await page.locator('.read-line').count(), 0);
      const collapsedAgain = await checkStableFrame(page, page.locator('.explore-section'), `${theme}/${width} collapsed again`);
      assert.deepEqual(collapsedAgain.borders, collapsed.borders, 'Collapsing must retain the visible activity frame');
      await page.getByRole('button', { name: 'Choose model', exact: true }).press('Enter');
      const search = page.getByPlaceholder('Search models');
      await search.fill('Example');
      await search.press('Space');
      assert.equal(await search.inputValue(), 'Example ');
      assert(await page.locator('.model-picker').isVisible(), 'Space in model search closed picker');
      const editOptions = page.getByTitle('Edit options', { exact: true });
      assert(await editOptions.isVisible(), 'Model options must be visible without hovering');
      await page.screenshot({ path: path.join(output, `model-${theme}-${width}-idle.png`) });
      await editOptions.press('Enter');
      await page.getByRole('button', { name: 'Reasoning effort: High', exact: true }).press('Space');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.model-picker').count(), 0);
      await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'insertMention', mention: { kind: 'file', path: 'src/main.ts', name: 'main.ts' } } })));
      const removeMention = page.getByRole('button', { name: 'Remove mention main.ts', exact: true });
      await removeMention.waitFor();
      await page.mouse.move(0, 0);
      assert(await removeMention.isVisible(), 'Mention removal must be visible without hovering');
      await page.screenshot({ path: path.join(output, `mention-${theme}-${width}-idle.png`) });
      await removeMention.press('Space');
      assert.equal(await page.locator('.mention-x').count(), 0);
      await page.locator('.composer .editor').press('Control+z');
      await removeMention.waitFor();
      assert.equal(await page.locator('.chat-turn-group').count(), 1, 'Mention removal submitted a message');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      results.push({ theme, width, keyboard: 'passed', restingControls: 'passed', stableHover: 'passed', visibleFrames: { collapsed, expanded: resting, readFrames, listFrame }, modelOptions: 'passed', mentionUndo: 'passed', errors });
      await page.close();
    }
    await fs.writeFile(path.join(output, 'ui-results.json'), JSON.stringify(results, null, 2));
    console.log(`Passed ${results.length} activity theme/width combinations. Screenshots: ${output}`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
