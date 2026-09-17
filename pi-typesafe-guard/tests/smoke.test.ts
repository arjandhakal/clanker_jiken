import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

// Real Pi extension loader and RPC UI, no model requests or real credentials.
test('real Pi RPC loads extension and denies a user bash request before execution', { timeout: 20_000 }, async t => {
  const temp = await mkdtemp(join(tmpdir(), 'pi-guard-smoke-'));
  const child = spawn(process.execPath, [
    resolve('node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
    '--mode', 'rpc', '--no-session', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes',
    '-e', resolve('src/index.ts'),
  ], {
    cwd: temp,
    env: { PATH: process.env.PATH, HOME: temp, PI_CODING_AGENT_DIR: join(temp, 'agent'), PI_OFFLINE: '1', PI_TELEMETRY: '0' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
  t.after(async () => { child.kill('SIGTERM'); await closed; await rm(temp, { recursive: true, force: true }); });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const lines = createInterface({ input: child.stdout });
  const result = await new Promise<{ sawPrompt: boolean; response: any }>((resolve, reject) => {
    let sawPrompt = false;
    child.on('error', reject);
    child.on('exit', code => reject(new Error(`Pi exited ${code}: ${stderr}`)));
    lines.on('line', line => {
      let msg: any;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.type === 'extension_error') reject(new Error(JSON.stringify(msg)));
      if (msg.type === 'response' && msg.id === 'commands') {
        try { assert.ok(msg.data.commands.some((c: any) => c.name === 'typesafe-guard'), stderr); }
        catch (e) { reject(e); return; }
        child.stdin.write(JSON.stringify({ id: 'bash', type: 'bash', command: 'printf GUARD_SMOKE_EXECUTED' }) + '\n');
      }
      if (msg.type === 'extension_ui_request' && msg.method === 'select') {
        sawPrompt = true;
        child.stdin.write(JSON.stringify({ type: 'extension_ui_response', id: msg.id, cancelled: true }) + '\n');
      }
      if (msg.type === 'response' && msg.id === 'bash') resolve({ sawPrompt, response: msg });
    });
    child.stdin.write(JSON.stringify({ id: 'commands', type: 'get_commands' }) + '\n');
  });
  assert.equal(result.sawPrompt, true);
  assert.equal(result.response.data.cancelled, true);
  assert.doesNotMatch(result.response.data.output, /GUARD_SMOKE_EXECUTED/);
});
