export type CodeRefKind =
  | "file"
  | "range"
  | "symbol"
  | "diff"
  | "trace"
  | "runtime-artifact";

export type CodeRefSource =
  | "manual"
  | "auto-edit"
  | "auto-write"
  | "git"
  | "symbol"
  | "trace"
  | "external-tool";

export interface CodeRef {
  id: string;
  kind: CodeRefKind;
  path: string;
  startLine?: number;
  endLine?: number;
  symbol?: string;
  title?: string;
  note?: string;
  language?: string;
  bundleId?: string;
  createdByToolCallId?: string;
  source?: CodeRefSource;
  timestamp: number;
}

export interface ReviewBundle {
  id: string;
  title: string;
  refs: CodeRef[];
  gitBase?: string;
  staged?: boolean;
  summary?: string;
  timestamp: number;
}

export interface TourStep {
  refId: string;
  label: string;
  note?: string;
  role?:
    | "entrypoint"
    | "transform"
    | "validation"
    | "io"
    | "test"
    | "config"
    | "other";
}

export interface CodeTour {
  id: string;
  title: string;
  purpose?: string;
  steps: TourStep[];
  summary?: string;
  timestamp: number;
}

export type FlowEdgeKind =
  | "calls"
  | "emits"
  | "reads"
  | "writes"
  | "tests"
  | "routes-to"
  | "depends-on";

export interface FlowEdge {
  fromRefId: string;
  toRefId: string;
  kind: FlowEdgeKind;
  label?: string;
}

export interface FlowObservation {
  refId?: string;
  label: string;
  preview?: string;
  artifactId?: string;
}

export interface DataFlow {
  id: string;
  title: string;
  sourceTool?: string;
  entryRefId?: string;
  nodeRefs: string[];
  edges: FlowEdge[];
  observations?: FlowObservation[];
  summary?: string;
  timestamp: number;
}

export type RuntimeArtifactKind =
  | "tap"
  | "trace"
  | "repl-result"
  | "portal"
  | "flowstorm"
  | "test"
  | "lint"
  | "profile";

export interface RuntimeArtifact {
  id: string;
  kind: RuntimeArtifactKind;
  sourceTool?: string;
  title: string;
  refIds?: string[];
  preview?: string;
  externalUri?: string;
  inMemoryOnly?: boolean;
  timestamp: number;
}

export type ViewerMode =
  | "code"
  | "diff"
  | "outline"
  | "tour"
  | "flow"
  | "artifact";

export interface ViewerState {
  mode: ViewerMode;
  selectedRefId?: string;
  bundleId?: string;
  scroll: number;
  selectedIndex: number;
  searchQuery?: string;
  searchHits: number[];
  activeHit: number;
  tourId?: string;
  flowId?: string;
  selectedStepIndex?: number;
}

export interface PersistenceData {
  kind: "code-viewer-index";
  refs: Array<{
    id: string;
    kind: CodeRefKind;
    path: string;
    startLine?: number;
    endLine?: number;
    symbol?: string;
    title?: string;
    note?: string;
    source?: CodeRefSource;
  }>;
  bundles: Array<{ id: string; title: string; refs: string[] }>;
  tours: Array<{
    id: string;
    title: string;
    purpose?: string;
    steps: TourStep[];
  }>;
  flows: Array<{
    id: string;
    title: string;
    nodeRefs: string[];
    edges: FlowEdge[];
    observations?: FlowObservation[];
  }>;
}
