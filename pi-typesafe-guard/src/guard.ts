import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { createHash } from 'node:crypto';
import { assess, canonicalPath, normalizePath, type Call, type Metadata } from './policy.ts';
import { display } from './privacy.ts';
import { evaluate, riskSummary, TypeSafeError, type Signals } from './typesafe.ts';
import { approve } from './ui.ts';

export const blocked = (reason: string) => ({ block: true as const, reason, terminate: true });
export interface GuardOptions {
  builtin: boolean;
  origin?: string;
  key?: string;
  remoteEnabled: boolean;
  evaluate?: (metadata: Metadata, key: string, signal?: AbortSignal) => Promise<Signals>;
  approve?: typeof approve;
}
export async function guard(call: Call, ctx: ExtensionContext, options: GuardOptions) {
  try {
    if (ctx.signal?.aborted) return blocked('Guard: cancelled');
    const raw = JSON.stringify(call.input);
    if (raw.length > 64_000) return blocked('Guard: tool arguments exceed 64,000 characters; split the action for review.');
    const original = JSON.stringify(call);
    const captureTarget = async () => {
      if (typeof call.input.path !== 'string') return undefined;
      try { return await canonicalPath(normalizePath(call.input.path, ctx.cwd)); }
      catch { return null; }
    };
    const targetBefore = await captureTarget();
    const known = options.key ? [options.key] : [];
    const local = await assess(call, ctx.cwd, options.builtin, options.origin, known);
    if (!local.ask) return ctx.signal?.aborted ? blocked('Guard: cancelled') : undefined;
    if (!ctx.hasUI) return blocked('Guard: human approval required; no UI. Run interactively.');
    let advisory = 'TypeSafe is not enabled; local human-review policy remains active.';
    if (options.remoteEnabled && options.key) {
      try {
        advisory = riskSummary(await (options.evaluate ?? evaluate)(local.metadata, options.key, ctx.signal));
      } catch (error) {
        advisory = error instanceof TypeSafeError ? error.message : 'TypeSafe check failed; human review required.';
      }
    }
    if (ctx.signal?.aborted) return blocked('Guard: cancelled');
    const hash = createHash('sha256').update(original).digest('hex').slice(0, 12);
    const summary = `TypeSafe Guard — ${display(call.toolName, known)} [${hash}]\n${local.reasons.join('\n')}\n${advisory}`;
    const allowed = await (options.approve ?? approve)(ctx, summary, raw, local.critical, known);
    if (ctx.signal?.aborted || !allowed) return blocked('Guard: action denied, cancelled, or approval expired. Do not retry by changing tools.');
    if (JSON.stringify(call) !== original) return blocked('Guard: arguments changed during review. Submit a new call.');
    if (await captureTarget() !== targetBefore) return blocked('Guard: resolved target changed during review. Submit a new call.');
    return ctx.signal?.aborted ? blocked('Guard: cancelled') : undefined;
  } catch {
    return blocked('Guard: internal safety check failed; action blocked.');
  }
}
