import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { openEngine } from '../src/engine.mjs';

const sources = { results: [{ title: 'Example', url: 'https://example.com/', text: 'Example facts' }], attribution: '' };
async function setup(t, extras = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'pi-search-limits-'));
  const faux = fauxProvider({ tokensPerSecond: Infinity });
  faux.setResponses(Array.from({ length: 10 }, () => fauxAssistantMessage('Answer [1]')));
  const models = createModels(); models.setProvider(faux.provider);
  const m = faux.getModel();
  const engine = await openEngine({ database: join(dir, 'test.sqlite'), models, model: { provider: m.provider, modelId: m.id }, search: async () => sources, ...extras });
  t.after(async () => { await engine.close(); await rm(dir, { recursive: true, force: true }); });
  return { engine, faux };
}
test('cache expires but saved result remains readable', async (t) => {
  let now = 1000;
  const { engine } = await setup(t, { now: () => now, ttlMs: 100 });
  const first = await engine.start('cached');
  await engine.harness.waitForTask(first, context);
  assert.equal(await engine.start('cached'), first);
  now += 101;
  const next = await engine.start('cached');
  assert.notEqual(next, first);
  await engine.harness.waitForTask(next, context);
  assert.equal((await engine.get(String(first))).status, 'done');
  assert.equal(await engine.get('invalid'), null);
});
test('concurrent searches are capped and duplicates do not use another slot', async (t) => {
  const { engine } = await setup(t, { search: async (_query, signal) => {
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    signal.throwIfAborted(); return sources;
  } });
  const first = await engine.start('one');
  await engine.start('two'); await engine.start('three');
  assert.equal(await engine.start('one'), first);
  await assert.rejects(engine.start('four'), /already running/);
});
test('an empty model response preserves usable web sources', async (t) => {
  const { engine, faux } = await setup(t);
  faux.setResponses([fauxAssistantMessage('')]);
  const searchId = await engine.start('empty answer');
  await engine.harness.waitForTask(searchId, context);
  assert.equal(faux.state.callCount, 0);
  const id = await engine.summarize(searchId);
  await engine.harness.waitForTask(id, context);
  const result = await engine.get(id);
  assert.deepEqual(result.sources, sources);
  assert.match(result.error, /no answer/);
});
