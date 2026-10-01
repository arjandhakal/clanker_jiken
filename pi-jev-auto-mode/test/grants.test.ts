import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildGatedCall, type ToolCallEventLike } from "../src/call.ts";
import {
  derivePrototypeGrantsFromUserIntent,
  firstMatchingGrant,
  grantProposalsForCall,
  matchesGitPushOperation,
  normalizeCommand,
  parseGrant,
  type Grant,
} from "../src/grants.ts";

const CWD = "/Users/dev/project";

function gated(event: ToolCallEventLike) {
  const call = buildGatedCall(event, { cwd: CWD });
  assert.ok(call, "expected a gated call");
  return call;
}

function bash(command: string): ToolCallEventLike {
  return { toolName: "bash", input: { command } };
}

function write(path: string): ToolCallEventLike {
  return { toolName: "write", input: { path, content: "x" } };
}

function edit(path: string): ToolCallEventLike {
  return { toolName: "edit", input: { path, edits: [{ oldText: "a", newText: "b" }] } };
}

describe("permission grants", () => {
  it("remembers an exact command but nothing broader", () => {
    const grant: Grant = {
      kind: "exact-command",
      command: "npm run test -- test/a.test.ts",
      lifetime: "session",
    };

    assert.equal(firstMatchingGrant(gated(bash("npm   run test --   test/a.test.ts")), [grant])?.grant, grant);
    assert.equal(firstMatchingGrant(gated(bash("npm run test -- test/b.test.ts")), [grant]), undefined);
  });

  it("can infer a non-force git push session grant in prototype-only intent tests", () => {
    const grants = derivePrototypeGrantsFromUserIntent("I allowed git push for this session; stop asking.");

    assert.equal(grants.length, 1);
    assert.equal(grants[0]?.kind, "git-push");
    assert.equal(firstMatchingGrant(gated(bash("git push")), grants)?.grant, grants[0]);
    assert.equal(firstMatchingGrant(gated(bash("git push origin HEAD")), grants)?.grant, grants[0]);
    assert.equal(firstMatchingGrant(gated(bash("git add src/index.ts && git commit -m ok && git push")), grants)?.grant, grants[0]);
  });

  it("does not let a git-push grant cover force, unrelated, or shell-smuggled commands", () => {
    const grants = derivePrototypeGrantsFromUserIntent("okay to git push");

    assert.equal(firstMatchingGrant(gated(bash("git push --force")), grants), undefined);
    assert.equal(firstMatchingGrant(gated(bash("git push --mirror")), grants), undefined);
    assert.equal(firstMatchingGrant(gated(bash("npm publish")), grants), undefined);
    assert.equal(firstMatchingGrant(gated(bash("git push && npm publish")), grants), undefined);
    assert.equal(firstMatchingGrant(gated(bash("git push || npm publish")), grants), undefined);
    assert.equal(firstMatchingGrant(gated(bash("git push | npm publish")), grants), undefined);
  });

  it("limits git-push companions to benign git commands", () => {
    assert.equal(matchesGitPushOperation("git status && git push"), true);
    assert.equal(matchesGitPushOperation("ls && git push"), false);
  });

  it("can infer an outside-cwd edit grant while preserving protected path checks", () => {
    const grants = derivePrototypeGrantsFromUserIntent("Editing files outside the directory is allowed for this task.");

    assert.equal(grants.length, 1);
    assert.equal(grants[0]?.kind, "outside-cwd-write");
    assert.equal(firstMatchingGrant(gated(write("../shared/config.ts")), grants)?.grant, grants[0]);
    assert.equal(firstMatchingGrant(gated(edit("/tmp/generated/report.md")), grants)?.grant, grants[0]);
    assert.equal(firstMatchingGrant(gated(write("../.ssh/id_ed25519")), grants), undefined);
  });

  it("does not infer grants from negated approvals", () => {
    assert.deepEqual(derivePrototypeGrantsFromUserIntent("do not allow git push"), []);
    assert.deepEqual(derivePrototypeGrantsFromUserIntent("never allow editing outside the directory"), []);
  });

  it("proposes prompt choices for exact commands, git-push operations, and outside-cwd files", () => {
    const pushProposals = grantProposalsForCall(gated(bash("git push origin HEAD")));
    assert.deepEqual(pushProposals.map((proposal) => proposal.kind), ["exact-command", "git-push"]);

    const fileProposals = grantProposalsForCall(gated(write("../shared/config.ts")));
    assert.deepEqual(fileProposals.map((proposal) => proposal.kind), ["outside-cwd-write"]);
  });

  it("parses only valid stored session grants", () => {
    assert.deepEqual(parseGrant({ kind: "git-push", lifetime: "session", allowForce: false }), {
      kind: "git-push",
      lifetime: "session",
      allowForce: false,
    });
    assert.equal(parseGrant({ kind: "git-push", lifetime: "session", allowForce: true }), undefined);
    assert.equal(parseGrant({ kind: "outside-cwd-write", lifetime: "session" }), undefined);
  });

  it("normalizes exact command whitespace for comparison", () => {
    assert.equal(normalizeCommand(" npm   run   test\n"), "npm run test");
  });
});
