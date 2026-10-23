import { Input, matchesKey, truncateToWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui';
import { filterSessions, LIMITS } from '../lib/discovery.mjs';
import { safe, CATEGORIES, COLORS } from '../lib/core.mjs';

export class SessionPicker {
  input = new Input({ prompt: 'Search: ', placeholder: 'name / project / date / model' });
  selected = new Set<string>();
  cursor = 0;
  message = '';
  selectedOnly = false;
  constructor(public sessions: any[], public tui: any, public theme: any, public done: (value: any) => void) {}
  get focused() { return this.input.focused; }
  set focused(value: boolean) { this.input.focused = value; }
  invalidate() { this.input.invalidate(); }
  filtered() { return this.selectedOnly ? this.sessions.filter(s => this.selected.has(s.key)) : filterSessions(this.sessions, this.input.getValue()); }
  handleInput(data: string) {
    const items = this.filtered();
    if (matchesKey(data, 'escape')) return this.done(null);
    if (matchesKey(data, 'enter')) {
      if (!this.selected.size && items[this.cursor]) this.selected.add(items[this.cursor].key);
      if (this.selected.size) return this.done(this.sessions.filter(s => this.selected.has(s.key)));
    } else if (matchesKey(data, 'ctrl+s')) {
      this.selectedOnly = !this.selectedOnly; this.cursor = 0;
    } else if (matchesKey(data, 'tab')) {
      this.message = '';
      const key = items[this.cursor]?.key;
      if (key) {
        if (this.selected.has(key)) this.selected.delete(key);
        else if (this.selected.size < LIMITS.selections) this.selected.add(key);
        else this.message = `Maximum ${LIMITS.selections} sessions.`;
      }
    } else if (matchesKey(data, 'up')) this.cursor = Math.max(0, this.cursor - 1);
    else if (matchesKey(data, 'down')) this.cursor = Math.min(items.length - 1, this.cursor + 1);
    else {
      if (this.selectedOnly) { this.selectedOnly = false; this.input.setValue(''); }
      this.input.handleInput(data); this.cursor = 0;
    }
    this.tui.requestRender();
  }
  render(width: number) {
    width = Math.max(1, width);
    const items = this.filtered(), selected = this.sessions.filter(s => this.selected.has(s.key));
    this.cursor = Math.max(0, Math.min(this.cursor, items.length - 1));
    const footer = (width < 24 ? ['Tab select · Enter inspect', 'Ctrl+S selected · Esc cancel'] : [`Tab select · Enter inspect ${selected.length ? 'selected' : 'highlighted'}`, `Ctrl+S ${this.selectedOnly ? 'browse all' : 'review selected'} · Esc cancel`]).flatMap(s => wrapTextWithAnsi(s, width));
    const lines = [this.theme.fg('accent', 'Context Lens — LOCAL session selection'), ...this.input.render(width), `Selected (${selected.length}/${LIMITS.selections}):${selected.length ? '' : ' none'}`, ...(this.selectedOnly ? [] : selected.map(s => `  [x] ${safe(s.name || s.id)}`)), this.selectedOnly ? 'Selected only' : `${items.length} matches · sampled metadata`];
    const count = Math.max(1, Math.min(8, Math.floor(((this.tui.terminal.rows || 28) - 8 - lines.length - footer.length) / 2)));
    const start = Math.max(0, this.cursor - count + 1);
    for (let i = start; i < Math.min(items.length, start + count); i++) {
      const s = items[i];
      const mark = `${i === this.cursor ? '>' : ' '} [${this.selected.has(s.key) ? 'x' : ' '}]`;
      lines.push(`${mark} ${safe(s.name || s.id)} ${s.current ? '(CURRENT)' : ''}`);
      lines.push(`      ${safe((s.modified || s.created || '?').slice(0, 10))} · ${safe(s.cwd || '?')}`);
    }
    if (!items.length) lines.push(this.selectedOnly ? 'No selected sessions. Ctrl+S to browse.' : 'No sessions match. Edit search or Esc to close.');
    const highlighted = items[this.cursor];
    if (highlighted) lines.push(`Model: ${safe(highlighted.model || 'unavailable')} · ID: ${safe(highlighted.id)}`);
    if (this.message) lines.push(this.message);
    return [...lines.map(line => truncateToWidth(line, width)), ...footer];
  }
}

export type ReportState = { page?: string; offsets: Record<string, number> };

export class ReportScreen {
  tab = 0;
  offset = 0;
  viewportHeight = 10;
  cache: { key: string; lines: string[] } | undefined;
  constructor(public pages: Record<string, any[]>, public tui: any, public theme: any, public done: (value: any) => void, public actions = true, public state: ReportState = { offsets: {} }, public continueAction = false) {
    const names = Object.keys(pages);
    this.tab = Math.max(0, names.indexOf(state.page || names[0]));
    this.offset = state.offsets[names[this.tab]] || 0;
  }
  invalidate() { this.cache = undefined; }
  remember() { this.state.page = Object.keys(this.pages)[this.tab]; this.state.offsets[this.state.page!] = this.offset; }
  height() { return this.viewportHeight; }
  handleInput(data: string) {
    const names = Object.keys(this.pages);
    this.remember();
    if (matchesKey(data, 'escape') || data === 'q') return this.done('close');
    if (this.continueAction && matchesKey(data, 'enter')) return this.done('continue');
    if (this.actions && data === 'a') return this.done('analyze');
    if (this.actions && data === 'd') return this.done('detail');
    if (matchesKey(data, 'tab') || matchesKey(data, 'right')) { this.tab = (this.tab + 1) % names.length; this.offset = this.state.offsets[names[this.tab]] || 0; }
    else if (matchesKey(data, 'left')) { this.tab = (this.tab + names.length - 1) % names.length; this.offset = this.state.offsets[names[this.tab]] || 0; }
    else if (matchesKey(data, 'up')) this.offset = Math.max(0, this.offset - 1);
    else if (matchesKey(data, 'down')) this.offset++;
    else if (matchesKey(data, 'pageUp')) this.offset = Math.max(0, this.offset - this.height());
    else if (matchesKey(data, 'pageDown')) this.offset += this.height();
    else if (matchesKey(data, 'home')) this.offset = 0;
    else if (matchesKey(data, 'end')) this.offset = Number.MAX_SAFE_INTEGER;
    this.remember();
    this.tui.requestRender();
  }
  render(width: number) {
    width = Math.max(1, width);
    const names = Object.keys(this.pages), name = names[this.tab], key = `${this.tab}/${width}`;
    if (this.cache?.key !== key) {
      const lines: string[] = [];
      for (const row of this.pages[name]) {
        const color = COLORS[CATEGORIES.indexOf(row.category)] || 'text';
        for (const line of wrapTextWithAnsi(safe(row.text), width)) lines.push(this.theme.fg(color, line));
      }
      this.cache = { key, lines };
    }
    const budget = Math.max(4, (this.tui.terminal.rows || 28) - 7);
    const heading = width < 40 ? `${name} · ${this.tab + 1}/${names.length}` : `Context Lens · ${name} (${this.tab + 1}/${names.length})`;
    const navigation = names.length > 1 ? (width < 32 ? ['←/→ tabs', '↑/↓ scroll'] : ['←/→ tabs · ↑/↓ scroll']) : ['↑/↓ scroll'];
    const actionLabels = this.continueAction ? ['Enter Continue', 'Esc Cancel'] : this.actions ? (width < 32 ? ['A AI analysis', 'D evidence', 'Esc back'] : ['A AI analysis · D evidence', 'Esc back']) : ['Esc back'];
    const footer = [...navigation, ...actionLabels].flatMap(s => wrapTextWithAnsi(s, width)).slice(0, Math.max(1, budget - 3));
    const header = [this.theme.fg('accent', heading)];
    if (width >= 80 && names.length > 1) header.push(names.map((n, i) => i === this.tab ? `[${n}]` : n).join(' | '));
    const lines = this.cache!.lines;
    this.viewportHeight = Math.max(1, budget - header.length - footer.length - 1);
    this.offset = Math.min(this.offset, Math.max(0, lines.length - this.viewportHeight));
    this.remember();
    return [...header, `${lines.length ? this.offset + 1 : 0}–${Math.min(this.offset + this.viewportHeight, lines.length)}/${lines.length} lines`, ...lines.slice(this.offset, this.offset + this.viewportHeight), ...footer].map(s => truncateToWidth(s, width));
  }
}

export async function progress(ctx: any, label: string, work: (signal: AbortSignal, update: (text: string) => void) => Promise<any>, controllers: Set<AbortController>) {
  return ctx.ui.custom((tui: any, theme: any, _kb: any, done: any) => {
    const controller = new AbortController();
    controllers.add(controller);
    let settled = false, status = label;
    const finish = (result: any) => { if (!settled) { settled = true; done(result); } };
    Promise.resolve().then(() => work(controller.signal, text => { if (!settled) { status = text; tui.requestRender(); } }))
      .then(value => finish({ value }), error => finish({ error }))
      .finally(() => controllers.delete(controller));
    return {
      render: (width: number) => [theme.fg('accent', 'Context Lens'), safe(status), 'Working… Esc cancels; local reports remain available.'].map(line => truncateToWidth(line, Math.max(1, width))),
      invalidate() {},
      handleInput(data: string) { if (matchesKey(data, 'escape')) { controller.abort(new Error('Cancelled')); finish({ cancelled: true }); } },
      dispose() { controller.abort(new Error('UI closed')); controllers.delete(controller); }
    };
  });
}
