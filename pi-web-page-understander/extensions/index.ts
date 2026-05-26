import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_TEXT_CHARS = 4_000;
const DEFAULT_FULL_TEXT_CHARS = 120_000;
const DEFAULT_MAX_LINKS = 25;
const MAX_TEXT_CHARS_LIMIT = 250_000;
const MAX_LINKS_LIMIT = 100;
const MAX_HTML_BYTES = 2_000_000;

type LinkMode = "none" | "external" | "all";
type TextMode = "compact" | "full";
type Heading = { level: 1 | 2 | 3; text: string };
type PageLink = { text: string; url: string; external: boolean };

type WebPageParams = {
	url: string;
	linkMode?: LinkMode;
	textMode?: TextMode;
	fullText?: boolean;
	maxTextChars?: number;
	maxLinks?: number;
	timeoutMs?: number;
};

function boundedInt(value: unknown, fallback: number, min: number, max: number) {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.max(min, Math.min(Math.trunc(value), max));
}

function truncate(text: string, maxChars: number) {
	return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n[+${text.length - maxChars} chars truncated]`;
}

function decodeEntities(text: string) {
	const named: Record<string, string> = {
		amp: "&",
		lt: "<",
		gt: ">",
		quot: '"',
		apos: "'",
		nbsp: " ",
		copy: "©",
		reg: "®",
	};

	return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/g, (match, entity: string) => {
		if (entity[0] === "#") {
			const hex = entity[1]?.toLowerCase() === "x";
			const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : match;
		}
		return named[entity] ?? match;
	});
}

function cleanText(text: string) {
	return decodeEntities(text)
		.replace(/\s+/g, " ")
		.replace(/[ \t]*\n[ \t]*/g, "\n")
		.trim();
}

function stripTags(html: string) {
	return cleanText(html.replace(/<[^>]*>/g, " "));
}

function firstMatch(html: string, pattern: RegExp) {
	const match = html.match(pattern);
	return match ? stripTags(match[1] ?? match[2] ?? "") : undefined;
}

function attrValue(tag: string, attr: string) {
	const pattern = new RegExp(`${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
	const match = tag.match(pattern);
	return match ? decodeEntities(match[1] ?? match[2] ?? match[3] ?? "").trim() : undefined;
}

function metaContent(html: string, key: string) {
	const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
	for (const tag of metas) {
		const name = attrValue(tag, "name")?.toLowerCase();
		const property = attrValue(tag, "property")?.toLowerCase();
		if (name === key.toLowerCase() || property === key.toLowerCase()) {
			const content = attrValue(tag, "content");
			if (content) return cleanText(content);
		}
	}
	return undefined;
}

function canonicalUrl(html: string, base: string) {
	const links = html.match(/<link\b[^>]*>/gi) ?? [];
	for (const tag of links) {
		if (attrValue(tag, "rel")?.toLowerCase().split(/\s+/).includes("canonical")) {
			const href = attrValue(tag, "href");
			if (!href) return undefined;
			try {
				return new URL(href, base).toString();
			} catch {
				return undefined;
			}
		}
	}
	return undefined;
}

function removeNoisyHtml(html: string) {
	return html
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(/<script\b[\s\S]*?<\/script>/gi, " ")
		.replace(/<style\b[\s\S]*?<\/style>/gi, " ")
		.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
		.replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
		.replace(/<iframe\b[\s\S]*?<\/iframe>/gi, " ")
		.replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, " ");
}

function extractHeadings(html: string) {
	const headings: Heading[] = [];
	for (const match of html.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
		const text = stripTags(match[2] ?? "");
		if (text) headings.push({ level: Number(match[1]) as 1 | 2 | 3, text });
	}
	return headings.slice(0, 30);
}

function extractLinks(html: string, base: string, linkMode: LinkMode, maxLinks: number) {
	if (linkMode === "none") return [];

	const baseUrl = new URL(base);
	const seen = new Set<string>();
	const links: PageLink[] = [];
	for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
		const href = attrValue(match[1] ?? "", "href");
		if (!href || href.startsWith("#") || /^(javascript|mailto|tel):/i.test(href)) continue;

		let url: URL;
		try {
			url = new URL(href, baseUrl);
		} catch {
			continue;
		}

		if (!/^https?:$/i.test(url.protocol)) continue;
		url.hash = "";
		const external = url.hostname.replace(/^www\./, "") !== baseUrl.hostname.replace(/^www\./, "");
		if (linkMode === "external" && !external) continue;

		const key = url.toString();
		if (seen.has(key)) continue;
		seen.add(key);
		links.push({ text: truncate(stripTags(match[2] ?? ""), 120), url: key, external });
		if (links.length >= maxLinks) break;
	}
	return links;
}

function htmlToMainText(html: string, maxChars: number, compact: boolean) {
	const article = html.match(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2];
	const source = removeNoisyHtml(article ?? html)
		.replace(/<(h[1-6]|p|li|blockquote|pre|tr|section|article|main|div)\b[^>]*>/gi, "\n")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/li>/gi, "\n")
		.replace(/<[^>]*>/g, " ");

	const lines = decodeEntities(source)
		.split(/\n+/)
		.map((line) => line.replace(/\s+/g, " ").trim())
		.filter((line) => compact ? line.length >= 25 : line.length > 0);

	if (!compact) return truncate(lines.join("\n"), maxChars);

	const seen = new Set<string>();
	const deduped: string[] = [];
	for (const line of lines) {
		const key = line.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(line);
	}

	return truncate(deduped.join("\n"), maxChars);
}

async function fetchHtml(url: string, timeoutMs: number, signal?: AbortSignal) {
	const timeoutController = new AbortController();
	const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
	const abort = () => timeoutController.abort();
	signal?.addEventListener("abort", abort, { once: true });

	try {
		const response = await fetch(url, {
			headers: {
				accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
				"user-agent": "pi-web-page-understander/0.1 (+https://pi.dev)",
			},
			redirect: "follow",
			signal: timeoutController.signal,
		});

		const contentType = response.headers.get("content-type") ?? "";
		if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
		if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
			throw new Error(`Expected HTML but got content-type: ${contentType}`);
		}

		const reader = response.body?.getReader();
		if (!reader) return { html: await response.text(), finalUrl: response.url, contentType };

		const chunks: Uint8Array[] = [];
		let bytes = 0;
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			bytes += value.byteLength;
			if (bytes > MAX_HTML_BYTES) throw new Error(`HTML exceeds ${MAX_HTML_BYTES} bytes; refusing token-heavy page.`);
			chunks.push(value);
		}

		const data = new Uint8Array(bytes);
		let offset = 0;
		for (const chunk of chunks) {
			data.set(chunk, offset);
			offset += chunk.byteLength;
		}

		return { html: new TextDecoder().decode(data), finalUrl: response.url, contentType };
	} finally {
		clearTimeout(timeout);
		signal?.removeEventListener("abort", abort);
	}
}

async function understandWebPage(params: WebPageParams, signal?: AbortSignal) {
	if (!params.url?.trim()) throw new Error("webpage_understand requires a URL.");
	const inputUrl = /^https?:\/\//i.test(params.url) ? params.url : `https://${params.url}`;
	const textMode: TextMode = params.fullText ? "full" : params.textMode ?? "compact";
	const maxTextChars = boundedInt(params.maxTextChars, textMode === "full" ? DEFAULT_FULL_TEXT_CHARS : DEFAULT_MAX_TEXT_CHARS, 500, MAX_TEXT_CHARS_LIMIT);
	const maxLinks = boundedInt(params.maxLinks, DEFAULT_MAX_LINKS, 0, MAX_LINKS_LIMIT);
	const timeoutMs = boundedInt(params.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 60_000);
	const linkMode = params.linkMode ?? "none";

	const { html, finalUrl, contentType } = await fetchHtml(inputUrl, timeoutMs, signal);
	const cleanHtml = removeNoisyHtml(html);
	const title = firstMatch(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i) ?? metaContent(html, "og:title");
	const description = metaContent(html, "description") ?? metaContent(html, "og:description");
	const headings = extractHeadings(cleanHtml);
	const links = extractLinks(cleanHtml, finalUrl, linkMode, maxLinks);
	const text = htmlToMainText(cleanHtml, maxTextChars, textMode === "compact");

	return {
		url: inputUrl,
		finalUrl,
		contentType,
		title,
		description,
		canonical: canonicalUrl(html, finalUrl),
		headings: {
			h1: headings.filter((h) => h.level === 1).map((h) => h.text),
			h2: headings.filter((h) => h.level === 2).map((h) => h.text),
			h3: headings.filter((h) => h.level === 3).map((h) => h.text),
		},
		text,
		links,
		limits: { maxTextChars, maxLinks, linkMode, textMode },
	};
}

export default function webPageUnderstanderExtension(pi: ExtensionAPI) {
	pi.registerCommand("webpage", {
		description: "Fetch a URL and show compact page structure. Usage: /webpage <url>",
		handler: async (args, ctx) => {
			const url = args.trim();
			if (!url) {
				ctx.ui.notify("Usage: /webpage <url>", "warning");
				return;
			}

			try {
				const result = await understandWebPage({ url, linkMode: "external", maxTextChars: 2_000, maxLinks: 15 }, ctx.signal);
				ctx.ui.notify(JSON.stringify(result, null, 2), "info");
			} catch (err) {
				ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
			}
		},
	});

	pi.registerTool({
		name: "webpage_understand",
		label: "Understand Web Page",
		description: "Fetch one web page and return compact structured data: title, description, headings, main text, and optional links.",
		promptSnippet: "Fetch one URL and extract compact structured page content for token-efficient understanding",
		promptGuidelines: [
			"Use webpage_understand when the user gives a URL or asks to understand/summarize a specific webpage.",
			"Call webpage_understand with linkMode=none unless the user asks for links or links are needed; use linkMode=external for outbound references.",
			"Call webpage_understand with textMode=compact first; use textMode=full or fullText=true only when the agent truly needs the full extracted page text.",
			"Prefer small maxTextChars values first; request more text only if needed to answer accurately.",
		],
		parameters: Type.Object({
			url: Type.String({ description: "Web page URL. https:// is assumed when omitted." }),
			linkMode: Type.Optional(
				Type.Unsafe<LinkMode>({
					type: "string",
					enum: ["none", "external", "all"],
					description: "Which links to include. Default: none for minimal tokens.",
				}),
			),
			textMode: Type.Optional(
				Type.Unsafe<TextMode>({
					type: "string",
					enum: ["compact", "full"],
					description: "compact removes noise/deduplicates. full returns all extracted text lines up to maxTextChars. Default: compact.",
				}),
			),
			fullText: Type.Optional(Type.Boolean({ description: "Alias for textMode=full. Use only when full extracted page text is needed." })),
			maxTextChars: Type.Optional(Type.Number({ description: "Maximum extracted text chars. Default 4000 compact / 120000 full, max 250000." })),
			maxLinks: Type.Optional(Type.Number({ description: "Maximum links to return. Default 25, max 100." })),
			timeoutMs: Type.Optional(Type.Number({ description: "Fetch timeout in milliseconds. Default 15000." })),
		}),
		async execute(_toolCallId, params: WebPageParams, signal) {
			const result = await understandWebPage(params, signal);
			return {
				content: [{ type: "text", text: JSON.stringify(result) }],
				details: result,
			};
		},
	});
}
