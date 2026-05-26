# pi-web-page-understander

Pi extension that adds `webpage_understand`, a token-efficient webpage extraction tool.

It fetches one HTML page and returns compact structured data:

- final URL, title, meta description, canonical URL
- `h1`/`h2`/`h3` headings
- cleaned main text, capped by `maxTextChars`
- optional full extracted text when the agent really needs it
- optional page links, capped by `maxLinks`

The default is deliberately compact: no links and 4,000 chars of text. Ask for links/full text only when needed.

## Usage

From this repository:

```bash
pi -e ./pi-web-page-understander/extensions/index.ts
```

Or install/load it as a pi package. The package manifest exposes `./extensions`.

## Tool

`webpage_understand` parameters:

- `url` required page URL (`https://` is assumed when omitted)
- `linkMode` optional: `none` (default), `external`, or `all`
- `textMode` optional: `compact` (default) or `full`
- `fullText` optional: boolean alias for `textMode: "full"`
- `maxTextChars` optional: default `4000` compact / `120000` full, max `250000`
- `maxLinks` optional: default `25`, max `100`
- `timeoutMs` optional: default `15000`

Example model use:

```json
{"url":"https://example.com","linkMode":"external","textMode":"compact","maxTextChars":2500,"maxLinks":20}

// Full extracted text, only when needed:
{"url":"https://example.com","textMode":"full","maxTextChars":120000}
```

## Command

Interactive command:

```text
/webpage https://example.com
```

This shows a compact JSON preview with external links.

## Notes

This extension uses lightweight HTML parsing heuristics instead of a full browser. It is fast and token-friendly, but pages that require JavaScript rendering may not expose their full content in raw HTML.
