import { test } from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.mjs';
import { createRadiusSearch, normalizeSearch } from '../src/radius.mjs';

test('normalizes sources and drops unsafe URLs', () => {
  assert.deepEqual(normalizeSearch({ results: [{ url: 'javascript:alert(1)' }, { url: 'https://example.com/', text: '<script>' }] }).results,
    [{ title: 'example.com', url: 'https://example.com/', text: '<script>', publishDate: null }]);
  assert.throws(() => normalizeSearch({}));
});
test('Radius request resolves auth, preserves attribution and never follows redirects', async () => {
  const run = createRadiusSearch({ getAuth: async () => ({ auth: { apiKey: 'fake-token' } }) }, 'https://radius.pi.dev', async (url, opts) => {
    assert.equal(url.href, 'https://radius.pi.dev/v1/search'); assert.equal(opts.headers.get('authorization'), 'Bearer fake-token');
    assert.equal(opts.redirect, 'error'); assert.equal(JSON.parse(opts.body).query, 'test');
    return Response.json({ results: [], provider: { attribution: 'Exact attribution' } });
  });
  assert.equal((await run('test', new AbortController().signal)).attribution, 'Exact attribution');
});
test('HTTP serves browser search, protects paid operations and rejects DNS rebinding', async (t) => {
  let calls = 0, summaryCalls = 0;
  const engine = { history: async () => [], get: async () => null,
    start: async () => { calls++; return 'job-1'; },
    summarize: async (id) => { assert.equal(id, 1); summaryCalls++; return 'summary-1'; } };
  const server = await createServer({ engine });
  t.after(() => new Promise((r) => { server.closeAllConnections(); server.close(r); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(`${base}/search?q=hello`);
  assert.equal(page.status, 200); assert.match(await page.text(), /Pi Search/); assert.equal(calls, 0);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  const config = await (await fetch(`${base}/api/config`)).json();
  const opts = { method: 'POST', headers: { 'content-type': 'application/json', 'x-search-token': config.token, origin: base }, body: JSON.stringify({ query: 'hello' }) };
  assert.equal((await fetch(`${base}/api/search`, { ...opts, headers: { ...opts.headers, origin: 'https://evil.test' } })).status, 403);
  assert.equal((await fetch(`${base}/api/search`, { ...opts, headers: { ...opts.headers, 'x-search-token': 'wrong' } })).status, 403);
  assert.equal((await fetch(`${base}/api/search`, opts)).status, 202); assert.equal(calls, 1);
  assert.equal(summaryCalls, 0);
  const summaryOpts = { ...opts, body: JSON.stringify({ searchId: 1 }) };
  assert.equal((await fetch(`${base}/api/summarize`, { ...summaryOpts, headers: { ...opts.headers, origin: 'https://evil.test' } })).status, 403);
  assert.equal((await fetch(`${base}/api/summarize`, { ...summaryOpts, headers: { ...opts.headers, 'x-search-token': 'wrong' } })).status, 403);
  assert.equal(summaryCalls, 0);
  assert.equal((await fetch(`${base}/api/summarize`, summaryOpts)).status, 202);
  assert.equal(summaryCalls, 1);
  const rebound = await new Promise((resolve, reject) => {
    http.get(`${base}/healthz`, { headers: { host: `evil.test:${server.address().port}` } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(rebound, 403);
  assert.equal((await fetch(`${base}/api/search`, { ...opts, body: '{bad' })).status, 400);
  assert.equal((await fetch(`${base}/api/jobs/missing`)).status, 404);
  const os = await (await fetch(`${base}/opensearch.xml`)).text(); assert.match(os, /search\?q=\{searchTerms\}/);
});
