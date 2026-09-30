/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// Production agent and HTTP protocol with scripted decisions: wiring, not intelligence.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const execute = require('node:util').promisify(require('node:child_process').execFile);
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocursor-headless-smoke-'));
  let requests = 0;
  const server = http.createServer(async (req, res) => {
    const buffers = []; for await (const chunk of req) buffers.push(chunk);
    const body = JSON.parse(Buffer.concat(buffers).toString()); requests++;
    const second = body.messages.some(message => message.role === 'tool');
    if (requests > 4) { res.writeHead(500); res.end('Unexpected retry'); return; }
    const delta = second ? { content: 'Changed value.cjs to export 42. Tests were not run, as requested.' } : { tool_calls: [{ index: 0, id: 'write-value', type: 'function', function: { name: 'Write', arguments: JSON.stringify({ path: 'value.cjs', contents: 'exports.value=42;\n' }) } }] };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] }) + '\n\n');
    res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: second ? 'stop' : 'tool_calls' }], usage: { prompt_tokens: 200, completion_tokens: 50 } }) + '\n\n');
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const repo = path.join(root, 'repo'); await fs.mkdir(repo);
    const git = args => execute('git', args, { cwd: repo, windowsHide: true });
    await git(['init']); await git(['config', 'user.name', 'OpenCursor Fixture']); await git(['config', 'user.email', 'fixture@example.invalid']);
    await fs.writeFile(path.join(repo, 'value.cjs'), 'exports.value=41;\n');
    await git(['add', 'value.cjs']); await git(['commit', '-m', 'fixture']);
    const revision = (await git(['rev-parse', 'HEAD'])).stdout.trim();
    const grader = path.join(root, 'grade.cjs');
    await fs.writeFile(grader, "const path=require('node:path');console.log(JSON.stringify({passed:require(path.join(process.env.OPENCURSOR_EVAL_WORKSPACE,'value.cjs')).value===42}));");
    const config = path.join(root, 'worker.json'), tasks = path.join(root, 'tasks.json'), report = path.join(root, 'report.json');
    await fs.writeFile(config, JSON.stringify({ directory: path.join(root, 'jobs'), repositories: { fixture: repo }, models: ['fixture-model'], apiBaseUrl: `http://127.0.0.1:${server.address().port}/v1`, execution: { kind: 'local' }, contextTokens: 128000, maxSteps: 5, tokenBudget: 100000 }));
    await fs.writeFile(tasks, JSON.stringify([{ name: 'headless wiring', split: 'development', repository: 'fixture', revision, model: 'fixture-model', prompt: 'Change value.cjs to export value 42. Only edit that file. Do not run tests or create a plan; report tests not run.', grader: { executable: process.execPath, args: [grader] } }]));
    const result = await execute(process.execPath, [path.resolve('dist/worker.cjs'), 'evaluate', config, tasks, report], { windowsHide: true, timeout: 60_000, env: { ...process.env, OPENCURSOR_TRUSTED_LOCAL_WORKER: '1', OPENCURSOR_API_KEY: 'fixture-key' } });
    const data = JSON.parse(await fs.readFile(report, 'utf8'));
    if (data.results[0]?.outcome !== 'passed') throw new Error('Independent grader did not pass: ' + result.stdout);
    if ((await fs.readFile(path.join(repo, 'value.cjs'), 'utf8')) !== 'exports.value=41;\n') throw new Error('Original repository was modified');
    console.log(`Headless production agent smoke passed (${requests} HTTP requests; source untouched; independent grader passed).`);
  } finally {
    await new Promise(resolve => server.close(resolve));
    const resolved = path.resolve(root), temporary = path.resolve(os.tmpdir()) + path.sep;
    if (!resolved.startsWith(temporary) || !path.basename(resolved).startsWith('ocursor-headless-smoke-')) throw new Error('Unexpected temporary path');
    await fs.rm(resolved, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
