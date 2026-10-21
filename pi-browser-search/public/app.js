const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const query = params.get('q') || '';
$('query').value = query;
$('engine-url').textContent = `${location.origin}/search?q=%s`;

function safeURL(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
function sourceLink(text, href) {
  const a = document.createElement('a');
  a.textContent = text; a.href = href; a.rel = 'noreferrer noopener'; a.target = '_blank';
  return a;
}
function showSources(sources) {
  if (!sources) return;
  $('sources-section').hidden = false;
  $('sources').replaceChildren();
  sources.results.forEach((source, i) => {
    const href = safeURL(source.url);
    if (!href) return;
    const li = document.createElement('li'); li.id = `source-${i + 1}`;
    const host = document.createElement('small'); host.textContent = new URL(href).hostname;
    const excerpt = document.createElement('p'); excerpt.textContent = source.text;
    li.append(host, sourceLink(source.title, href), excerpt); $('sources').append(li);
  });
  $('attribution').textContent = sources.attribution || '';
}
function showAnswer(answer, sources) {
  // Never insert model HTML. Recognize only bold, inline code, and known numeric citations.
  $('answer').replaceChildren();
  for (const part of answer.split(/(\[\d+\]|\*\*[^*\n]+\*\*|`[^`\n]+`)/)) {
    const number = /^\[(\d+)\]$/.exec(part)?.[1];
    const href = number && safeURL(sources?.results?.[Number(number) - 1]?.url);
    if (href) $('answer').append(sourceLink(part, href));
    else if (part.startsWith('**') && part.endsWith('**')) {
      const strong = document.createElement('strong'); strong.textContent = part.slice(2, -2); $('answer').append(strong);
    } else if (part.startsWith('`') && part.endsWith('`')) {
      const code = document.createElement('code'); code.textContent = part.slice(1, -1); $('answer').append(code);
    } else $('answer').append(document.createTextNode(part));
  }
}
async function json(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}
async function loadHistory() {
  const jobs = await json('/api/history');
  $('history').replaceChildren();
  for (const job of jobs) {
    const li = document.createElement('li'), a = document.createElement('a');
    a.textContent = job.query;
    a.href = `/search?${new URLSearchParams({ q: job.query, job: job.id })}`;
    li.append(a); $('history').append(li);
  }
  $('history-section').hidden = !jobs.length;
}
async function summarizeSearch(searchId) {
  $('summarize').disabled = true;
  $('error').textContent = '';
  $('status').textContent = 'Writing your requested AI summary…';
  try {
    const config = await json('/api/config');
    const { id } = await json('/api/summarize', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-search-token': config.token }, body: JSON.stringify({ searchId }) });
    for (;;) {
      const job = await json(`/api/jobs/${encodeURIComponent(id)}`);
      if (['done', 'error'].includes(job.status)) {
        $('answer-section').hidden = !job.answer;
        showAnswer(job.answer || '', job.sources);
        $('error').textContent = job.error || '';
        $('status').textContent = job.error ? 'Summary unavailable. Your search results are still here.' : 'AI summary ready · verify with sources';
        $('summary-controls').hidden = !job.error;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  } catch (error) {
    $('error').textContent = error.message;
    $('status').textContent = 'Summary unavailable. Your search results are still here.';
  } finally { $('summarize').disabled = false; }
}
async function main() {
  await loadHistory();
  if (!query.trim()) return;
  document.title = `${query} — Pi Search`;
  $('google').hidden = false; $('google').href = `https://www.google.com/search?${new URLSearchParams({ q: query })}`;
  $('history-section').hidden = true;
  $('status').textContent = 'Searching the live web…';
  let id = params.get('job');
  if (!id) {
    const config = await json('/api/config');
    ({ id } = await json('/api/search', { method: 'POST', headers: { 'content-type': 'application/json', 'x-search-token': config.token }, body: JSON.stringify({ query }) }));
    window.history.replaceState(null, '', `/search?${new URLSearchParams({ q: query, job: id })}`);
  }
  let shownSources = false;
  for (;;) {
    const job = await json(`/api/jobs/${encodeURIComponent(id)}`);
    if (job.sources && !shownSources) { showSources(job.sources); shownSources = true; }
    if (['done', 'error'].includes(job.status)) {
      $('error').textContent = job.error || '';
      const count = job.sources?.results?.length || 0;
      $('status').textContent = job.error ? 'Search finished with a problem.' : `${count} web results · no answer-model tokens used`;
      $('summary-controls').hidden = !count;
      $('summarize').onclick = () => summarizeSearch(id);
      if (job.answer && !job.error) $('summary-note').textContent = 'A saved AI summary is available. Clicking will reuse it without generating a new one.';
      // Even previously saved answers are shown only after an explicit click.
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
}
const start = () => main().catch((error) => {
  $('status').textContent = 'Search unavailable.'; $('error').textContent = error.message;
});
if (document.prerendering) document.addEventListener('prerenderingchange', start, { once: true }); else start();
