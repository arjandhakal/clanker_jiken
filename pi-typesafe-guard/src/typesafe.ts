import type { Metadata } from './policy.ts';

export const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const QUESTIONS = {
  destructive: { type: 'noul', instructions: 'Given only the limited action metadata in state, could this action permanently delete data or destroy a project?' },
  unrelated_github: { type: 'noul', instructions: 'Could this action mutate GitHub resources outside the current repository, based on the scope evidence in state?' },
  other_author: { type: 'noul', instructions: 'Could this action modify another person’s PR or issue without verified authorship/authority? Unknown authorship is not permission.' },
  secret_exposure: { type: 'noul', instructions: 'Could this action expose credentials or private data through network transfer, publication, or credential access?' },
  uncertainty: { type: 'noul', instructions: 'Is the action metadata insufficient to establish the exact effects and authorization of this action?' },
} as const;
export type Risk = keyof typeof QUESTIONS;
export type Signals = Record<Risk, number>;
export class TypeSafeError extends Error {
  constructor(message: string) { super(message); this.name = 'TypeSafeError'; }
}
export function parseSignals(data: unknown): Signals {
  const answers = (data as { answers?: Record<string, { type?: unknown; noul?: unknown }> })?.answers;
  if (!answers || typeof answers !== 'object') throw new TypeSafeError('Malformed TypeSafe response');
  const result = {} as Signals;
  for (const key of Object.keys(QUESTIONS) as Risk[]) {
    const answer = answers[key];
    if (answer?.type !== 'noul' || typeof answer.noul !== 'number' || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1)
      throw new TypeSafeError('Incomplete or invalid TypeSafe risk signals');
    result[key] = answer.noul;
  }
  return result;
}
export async function evaluate(metadata: Metadata, key: string, signal?: AbortSignal, request = fetch, timeoutMs = 6000): Promise<Signals> {
  const deadline = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  combined.throwIfAborted();
  try {
    const response = await request(ENDPOINT, {
      method: 'POST', redirect: 'error', signal: combined,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'jev-latest', state: metadata, questions: QUESTIONS }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new TypeSafeError(`TypeSafe HTTP ${response.status}; human review required`);
    }
    if (!response.body) throw new TypeSafeError('Empty TypeSafe response');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        combined.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 32_768) throw new TypeSafeError('Oversized TypeSafe response');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    return parseSignals(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch (error) {
    if (error instanceof TypeSafeError) throw error;
    // Do not echo fetch errors, headers, bodies, keys, or parsing fragments.
    throw new TypeSafeError(combined.aborted ? 'TypeSafe check cancelled or timed out' : 'TypeSafe unavailable or malformed response');
  }
}
export function riskSummary(signals: Signals): string {
  const flags = (Object.keys(signals) as Risk[]).filter(k => signals[k] >= 0.2);
  return flags.length ? `TypeSafe advisory (>=20%): ${flags.map(k => `${k} ${Math.round(signals[k] * 100)}%`).join(', ')}`
    : 'TypeSafe: low risk signals. This is NOT authorization; local approval is still required.';
}
