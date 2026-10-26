// Synthetic browser verification only. Never opens private sessions or calls a real model.
import { mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { startDashboard } from '../lib/web.mjs';
import { parseSnapshot } from '../lib/core.mjs';
import { fixture, jsonl, input, user } from '../test/fixtures.mjs';

if (!process.env.PI_SDK_PATH) throw new Error('Set PI_SDK_PATH to the installed Pi dist/index.js; synthetic fixture makes no model calls.');
process.env.PI_OFFLINE = '1';
const sdk = await import(pathToFileURL(path.resolve(process.env.PI_SDK_PATH)).href);
const base = fileURLToPath(new URL('../.tmp/', import.meta.url)); await mkdir(base,{recursive:true});
const root = await mkdtemp(path.join(base,'browser-'));
for (const [id,name,cwd,multiplier] of [['alpha','Project Alpha · synthetic','/synthetic/project-alpha',1],['beta','Project Beta · synthetic','/synthetic/project-beta',2],['xss','<img src="https://untrusted.invalid/leak" onerror="window.__lensXss=true">','/synthetic/xss',1]]) {
  const dir=path.join(root,id); await mkdir(dir);
  const records=fixture(id,cwd); records.find(e=>e.type==='session_info').name=name;
  let parent=records.at(-1).id;
  for(let i=0;i<12;i++){const id=`turn-${i}`;records.push(user(id,parent,`Synthetic evidence for ${name}. ${'Recorded task material. '.repeat((i+1)*multiplier)}`));parent=id;}
  await writeFile(path.join(dir,`${id}.jsonl`),jsonl(records));
}
let calls=0,aborted=0;
const counters=()=>writeFile(path.join(root,'mock-calls.json'),JSON.stringify({calls,aborted})); await counters();
const dashboard=await startDashboard({
  roots:[root], currentInfo:()=>({id:'current-synthetic',name:'Current synthetic session',cwd:'/synthetic/current',model:'mock-local/synthetic-only'}),
  captureCurrent:()=>{const content=input(fixture('current-synthetic','/synthetic/current'));return {...parseSnapshot(content),bytes:Buffer.byteLength(content.content),warnings:[]};},
  project:sdk.buildSessionProjection,
  getModel:()=>({provider:'mock-local',id:'synthetic-only',contextWindow:32000,maxTokens:2048,api:'mock'}),
  invoke:async(_model,context,options)=>{
    calls++;await counters();
    const payload=JSON.parse(context.messages[0].content[0].text);
    if(payload.question.includes('fail'))throw new Error('Synthetic provider failure; no retry.');
    await new Promise((resolve,reject)=>{
      const timer=payload.question.includes('wait')?undefined:setTimeout(resolve,700);
      options.signal.addEventListener('abort',()=>{clearTimeout(timer);aborted++;void counters();reject(new Error('Synthetic model cancelled'));},{once:true});
    });
    return {stopReason:'stop',usage:{input:40,output:15,cacheRead:0,cacheWrite:0,totalTokens:55},content:[{type:'text',text:JSON.stringify({answer:'The selected synthetic sample contains task evidence and recorded tool activity. This is a sample interpretation, not a whole-session conclusion.',evidenceIds:payload.snippets.slice(0,2).map(s=>s.id),classifications:payload.snippets.map(s=>({id:s.id,label:payload.allowedLabels[0],quote:s.text.slice(0,24),reason:'Supported by the quoted synthetic sample.'}))})}]};
  }
});
console.log(JSON.stringify({url:dashboard.url,pid:process.pid,root}));
const keepAlive=setInterval(()=>{},10000);
async function stop(){clearInterval(keepAlive);await dashboard.close();process.exit(0);}
process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());
