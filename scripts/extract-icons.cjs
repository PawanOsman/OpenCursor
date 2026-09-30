/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// Generates icon geometry from files in an asset directory.
const fs = require('node:fs');
const path = require('node:path');
const assets = process.argv[2];
if (!assets) throw new Error('Usage: node scripts/extract-icons.cjs <asset-directory>');
const sources = {
  file: 'document-dab8075a138d.svg', folder: 'folder-2bb8c26384b3.svg',
  search: 'magnifying-glass-sm-search-9d263b4e4325.svg', terminal: 'terminal-lg-c101a100ddfe.svg',
  edit: 'pencil-5754cfc8d615.svg', trash: 'trash-91a07fbf24e7.svg', reset: 'rotate-ccw-26f1a9361e62.svg',
  check: 'check-md-e7553d398bc9.svg', close: 'x-crossed-2d93d1740a97.svg',
  chevD: 'chevron-down-md-1812132124e7.svg', chevR: 'chevron-right-md-9a3f8df8aa18.svg',
  chevU: 'chevron-up-b8c18a8a472a.svg', chevL: 'chevron-left-cb173ec9f260.svg',
  brain: 'brain-9069679dc06a.svg', history: 'clock-arrow-rotate-counterclockwise-light-16-26a9d3979b9b.js',
  infinity: 'infinity-afc675d1fb0d.svg', agent: 'agent-mode-883172d8ec4e.svg',
  bot: 'bot-18272b8a0d1a.svg', chat: 'chat-48d89e4f5ba8.svg', list: 'list-checks-5e900ce20e50.svg',
  plus: 'plus-composer-86a041c72466.svg', settings: 'settings-cog-c9e57e236393.svg', model: 'settings-slider-f91f337cb1a5.svg',
  tools: 'settings-wrench-5056ede6b238.svg', code: 'code-1f734e576be2.svg', fileCode: 'file-code-51e5fbf2c08e.svg',
  database: 'database-419464fe40b0.svg', fileSearch: 'file-search-e1a81f1b9664.svg',
  globe: 'globe-real-time-search-ce40aa9e913b.svg', link: 'link-fabd7dc54e90.svg', todo: 'list-todo-8131bb85d025.svg',
  ruler: 'ruler-283786dcc2b0.svg', task: 'bot-message-square-31198128dd06.svg', users: 'users-38dc078ea5cb.svg',
  image: 'image-square-picture-library-b681a3204203.svg', paperclip: 'paperclip-attach-fc9fac23c1a5.svg',
  circle: 'circle-e2bf882dda8e.svg', circleDot: 'circle-dot-8a3050164431.svg', clock: 'clock-5bcfba55edc4.svg',
  play: 'play-2561fcdb6a76.svg', gitBranch: 'git-branch-508427061765.svg', gitCommit: 'git-commit-6b37cd250332.svg',
  book: 'book-open-774b016127e5.svg', more: 'dots-horizontal-more-menu-e622927fd176.svg',
  download: 'download-simple-43c85e8a5619.svg', copy: 'copy-fca5b461d233.svg',
  send: 'arrow-up-sm-91887259a72f.svg', stop: 'stop-fill-light-16-e03f1ab43f60.js',
  arrowUp: 'arrow-up-sm-91887259a72f.svg', arrowDown: 'arrow-down-822375fb3d45.svg',
  at: 'at-sign-363e61cf00b3.svg', archive: 'archive-30c19584748a.svg', fork: 'git-fork-62e84defd815.svg',
  handRaised: { file: 'hand-b012ac43aafc.js', exportName: 't' },
  shieldCheck: { file: 'app-initial-801a1845d914.js', exportName: 'px' },
  shieldWarning: { file: 'app-initial-801a1845d914.js', exportName: 'EA' },
  laptop: { file: 'app-initial-801a1845d914.js', exportName: 'PS' },
  steer: { file: 'queued-message-list-55b5ebac3f5d.js', symbolName: 'we' },
  queued: { file: 'queued-message-list-55b5ebac3f5d.js', symbolName: 'Se' },
};

// Some authored icons are embedded as JSX rather than standalone SVG assets.
// Parse only bounded, static svg/path literals; never load or execute the bundle.
function extractJsxIcon(text, exportName, symbolName) {
  const exports = text.slice(text.lastIndexOf('export{'));
  const symbol = symbolName ?? exports.match(new RegExp('(?:\\{|,)([\\w$]+) as ' + exportName + '(?:,|\\})'))?.[1];
  if (!symbol) throw new Error('Missing icon export: ' + exportName);
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const assignment = text.match(new RegExp('(?:^|[^\\w$])' + escaped + '=e=>'));
  if (!assignment) throw new Error('Missing static icon component: ' + symbol);
  const component = text.slice(assignment.index + assignment[0].length, assignment.index + assignment[0].length + 16_000);
  const rootMatch = component.match(/^\(0,[\w$]+\.jsxs?\)\(`svg`,\{([\s\S]*?),children:/);
  if (!rootMatch) throw new Error('Unsupported icon component: ' + symbol);
  const children = component.slice(rootMatch[0].length);
  const end = children.indexOf('})})))()}');
  if (end < 0) throw new Error('Unbounded icon component: ' + symbol);
  const attributes = (input, allowed) => {
    const values = [];
    const attribute = /([\w]+):(?:`([^`\\$]*)`|(\d+))(?:,|$)/gy;
    let offset = 0;
    while (offset < input.length) {
      attribute.lastIndex = offset;
      const match = attribute.exec(input);
      if (!match || !allowed.includes(match[1])) throw new Error('Non-static SVG attribute: ' + symbol);
      values.push([match[1], match[2] ?? match[3]]);
      offset = attribute.lastIndex;
    }
    return values.map(([key, value]) => key.replace(/[A-Z]/g, character => '-' + character.toLowerCase()).replace('view-box', 'viewBox') + '="' + value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;') + '"').join(' ');
  };
  const root = attributes(rootMatch[1].replace(/,\.\.\.e$/, ''), ['xmlns', 'width', 'height', 'viewBox', 'fill']);
  const paths = [];
  const remainder = children.slice(0, end).replace(/\(0,[\w$]+\.jsx\)\(`path`,\{([^{}]*)\}\)/g, (_match, input) => {
    paths.push('<path ' + attributes(input, ['d', 'fill', 'fillRule', 'clipRule']) + '/>');
    return 'path';
  });
  if (!paths.length || !/^(?:path|\[path(?:,path)*\])$/.test(remainder)) throw new Error('Unsupported icon children: ' + symbol);
  return { root, body: paths.join('') };
}

const geometry = {};
for (const [name, definition] of Object.entries(sources)) {
  const file = typeof definition === 'string' ? definition : definition.file;
  const source = typeof definition === 'string' ? definition : file + (definition.symbolName ? '#symbol:' + definition.symbolName : '#export:' + definition.exportName);
  const text = fs.readFileSync(path.join(assets, file), 'utf8');
  let root, body;
  if (typeof definition !== 'string') {
    ({ root, body } = extractJsxIcon(text, definition.exportName, definition.symbolName));
  } else if (file.endsWith('.js')) {
    const viewBox = text.match(/viewBox:`([^`]+)`/)[1];
    root = `viewBox="${viewBox}" fill="none"`;
    body = text.match(/body:`([^`]+)`/)[1];
  } else {
    const svg = text.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/);
    if (!svg) throw new Error('Invalid SVG: ' + source);
    [, root, body] = svg;
  }
  // Palette adaptation only: geometry and authored viewBox remain unchanged.
  body = body.replace(/(fill|stroke)="#(?:0D0D0D|000000|000)"/gi, '$1="currentColor"');
  if (/<(?:script|foreignObject|image|use)\b|\bon\w+=|(?:href|url\s*\()/i.test(body)) throw new Error('Non-static icon: ' + source);
  const attributes = {};
  for (const [, key, value] of root.matchAll(/([\w-]+)="([^"]*)"/g)) {
    if (['width', 'height', 'xmlns'].includes(key)) continue;
    const reactKey = key.replace(/-([a-z])/g, (_, character) => character.toUpperCase());
    attributes[reactKey] = /^#(?:0d0d0d|000000|000)$/i.test(value) ? 'currentColor' : value;
  }
  if (!attributes.viewBox) throw new Error('Missing viewBox: ' + source);
  geometry[name] = { source, attributes, body };
}
const licenseHeader = fs.readFileSync(__filename, 'utf8').match(/^\/\*[\s\S]*?\*\//)[0];
fs.writeFileSync(path.resolve(__dirname, '../webview-ui/shared/iconGeometry.ts'),
  licenseHeader + '\n\n' +
  'export const ICON_GEOMETRY = ' + JSON.stringify(geometry, null, 2) + ' as const;\n');
console.log(`Extracted ${Object.keys(geometry).length} functional icons.`);
