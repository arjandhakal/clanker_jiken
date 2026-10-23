import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
export async function temp() { const root = new URL('../.tmp/', import.meta.url); await mkdir(root, { recursive: true }); return mkdtemp(path.join(root.pathname, 'test-')); }
export const header = (id = 'synthetic', cwd = '/synthetic/project') => ({ type: 'session', version: 3, id, cwd, timestamp: '2026-01-01T00:00:00.000Z' });
export const entry = (id, parentId, type, fields) => ({ id, parentId, type, timestamp: '2026-01-01T00:01:00.000Z', ...fields });
export const user = (id, parentId, text = 'Synthetic task evidence') => entry(id, parentId, 'message', { message: { role: 'user', content: text, timestamp: 1 } });
export const usage = { input: 10, output: 5, cacheRead: 3, cacheWrite: 2, totalTokens: 20, reasoning: 2, cacheWrite1h: 1 };
export function fixture(id = 'synthetic', cwd = '/synthetic/project') {
  return [header(id, cwd),
    entry('sys', null, 'message', { message: { role: 'system', content: '', sections: { task: 'Synthetic instructions' }, toolsAdded: [{ name: 'read', description: 'Synthetic file reader', parameters: {} }], timestamp: 0 } }),
    user('u1', 'sys'),
    entry('a1', 'u1', 'message', { message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Synthetic recorded reasoning', thinkingSignature: 'OPAQUE_NOT_EVIDENCE' }, { type: 'toolCall', name: 'read', id: 'tool1', arguments: { path: 'synthetic.txt' } }], provider: 'fixture', model: 'fixture-model', usage, stopReason: 'toolUse', timestamp: 2 } }),
    entry('t1', 'a1', 'message', { message: { role: 'toolResult', toolName: 'read', toolCallId: 'tool1', content: [{ type: 'text', text: 'Synthetic file evidence' }, { type: 'image', data: 'AAAA', mimeType: 'image/png' }], details: { private: 'DETAILS_NOT_EVIDENCE' }, usage, timestamp: 3 } }),
    user('abandoned', 't1', 'Synthetic abandoned alternative'),
    user('u2', 't1', 'Synthetic selected alternative'),
    entry('cmp', 'u2', 'compaction', { summary: 'Synthetic summary', firstKeptEntryId: 'u2', tokensBefore: 100, usage, systemMessage: { role: 'system', content: 'Synthetic system checkpoint', timestamp: 4 } }),
    entry('edit', 'cmp', 'context_edit', { targetId: 'u2', replacement: { content: 'Synthetic replacement evidence' } }),
    entry('name', 'edit', 'session_info', { name: 'Synthetic inspection' }),
    entry('usage', 'name', 'usage', { kind: 'cache_warm', provider: 'fixture', model: 'fixture-model', usage })];
}
export const jsonl = values => values.map(v => JSON.stringify(v)).join('\n') + '\n';
export const input = values => ({ content: jsonl(values), capturedAt: 'synthetic-time', sourcePath: '/synthetic/session.jsonl', warnings: [] });
