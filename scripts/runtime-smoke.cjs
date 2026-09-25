/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

// Run real Read(PDF) and native initialization from an isolated CJS build with
// the production host options. No checkout node_modules are visible to it.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const esbuild = require('esbuild');
const { hostBuildOptions } = require('../esbuild-options.cjs');
function pdfFixture() {
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  const stream = 'BT /F1 24 Tf 72 720 Td (OpenCursor runtime smoke) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i+1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf); pdf += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10,'0')} 00000 n \n`;
  return pdf + `trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-packaged-smoke-'));
  try {
    await fs.mkdir(path.join(dir,'node_modules','vscode'), {recursive:true});
    await fs.writeFile(path.join(dir,'node_modules','vscode','index.js'), `module.exports={workspace:{workspaceFolders:[{uri:{fsPath:process.cwd()}}],textDocuments:[]},window:{withProgress:async(_o,fn)=>fn({report:({message})=>console.log(message)})},ProgressLocation:{Notification:1}};`);
    await fs.writeFile(path.join(dir,'fixture.pdf'), pdfFixture());
    await esbuild.build({ ...hostBuildOptions, minify:true, outfile:path.join(dir,'features.cjs'), stdin:{
      contents: "export {readFileTool} from './src/agent/tools/files'; export {initRuntimeDeps,importRuntimeDep} from './src/runtimeDeps'; export {spawnPtyCommand} from './src/agent/ptyRuntime';",
      resolveDir:path.resolve(__dirname,'..'), loader:'ts',
    }});
    await fs.writeFile(path.join(dir,'run.cjs'), `
const path=require('node:path');
const api=require('./features.cjs');
api.initRuntimeDeps(process.env.OPENCURSOR_RUNTIME_SMOKE_CACHE || path.join(process.cwd(),'storage'));
(async()=>{
 const result=await api.readFileTool.execute({path:'fixture.pdf'});
 if(!result.output.includes('OpenCursor runtime smoke'))throw new Error(result.output);
 console.log(process.version,'production-bundled Read(PDF) passed');
 const hub=await api.importRuntimeDep('@huggingface/hub');
 if(typeof hub.downloadFile!=='function')throw new Error('Hub initialization failed');
 console.log('Pinned hub runtime initialized');
 const ptyModule=await api.importRuntimeDep('@lydell/node-pty');
 const nativeSpawn=ptyModule.spawn || ptyModule.default?.spawn;
 if(typeof nativeSpawn!=='function')throw new Error('PTY runtime initialization failed');
 const terminal=await api.spawnPtyCommand('node -e "console.log(Boolean(process.stdout.isTTY))"',process.cwd(),80,24);
 await new Promise((resolve,reject)=>{
   let output='';
   const timeout=setTimeout(()=>{terminal.kill();reject(new Error('Packaged PTY process did not exit'));},10000);
   terminal.stdout.on('data',chunk=>{output+=String(chunk);});
   terminal.stderr.resume();
   terminal.once('close',exitCode=>{clearTimeout(timeout);exitCode===0 && output.includes('true')?resolve():reject(new Error('Packaged PTY failed: '+output));});
 });
 console.log('Pinned native PTY runtime executed in isolation');
 if(process.env.OPENCURSOR_SMOKE_NATIVE==='1'){
   const transformers=await api.importRuntimeDep('@huggingface/transformers');
   if(typeof transformers.pipeline!=='function')throw new Error('Transformers initialization failed');
   console.log('Pinned native transformers runtime initialized');
 }
})().catch(error=>{console.error(error);process.exitCode=1});
`);
    await new Promise((resolve,reject) => {
      const child=spawn(process.execPath,[path.join(dir,'run.cjs')],{cwd:dir,stdio:'inherit',env:{...process.env,NODE_PATH:''}});
      child.on('error',reject); child.on('close',code=>code===0?resolve():reject(new Error(`Feature smoke exited ${code}`)));
    });
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1});
