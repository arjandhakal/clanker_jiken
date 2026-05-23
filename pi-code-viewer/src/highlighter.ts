export interface SyntaxColors {
  comment(text: string): string;
  keyword(text: string): string;
  fn(text: string): string;
  string(text: string): string;
  number(text: string): string;
  punctuation(text: string): string;
  diffAdded(text: string): string;
  diffRemoved(text: string): string;
  diffContext(text: string): string;
  diffHunk(text: string): string;
  dim(text: string): string;
}

interface TokenMatcher {
  regex: RegExp;
  type: "comment" | "keyword" | "string" | "number" | "punctuation";
  wordBoundaryBefore?: boolean;
}

const TS_RULES: TokenMatcher[] = [
  { regex: /^\/\/.*/, type: "comment" },
  { regex: /^\/\*.*?\*\//, type: "comment" },
  { regex: /^`(?:[^`\\]|\\.)*`/, type: "string" },
  { regex: /^"(?:[^"\\]|\\.)*"/, type: "string" },
  { regex: /^'(?:[^'\\]|\\.)*'/, type: "string" },
  {
    regex:
      /^(?:function|class|const|let|var|if|else|return|import|export|from|async|await|new|this|typeof|instanceof|interface|type|enum|extends|implements|for|while|do|switch|case|break|continue|try|catch|throw|finally|yield|of|in|void|null|undefined|true|false|default|static|get|set|super|as|satisfies)\b/,
    type: "keyword",
    wordBoundaryBefore: true,
  },
  {
    regex: /^(?:0[xXoObB][\da-fA-F_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?n?)/,
    type: "number",
    wordBoundaryBefore: true,
  },
];

const CLJ_RULES: TokenMatcher[] = [
  { regex: /^;.*/, type: "comment" },
  { regex: /^"(?:[^"\\]|\\.)*"/, type: "string" },
  { regex: /^:[a-zA-Z_][\w-]*(?:\/[\w-]+)?/, type: "string" },
  {
    regex:
      /^(?:def|defn|defn-|defmacro|defmethod|defmulti|defonce|defprotocol|defrecord|deftype|deftest|testing|is|are|fn|let|if|when|when-let|when-some|if-let|if-some|cond|condp|case|do|loop|recur|ns|require|use|import|refer|as|only|try|catch|finally|throw|binding|with-redefs|doseq|dotimes|for|reduce|map|filter|remove|some|partial|comp|juxt|apply|true|false|nil)\b/,
    type: "keyword",
    wordBoundaryBefore: true,
  },
  {
    regex: /^\d+(?:\.\d+)?(?:\/\d+)?[MN]?/,
    type: "number",
    wordBoundaryBefore: true,
  },
  { regex: /^[(){}\[\]]/, type: "punctuation" },
];

const PY_RULES: TokenMatcher[] = [
  { regex: /^#.*/, type: "comment" },
  { regex: /^""".*?"""/, type: "string" },
  { regex: /^'''.*?'''/, type: "string" },
  { regex: /^"(?:[^"\\]|\\.)*"/, type: "string" },
  { regex: /^'(?:[^'\\]|\\.)*'/, type: "string" },
  {
    regex:
      /^(?:def|class|if|elif|else|for|while|return|import|from|as|with|try|except|raise|yield|async|await|lambda|pass|break|continue|and|or|not|is|in|del|global|nonlocal|assert|True|False|None)\b/,
    type: "keyword",
    wordBoundaryBefore: true,
  },
  {
    regex: /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?j?/,
    type: "number",
    wordBoundaryBefore: true,
  },
];

const GO_RULES: TokenMatcher[] = [
  { regex: /^\/\/.*/, type: "comment" },
  { regex: /^\/\*.*?\*\//, type: "comment" },
  { regex: /^"(?:[^"\\]|\\.)*"/, type: "string" },
  { regex: /^`[^`]*`/, type: "string" },
  {
    regex:
      /^(?:func|package|import|var|const|type|struct|interface|map|chan|go|defer|return|if|else|for|range|switch|case|default|select|break|continue|fallthrough|goto|nil|true|false|iota)\b/,
    type: "keyword",
    wordBoundaryBefore: true,
  },
  {
    regex: /^(?:0[xXoObB][\da-fA-F_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?)/,
    type: "number",
    wordBoundaryBefore: true,
  },
];

const RUST_RULES: TokenMatcher[] = [
  { regex: /^\/\/.*/, type: "comment" },
  { regex: /^\/\*.*?\*\//, type: "comment" },
  { regex: /^"(?:[^"\\]|\\.)*"/, type: "string" },
  {
    regex:
      /^(?:fn|let|mut|const|static|struct|enum|impl|trait|pub|mod|use|crate|super|self|Self|if|else|match|for|while|loop|break|continue|return|as|in|ref|move|async|await|where|type|dyn|unsafe|extern|true|false|None|Some|Ok|Err)\b/,
    type: "keyword",
    wordBoundaryBefore: true,
  },
  {
    regex: /^\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?(?:u8|u16|u32|u64|u128|usize|i8|i16|i32|i64|i128|isize|f32|f64)?/,
    type: "number",
    wordBoundaryBefore: true,
  },
];

const GENERIC_RULES: TokenMatcher[] = [
  { regex: /^\/\/.*/, type: "comment" },
  { regex: /^#.*/, type: "comment" },
  { regex: /^;.*/, type: "comment" },
  { regex: /^"(?:[^"\\]|\\.)*"/, type: "string" },
  { regex: /^'(?:[^'\\]|\\.)*'/, type: "string" },
  {
    regex: /^\d+(?:\.\d+)?/,
    type: "number",
    wordBoundaryBefore: true,
  },
];

const LANG_RULES: Record<string, TokenMatcher[]> = {
  typescript: TS_RULES,
  javascript: TS_RULES,
  clojure: CLJ_RULES,
  python: PY_RULES,
  go: GO_RULES,
  rust: RUST_RULES,
};

function colorize(
  text: string,
  type: TokenMatcher["type"],
  colors: SyntaxColors,
): string {
  switch (type) {
    case "comment":
      return colors.comment(text);
    case "keyword":
      return colors.keyword(text);
    case "string":
      return colors.string(text);
    case "number":
      return colors.number(text);
    case "punctuation":
      return colors.punctuation(text);
  }
}

export function highlightLine(
  line: string,
  lang: string | undefined,
  colors: SyntaxColors,
): string {
  if (!lang) return line;

  const rules = LANG_RULES[lang] || GENERIC_RULES;
  let result = "";
  let pos = 0;

  while (pos < line.length) {
    let matched = false;
    const remaining = line.substring(pos);

    for (const rule of rules) {
      if (rule.wordBoundaryBefore && pos > 0 && /\w/.test(line[pos - 1])) {
        continue;
      }

      const m = remaining.match(rule.regex);
      if (m) {
        result += colorize(m[0], rule.type, colors);
        pos += m[0].length;
        matched = true;
        break;
      }
    }

    if (!matched) {
      result += line[pos];
      pos++;
    }
  }

  return result;
}

export function highlightDiffLine(line: string, colors: SyntaxColors): string {
  if (line.startsWith("+++") || line.startsWith("---"))
    return colors.dim(line);
  if (line.startsWith("+")) return colors.diffAdded(line);
  if (line.startsWith("-")) return colors.diffRemoved(line);
  if (line.startsWith("@@")) return colors.diffHunk(line);
  return line;
}
