import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

class Element {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.textContent = ''; }
  append(...children) { this.children.push(...children); }
  replaceChildren() { this.children = []; }
  set innerHTML(_value) { throw new Error('Untrusted HTML insertion'); }
}
async function ui({ fetch, search = '' } = {}) {
  const elements = new Map();
  const history = { replaceState() {} };
  const sandbox = { URL, URLSearchParams, fetch, location: { search, origin: 'http://127.0.0.1:4317' }, history,
    document: {
      getElementById: (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
      createElement: (tag) => new Element(tag), createTextNode: (textContent) => ({ tag: '#text', textContent }),
    } };
  sandbox.window = sandbox;
  const code = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  vm.runInNewContext(code.slice(0, code.indexOf('const start =')), sandbox);
  return { sandbox, elements, history };
}
test('UI preserves native browser history and never injects answer HTML', async () => {
  const { sandbox, elements, history } = await ui();
  assert.equal(sandbox.window.history, history);
  sandbox.showAnswer('<img src=x onerror=alert(1)> **Bold** `code` [1] [2]', { results: [{ url: 'https://example.com/' }, { url: 'javascript:alert(1)' }] });
  const children = elements.get('answer').children;
  assert.equal(children.filter((n) => n.tag === 'a').length, 1);
  assert.equal(children.find((n) => n.tag === 'a').href, 'https://example.com/');
  assert.equal(children.find((n) => n.tag === 'strong').textContent, 'Bold');
  assert.equal(children.find((n) => n.tag === 'code').textContent, 'code');
  assert.ok(children.some((n) => n.tag === '#text' && n.textContent.includes('<img')));
  assert.ok(children.some((n) => n.tag === '#text' && n.textContent === '[2]'));
});
test('loading results never requests AI, including old cached answers; only the button does', async () => {
  const requests = [];
  const sources = { results: [{ title: 'Example', url: 'https://example.com/', text: 'Excerpt' }], attribution: 'Attribution' };
  const { sandbox, elements } = await ui({ search: '?q=hello', fetch: async (url, options) => {
    requests.push(url);
    if (url === '/api/summarize') assert.deepEqual(JSON.parse(options.body), { searchId: 1 });
    const data = {
      '/api/history': [], '/api/config': { token: 'fake' }, '/api/search': { id: 1 }, '/api/summarize': { id: 2 },
      '/api/jobs/1': { status: 'done', sources, answer: 'An old cached answer', error: null },
      '/api/jobs/2': { status: 'done', sources, answer: 'Explicitly requested summary [1]', error: null },
    }[url];
    assert.notEqual(data, undefined);
    return { ok: true, json: async () => data };
  } });
  sandbox.document.getElementById('answer-section').hidden = true;
  await sandbox.main();
  assert.equal(requests.filter((url) => url === '/api/summarize').length, 0);
  assert.equal(elements.get('answer-section').hidden, true);
  assert.equal(elements.get('summary-controls').hidden, false);
  assert.match(elements.get('status').textContent, /no answer-model tokens/);
  await elements.get('summarize').onclick();
  assert.equal(requests.filter((url) => url === '/api/summarize').length, 1);
  assert.equal(elements.get('answer-section').hidden, false);
  assert.equal(elements.get('summary-controls').hidden, true);
  assert.match(elements.get('status').textContent, /AI summary ready/);
});
