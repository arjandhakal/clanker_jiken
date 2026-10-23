import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdir, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { discover, metadata, snapshot, rootsFor, filterSessions, LIMITS } from '../lib/discovery.mjs';
import { parseSnapshot, branchOf, normalize, tipsOf, aggregate, usageOf, reportPages, CATEGORIES, safe } from '../lib/core.mjs';
import { fixture, header, user, entry, input, jsonl, temp, usage } from './fixtures.mjs';

const identityProject = entries => ({ entries: entries.filter(e => e.type === 'message').map(sourceEntry => ({ sourceEntry, messages: [sourceEntry.message] })) });
test('metadata-only multi-project/flat roots, symlink avoidance, search and caps', async () => {
  const root = await temp();
  try {
    await mkdir(path.join(root, 'project-a')); await mkdir(path.join(root, 'project-b'));
    await writeFile(path.join(root, 'project-a', 'a.jsonl'), jsonl(fixture('a', '/project/a')));
    await writeFile(path.join(root, 'project-b', 'b.jsonl'), jsonl(fixture('b', '/project/b')));
    await writeFile(path.join(root, 'flat.jsonl'), jsonl([header('flat'), user('u', null, 'BODY_TEXT_NOT_METADATA')]));
    await symlink(root, path.join(root, 'loop'));
    const result = await discover([root, path.join(root, 'project-a')]);
    assert.equal(result.sessions.length, 3);
    assert.equal(result.sessions.find(s => s.id === 'a').name, 'Synthetic inspection');
    assert.ok(!JSON.stringify(result).includes('BODY_TEXT_NOT_METADATA'));
    assert.equal(filterSessions(result.sessions, '/project/b synthetic').length, 1);
    assert.equal(filterSessions(result.sessions, '2026 fixture-model').length, 2);
    assert.deepEqual(rootsFor('/agent', '/override', '/env', '/extra'), ['/agent/sessions', '/override', '/env', '/extra']);
    const capped = await discover([root], { limits: { ...LIMITS, files: 1 } });
    assert.equal(capped.sessions.length, 1); assert.match(capped.warnings.join(), /limit/);
    const aborted = AbortSignal.abort(new Error('cancel scan'));
    await assert.rejects(discover([root], { signal: aborted }), /cancel scan/);
    await assert.rejects(metadata(path.join(root, 'gone.jsonl')), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('bounded metadata tail does not search transcript or promise complete name/model', async () => {
  const root = await temp(), file = path.join(root, 'large.jsonl');
  try {
    const records = [header(), entry('n', null, 'session_info', { name: 'outside-window' }), user('u', 'n', 'x'.repeat(80000))];
    await writeFile(file, jsonl(records));
    const m = await metadata(file);
    assert.equal(m.name, undefined); assert.equal(m.model, undefined);
    assert.ok(JSON.stringify(m).length < 1000);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('readonly prefix snapshots tolerate active appends, partial tail and valid final line', async () => {
  const root = await temp(), file = path.join(root, 'active.jsonl');
  try {
    const original = jsonl(fixture()); await writeFile(file, original);
    const snap = await snapshot(file, { afterStat: () => appendFile(file, '{"type":') });
    assert.equal(snap.content, original); assert.match(snap.warnings.join(), /changed/);
    const later = parseSnapshot(await snapshot(file)); assert.match(later.warnings.join(), /incomplete final/);
    assert.equal(await readFile(file, 'utf8'), original + '{"type":');
    await assert.rejects(snapshot(file, { maxBytes: 3 }), /limit/);
    const noNewline = parseSnapshot({ ...input(fixture()), content: original.trimEnd() });
    assert.equal(noNewline.entries.length, fixture().length - 1);
    await assert.rejects(snapshot(file, { signal: AbortSignal.abort(new Error('cancel snapshot')) }), /cancel snapshot/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('corrupt, duplicate, unknown and legacy entries have explicit bounded behavior', () => {
  assert.throws(() => parseSnapshot(input([{ ...header(), version: 1 }])), /versions/);
  assert.throws(() => parseSnapshot(input([{ ...header(), version: 99 }])), /versions/);
  const content = jsonl([header(), user('u', null)]) + 'broken\n' + jsonl([user('u', null), entry('future', 'u', 'future', {})]);
  const s = parseSnapshot({ content });
  assert.equal(s.entries.length, 2);
  assert.match(s.warnings.join(), /corrupt.*Duplicate.*Unsupported/);
  assert.throws(() => branchOf([user('a', 'b'), user('b', 'a')], 'a'), /cycle/);
  assert.throws(() => branchOf([user('a', 'missing')], 'a'), /ancestor/);
});
test('branch vs whole history, provenance, normalized types, usage scopes and growth', () => {
  const s = parseSnapshot(input(fixture()));
  const branch = normalize(s, 'branch', identityProject);
  const history = normalize(s, 'history', identityProject);
  assert.ok(!branch.parts.some(p => p.entryId === 'abandoned'));
  assert.ok(history.parts.some(p => p.entryId === 'abandoned'));
  assert.equal(tipsOf(s.entries).length, 2);
  assert.equal(new Set(history.parts.map(p => p.id)).size, history.parts.length);
  assert.ok(branch.parts.some(p => p.category === 'reasoning'));
  assert.ok(branch.parts.some(p => p.category === 'tool-call'));
  assert.ok(branch.parts.some(p => p.category === 'tool-result:file'));
  assert.equal(branch.totals.attachments, 1);
  assert.ok(!branch.parts.some(p => /OPAQUE_NOT|DETAILS_NOT/.test(p.text)));
  assert.equal(branch.growth.at(-1).cumulative, branch.totals.estimatedTokens);
  assert.equal(Object.values(branch.totals.categories).reduce((a, b) => a + b, 0), branch.totals.estimatedTokens);
  assert.deepEqual(Object.keys(branch.totals.categories), CATEGORIES);
  assert.equal(branch.usage.reduce((n, u) => n + u.output, 0), 20, 'reasoning not added twice across 4 records');
  assert.equal(usageOf([entry('x', null, 'usage', { kind: 'warm', usage })])[0].cacheWrite, 2);
  assert.equal(aggregate([]).estimatedTokens, 0);
  const pages = reportPages([branch, history]);
  assert.match(pages.Compare.map(r => r.text).join('\n'), /S1 \| S2/);
  assert.match(pages.Warnings.map(r => r.text).join('\n'), /NOT provider|NOT composition/);
});
test('overview leads with size/dominant categories and moves technical accounting into Details', () => {
  const report = normalize(parseSnapshot(input(fixture())), 'branch');
  const pages = reportPages([report]);
  const overview = pages.Overview.map(r => r.text).join('\n');
  assert.match(overview, /LOCAL.*nothing sent/); assert.match(overview, /text units/); assert.match(overview, /Selected branch/);
  assert.doesNotMatch(overview, /scope=|leaf=|By role:|By recorded type:|\/synthetic\/session\.jsonl|Assistant replies:/);
  const values = pages.Overview.filter(r => r.category).map(r => report.totals.categories[r.category]);
  assert.deepEqual(values, [...values].sort((a, b) => b - a)); assert.ok(values.every(n => n > 0));
  const details = pages.Details.map(r => r.text).join('\n');
  assert.match(details, /Source: \/synthetic\/session\.jsonl/); assert.match(details, /Selected entry:/); assert.match(details, /By role:/); assert.match(details, /NOT provider token counts/);
  assert.match(pages.Growth.map(r => r.text).join('\n'), /User turn/);
});

test('terminal controls, hyperlinks and bidi do not survive display sanitization', () => {
  const text = safe('\x1b]8;;https://untrusted\x07link\x1b]8;;\x07\x1b[31mred\x1b[0m\x1b[2J\u202e日本語');
  assert.ok(!/[\x00-\x1f\u202e]/.test(text)); assert.match(text, /日本語/);
});
