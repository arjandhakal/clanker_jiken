// Heuristics, not a general DLP engine. Never send arbitrary strings to TypeSafe.
const patterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]+)/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /\b(?:authorization|api[_-]?key|access[_-]?token|password|secret)\s*["']?\s*[:=]\s*["']?[^\s,"'}]+/gi,
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /https?:\/\/[^\s/@:]+:[^\s/@]+@/gi,
];
export function redact(text: string, known: readonly string[] = []): string {
  let result = text;
  for (const value of known) if (value) result = result.split(value).join('[REDACTED]');
  for (const pattern of patterns) result = result.replace(pattern, '[REDACTED]');
  return result;
}
export function hasSecret(text: string, known: readonly string[] = []): boolean {
  return redact(text, known) !== text;
}
export function display(text: string, known: readonly string[] = []): string {
  return redact(text, known).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, c =>
    `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
export function sensitivePath(path: string): boolean {
  return /(?:^|[/\\])(?:\.env(?:\.[^/\\]*)?|\.ssh|\.aws|\.gnupg|\.azure|\.kube|\.npmrc|\.netrc|\.git-credentials|auth\.json|credentials(?:\.json)?|id_rsa|id_ed25519|[^/\\]*\.(?:pem|key|p12|pfx))(?:[/\\]|$)/i.test(path);
}
export function protectedPath(path: string): boolean {
  return sensitivePath(path) || /(?:^|[/\\])(?:\.pi|\.agents|\.git|pi-typesafe-guard)(?:[/\\]|$)/i.test(path);
}
