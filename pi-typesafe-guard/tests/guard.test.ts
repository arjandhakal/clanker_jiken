import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, symlink, unlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { guard } from '../src/guard.ts';
import { approve, Serial, secretInput } from '../src/ui.ts';
import { evaluate, QUESTIONS, parseSignals, TypeSafeError, type Signals } from '../src/typesafe.ts';
import { Credentials, type SecretStore } from '../src/credentials.ts';
import { assess, type Metadata } from '../src/policy.ts';

const signals = Object.fromEntries(Object.keys(QUESTIONS).map(k => [k, 0])) as Signals;
const response = () => ({ answers: Object.fromEntries(Object.keys(QUESTIONS).map(k => [k, { type: 'noul', noul: 0 }])) });
const context = (more: Partial<ExtensionContext> = {}) => ({ cwd: process.cwd(), hasUI: true, mode: 'tui', ...more }) as ExtensionContext;
const shell = () => ({ toolName: 'bash', input: { command: 'rm file.txt' } });
const metadata: Metadata = { kind: 'shell', operations: ['deletion'], pathScope: 'unknown', protectedPath: false, secretIndicator: false, githubScope: 'not-detected', githubAuthor: 'unverified' };

test('headless denies without calling API or approval UI', async () => {
  const result = await guard(shell(), context({ hasUI: false }), { builtin: true, remoteEnabled: true, key: 'test-key', evaluate: async () => { throw new Error('must not call'); } });
  assert.equal(result?.block, true); assert.match(result!.reason, /no UI/);
});
test('low TypeSafe scores cannot bypass human denial', async () => {
  const result = await guard(shell(), context(), { builtin: true, remoteEnabled: true, key: 'test-key', evaluate: async () => signals, approve: async () => false });
  assert.equal(result?.block, true);
});
test('API failure requires explicit human approval, not implicit execution', async () => {
  for (const allowed of [false, true]) {
    const result = await guard(shell(), context(), { builtin: true, remoteEnabled: true, key: 'test-key', evaluate: async () => { throw new TypeSafeError('HTTP 401'); }, approve: async (_ctx, summary) => { assert.match(summary, /401/); return allowed; } });
    assert.equal(result?.block, allowed ? undefined : true);
  }
});
test('approval applies only once, no approval cache', async () => {
  let count = 0;
  const options = { builtin: true, remoteEnabled: false, approve: async () => { count++; return true; } };
  await guard(shell(), context(), options); await guard(shell(), context(), options);
  assert.equal(count, 2);
});
test('abort and argument mutation after approval both block', async () => {
  const controller = new AbortController();
  const aborted = await guard(shell(), context({ signal: controller.signal }), { builtin: true, remoteEnabled: false, approve: async () => { controller.abort(); return true; } });
  assert.equal(aborted?.block, true);
  const call = shell();
  const changed = await guard(call, context(), { builtin: true, remoteEnabled: false, approve: async () => { call.input.command = 'rm -rf .'; return true; } });
  assert.match(changed!.reason, /changed/);
});
test('oversized or malformed input never fails open', async () => {
  const call = { toolName: 'bash', input: { command: 'a'.repeat(65000) } };
  assert.equal((await guard(call, context(), { builtin: true, remoteEnabled: false }))?.block, true);
  const cycle: any = {}; cycle.self = cycle;
  assert.equal((await guard({ toolName: 'other', input: cycle }, context(), { builtin: false, remoteEnabled: false }))?.block, true);
});

test('approval UI denies escape, defaults Deny, paginates and requires typed high-risk confirmation', async () => {
  let calls = 0;
  const ctx = context({ ui: { select: async (_title: string, options: string[]) => {
    assert.equal(options[0], 'Deny'); calls++; return calls === 1 ? 'Next page' : 'Allow once';
  }, input: async () => 'ALLOW' } as any });
  assert.equal(await approve(ctx, 'danger', 'x'.repeat(4000), true, []), true);
  assert.equal(calls, 2);
  ctx.ui.select = async () => undefined;
  assert.equal(await approve(ctx, 'danger', '{}', false, []), false);
  ctx.ui.select = async () => 'Allow once'; ctx.ui.input = async () => 'allow';
  assert.equal(await approve(ctx, 'danger', '{}', true, []), false);
});
test('secure input is unavailable in RPC and never uses plain input()', async () => {
  const ctx = context({ mode: 'rpc', ui: { input: async () => { throw new Error('unsafe'); } } as any });
  assert.equal(await secretInput(ctx), undefined);
});
test('secret input renders neither pasted key nor its characters', async () => {
  const key = 'sample-private-api-key';
  const ctx = context({ ui: { custom: async (factory: any) => new Promise(resolve => {
    const component = factory({ requestRender() {} }, {}, {}, resolve);
    component.handleInput(key);
    assert.doesNotMatch(component.render(80).join('\n'), /sample-private-api-key/);
    component.handleInput('\r');
  }) } as any });
  assert.equal(await secretInput(ctx), key);
});
test('a symlink target changed while awaiting approval invalidates approval', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'guard-target-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, 'one'), 'one'); await writeFile(join(cwd, 'two'), 'two');
  await symlink(join(cwd, 'one'), join(cwd, 'link'));
  const result = await guard({ toolName: 'write', input: { path: 'link', content: 'new' } }, context({ cwd }), {
    builtin: true, remoteEnabled: false, approve: async () => {
      await unlink(join(cwd, 'link')); await symlink(join(cwd, 'two'), join(cwd, 'link')); return true;
    },
  });
  assert.match(result!.reason, /target changed/);
});
test('serialized UI recovers from failures without overlap', async () => {
  const queue = new Serial(); const order: string[] = [];
  const first = queue.run(async () => { order.push('a'); throw new Error('intentional'); }).catch(() => {});
  const second = queue.run(async () => { order.push('b'); });
  await Promise.all([first, second]); assert.deepEqual(order, ['a', 'b']);
});

test('TypeSafe documented request shape, exact endpoint and redirect refusal', async () => {
  const result = await evaluate(metadata, 'opaque-test-key', undefined, (async (url, init) => {
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone'); assert.equal(init?.redirect, 'error');
    const body = JSON.parse(init!.body as string);
    assert.equal(body.model, 'jev-latest'); assert.deepEqual(body.questions, QUESTIONS);
    assert.deepEqual(body.state, metadata); assert.equal(JSON.stringify(body).includes('opaque-test-key'), false);
    assert.equal((init!.headers as Record<string, string>).Authorization, 'Bearer opaque-test-key');
    return new Response(JSON.stringify(response()));
  }) as typeof fetch);
  assert.deepEqual(result, signals);
});
test('reject missing, malformed, out-of-range or nonnumeric answers', () => {
  for (const bad of [null, {}, { answers: {} }]) assert.throws(() => parseSignals(bad));
  for (const bad of [NaN, Infinity, -1, 1.01, '0', null]) {
    const payload = response(); payload.answers.destructive.noul = bad as number;
    assert.throws(() => parseSignals(payload));
  }
});
test('HTTP failures, invalid JSON, huge bodies and timeouts are sanitized', async () => {
  for (const status of [401, 403, 422, 429, 500, 529]) {
    await assert.rejects(evaluate(metadata, 'key-secret', undefined, (async () => new Response('key-secret', { status })) as typeof fetch), error => !String(error).includes('key-secret'));
  }
  for (const body of ['not json key-secret', 'x'.repeat(33000)]) {
    await assert.rejects(evaluate(metadata, 'key-secret', undefined, (async () => new Response(body)) as typeof fetch), error => !String(error).includes('key-secret'));
  }
  const keepAlive = setTimeout(() => {}, 200);
  try {
    await assert.rejects(evaluate(metadata, 'key-secret', undefined, ((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error('key-secret')), { once: true });
    })) as typeof fetch, 10), /timed out/);
  } finally { clearTimeout(keepAlive); }
});
test('TypeSafe never receives original tool input', async () => {
  const local = await assess({ toolName: 'write', input: { path: 'SECRET_FILENAME.txt', content: 'PRIVATE_SOURCE' } }, process.cwd(), true);
  await evaluate(local.metadata, 'private-key', undefined, (async (_url, init) => {
    assert.doesNotMatch(init!.body as string, /SECRET_FILENAME|PRIVATE_SOURCE|private-key/);
    return new Response(JSON.stringify(response()));
  }) as typeof fetch);
});

function memoryStore() {
  let value: string | undefined;
  const store: SecretStore = { getPassword: async () => value, setPassword: async key => { value = key; }, deletePassword: async () => { const exists = !!value; value = undefined; return exists; } };
  return store;
}
test('credentials: persistence, replacement, memory override, removal and missing key', async () => {
  const store = memoryStore(); const keys = new Credentials(async () => store);
  await keys.load(); assert.equal(keys.value, undefined);
  await keys.set('test-key-one', true); assert.equal(keys.source, 'keychain');
  await keys.set('test-key-two', true); assert.equal(await store.getPassword(), 'test-key-two');
  await keys.set('session-key', false); assert.equal(await store.getPassword(), 'test-key-two');
  assert.equal(keys.source, 'session');
  assert.equal(await keys.remove(), true); assert.equal(keys.value, undefined);
  assert.equal(await keys.remove(), false);
});
test('invalid keys and failed writes preserve previous working key; no plaintext fallback', async () => {
  const keys = new Credentials(async () => { throw new Error('locked'); });
  await keys.set('old-working-key', false);
  for (const bad of ['', 'short', 'a\nbbbbbbb', 'a'.repeat(4097)]) await assert.rejects(keys.set(bad, false));
  await assert.rejects(keys.set('new-valid-key', true)); assert.equal(keys.value, 'old-working-key');
  await assert.rejects(keys.remove()); assert.equal(keys.value, undefined); assert.equal(keys.source, 'none');
});
test('late keychain read cannot restore a removed/cleared key', async () => {
  let done!: (key: string) => void;
  const store = memoryStore(); store.getPassword = () => new Promise(resolve => { done = resolve; });
  const keys = new Credentials(async () => store);
  const loading = keys.load(); await Promise.resolve(); keys.clear(); done('late-secret'); await loading;
  assert.equal(keys.value, undefined);
});
