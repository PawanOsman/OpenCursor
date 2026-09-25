/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor, AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const colors = {
  ink: '#17181d', panel: '#22232b', line: '#3b3c47', muted: '#adaebc',
  white: '#f5f5f8', violet: '#8b7cf8', mint: '#9cddbe', gray: '#686977',
};
const xml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
const rect = (x, y, w, h, fill = colors.panel, stroke = colors.line, radius = 18) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}"/>`;
const text = (x, y, content, size = 22, fill = colors.white, weight = 400, extra = '') => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}" ${extra}>${xml(content)}</text>`;
const line = (x1, y1, x2, y2, color = colors.line, extra = '') => `<path d="M${x1} ${y1}H${x2}V${y2}" fill="none" stroke="${color}" stroke-width="2" ${extra}/>`;
const arrow = (x1, y1, x2, y2, color = colors.violet) => line(x1, y1, x2, y2, color, 'marker-end="url(#arrow)"');
const icons = {
  account: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  key: '<circle cx="8" cy="9" r="5"/><path d="m12 13 9 9m-5-5 3-3m-6 0 3-3"/>',
  server: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01M11 6h7M11 18h7"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2c-6 6-6 14 0 20 6-6 6-14 0-20Z"/>',
  layers: '<path d="m12 2 10 6-10 6L2 8Zm-10 11 10 6 10-6M2 18l10 6 10-6"/>',
  chat: '<path d="M20 3H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3v4l6-4h7a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Z"/><path d="M7 8h10M7 13h6"/>',
  file: '<path d="M14 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9Zm0 0v7h7M7 14h10M7 18h7"/>',
  index: '<rect x="2" y="2" width="8" height="8" rx="2"/><rect x="14" y="2" width="8" height="8" rx="2"/><rect x="2" y="14" width="8" height="8" rx="2"/><rect x="14" y="14" width="8" height="8" rx="2"/>',
  search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 7 7"/>',
  book: '<path d="M12 5C8 2 4 2 2 3v17c4-1 7-1 10 1 3-2 6-2 10-1V3c-2-1-6-1-10 2Zm0 0v16"/>',
  list: '<path d="m2 5 2 2 4-4M11 5h11M2 13h5M11 13h11M2 21h5M11 21h11"/>',
  check: '<path d="m3 12 6 6L21 6"/>',
  folder: '<path d="M2 6a2 2 0 0 1 2-2h6l3 3h7a2 2 0 0 1 2 2v11H2Z"/>',
};
const icon = (name, x, y, color = colors.violet, size = 28) => `<g transform="translate(${x} ${y}) scale(${size / 24})" fill="none" stroke="${color}" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</g>`;
const badge = (x, y, label, width, color = colors.violet) => rect(x, y, width, 30, colors.ink, colors.line, 15) + text(x + width / 2, y + 20, label, 15, color, 500, 'text-anchor="middle"');
const header = (eyebrow, title, subtitle) => text(48, 49, eyebrow, 15, colors.violet, 600, 'letter-spacing="2.2"') + text(48, 102, title, 42, colors.white, 650) + text(48, 144, subtitle, 23, colors.muted);
const copyright = `<!--
Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>

This file is part of OpenCursor, AI coding agent chat inside VS Code.
https://github.com/PawanOsman/OpenCursor

Licensed under the MIT License. See LICENSE file in the project root.
-->`;
function canvas(title, description, body, height = 650) {
  return `${copyright}\n<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="${height}" viewBox="0 0 1440 ${height}" role="img" aria-labelledby="title description" font-family="Segoe UI, Inter, Arial, sans-serif">
<title id="title">${xml(title)}</title><desc id="description">${xml(description)}</desc>
<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="m1 1 5 3-5 3" fill="none" stroke="${colors.violet}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>
${rect(1, 1, 1438, height - 2, colors.ink, colors.line, 26)}
${body}\n</svg>\n`;
}

function providers() {
  let body = header('PROVIDERS', 'One place for your model connections.', 'Sign in, add API keys, or connect a local model. Choose what powers each chat.');
  body += text(48, 199, 'ADD A CONNECTION', 14, colors.muted, 600, 'letter-spacing="1.6"');
  const categories = [
    [48, 222, 'account', 'Accounts', 'Connect your account'],
    [320, 222, 'key', 'API keys', 'Bring your credentials'],
    [48, 370, 'server', 'Local models', 'Connect your runtime'],
    [320, 370, 'globe', 'No-auth endpoints', 'Use supported services'],
  ];
  for (const [x, y, symbol, title, subtitle] of categories) {
    body += rect(x, y, 252, 124) + icon(symbol, x + 20, y + 20) + text(x + 20, y + 70, title, 23, colors.white, 600) + text(x + 20, y + 100, subtitle, 17, colors.muted);
  }
  body += line(572, 284, 610, 432, colors.line) + line(572, 432, 610, 432, colors.line) + arrow(610, 358, 658, 358);
  body += rect(670, 222, 302, 272, colors.white, colors.white) + text(694, 263, 'Your providers', 25, colors.ink, 600) + text(694, 294, 'Configured connections', 18, colors.gray);
  const connections = ['Account connections', 'API connections', 'Local / no-auth'];
  for (let i = 0; i < 3; i++) {
    body += rect(694, 312 + 44 * i, 254, 34, '#eaeaf0', '#e0e0e8', 9) + text(708, 335 + 44 * i, connections[i], 17, colors.ink) + `<circle cx="925" cy="${329 + 44 * i}" r="4" fill="#3c8d64"/>`;
  }
  body += text(694, 477, 'Per-provider routing', 18, colors.gray);
  body += arrow(972, 284, 1040, 284);
  body += rect(1054, 222, 338, 124, '#2b273f', '#5b527f') + icon('layers', 1076, 245, '#b3a9ff') + text(1123, 269, 'Available models', 25, colors.white, 600) + text(1076, 319, 'From enabled connections', 20, '#c7c0df');
  body += arrow(1223, 346, 1223, 359);
  body += rect(1054, 370, 338, 124) + icon('chat', 1076, 392, colors.mint) + text(1123, 416, 'Chat + tools', 25, colors.white, 600) + text(1076, 467, 'Pick a model and get to work', 20, colors.muted);
  body += line(48, 548, 1392, 548) + icon('check', 48, 579, colors.mint, 23) + text(84, 598, 'Keep multiple credentials. Configure routing separately for each provider.', 23, colors.muted);
  return canvas('Model connections in OpenCursor', 'Accounts, API keys, local models, and no-auth endpoints become configured provider connections. Account and API providers can optionally use multiple credentials with failover or load balancing. Enabled connections make models available to chat.', body);
}

function localStack() {
  let body = header('LOCAL MODELS + RETRIEVAL', 'Run the pieces you want locally.', 'Choose a local runtime for chat. Build a local index for relevant workspace context.');
  const cards = [
    [48, 'server', 'llama.cpp', 'GGUF models', 'Load a model and run inference', 'through a local server.'],
    [504, 'layers', 'Ollama', 'Local model server', 'Connect a running instance and', 'choose its available models.'],
    [960, 'index', 'Local embeddings', 'Semantic retrieval', 'Index workspace content for', 'meaning-based code search.'],
  ];
  for (const [x, symbol, title, subtitle, line1, line2] of cards) {
    body += rect(x, 206, 432, 312) + rect(x + 24, 230, 54, 54, '#302b44', '#49405f', 14) + icon(symbol, x + 37, 243, '#b3a9ff', 28);
    body += text(x + 24, 329, title, 29, colors.white, 600) + text(x + 24, 364, subtitle, 21, colors.mint, 500) + text(x + 24, 411, line1, 21, colors.muted) + text(x + 24, 443, line2, 21, colors.muted);
    body += badge(x + 24, 463, x === 48 ? '.gguf' : x === 504 ? 'localhost' : 'on-device index', x === 48 ? 76 : x === 504 ? 118 : 156, colors.muted);
  }
  body += rect(48, 552, 1344, 54, '#242d2a', '#3d5147', 14) + icon('folder', 68, 566, colors.mint, 25) + text(108, 587, 'Workspace, settings, and conversation history stay on your machine.', 23, '#cae8d9');
  body += text(48, 639, 'Initial runtime and model downloads need internet access. Your selected chat provider determines where requests go.', 19, colors.muted);
  return canvas('Local models and retrieval in OpenCursor', 'llama.cpp supports GGUF models, Ollama connects a local model server, and local embeddings provide semantic retrieval. Workspace, settings, and conversation history are stored locally. Initial downloads require internet access, and chat requests go to the configured provider.', body, 674);
}

function semanticSearch() {
  let body = header('WORKSPACE + DOCUMENTATION', 'Give the agent useful context.', 'Find relevant code and index documentation with a finite, reviewable page plan.');
  const rows = [
    [190, 'WORKSPACE SEARCH', 214, [
      ['file', 'Workspace files', 'The code you are working in'],
      ['index', 'Local index', 'Embed and retrieve locally'],
      ['search', 'Relevant context', 'Find related code by meaning'],
    ]],
    [397, 'DOCUMENTATION INDEXING', 421, [
      ['book', 'Documentation', 'Choose a source and scope'],
      ['list', 'Finite page plan', 'Select the pages you need'],
      ['check', 'Selected pages', 'Fetch and index this set only'],
    ]],
  ];
  for (const [labelY, label, y, nodes] of rows) {
    body += text(48, labelY, label, 14, colors.muted, 600, 'letter-spacing="1.6"');
    nodes.forEach(([symbol, title, detail], i) => {
      const x = 48 + i * 474;
      body += rect(x, y, 396, 138, i === 2 ? '#242d2a' : colors.panel, i === 2 ? '#3d5147' : colors.line);
      body += icon(symbol, x + 24, y + 30, i === 2 ? colors.mint : colors.violet, 29) + text(x + 71, y + 55, title, 27, colors.white, 600) + text(x + 24, y + 104, detail, 21, colors.muted);
      if (i < 2) body += arrow(x + 410, y + 69, x + 456, y + 69);
    });
  }
  body += text(48, 615, 'Fetched pages never expand the documentation plan. Keep the scope and resource limits under your control.', 21, colors.muted);
  return canvas('Workspace search and bounded documentation indexing', 'Workspace files feed a local index that returns relevant code context. Documentation discovery creates a finite page plan, and indexing fetches only selected pages. Links found in fetched pages do not grow the plan.', body);
}

async function main() {
  const output = path.resolve(__dirname, '../media/readme');
  await fs.mkdir(output, { recursive: true });
  for (const [name, svg] of [['providers', providers()], ['local-stack', localStack()], ['semantic-search', semanticSearch()]]) {
    if (svg.includes('\u2014')) throw new Error(`Unexpected punctuation in ${name}`);
    await fs.writeFile(path.join(output, `${name}.svg`), svg, 'utf8');
    await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(path.join(output, `${name}.png`));
    console.log(`Rendered media/readme/${name}.svg and .png`);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
