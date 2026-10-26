import http from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setImmediate as yieldNow } from 'node:timers/promises';
import { discover, snapshot, filterSessions, LIMITS, checkAbort } from './discovery.mjs';
import { parseSnapshot, normalize, tipsOf, largest, title, safe, CATEGORIES, CATEGORY_LABELS, SCOPE_LABELS, ACCOUNTING } from './core.mjs';
import { prepareAnalysis, runAnalysis, DIMENSIONS } from './analysis.mjs';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const messageOf = error => safe(error?.message || 'Operation failed').slice(0, 2000);
const modelKey = model => JSON.stringify([model?.provider, model?.id, model?.api, model?.baseUrl]);
const modelInfo = model => model ? { provider: model.provider, id: model.id, available: model.contextWindow > 0 } : null;
const pick = (items, limit) => items.length <= limit ? items : Array.from({ length: limit }, (_, i) => items[Math.floor(i * (items.length - 1) / (limit - 1))]);
const partInfo = ({ text, ...part }) => part;
const HEADERS = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY', 'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
};

export async function startDashboard({ roots, currentInfo, captureCurrent, project, getModel, invoke, now = Date.now, planTtlMs = 300000 }) {
  const token = randomBytes(32).toString('base64url');
  const tokenBytes = Buffer.from(token);
  const assets = new Map(await Promise.all([
    ['/', 'index.html', 'text/html'], ['/app.js', 'app.js', 'text/javascript'], ['/style.css', 'style.css', 'text/css']
  ].map(async ([route, file, type]) => [route, { body: await readFile(new URL(`../public/${file}`, import.meta.url)), type }])));
  let catalog = new Map(), discoveryWarnings = [], reports = [], reportId, reportView = null, plan, interpretation = null, job = null, closed = false;
  let origin;
  const refreshCurrent = () => {
    const info = currentInfo();
    catalog.set('current', { ...info, key: 'current', current: true });
    return info;
  };
  refreshCurrent(); // Metadata only: no current transcript capture at startup.
  const publicJob = () => job ? { id: job.id, kind: job.kind, status: job.status, progress: job.progress, error: job.error } : null;
  const isBusy = () => job?.status === 'running';
  const requireIdle = () => { if (isBusy()) fail(409, 'Another operation is running. Cancel it or wait.'); };
  const requireReport = id => { if (!reportId || id !== reportId) fail(409, 'Report changed. Inspect sessions again before using this action.'); };
  function cancel() {
    if (isBusy()) { job.status = 'cancelled'; job.progress = 'Cancelled; completed report retained.'; job.controller.abort(new Error('Cancelled')); }
  }
  function clear() { cancel(); job = null; reports = []; reportId = undefined; reportView = null; plan = undefined; interpretation = null; }
  function start(kind, work) {
    requireIdle();
    const active = { id: randomUUID(), kind, status: 'running', progress: 'Starting…', controller: new AbortController() };
    job = active;
    Promise.resolve().then(() => work(active.controller.signal, text => {
      if (job === active && !active.controller.signal.aborted) active.progress = safe(text);
    })).then(() => {
      if (job === active && !active.controller.signal.aborted) { active.status = 'done'; active.progress = 'Done'; }
    }, error => {
      if (job === active && !active.controller.signal.aborted) { active.status = 'error'; active.error = messageOf(error); active.progress = 'Stopped; completed report retained.'; }
    });
    return { jobId: active.id };
  }
  const summary = (report, key) => ({
    key, sessionId: report.snapshot.header.id, name: title(report), cwd: report.snapshot.header.cwd,
    scope: report.scope, scopeLabel: SCOPE_LABELS[report.scope], leafId: report.snapshot.leafId,
    capturedAt: report.snapshot.capturedAt, sourcePath: report.snapshot.sourcePath,
    totals: report.totals, usage: report.usage, warnings: report.warnings,
    growth: pick(report.growth, 300), growthPoints: report.growth.length,
    markers: report.markers.slice(0, 200), contributors: largest(report).slice(0, 30).map(partInfo),
    branches: [...new Set([report.snapshot.leafId, ...tipsOf(report.snapshot.entries).map(e => e.id)])].filter(Boolean).slice(0, 200),
    branchCount: tipsOf(report.snapshot.entries).length
  });
  async function jsonBody(req) {
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) fail(415, 'Use application/json.');
    if (Number(req.headers['content-length'] || 0) > 16384) fail(413, 'Request too large.');
    const chunks = []; let length = 0;
    for await (const chunk of req) { length += chunk.length; if (length > 16384) fail(413, 'Request too large.'); chunks.push(chunk); }
    try { const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Expected a JSON object.'); return body; }
    catch (error) { if (error.status) throw error; fail(400, 'Invalid JSON.'); }
  }
  const state = () => ({ model: modelInfo(getModel()), job: publicJob(), report: reportView, interpretation, categories: CATEGORIES, categoryLabels: CATEGORY_LABELS, scopeLabels: SCOPE_LABELS, dimensions: DIMENSIONS, accounting: ACCOUNTING });
  async function api(req, url) {
    const route = url.pathname;
    if (req.method === 'GET' && route === '/api/state') return state();
    if (req.method === 'GET' && route === '/api/sessions') {
      refreshCurrent();
      const query = url.searchParams.get('q') || '', offset = Number(url.searchParams.get('offset') || 0);
      if (query.length > 512 || !Number.isSafeInteger(offset) || offset < 0) fail(400, 'Invalid search/page.');
      const matches = filterSessions([...catalog.values()], query);
      return { sessions: matches.slice(offset, offset + 100), total: matches.length, offset, warnings: discoveryWarnings.slice(0, 100), warningCount: discoveryWarnings.length };
    }
    if (req.method === 'GET' && route === '/api/evidence') {
      requireReport(url.searchParams.get('reportId'));
      const id = url.searchParams.get('id');
      const part = reports.flatMap(r => r.parts).find(p => p.id === id);
      if (!part) fail(404, 'Evidence is not in this report.');
      return { ...partInfo(part), text: part.text.slice(0, 16000), truncated: part.text.length > 16000 };
    }
    if (req.method !== 'POST') fail(404, 'Unknown route.');
    const body = await jsonBody(req);
    if (route === '/api/cancel') { cancel(); return { cancelled: true }; }
    if (route === '/api/clear') { clear(); return { cleared: true }; }
    requireIdle();
    if (route === '/api/discover') return start('discovery', async (signal, update) => {
      const found = await discover(roots, { signal, onProgress: update });
      checkAbort(signal);
      const current = refreshCurrent(), existing = new Map([...catalog.values()].filter(s => s.path).map(s => [s.path, s.key]));
      const next = new Map([['current', catalog.get('current')]]);
      for (const info of found.sessions) {
        if (info.path === current.path) continue;
        const key = existing.get(info.path) || randomUUID();
        next.set(key, { ...info, key });
      }
      catalog = next; discoveryWarnings = found.warnings;
    });
    if (route === '/api/report') {
      if (!Array.isArray(body.keys) || !body.keys.length || body.keys.length > LIMITS.selections || new Set(body.keys).size !== body.keys.length || body.keys.some(key => typeof key !== 'string' || !catalog.has(key))) fail(400, 'Select 1–6 known sessions.');
      if (!Object.hasOwn(SCOPE_LABELS, body.scope)) fail(400, 'Unknown scope.');
      const selected = body.keys.map(key => catalog.get(key));
      const leaves = body.leaves && typeof body.leaves === 'object' && !Array.isArray(body.leaves) ? body.leaves : {};
      return start('inspection', async (signal, update) => {
        const next = [], keys = [], warnings = []; let bytes = 0;
        for (const info of selected) {
          checkAbort(signal); update(`Inspecting ${next.length + 1}/${selected.length}: ${info.name || info.id}`);
          try {
          const snap = info.current ? captureCurrent() : parseSnapshot(await snapshot(info.path, { signal, maxBytes: LIMITS.totalBytes - bytes }));
          bytes += snap.bytes;
          if (bytes > LIMITS.totalBytes) throw new Error('Combined snapshots exceed 64 MiB. Select fewer sessions.');
          if (next.some(r => r.snapshot.header.id === snap.header.id)) throw new Error('Duplicate session ID. Select only one copy.');
          snap.name = info.name || snap.name;
          if (Object.hasOwn(leaves, info.key) && leaves[info.key] !== snap.leafId) {
            const allowed = tipsOf(snap.entries).slice(0, 200).map(e => e.id);
            if (!allowed.includes(leaves[info.key])) throw new Error('Unknown branch tip. Inspect the session again.');
            snap.leafId = leaves[info.key];
          }
          next.push(normalize(snap, body.scope, project, signal)); keys.push(info.key);
          } catch (error) { checkAbort(signal); warnings.push(`${info.id}: ${messageOf(error)}`); }
          await yieldNow();
        }
        checkAbort(signal);
        if (!next.length) throw new Error(`No readable sessions. ${warnings.join('; ')}`);
        const nextId = randomUUID();
        const sessions = next.map((r, i) => summary(r, keys[i]));
        if (sessions.some(s => s.growthPoints > 300)) warnings.push('Growth chart shows up to 300 evenly spaced checkpoints per session; totals use all selected contributions.');
        if (sessions.some(s => s.branchCount > 200)) warnings.push('Branch selector limited to 200 choices.');
        reports = next; reportId = nextId; reportView = { id: nextId, sessions, warnings }; plan = undefined; interpretation = null;
      });
    }
    if (route === '/api/prepare') {
      requireReport(body.reportId);
      if (!Object.hasOwn(DIMENSIONS, body.dimension)) fail(400, 'Unknown analysis dimension.');
      const model = getModel();
      const prepared = prepareAnalysis(reports, body.question, body.dimension, model);
      plan = { id: randomUUID(), reportId, modelKey: modelKey(model), createdAt: now(), prepared };
      return { planId: plan.id, provider: model.provider, model: model.id, sessions: prepared.sessions, snippets: prepared.snippets, question: prepared.question, dimension: prepared.dimension, bytes: prepared.bytes, omittedParts: prepared.omittedParts, truncatedParts: prepared.truncatedParts, maxTokens: prepared.maxTokens, systemPrompt: prepared.systemPrompt, userText: prepared.userText };
    }
    if (route === '/api/analyze') {
      if (body.approved !== true) fail(400, 'Explicit transmission approval is required.');
      if (!plan || body.planId !== plan.id || plan.reportId !== reportId || now() - plan.createdAt > planTtlMs) fail(409, 'Preview expired or already used. Prepare a fresh sample.');
      if (plan.modelKey !== modelKey(getModel())) { plan = undefined; fail(409, 'Pi model route changed. Review a fresh sample before approval.'); }
      const prepared = plan.prepared; plan = undefined;
      return start('analysis', async (signal, update) => {
        update(`Analyzing ${prepared.snippets.length} approved snippets with ${prepared.model.provider}/${prepared.model.id}…`);
        const result = await runAnalysis(prepared, { approved: true, signal, invoke });
        checkAbort(signal);
        interpretation = { ...result, question: prepared.question, dimension: prepared.dimension, completedAt: new Date().toISOString(), sampledParts: prepared.snippets.length, omittedParts: prepared.omittedParts, truncatedParts: prepared.truncatedParts, sessions: prepared.sessions };
      });
    }
    fail(404, 'Unknown route.');
  }
  const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 30000, headersTimeout: 10000 }, async (req, res) => {
    const respond = (status, body, type = 'application/json') => {
      if (!res.destroyed) { res.writeHead(status, { ...HEADERS, 'Content-Type': `${type}; charset=utf-8` }); res.end(type === 'application/json' ? JSON.stringify(body) : body); }
    };
    try {
      if (closed || req.headers.host !== new URL(origin).host) fail(403, 'Invalid local host.');
      const url = new URL(req.url, origin);
      if (url.href.length > 4096) fail(414, 'URL too long.');
      if (req.method === 'GET' && url.pathname === '/favicon.ico') { respond(204, '', 'image/x-icon'); return; }
      if (req.method === 'GET' && assets.has(url.pathname)) { const asset = assets.get(url.pathname); respond(200, asset.body, asset.type); return; }
      if (req.headers.origin && req.headers.origin !== origin) fail(403, 'Cross-origin requests are forbidden.');
      const authorization = req.headers.authorization || '';
      if (!authorization.startsWith('Bearer ')) fail(401, 'Open Context Lens from Pi to authorize this tab.');
      const supplied = Buffer.from(authorization.slice(7));
      if (supplied.length !== tokenBytes.length || !timingSafeEqual(supplied, tokenBytes)) fail(401, 'Open Context Lens from Pi to authorize this tab.');
      if (req.method === 'POST' && req.headers.origin !== origin) fail(403, 'A same-origin browser request is required.');
      const result = await api(req, url);
      respond(200, result);
    } catch (error) { respond(error.status || 400, { error: messageOf(error) }); }
  });
  server.maxConnections = 32;
  server.keepAliveTimeout = 5000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  server.unref();
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    url: `${origin}/#token=${token}`, origin, clear,
    async close() {
      if (closed) return;
      closed = true; clear(); catalog.clear(); discoveryWarnings = [];
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    }
  };
}
