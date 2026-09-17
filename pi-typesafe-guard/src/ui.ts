import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Input, matchesKey, truncateToWidth } from '@earendil-works/pi-tui';
import { display } from './privacy.ts';

export async function secretInput(ctx: ExtensionContext): Promise<string | undefined> {
  // RPC input() has no secret/masking contract. Never send credentials through it.
  if (ctx.mode !== 'tui') return undefined;
  return ctx.ui.custom<string | undefined>((tui, _theme, _kb, done) => {
    let input: Input | undefined = new Input();
    const finish = (value?: string) => { input?.setValue(''); input = undefined; done(value); };
    input.onSubmit = value => finish(value.trim());
    input.onEscape = () => finish();
    return {
      render(width) {
        return ['TypeSafe API key (masked; not added to chat/history)',
          input?.getValue() ? '[key entered — hidden]' : '[paste or type key]',
          'Enter: submit · Escape/Ctrl+C: cancel'].map(line => truncateToWidth(line, width));
      },
      handleInput(data) {
        if (matchesKey(data, 'ctrl+c')) finish();
        else { input?.handleInput(data); tui.requestRender(); }
      },
      invalidate() {},
      dispose() { input?.setValue(''); input = undefined; },
    };
  });
}

export async function approve(ctx: ExtensionContext, summary: string, raw: string, critical: boolean, known: string[]): Promise<boolean> {
  if (!ctx.hasUI || ctx.signal?.aborted) return false;
  const text = display(raw, known);
  // Paginate instead of silently omitting a destructive suffix. Only the last
  // page offers approval, and every page defaults to Deny.
  const pages = text.match(/[\s\S]{1,3000}/g) ?? ['{}'];
  const deadline = AbortSignal.timeout(120_000);
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, deadline]) : deadline;
  let page = 0;
  while (!signal.aborted) {
    const last = page === pages.length - 1;
    const options = ['Deny', ...(page ? ['Previous page'] : []), last ? 'Allow once' : 'Next page'];
    const choice = await ctx.ui.select(
      `${summary}\n\nArguments (${page + 1}/${pages.length}; recognized secrets redacted):\n${pages[page]}\n\nApproval applies only to this exact call.`,
      options, { signal },
    );
    if (signal.aborted) return false;
    if (choice === 'Next page' && !last) page++;
    else if (choice === 'Previous page' && page > 0) page--;
    else if (choice === 'Allow once' && last) {
      if (!critical) return true;
      const typed = await ctx.ui.input('High-risk action: type ALLOW to execute once', '', { signal });
      return !signal.aborted && typed === 'ALLOW';
    } else return false;
  }
  return false;
}

export class Serial {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const work = this.tail.then(fn, fn);
    this.tail = work.catch(() => {});
    return work;
  }
}
