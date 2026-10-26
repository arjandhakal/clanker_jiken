const $ = id => document.getElementById(id);
const fragment = new URLSearchParams(location.hash.slice(1));
function stored(key, value) { try { if (value !== undefined) sessionStorage.setItem(key, value); return sessionStorage.getItem(key); } catch { return null; } }
const token = fragment.get('token') || stored('context-lens-token');
const currentOnly = fragment.has('token') ? fragment.get('current') === '1' : stored('context-lens-mode') === 'current';
if (token) stored('context-lens-token', token);
stored('context-lens-mode', currentOnly ? 'current' : 'all');
history.replaceState(null, '', '/');
let state, page = { sessions: [], total: 0, offset: 0 }, selected = new Map(), leaves = {}, view = 'overview', preview, polling = false, preparing = false, searchSequence = 0;
const scopeHelp = { context: 'Summaries and retained messages, with context edits applied—not an exact historical request.', branch: 'Original messages on the selected branch, including summarized or omitted material.', history: 'Every entry once, including abandoned alternatives—not one conversation or context window.' };
const number = n => Number(n || 0).toLocaleString();
const bytes = n => n < 1024 ? `${number(n)} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KiB` : `${(n / 1048576).toFixed(1)} MiB`;
function node(tag, text, className) { const element = document.createElement(tag); if (text !== undefined && text !== null) element.textContent = text; if (className) element.className = className; return element; }
function button(text, handler, className) { const result = node('button', text, className); result.type = 'button'; result.addEventListener('click', act(handler)); return result; }
function act(fn) { return event => { event?.preventDefault(); Promise.resolve().then(fn).catch(showError); }; }
function showError(error) { $('error').textContent = error?.message || String(error); $('error').hidden = false; }
function clearError() { $('error').hidden = true; $('error').textContent = ''; }
async function api(path, body) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token || ''}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `Local request failed (${response.status}).`);
  return value;
}
function busy() { return preparing || polling || state?.job?.status === 'running'; }
function aligned() { const report = state?.report; return report && report.sessions.length === selected.size && report.sessions.every(s => selected.has(s.key) && s.scope === $('scope').value && (!leaves[s.key] || leaves[s.key] === s.leafId)); }
function controls() {
  $('selected-count').textContent = `${selected.size} / 6`;
  $('inspect').disabled = !selected.size || busy(); $('inspect').textContent = selected.size ? `Inspect ${selected.size} selected` : 'Inspect selected';
  $('refresh').disabled = busy(); $('clear').disabled = !state?.report && !busy();
  $('scope-help').textContent = scopeHelp[$('scope').value];
  $('selection-help').textContent = selected.size ? 'Inspection stays local. Source sessions are read-only.' : 'Select a session to begin. Up to six for comparison.';
  $('pending').hidden = !state?.report || aligned();
  $('prepare').disabled = busy() || !aligned() || !state?.model?.available;
  $('analysis-help').textContent = !aligned() ? 'Inspect your current selection first.' : !state?.model?.available ? 'Choose a suitable model in Pi first.' : 'Nothing sent at this step.';
  $('cancel-job').hidden = state?.job?.status !== 'running';
  const tray = $('selected-list'); tray.replaceChildren();
  for (const session of selected.values()) {
    const item = node('li', null, 'selected-item'); item.append(node('span', session.name || session.id));
    const remove = button('×', () => { selected.delete(session.key); discardPreview(); renderSessions(); controls(); }, 'quiet'); remove.setAttribute('aria-label', `Remove ${session.name || session.id}`); item.append(remove); tray.append(item);
  }
}
function discardPreview() { preview = undefined; $('preview-dialog').close(); $('preview-content').replaceChildren(); $('authorized').checked = false; $('approve').disabled = true; }
function renderSessions() {
  const list = $('session-list'); list.replaceChildren();
  for (const session of page.sessions) {
    const label = node('label', null, 'session-option'), checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(session.key);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked && selected.size >= 6) { checkbox.checked = false; showError(new Error('Select at most six sessions. Remove one to add another.')); return; }
      if (checkbox.checked) selected.set(session.key, session); else selected.delete(session.key);
      clearError(); discardPreview(); controls();
    });
    const text = node('span'); text.append(node('span', `${session.name || session.id}${session.current ? ' · Current' : ''}`, 'session-name'), node('span', session.cwd || 'Project unavailable', 'session-meta'), node('span', `${session.modified || session.created ? String(session.modified || session.created).slice(0, 10) : 'Date unavailable'} · ${session.model || 'Model unavailable'}`, 'session-meta'));
    label.append(checkbox, text); list.append(label);
  }
  if (!page.sessions.length) list.append(node('p', 'No sessions match. Try another name or project.', 'subtle'));
  $('session-count').textContent = `${number(page.total)} matching session${page.total === 1 ? '' : 's'}`;
  $('page-label').textContent = page.total ? `${page.offset + 1}–${Math.min(page.offset + 100, page.total)}` : '0';
  $('previous').disabled = page.offset === 0; $('next').disabled = page.offset + 100 >= page.total;
  $('discovery-notice').hidden = !page.warningCount; $('discovery-warnings').replaceChildren(...(page.warnings || []).map(w => node('li', w)));
}
async function loadSessions(offset = 0) {
  const sequence = ++searchSequence;
  const result = await api(`/api/sessions?q=${encodeURIComponent($('search').value)}&offset=${offset}`);
  if (sequence !== searchSequence) return;
  page = result; renderSessions();
}
function renderState(next, force = false) {
  if (!state && next.report && !currentOnly) {
    selected = new Map(next.report.sessions.map(s => [s.key, { key:s.key, id:s.sessionId, name:s.name, cwd:s.cwd }]));
    $('scope').value = next.report.sessions[0].scope;
    leaves = Object.fromEntries(next.report.sessions.map(s => [s.key, s.leafId]));
  }
  const changed = next.report?.id !== state?.report?.id;
  const analysisChanged = JSON.stringify(next.interpretation) !== JSON.stringify(state?.interpretation);
  state = next;
  $('model').textContent = next.model?.available ? `${next.model.provider} / ${next.model.id}` : 'No suitable Pi model selected';
  const job = next.job;
  $('status').textContent = job?.status === 'running' ? job.progress : job?.status === 'error' ? `Stopped: ${job.error}` : job?.status === 'cancelled' ? job.progress : 'Local inspection · ready';
  if (job?.status === 'error') showError(new Error(job.error));
  $('empty').hidden = !!next.report; $('report').hidden = !next.report;
  if (next.report) {
    $('report-title').textContent = `${next.report.sessions.length} session${next.report.sessions.length === 1 ? '' : 's'} · ${next.report.sessions[0].scopeLabel}`;
    $('report-description').textContent = next.report.sessions.map(s => s.name).join(' vs ');
    if (changed || force) renderReport();
    if (analysisChanged || changed) renderInterpretation();
  }
  controls();
}
async function readState() { renderState(await api('/api/state')); }
async function runJob(route, body = {}) {
  if (polling) throw new Error('Wait for the current operation to finish or cancel.');
  clearError(); polling = true; controls();
  try {
    const started = await api(route, body);
    do {
      await readState();
      if (state.job?.id !== started.jobId || state.job.status !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 350));
    } while (true);
    if (state.job?.status === 'error') throw new Error(state.job.error);
  } finally { polling = false; controls(); }
}
function panel(title, description) { const box = node('section', null, 'panel'); box.append(node('h3', title)); if (description) box.append(node('p', description, 'fine')); return box; }
function sessionHeading(session) { return `${session.name} · ${session.cwd || 'Project unavailable'}`; }
function svg(tag, attributes = {}) { const element = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value)); return element; }
function overview(container) {
  const cards = node('div', null, 'cards');
  for (const session of state.report.sessions) {
    const card = node('section', null, 'card'); card.append(node('h3', session.name), node('p', session.cwd || 'Project unavailable', 'fine'), node('div', `~${number(session.totals.estimatedTokens)}`, 'metric'), node('small', `recorded text units · ${bytes(session.totals.bytes)}`)); cards.append(card);
  }
  container.append(cards);
  for (const session of state.report.sessions) {
    const box = panel(sessionHeading(session), `${session.scopeLabel} · snapshot ${session.capturedAt}`);
    const categories = state.categories.filter(c => session.totals.categories[c] > 0).sort((a, b) => session.totals.categories[b] - session.totals.categories[a]);
    if (!categories.length) box.append(node('p', 'No recorded text in this scope.', 'subtle'));
    for (const category of categories) {
      const value = session.totals.categories[category], percent = 100 * value / Math.max(1, session.totals.estimatedTokens);
      const row = node('div', null, 'bar-row'), chart = svg('svg', { viewBox: '0 0 100 12', preserveAspectRatio: 'none', class: 'bar', 'aria-hidden': 'true' });
      chart.append(svg('rect', { width: percent, height: 12, class: `category-${state.categories.indexOf(category)}` }));
      row.append(node('span', state.categoryLabels[category]), chart, node('span', `~${number(value)} · ${percent < 1 ? '<1' : Math.round(percent)}%`, 'bar-number')); box.append(row);
    }
    if (session.totals.attachments) box.append(node('p', `${session.totals.attachments} images: token contribution unavailable.`, 'fine'));
    if (session.warnings.length) box.append(node('p', `${session.warnings.length} accounting/source warning(s). See Details.`, 'fine'));
    container.append(box);
  }
}
function comparison(container) {
  const box = panel('Side-by-side composition', 'Estimated recorded text units (chars/4). These are not provider token totals.'), wrap = node('div', null, 'table-wrap'), table = node('table'), head = node('thead'), header = node('tr');
  header.append(node('th', 'Category')); for (const session of state.report.sessions) header.append(node('th', session.name)); head.append(header); table.append(head);
  const body = node('tbody');
  for (const category of [...state.categories, 'TOTAL']) {
    const row = node('tr'); row.append(node('th', category === 'TOTAL' ? 'Total' : state.categoryLabels[category]));
    for (const session of state.report.sessions) row.append(node('td', number(category === 'TOTAL' ? session.totals.estimatedTokens : session.totals.categories[category])));
    body.append(row);
  }
  table.append(body); wrap.append(table); box.append(wrap); container.append(box);
}
function growth(container) {
  const box = panel('Recorded growth by user turn', 'Cumulative selected text—not historical context-window occupancy. Charts display up to 300 checkpoints per session.');
  const sessions = state.report.sessions, points = sessions.flatMap(s => s.growth), maxTurn = Math.max(1, ...points.map(p => p.turn)), maxSize = Math.max(1, ...points.map(p => p.cumulative));
  const chart = svg('svg', { viewBox: '0 0 800 280', class: 'growth-chart', role: 'img', 'aria-label': 'Cumulative recorded text units by user turn' });
  chart.append(svg('line', { x1:65, y1:20, x2:65, y2:235, class:'axis' }), svg('line', { x1:65, y1:235, x2:780, y2:235, class:'axis' }));
  for (let i = 0; i <= 4; i++) {
    const y = 235 - i * 53.75, text = svg('text', { x:58, y:y + 4, 'text-anchor':'end', class:'chart-label' }); text.textContent = number(Math.round(maxSize * i / 4)); chart.append(text);
    const x = 65 + i * 178.75, turn = svg('text', { x, y:258, 'text-anchor':'middle', class:'chart-label' }); turn.textContent = `Turn ${Math.round(maxTurn * i / 4)}`; chart.append(turn);
  }
  sessions.forEach((session, i) => { const line = svg('polyline', { points: session.growth.map(p => `${65 + p.turn / maxTurn * 715},${235 - p.cumulative / maxSize * 215}`).join(' '), class:`series series-${i}` }); chart.append(line); });
  box.append(chart); const legend = node('div', null, 'legend');
  sessions.forEach((s, i) => { const item = node('span', null, 'legend-item'); item.append(node('i', null, `dot series-${i}`), node('span', s.name)); legend.append(item); }); box.append(legend);
  for (const session of sessions) {
    const details = node('details'); details.append(node('summary', `${session.name}: ${session.growthPoints} turn checkpoints${session.growthPoints > 300 ? ' (display sampled)' : ''}`));
    for (const point of session.growth) details.append(node('p', `User turn ${point.turn}: +${number(point.delta)} · cumulative ~${number(point.cumulative)}`, 'fine'));
    for (const marker of session.markers) details.append(node('p', `Compaction at user turn ${marker.turn}; recorded tokensBefore=${marker.tokensBefore ?? 'unavailable'}`, 'fine'));
    box.append(details);
  }
  container.append(box);
}
function evidence(container) {
  for (const session of state.report.sessions) {
    const box = panel(sessionHeading(session), 'Largest contributors · up to 30 per session. Open one to inspect text locally.'), list = node('div', null, 'evidence-list');
    for (const part of session.contributors) {
      const item = button('', () => openEvidence(part.id), 'evidence-button'); item.append(node('span', `${state.categoryLabels[part.category]} · ~${number(part.estimatedTokens)} units · user turn ${part.turn}`), node('span', part.id, 'fine')); list.append(item);
    }
    if (!session.contributors.length) list.append(node('p', 'No recorded content parts.', 'subtle')); box.append(list); container.append(box);
  }
}
function details(container) {
  const limits = panel('How to read this report'); for (const text of state.accounting) limits.append(node('p', text, 'fine')); for (const text of state.report.warnings) limits.append(node('p', text, 'notice')); container.append(limits);
  for (const session of state.report.sessions) {
    const box = panel(sessionHeading(session)), metadata = node('dl', null, 'metadata');
    for (const [label, value] of [['Scope',session.scopeLabel],['Snapshot',session.capturedAt],['Source',session.sourcePath || '(current memory)'],['Selected entry',session.leafId || 'Start'],['Text',`${number(session.totals.chars)} chars · ${bytes(session.totals.bytes)}`],['Attachments',`${session.totals.attachments} images; ~${number(session.totals.attachmentBytes)} decoded bytes, no token estimate`]]) metadata.append(node('dt', label), node('dd', value)); box.append(metadata);
    if (session.scope !== 'history' && session.branches.length > 1) {
      const label = node('label', 'Branch ending at'), select = node('select'); label.append(select);
      for (const id of session.branches) { const option = node('option', `${id}${id === session.leafId ? ' · selected' : ''}`); option.value = id; select.append(option); }
      select.value = leaves[session.key] || session.leafId; select.addEventListener('change', () => { leaves[session.key] = select.value; discardPreview(); controls(); }); box.append(label, node('p', 'Choose Inspect selected to apply a different branch. Past-session defaults are inferred.', 'fine'));
    }
    for (const warning of session.warnings) box.append(node('p', warning, 'notice'));
    const usage = node('details'); usage.append(node('summary', 'Provider-reported usage — separate branch/history accounting'), node('pre', session.usage.length ? JSON.stringify(session.usage, null, 2) : 'No reported usage available.')); box.append(usage);
    const types = node('details'); types.append(node('summary', 'Recorded role/type breakdown'), node('pre', JSON.stringify({ roles:session.totals.roles, types:session.totals.kinds }, null, 2))); box.append(types); container.append(box);
  }
}
function renderReport() {
  const content = $('report-content'); content.replaceChildren();
  for (const tab of document.querySelectorAll('[data-view]')) { if (tab.dataset.view === view) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current'); }
  $('analysis-panel').hidden = view !== 'analysis'; content.hidden = view === 'analysis';
  if (!state?.report) return;
  ({ overview, compare:comparison, growth, evidence, details }[view])?.(content);
}
async function openEvidence(id) {
  const part = await api(`/api/evidence?reportId=${encodeURIComponent(state.report.id)}&id=${encodeURIComponent(id)}`);
  $('evidence-meta').textContent = `${part.id} · user turn ${part.turn} · ${part.timestamp || 'date unavailable'} · ${part.role}/${part.kind} · ${number(part.chars)} chars${part.truncated ? ' · preview truncated at 16,000 chars' : ''}`;
  $('evidence-text').textContent = part.text || '(No text; attachment accounting only.)'; $('evidence-dialog').showModal();
}
function renderPreview(plan) {
  preview = plan; $('authorized').checked = false; $('approve').disabled = true;
  const content = $('preview-content'); content.replaceChildren(node('h3', `${plan.provider} / ${plan.model}`), node('p', plan.sessions.join(' · '), 'fine'), node('p', `Question: ${plan.question}`), node('p', `${plan.snippets.length} snippets · ${bytes(plan.bytes)} input · ${plan.omittedParts} parts omitted · ${plan.truncatedParts} truncated · max ${plan.maxTokens} output tokens · one request`, 'notice'));
  for (const [i, snippet] of plan.snippets.entries()) { const box = panel(`${i + 1}. ${state.categoryLabels[snippet.category]} · user turn ${snippet.turn}`, snippet.id); box.append(node('pre', snippet.text)); content.append(box); }
  const exact = node('details'); exact.append(node('summary', 'Exact extension-supplied prompt'), node('pre', plan.systemPrompt), node('pre', plan.userText)); content.append(exact); $('preview-dialog').showModal();
}
function renderInterpretation() {
  const target = $('interpretation'), result = state?.interpretation; target.replaceChildren(); if (!result) return;
  const box = panel('Pi interpretation — sample only', `${result.provider} / ${result.model} · ${result.sampledParts} snippets · ${result.omittedParts} omitted · ${result.truncatedParts} truncated`);
  box.append(node('p', `Question: ${result.question}`, 'fine'), node('p', result.answer)); for (const warning of result.warnings) box.append(node('p', warning, 'notice'));
  for (const [label, count] of Object.entries(result.aggregate)) box.append(node('p', `${label}: ${count.snippets} snippets · ~${number(count.estimatedUnits)} sampled text units`, 'fine'));
  const records = node('details'); records.append(node('summary', 'Classifications and evidence'));
  for (const classification of result.classifications) { const record = panel(classification.label, classification.reason); record.append(button(classification.id, () => openEvidence(classification.id), 'quiet'), node('p', classification.quote, 'quote')); records.append(record); }
  box.append(records); const usage = node('details'); usage.append(node('summary', 'This analysis request’s reported usage'), node('pre', JSON.stringify(result.usage || 'Unavailable', null, 2))); box.append(usage); target.append(box);
}
async function refresh() { await runJob('/api/discover'); await loadSessions(); $('refresh').textContent = 'Refresh'; }
$('refresh').addEventListener('click', act(refresh));
let searchTimer; $('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadSessions().catch(showError), 180); });
$('previous').addEventListener('click', act(() => loadSessions(Math.max(0, page.offset - 100)))); $('next').addEventListener('click', act(() => loadSessions(page.offset + 100)));
$('scope').addEventListener('change', () => { discardPreview(); controls(); });
$('inspect').addEventListener('click', act(async () => { discardPreview(); await runJob('/api/report', { keys:[...selected.keys()], scope:$('scope').value, leaves }); }));
$('cancel-job').addEventListener('click', act(async () => { await api('/api/cancel', {}); await readState(); }));
$('clear').addEventListener('click', act(async () => { await api('/api/clear', {}); selected.clear(); leaves = {}; discardPreview(); $('evidence-dialog').close(); $('evidence-text').textContent = ''; $('evidence-meta').textContent = ''; $('report-content').replaceChildren(); $('interpretation').replaceChildren(); clearError(); await readState(); renderSessions(); }));
for (const tab of document.querySelectorAll('[data-view]')) tab.addEventListener('click', () => { view = tab.dataset.view; renderReport(); });
$('close-evidence').addEventListener('click', () => $('evidence-dialog').close()); $('close-preview').addEventListener('click', discardPreview); $('preview-dialog').addEventListener('cancel', () => { preview = undefined; $('preview-content').replaceChildren(); $('authorized').checked = false; $('approve').disabled = true; });
$('authorized').addEventListener('change', () => { $('approve').disabled = !$('authorized').checked || !preview; });
$('analysis-form').addEventListener('submit', act(async () => {
  if (!aligned() || busy()) return;
  preparing = true; controls(); clearError();
  try { renderPreview(await api('/api/prepare', { reportId:state.report.id, question:$('question').value, dimension:$('dimension').value })); }
  finally { preparing = false; controls(); }
}));
$('approve').addEventListener('click', act(async () => {
  if (!preview || !$('authorized').checked) return;
  const planId = preview.planId; discardPreview(); await runJob('/api/analyze', { planId, approved:true });
}));
(async () => {
  if (!token) throw new Error('Open /context-lens in Pi to authorize this tab. No session content has been loaded.');
  await readState();
  if (currentOnly) {
    await loadSessions(); const current = page.sessions.find(s => s.current); selected.clear(); selected.set(current.key, current); leaves = {}; renderSessions(); controls(); $('refresh').textContent = 'Browse all'; await runJob('/api/report', { keys:['current'], scope:'context' });
  } else { await refresh(); }
})().catch(showError);
