export const SCHEMA_VERSION = 1 as const;

export type ReviewTarget = "all" | "working" | "staged" | "branch";
export type Severity = "blocker" | "high" | "medium" | "low" | "nit";
export type Confidence = "high" | "medium" | "low";
export type LineSide = "new" | "old";

export interface ReviewFinding {
  id: string;
  title: string;
  severity: Severity;
  confidence: Confidence;
  evidence: string;
  recommendation: string;
  file?: string;
  line?: number;
  side?: LineSide;
}

export interface ReviewDraft {
  schemaVersion: typeof SCHEMA_VERSION;
  runId: string;
  revision: number;
  publishedAt: string;
  summary?: string;
  findings: ReviewFinding[];
}

export interface ReviewSelection {
  schemaVersion: typeof SCHEMA_VERSION;
  runId: string;
  draftRevision: number;
  selectedIds: string[];
  notes?: Record<string, string>;
  updatedAt: string;
  sentIds?: string[];
  sentAt?: string;
}

export interface ReviewHandoff {
  schemaVersion: typeof SCHEMA_VERSION;
  handoffId: string;
  runId: string;
  draftRevision: number;
  selectedIds: string[];
  findings: ReviewFinding[];
  notes?: Record<string, string>;
  createdAt: string;
  deliveredAt?: string;
}

export interface ReviewManifest {
  schemaVersion: typeof SCHEMA_VERSION;
  runId: string;
  createdAt: string;
  cwd: string;
  parentSessionId: string;
  parentSessionFile?: string;
  parentPaneId: string;
  childSessionFile: string;
  agentName: string;
  childPaneId?: string;
  model: string;
  thinking?: string;
  target: ReviewTarget;
  targetLabel: string;
  patchFile: string;
  brief?: string;
  hunkSync: boolean;
}

export interface ReviewStatus {
  schemaVersion: typeof SCHEMA_VERSION;
  runId: string;
  state: "starting" | "active" | "closed" | "error";
  updatedAt: string;
  message?: string;
}

export interface RunPaths {
  dir: string;
  manifest: string;
  draft: string;
  selection: string;
  handoff: string;
  status: string;
  patch: string;
}
