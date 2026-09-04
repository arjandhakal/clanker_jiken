import { spawn } from "node:child_process";
import type { ReviewFinding } from "./types.js";

interface RunResult { code: number; stdout: string; stderr: string }

function run(command: string, args: string[], input?: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: RunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ code: 124, stdout, stderr: stderr || "Hunk command timed out" });
    }, 5_000);
    timeout.unref?.();
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => finish({ code: 1, stdout, stderr: error.message }));
    child.on("close", (code) => finish({ code: code ?? 1, stdout, stderr }));
    if (input !== undefined) child.stdin.end(input); else child.stdin.end();
  });
}

export async function syncFindingsToHunk(cwd: string, runId: string, findings: ReviewFinding[]): Promise<string> {
  const author = `review-room:${runId}`;
  const list = await run("hunk", ["session", "comment", "list", "--repo", cwd, "--type", "agent", "--json"]);
  if (list.code !== 0) return "No live Hunk session; draft saved to the parent inbox only.";

  try {
    const comments = (JSON.parse(list.stdout)?.comments ?? []) as Array<{ noteId?: string; author?: string }>;
    for (const comment of comments) {
      if (comment.author === author && comment.noteId) {
        await run("hunk", ["session", "comment", "rm", "--repo", cwd, comment.noteId, "--json"]);
      }
    }
  } catch {
    // A malformed list should not prevent publication; applying below may still work.
  }

  const comments = findings.flatMap((finding) => {
    if (!finding.file || !finding.line) return [];
    return [{
      filePath: finding.file,
      summary: `${finding.id} [${finding.severity}] ${finding.title}`,
      rationale: `${finding.evidence}\n\nRecommendation: ${finding.recommendation}`,
      author,
      ...(finding.side === "old" ? { oldLine: finding.line } : { newLine: finding.line }),
    }];
  });
  if (comments.length === 0) return "Draft saved; no findings had a file and line for Hunk annotations.";
  const applied = await run(
    "hunk",
    ["session", "comment", "apply", "--repo", cwd, "--stdin", "--json"],
    JSON.stringify({ comments }),
  );
  return applied.code === 0
    ? `Draft saved and ${comments.length} candidate annotation(s) synced to Hunk.`
    : `Draft saved, but Hunk rejected annotations: ${applied.stderr.trim() || applied.stdout.trim()}`;
}
