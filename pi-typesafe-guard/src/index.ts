import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Credentials, validKey } from './credentials.ts';
import { githubRepo, type Metadata } from './policy.ts';
import { guard } from './guard.ts';
import { secretInput, Serial } from './ui.ts';
import { evaluate } from './typesafe.ts';
import { redact } from './privacy.ts';

const exec = promisify(execFile);
export default function typesafeGuard(pi: ExtensionAPI) {
  const credentials = new Credentials();
  const serial = new Serial();
  let remoteEnabled = false;
  let lifecycle = new AbortController();

  const status = (ctx: ExtensionContext) => {
    if (ctx.hasUI) ctx.ui.setStatus('typesafe-guard', `Guard: ON · TypeSafe ${remoteEnabled && credentials.value ? 'metadata' : 'off'} · key ${credentials.source}`);
  };
  async function origin(cwd: string): Promise<string | undefined> {
    try {
      // No gh authentication, hooks, shell interpolation, or network access.
      const result = await exec('git', ['-C', cwd, 'config', '--get', 'remote.origin.url'], { timeout: 2000, maxBuffer: 4096 });
      return githubRepo(result.stdout);
    } catch { return undefined; }
  }
  async function check(call: { toolName: string; input: Record<string, unknown> }, ctx: ExtensionContext, builtin: boolean) {
    const signal = ctx.signal ? AbortSignal.any([ctx.signal, lifecycle.signal]) : lifecycle.signal;
    return guard(call, { ...ctx, signal }, {
      builtin, origin: await origin(ctx.cwd), key: credentials.value, remoteEnabled,
    });
  }
  pi.on('session_start', async (_event, ctx) => {
    lifecycle = new AbortController();
    remoteEnabled = false;
    // No native credential access / OS prompts during print or JSON startup.
    if (ctx.mode === 'tui') {
      try { await credentials.load(); }
      catch { ctx.ui.notify('Guard: keychain unavailable/locked or stored key invalid. Local protection is active; /typesafe-guard to configure.', 'warning'); }
    }
    status(ctx);
    if (ctx.hasUI) ctx.ui.notify('TypeSafe Guard loaded. /typesafe-guard: add/remove key, test API, enable metadata checks. All shell/mutation/custom tools require approval.', 'info');
  });
  pi.on('session_shutdown', () => {
    lifecycle.abort(); credentials.clear(); remoteEnabled = false;
  });
  pi.on('tool_call', (event, ctx) => serial.run(async () => {
    const tools = pi.getAllTools().filter(t => t.name === event.toolName);
    const builtin = tools.length > 0 && tools.every(t => t.sourceInfo?.source === 'builtin');
    return check(event, ctx, builtin);
  }));
  pi.on('user_bash', (event, ctx) => serial.run(async () => {
    const result = await check({ toolName: 'bash', input: { command: event.command } }, { ...ctx, cwd: event.cwd }, true);
    if (result?.block) return { result: { output: result.reason, exitCode: 1, cancelled: true, truncated: false } };
    return undefined;
  }));
  // Defense in depth only: finalized text/details, not earlier streamed output,
  // images, binary attachments, session files, or other extensions' traffic.
  pi.on('tool_result', (event) => {
    const known = credentials.value ? [credentials.value] : [];
    const clean = event.content.map(c => c.type === 'text' ? { ...c, text: redact(c.text, known) } : c);
    let details = event.details;
    try {
      if (details !== undefined) details = JSON.parse(redact(JSON.stringify(details), known));
    } catch { details = { guard: 'Details withheld: could not safely redact.' }; }
    return { content: clean, details };
  });
  pi.registerCommand('typesafe-guard', {
    description: 'Manage TypeSafe key securely, test connection, or enable metadata-only risk checks',
    handler: (args, ctx) => serial.run(async () => {
      if (args.trim()) {
        ctx.ui.notify('Use /typesafe-guard without arguments. Never put an API key in chat or command arguments.', 'warning');
        return;
      }
      if (!ctx.hasUI) return;
      const choice = await ctx.ui.select('TypeSafe Guard (local approval gates are always on)', [
        'Cancel', 'Status', 'Add / replace API key', 'Load saved key', 'Remove API key',
        'Enable TypeSafe metadata checks', 'Disable TypeSafe metadata checks', 'Test API key',
      ]);
      try {
        if (choice === 'Status') {
          ctx.ui.notify(`Key source: ${credentials.source}. TypeSafe checks: ${remoteEnabled ? 'enabled' : 'disabled'}. Approval policy: always on. No key values are displayed.`, 'info');
        } else if (choice === 'Add / replace API key') {
          if (ctx.mode !== 'tui') { ctx.ui.notify('Secure key entry requires the terminal TUI (not RPC).', 'warning'); return; }
          const storage = await ctx.ui.select('Storage for the new key', ['Cancel', 'OS credential store', 'Session memory only']);
          if (storage !== 'OS credential store' && storage !== 'Session memory only') return;
          const value = await secretInput(ctx);
          if (value === undefined) return;
          if (!validKey(value)) { ctx.ui.notify('Invalid key: expected 8–4096 printable ASCII characters without whitespace. Nothing changed.', 'warning'); return; }
          await credentials.set(value, storage === 'OS credential store');
          ctx.ui.notify(storage === 'OS credential store' ? 'Key saved in OS credential store. Use Test API key to verify it.' : 'Key set in session memory. Any previously saved OS key remains; Remove API key deletes it.', 'info');
        } else if (choice === 'Load saved key') {
          await credentials.load();
          ctx.ui.notify(credentials.value ? 'Saved key loaded.' : 'No saved key exists.', 'info');
        } else if (choice === 'Remove API key') {
          const confirmed = await ctx.ui.select('Clear session key AND delete the saved OS key? This does not revoke it at TypeSafe.', ['Cancel', 'Remove key']);
          if (confirmed !== 'Remove key') return;
          remoteEnabled = false;
          const deleted = await credentials.remove();
          ctx.ui.notify(deleted ? 'Session key cleared; saved key deleted.' : 'Session key cleared; no saved key existed.', 'info');
        } else if (choice === 'Enable TypeSafe metadata checks') {
          if (!credentials.value) { ctx.ui.notify('Add or load a key first. Local approval gates remain on.', 'warning'); return; }
          const consent = await ctx.ui.select('Send limited risk metadata to api.typesafe.ai for this session?\nOnly fixed categories/flags: tool kind, recognized operations, path/repo relationship, and secret indicators.\nNo raw commands, names, paths, source code, prompts, or file contents. API usage may incur charges.', ['Cancel', 'Enable metadata checks']);
          remoteEnabled = consent === 'Enable metadata checks';
        } else if (choice === 'Disable TypeSafe metadata checks') {
          remoteEnabled = false;
        } else if (choice === 'Test API key') {
          if (!credentials.value) { ctx.ui.notify('No key configured.', 'warning'); return; }
          const consent = await ctx.ui.select('Send a fixed, non-sensitive test request to TypeSafe? API usage may incur charges.', ['Cancel', 'Test now']);
          if (consent !== 'Test now') return;
          const metadata: Metadata = { kind: 'read', operations: [], pathScope: 'inside', protectedPath: false,
            secretIndicator: false, githubScope: 'not-detected', githubAuthor: 'unverified' };
          await evaluate(metadata, credentials.value, lifecycle.signal);
          ctx.ui.notify('TypeSafe returned valid risk signals. Key works.', 'info');
        }
      } catch {
        ctx.ui.notify(choice === 'Remove API key'
          ? 'Session key cleared and remote checks disabled, but OS deletion failed. The saved key may remain. Unlock the store and retry, or remove pi-typesafe-guard / typesafe-api-key manually. Revoke in TypeSafe if needed.'
          : 'Operation failed (keychain locked/unavailable, invalid key, or API error). No plaintext fallback was used. Local approval gates remain active.', 'error');
      } finally { status(ctx); }
    }),
  });
}
