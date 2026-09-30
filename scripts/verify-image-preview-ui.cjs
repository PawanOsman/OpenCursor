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

const convId = 'image-preview';
const firstName = 'project-overview.png';
const secondName = 'responsive-layout-with-a-long-filename-that-must-not-overflow-the-preview-on-a-narrow-screen.png';

async function send(page, data) {
  await page.evaluate(data => window.dispatchEvent(new MessageEvent('message', { data })), data);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function fixture(page, motion) {
  await send(page, {
    type: 'initialState', activeId: convId, mode: 'agent', selectedModel: 'preview-model', turns: [],
    personas: [], activePersonaId: 'default', hasProviders: true, runningConvIds: [],
    workspaceState: { openTabs: [convId], drafts: {} },
    uiPrefs: { motion, chatTextSize: 'default', maxTabCount: 0, completionSound: false },
  });
  await send(page, { type: 'workflowState', goals: {}, queues: {} });
  await send(page, { type: 'pendingChanges', changes: [] });
  const images = await page.evaluate(({ firstName, secondName }) => [firstName, secondName].map((name, index) => {
    const canvas = document.createElement('canvas');
    canvas.width = index ? 540 : 1600;
    canvas.height = index ? 1200 : 900;
    const context = canvas.getContext('2d');
    context.fillStyle = index ? '#e5edf4' : '#132235';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = index ? '#496a86' : '#bcd1e4';
    context.fillRect(40, 40, canvas.width - 80, 80);
    context.fillStyle = index ? '#ccdbe8' : '#294963';
    for (let row = 0; row < 3; row++) context.fillRect(40, 160 + row * 180, canvas.width - 80, 140);
    context.fillStyle = index ? '#183549' : '#ffffff';
    context.font = '28px sans-serif';
    context.fillText(index ? 'Mobile layout' : 'Project overview', 60, 94);
    return { id: `image-${index}`, name, kind: 'image', mime: 'image/png', data: canvas.toDataURL('image/png') };
  }), { firstName, secondName });
  return [...images, { id: 'readme', name: 'README.md', kind: 'text', mime: 'text/markdown', data: '# Project notes' }];
}

async function loaded(page, name) {
  await page.getByRole('dialog', { name: 'Image preview' }).waitFor();
  await page.waitForFunction(name => document.querySelector('.image-preview-name')?.textContent === name, name);
  await page.waitForFunction(() => {
    const image = document.querySelector('.image-preview-image');
    return image?.complete && image.naturalWidth > 0;
  });
}

async function geometry(page, label) {
  const bounds = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="Image preview"]');
    const image = dialog.querySelector('.image-preview-image');
    const rect = element => {
      const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight }, dialog: rect(dialog), image: image && rect(image),
      zoomed: dialog.querySelector('.image-preview-stage').hasAttribute('data-zoomed'),
      documentOverflow: document.documentElement.scrollWidth - innerWidth,
      dialogOverflow: dialog.scrollWidth - dialog.clientWidth,
    };
  });
  assert(bounds.documentOverflow <= 1 && bounds.dialogOverflow <= 1, `${label}: no horizontal overflow ${JSON.stringify(bounds)}`);
  assert(bounds.dialog.left >= -1 && bounds.dialog.right <= bounds.viewport.width + 1 &&
    bounds.dialog.top >= -1 && bounds.dialog.bottom <= bounds.viewport.height + 1,
  `${label}: the preview fits the viewport ${JSON.stringify(bounds)}`);
  if (bounds.image) assert(bounds.image.width > 0 && bounds.image.height > 0, `${label}: the full image is visible`);
  if (bounds.image && !bounds.zoomed) assert(bounds.image.left >= bounds.dialog.left - 1 && bounds.image.right <= bounds.dialog.right + 1 &&
    bounds.image.top >= bounds.dialog.top - 1 && bounds.image.bottom <= bounds.dialog.bottom + 1,
  `${label}: fit mode contains the entire image ${JSON.stringify(bounds)}`);
  return bounds;
}

async function closed(page, trigger) {
  await page.getByRole('dialog', { name: 'Image preview' }).waitFor({ state: 'hidden' });
  if (trigger) assert(await trigger.evaluate(element => element === document.activeElement), 'closing returns focus to its thumbnail');
}

async function composerChecks(page, attachments, label, output, prefix, motion) {
  await send(page, { type: 'attachmentsPicked', attachments });
  const chips = page.locator('.bottom-stack .attach-chips');
  const first = chips.getByRole('button', { name: `Preview image ${firstName}`, exact: true });
  const second = chips.getByRole('button', { name: `Preview image ${secondName}`, exact: true });
  assert.equal(await chips.locator('.image-attachment-trigger').count(), 2, `${label}: only image attachments offer previews`);
  assert.equal(await chips.locator('.attach-file').count(), 1, `${label}: text files retain their file chip`);
  await first.click();
  await loaded(page, firstName);
  assert.equal(await page.getByRole('button', { name: 'Previous image', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Next image', exact: true }).count(), 1);
  await geometry(page, `${label}/landscape`);
  await page.screenshot({ path: path.join(output, `${prefix}-landscape.png`), animations: 'disabled' });
  if (motion === 'reduced') {
    const animations = await page.locator('.image-preview-backdrop').evaluate(element => element.getAnimations({ subtree: true }).length);
    assert.equal(animations, 0, `${label}: reduced motion does not run preview animations`);
  } else {
    assert.match(await page.locator('.image-preview-dialog').evaluate(element => getComputedStyle(element).animationName), /image-preview-enter/,
      `${label}: full motion uses the preview entrance animation`);
  }
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press(index < 4 ? 'Tab' : 'Shift+Tab');
    assert(await page.locator('.image-preview-dialog').evaluate(element => element.contains(document.activeElement)), `${label}: keyboard focus stays inside the modal`);
  }

  await page.getByRole('button', { name: 'Show actual size', exact: true }).click();
  await page.getByRole('button', { name: 'Fit image to window', exact: true }).waitFor();
  const actual = await geometry(page, `${label}/actual-size`);
  assert(Math.abs(actual.image.width - 1600) < 1, `${label}: actual size renders the image at its natural width`);
  await page.getByRole('button', { name: 'Fit image to window', exact: true }).click();
  await page.getByRole('button', { name: 'Next image', exact: true }).click();
  await loaded(page, secondName);
  await geometry(page, `${label}/portrait`);
  await page.screenshot({ path: path.join(output, `${prefix}-portrait.png`), animations: 'disabled' });
  await page.keyboard.press('ArrowRight');
  await loaded(page, firstName);
  await page.keyboard.press('ArrowLeft');
  await loaded(page, secondName);
  await page.keyboard.press('Escape');
  await closed(page, first);
  await first.click();
  await loaded(page, firstName);
  await page.keyboard.press('Escape');
  await closed(page, first);

  await second.focus();
  await page.keyboard.press('Enter');
  await loaded(page, secondName);
  await page.locator('.image-preview-backdrop').click({ position: { x: 2, y: 2 } });
  await closed(page, second);
  await chips.getByRole('button', { name: `Remove ${secondName}`, exact: true }).click();
  assert.equal(await page.getByRole('dialog', { name: 'Image preview' }).count(), 0, `${label}: removing an image does not open a preview`);
  assert.equal(await chips.locator('.image-attachment-trigger').count(), 1, `${label}: removal affects only the selected image`);
  await first.click();
  await loaded(page, firstName);
  assert.equal(await page.getByRole('button', { name: 'Next image', exact: true }).count(), 0, `${label}: one image does not display gallery controls`);
  await page.getByRole('button', { name: 'Close image preview', exact: true }).click();
  await closed(page, first);
}

async function sentChecks(page, attachments, label) {
  await send(page, { type: 'loadConversation', activeId: 'sent-images', running: false, turns: [
    { role: 'user', text: 'Compare these attached layouts.', attachments },
    { role: 'assistant', blocks: [{ kind: 'text', text: 'Both images are attached to this message.' }] },
  ] });
  const thumbnails = page.locator('.msg-attachments');
  assert.equal(await thumbnails.locator('.image-attachment-trigger').count(), 2, `${label}: sent images offer previews`);
  assert.equal(await thumbnails.locator('.msg-attach-file').count(), 1, `${label}: the sent text file remains a file attachment`);
  const first = thumbnails.getByRole('button', { name: `Preview image ${firstName}`, exact: true });
  await first.click();
  await loaded(page, firstName);
  assert.equal(await page.locator('.chat-input.is-editing').count(), 0, `${label}: opening the sent attachment does not edit its message`);
  await page.keyboard.press('Escape');
  await closed(page, first);
  await first.focus();
  await page.keyboard.press('Space');
  await loaded(page, firstName);
  assert.equal(await page.locator('.chat-input.is-editing').count(), 0, `${label}: keyboard preview does not edit its message`);
  await send(page, { type: 'loadConversation', activeId: 'another-conversation', running: false, turns: [] });
  await closed(page);
  const changes = await page.evaluate(() => window.__imagePreviewMessages.filter(message =>
    ['sendMessage', 'editMessage', 'queueMessage', 'restoreMessage'].includes(message.type)));
  assert.deepEqual(changes, [], `${label}: inspecting attachments never submits or alters a message`);
}

async function errorChecks(page, attachments, label) {
  const invalid = { id: 'broken', name: 'unavailable-image.png', kind: 'image', mime: 'image/png', data: 'data:image/png;base64,AA==' };
  await send(page, { type: 'loadConversation', activeId: 'broken-image', running: false, turns: [
    { role: 'user', text: 'An unavailable attachment alongside a valid image.', attachments: [invalid, attachments[0]] },
  ] });
  await page.locator('.msg-attachments').getByRole('button', { name: `Preview image ${invalid.name}`, exact: true }).click();
  await page.getByText('This image could not be loaded.', { exact: true }).waitFor();
  assert(await page.getByRole('button', { name: 'Show actual size', exact: true }).isDisabled(), `${label}: a failed image cannot be enlarged`);
  await page.getByRole('button', { name: 'Next image', exact: true }).click();
  await loaded(page, firstName);
  await geometry(page, `${label}/recovered`);
  assert.equal(await page.getByText('This image could not be loaded.', { exact: true }).count(), 0, `${label}: selecting a valid image clears the error`);
  await page.keyboard.press('Escape');
  await closed(page);
}

async function main() {
  const output = path.resolve(__dirname, '../dist/visual-qa');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.OPENCURSOR_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    for (const theme of ['light', 'dark']) for (const width of [375, 900]) {
      for (const motion of width === 375 ? ['full', 'reduced'] : ['full']) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => {
          let factory;
          window.__imagePreviewMessages = [];
          Object.defineProperty(window, 'acquireVsCodeApi', {
            configurable: true, get: () => factory,
            set: original => { factory = () => {
              const bridge = original();
              return { ...bridge, postMessage: message => {
                window.__imagePreviewMessages.push(message);
                if (message.type === 'ready' || message.type === 'getFileIcon') bridge.postMessage(message);
              } };
            }; },
          });
        });
        await page.goto(`${process.env.OPENCURSOR_PREVIEW_ORIGIN || 'http://127.0.0.1:4178'}/sidebar?theme=${theme}`);
        await page.waitForFunction(() => document.querySelector('.model-select')?.textContent.includes('Example model'));
        const label = `${theme}/${width}/${motion}`;
        const prefix = `image-preview-${theme}-${width}-${motion}`;
        const attachments = await fixture(page, motion);
        await composerChecks(page, attachments, label, output, prefix, motion);
        await sentChecks(page, attachments, label);
        await errorChecks(page, attachments, label);
        assert.deepEqual(errors, [], `${label}: no browser errors`);
        console.log(`Passed image preview ${label}`);
        await context.close();
      }
    }
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
