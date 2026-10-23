import test from 'node:test';
import assert from 'node:assert/strict';
import { rm, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { parseSnapshot, normalize } from '../lib/core.mjs';
import { fixture, input, user, entry, header, temp, jsonl } from './fixtures.mjs';

async function installed(t) {
  process.env.PI_OFFLINE = '1';
  try { return await import(process.env.PI_SDK_PATH ? pathToFileURL(path.resolve(process.env.PI_SDK_PATH)).href : '@earendil-works/pi-coding-agent'); }
  catch (e) { if (e.code === 'ERR_MODULE_NOT_FOUND' && !process.env.PI_SDK_PATH) { t.skip('Set PI_SDK_PATH to installed Pi dist/index.js for runtime tests.'); return; } throw e; }
}
test('actual SDK projection: branches, compaction checkpoint, replacement/omission and retain-none', async t => {
  const sdk = await installed(t); if (!sdk) return;
  const s = parseSnapshot(input(fixture()));
  const context = normalize(s, 'context', sdk.buildSessionProjection);
  assert.ok(!context.parts.some(p => p.entryId === 'abandoned' || p.entryId === 'u1' || p.entryId === 'a1'));
  assert.ok(context.parts.some(p => p.entryId === 'u2' && p.text === 'Synthetic replacement evidence'));
  assert.ok(context.parts.some(p => p.entryId === 'cmp' && p.role === 'system'));
  assert.ok(context.parts.some(p => p.category === 'summary'));
  assert.equal(context.usage.length, 4, 'branch usage remains visible after context compaction');
  const omitted = fixture(); omitted.push(entry('omit', 'usage', 'context_edit', { targetId: 'u2', replacement: null }));
  assert.ok(!normalize(parseSnapshot(input(omitted)), 'context', sdk.buildSessionProjection).parts.some(p => p.entryId === 'u2'));
  const retainNone = [header(), user('old', null), entry('c', 'old', 'compaction', { summary: 'retain-none summary', firstKeptEntryId: 'c' }), user('new', 'c')];
  const r = normalize(parseSnapshot(input(retainNone)), 'context', sdk.buildSessionProjection);
  assert.ok(!r.parts.some(p => p.entryId === 'old')); assert.ok(r.parts.some(p => p.entryId === 'new'));
  retainNone.push(entry('c2', 'new', 'compaction', { summary: 'second compaction', firstKeptEntryId: 'new' }));
  const repeated = normalize(parseSnapshot(input(retainNone)), 'context', sdk.buildSessionProjection);
  assert.ok(!repeated.parts.some(p => p.text === 'retain-none summary')); assert.ok(repeated.parts.some(p => p.text === 'second compaction'));
  const branches = [header('summary'), user('root', null), user('left', 'root', 'Abandoned branch text'), entry('summary', 'root', 'branch_summary', { fromId: 'left', summary: 'Selected branch summary' }), entry('bash', 'summary', 'message', { message: { role: 'bashExecution', command: 'echo synthetic', output: 'Excluded local shell', excludeFromContext: true } }), user('right', 'bash', 'Selected branch text')];
  const projected = normalize(parseSnapshot(input(branches)), 'context', sdk.buildSessionProjection);
  assert.ok(projected.parts.some(p => p.text === 'Selected branch summary'));
  assert.ok(!projected.parts.some(p => p.entryId === 'left' || p.entryId === 'bash'));
  const historicalLeaf = parseSnapshot(input(branches)); historicalLeaf.leafId = 'root';
  assert.equal(normalize(historicalLeaf, 'branch').parts.length, 1, 'authoritative non-tip leaf does not concatenate later branches');
});
test('installed Pi loads extension; headless safe; current ephemeral TUI workflow and declined inference never invoke provider', async t => {
  const sdk = await installed(t); if (!sdk) return;
  const root = await temp(), notices = [], errors = [];
  const previousAgent = process.env.PI_CODING_AGENT_DIR, previousSessions = process.env.PI_CODING_AGENT_SESSION_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, 'agent');
  process.env.PI_CODING_AGENT_SESSION_DIR = path.join(root, 'extra');
  const settingsManager = sdk.SettingsManager.inMemory();
  let session;
  try {
    const loader = new sdk.DefaultResourceLoader({ cwd: root, agentDir: path.join(root, 'agent'), settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, additionalExtensionPaths: [fileURLToPath(new URL('../extensions/index.ts', import.meta.url))] });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    ({ session } = await sdk.createAgentSession({ cwd: root, agentDir: path.join(root, 'agent'), settingsManager, resourceLoader: loader, model: { id: 'synthetic-model', name: 'Synthetic model (never invoked)', provider: 'fixture', api: 'openai-completions', baseUrl: 'http://unused.invalid', contextWindow: 32000, maxTokens: 2048, input: ['text'], reasoning: false, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }, sessionManager: sdk.SessionManager.inMemory(root), noTools: true }));
    await session.bindExtensions({ mode: 'print', onError: e => errors.push(e), commandContextActions: { waitForIdle: () => session.waitForIdle(), reload: () => session.reload() } });
    const runner = session.extensionRunner;
    const base = runner.getUIContext();
    runner.setUIContext({ ...base, notify: (text, level) => notices.push({ text, level }) }, 'print');
    await session.prompt('/context-lens');
    assert.match(notices.at(-1).text, /requires interactive/);
    assert.equal(session.messages.length, 0);
    // Synthetic content only, inserted in ephemeral manager via SDK, not a source file.
    session.sessionManager.appendMessage({ role: 'user', content: 'Synthetic ephemeral content', timestamp: Date.now() });
    const before = session.sessionManager.getEntries();
    const pages = [], screens = [];
    const actions = ['detail', 'close'];
    let modelCalls = 0;
    runner.createContext().modelRegistry.streamSimple = () => { modelCalls++; throw new Error('Must not infer'); };
    runner.setUIContext({ ...base, notify: (text, level) => notices.push({ text, level }), select: async (_title, choices) => choices[0], custom: async factory => {
      let resolved;
      const component = factory({ terminal: { rows: 28 }, requestRender() {} }, { fg: (_color, text) => text }, {}, value => { resolved = value; });
      if (component.pages) {
        pages.push(component.pages); screens.push(component);
        for (const width of [1, 20, 80, 140]) assert.ok(component.render(width).every(line => typeof line === 'string'));
        return component.actions ? actions.shift() : 'close';
      }
      for (let i = 0; resolved === undefined && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 1));
      component.dispose?.();
      return resolved;
    } }, 'tui');
    await session.prompt('/context-lens current');
    assert.ok(pages.some(p => p.Compare && p.Growth));
    assert.ok(pages.some(p => p['Local evidence']));
    assert.equal(modelCalls, 0);
    assert.deepEqual(session.sessionManager.getEntries(), before, 'inspection adds no conversation or metadata entries');
    await t.test('report remembers each tab/scroll position and keeps narrow actions visible', async () => {
      const Screen = screens[0].constructor, state = { offsets: {} };
      const samplePages = { Overview: Array.from({ length: 80 }, (_, i) => ({ text: `Summary 日本語 ${i}` })), Growth: Array.from({ length: 80 }, (_, i) => ({ text: `User turn ${i}` })) };
      const create = () => new Screen(samplePages, { terminal: { rows: 24 }, requestRender() {} }, { fg: (_c, text) => text }, () => {}, true, state);
      const screen = create();
      screen.render(42); screen.handleInput('\x1b[B'); screen.render(42);
      screen.handleInput('\x1b[C'); screen.render(42);
      for (let i = 0; i < 12; i++) screen.handleInput('\x1b[B');
      screen.render(42);
      const growthOffset = screen.offset;
      screen.handleInput('\x1b[D'); assert.equal(screen.offset, 1);
      screen.handleInput('\x1b[C'); assert.equal(screen.offset, growthOffset);
      screen.handleInput('d');
      const restored = create();
      assert.equal(Object.keys(restored.pages)[restored.tab], 'Growth'); assert.equal(restored.offset, growthOffset);
      const tui = await import(process.env.PI_SDK_PATH ? new URL('../node_modules/@earendil-works/pi-tui/dist/index.js', pathToFileURL(path.resolve(process.env.PI_SDK_PATH))).href : '@earendil-works/pi-tui');
      for (const width of [20, 42, 80]) {
        const lines = restored.render(width), text = lines.join('\n');
        assert.match(lines[0], /Growth/); assert.match(text, /A AI analysis/); assert.match(text, /D evidence/); assert.match(text, /Esc back/);
        assert.ok(lines.every(line => tui.visibleWidth(line) <= width));
        assert.ok(lines.length <= 17, 'viewport including footer fits terminal budget');
      }
    });
    // Declined transmission path with exact payload review and a mocked model route.
    actions.push('analyze', 'close');
    let preview = false, confirmed = 0;
    const currentUI = runner.getUIContext();
    runner.setUIContext({ ...currentUI,
      input: async () => 'What is useful in the synthetic evidence?',
      select: async (label, choices) => label.includes('dimension') ? 'usefulness' : choices[0],
      confirm: async (label, body) => { confirmed++; assert.match(body, /NOT establish Studist/); return false; },
      custom: async factory => {
        const component = factory({ terminal: { rows: 28 }, requestRender() {} }, { fg: (_color, text) => text }, {}, () => {});
        if (component.pages?.['Exact send preview']) preview = true;
        if (component.pages) return component.continueAction ? 'continue' : component.actions ? actions.shift() : 'close';
        // Delegate progress implementation to preceding working UI adapter.
        return currentUI.custom(factory);
      }
    }, 'tui');
    await session.prompt('/context-lens current');
    assert.ok(preview, JSON.stringify(notices)); assert.equal(confirmed, 1); assert.equal(modelCalls, 0);
    await t.test('Escape cancels AI sample preview without opening confirmation or invoking provider', async () => {
      actions.push('analyze', 'close');
      let cancelledPreview = false, confirmations = 0;
      runner.setUIContext({ ...currentUI, input: async () => 'Synthetic preview cancellation?', select: async (label, choices) => label.includes('dimension') ? 'sources' : choices[0], confirm: async () => { confirmations++; return true; }, custom: async factory => {
        let resolved;
        const component = factory({ terminal: { rows: 24 }, requestRender() {} }, { fg: (_c, text) => text }, {}, value => { resolved = value; });
        if (component.continueAction) {
          cancelledPreview = true;
          assert.ok(component.pages['AI sample']); assert.ok(component.pages['Exact send preview']);
          const text = component.render(42).join('\n');
          assert.match(text, /Enter Continue/); assert.match(text, /Esc Cancel/);
          component.handleInput('\x1b'); assert.equal(resolved, 'close');
          return resolved;
        }
        if (component.pages) return component.actions ? actions.shift() : 'close';
        for (let i = 0; resolved === undefined && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 1));
        component.dispose?.(); return resolved;
      } }, 'tui');
      await session.prompt('/context-lens current');
      assert.ok(cancelledPreview); assert.equal(confirmations, 0); assert.equal(modelCalls, 0);
      assert.deepEqual(session.sessionManager.getEntries(), before);
    });
    // Approved inference uses the supported registry adapter, with an entirely mocked provider.
    actions.push('analyze', 'close');
    let interpretationShown = false;
    runner.createContext().modelRegistry.streamSimple = (selectedModel, context, options) => {
      modelCalls++;
      assert.equal(selectedModel.id, 'synthetic-model'); assert.equal(options.maxRetries, 0);
      const payload = JSON.parse(context.messages[0].content[0].text);
      return { result: async () => ({ stopReason: 'stop', usage: { totalTokens: 7 }, content: [{ type: 'text', text: JSON.stringify({ answer: 'Synthetic interpretation', evidenceIds: [payload.snippets[0].id], classifications: payload.snippets.map(s => ({ id: s.id, label: 'useful-evidence', quote: s.text.slice(0, 10), reason: 'Synthetic explanation' })) }) }] }) };
    };
    runner.setUIContext({ ...currentUI,
      input: async () => 'What is useful?',
      select: async (label, choices) => label.includes('dimension') ? 'usefulness' : choices[0],
      confirm: async () => true,
      custom: async factory => {
        let resolved;
        const component = factory({ terminal: { rows: 28 }, requestRender() {} }, { fg: (_color, text) => text }, {}, value => { resolved = value; });
        if (component.pages) {
          if (component.pages.Interpretation) interpretationShown = true;
          return component.continueAction ? 'continue' : component.actions ? actions.shift() : 'close';
        }
        for (let i = 0; resolved === undefined && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 1));
        component.dispose?.(); return resolved;
      }
    }, 'tui');
    await session.prompt('/context-lens current');
    assert.ok(interpretationShown); assert.equal(modelCalls, 1);
    assert.deepEqual(session.sessionManager.getEntries(), before, 'even approved mocked analysis persists no text/results');
    // Escape from the actual progress component aborts a hanging mocked provider.
    actions.push('analyze', 'close');
    let cancelledSignal;
    runner.createContext().modelRegistry.streamSimple = (_m, _context, options) => {
      modelCalls++; cancelledSignal = options.signal;
      return { result: () => new Promise(() => {}) };
    };
    runner.setUIContext({ ...currentUI,
      input: async () => 'Synthetic cancellation?', select: async (label, choices) => label.includes('dimension') ? 'recovery' : choices[0], confirm: async () => true,
      custom: async factory => {
        let resolved;
        const component = factory({ terminal: { rows: 28 }, requestRender() {} }, { fg: (_c, text) => text }, {}, value => { resolved = value; });
        if (component.pages) return component.continueAction ? 'continue' : component.actions ? actions.shift() : 'close';
        const isAI = component.render(80).join(' ').includes('AI:');
        if (isAI) {
          for (let i = 0; !cancelledSignal && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 1));
          component.handleInput('\x1b');
        }
        for (let i = 0; resolved === undefined && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 1));
        component.dispose?.(); return resolved;
      }
    }, 'tui');
    await session.prompt('/context-lens current');
    assert.ok(cancelledSignal.aborted); assert.equal(modelCalls, 2);
    assert.match(notices.at(-1).text, /cancelled.*preserved/);
    assert.deepEqual(session.sessionManager.getEntries(), before);
    // Discovery and picker run only under synthetic, explicitly isolated roots.
    await mkdir(path.join(root, 'agent', 'sessions', 'project'), { recursive: true });
    await mkdir(path.join(root, 'extra'), { recursive: true });
    await writeFile(path.join(root, 'agent', 'sessions', 'project', 'a.jsonl'), jsonl(fixture('picker-a', '/synthetic/a')));
    await writeFile(path.join(root, 'extra', 'b.jsonl'), jsonl(fixture('picker-b', '/synthetic/b')));
    let pickerChecked = false;
    runner.setUIContext({ ...currentUI, custom: async factory => {
      let resolved;
      const component = factory({ terminal: { rows: 28 }, requestRender() {} }, { fg: (_c, text) => text }, {}, value => { resolved = value; });
      if (component.sessions) {
        pickerChecked = true;
        assert.equal(component.sessions.length, 3);
        component.focused = true; assert.equal(component.input.focused, true);
        component.handleInput('picker-a'); component.handleInput('\t');
        assert.equal(component.selected.size, 1);
        component.input.setValue('picker-b'); component.cursor = 0; component.handleInput('\t');
        assert.equal(component.selected.size, 2, 'selection preserved across search filters');
        const selectedView = component.render(80).join('\n');
        assert.match(selectedView, /Enter inspect selected/);
        assert.equal(selectedView.split('[x]').length - 1, 3, 'both selected names remain in tray even when only one matches');
        component.handleInput('\x13'); assert.equal(component.filtered().length, 2, 'Ctrl+S reviews all selected sessions across filters');
        component.handleInput('\x13');
        component.input.setValue('no-matches'); component.cursor = 0;
        assert.match(component.render(80).join('\n'), /No sessions match/);
        for (const width of [1, 20, 80]) component.render(width);
        component.handleInput('\x1b'); assert.equal(resolved, null);
        return null;
      }
      for (let i = 0; resolved === undefined && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 1));
      component.dispose?.(); return resolved;
    } }, 'tui');
    await session.prompt('/context-lens');
    assert.ok(pickerChecked); assert.equal(modelCalls, 2);
    await session.prompt('/context-lens clear');
    assert.match(notices.at(-1).text, /memory cleared/);
    assert.deepEqual(errors, []);
  } finally {
    session?.dispose();
    if (previousAgent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousAgent;
    if (previousSessions === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR; else process.env.PI_CODING_AGENT_SESSION_DIR = previousSessions;
    await rm(root, { recursive: true, force: true });
  }
});
