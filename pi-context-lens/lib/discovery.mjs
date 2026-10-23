import { open, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';

export const LIMITS = Object.freeze({ files: 10000, directories: 2000, window: 16384, fileBytes: 32 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, entries: 50000, selections: 6 });
export const checkAbort = signal => signal?.throwIfAborted();
export function rootsFor(agentDir, currentDir, envDir, extra = '') {
  return [...new Set([path.join(agentDir, 'sessions'), currentDir, envDir, ...extra.split(path.delimiter)].filter(Boolean).map(p => path.resolve(p)))];
}

async function readRange(handle, size, position) {
  const buffer = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(buffer, offset, size - offset, position + offset);
    if (!bytesRead) break;
    offset += bytesRead;
  }
  return buffer.subarray(0, offset);
}

export async function metadata(file, signal) {
  checkAbort(signal);
  const handle = await open(file, 'r');
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new Error('Not a regular session file');
    const prefix = (await readRange(handle, Math.min(stats.size, LIMITS.window), 0)).toString('utf8');
    const header = JSON.parse(prefix.split('\n')[0]);
    if (header.type !== 'session' || typeof header.id !== 'string') throw new Error('Missing session header');
    const start = Math.max(0, stats.size - LIMITS.window);
    const tail = start ? (await readRange(handle, LIMITS.window, start)).toString('utf8').split('\n').slice(1) : prefix.split('\n');
    let name, model;
    for (const line of tail) {
      checkAbort(signal);
      try {
        const e = JSON.parse(line);
        if (e.type === 'session_info') name = typeof e.name === 'string' ? e.name : undefined;
        if (e.type === 'model_change') model = `${e.provider}/${e.modelId}`;
        if (e.type === 'message' && e.message?.role === 'assistant') model = `${e.message.provider}/${e.message.model}`;
      } catch { /* Metadata windows can start/end inside a record. */ }
    }
    return { path: file, id: header.id, cwd: typeof header.cwd === 'string' ? header.cwd : '', created: header.timestamp, modified: stats.mtime.toISOString(), bytes: stats.size, name, model };
  } finally { await handle.close(); }
}

export async function discover(roots, { signal, onProgress = () => {}, limits = LIMITS } = {}) {
  const sessions = [], warnings = [], seen = new Set();
  let candidates = 0, directories = 0, stopped = false;
  async function visit(dir, depth) {
    checkAbort(signal);
    if (stopped) return;
    if (++directories > limits.directories) { stopped = true; warnings.push('Directory limit reached; discovery incomplete.'); return; }
    let entries;
    try { entries = await opendir(dir); }
    catch (e) { if (e.code !== 'ENOENT') warnings.push(`Cannot read root/directory ${dir}: ${e.code || e.message}`); return; }
    for await (const entry of entries) {
      checkAbort(signal);
      if (stopped) break;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory() && depth < 1) await visit(file, depth + 1);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        if (++candidates > limits.files) { stopped = true; warnings.push('File limit reached; discovery incomplete.'); break; }
        try {
          const canonical = await realpath(file);
          if (seen.has(canonical)) continue;
          seen.add(canonical);
          sessions.push(await metadata(canonical, signal));
        } catch (e) { checkAbort(signal); warnings.push(`Skipped ${file}: ${e.code || e.message}`); }
        if (candidates % 20 === 0) onProgress(`Metadata: ${candidates} files`);
      }
    }
  }
  for (const root of roots) await visit(root, 0);
  sessions.sort((a, b) => b.modified.localeCompare(a.modified) || a.path.localeCompare(b.path));
  return { sessions, warnings };
}

export async function snapshot(file, { signal, maxBytes = LIMITS.fileBytes, afterStat } = {}) {
  checkAbort(signal);
  const handle = await open(file, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error('Not a regular session file');
    if (before.size > Math.min(maxBytes, LIMITS.fileBytes)) throw new Error('Session exceeds selected snapshot byte limit');
    await afterStat?.(); // Deterministic concurrent-append testing seam.
    checkAbort(signal);
    const buffer = await readRange(handle, before.size, 0);
    checkAbort(signal);
    const after = await handle.stat();
    const warnings = [];
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || buffer.length !== before.size) warnings.push('File changed during snapshot; only the captured prefix is analyzed.');
    return { content: buffer.toString('utf8'), bytes: buffer.length, sourcePath: file, capturedAt: new Date().toISOString(), warnings };
  } finally { await handle.close(); }
}

export function filterSessions(sessions, query) {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return sessions.filter(s => words.every(word => [s.name, s.cwd, s.created, s.modified, s.model, s.id, s.path, s.current ? 'current' : ''].join(' ').toLocaleLowerCase().includes(word)));
}
