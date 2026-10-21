export function normalizeSearch(data) {
  if (!Array.isArray(data?.results)) throw new Error('Radius returned an invalid search response');
  return {
    results: data.results.flatMap((r) => {
      try {
        const url = new URL(r.url);
        if (!['https:', 'http:'].includes(url.protocol)) return [];
        return [{ title: String(r.title || url.hostname).slice(0, 1000), url: url.href,
          text: String(r.text || '').slice(0, 10000), publishDate: r.publishDate || null }];
      } catch { return []; }
    }).slice(0, 8),
    attribution: typeof data.provider?.attribution === 'string' ? data.provider.attribution : '',
  };
}

export function createRadiusSearch(models, gateway = 'https://radius.pi.dev', fetcher = fetch) {
  const base = new URL(gateway);
  if (base.protocol !== 'https:' || base.username || base.password) throw new Error('Radius gateway must use HTTPS');
  return async (query, signal) => {
    const auth = await models.getAuth('radius', { signal });
    if (!auth) throw new Error('Radius is not signed in. Run pi, then /login and choose Radius.');
    const headers = new Headers(auth.auth.headers);
    if (!headers.has('authorization') && auth.auth.apiKey) headers.set('authorization', `Bearer ${auth.auth.apiKey}`);
    headers.set('content-type', 'application/json');
    const response = await fetcher(new URL('/v1/search', base), {
      method: 'POST', headers, signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
      body: JSON.stringify({ query, max_results: 8 }), redirect: 'error',
    });
    if (!response.ok) throw new Error(`Radius search failed (HTTP ${response.status}). Check Radius login, web-search policy, and credits.`);
    return normalizeSearch(await response.json());
  };
}
