import http from 'node:http';
import { readFile, mkdir, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import lockfile from 'proper-lockfile';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { openEngine } from './engine.mjs';
import { createRadiusSearch } from './radius.mjs';

const project = dirname(dirname(fileURLToPath(import.meta.url)));

export async function createServer({ engine, port = 0 }) {
  const token = randomBytes(32).toString('hex');
  const assets = new Map(await Promise.all(['index.html', 'app.js', 'style.css'].map(async (name) => [name, await readFile(join(project, 'public', name))])));
  const send = (res, status, data, type = 'application/json') => {
    res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" });
    res.end(type === 'application/json' ? JSON.stringify(data) : data);
  };
  const server = http.createServer(async (req, res) => {
    try {
      const actualPort = server.address().port;
      const allowedHosts = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`];
      if (!allowedHosts.includes(req.headers.host)) return send(res, 403, { error: 'Invalid host' });
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === 'GET') {
        if (url.pathname === '/healthz') return send(res, 200, { ok: true });
        if (url.pathname === '/api/config') return send(res, 200, { token });
        if (url.pathname === '/api/history') return send(res, 200, await engine.history());
        if (url.pathname.startsWith('/api/jobs/')) {
          const job = await engine.get(url.pathname.slice('/api/jobs/'.length));
          return send(res, job ? 200 : 404, job || { error: 'Not found' });
        }
        if (url.pathname === '/opensearch.xml') return send(res, 200,
          `<?xml version="1.0"?><OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/"><ShortName>Pi Search</ShortName><Description>Web results with optional AI summaries</Description><InputEncoding>UTF-8</InputEncoding><Url type="text/html" template="http://127.0.0.1:${actualPort}/search?q={searchTerms}"/></OpenSearchDescription>`, 'application/opensearchdescription+xml');
        if (['/', '/search'].includes(url.pathname)) return send(res, 200, assets.get('index.html'), 'text/html');
        if (url.pathname === '/app.js') return send(res, 200, assets.get('app.js'), 'text/javascript');
        if (url.pathname === '/style.css') return send(res, 200, assets.get('style.css'), 'text/css');
        return send(res, 404, { error: 'Not found' });
      }
      if (req.method !== 'POST' || !['/api/search', '/api/summarize'].includes(url.pathname)) return send(res, 405, { error: 'Method not allowed' });
      if (req.headers.origin !== `http://${req.headers.host}` || req.headers['x-search-token'] !== token || !req.headers['content-type']?.startsWith('application/json')) return send(res, 403, { error: 'Same-origin request required' });
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 12000) return send(res, 413, { error: 'Request too large' });
      }
      const input = JSON.parse(body);
      const id = url.pathname === '/api/search' ? await engine.start(input.query) : await engine.summarize(input.searchId);
      send(res, 202, { id });
    } catch (error) { send(res, 400, { error: error.message }); }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', accept); });
  return server;
}

async function main() {
  process.umask(0o077);
  const port = Number(process.env.PORT || 4317);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be 1024–65535');
  const data = resolve(project, process.env.DATA_DIR || 'data');
  await mkdir(data, { recursive: true, mode: 0o700 });
  await chmod(data, 0o700);
  const release = await lockfile.lock(data, { stale: 30000, retries: 0 });
  let engine;
  try {
    const agentDir = process.env.PI_SEARCH_AGENT_DIR || join(homedir(), '.pi', 'agent');
    let settings = {};
    try { settings = JSON.parse(await readFile(join(agentDir, 'settings.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const models = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false });
    const model = {
      provider: process.env.SEARCH_PROVIDER || settings.defaultProvider || 'radius',
      modelId: process.env.SEARCH_MODEL || settings.defaultModel || 'balanced',
    };
    engine = await openEngine({ database: join(data, 'search.sqlite'), models, model,
      search: createRadiusSearch(models, process.env.PI_RADIUS_GATEWAY || 'https://radius.pi.dev') });
    const server = await createServer({ engine, port });
    console.log(`Pi Search: http://127.0.0.1:${port} · results only; optional summary model ${model.provider}/${model.modelId}`);
    console.log(`Browser search URL: http://127.0.0.1:${port}/search?q=%s`);
    let closing = false;
    const close = async () => {
      if (closing) return;
      closing = true;
      server.close(); server.closeAllConnections();
      await engine.close(); await release();
    };
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { close().then(() => process.exit(0)).catch(() => process.exit(1)); });
    engine.harness.closed.then((end) => { if (end.reason === 'failed') { console.error('Durable storage failed; restart the service.'); server.close(); process.exitCode = 1; } });
  } catch (error) { if (engine) await engine.close(); await release(); throw error; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
