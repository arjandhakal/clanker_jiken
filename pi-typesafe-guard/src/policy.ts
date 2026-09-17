import { realpath, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, dirname, basename, relative, isAbsolute } from 'node:path';
import { hasSecret, protectedPath } from './privacy.ts';

export type Call = { toolName: string; input: Record<string, unknown> };
export type Metadata = {
  kind: 'read' | 'write' | 'edit' | 'shell' | 'other';
  operations: string[];
  pathScope: 'inside' | 'outside' | 'unknown';
  protectedPath: boolean;
  secretIndicator: boolean;
  githubScope: 'same' | 'different' | 'unknown' | 'not-detected';
  githubAuthor: 'unverified';
};
export type Assessment = { metadata: Metadata; reasons: string[]; ask: boolean; critical: boolean };

export function normalizePath(path: string, cwd: string): string {
  path = path.replace(/^@/, '');
  if (path === '~') path = homedir();
  else if (path.startsWith('~/')) path = resolve(homedir(), path.slice(2));
  return resolve(cwd, path);
}
// Resolve the nearest existing ancestor for new files. Dangling links and I/O
// failures must NOT fall back to a lexical inside-workspace verdict.
export async function canonicalPath(path: string): Promise<string> {
  try { return await realpath(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    try {
      if ((await lstat(path)).isSymbolicLink()) throw new Error('Dangling symlink');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    const parent = dirname(path);
    if (parent === path) throw error;
    return resolve(await canonicalPath(parent), basename(path));
  }
}
export function inside(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\'));
}
export function githubRepo(remote: string): string | undefined {
  const match = remote.trim().match(/^(?:git@github\.com:|https:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i);
  return match?.[1].toLowerCase();
}

export async function assess(call: Call, cwd: string, builtin: boolean, origin?: string, known: string[] = []): Promise<Assessment> {
  const raw = JSON.stringify(call.input);
  const kind = ['read', 'write', 'edit'].includes(call.toolName) ? call.toolName as 'read' | 'write' | 'edit'
    : /^(bash|powershell)$/.test(call.toolName) ? 'shell' : 'other';
  const m: Metadata = { kind, operations: [], pathScope: 'unknown', protectedPath: false,
    secretIndicator: hasSecret(raw, known), githubScope: 'not-detected', githubAuthor: 'unverified' };
  const reasons: string[] = [];
  if (typeof call.input.path === 'string') {
    try {
      const lexical = normalizePath(call.input.path, cwd);
      const [path, root] = await Promise.all([canonicalPath(lexical), realpath(cwd)]);
      m.pathScope = inside(path, root) ? 'inside' : 'outside';
      m.protectedPath = protectedPath(lexical) || protectedPath(path);
    } catch { reasons.push('Path cannot be safely resolved (missing ancestor, symlink, or permissions).'); }
    if (m.pathScope === 'outside') reasons.push('Target is outside the current workspace.');
    if (m.protectedPath) reasons.push('Credential, agent configuration, or repository-control path.');
  }
  // These detectors only add warnings. They NEVER make a shell command safe.
  const command = typeof call.input.command === 'string' ? call.input.command : raw;
  const detectors: [string, RegExp][] = [
    ['deletion', /\b(?:rm|rmdir|unlink|shred|srm|Remove-Item|rmtree|delete|destroy|drop)\b/i],
    ['history-rewrite', /\b(?:reset|clean|restore|checkout)\b|--force|-f\b/i],
    ['network', /\b(?:curl|wget|fetch|ssh|scp|rsync|push|upload|post|send)\b|https?:\/\//i],
    ['privilege-change', /\b(?:sudo|su|chmod|chown|icacls)\b/i],
    ['code-execution', /\b(?:eval|exec|python\d*|node|npm|npx|bash|sh|powershell|make|docker|kubectl|terraform)\b/i],
    ['github', /\bgh\b|github|pull_request|\bpr\b|\bissue\b/i],
    ['github-mutation', /\b(?:create|edit|comment|close|reopen|merge|review|delete|transfer|lock|unlock)\b/i],
  ];
  for (const [label, regex] of detectors) if (regex.test(command)) m.operations.push(label);
  if (!m.operations.includes('github')) m.operations = m.operations.filter(x => x !== 'github-mutation');
  if (m.operations.includes('github')) {
    const targets = [...command.matchAll(/(?:--repo(?:=|\s+)|-R\s*)([\w.-]+\/[\w.-]+)|github\.com\/([\w.-]+\/[\w.-]+)/g)]
      .map(x => (x[1] ?? x[2]).replace(/\.git$/, '').toLowerCase());
    // Missing explicit target, gh aliases, gh api, -C, changed cwd and config overrides
    // remain unknown. Even a same-repo result conveys NO authorship or permission.
    m.githubScope = targets.length && origin ? (targets.every(x => x === origin) ? 'same' : 'different') : 'unknown';
    reasons.push(m.githubScope === 'different' ? 'GitHub target differs from local origin.' : 'GitHub target/authority must be reviewed.');
    reasons.push('PR/issue authorship is unverified; editing another person’s work needs explicit approval.');
  }
  if (m.secretIndicator) reasons.push('Possible secret in tool arguments. Review destination and redact before proceeding.');
  if (m.operations.includes('deletion')) reasons.push('Possible permanent deletion, project destruction, or database drop. Prefer trash/backups.');
  if (m.operations.includes('network')) reasons.push('Possible network transfer/publication; check destination and sensitive data.');
  if (kind === 'shell') reasons.push('Shell execution can run arbitrary code, including hidden or indirect destructive actions.');
  else if (kind === 'write' || kind === 'edit') reasons.push('File mutation can overwrite data or introduce executable behavior.');
  else if (!builtin || kind !== 'read') reasons.push('Custom, delegated, search, or unrecognized tool: behavior is not proven read-only.');
  const safeRead = builtin && kind === 'read' && m.pathScope === 'inside' && !m.protectedPath && !m.secretIndicator;
  return { metadata: m, reasons, ask: !safeRead,
    critical: m.secretIndicator || m.protectedPath || m.operations.includes('deletion') || m.githubScope === 'different' };
}
