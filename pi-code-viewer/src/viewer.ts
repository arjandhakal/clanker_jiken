import type { CodeRef, ViewerMode, ViewerState } from "./model.js";
import type { Registry } from "./registry.js";
import {
  highlightLine,
  highlightDiffLine,
  type SyntaxColors,
} from "./highlighter.js";
import { getDiff } from "./git.js";
import { resolveSafePath, isBinaryFile, getFileSize } from "./paths.js";
import { matchesKey, Key, truncateToWidth } from "@earendil-works/pi-tui";
import * as fs from "node:fs";

const MAX_FILE_BYTES = 1_000_000;

export const OVERLAY_OPTIONS = {
  overlay: true as const,
  overlayOptions: {
    width: "90%" as const,
    maxHeight: "85%" as const,
    minWidth: 80,
    anchor: "center" as const,
    margin: 1,
  },
};

function safeFg(theme: any, color: string, text: string): string {
  try {
    return theme.fg(color, text);
  } catch {
    return text;
  }
}

function makeColors(theme: any): SyntaxColors {
  return {
    comment: (t) => safeFg(theme, "syntaxComment", t),
    keyword: (t) => safeFg(theme, "syntaxKeyword", t),
    fn: (t) => safeFg(theme, "syntaxFunction", t),
    string: (t) => safeFg(theme, "syntaxString", t),
    number: (t) => safeFg(theme, "syntaxNumber", t),
    punctuation: (t) => safeFg(theme, "syntaxPunctuation", t),
    diffAdded: (t) => safeFg(theme, "toolDiffAdded", t),
    diffRemoved: (t) => safeFg(theme, "toolDiffRemoved", t),
    diffContext: (t) => safeFg(theme, "toolDiffContext", t),
    diffHunk: (t) => safeFg(theme, "accent", t),
    dim: (t) => safeFg(theme, "dim", t),
  };
}

type ContentType = "code" | "diff" | "error" | "outline" | "tour" | "flow";

export class CodeViewerComponent {
  private tui: any;
  private theme: any;
  private done: (result: undefined) => void;
  private registry: Registry;
  private state: ViewerState;
  private cwd: string;
  private colors: SyntaxColors;

  private lines: string[] = [];
  private contentType: ContentType = "code";
  private errorMessage?: string;

  constructor(
    tui: any,
    theme: any,
    done: (result: undefined) => void,
    registry: Registry,
    state: ViewerState,
    cwd: string,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.done = done;
    this.registry = registry;
    this.state = { ...state };
    this.cwd = cwd;
    this.colors = makeColors(theme);
    this.loadContent();
  }

  private getContentHeight(): number {
    const termRows = process.stdout.rows || 40;
    return Math.max(5, Math.floor(termRows * 0.75) - 4);
  }

  private loadContent() {
    this.errorMessage = undefined;

    if (this.state.mode === "outline") {
      this.buildOutlineLines();
      this.contentType = "outline";
      return;
    }

    if (this.state.mode === "tour") {
      this.loadTourStep();
      return;
    }

    if (this.state.mode === "flow") {
      this.loadFlowNode();
      return;
    }

    const ref = this.state.selectedRefId
      ? this.registry.getRef(this.state.selectedRefId)
      : undefined;

    if (!ref) {
      this.contentType = "error";
      this.errorMessage = "No ref selected";
      return;
    }

    if (this.state.mode === "diff" || ref.kind === "diff") {
      this.loadDiff(ref);
      return;
    }

    this.loadCode(ref);
  }

  private loadCode(ref: CodeRef) {
    const absPath = resolveSafePath(ref.path, this.cwd);
    if (!absPath) {
      this.contentType = "error";
      this.errorMessage = `Path outside cwd: ${ref.path}`;
      return;
    }

    if (!fs.existsSync(absPath)) {
      this.contentType = "error";
      this.errorMessage = `File not found: ${ref.path}`;
      return;
    }

    if (isBinaryFile(absPath)) {
      this.contentType = "error";
      this.errorMessage = `Binary file: ${ref.path}`;
      return;
    }

    const size = getFileSize(absPath);
    if (size > MAX_FILE_BYTES) {
      this.contentType = "error";
      this.errorMessage = `File too large: ${ref.path} (${(size / 1024 / 1024).toFixed(1)} MB)`;
      return;
    }

    const content = fs.readFileSync(absPath, "utf-8");
    this.lines = content.split("\n");
    this.contentType = "code";

    if (ref.startLine && this.state.scroll === 0) {
      this.state.scroll = Math.max(0, ref.startLine - 3);
    }
  }

  private loadDiff(ref: CodeRef) {
    const bundle = ref.bundleId
      ? this.registry.getBundle(ref.bundleId)
      : undefined;
    const staged = bundle?.staged ?? false;
    const base = bundle?.gitBase;
    const diff = getDiff(this.cwd, ref.path, staged, base);

    if (!diff) {
      this.contentType = "error";
      this.errorMessage = `No diff available for: ${ref.path}`;
      return;
    }

    this.lines = diff.split("\n");
    this.contentType = "diff";
  }

  private buildOutlineLines() {
    this.lines = [];
    const bundle = this.state.bundleId
      ? this.registry.getBundle(this.state.bundleId)
      : undefined;
    const tour = this.state.tourId
      ? this.registry.getTour(this.state.tourId)
      : undefined;
    const flow = this.state.flowId
      ? this.registry.getFlow(this.state.flowId)
      : undefined;

    if (tour) {
      this.lines.push(`Tour: ${tour.title}`);
      if (tour.purpose) this.lines.push(`Purpose: ${tour.purpose}`);
      this.lines.push("");
      for (let i = 0; i < tour.steps.length; i++) {
        const step = tour.steps[i];
        const ref = this.registry.getRef(step.refId);
        const marker = i === this.state.selectedIndex ? "▸" : " ";
        const loc = ref
          ? ` (${ref.path}${ref.startLine ? `:${ref.startLine}` : ""})`
          : "";
        this.lines.push(`${marker} ${i + 1}. ${step.label}${loc}`);
        if (step.note) this.lines.push(`    ${step.note}`);
      }
    } else if (flow) {
      this.lines.push(`Flow: ${flow.title}`);
      this.lines.push("");
      for (let i = 0; i < flow.nodeRefs.length; i++) {
        const ref = this.registry.getRef(flow.nodeRefs[i]);
        const marker = i === this.state.selectedIndex ? "▸" : " ";
        const info = ref
          ? `${ref.id} ${ref.path}${ref.startLine ? `:${ref.startLine}` : ""}`
          : flow.nodeRefs[i];
        this.lines.push(`${marker} ${info}`);
      }
      if (flow.edges.length > 0) {
        this.lines.push("");
        this.lines.push("Edges:");
        for (const edge of flow.edges) {
          this.lines.push(
            `  ${edge.fromRefId} ─${edge.kind}→ ${edge.toRefId}${edge.label ? ` (${edge.label})` : ""}`,
          );
        }
      }
      if (flow.observations && flow.observations.length > 0) {
        this.lines.push("");
        this.lines.push("Observations:");
        for (const obs of flow.observations) {
          this.lines.push(
            `  ${obs.label}${obs.preview ? `: ${obs.preview}` : ""}`,
          );
        }
      }
    } else if (bundle) {
      this.lines.push(`Bundle: ${bundle.title}`);
      this.lines.push("");
      for (let i = 0; i < bundle.refs.length; i++) {
        const ref = bundle.refs[i];
        const marker = i === this.state.selectedIndex ? "▸" : " ";
        const range = ref.startLine
          ? `:${ref.startLine}${ref.endLine ? `-${ref.endLine}` : ""}`
          : "";
        const desc = ref.title ? ` — ${ref.title}` : "";
        this.lines.push(
          `${marker} ${ref.id} ${ref.path}${range} ${ref.kind}${desc}`,
        );
      }
    } else {
      this.lines.push("All Code Refs:");
      this.lines.push("");
      const allRefs = Array.from(this.registry.refs.values());
      if (allRefs.length === 0) {
        this.lines.push("  (none)");
      }
      for (let i = 0; i < allRefs.length; i++) {
        const ref = allRefs[i];
        const marker = i === this.state.selectedIndex ? "▸" : " ";
        const range = ref.startLine
          ? `:${ref.startLine}${ref.endLine ? `-${ref.endLine}` : ""}`
          : "";
        const desc = ref.title ? ` — ${ref.title}` : "";
        this.lines.push(
          `${marker} ${ref.id} ${ref.path}${range} ${ref.kind}${desc}`,
        );
      }

      if (this.registry.bundles.size > 0) {
        this.lines.push("");
        this.lines.push("Bundles:");
        for (const b of this.registry.bundles.values()) {
          this.lines.push(`  ${b.id}: ${b.title} (${b.refs.length} refs)`);
        }
      }
      if (this.registry.tours.size > 0) {
        this.lines.push("");
        this.lines.push("Tours:");
        for (const t of this.registry.tours.values()) {
          this.lines.push(
            `  ${t.id}: ${t.title} (${t.steps.length} steps)`,
          );
        }
      }
      if (this.registry.flows.size > 0) {
        this.lines.push("");
        this.lines.push("Flows:");
        for (const f of this.registry.flows.values()) {
          this.lines.push(
            `  ${f.id}: ${f.title} (${f.nodeRefs.length} nodes)`,
          );
        }
      }
    }
  }

  private loadTourStep() {
    const tour = this.state.tourId
      ? this.registry.getTour(this.state.tourId)
      : undefined;
    if (!tour) {
      this.contentType = "error";
      this.errorMessage = "Tour not found";
      return;
    }

    const stepIdx = this.state.selectedStepIndex ?? 0;
    if (stepIdx >= tour.steps.length) {
      this.contentType = "error";
      this.errorMessage = "Invalid tour step";
      return;
    }

    const step = tour.steps[stepIdx];
    const ref = this.registry.getRef(step.refId);
    if (!ref) {
      this.contentType = "error";
      this.errorMessage = `Ref ${step.refId} not found for tour step`;
      return;
    }

    this.state.selectedRefId = ref.id;
    this.loadCode(ref);
    if (this.contentType !== "error") {
      this.contentType = "tour";
    }
  }

  private loadFlowNode() {
    const flow = this.state.flowId
      ? this.registry.getFlow(this.state.flowId)
      : undefined;
    if (!flow) {
      this.contentType = "error";
      this.errorMessage = "Flow not found";
      return;
    }

    const idx = this.state.selectedStepIndex ?? 0;
    if (idx >= flow.nodeRefs.length) {
      this.contentType = "error";
      this.errorMessage = "Invalid flow node";
      return;
    }

    const refId = flow.nodeRefs[idx];
    const ref = this.registry.getRef(refId);
    if (!ref) {
      this.contentType = "error";
      this.errorMessage = `Ref ${refId} not found for flow node`;
      return;
    }

    this.state.selectedRefId = ref.id;
    this.loadCode(ref);
    if (this.contentType !== "error") {
      this.contentType = "flow";
    }
  }

  // --- Rendering ---

  render(width: number): string[] {
    const contentHeight = this.getContentHeight();
    const output: string[] = [];
    const hr = "─".repeat(width);

    output.push(this.renderHeader(width));
    output.push(hr);

    const contentLines = this.renderContent(width, contentHeight);
    output.push(...contentLines);

    while (output.length < contentHeight + 2) {
      output.push("");
    }

    output.push(hr);
    output.push(this.renderFooter(width));

    return output.map((line) => truncateToWidth(line, width));
  }

  private renderHeader(_width: number): string {
    const ref = this.state.selectedRefId
      ? this.registry.getRef(this.state.selectedRefId)
      : undefined;
    const mode = this.state.mode.toUpperCase();
    const modeTag = safeFg(this.theme, "accent", ` ${mode} `);

    if (this.contentType === "tour") {
      const tour = this.state.tourId
        ? this.registry.getTour(this.state.tourId)
        : undefined;
      if (tour) {
        const stepIdx = (this.state.selectedStepIndex ?? 0) + 1;
        return `${modeTag} ${tour.title}  Step ${stepIdx}/${tour.steps.length}`;
      }
    }

    if (this.contentType === "flow") {
      const flow = this.state.flowId
        ? this.registry.getFlow(this.state.flowId)
        : undefined;
      if (flow) {
        const idx = (this.state.selectedStepIndex ?? 0) + 1;
        return `${modeTag} ${flow.title}  Node ${idx}/${flow.nodeRefs.length}`;
      }
    }

    if (this.contentType === "outline") {
      return `${modeTag}`;
    }

    if (ref) {
      const range = ref.startLine
        ? `:${ref.startLine}${ref.endLine ? `-${ref.endLine}` : ""}`
        : "";
      const title = ref.title ? `  ${ref.title}` : "";
      return `${modeTag} ${ref.id}  ${ref.path}${range}${title}`;
    }

    return modeTag;
  }

  private renderContent(width: number, maxLines: number): string[] {
    if (this.contentType === "error") {
      return ["", `  ${this.errorMessage || "Unknown error"}`, ""];
    }

    if (this.contentType === "outline") {
      return this.renderOutlineContent(maxLines);
    }

    if (this.contentType === "tour") {
      return this.renderTourContent(width, maxLines);
    }

    if (this.contentType === "flow") {
      return this.renderFlowContent(width, maxLines);
    }

    if (this.contentType === "diff") {
      return this.renderDiffContent(maxLines);
    }

    return this.renderCodeContent(maxLines);
  }

  private renderCodeContent(maxLines: number): string[] {
    const ref = this.state.selectedRefId
      ? this.registry.getRef(this.state.selectedRefId)
      : undefined;
    const start = this.state.scroll;
    const end = Math.min(this.lines.length, start + maxLines);
    const maxLineNum = Math.max(end, this.lines.length);
    const gutterPad = String(maxLineNum).length;
    const output: string[] = [];

    for (let i = start; i < end; i++) {
      const lineNum = String(i + 1).padStart(gutterPad);
      const highlighted = highlightLine(
        this.lines[i],
        ref?.language,
        this.colors,
      );
      const gutter = this.colors.dim(`${lineNum} │ `);
      output.push(gutter + highlighted);
    }

    return output;
  }

  private renderDiffContent(maxLines: number): string[] {
    const start = this.state.scroll;
    const end = Math.min(this.lines.length, start + maxLines);
    const output: string[] = [];

    for (let i = start; i < end; i++) {
      output.push(highlightDiffLine(this.lines[i], this.colors));
    }

    return output;
  }

  private renderOutlineContent(maxLines: number): string[] {
    const start = this.state.scroll;
    const end = Math.min(this.lines.length, start + maxLines);
    const output: string[] = [];

    for (let i = start; i < end; i++) {
      const line = this.lines[i];
      if (line.startsWith("▸")) {
        output.push(safeFg(this.theme, "accent", line));
      } else {
        output.push(line);
      }
    }

    return output;
  }

  private renderTourContent(_width: number, maxLines: number): string[] {
    const output: string[] = [];
    const tour = this.state.tourId
      ? this.registry.getTour(this.state.tourId)
      : undefined;
    const stepIdx = this.state.selectedStepIndex ?? 0;

    if (tour && tour.steps[stepIdx]) {
      const step = tour.steps[stepIdx];
      const roleTag = step.role ? ` [${step.role}]` : "";
      output.push(safeFg(this.theme, "accent", `● ${step.label}${roleTag}`));
      if (step.note)
        output.push(this.colors.dim(`  ${step.note}`));
      output.push("");
    }

    const remaining = maxLines - output.length;
    output.push(...this.renderCodeContent(remaining));
    return output;
  }

  private renderFlowContent(_width: number, maxLines: number): string[] {
    const output: string[] = [];
    const flow = this.state.flowId
      ? this.registry.getFlow(this.state.flowId)
      : undefined;
    const idx = this.state.selectedStepIndex ?? 0;

    if (flow) {
      const refId = flow.nodeRefs[idx];

      const edges = flow.edges.filter(
        (e) => e.fromRefId === refId || e.toRefId === refId,
      );
      for (const edge of edges) {
        const dir = edge.fromRefId === refId ? "→" : "←";
        const other =
          edge.fromRefId === refId ? edge.toRefId : edge.fromRefId;
        output.push(
          this.colors.dim(
            `  ${dir} ${edge.kind} ${other}${edge.label ? ` (${edge.label})` : ""}`,
          ),
        );
      }

      const obs = flow.observations?.filter((o) => o.refId === refId);
      if (obs && obs.length > 0) {
        for (const o of obs) {
          output.push(
            this.colors.string(
              `  ◆ ${o.label}${o.preview ? `: ${o.preview}` : ""}`,
            ),
          );
        }
      }

      if (edges.length > 0 || (obs && obs.length > 0)) {
        output.push("");
      }
    }

    const remaining = maxLines - output.length;
    output.push(...this.renderCodeContent(remaining));
    return output;
  }

  private renderFooter(_width: number): string {
    const parts: string[] = [];

    if (this.contentType === "code" || this.contentType === "diff") {
      parts.push("↑↓ scroll");
    }

    if (this.contentType === "outline") {
      parts.push("↑↓ select", "enter open");
    }

    if (this.contentType === "tour" || this.contentType === "flow") {
      parts.push("[ prev", "] next", "↑↓ scroll");
    }

    if (this.contentType !== "diff") parts.push("d diff");
    if (this.contentType !== "code" && this.contentType !== "tour" && this.contentType !== "flow")
      parts.push("c code");
    parts.push("o outline");

    if (this.state.tourId && this.contentType !== "tour") parts.push("t tour");
    if (this.state.flowId && this.contentType !== "flow") parts.push("f flow");

    parts.push("q close");

    return this.colors.dim(parts.join("  "));
  }

  // --- Input ---

  handleInput(data: string) {
    if (matchesKey(data, "q") || matchesKey(data, Key.escape)) {
      this.done(undefined);
      return;
    }

    const maxScroll = Math.max(0, this.lines.length - this.getContentHeight());

    if (matchesKey(data, Key.up)) {
      if (this.contentType === "outline") {
        this.state.selectedIndex = Math.max(0, this.state.selectedIndex - 1);
        this.buildOutlineLines();
      } else {
        this.state.scroll = Math.max(0, this.state.scroll - 1);
      }
    }

    if (matchesKey(data, Key.down)) {
      if (this.contentType === "outline") {
        this.state.selectedIndex = Math.min(
          this.getOutlineItemCount() - 1,
          this.state.selectedIndex + 1,
        );
        this.buildOutlineLines();
      } else {
        this.state.scroll = Math.min(maxScroll, this.state.scroll + 1);
      }
    }

    if (matchesKey(data, Key.pageUp)) {
      this.state.scroll = Math.max(
        0,
        this.state.scroll - this.getContentHeight(),
      );
    }

    if (matchesKey(data, Key.pageDown)) {
      this.state.scroll = Math.min(
        maxScroll,
        this.state.scroll + this.getContentHeight(),
      );
    }

    if (matchesKey(data, Key.home)) {
      this.state.scroll = 0;
    }

    if (matchesKey(data, Key.end)) {
      this.state.scroll = maxScroll;
    }

    if (matchesKey(data, "d")) {
      this.switchMode("diff");
    }

    if (matchesKey(data, "c")) {
      this.switchMode("code");
    }

    if (matchesKey(data, "o")) {
      this.switchMode("outline");
    }

    if (matchesKey(data, "t") && this.state.tourId) {
      this.switchMode("tour");
    }

    if (matchesKey(data, "f") && this.state.flowId) {
      this.switchMode("flow");
    }

    if (matchesKey(data, Key.leftbracket)) {
      if (
        this.state.selectedStepIndex != null &&
        this.state.selectedStepIndex > 0
      ) {
        this.state.selectedStepIndex--;
        this.state.scroll = 0;
        this.loadContent();
      }
    }

    if (matchesKey(data, Key.rightbracket)) {
      if (this.state.selectedStepIndex != null) {
        const max = this.getMaxStepIndex();
        if (this.state.selectedStepIndex < max) {
          this.state.selectedStepIndex++;
          this.state.scroll = 0;
          this.loadContent();
        }
      }
    }

    if (matchesKey(data, Key.enter) && this.contentType === "outline") {
      this.openSelectedOutlineItem();
    }

    this.tui.requestRender();
  }

  invalidate() {
    this.colors = makeColors(this.theme);
  }

  // --- Helpers ---

  private switchMode(mode: ViewerMode) {
    if (this.state.mode === mode) return;
    this.state.mode = mode;
    this.state.scroll = 0;

    if (mode === "tour") {
      this.state.selectedStepIndex = this.state.selectedStepIndex ?? 0;
    }
    if (mode === "flow") {
      this.state.selectedStepIndex = this.state.selectedStepIndex ?? 0;
    }

    this.loadContent();
  }

  private getMaxStepIndex(): number {
    if (this.state.tourId) {
      const tour = this.registry.getTour(this.state.tourId);
      return tour ? tour.steps.length - 1 : 0;
    }
    if (this.state.flowId) {
      const flow = this.registry.getFlow(this.state.flowId);
      return flow ? flow.nodeRefs.length - 1 : 0;
    }
    return 0;
  }

  private getOutlineItemCount(): number {
    const bundle = this.state.bundleId
      ? this.registry.getBundle(this.state.bundleId)
      : undefined;
    const tour = this.state.tourId
      ? this.registry.getTour(this.state.tourId)
      : undefined;
    const flow = this.state.flowId
      ? this.registry.getFlow(this.state.flowId)
      : undefined;

    if (tour) return tour.steps.length;
    if (flow) return flow.nodeRefs.length;
    if (bundle) return bundle.refs.length;
    return this.registry.refs.size;
  }

  private openSelectedOutlineItem() {
    const tour = this.state.tourId
      ? this.registry.getTour(this.state.tourId)
      : undefined;
    const flow = this.state.flowId
      ? this.registry.getFlow(this.state.flowId)
      : undefined;
    const bundle = this.state.bundleId
      ? this.registry.getBundle(this.state.bundleId)
      : undefined;

    if (tour && tour.steps[this.state.selectedIndex]) {
      this.state.selectedStepIndex = this.state.selectedIndex;
      this.switchMode("tour");
      return;
    }

    if (flow && flow.nodeRefs[this.state.selectedIndex]) {
      this.state.selectedStepIndex = this.state.selectedIndex;
      this.switchMode("flow");
      return;
    }

    let refId: string | undefined;
    if (bundle && bundle.refs[this.state.selectedIndex]) {
      refId = bundle.refs[this.state.selectedIndex].id;
    } else {
      const allRefs = Array.from(this.registry.refs.values());
      if (allRefs[this.state.selectedIndex]) {
        refId = allRefs[this.state.selectedIndex].id;
      }
    }

    if (refId) {
      const ref = this.registry.getRef(refId);
      this.state.selectedRefId = refId;
      this.state.scroll = 0;
      this.switchMode(ref?.kind === "diff" ? "diff" : "code");
    }
  }
}

export async function openViewer(
  ctx: any,
  registry: Registry,
  cwd: string,
  state: ViewerState,
) {
  await ctx.ui.custom<undefined>(
    (tui: any, theme: any, _kb: any, done: any) => {
      return new CodeViewerComponent(tui, theme, done, registry, state, cwd);
    },
    OVERLAY_OPTIONS,
  );
}
