import { getAgentDir, buildSessionProjection, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { rootsFor, discover, snapshot, LIMITS, checkAbort } from '../lib/discovery.mjs';
import { parseSnapshot, validateEntries, tipsOf, normalize, reportPages, largest, safe, title, CATEGORY_LABELS } from '../lib/core.mjs';
import { DIMENSIONS, prepareAnalysis, runAnalysis, analysisPages } from '../lib/analysis.mjs';
import { SessionPicker, ReportScreen, progress, type ReportState } from './ui.ts';
import { startDashboard } from '../lib/web.mjs';

export default function contextLens(pi: ExtensionAPI) {
  const controllers = new Set<AbortController>();
  let reports: any[] = [], selectionWarnings: string[] = [], aiPages: Record<string, any[]> = {}, busy = false;
  let dashboard: Awaited<ReturnType<typeof startDashboard>> | undefined;
  pi.registerFlag('context-lens-roots', { type: 'string', description: 'Additional session roots separated by platform path delimiter (: on macOS/Linux)' });
  pi.registerFlag('context-lens-no-open', { type: 'boolean', description: 'Print the private local dashboard link instead of opening a browser' });
  pi.on('session_shutdown', async () => {
    for (const c of controllers) c.abort(new Error('Session shutdown'));
    controllers.clear(); reports = []; aiPages = {};
    await dashboard?.close(); dashboard = undefined;
  });
  const screen = (ctx: any, pages: Record<string, any[]>, actions = true, state?: ReportState, continueAction = false) => ctx.ui.custom((tui: any, theme: any, _kb: any, done: any) => new ReportScreen(pages, tui, theme, done, actions, state, continueAction));

  function captureCurrent(ctx: any) {
    // Synchronous capture: no yield between entries and authoritative in-process leaf.
    const entries = ctx.sessionManager.getEntries();
    const leafId = ctx.sessionManager.getLeafId();
    const header = ctx.sessionManager.getHeader() || { type: 'session', version: 3, id: ctx.sessionManager.getSessionId(), cwd: ctx.cwd };
    if (entries.length > LIMITS.entries) throw new Error('Current session exceeds entry limit');
    const raw = JSON.stringify(entries);
    if (Buffer.byteLength(raw) > LIMITS.fileBytes) throw new Error('Current session exceeds 32 MiB memory snapshot limit');
    const warnings: string[] = [];
    return { header: structuredClone(header), entries: validateEntries(JSON.parse(raw), warnings), leafId, sourcePath: ctx.sessionManager.getSessionFile(), capturedAt: new Date().toISOString(), bytes: Buffer.byteLength(raw), warnings, name: ctx.sessionManager.getSessionName() || 'Current session' };
  }

  async function openDashboard(ctx: any, currentOnly: boolean) {
    if (!dashboard) dashboard = await startDashboard({
      roots: rootsFor(getAgentDir(), ctx.sessionManager.getSessionDir(), process.env.PI_CODING_AGENT_SESSION_DIR, String(pi.getFlag('context-lens-roots') || '')),
      currentInfo: () => ({ id: ctx.sessionManager.getSessionId(), name: ctx.sessionManager.getSessionName() || 'Current session', cwd: ctx.cwd, path: ctx.sessionManager.getSessionFile(), model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined, modified: new Date().toISOString() }),
      captureCurrent: () => captureCurrent(ctx), project: buildSessionProjection,
      getModel: () => ctx.model,
      invoke: (model: any, context: any, options: any) => ctx.modelRegistry.streamSimple(model, context, options).result()
    });
    const url = dashboard.url + (currentOnly ? '&current=1' : '');
    if (!pi.getFlag('context-lens-no-open')) {
      try {
        // Fixed OS browser opener; the only argument is our generated loopback capability URL.
        const result = process.platform === 'darwin' ? await pi.exec('open', [url], { timeout: 5000 })
          : process.platform === 'win32' ? await pi.exec('rundll32', ['url.dll,FileProtocolHandler', url], { timeout: 5000 })
          : await pi.exec('xdg-open', [url], { timeout: 5000 });
        if (result.code === 0) { ctx.ui.notify('Context Lens opened in your browser. Inspection stays local; AI requires separate approval.', 'info'); return; }
      } catch { /* Keep the listener available and offer a manual link. */ }
    }
    ctx.ui.notify(`Context Lens private local link (keep it private while Pi is running): ${url}`, 'info');
  }

  async function analyze(ctx: any) {
    if (!ctx.model) return ctx.ui.notify('No active model selected; local report unchanged.', 'error');
    const model = ctx.model;
    const question = await ctx.ui.input('Investigation question (1–1,000 chars)', 'What evidence dominates, and what appears repetitive?');
    if (!question) return;
    const dimension = await ctx.ui.select('Analysis dimension (fixed, validated labels)', Object.keys(DIMENSIONS));
    if (!dimension) return;
    const plan = prepareAnalysis(reports, question, dimension, model);
    const next = await screen(ctx, { 'AI sample': [
      { text: `Nothing sent yet. Review the sample, then Enter to continue or Esc to cancel.` },
      { text: `Provider/model: ${model.provider}/${model.id}. Virtual/custom routes may choose the physical model.` },
      { text: `Question: ${question}` }, { text: `Investigate: ${dimension}` },
      ...plan.sessions.map((s: string) => ({ text: s })),
      { text: `${plan.snippets.length} snippets · ${plan.bytes} input bytes · ${plan.omittedParts} parts omitted · ${plan.truncatedParts} truncated · max ${plan.maxTokens} output tokens · one request.` },
      { text: 'AI sends this sample through the configured provider unless actually local inference. Approval is next; no automatic compliance is implied.' },
      ...plan.snippets.flatMap((part: any, i: number) => [
        { text: '' }, { text: `${i + 1}. ${CATEGORY_LABELS[part.category] || part.category} · user turn ${part.turn} · ${part.id}` },
        ...part.text.split('\n').map((text: string) => ({ text }))
      ])
    ], 'Exact send preview': [
      { text: `Configured route: ${model.provider}/${model.id}. A virtual/custom route may choose the physical model.` },
      ...plan.sessions.map((s: string) => ({ text: s })),
      { text: `${plan.snippets.length} snippets · ${plan.bytes} UTF-8 bytes including instructions · ${plan.omittedParts} parts omitted · ${plan.truncatedParts} truncated · one request · max output ${plan.maxTokens} · 90s timeout.` },
      { text: 'The following is the exact prompt text; no images/opaque signatures/arbitrary details are included.' },
      { text: plan.systemPrompt }, { text: plan.userText }
    ] }, false, undefined, true);
    if (next !== 'continue') return;
    const approved = await ctx.ui.confirm(`Send selected sample to ${safe(model.provider)}/${safe(model.id)}?`, `${plan.sessions.map(safe).join('\n')}\n${plan.snippets.length} snippets, ${plan.bytes} input bytes; ${plan.omittedParts} omitted, ${plan.truncatedParts} truncated. One request, max ${plan.maxTokens} output tokens.\nAI analysis sends selected content to this configured provider unless actually local inference. A configured virtual/custom route may route internally. Access is not transmission authorization. This does NOT establish Studist policy compliance. Confirm only if this provider is approved for EACH session's information class. Results stay in extension memory, not appended to the Pi conversation.`);
    if (!approved) return;
    const response: any = await progress(ctx, `AI: ${model.provider}/${model.id} · ${plan.snippets.length} snippets · Esc aborts`, signal => runAnalysis(plan, { approved: true, signal, invoke: (m: any, context: any, options: any) => ctx.modelRegistry.streamSimple(m, context, options).result() }), controllers);
    if (response.cancelled) return ctx.ui.notify('Analysis cancelled; local reports preserved.', 'info');
    if (response.error) throw response.error;
    aiPages = analysisPages(response.value, plan);
    await screen(ctx, aiPages, false);
  }

  async function detail(ctx: any) {
    const parts = reports.flatMap(r => largest(r).slice(0, 30));
    if (!parts.length) return ctx.ui.notify('No recorded content parts.', 'info');
    const labels = parts.map((p, i) => safe(`${i + 1}. ${title(reports.find(r => r.snapshot.header.id === p.sessionId))} · user turn ${p.turn} · ${CATEGORY_LABELS[p.category]} · ~${p.estimatedTokens} units`));
    const choice = await ctx.ui.select('Local contributor detail (top 30 per session)', labels);
    if (!choice) return;
    const part = parts[labels.indexOf(choice)];
    await screen(ctx, { 'Local evidence': [
      { text: `${part.id} · user turn ${part.turn} · ${part.timestamp || '?'} · role ${part.role} · type ${part.kind} · tool ${part.toolName || '—'}` },
      { text: `Local preview capped at 16,000 chars; original ${part.chars} chars / ${part.bytes} UTF-8 bytes. Nothing sent.` },
      ...part.text.slice(0, 16000).split('\n').map((text: string) => ({ text })),
      ...(part.chars > 16000 ? [{ text: '(Local preview truncated.)' }] : [])
    ] }, false);
  }

  pi.registerCommand('context-lens', {
    description: 'Open local HTML session dashboard; optional approved Pi-model investigation (current | tui [current] | clear)',
    handler: async (args, ctx) => {
      if (args.trim() === 'clear') {
        for (const c of controllers) c.abort(new Error('Context Lens cleared'));
        reports = []; aiPages = {}; selectionWarnings = [];
        await dashboard?.close(); dashboard = undefined;
        ctx.ui.notify('Context Lens memory cleared; browser access revoked. Close any terminal screen with Esc.', 'info'); return;
      }
      if (ctx.mode !== 'tui') { ctx.ui.notify('Context Lens requires interactive Pi mode. No sessions read or sent.', 'warning'); return; }
      if (busy) { ctx.ui.notify('Context Lens terminal workflow is already open.', 'warning'); return; }
      const command = args.trim().replace(/\s+/g, ' ');
      if (!['', 'current', 'tui', 'tui current'].includes(command)) { ctx.ui.notify('Usage: /context-lens [current|tui [current]|clear]', 'warning'); return; }
      if (!command.startsWith('tui')) {
        try { await openDashboard(ctx, command === 'current'); }
        catch (error: any) { ctx.ui.notify(safe(`Context Lens: ${error.message}. Use /context-lens tui as a fallback.`), 'error'); }
        return;
      }
      const currentOnly = command === 'tui current';
      busy = true;
      try {
        const currentPath = ctx.sessionManager.getSessionFile();
        const current = { key: 'current:memory', current: true, path: currentPath, id: ctx.sessionManager.getSessionId(), name: ctx.sessionManager.getSessionName() || 'Current session', cwd: ctx.cwd, model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined, modified: new Date().toISOString() };
        let selected = [current];
        selectionWarnings = [];
        if (!currentOnly) {
          const roots = rootsFor(getAgentDir(), ctx.sessionManager.getSessionDir(), process.env.PI_CODING_AGENT_SESSION_DIR, String(pi.getFlag('context-lens-roots') || ''));
          const result: any = await progress(ctx, 'Discovering session metadata only…', (signal, update) => discover(roots, { signal, onProgress: update }), controllers);
          if (result.cancelled) return;
          if (result.error) throw result.error;
          selectionWarnings = result.value.warnings;
          if (selectionWarnings.length) ctx.ui.notify(safe(selectionWarnings.slice(0, 4).join('\n')), 'warning');
          const sessions = [current, ...result.value.sessions.filter((s: any) => s.path !== currentPath).map((s: any) => ({ ...s, key: s.path }))];
          selected = await ctx.ui.custom((tui, theme, _kb, done) => new SessionPicker(sessions, tui, theme, done));
          if (!selected?.length) return;
        }
        const scopes = ['Retained context — summaries and kept messages (not exact requests)', 'Selected branch — original messages, including summarized ones', 'All branches — includes abandoned alternatives, not one conversation'];
        const scopeLabel = await ctx.ui.select('What should we inspect?', scopes);
        if (!scopeLabel) return;
        const scope = ['context', 'branch', 'history'][scopes.indexOf(scopeLabel)];
        const loaded: any = await progress(ctx, 'Snapshotting selected sessions readonly…', async (signal, update) => {
          const snapshots: any[] = [];
          let bytes = 0;
          for (const s of selected) {
            checkAbort(signal); update(`Snapshot ${snapshots.length + 1}/${selected.length}: ${safe(s.name || s.id)}`);
            try {
              const snap = s.current ? captureCurrent(ctx) : parseSnapshot(await snapshot(s.path, { signal, maxBytes: LIMITS.totalBytes - bytes }));
              bytes += snap.bytes;
              if (bytes > LIMITS.totalBytes) throw new Error('Combined snapshots exceed 64 MiB');
              if (snapshots.some(other => other.header.id === snap.header.id)) throw new Error('Duplicate session ID among selected files; select only one copy');
              snap.name = s.name || snap.name;
              snapshots.push(snap);
            } catch (e: any) { checkAbort(signal); selectionWarnings.push(`${s.id}: ${e.message}`); }
          }
          return snapshots;
        }, controllers);
        if (loaded.cancelled) return;
        if (loaded.error) throw loaded.error;
        if (!loaded.value.length) { ctx.ui.notify(safe(`No readable sessions. ${selectionWarnings.join('; ')}`), 'warning'); return; }
        if (loaded.value.length === 1 && scope !== 'history') {
          const snap = loaded.value[0], tips = tipsOf(snap.entries).filter((e: any) => e.id !== snap.leafId);
          if (tips.length) {
            const choices = [safe(`Keep selected branch (ends at ${snap.leafId ?? 'start'})`), ...tips.map((e: any, i: number) => safe(`${i + 1}. Other branch ending at ${e.id} · ${e.timestamp || '?'}`))];
            const choice = await ctx.ui.select('Choose a branch — past-session selection is inferred', choices);
            if (!choice) return;
            if (choices.indexOf(choice) > 0) snap.leafId = tips[choices.indexOf(choice) - 1].id;
          }
        }
        reports = []; aiPages = {};
        for (const snap of loaded.value) {
          try { reports.push(normalize(snap, scope, buildSessionProjection)); }
          catch (e: any) { selectionWarnings.push(`${snap.header.id}: ${e.message}`); }
        }
        if (!reports.length) { ctx.ui.notify(safe(`No analyzable sessions. ${selectionWarnings.join('; ')}`), 'warning'); return; }
        const reportState: ReportState = { offsets: {} };
        while (true) {
          const action = await screen(ctx, { ...reportPages(reports, selectionWarnings), ...aiPages }, true, reportState);
          if (action === 'close') break;
          try { if (action === 'analyze') await analyze(ctx); else if (action === 'detail') await detail(ctx); }
          catch (e: any) { ctx.ui.notify(safe(`Context Lens: ${e.message}. Local reports retained.`), 'error'); }
        }
      } catch (e: any) { ctx.ui.notify(safe(`Context Lens: ${e.message}`), 'error'); }
      finally { busy = false; }
    }
  });
}
