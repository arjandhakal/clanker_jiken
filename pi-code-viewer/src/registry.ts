import type {
  CodeRef,
  CodeRefKind,
  CodeRefSource,
  ReviewBundle,
  CodeTour,
  TourStep,
  DataFlow,
  FlowEdge,
  FlowObservation,
  RuntimeArtifact,
  RuntimeArtifactKind,
  PersistenceData,
} from "./model.js";
import { detectLanguage } from "./paths.js";

export class Registry {
  refs = new Map<string, CodeRef>();
  bundles = new Map<string, ReviewBundle>();
  tours = new Map<string, CodeTour>();
  flows = new Map<string, DataFlow>();
  artifacts = new Map<string, RuntimeArtifact>();

  private refCounter = 0;
  private bundleCounter = 0;
  private tourCounter = 0;
  private flowCounter = 0;
  private artifactCounter = 0;

  nextRefId(): string {
    return `ref_${++this.refCounter}`;
  }
  nextBundleId(): string {
    return `bundle_${++this.bundleCounter}`;
  }
  nextTourId(): string {
    return `tour_${++this.tourCounter}`;
  }
  nextFlowId(): string {
    return `flow_${++this.flowCounter}`;
  }
  nextArtifactId(): string {
    return `artifact_${++this.artifactCounter}`;
  }

  addRef(opts: {
    path: string;
    kind?: CodeRefKind;
    startLine?: number;
    endLine?: number;
    symbol?: string;
    title?: string;
    note?: string;
    bundleId?: string;
    source?: CodeRefSource;
    createdByToolCallId?: string;
  }): CodeRef {
    const id = this.nextRefId();
    const kind: CodeRefKind =
      opts.kind ??
      (opts.symbol ? "symbol" : opts.startLine != null ? "range" : "file");
    const ref: CodeRef = {
      id,
      kind,
      path: opts.path,
      startLine: opts.startLine,
      endLine: opts.endLine,
      symbol: opts.symbol,
      title: opts.title,
      note: opts.note,
      language: detectLanguage(opts.path),
      bundleId: opts.bundleId,
      source: opts.source ?? "manual",
      createdByToolCallId: opts.createdByToolCallId,
      timestamp: Date.now(),
    };
    this.refs.set(id, ref);
    return ref;
  }

  getRef(id: string): CodeRef | undefined {
    return this.refs.get(id);
  }

  addBundle(
    title: string,
    refs: CodeRef[],
    opts?: { gitBase?: string; staged?: boolean; summary?: string },
  ): ReviewBundle {
    const id = this.nextBundleId();
    const bundle: ReviewBundle = {
      id,
      title,
      refs: [...refs],
      gitBase: opts?.gitBase,
      staged: opts?.staged,
      summary: opts?.summary,
      timestamp: Date.now(),
    };
    this.bundles.set(id, bundle);
    for (const ref of refs) {
      ref.bundleId = id;
    }
    return bundle;
  }

  getBundle(id: string): ReviewBundle | undefined {
    return this.bundles.get(id);
  }

  getLatestBundle(): ReviewBundle | undefined {
    let latest: ReviewBundle | undefined;
    for (const b of this.bundles.values()) {
      if (!latest || b.timestamp > latest.timestamp) latest = b;
    }
    return latest;
  }

  getOrCreateAutoBundle(): ReviewBundle {
    for (const b of this.bundles.values()) {
      if (b.title === "Latest changes") return b;
    }
    return this.addBundle("Latest changes", []);
  }

  addTour(opts: {
    title: string;
    purpose?: string;
    steps: TourStep[];
    summary?: string;
  }): CodeTour {
    const id = this.nextTourId();
    const tour: CodeTour = {
      id,
      title: opts.title,
      purpose: opts.purpose,
      steps: opts.steps,
      summary: opts.summary,
      timestamp: Date.now(),
    };
    this.tours.set(id, tour);
    return tour;
  }

  getTour(id: string): CodeTour | undefined {
    return this.tours.get(id);
  }

  addFlow(opts: {
    title: string;
    sourceTool?: string;
    entryRefId?: string;
    nodeRefs: string[];
    edges: FlowEdge[];
    observations?: FlowObservation[];
    summary?: string;
  }): DataFlow {
    const id = this.nextFlowId();
    const flow: DataFlow = {
      id,
      title: opts.title,
      sourceTool: opts.sourceTool,
      entryRefId: opts.entryRefId,
      nodeRefs: opts.nodeRefs,
      edges: opts.edges,
      observations: opts.observations,
      summary: opts.summary,
      timestamp: Date.now(),
    };
    this.flows.set(id, flow);
    return flow;
  }

  getFlow(id: string): DataFlow | undefined {
    return this.flows.get(id);
  }

  addArtifact(opts: {
    kind: RuntimeArtifactKind;
    title: string;
    sourceTool?: string;
    refIds?: string[];
    preview?: string;
    externalUri?: string;
    inMemoryOnly?: boolean;
  }): RuntimeArtifact {
    const id = this.nextArtifactId();
    const artifact: RuntimeArtifact = {
      id,
      kind: opts.kind,
      title: opts.title,
      sourceTool: opts.sourceTool,
      refIds: opts.refIds,
      preview: opts.preview,
      externalUri: opts.externalUri,
      inMemoryOnly: opts.inMemoryOnly ?? true,
      timestamp: Date.now(),
    };
    this.artifacts.set(id, artifact);
    return artifact;
  }

  serialize(): PersistenceData {
    return {
      kind: "code-viewer-index",
      refs: Array.from(this.refs.values()).map((r) => ({
        id: r.id,
        kind: r.kind,
        path: r.path,
        startLine: r.startLine,
        endLine: r.endLine,
        symbol: r.symbol,
        title: r.title,
        note: r.note,
        source: r.source,
      })),
      bundles: Array.from(this.bundles.values()).map((b) => ({
        id: b.id,
        title: b.title,
        refs: b.refs.map((r) => r.id),
      })),
      tours: Array.from(this.tours.values()).map((t) => ({
        id: t.id,
        title: t.title,
        purpose: t.purpose,
        steps: t.steps,
      })),
      flows: Array.from(this.flows.values()).map((f) => ({
        id: f.id,
        title: f.title,
        nodeRefs: f.nodeRefs,
        edges: f.edges,
        observations: f.observations,
      })),
    };
  }

  restore(data: PersistenceData) {
    this.refs.clear();
    this.bundles.clear();
    this.tours.clear();
    this.flows.clear();
    let maxRef = 0;
    let maxBundle = 0;
    let maxTour = 0;
    let maxFlow = 0;

    for (const r of data.refs) {
      const num = parseInt(r.id.replace("ref_", ""), 10);
      if (num > maxRef) maxRef = num;
      this.refs.set(r.id, {
        ...r,
        language: detectLanguage(r.path),
        timestamp: Date.now(),
      });
    }

    for (const b of data.bundles) {
      const num = parseInt(b.id.replace("bundle_", ""), 10);
      if (num > maxBundle) maxBundle = num;
      const refs = b.refs
        .map((id) => this.refs.get(id))
        .filter((r): r is CodeRef => !!r);
      this.bundles.set(b.id, {
        id: b.id,
        title: b.title,
        refs,
        timestamp: Date.now(),
      });
    }

    for (const t of data.tours) {
      const num = parseInt(t.id.replace("tour_", ""), 10);
      if (num > maxTour) maxTour = num;
      this.tours.set(t.id, {
        id: t.id,
        title: t.title,
        purpose: t.purpose,
        steps: t.steps,
        timestamp: Date.now(),
      });
    }

    for (const f of data.flows) {
      const num = parseInt(f.id.replace("flow_", ""), 10);
      if (num > maxFlow) maxFlow = num;
      this.flows.set(f.id, {
        id: f.id,
        title: f.title,
        nodeRefs: f.nodeRefs,
        edges: f.edges,
        observations: f.observations,
        timestamp: Date.now(),
      });
    }

    this.refCounter = maxRef;
    this.bundleCounter = maxBundle;
    this.tourCounter = maxTour;
    this.flowCounter = maxFlow;
  }
}
