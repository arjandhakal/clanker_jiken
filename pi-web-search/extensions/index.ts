import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

const DEFAULT_BASE_URL = "http://localhost:8888";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESULTS = 10;
const MAX_RESULTS_LIMIT = 50;
const MAX_RESPONSE_CHARS = 20_000;

type TimeRange = "day" | "month" | "year";
type SafeSearch = 0 | 1 | 2;

type SearchParams = {
	query: string;
	baseUrl?: string;
	categories?: string;
	engines?: string;
	language?: string;
	pageno?: number;
	pageNo?: number;
	time_range?: TimeRange;
	timeRange?: TimeRange;
	safesearch?: SafeSearch;
	maxResults?: number;
};

type SearxngResult = {
	title?: unknown;
	content?: unknown;
	url?: unknown;
	engine?: unknown;
	engines?: unknown;
	category?: unknown;
	categories?: unknown;
	publishedDate?: unknown;
	published_date?: unknown;
	score?: unknown;
};

type WebSearchResult = {
	title: string;
	snippet: string;
	url: string;
	engines?: string[];
	categories?: string[];
	publishedDate?: string;
	score?: number;
};

function truncate(text: string, maxChars = MAX_RESPONSE_CHARS) {
	return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} chars]`;
}

function baseUrlFrom(params: SearchParams) {
	return params.baseUrl ?? process.env.SEARCH_XNG_URL ?? process.env.SEARXNG_URL ?? DEFAULT_BASE_URL;
}

function searchEndpoint(baseUrl: string) {
	return new URL("search", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
}

function boundedMaxResults(maxResults: unknown) {
	if (typeof maxResults !== "number" || !Number.isFinite(maxResults)) return DEFAULT_MAX_RESULTS;
	return Math.max(1, Math.min(Math.trunc(maxResults), MAX_RESULTS_LIMIT));
}

function strings(value: unknown): string[] | undefined {
	if (typeof value === "string" && value.trim()) return [value];
	if (Array.isArray(value)) {
		const values = value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
		return values.length ? values : undefined;
	}
	return undefined;
}

function stringValue(value: unknown) {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown) {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeResult(result: SearxngResult): WebSearchResult | undefined {
	const url = stringValue(result.url);
	if (!url) return undefined;

	return {
		title: stringValue(result.title) ?? url,
		snippet: stringValue(result.content) ?? "",
		url,
		engines: strings(result.engines) ?? strings(result.engine),
		categories: strings(result.categories) ?? strings(result.category),
		publishedDate: stringValue(result.publishedDate) ?? stringValue(result.published_date),
		score: numberValue(result.score),
	};
}

function requestUrl(params: SearchParams) {
	const baseUrl = baseUrlFrom(params);
	const url = searchEndpoint(baseUrl);
	url.searchParams.set("q", params.query);
	url.searchParams.set("format", "json");
	if (params.categories) url.searchParams.set("categories", params.categories);
	if (params.engines) url.searchParams.set("engines", params.engines);
	if (params.language) url.searchParams.set("language", params.language);
	if (params.pageno !== undefined || params.pageNo !== undefined) url.searchParams.set("pageno", String(params.pageno ?? params.pageNo));
	if (params.time_range ?? params.timeRange) url.searchParams.set("time_range", params.time_range ?? params.timeRange ?? "");
	if (params.safesearch !== undefined) url.searchParams.set("safesearch", String(params.safesearch));
	return { baseUrl, url };
}

async function searxngJsonSearch(params: SearchParams, signal?: AbortSignal) {
	if (!params.query?.trim()) throw new Error("web_search requires a non-empty query.");

	const timeoutController = new AbortController();
	const timeout = setTimeout(() => timeoutController.abort(), DEFAULT_TIMEOUT_MS);
	const abort = () => timeoutController.abort();
	signal?.addEventListener("abort", abort, { once: true });

	try {
		const maxResults = boundedMaxResults(params.maxResults);
		const { baseUrl, url } = requestUrl(params);
		const response = await fetch(url, {
			headers: { accept: "application/json" },
			signal: timeoutController.signal,
		});
		const body = await response.text();

		if (response.status === 403) {
			throw new Error(
				`SearXNG returned HTTP 403 for ${url.toString()}. JSON output is probably disabled. Enable JSON in settings.yml, e.g. search.formats includes json.`,
			);
		}
		if (!response.ok) {
			throw new Error(`SearXNG JSON search failed with HTTP ${response.status}: ${truncate(body, 2_000)}`);
		}

		let data: any;
		try {
			data = JSON.parse(body);
		} catch (err) {
			throw new Error(`SearXNG did not return valid JSON. Ensure the instance supports format=json. ${err instanceof Error ? err.message : String(err)}`);
		}

		const results = Array.isArray(data.results)
			? data.results.map(normalizeResult).filter((result: WebSearchResult | undefined): result is WebSearchResult => Boolean(result)).slice(0, maxResults)
			: [];

		return {
			query: typeof data.query === "string" ? data.query : params.query,
			baseUrl,
			requestUrl: url.toString(),
			format: "json",
			numberOfResults: numberValue(data.number_of_results),
			results,
			answers: Array.isArray(data.answers) ? data.answers : undefined,
			corrections: Array.isArray(data.corrections) ? data.corrections : undefined,
			infoboxes: Array.isArray(data.infoboxes) ? data.infoboxes : undefined,
		};
	} finally {
		clearTimeout(timeout);
		signal?.removeEventListener("abort", abort);
	}
}

export default function webSearchExtension(pi: ExtensionAPI) {
	pi.registerCommand("web-search", {
		description: "Search the web through local SearXNG JSON API. Usage: /web-search <query>",
		handler: async (args, ctx) => {
			const query = args.trim();
			if (!query) {
				ctx.ui.notify("Usage: /web-search <query>", "warning");
				return;
			}

			try {
				const result = await searxngJsonSearch({ query, maxResults: 5 }, ctx.signal);
				const lines = result.results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ""}`);
				ctx.ui.notify(lines.length ? lines.join("\n\n") : `No results for: ${query}`, "info");
			} catch (err) {
				ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
			}
		},
	});

	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description: "Search a local SearXNG instance using only the JSON API and return ranked web results.",
		promptSnippet: "Search the web through local SearXNG JSON API and return ranked titles, snippets, URLs, and metadata",
		promptGuidelines: [
			"Use web_search when the user asks for current, external, or web-based information that may not be in the model's training data.",
			"After using web_search, cite the URLs from the returned results when answering factual questions.",
		],
		parameters: Type.Object({
			query: Type.String({ description: "Search query string" }),
			baseUrl: Type.Optional(Type.String({ description: "SearXNG base URL. Defaults to SEARCH_XNG_URL, SEARXNG_URL, or http://localhost:8888" })),
			categories: Type.Optional(Type.String({ description: "Comma-separated SearXNG categories, e.g. general,news,it" })),
			engines: Type.Optional(Type.String({ description: "Comma-separated SearXNG engines to use" })),
			language: Type.Optional(Type.String({ description: "Language code, e.g. en, en-US, ja" })),
			pageno: Type.Optional(Type.Number({ description: "SearXNG page number. Defaults to 1" })),
			pageNo: Type.Optional(Type.Number({ description: "Alias for pageno" })),
			time_range: Type.Optional(StringEnum(["day", "month", "year"] as const)),
			timeRange: Type.Optional(StringEnum(["day", "month", "year"] as const)),
			safesearch: Type.Optional(Type.Number({ description: "Safe search level: 0, 1, or 2" })),
			maxResults: Type.Optional(Type.Number({ description: "Maximum number of results to return, 1-50. Defaults to 10" })),
		}),
		async execute(_toolCallId, params, signal, onUpdate) {
			onUpdate?.({ content: [{ type: "text", text: `Searching SearXNG JSON API for: ${params.query}` }], details: { query: params.query } });
			const result = await searxngJsonSearch(params as SearchParams, signal);
			return {
				content: [{ type: "text", text: truncate(JSON.stringify(result, null, 2)) }],
				details: result,
			};
		},
	});
}
