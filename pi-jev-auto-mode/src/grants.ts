import type { GatedCall } from "./call.ts";
import { isReadOnlyCommand } from "./policy.ts";

export type GrantLifetime = "session" | "project" | "global";

export type Grant =
  | {
      readonly kind: "exact-command";
      readonly command: string;
      readonly lifetime: "session";
    }
  | {
      readonly kind: "git-push";
      readonly lifetime: "session";
      readonly allowForce: false;
    }
  | {
      readonly kind: "outside-cwd-write";
      readonly lifetime: "session";
      readonly protectedPathsExcluded: true;
    };

export type PrototypeGrant = Grant;

export interface GrantMatch {
  readonly grant: Grant;
  readonly rationale: string;
}

const APPROVAL_WORDS = String.raw`(?:allow(?:ed|ing)?|approve(?:d|s)?|permit(?:ted)?|ok(?:ay)?|yes|go ahead|fine)`;
const NEGATED_APPROVAL = new RegExp(String.raw`\b(?:do not|don't|dont|never|no)\s+${APPROVAL_WORDS}\b`, "i");
const GIT_PUSH_APPROVAL = new RegExp(String.raw`\b${APPROVAL_WORDS}\b[\s\S]{0,80}\bgit\s+push\b|\bgit\s+push\b[\s\S]{0,80}\b${APPROVAL_WORDS}\b`, "i");
const OUTSIDE_WRITE_APPROVAL = new RegExp(
  String.raw`\b${APPROVAL_WORDS}\b[\s\S]{0,120}\b(?:edit|editing|write|writing|create|creating|modify|modifying)\b[\s\S]{0,80}\boutside\b[\s\S]{0,60}\b(?:dir|directory|repo|project|cwd|working directory)\b|\b(?:edit|editing|write|writing|create|creating|modify|modifying)\b[\s\S]{0,80}\boutside\b[\s\S]{0,60}\b(?:dir|directory|repo|project|cwd|working directory)\b[\s\S]{0,120}\b${APPROVAL_WORDS}\b`,
  "i",
);

export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

function hasNegatedApproval(text: string): boolean {
  return NEGATED_APPROVAL.test(text);
}

export function derivePrototypeGrantsFromUserIntent(intent: string): Grant[] {
  if (!intent.trim() || hasNegatedApproval(intent)) return [];

  const grants: Grant[] = [];
  if (GIT_PUSH_APPROVAL.test(intent)) {
    grants.push({
      kind: "git-push",
      lifetime: "session",
      allowForce: false,
    });
  }
  if (OUTSIDE_WRITE_APPROVAL.test(intent)) {
    grants.push({
      kind: "outside-cwd-write",
      lifetime: "session",
      protectedPathsExcluded: true,
    });
  }
  return grants;
}

function shellSegments(command: string): string[] {
  return command
    .split(/&&|;|\n/)
    .map((segment) => normalizeCommand(segment))
    .filter(Boolean);
}

function hasUnsupportedShellControl(command: string): boolean {
  return /\|\||\||[<>$`()\\]|(?:^|[^&])&(?!&)/.test(command);
}

function isGitPushSegment(segment: string): boolean {
  return /^git\s+push(?:\s|$)/i.test(segment);
}

function hasForcePushFlag(segment: string): boolean {
  return /(?:^|\s)(?:--force(?:-with-lease)?|--mirror|-[A-Za-z]*f[A-Za-z]*)(?:\s|$)/i.test(segment);
}

function isBenignGitCompanionSegment(segment: string): boolean {
  if (!/^git\s+/i.test(segment)) return false;
  if (isReadOnlyCommand(segment)) return true;
  if (/^git\s+add(?:\s|$)/i.test(segment)) return true;
  if (/^git\s+commit(?:\s|$)/i.test(segment)) return true;
  return false;
}

export function matchesGitPushOperation(command: string): boolean {
  if (hasUnsupportedShellControl(command)) return false;
  const segments = shellSegments(command);
  if (segments.length === 0) return false;
  const pushSegments = segments.filter(isGitPushSegment);
  if (pushSegments.length === 0) return false;
  if (pushSegments.some(hasForcePushFlag)) return false;
  return segments.every((segment) => isGitPushSegment(segment) || isBenignGitCompanionSegment(segment));
}

export function grantMatchesCall(grant: Grant, call: GatedCall): GrantMatch | undefined {
  switch (grant.kind) {
    case "exact-command":
      if (call.command !== undefined && normalizeCommand(call.command) === normalizeCommand(grant.command)) {
        return { grant, rationale: "A session grant exactly matches this command." };
      }
      return undefined;

    case "git-push":
      if (call.command !== undefined && matchesGitPushOperation(call.command)) {
        return {
          grant,
          rationale: "A session grant covers this non-force git push and its benign git companions.",
        };
      }
      return undefined;

    case "outside-cwd-write":
      if (
        (call.tool === "write" || call.tool === "edit") &&
        call.outsideCwd &&
        call.protectedReason === undefined
      ) {
        return {
          grant,
          rationale: "A session grant covers outside-cwd write/edit calls, excluding protected paths.",
        };
      }
      return undefined;
  }
}

export function firstMatchingGrant(call: GatedCall, grants: readonly Grant[]): GrantMatch | undefined {
  for (const grant of grants) {
    const match = grantMatchesCall(grant, call);
    if (match) return match;
  }
  return undefined;
}

export function grantsEqual(left: Grant, right: Grant): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "exact-command":
      return right.kind === "exact-command" && normalizeCommand(left.command) === normalizeCommand(right.command);
    case "git-push":
      return right.kind === "git-push";
    case "outside-cwd-write":
      return right.kind === "outside-cwd-write";
  }
}

export function rememberGrant(grants: readonly Grant[], grant: Grant): Grant[] {
  return [...grants.filter((entry) => !grantsEqual(entry, grant)), grant];
}

export function grantProposalsForCall(call: GatedCall): Grant[] {
  const proposals: Grant[] = [];
  if (call.command !== undefined) {
    proposals.push({
      kind: "exact-command",
      command: call.command,
      lifetime: "session",
    });
    if (matchesGitPushOperation(call.command)) {
      proposals.push({
        kind: "git-push",
        lifetime: "session",
        allowForce: false,
      });
    }
  }
  if ((call.tool === "write" || call.tool === "edit") && call.outsideCwd && call.protectedReason === undefined) {
    proposals.push({
      kind: "outside-cwd-write",
      lifetime: "session",
      protectedPathsExcluded: true,
    });
  }
  return proposals;
}

export function describeGrant(grant: Grant): string {
  switch (grant.kind) {
    case "exact-command":
      return `session exact command: ${grant.command}`;
    case "git-push":
      return "session operation: non-force git push";
    case "outside-cwd-write":
      return "session file scope: outside-cwd write/edit, protected paths excluded";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseGrant(value: unknown): Grant | undefined {
  if (!isRecord(value)) return undefined;
  if (value.lifetime !== "session") return undefined;

  if (value.kind === "exact-command" && typeof value.command === "string" && value.command.trim().length > 0) {
    return { kind: "exact-command", command: value.command, lifetime: "session" };
  }
  if (value.kind === "git-push" && value.allowForce === false) {
    return { kind: "git-push", lifetime: "session", allowForce: false };
  }
  if (value.kind === "outside-cwd-write" && value.protectedPathsExcluded === true) {
    return { kind: "outside-cwd-write", lifetime: "session", protectedPathsExcluded: true };
  }
  return undefined;
}
