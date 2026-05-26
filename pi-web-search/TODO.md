# pi-web-search TODO

- [x] Remove the current `web_search` extension implementation.
- [x] Rebuild the extension from the beginning using only the SearXNG JSON API.
- [x] Keep the same package/folder layout as the other pi extensions:
  - `pi-web-search/package.json`
  - `pi-web-search/extensions/index.ts`
  - `pi-web-search/README.md`
- [x] Implement `GET /search?q=<query>&format=json` against the configured local Search XNG/SearXNG base URL.
- [x] Default base URL to `http://localhost:8888`.
- [x] Support optional query parameters: `categories`, `engines`, `language`, `pageno`, `time_range`, `safesearch`, and `maxResults`.
- [x] Return a result list containing titles, snippets, URLs, engines/categories, published dates, and scores when available.
- [x] Do not implement HTML scraping fallback.
- [x] Surface a clear error if JSON output is not enabled and SearXNG returns `403`.
- [ ] After Docker is rerun with JSON enabled, test with:
  ```bash
  curl 'http://localhost:8888/search?q=searxng&format=json'
  ```
- [ ] Reload pi and verify the `web_search` tool in a real session.
