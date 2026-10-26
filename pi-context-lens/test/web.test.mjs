import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { startDashboard } from '../lib/web.mjs';
import { parseSnapshot, rawMessages } from '../lib/core.mjs';
import { fixture, jsonl, input, temp } from './fixtures.mjs';

async function setup(t, overrides = {}) {
  const root = await temp();
  await mkdir(path.join(root, 'a')); await mkdir(path.join(root, 'b'));
  const files = [path.join(root, 'a', 'a.jsonl'), path.join(root, 'b', 'b.jsonl')];
  await writeFile(files[0], jsonl(fixture('a', '/synthetic/a'))); await writeFile(files[1], jsonl(fixture('b', '/synthetic/b')));
  let captures = 0, calls = 0, model = { provider: 'mock', id: 'synthetic-model', api: 'mock', contextWindow: 32000, maxTokens: 2048 };
  const dashboard = await startDashboard({
    roots: [root], currentInfo: () => ({ id:'live', name:'Current synthetic', cwd:'/synthetic/live', model:'mock/synthetic-model' }),
    captureCurrent: () => { captures++; const content = input(fixture('live', '/synthetic/live')); return { ...parseSnapshot(content), bytes:Buffer.byteLength(content.content), warnings:[] }; },
    project: entries => ({ entries: entries.map(sourceEntry => ({ sourceEntry, messages:rawMessages(sourceEntry) })) }),
    getModel: () => model,
    invoke: async (_model, context) => {
      calls++; const payload = JSON.parse(context.messages[0].content[0].text);
      return { stopReason:'stop', usage:{totalTokens:25}, content:[{type:'text', text:JSON.stringify({answer:'Synthetic sample interpretation', evidenceIds:[payload.snippets[0].id], classifications:payload.snippets.map(s => ({id:s.id,label:payload.allowedLabels[0],quote:s.text.slice(0,10),reason:'Synthetic evidence'}))})}] };
    }, ...overrides
  });
  t.after(async () => { await dashboard.close(); await rm(root, {recursive:true,force:true}); });
  const token = new URLSearchParams(new URL(dashboard.url).hash.slice(1)).get('token');
  async function request(route, body, extra = {}) {
    const response = await fetch(dashboard.origin + route, { method:body === undefined ? 'GET' : 'POST', headers:{Authorization:`Bearer ${token}`, Origin:dashboard.origin, ...(body === undefined ? {} : {'Content-Type':'application/json'}), ...extra}, body:body === undefined ? undefined : JSON.stringify(body) });
    return { status:response.status, body:await response.json(), response };
  }
  async function done() {
    for (let i = 0; i < 500; i++) { const result = await request('/api/state'); if (result.body.job?.status !== 'running') return result.body; await new Promise(r => setTimeout(r, 2)); }
    throw new Error('Synthetic job did not settle');
  }
  async function inspect(keys = ['current'], scope = 'branch', leaves) { const started = await request('/api/report', {keys,scope,leaves}); assert.equal(started.status,200); return done(); }
  return { root, files, dashboard, token, request, done, inspect, captures:()=>captures, calls:()=>calls, setModel:value=>{model=value;} };
}

test('local HTTP boundary: loopback/capability, Host/Origin, no-store/CSP, JSON/body limits and static whitelist', async t => {
  const env = await setup(t);
  assert.equal(new URL(env.dashboard.origin).hostname, '127.0.0.1');
  const shell = await fetch(env.dashboard.origin); assert.equal(shell.status,200); assert.match(await shell.text(), /Context Lens/);
  assert.equal(shell.headers.get('cache-control'),'no-store'); assert.match(shell.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(shell.headers.get('access-control-allow-origin'), null);
  assert.equal((await fetch(env.dashboard.origin+'/api/state')).status,401);
  assert.equal((await env.request('/api/state', undefined, {Authorization:'Bearer wrong'})).status,401);
  assert.equal((await env.request('/api/state', undefined, {Authorization:env.token})).status,401);
  assert.equal((await env.request('/api/state', undefined, {Origin:'https://untrusted.invalid'})).status,403);
  assert.equal((await env.request('/api/clear', {}, {Origin:'https://untrusted.invalid'})).status,403);
  const noOrigin = await fetch(env.dashboard.origin+'/api/clear', {method:'POST',headers:{Authorization:`Bearer ${env.token}`,'Content-Type':'application/json'},body:'{}'}); assert.equal(noOrigin.status,403);
  assert.equal((await env.request('/api/clear', {}, {'Content-Type':'text/plain'})).status,415);
  assert.equal((await env.request('/api/prepare', {question:'x'.repeat(17000)})).status,413);
  assert.equal((await env.request('/api/sessions?q='+encodeURIComponent('x'.repeat(513)))).status,400);
  assert.equal((await env.request('/api/sessions?offset=-1')).status,400);
  assert.equal((await env.request('/../../LICENSE')).status,404);
  assert.equal((await env.request('/api/report', {keys:['/arbitrary/private/path'],scope:'branch'})).status,400);
  const badHost = await new Promise((resolve,reject) => {
    const req = http.get(env.dashboard.origin+'/api/state',{headers:{Host:'untrusted.invalid',Authorization:`Bearer ${env.token}`}},res=>{res.resume();resolve(res.statusCode);}); req.on('error',reject);
  }); assert.equal(badHost,403);
  assert.equal(env.captures(),0); assert.equal(env.calls(),0);
});

test('metadata-first discovery, multi-project selection, branch/history, evidence limits and stale IDs', async t => {
  const env = await setup(t);
  let list = (await env.request('/api/sessions')).body;
  assert.equal(list.total,1); assert.equal(env.captures(),0);
  await env.request('/api/discover',{}); await env.done();
  list = (await env.request('/api/sessions')).body;
  assert.equal(list.total,3); assert.ok(!JSON.stringify(list).includes('Synthetic file evidence'));
  assert.equal((await env.request('/api/sessions?q='+encodeURIComponent('/synthetic/b'))).body.total,1);
  const keys = list.sessions.filter(s=>!s.current).map(s=>s.key);
  const inspected = await env.inspect(keys);
  assert.equal(inspected.report.sessions.length,2);
  assert.equal(env.captures(),0); assert.equal(env.calls(),0);
  assert.ok(!JSON.stringify(inspected.report).includes('Synthetic file evidence'));
  assert.ok(inspected.report.sessions[0].branches.includes('abandoned'));
  const first = inspected.report.sessions[0].contributors.find(p=>p.kind==='text');
  const evidence = await env.request(`/api/evidence?reportId=${inspected.report.id}&id=${encodeURIComponent(first.id)}`);
  assert.equal(evidence.status,200); assert.ok(evidence.body.text); assert.ok(evidence.body.text.length<=16000);
  const history = await env.inspect(keys,'history');
  assert.ok(history.report.sessions[0].totals.estimatedTokens>inspected.report.sessions[0].totals.estimatedTokens);
  assert.equal((await env.request(`/api/evidence?reportId=${inspected.report.id}&id=${encodeURIComponent(first.id)}`)).status,409);
  const branch = await env.inspect([keys[0]],'branch',{[keys[0]]:'abandoned'});
  assert.equal(branch.report.sessions[0].leafId,'abandoned');
  const bad = await env.inspect([keys[0]],'branch',{[keys[0]]:'invented'}); assert.equal(bad.job.status,'error');
  assert.equal(bad.report.id,branch.report.id,'failed inspection preserves completed report');
  await env.inspect(); assert.equal(env.captures(),1,'current snapshot is captured only after explicit selection');
});

test('missing selected file produces a warning while other selected reports survive', async t => {
  const env = await setup(t); await env.request('/api/discover',{}); await env.done();
  const sessions = (await env.request('/api/sessions')).body.sessions.filter(s=>!s.current);
  await unlink(sessions[0].path);
  const state = await env.inspect(sessions.map(s=>s.key));
  assert.equal(state.report.sessions.length,1); assert.equal(state.report.sessions[0].key,sessions[1].key); assert.match(state.report.warnings.join(),/ENOENT/);
});

test('browser AI is preview-first, explicit single-use approval on the same model route', async t => {
  const env = await setup(t), state = await env.inspect();
  const prepared = await env.request('/api/prepare',{reportId:state.report.id,question:'Which evidence matters?',dimension:'usefulness'});
  assert.equal(prepared.status,200); assert.equal(env.calls(),0); assert.ok(prepared.body.snippets.length<=24);
  assert.equal(prepared.body.provider,'mock'); assert.equal(prepared.body.model,'synthetic-model');
  assert.equal(prepared.body.apiKey,undefined); assert.ok(prepared.body.userText.includes(prepared.body.snippets[0].id));
  assert.equal((await env.request('/api/analyze',{planId:prepared.body.planId})).status,400); assert.equal(env.calls(),0);
  const started = await env.request('/api/analyze',{planId:prepared.body.planId,approved:true}); assert.equal(started.status,200);
  const result = await env.done(); assert.equal(env.calls(),1); assert.equal(result.interpretation.provider,'mock'); assert.equal(result.interpretation.usage.totalTokens,25);
  assert.equal((await env.request('/api/analyze',{planId:prepared.body.planId,approved:true})).status,409); assert.equal(env.calls(),1);
  assert.equal((await env.request('/api/prepare',{reportId:state.report.id,question:'q',dimension:'constructor'})).status,400);
  await env.request('/api/prepare',{reportId:state.report.id,question:'q',dimension:'phases'});
  const changed = await env.request('/api/prepare',{reportId:state.report.id,question:'q',dimension:'sources'});
  env.setModel({provider:'different',id:'other',contextWindow:32000,maxTokens:2048});
  assert.equal((await env.request('/api/analyze',{planId:changed.body.planId,approved:true})).status,409); assert.equal(env.calls(),1);
});

test('expired plans, busy operations, provider cancellation, clear and listener shutdown', async t => {
  let clock=0, signal, calls=0;
  const env = await setup(t,{now:()=>clock,planTtlMs:10,invoke:async (_m,_context,options)=>{calls++;signal=options.signal;return new Promise(()=>{});}});
  const state=await env.inspect();
  let plan=(await env.request('/api/prepare',{reportId:state.report.id,question:'q',dimension:'recovery'})).body;
  clock=20; assert.equal((await env.request('/api/analyze',{planId:plan.planId,approved:true})).status,409); assert.equal(calls,0);
  plan=(await env.request('/api/prepare',{reportId:state.report.id,question:'q',dimension:'recovery'})).body;
  await env.request('/api/analyze',{planId:plan.planId,approved:true});
  for(let i=0;!signal&&i<50;i++)await new Promise(r=>setTimeout(r,2));
  assert.equal((await env.request('/api/discover',{})).status,409);
  await env.request('/api/cancel',{}); assert.ok(signal.aborted);
  const cancelled=await env.done(); assert.equal(cancelled.job.status,'cancelled'); assert.equal(cancelled.report.id,state.report.id); assert.equal(calls,1);
  await env.request('/api/clear',{}); const cleared=(await env.request('/api/state')).body; assert.equal(cleared.report,null); assert.equal(cleared.interpretation,null); assert.equal(cleared.job,null);
  await env.dashboard.close(); await assert.rejects(fetch(env.dashboard.origin+'/api/state'));
});

test('provider errors do not retry or erase deterministic browser report', async t => {
  let calls=0;
  const env=await setup(t,{invoke:async()=>{calls++;throw new Error('Synthetic provider unavailable');}});
  const state=await env.inspect();
  const plan=(await env.request('/api/prepare',{reportId:state.report.id,question:'q',dimension:'sources'})).body;
  await env.request('/api/analyze',{planId:plan.planId,approved:true});
  const result=await env.done(); assert.equal(result.job.status,'error'); assert.match(result.job.error,/provider unavailable/); assert.equal(result.report.id,state.report.id); assert.equal(calls,1);
});
