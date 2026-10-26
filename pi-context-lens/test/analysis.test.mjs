import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { normalize, parseSnapshot } from '../lib/core.mjs';
import { prepareAnalysis, runAnalysis, validateResponse } from '../lib/analysis.mjs';
import { fixture, input } from './fixtures.mjs';
const model = { provider: 'mock-provider', id: 'mock-model', contextWindow: 32000, maxTokens: 2048 };
const reports = ['a', 'b'].map(id => normalize(parseSnapshot(input(fixture(id, `/project/${id}`))), 'branch'));
const plan = () => prepareAnalysis(reports, 'Which evidence is useful?', 'usefulness', model);
const answer = p => JSON.stringify({ answer: 'Sample interpretation only', evidenceIds: [p.snippets[0].id], classifications: p.snippets.map(s => ({ id: s.id, label: 'useful-evidence', quote: s.text.slice(0, 12), reason: 'Synthetic evidence' })) });
test('bounded session-balanced explicit payload contains no binaries/signatures/details', () => {
  const p = plan();
  assert.equal(p.model, model);
  assert.ok(p.snippets.length <= 24); assert.ok(p.snippets.every(s => s.text.length <= 1000));
  assert.equal(new Set(p.snippets.map(s => s.sessionId)).size, 2);
  assert.ok(p.bytes <= 32768); assert.ok(!/OPAQUE_NOT|DETAILS_NOT|image\/png/.test(p.userText));
  assert.throws(() => prepareAnalysis(reports, 'q', 'unknown', model), /dimension/);
  assert.throws(() => prepareAnalysis(reports, 'q', 'phases', { ...model, contextWindow: 4096 }), /too small/);
  const big = structuredClone(reports);
  for (const r of big) { r.parts = Array.from({ length: 100 }, (_, i) => ({ ...r.parts[0], id: `${r.snapshot.header.id}/${i}`, text: '日'.repeat(3000), chars: 3000 })); }
  const small = prepareAnalysis(big, 'q', 'phases', { ...model, contextWindow: 16000 });
  assert.ok(small.bytes <= 16000 - small.maxTokens - 4096); assert.ok(small.omittedParts > 0); assert.ok(small.truncatedParts > 0);
});
test('no invocation without approval; one captured Pi route with bounded options and usage', async () => {
  const p = plan(); let calls = 0;
  const invoke = async (m, context, options) => {
    calls++; assert.equal(m, model); assert.equal(options.maxRetries, 0); assert.equal(options.maxTokens, 2048); assert.ok(options.signal);
    assert.equal(context.messages.length, 1); assert.equal(context.messages[0].content[0].text, p.userText); assert.equal(context.tools, undefined);
    return { stopReason: 'stop', content: [{ type: 'text', text: answer(p) }], usage: { totalTokens: 50 } };
  };
  await assert.rejects(runAnalysis(p, { approved: false, invoke }), /approval/); assert.equal(calls, 0);
  const result = await runAnalysis(p, { approved: true, invoke });
  assert.equal(calls, 1); assert.equal(result.provider, model.provider); assert.equal(result.usage.totalTokens, 50);
  assert.equal(result.aggregate['useful-evidence'].snippets, p.snippets.length);
});
test('invalid labels/quotes/IDs, duplicates/missing results cannot invent classifications', () => {
  const p = plan(); const id = p.snippets[0].id;
  const result = validateResponse(JSON.stringify({ answer: 'not grounded', evidenceIds: ['invented'], classifications: [
    { id, label: 'useful-evidence', quote: p.snippets[0].text, reason: 'ok' },
    { id, label: 'repetition', quote: p.snippets[0].text, reason: 'duplicate' },
    { id: p.snippets[1].id, label: 'invented', quote: 'fabricated', reason: 'wrong' }, { id: 'unknown' }
  ] }), p);
  assert.ok(result.classifications.every(c => c.label === 'unclassified')); assert.match(result.answer, /withheld/);
  assert.throws(() => validateResponse('not JSON', p), /invalid JSON/);
  assert.throws(() => validateResponse('{}', p), /shape/);
});
test('provider failures/overflow/tool requests/length do not retry or execute', async () => {
  for (const stopReason of ['error', 'length', 'toolUse', 'deferred', 'aborted']) {
    let calls = 0;
    await assert.rejects(runAnalysis(plan(), { approved: true, invoke: async () => { calls++; return { stopReason, errorMessage: 'synthetic failure' }; } }), /no retry/);
    assert.equal(calls, 1);
  }
  await assert.rejects(runAnalysis(plan(), { approved: true, invoke: async () => { throw new Error('Provider unavailable'); } }), /Provider unavailable/);
});
test('cancellation and timeout abort underlying call and discard late results', async () => {
  const c = new AbortController(); let signal;
  const running = runAnalysis(plan(), { approved: true, signal: c.signal, invoke: async (_m, _ctx, options) => { signal = options.signal; c.abort(new Error('User cancelled')); return new Promise(() => {}); } });
  await assert.rejects(running, /User cancelled/); assert.ok(signal.aborted);
  let timeoutSignal;
  await assert.rejects(runAnalysis(plan(), { approved: true, timeoutMs: 5, invoke: async (_m, _ctx, options) => { timeoutSignal = options.signal; return new Promise(() => {}); } }), /timeout/);
  assert.ok(timeoutSignal.aborted);
});
test('runtime routes are limited to loopback UI, fixed browser openers and the existing Pi model registry', async () => {
  const files = [...(await readdir(new URL('../lib/', import.meta.url))).map(f => new URL(`../lib/${f}`, import.meta.url)), ...(await readdir(new URL('../extensions/', import.meta.url))).map(f => new URL(`../extensions/${f}`, import.meta.url))];
  const source = (await Promise.all(files.map(f => readFile(f, 'utf8')))).join('\n');
  assert.doesNotMatch(source.replaceAll('pi.exec(', 'browserOpener('), /\bfetch\s*\(|node:(?:https|net|child_process)|\bspawn\s*\(|\bexec\s*\(|sendUserMessage\s*\(|sendMessage\s*\(|appendEntry\s*\(|SessionManager\.open\s*\(|getApiKey|auth\.json|writeFile\s*\(/);
  assert.deepEqual([...source.matchAll(/pi\.exec\('([^']+)'/g)].map(m => m[1]).sort(), ['open', 'rundll32', 'xdg-open']);
  assert.match(source, /server\.listen\(0, '127\.0\.0\.1'/);
  assert.match(source, /ctx\.modelRegistry\.streamSimple/);
  const browser = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(browser, /innerHTML|outerHTML|eval\s*\(|localStorage|https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
  assert.match(browser, /sessionStorage/);
  assert.match(browser, /Authorization: `Bearer/);
});
