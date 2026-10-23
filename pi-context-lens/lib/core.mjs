import { LIMITS, checkAbort } from './discovery.mjs';

export const CATEGORIES = ['system', 'user', 'assistant', 'reasoning', 'tool-call', 'tool-result:file', 'tool-result:shell', 'tool-result:search', 'tool-result:other', 'summary', 'extension', 'other'];
export const COLORS = ['muted', 'accent', 'success', 'dim', 'warning', 'accent', 'warning', 'success', 'muted', 'warning', 'dim', 'muted'];
export const SCOPE_LABELS = { context: 'Retained context', branch: 'Selected branch', history: 'All branches' };
export const CATEGORY_LABELS = { system: 'System instructions', user: 'Your messages', assistant: 'Assistant replies', reasoning: 'Recorded reasoning', 'tool-call': 'Tool calls', 'tool-result:file': 'File results', 'tool-result:shell': 'Shell results', 'tool-result:search': 'Search results', 'tool-result:other': 'Other tool results', summary: 'Summaries', extension: 'Extension messages', other: 'Other' };
export const safe = value => String(value ?? '').replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, ' ');
export const estimate = text => Math.ceil(text.length / 4);
const json = value => JSON.stringify(value ?? {});
const warn = (warnings, text) => { if (warnings.length < 100) warnings.push(text); };

export function validateEntries(raw, warnings = []) {
  const entries = [], seen = new Set();
  if (raw.length > LIMITS.entries) throw new Error('Session exceeds 50,000 entry limit');
  const supported = new Set(['message', 'custom_message', 'compaction', 'branch_summary', 'context_edit', 'usage', 'model_change', 'thinking_level_change', 'custom', 'session_info', 'label']);
  for (const e of raw) {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !(e.parentId === null || typeof e.parentId === 'string')) { warn(warnings, 'Skipped entry with invalid tree identity.'); continue; }
    if (seen.has(e.id)) { warn(warnings, `Duplicate entry ID ${e.id}; first retained.`); continue; }
    // Keep unknown structural entries so descendant ancestry remains intact.
    if (!supported.has(e.type)) warn(warnings, `Unsupported entry ${e.id} (${e.type}); no content counted.`);
    let valid = true;
    if (e.type === 'message') valid = e.message && typeof e.message.role === 'string' && (typeof e.message.content === 'string' || Array.isArray(e.message.content) || e.message.role === 'bashExecution');
    if (e.type === 'compaction') valid = typeof e.summary === 'string' && typeof e.firstKeptEntryId === 'string';
    if (e.type === 'branch_summary') valid = typeof e.summary === 'string';
    if (e.type === 'context_edit') valid = typeof e.targetId === 'string' && (e.replacement === null || (e.replacement && (typeof e.replacement.content === 'string' || Array.isArray(e.replacement.content))));
    if (!valid) { warn(warnings, `Invalid ${e.type} ${e.id}; content ignored.`); entries.push({ ...e, type: 'invalid' }); }
    else entries.push(e);
    seen.add(e.id);
  }
  return entries;
}

export function parseSnapshot(input) {
  const warnings = [...(input.warnings || [])], lines = input.content.split('\n'), raw = [];
  let header;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    try {
      const value = JSON.parse(lines[i]);
      if (!header) { if (value.type !== 'session') throw new Error('Missing header'); header = value; }
      else raw.push(value);
    } catch {
      if (i === 0) throw new Error('Invalid session header');
      warn(warnings, `Ignored ${i === lines.length - 1 ? 'incomplete final' : 'corrupt'} JSONL line ${i + 1}.`);
    }
    if (raw.length > LIMITS.entries) throw new Error('Session exceeds 50,000 entry limit');
  }
  if (!header || typeof header.id !== 'string' || ![2, 3].includes(header.version)) throw new Error('Only tree session versions 2 and 3 are supported');
  const entries = validateEntries(raw, warnings);
  return { ...input, header, entries, leafId: entries.at(-1)?.id ?? null, warnings: [...warnings, 'Past/other-process leaf inferred from last valid entry; unrecorded navigation is unavailable.'] };
}

export function branchOf(entries, leafId, warnings = []) {
  const byId = new Map(entries.map(e => [e.id, e])), branch = [], seen = new Set();
  let id = leafId;
  while (id !== null && id !== undefined) {
    if (seen.has(id)) { warn(warnings, `Cycle at ${id}; projection disabled.`); throw new Error(`Tree cycle at ${id}`); }
    seen.add(id);
    const entry = byId.get(id);
    if (!entry) { warn(warnings, `Missing ancestor ${id}; projection disabled.`); throw new Error(`Missing ancestor ${id}`); }
    branch.push(entry); id = entry.parentId;
  }
  return branch.reverse();
}
export function tipsOf(entries) {
  const parents = new Set(entries.map(e => e.parentId));
  return entries.filter(e => !parents.has(e.id));
}

export function rawMessages(e) {
  if (e.type === 'message') return [e.message];
  if (e.type === 'custom_message') return [{ role: 'custom', content: e.content }];
  if (e.type === 'compaction') return [...(e.systemMessage ? [e.systemMessage] : []), { role: 'compactionSummary', content: e.summary }];
  if (e.type === 'branch_summary') return [{ role: 'branchSummary', content: e.summary }];
  return [];
}
function category(role, kind, tool = '') {
  if (kind === 'thinking') return 'reasoning';
  if (kind === 'toolCall') return 'tool-call';
  if (role === 'toolResult') {
    const group = /^(read|write|edit|ls|find)$/.test(tool) ? 'file' : /^(bash|powershell|shell)$/.test(tool) ? 'shell' : /search|grep|fetch|browse/.test(tool) ? 'search' : 'other';
    return `tool-result:${group}`;
  }
  if (/Summary$/.test(role)) return 'summary';
  if (role === 'custom') return 'extension';
  if (role === 'bashExecution') return 'tool-result:shell';
  return ['system', 'user', 'assistant'].includes(role) ? role : 'other';
}

export function normalize(snapshot, scope, project, signal) {
  const warnings = [...snapshot.warnings];
  const branch = scope === 'history' ? snapshot.entries : branchOf(snapshot.entries, snapshot.leafId, warnings);
  const branchIds = new Set(branch.map(e => e.id));
  for (const e of branch) {
    if (e.type === 'compaction' && !branchIds.has(e.firstKeptEntryId)) {
      warn(warnings, `Compaction ${e.id} has an unavailable retained boundary ${e.firstKeptEntryId}.`);
      if (scope === 'context') throw new Error(`Compaction ${e.id} retained boundary unavailable; inspect branch/history instead`);
    }
    if (e.type === 'context_edit' && !branchIds.has(e.targetId)) warn(warnings, `Context edit ${e.id} target is outside selected material; not applied.`);
  }
  // Pass only this validated path to the SDK. An abandoned malformed branch cannot hang projection.
  let projected;
  if (scope === 'context') {
    if (typeof project !== 'function') throw new Error('Pi buildSessionProjection API unavailable');
    projected = project(branch, snapshot.leafId).entries;
  } else projected = branch.map(sourceEntry => ({ sourceEntry, messages: rawMessages(sourceEntry) }));
  let turn = 0;
  const turns = new Map();
  for (const e of branch) { if (e.type === 'message' && e.message.role === 'user') turn++; turns.set(e.id, turn); }
  const parts = [];
  for (const { sourceEntry: entry, messages } of projected) {
    checkAbort(signal);
    messages.forEach((message, mi) => {
      const role = message.role;
      if (!['system', 'user', 'assistant', 'toolResult', 'bashExecution', 'custom', 'compactionSummary', 'branchSummary'].includes(role)) warn(warnings, `Unknown message role ${role} at ${entry.id}; counted as other.`);
      if (scope === 'context' && role === 'bashExecution' && message.excludeFromContext) return;
      let blocks = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : Array.isArray(message.content) ? message.content : [];
      if (message.summary) blocks = [...blocks, { type: 'text', text: message.summary }];
      if (role === 'system') {
        if (message.sections) blocks = [...blocks, { type: 'sections', text: json(message.sections) }];
        if (message.toolsAdded?.length) blocks = [...blocks, { type: 'tool-schema', text: json(message.toolsAdded) }];
        if (message.toolsRemoved?.length) blocks = [...blocks, { type: 'tool-schema', text: json(message.toolsRemoved) }];
      }
      if (role === 'bashExecution') blocks = [{ type: 'text', text: `${message.command || ''}\n${message.output || ''}` }];
      blocks.forEach((block, pi) => {
        if (!block || typeof block !== 'object') { warn(warnings, `Invalid content block ${entry.id}:${pi}.`); return; }
        let text = '', attachmentBytes = 0;
        if (block.type === 'text') text = typeof block.text === 'string' ? block.text : '';
        else if (block.type === 'thinking') text = typeof block.thinking === 'string' ? block.thinking : '';
        else if (block.type === 'toolCall') text = `${block.name || 'unknown'} ${json(block.arguments)}`;
        else if (block.type === 'sections' || block.type === 'tool-schema') text = block.text;
        else if (block.type === 'image') attachmentBytes = typeof block.data === 'string' ? Math.floor(block.data.length * 3 / 4) : 0;
        else warn(warnings, `Unsupported content type ${block.type} at ${entry.id}:${pi}; tokens unavailable.`);
        if (!text && block.type !== 'image') return;
        if (parts.length >= 100000) throw new Error('Session exceeds 100,000 normalized part limit; reduce scope');
        parts.push({ id: `${snapshot.header.id}/${entry.id}/${mi}/${pi}`, sessionId: snapshot.header.id, entryId: entry.id, messageIndex: mi, partIndex: pi, turn: turns.get(entry.id) ?? 0, timestamp: entry.timestamp, role, kind: block.type, category: category(role, block.type, message.toolName), toolName: message.toolName || block.name, text, chars: text.length, bytes: Buffer.byteLength(text), estimatedTokens: estimate(text), attachmentBytes });
      });
    });
  }
  if (!parts.some(p => p.role === 'system')) warn(warnings, 'No recorded system payload; system prompts/tool schemas may be unavailable.');
  if (snapshot.entries.some(e => e.type === 'compaction')) warn(warnings, 'Compaction exists: projected view excludes summarized originals; branch/history views include them.');
  const accounting = scope === 'history' ? snapshot.entries : branch;
  return { snapshot, scope, parts, warnings, totals: aggregate(parts), usage: usageOf(accounting), growth: growthOf(parts), markers: branch.filter(e => e.type === 'compaction').map(e => ({ id: e.id, turn: turns.get(e.id), tokensBefore: e.tokensBefore })) };
}

export function aggregate(parts) {
  const categories = Object.fromEntries(CATEGORIES.map(c => [c, 0])), roles = {}, kinds = {};
  let chars = 0, bytes = 0, estimatedTokens = 0, attachmentBytes = 0, attachments = 0;
  for (const p of parts) {
    categories[p.category] += p.estimatedTokens;
    roles[p.role] = (roles[p.role] || 0) + p.estimatedTokens;
    kinds[p.kind] = (kinds[p.kind] || 0) + p.estimatedTokens;
    chars += p.chars; bytes += p.bytes; estimatedTokens += p.estimatedTokens; attachmentBytes += p.attachmentBytes;
    if (p.kind === 'image') attachments++;
  }
  return { categories, roles, kinds, chars, bytes, estimatedTokens, attachmentBytes, attachments };
}
export function usageOf(entries) {
  const groups = new Map();
  for (const e of entries) {
    const m = e.type === 'message' ? e.message : e;
    if (!m?.usage || typeof m.usage !== 'object') continue;
    const key = `${m.provider || 'unrecorded'}/${m.model || 'unrecorded'} [${e.type === 'message' ? m.role : e.type === 'usage' ? `usage:${e.kind}` : e.type}]`;
    const group = groups.get(key) || { key, records: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
    group.records++;
    for (const field of ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens']) if (Number.isFinite(m.usage[field]) && m.usage[field] >= 0) group[field] += m.usage[field];
    groups.set(key, group);
  }
  return [...groups.values()];
}
export function growthOf(parts) {
  const turns = new Map();
  for (const p of parts) turns.set(p.turn, (turns.get(p.turn) || 0) + p.estimatedTokens);
  let cumulative = 0;
  return [...turns].sort((a, b) => a[0] - b[0]).map(([turn, delta]) => ({ turn, delta, cumulative: cumulative += delta }));
}
export const largest = report => [...report.parts].sort((a, b) => b.estimatedTokens - a.estimatedTokens || a.id.localeCompare(b.id));
export const title = report => report.snapshot.name || report.snapshot.header.id;
const row = (text, category) => ({ text: safe(text), category });
export const ACCOUNTING = [
  'Estimates = sum ceil(UTF-16 text characters / 4); NOT provider token counts, spend or exact active context.',
  'Growth = cumulative selected recorded contributions by user-message span; NOT request-time window occupancy.',
  'Provider usage is separate branch accounting (whole-file accounting in history scope), including repeated requests/caching.',
  'Missing prompts/schemas, provider framing, images, opaque signatures and hidden/redacted reasoning are unaccounted.',
  'Recorded system section/tool deltas are payload inventory, not exact reconstructed request state.',
  'Local inspection stays local. AI transmits approved samples to configured provider unless inference is actually local.',
  'Pi access is not transmission permission or automatic Studist compliance; approve provider for every information class.'
];
export function reportPages(reports, extraWarnings = []) {
  const overview = [row(`LOCAL · ${reports.length} selected session${reports.length === 1 ? '' : 's'} · nothing sent`), row('Text units ≈ chars/4, not provider tokens or context-window usage. Details has full accounting.')];
  const comparison = [row('Side-by-side estimated recorded text units (chars/4); stable categories.'), row(`session column: ${reports.map((r, i) => `${i + 1}=${title(r)}`).join(' | ')}`)];
  comparison.push(row(`category | ${reports.map((_, i) => `S${i + 1}`).join(' | ')}`));
  for (const c of CATEGORIES) comparison.push(row(`${c} | ${reports.map(r => r.totals.categories[c]).join(' | ')}`, c));
  comparison.push(row(`TOTAL | ${reports.map(r => r.totals.estimatedTokens).join(' | ')}`));
  const growth = [row('Cumulative recorded text by user turn — not historic context-window usage.')], contributors = [], warnings = [...ACCOUNTING, ...extraWarnings].map(s => row(s)), details = [...ACCOUNTING].map(s => row(s));
  for (const r of reports) {
    const h = `${title(r)} · ${r.snapshot.header.cwd || '?'} · ${SCOPE_LABELS[r.scope] || r.scope}`;
    overview.push(row(''), row(h), row(`~${r.totals.estimatedTokens} text units · ${r.totals.bytes} UTF-8 bytes · ${r.parts.length} ${r.parts.length === 1 ? 'part' : 'parts'}`));
    const ranked = CATEGORIES.filter(c => r.totals.categories[c] > 0).sort((a, b) => r.totals.categories[b] - r.totals.categories[a]);
    if (!ranked.length) overview.push(row('No recorded text in this scope.'));
    for (const c of ranked) {
      const percentage = Math.round(100 * r.totals.categories[c] / Math.max(1, r.totals.estimatedTokens));
      overview.push(row(`${CATEGORY_LABELS[c]}: ~${r.totals.categories[c]} (${percentage}%) ${'█'.repeat(Math.round(percentage / 5))}`, c));
    }
    if (r.totals.attachments) overview.push(row(`${r.totals.attachments} images — token contribution unavailable.`));
    details.push(row(''), row(h), row(`Snapshot: ${r.snapshot.capturedAt}`), row(`Source: ${r.snapshot.sourcePath || '(ephemeral/current memory)'}`), row(`Selected entry: ${r.snapshot.leafId ?? 'none'}`), row(`Text: ${r.totals.chars} chars / ${r.totals.bytes} UTF-8 bytes; images: ${r.totals.attachments} (~${r.totals.attachmentBytes} decoded bytes)`), row(`By role: ${json(r.totals.roles)}`), row(`By recorded type: ${json(r.totals.kinds)}`));
    growth.push(row(''), row(h), ...r.growth.map(g => row(`User turn ${g.turn}: +${g.delta}  cumulative ~${g.cumulative}`)), ...r.markers.map(m => row(`COMPACTION ${m.id}, user turn ${m.turn}; recorded tokensBefore=${m.tokensBefore ?? 'unavailable'}`)));
    contributors.push(row(''), row(h), ...largest(r).slice(0, 30).map(p => row(`~${p.estimatedTokens} ${CATEGORY_LABELS[p.category]} · user turn ${p.turn} · ${p.id}`, p.category)));
    warnings.push(row(''), row(h), ...r.warnings.map(w => row(`Warning: ${w}`)), row('Reported usage — branch/history accounting, NOT composition:'), ...(r.usage.length ? r.usage.map(u => row(`${u.key}: ${u.records} records; input=${u.input} output=${u.output} cacheRead=${u.cacheRead} cacheWrite=${u.cacheWrite} total=${u.totalTokens}`)) : [row('No reported usage available.')]));
  }
  return { Overview: overview, Compare: comparison, Growth: growth, Contributors: contributors, Warnings: warnings, Details: details };
}
