# pi-web-search

Pi extension that adds a `web_search` tool backed by a local SearXNG/Search XNG instance.

Default endpoint: `http://localhost:8888/search?q=<query>&format=json`

## Usage

From this repository:

```bash
pi -e ./pi-web-search/extensions/index.ts
```

Or install/load it as a pi package. The package manifest exposes `./extensions`.

## Configuration

Set one of these environment variables to override the SearXNG base URL:

```bash
export SEARCH_XNG_URL=http://localhost:8888
# or
export SEARXNG_URL=http://localhost:8888
```

SearXNG must have JSON output enabled in `settings.yml` (`search.formats` includes `json`), otherwise SearXNG returns HTTP 403 for `format=json`.

This extension uses only the SearXNG JSON API. It does not scrape or parse HTML as a fallback.

## Tool

`web_search` parameters:

- `query` required search query
- `baseUrl` optional SearXNG base URL
- `categories`, `engines`, `language`, `pageno`, `time_range`, `safesearch`, `maxResults`
- `pageNo` and `timeRange` are accepted as aliases for compatibility

The tool returns ranked result titles, snippets, URLs, engines/categories, published dates, scores, and selected SearXNG JSON metadata when available.
