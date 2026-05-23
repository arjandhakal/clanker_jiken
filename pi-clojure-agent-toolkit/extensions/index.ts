import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import * as fs from "node:fs/promises";
import * as fssync from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import { spawn } from "node:child_process";

// Clojure Agent Toolkit for pi
// - nREPL eval/tools
// - clj-kondo / clojure-lsp / formatter / test runner wrappers
// - conservative structural edits for top-level Clojure forms

type ExecResult = { code: number | null; stdout: string; stderr: string; command: string };

function text(content: string) {
  return [{ type: "text" as const, text: content }];
}

function truncate(s: string, max = 24_000) {
  return s.length > max ? s.slice(0, max) + `\n\n… truncated ${s.length - max} chars` : s;
}

async function exists(p: string) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function which(cmd: string, cwd: string) {
  const r = await exec("/bin/sh", ["-lc", `command -v ${shellQuote(cmd)}`], cwd, 5_000);
  return r.code === 0 ? r.stdout.trim() : "";
}

function shellQuote(s: string) {
  return `'${s.replace(/'/g, `'"'"'`)}'`;
}

function exec(cmd: string, args: string[], cwd: string, timeoutMs = 120_000, input?: string, signal?: AbortSignal): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, signal, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (d) => stdout += d.toString());
    child.stderr.on("data", (d) => stderr += d.toString());
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(err), command: [cmd, ...args].join(" ") });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, command: [cmd, ...args].join(" ") });
    });
    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

// ---- nREPL bencode client -------------------------------------------------

type BVal = string | number | BVal[] | { [k: string]: BVal };

function benc(v: BVal): Buffer {
  if (typeof v === "number") return Buffer.from(`i${v}e`);
  if (typeof v === "string") return Buffer.from(`${Buffer.byteLength(v)}:${v}`);
  if (Array.isArray(v)) return Buffer.concat([Buffer.from("l"), ...v.map(benc), Buffer.from("e")]);
  const entries = Object.entries(v).sort(([a], [b]) => a.localeCompare(b));
  return Buffer.concat([Buffer.from("d"), ...entries.flatMap(([k, val]) => [benc(k), benc(val)]), Buffer.from("e")]);
}

function bdec(buf: Buffer, i = 0): [BVal, number] {
  const c = String.fromCharCode(buf[i]);
  if (c === "i") {
    const e = buf.indexOf("e", i);
    return [Number(buf.subarray(i + 1, e).toString()), e + 1];
  }
  if (c === "l") {
    const arr: BVal[] = []; i++;
    while (buf[i] !== 101) { const [v, n] = bdec(buf, i); arr.push(v); i = n; }
    return [arr, i + 1];
  }
  if (c === "d") {
    const obj: Record<string, BVal> = {}; i++;
    while (buf[i] !== 101) { const [k, n1] = bdec(buf, i); const [v, n2] = bdec(buf, n1); obj[String(k)] = v; i = n2; }
    return [obj, i + 1];
  }
  if (/[0-9]/.test(c)) {
    const colon = buf.indexOf(58, i);
    const len = Number(buf.subarray(i, colon).toString());
    const start = colon + 1;
    return [buf.subarray(start, start + len).toString(), start + len];
  }
  throw new Error(`Bad bencode at ${i}: ${c}`);
}

function tryDecodeMany(buf: Buffer): { values: BVal[]; rest: Buffer } {
  const values: BVal[] = [];
  let i = 0;
  while (i < buf.length) {
    try { const [v, n] = bdec(buf, i); values.push(v); i = n; }
    catch { break; }
  }
  return { values, rest: buf.subarray(i) };
}

async function readNreplPort(cwd: string, explicit?: number) {
  if (explicit) return explicit;
  let dir = cwd;
  while (true) {
    const p = path.join(dir, ".nrepl-port");
    if (await exists(p)) return Number((await fs.readFile(p, "utf8")).trim());
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("No nREPL port supplied and no .nrepl-port found");
}

async function nreplRequest(cwd: string, msg: Record<string, BVal>, port?: number, host = "127.0.0.1", timeoutMs = 60_000) {
  const actualPort = await readNreplPort(cwd, port);
  return new Promise<Record<string, BVal>[]>((resolve, reject) => {
    const socket = net.createConnection({ port: actualPort, host });
    let acc = Buffer.alloc(0);
    const out: Record<string, BVal>[] = [];
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("nREPL timeout")); }, timeoutMs);
    socket.on("connect", () => socket.write(benc({ id: String(Date.now()), ...msg })));
    socket.on("data", (d) => {
      acc = Buffer.concat([acc, d]);
      const decoded = tryDecodeMany(acc);
      acc = decoded.rest;
      for (const v of decoded.values) {
        const m = v as Record<string, BVal>;
        out.push(m);
        const status = Array.isArray(m.status) ? m.status.map(String) : [];
        if (status.includes("done")) { clearTimeout(timer); socket.end(); resolve(out); }
      }
    });
    socket.on("error", (e) => { clearTimeout(timer); reject(e); });
    socket.on("close", () => clearTimeout(timer));
  });
}

function nreplSummarize(msgs: Record<string, BVal>[]) {
  const stdout = msgs.map(m => typeof m.out === "string" ? m.out : "").join("");
  const stderr = msgs.map(m => typeof m.err === "string" ? m.err : "").join("");
  const values = msgs.map(m => typeof m.value === "string" ? m.value : "").filter(Boolean);
  const ex = msgs.map(m => typeof m.ex === "string" ? m.ex : "").filter(Boolean).join("\n");
  const status = [...new Set(msgs.flatMap(m => Array.isArray(m.status) ? m.status.map(String) : []))];
  return { stdout, stderr, values, ex, status };
}

function cljString(s: string) {
  return JSON.stringify(s);
}

function cljNsSymbol(ns: string) {
  return ns.replace(/^'+/, "");
}

function replText(summary: ReturnType<typeof nreplSummarize>) {
  const out = [`status: ${summary.status.join(",") || "ok"}`];
  if (summary.values.length) out.push("values:\n" + summary.values.join("\n"));
  if (summary.stdout) out.push("stdout:\n" + summary.stdout);
  if (summary.stderr) out.push("stderr:\n" + summary.stderr);
  if (summary.ex) out.push("exceptions:\n" + summary.ex);
  return out.join("\n\n");
}

async function evalClojureTool(cwd: string, code: string, ns = "user", port?: number, host = "127.0.0.1", timeoutMs = 60_000) {
  const msgs = await nreplRequest(cwd, { op: "eval", code, ns }, port, host, timeoutMs);
  const summary = nreplSummarize(msgs);
  return { msgs, summary, isError: summary.status.includes("eval-error") || summary.status.includes("error") };
}

const OPTIONAL_DEBUG_TOOLS = [
  {
    name: "cider-nrepl",
    ns: "cider.nrepl",
    install: "Add to deps.edn alias: {:aliases {:nrepl {:extra-deps {nrepl/nrepl {:mvn/version \"1.3.1\"} cider/cider-nrepl {:mvn/version \"0.56.0\"}} :main-opts [\"-m\" \"nrepl.cmdline\" \"--middleware\" \"[cider.nrepl/cider-middleware]\"]}}} then run: clojure -M:nrepl"
  },
  {
    name: "refactor-nrepl",
    ns: "refactor-nrepl.middleware",
    install: "Add refactor-nrepl/refactor-nrepl to your nREPL alias and include refactor-nrepl.middleware/wrap-refactor middleware. Usually used together with cider-nrepl."
  },
  {
    name: "FlowStorm",
    ns: "flow-storm.api",
    install: "Add com.github.flow-storm/flow-storm-dbg to a dev alias, then start with FlowStorm instrumentation. On macOS, see https://github.com/flow-storm/flow-storm-debugger for current coordinates."
  },
  {
    name: "Portal",
    ns: "portal.api",
    install: "Add djblue/portal to a dev alias, e.g. {:aliases {:dev {:extra-deps {djblue/portal {:mvn/version \"RELEASE\"}}}}}. Then evaluate (require '[portal.api :as p]) (def portal (p/open)) (add-tap #'p/submit)."
  },
  {
    name: "Reveal",
    ns: "vlaaad.reveal",
    install: "Add vlaaad/reveal to a dev alias, then start its UI from the REPL."
  },
  {
    name: "clj-async-profiler",
    ns: "clj-async-profiler.core",
    install: "macOS: brew install async-profiler graphviz. Add com.clojure-goes-fast/clj-async-profiler to a dev alias. You may need sudo or JVM permissions for profiling."
  },
  {
    name: "criterium",
    ns: "criterium.core",
    install: "Add criterium/criterium to a dev/test alias, then use criterium.core/quick-bench or bench from the REPL."
  },
  {
    name: "debux",
    ns: "debux.core",
    install: "Add philoskim/debux to a dev alias, then use debux.core/dbg and friends for inline expression tracing."
  },
  {
    name: "hashp",
    ns: "hashp.core",
    install: "Add hashp/hashp to a dev alias and require hashp.core to enable #p/#pp reader debugging forms."
  },
  {
    name: "tools.trace",
    ns: "clojure.tools.trace",
    install: "Add org.clojure/tools.trace to a dev alias, then use trace-vars/trace-ns for function call tracing."
  }
];

// ---- conservative Clojure top-level form scanner --------------------------

function isSymChar(ch: string) { return /[^\s\[\]\(\)\{\}";,]/.test(ch); }

function skipWhitespaceAndComments(src: string, i: number) {
  while (i < src.length) {
    if (/\s/.test(src[i])) { i++; continue; }
    if (src[i] === ";") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (src[i] === "#" && src[i + 1] === "_") { i += 2; i = skipForm(src, skipWhitespaceAndComments(src, i)); continue; }
    break;
  }
  return i;
}

function skipString(src: string, i: number) {
  i++;
  while (i < src.length) {
    if (src[i] === "\\") { i += 2; continue; }
    if (src[i] === '"') return i + 1;
    i++;
  }
  return i;
}

function skipRegex(src: string, i: number) { return skipString(src, i + 1); }

function skipForm(src: string, i: number): number {
  i = skipWhitespaceAndComments(src, i);
  if (src[i] === "#" && src[i + 1] === '"') return skipRegex(src, i);
  if (src[i] === '"') return skipString(src, i);
  const open = src[i];
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  if (pairs[open]) {
    const close = pairs[open]; i++;
    while (i < src.length) {
      i = skipWhitespaceAndComments(src, i);
      if (src[i] === close) return i + 1;
      i = skipForm(src, i);
    }
    return i;
  }
  while (i < src.length && isSymChar(src[i])) i++;
  return i;
}

function readSymbol(src: string, i: number): [string, number] {
  i = skipWhitespaceAndComments(src, i);
  const start = i;
  while (i < src.length && isSymChar(src[i])) i++;
  return [src.slice(start, i), i];
}

function findTopLevelDef(src: string, symbol: string) {
  let i = 0;
  while (i < src.length) {
    i = skipWhitespaceAndComments(src, i);
    if (i >= src.length) break;
    const start = i;
    const end = skipForm(src, i);
    const form = src.slice(start, end);
    if (src[start] === "(") {
      let j = skipWhitespaceAndComments(src, start + 1);
      const [head, j2] = readSymbol(src, j);
      if (["def", "defn", "defn-", "defmacro", "defonce", "defmulti", "defmethod", "defrecord", "deftype", "defprotocol", "deftest"].includes(head)) {
        const [name] = readSymbol(src, j2);
        if (name === symbol || name.endsWith("/" + symbol)) return { start, end, form, head, name };
      }
    }
    i = Math.max(end, start + 1);
  }
  return null;
}

async function clojureZprint(cwd: string) {
  const zprint = await which("zprint", cwd);
  if (!zprint) return "";

  // macOS ships /usr/bin/zprint, a kernel zone-memory diagnostic tool whose
  // options overlap with Clojure zprint (-w/-c). Do not treat it as a Clojure
  // formatter, or formatting appears to succeed while only printing memory stats.
  const probe = await exec(zprint, ["--help"], cwd, 10_000);
  const help = `${probe.stdout}\n${probe.stderr}`;
  if (/wasted memory|wired memory|kalloc|zone info/i.test(help)) return "";
  return zprint;
}

async function maybeFormatFile(file: string, cwd: string, signal?: AbortSignal) {
  const zprint = await clojureZprint(cwd);
  if (zprint) return exec(zprint, ["-w", file], cwd, 60_000, undefined, signal);
  if (await which("cljfmt", cwd)) return exec("cljfmt", ["fix", file], cwd, 60_000, undefined, signal);
  return undefined;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "clj_repl_eval",
    label: "Clojure nREPL Eval",
    description: "Evaluate Clojure code through a running nREPL. Reads .nrepl-port by default.",
    promptSnippet: "Evaluate Clojure snippets in a live nREPL and return values/stdout/errors",
    promptGuidelines: ["Use clj_repl_eval to verify Clojure behavior against a live REPL before making risky changes."],
    parameters: Type.Object({
      code: Type.String({ description: "Clojure code to evaluate" }),
      ns: Type.Optional(Type.String({ description: "Namespace, defaults to user" })),
      port: Type.Optional(Type.Number({ description: "nREPL port; defaults to .nrepl-port" })),
      host: Type.Optional(Type.String({ description: "nREPL host", default: "127.0.0.1" })),
      timeoutMs: Type.Optional(Type.Number({ default: 60000 }))
    }),
    async execute(_id, p, signal, _onUpdate, ctx) {
      try {
        const msgs = await nreplRequest(ctx.cwd, { op: "eval", code: p.code, ns: p.ns ?? "user" }, p.port, p.host ?? "127.0.0.1", p.timeoutMs ?? 60_000);
        const summary = nreplSummarize(msgs);
        const out = [`status: ${summary.status.join(",") || "ok"}`];
        if (summary.values.length) out.push("values:\n" + summary.values.join("\n"));
        if (summary.stdout) out.push("stdout:\n" + summary.stdout);
        if (summary.stderr) out.push("stderr:\n" + summary.stderr);
        if (summary.ex) out.push("exceptions:\n" + summary.ex);
        return { content: text(truncate(out.join("\n\n"))), details: summary, isError: summary.status.includes("eval-error") };
      } catch (e: any) {
        return { content: text(`nREPL error: ${e.message}`), details: { error: String(e) }, isError: true };
      }
    }
  });

  pi.registerTool({
    name: "clj_repl_op",
    label: "Clojure nREPL Op",
    description: "Send a raw nREPL op, useful for cider-nrepl/refactor-nrepl ops like info, complete, macroexpand if available.",
    parameters: Type.Object({
      op: Type.String(),
      paramsJson: Type.Optional(Type.String({ description: "JSON object merged into nREPL message" })),
      port: Type.Optional(Type.Number()),
      timeoutMs: Type.Optional(Type.Number({ default: 60000 }))
    }),
    async execute(_id, p, _signal, _onUpdate, ctx) {
      try {
        const extra = p.paramsJson ? JSON.parse(p.paramsJson) : {};
        const msgs = await nreplRequest(ctx.cwd, { op: p.op, ...extra }, p.port, "127.0.0.1", p.timeoutMs ?? 60_000);
        return { content: text(truncate(JSON.stringify(msgs, null, 2))), details: { messages: msgs } };
      } catch (e: any) {
        return { content: text(`nREPL op error: ${e.message}`), isError: true };
      }
    }
  });

  pi.registerTool({
    name: "clj_repl_macroexpand",
    label: "Clojure Macroexpand",
    description: "Macroexpand a Clojure form through nREPL. Useful for macros, threading, DSLs, re-frame, HoneySQL, etc.",
    promptSnippet: "Macroexpand Clojure forms through the live REPL",
    parameters: Type.Object({
      form: Type.String({ description: "Clojure form to macroexpand, e.g. (-> x inc str)" }),
      ns: Type.Optional(Type.String({ description: "Namespace, defaults to user" })),
      full: Type.Optional(Type.Boolean({ description: "Use macroexpand instead of macroexpand-1", default: true })),
      port: Type.Optional(Type.Number()),
      timeoutMs: Type.Optional(Type.Number({ default: 60000 }))
    }),
    async execute(_id, p, _signal, _onUpdate, ctx) {
      try {
        const op = (p.full ?? true) ? "macroexpand" : "macroexpand-1";
        const code = `(do (require 'clojure.pprint) (with-out-str (clojure.pprint/pprint (${op} '${p.form}))))`;
        const { summary, isError } = await evalClojureTool(ctx.cwd, code, p.ns ?? "user", p.port, "127.0.0.1", p.timeoutMs ?? 60_000);
        return { content: text(truncate(replText(summary))), details: summary, isError };
      } catch (e: any) {
        return { content: text(`macroexpand error: ${e.message}`), isError: true };
      }
    }
  });

  pi.registerTool({
    name: "clj_repl_inspect_var",
    label: "Clojure Inspect Var",
    description: "Inspect a var via nREPL: namespace, name, arglists, docstring, metadata, source file/line, and current value summary.",
    promptSnippet: "Inspect Clojure vars, docs, metadata, source location, and current value",
    parameters: Type.Object({
      symbol: Type.String({ description: "Fully-qualified or namespace-relative var symbol, e.g. clojure.core/map or my-fn" }),
      ns: Type.Optional(Type.String({ description: "Namespace used to resolve relative symbols, defaults to user" })),
      port: Type.Optional(Type.Number()),
      timeoutMs: Type.Optional(Type.Number({ default: 60000 }))
    }),
    async execute(_id, p, _signal, _onUpdate, ctx) {
      try {
        const code = `
(let [sym# (symbol ${cljString(p.symbol)})
      v# (or (resolve sym#)
             (when (namespace sym#) (requiring-resolve sym#)))]
  (if-not v#
    {:error (str "Could not resolve var: " sym#)}
    (let [m# (meta v#)]
      {:symbol (str (:ns m#) "/" (:name m#))
       :ns (str (:ns m#))
       :name (str (:name m#))
       :arglists (:arglists m#)
       :doc (:doc m#)
       :file (:file m#)
       :line (:line m#)
       :column (:column m#)
       :macro (:macro m#)
       :dynamic (:dynamic m#)
       :private (:private m#)
       :protocol (:protocol m#)
       :value-class (some-> @v# class str)
       :value-preview (binding [*print-length* 20 *print-level* 5]
                        (pr-str @v#))})))`;
        const { summary, isError } = await evalClojureTool(ctx.cwd, code, p.ns ?? "user", p.port, "127.0.0.1", p.timeoutMs ?? 60_000);
        return { content: text(truncate(replText(summary))), details: summary, isError };
      } catch (e: any) {
        return { content: text(`inspect var error: ${e.message}`), isError: true };
      }
    }
  });

  pi.registerTool({
    name: "clj_repl_require_reload",
    label: "Clojure Require/Reload Namespace",
    description: "Require a namespace through nREPL, optionally with :reload or :reload-all.",
    promptSnippet: "Reload Clojure namespaces in the live REPL after edits",
    parameters: Type.Object({
      namespace: Type.String({ description: "Namespace to require/reload, e.g. my.app.core" }),
      reload: Type.Optional(Type.Boolean({ default: true })),
      reloadAll: Type.Optional(Type.Boolean({ default: false })),
      ns: Type.Optional(Type.String({ description: "Current evaluation namespace, defaults to user" })),
      port: Type.Optional(Type.Number()),
      timeoutMs: Type.Optional(Type.Number({ default: 60000 }))
    }),
    async execute(_id, p, _signal, _onUpdate, ctx) {
      try {
        const opt = p.reloadAll ? " :reload-all" : (p.reload ?? true) ? " :reload" : "";
        const code = `(do (require '${cljNsSymbol(p.namespace)}${opt}) :ok)`;
        const { summary, isError } = await evalClojureTool(ctx.cwd, code, p.ns ?? "user", p.port, "127.0.0.1", p.timeoutMs ?? 60_000);
        return { content: text(truncate(replText(summary))), details: summary, isError };
      } catch (e: any) {
        return { content: text(`require/reload error: ${e.message}`), isError: true };
      }
    }
  });

  pi.registerTool({
    name: "clj_repl_run_test",
    label: "Clojure REPL Test Runner",
    description: "Run one Clojure test namespace or one test var inside the live REPL and return structured clojure.test results.",
    promptSnippet: "Run focused clojure.test tests inside nREPL after reloading code",
    parameters: Type.Object({
      namespace: Type.String({ description: "Test namespace, e.g. my.app.core-test" }),
      var: Type.Optional(Type.String({ description: "Optional test var name inside namespace, e.g. parse-test" })),
      reload: Type.Optional(Type.Boolean({ default: true })),
      ns: Type.Optional(Type.String({ default: "user" })),
      port: Type.Optional(Type.Number()),
      timeoutMs: Type.Optional(Type.Number({ default: 120000 }))
    }),
    async execute(_id, p, _signal, _onUpdate, ctx) {
      try {
        const testNs = cljNsSymbol(p.namespace);
        const code = p.var
          ? `(do (require 'clojure.test) (require '${testNs}${(p.reload ?? true) ? " :reload" : ""}) (let [v# (resolve '${testNs}/${p.var}) events# (atom [])] (if-not v# {:error "test var not found"} (do (with-redefs [clojure.test/report (fn [m#] (swap! events# conj (select-keys m# [:type :message :expected :actual :file :line :var])))] (clojure.test/test-vars [v#])) (merge {:events @events#} (frequencies (map :type @events#)))))))`
          : `(do (require 'clojure.test) (require '${testNs}${(p.reload ?? true) ? " :reload" : ""}) (clojure.test/run-tests '${testNs}))`;
        const { summary, isError } = await evalClojureTool(ctx.cwd, code, p.ns ?? "user", p.port, "127.0.0.1", p.timeoutMs ?? 120_000);
        const failed = summary.values.some(v => /:fail\s+[1-9]|:error\s+[1-9]/.test(v));
        return { content: text(truncate(replText(summary))), details: summary, isError: isError || failed };
      } catch (e: any) {
        return { content: text(`REPL test error: ${e.message}`), isError: true };
      }
    }
  });

  pi.registerTool({
    name: "clj_repl_tap_collect",
    label: "Clojure tap> Collector",
    description: "Install a temporary add-tap collector, evaluate an expression, and return all tap> values plus the result.",
    promptSnippet: "Collect tap> data emitted while evaluating Clojure expressions",
    promptGuidelines: ["Use clj_repl_tap_collect when debugging data pipelines that emit tap> values."],
    parameters: Type.Object({
      expr: Type.String({ description: "Clojure expression to evaluate while collecting tap> values" }),
      ns: Type.Optional(Type.String({ default: "user" })),
      waitMs: Type.Optional(Type.Number({ description: "Wait after evaluation for async taps", default: 100 })),
      port: Type.Optional(Type.Number()),
      timeoutMs: Type.Optional(Type.Number({ default: 60000 }))
    }),
    async execute(_id, p, _signal, _onUpdate, ctx) {
      try {
        const code = `
(let [taps# (atom [])
      tap-fn# (fn [x#] (swap! taps# conj x#))]
  (add-tap tap-fn#)
  (try
    (let [result# ${p.expr}]
      (Thread/sleep ${Math.max(0, p.waitMs ?? 100)})
      {:result result# :tap-count (count @taps#) :taps @taps#})
    (finally
      (remove-tap tap-fn#))))`;
        const { summary, isError } = await evalClojureTool(ctx.cwd, code, p.ns ?? "user", p.port, "127.0.0.1", p.timeoutMs ?? 60_000);
        return { content: text(truncate(replText(summary))), details: summary, isError };
      } catch (e: any) {
        return { content: text(`tap collect error: ${e.message}`), isError: true };
      }
    }
  });

  pi.registerTool({
    name: "clj_repl_trace",
    label: "Clojure REPL Trace Vars",
    description: "Temporarily wrap selected vars with with-redefs, evaluate an expression, and return call/return/throw events with args and values.",
    promptSnippet: "Trace selected Clojure vars around a live expression without changing source files",
    promptGuidelines: ["Use clj_repl_trace to understand data flow through pure functions and service boundaries."],
    parameters: Type.Object({
      expr: Type.String({ description: "Clojure expression to evaluate under tracing" }),
      vars: Type.Array(Type.String(), { description: "Fully-qualified vars to trace, e.g. [\"my.app/foo\", \"my.app/bar\"]" }),
      ns: Type.Optional(Type.String({ default: "user" })),
      port: Type.Optional(Type.Number()),
      timeoutMs: Type.Optional(Type.Number({ default: 60000 }))
    }),
    async execute(_id, p, _signal, _onUpdate, ctx) {
      try {
        if (!p.vars.length) return { content: text("Provide at least one fully-qualified var to trace."), isError: true };
        const bindings = p.vars.map((v: string) => `${v} (wrap# '${v} ${v})`).join("\n        ");
        const code = `
(let [events# (atom [])
      counter# (atom 0)
      safe# (fn [x#] (binding [*print-length* 30 *print-level* 6] (pr-str x#)))
      wrap# (fn [sym# f#]
              (fn [& args#]
                (let [id# (swap! counter# inc)]
                  (swap! events# conj {:event :call :id id# :var (str sym#) :args (mapv safe# args#)})
                  (try
                    (let [ret# (apply f# args#)]
                      (swap! events# conj {:event :return :id id# :var (str sym#) :value (safe# ret#)})
                      ret#)
                    (catch Throwable t#
                      (swap! events# conj {:event :throw :id id# :var (str sym#) :class (str (class t#)) :message (.getMessage t#)})
                      (throw t#))))))]
  (with-redefs [${bindings}]
    (let [result# ${p.expr}]
      {:result (safe# result#) :event-count (count @events#) :events @events#})))`;
        const { summary, isError } = await evalClojureTool(ctx.cwd, code, p.ns ?? "user", p.port, "127.0.0.1", p.timeoutMs ?? 60_000);
        return { content: text(truncate(replText(summary))), details: summary, isError };
      } catch (e: any) {
        return { content: text(`trace error: ${e.message}\nTip: vars must be fully-qualified and loaded. Use clj_repl_require_reload first.`), isError: true };
      }
    }
  });

  pi.registerTool({
    name: "clj_debug_toolkit_status",
    label: "Clojure Debug Toolkit Status",
    description: "Check optional Clojure debugging/profiling libraries in the live REPL and print macOS-focused install guidance for missing tools.",
    promptSnippet: "Check optional Clojure debug/profiling libraries and get install guidance",
    parameters: Type.Object({
      port: Type.Optional(Type.Number()),
      timeoutMs: Type.Optional(Type.Number({ default: 60000 }))
    }),
    async execute(_id, p, _signal, _onUpdate, ctx) {
      try {
        const specs = OPTIONAL_DEBUG_TOOLS.map(t => `{:name ${cljString(t.name)} :ns '${t.ns} :install ${cljString(t.install)}}`).join(" ");
        const code = `
(let [specs# [${specs}]]
  (mapv (fn [{:keys [name ns install] :as spec#}]
          (try
            (require ns)
            (assoc spec# :available true)
            (catch Throwable t#
              (assoc spec# :available false :error (.getMessage t#)))))
        specs#))`;
        const { summary, isError } = await evalClojureTool(ctx.cwd, code, "user", p.port, "127.0.0.1", p.timeoutMs ?? 60_000);
        return { content: text(truncate(replText(summary))), details: summary, isError };
      } catch (e: any) {
        return { content: text(`debug toolkit status error: ${e.message}`), isError: true };
      }
    }
  });

  pi.registerTool({
    name: "clj_lint",
    label: "Clojure Lint",
    description: "Run clj-kondo over files/directories and return diagnostics.",
    promptSnippet: "Run clj-kondo static analysis on Clojure/EDN files",
    promptGuidelines: ["Use clj_lint after editing Clojure files; fix parse errors before continuing."],
    parameters: Type.Object({
      paths: Type.Optional(Type.Array(Type.String(), { description: "Paths to lint; defaults to src,test,dev if present else ." })),
      format: Type.Optional(Type.Union([Type.Literal("text"), Type.Literal("json")], { default: "text" })),
      timeoutMs: Type.Optional(Type.Number({ default: 120000 }))
    }),
    async execute(_id, p, signal, _onUpdate, ctx) {
      if (!(await which("clj-kondo", ctx.cwd))) return { content: text("clj-kondo not found. Install: brew install borkdude/brew/clj-kondo or see https://github.com/clj-kondo/clj-kondo"), isError: true };
      const defaultPaths = (await Promise.all(["src", "test", "dev"].map(async d => await exists(path.join(ctx.cwd, d)) ? d : ""))).filter(Boolean);
      const paths = p.paths?.length ? p.paths : (defaultPaths.length ? defaultPaths : ["."]);
      const args = ["--lint", ...paths];
      if (p.format === "json") args.push("--config", "{:output {:format :json}}");
      const r = await exec("clj-kondo", args, ctx.cwd, p.timeoutMs ?? 120_000, undefined, signal);
      return { content: text(truncate([`$ ${r.command}`, r.stdout, r.stderr].filter(Boolean).join("\n"))), details: r, isError: r.code !== 0 };
    }
  });

  pi.registerTool({
    name: "clj_format",
    label: "Clojure Format",
    description: "Format Clojure files with zprint or cljfmt if installed.",
    parameters: Type.Object({
      files: Type.Array(Type.String()),
      mode: Type.Optional(Type.Union([Type.Literal("write"), Type.Literal("check")], { default: "write" }))
    }),
    async execute(_id, p, signal, _onUpdate, ctx) {
      const zprint = await clojureZprint(ctx.cwd);
      const cljfmt = await which("cljfmt", ctx.cwd);
      if (!zprint && !cljfmt) return { content: text("No Clojure formatter found. Install Clojure zprint or cljfmt."), isError: true };
      const results: ExecResult[] = [];
      if (zprint) {
        for (const file of p.files) results.push(await exec(zprint, [p.mode === "check" ? "-c" : "-w", file], ctx.cwd, 60_000, undefined, signal));
      } else {
        const args = [p.mode === "check" ? "check" : "fix", ...p.files];
        results.push(await exec("cljfmt", args, ctx.cwd, 60_000, undefined, signal));
      }
      const failed = results.some(r => r.code !== 0);
      return { content: text(truncate(results.map(r => [`$ ${r.command}`, r.stdout, r.stderr].filter(Boolean).join("\n")).join("\n\n"))), details: { results }, isError: failed };
    }
  });

  pi.registerTool({
    name: "clj_run_tests",
    label: "Clojure Tests",
    description: "Run Clojure tests via Kaocha, bb, or clojure aliases.",
    promptSnippet: "Run focused or full Clojure test suites",
    promptGuidelines: ["Use clj_run_tests with narrow selectors after changing Clojure code, then broaden if it passes."],
    parameters: Type.Object({
      selector: Type.Optional(Type.String({ description: "Kaocha selector/testable or namespace/test var, passed through where possible" })),
      command: Type.Optional(Type.String({ description: "Override command, e.g. 'bin/kaocha --focus my.ns-test'" })),
      timeoutMs: Type.Optional(Type.Number({ default: 180000 }))
    }),
    async execute(_id, p, signal, _onUpdate, ctx) {
      let cmd = p.command;
      if (!cmd) {
        if (await exists(path.join(ctx.cwd, "bin/kaocha"))) cmd = `bin/kaocha${p.selector ? " " + shellQuote(p.selector) : ""}`;
        else if (await which("kaocha", ctx.cwd)) cmd = `kaocha${p.selector ? " " + shellQuote(p.selector) : ""}`;
        else if (await exists(path.join(ctx.cwd, "bb.edn")) && await which("bb", ctx.cwd)) cmd = `bb test${p.selector ? " " + shellQuote(p.selector) : ""}`;
        else cmd = `clojure -M:test${p.selector ? " " + shellQuote(p.selector) : ""}`;
      }
      const r = await exec("/bin/sh", ["-lc", cmd], ctx.cwd, p.timeoutMs ?? 180_000, undefined, signal);
      return { content: text(truncate([`$ ${cmd}`, r.stdout, r.stderr].filter(Boolean).join("\n"))), details: r, isError: r.code !== 0 };
    }
  });

  pi.registerTool({
    name: "clj_lsp_diagnostics",
    label: "Clojure LSP Diagnostics",
    description: "Run clojure-lsp diagnostics if clojure-lsp is installed.",
    parameters: Type.Object({
      projectRoot: Type.Optional(Type.String({ default: "." })),
      timeoutMs: Type.Optional(Type.Number({ default: 120000 }))
    }),
    async execute(_id, p, signal, _onUpdate, ctx) {
      if (!(await which("clojure-lsp", ctx.cwd))) return { content: text("clojure-lsp not found. Install from https://clojure-lsp.io/"), isError: true };
      const root = p.projectRoot ?? ".";
      const candidates = [["diagnostics"], ["--diagnostics"], ["analyze", "--project-root", root]];
      const results: ExecResult[] = [];
      for (const args of candidates) {
        const r = await exec("clojure-lsp", args, ctx.cwd, p.timeoutMs ?? 120_000, undefined, signal);
        results.push(r);
        if (r.code === 0 && (r.stdout || r.stderr)) break;
      }
      const last = results[results.length - 1];
      return { content: text(truncate(results.map(r => [`$ ${r.command}`, r.stdout, r.stderr].filter(Boolean).join("\n")).join("\n\n"))), details: { results }, isError: last.code !== 0 };
    }
  });

  pi.registerTool({
    name: "clj_replace_top_level_form",
    label: "Clojure Structural Replace",
    description: "Replace a top-level def/defn/etc form by symbol name, preserving rest of file. Optionally format and lint afterwards.",
    promptSnippet: "Safely replace one top-level Clojure def form instead of fragile text edits",
    promptGuidelines: ["Prefer clj_replace_top_level_form over raw text edits when replacing complete Clojure defs/defns."],
    parameters: Type.Object({
      file: Type.String(),
      symbol: Type.String({ description: "Top-level def symbol, e.g. foo or my.ns/foo" }),
      newForm: Type.String({ description: "Replacement complete form" }),
      format: Type.Optional(Type.Boolean({ default: true })),
      lint: Type.Optional(Type.Boolean({ default: true }))
    }),
    async execute(_id, p, signal, _onUpdate, ctx) {
      const file = path.resolve(ctx.cwd, p.file);
      if (!file.startsWith(ctx.cwd)) return { content: text("Refusing to edit outside current working directory"), isError: true };
      const src = await fs.readFile(file, "utf8");
      const found = findTopLevelDef(src, p.symbol.includes("/") ? p.symbol.split("/").pop()! : p.symbol);
      if (!found) return { content: text(`No top-level def form found for symbol ${p.symbol} in ${p.file}`), isError: true };
      const replacement = p.newForm.trimEnd() + "\n";
      const next = src.slice(0, found.start) + replacement + src.slice(found.end).replace(/^\n?/, "\n");
      await fs.writeFile(file, next);
      const actions: any[] = [{ replaced: { start: found.start, end: found.end, head: found.head, name: found.name } }];
      if (p.format ?? true) actions.push({ format: await maybeFormatFile(p.file, ctx.cwd, signal) });
      if (p.lint ?? true) {
        if (await which("clj-kondo", ctx.cwd)) actions.push({ lint: await exec("clj-kondo", ["--lint", p.file], ctx.cwd, 60_000, undefined, signal) });
      }
      const failed = actions.some(a => a.lint?.code && a.lint.code !== 0 || a.format?.code && a.format.code !== 0);
      return { content: text(truncate(`Replaced ${found.head} ${found.name} in ${p.file}.\n` + JSON.stringify(actions, null, 2))), details: { actions }, isError: failed };
    }
  });

  pi.registerTool({
    name: "clj_deps_audit",
    label: "Clojure Dependency Audit",
    description: "Run antq for outdated deps and clj-watson for vulnerable deps when available.",
    parameters: Type.Object({
      runAntq: Type.Optional(Type.Boolean({ default: true })),
      runWatson: Type.Optional(Type.Boolean({ default: true })),
      timeoutMs: Type.Optional(Type.Number({ default: 180000 }))
    }),
    async execute(_id, p, signal, _onUpdate, ctx) {
      const results: ExecResult[] = [];
      if (p.runAntq ?? true) {
        if (await which("antq", ctx.cwd)) results.push(await exec("antq", [], ctx.cwd, p.timeoutMs ?? 180_000, undefined, signal));
        else if (await which("clojure", ctx.cwd)) results.push(await exec("clojure", ["-Sdeps", "{:deps {com.github.liquidz/antq {:mvn/version \"RELEASE\"}}}", "-M", "-m", "antq.core"], ctx.cwd, p.timeoutMs ?? 180_000, undefined, signal));
      }
      if (p.runWatson ?? true) {
        if (await which("clj-watson", ctx.cwd)) results.push(await exec("clj-watson", ["scan"], ctx.cwd, p.timeoutMs ?? 180_000, undefined, signal));
      }
      if (!results.length) return { content: text("No dependency audit tools found. Install antq and/or clj-watson."), isError: true };
      return { content: text(truncate(results.map(r => [`$ ${r.command}`, r.stdout, r.stderr].filter(Boolean).join("\n")).join("\n\n"))), details: { results }, isError: results.some(r => r.code !== 0) };
    }
  });

  pi.registerCommand("clojure-doctor", {
    description: "Run Clojure lint, lsp diagnostics, tests, and dependency checks where available",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Clojure doctor tools are registered. Ask the agent to run clj_lint, clj_lsp_diagnostics, clj_run_tests, and clj_deps_audit.", "info");
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.setStatus("clj", "clj tools");
  });

  pi.on("tool_result", async (event, ctx) => {
    // Lightweight safety net: after raw edits to Clojure files, remind the agent in-context to lint.
    if ((event.toolName === "edit" || event.toolName === "write") && !event.isError) {
      const input: any = event.input;
      const p = input?.path ?? "";
      if (/\.(clj|cljs|cljc|edn)$/.test(p)) {
        return { content: [...event.content, ...text("\n[Clojure Agent Toolkit] Clojure/EDN file changed. Run clj_lint and clj_format/clj_run_tests as appropriate.")] };
      }
    }
  });
}
