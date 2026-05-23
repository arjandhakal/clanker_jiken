import * as path from "node:path";
import * as fs from "node:fs";

const LANG_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".clj": "clojure",
  ".cljs": "clojure",
  ".cljc": "clojure",
  ".edn": "clojure",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".kt": "kotlin",
  ".swift": "swift",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cc": "cpp",
  ".cs": "csharp",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".md": "markdown",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".xml": "xml",
  ".html": "html",
  ".css": "css",
  ".sql": "sql",
};

export function detectLanguage(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  return LANG_MAP[ext];
}

export function resolveSafePath(
  candidate: string,
  cwd: string,
): string | null {
  if (candidate.includes("\0")) return null;
  if (/[\x01-\x08\x0e-\x1f\x7f]/.test(candidate)) return null;

  const resolved = path.resolve(cwd, candidate);
  const normalizedCwd = path.resolve(cwd);

  if (
    !resolved.startsWith(normalizedCwd + path.sep) &&
    resolved !== normalizedCwd
  ) {
    return null;
  }

  return resolved;
}

export function toCwdRelative(absolutePath: string, cwd: string): string {
  return path.relative(cwd, absolutePath).split(path.sep).join("/");
}

export interface ParsedPathRange {
  path: string;
  startLine?: number;
  endLine?: number;
}

export function parsePathRange(input: string): ParsedPathRange {
  const match = input.match(/^(.+?)(?::(\d+)(?:-(\d+))?)?$/);
  if (!match) return { path: input };
  return {
    path: match[1],
    startLine: match[2] ? parseInt(match[2], 10) : undefined,
    endLine: match[3] ? parseInt(match[3], 10) : undefined,
  };
}

export function isBinaryFile(filePath: string): boolean {
  try {
    const buf = Buffer.alloc(512);
    const fd = fs.openSync(filePath, "r");
    const bytesRead = fs.readSync(fd, buf, 0, 512, 0);
    fs.closeSync(fd);
    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function getFileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return -1;
  }
}
