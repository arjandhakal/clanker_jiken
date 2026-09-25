---
name: research-kb
description: Research a codebase or technical topic deeply and preserve verified findings in the repo-scoped local research knowledge base. Use when the user asks to research, investigate, explain architecture, build lasting understanding, create a research note, or update/remove prior research.
license: MIT
---

# Research knowledge base

Produce durable understanding, not a transcript of searches. The knowledge base is local to the user, outside git, and shared by Pi sessions working in the same repository.

## Before researching

1. Call `research_kb` with `action=list` to inspect the concise catalog.
2. If an existing note may answer part of the request, call `action=search`, then `action=read` for relevant results.
3. Decide whether to create a new note or update an existing one. Prefer updating when the topic and scope materially overlap.
4. Respect the requested output format: `markdown`, `org`, or `html`. If none was requested, use Markdown.

Do not create a duplicate note merely because its title differs. Use the catalog summaries, tags, and related files to identify overlap.

## Research method

For codebase research:

1. Map the relevant area before forming conclusions. Use fast path/content discovery tools such as `fffind` and `ffgrep` when available, then read the authoritative files.
2. Follow definitions, callers, configuration, tests, and documentation. Do not infer behavior from filenames alone.
3. Distinguish verified behavior from interpretation and open questions.
4. Cite repository paths and important symbols. Include line ranges only when they are stable and useful.
5. Run focused, read-only checks where useful. Never claim a command or behavior was verified unless it was actually checked.

For external research:

1. Use current web search when freshness matters.
2. Open primary sources instead of relying only on search snippets.
3. Record source URLs and access context in the note metadata and cite them in the body.
4. Reconcile contradictions explicitly. Mark anything unverified in those words.

## Quality bar

A useful research note should normally contain:

- the question and scope
- a short answer or executive summary
- a clear mental model
- architecture/data/control flow where relevant
- key files, symbols, commands, or external sources
- evidence for important claims
- caveats, uncertainty, and open questions
- practical implications or next steps

Keep the catalog `summary` extremely concise: one sentence, ideally under 160 characters, describing what the note lets a future agent understand.

Use tags for stable concepts, not every noun. Put repository-relative paths in the `files` metadata field. Put URLs or bibliographic references in `sources`.

## Format rules

### Markdown

Use a descriptive H1 and ordinary Markdown. Prefer diagrams in Mermaid only if the renderer is expected to support it; otherwise use compact text diagrams.

### Org

Start with `#+TITLE:` and use proper Org headings (`*`, `**`). Use `[[file:path][label]]` and `[[https://...][label]]` links when appropriate.

### HTML

Create a complete, self-contained HTML document:

- include `<!doctype html>` and `<meta charset="utf-8">`
- inline CSS and any scripts
- no CDN, web fonts, remote images, external stylesheets, or external scripts
- support light and dark color schemes
- make dense material scannable with a table of contents, cards/tables only where useful, and readable typography
- links to cited web sources may remain ordinary external hyperlinks

HTML is for understanding visually. Apply the core principle from Charlie Hills' MIT-licensed `show-me` skill: a render that was never opened and inspected has not been delivered. After saving HTML, use `/research open <id>` or report the path so the user can open it.

## Saving

After the research is complete, call `research_kb`:

- `action=create` with `title`, succinct `summary`, `format`, full `content`, and useful `tags`, `files`, and `sources`; or
- `action=update` with the existing `id` and the changed metadata/content.

Do not save partial search output as the final note. Synthesize first.

After saving, report:

- note ID and title
- format and path
- whether it was created or updated
- the one-sentence catalog summary

## Updating and removal

When asked to update a note, read it first, verify the changed facts, preserve still-valid useful material, and then use `action=update`.

When asked to remove knowledge, list/search if the target is ambiguous. Use `action=remove` only after the intended note is clear. Slash-command removal asks the user for confirmation; agent tool removal should only be used on an explicit user request.
