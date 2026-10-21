import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { openEngine, validateQuery } from '../src/engine.mjs';

const sources = { results: [{ title: 'Example', url: 'https://example.com/', text: 'Paris is the capital of France.' }], attribution: 'Search attribution' };
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'pi-search-test-'));
  const faux = fauxProvider({ tokensPerSecond: Infinity });
  faux.setResponses(Array.from({ length: 20 }, () => fauxAssistantMessage('Paris is the capital of France. [1]')));
  const models = createModels(); models.setProvider(faux.provider);
  const m = faux.getModel();
  const options = { database: join(dir, 'test.sqlite'), models, model: { provider: m.provider, modelId: m.id }, search: async () => sources };
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { options, faux };
}
async function settled(engine, id) {
  await engine.harness.waitForTask(id, (await import('@earendil-works/chord/context')).BACKGROUND_CONTEXT);
  return engine.get(id);
}
test('validates query bounds', () => {
  assert.equal(validateQuery(' 日本語 '), '日本語');
  for (const q of ['', '  ', null, 32, 'x'.repeat(2001)]) assert.throws(() => validateQuery(q));
});
test('ordinary search uses zero model calls, deduplicates and persists results', async (t) => {
  const { options, faux } = await setup(t);
  let calls = 0;
  const open = () => openEngine({ ...options, search: async () => { calls++; return sources; } });
  let engine = await open();
  try {
    const ids = await Promise.all(Array.from({ length: 4 }, () => engine.start('capital of France')));
    assert.equal(new Set(ids).size, 1);
    const result = await settled(engine, ids[0]);
    assert.equal(result.status, 'done'); assert.equal(result.error, null);
    assert.equal(result.answer, ''); assert.deepEqual(result.sources, sources);
    assert.equal(faux.state.callCount, 0);
    assert.equal(calls, 1);
    await engine.close(); engine = await open();
    assert.equal((await engine.history())[0].id, ids[0]);
    assert.equal(await engine.start('capital of France'), ids[0]);
    assert.equal((await engine.get(ids[0])).answer, result.answer);
    assert.equal(calls, 1);
  } finally { await engine.close(); }
});
test('source results survive an interrupted answer and resume without searching again', async (t) => {
  const { options, faux } = await setup(t);
  let calls = 0;
  // A provider response that blocks until the process/harness is closed.
  faux.setResponses([async (_ctx, opts) => {
    await new Promise((resolve) => { opts.signal.addEventListener('abort', resolve, { once: true }); });
    return fauxAssistantMessage('', { stopReason: 'aborted' });
  }]);
  const open = () => openEngine({ ...options, search: async () => { calls++; return sources; } });
  let engine = await open();
  try {
    const searchId = await engine.start('recover this search');
    await settled(engine, searchId);
    assert.equal(faux.state.callCount, 0);
    const id = await engine.summarize(searchId);
    const deadline = Date.now() + 5000;
    while (faux.state.callCount < 1 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    assert.equal((await engine.get(id)).status, 'answer');
    await engine.close();
    faux.setResponses([fauxAssistantMessage('Recovered answer. [1]')]);
    engine = await open();
    const result = await settled(engine, id);
    assert.equal(result.error, null); assert.match(result.answer, /Recovered/); assert.equal(calls, 1);
  } finally { await engine.close(); }
});
test('summaries require explicit opt-in, reuse sources, and deduplicate across restarts', async (t) => {
  const { options, faux } = await setup(t);
  let searches = 0;
  const open = () => openEngine({ ...options, search: async () => { searches++; return sources; } });
  let engine = await open();
  try {
    const searchId = await engine.start('opt in');
    await settled(engine, searchId);
    assert.equal(faux.state.callCount, 0);
    const ids = await Promise.all(Array.from({ length: 4 }, () => engine.summarize(searchId)));
    assert.equal(new Set(ids).size, 1);
    const result = await settled(engine, ids[0]);
    assert.match(result.answer, /Paris.*\[1\]/);
    assert.equal(faux.state.callCount, 1); assert.equal(searches, 1);
    await engine.close(); engine = await open();
    assert.equal(await engine.summarize(searchId), ids[0]);
    assert.equal(faux.state.callCount, 1); assert.equal(searches, 1);
    assert.equal((await engine.get(searchId)).answer, '');
    await assert.rejects(engine.summarize(ids[0]), /not ready/);
  } finally { await engine.close(); }
});
test('search still works with no summary model configured', async (t) => {
  const { options, faux } = await setup(t);
  const engine = await openEngine({ ...options, model: null });
  try {
    const id = await engine.start('without a model');
    assert.deepEqual((await settled(engine, id)).sources, sources);
    await assert.rejects(engine.summarize(id), /No valid summary model/);
    assert.equal(faux.state.callCount, 0);
  } finally { await engine.close(); }
});
test('search failures are visible and not cached on retry', async (t) => {
  const { options } = await setup(t);
  const engine = await openEngine({ ...options, search: async () => { throw new Error('Provider offline'); } });
  try {
    const id = await engine.start('failure');
    assert.equal((await settled(engine, id)).error, 'Provider offline');
    assert.notEqual(await engine.start('failure'), id);
    await engine.harness.waitForIdle((await import('@earendil-works/chord/context')).BACKGROUND_CONTEXT);
  } finally { await engine.close(); }
});
