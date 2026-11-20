---
name: code-how
description: "Explain how code works by tracing a concrete request, input, event, or value through real implementation, state ownership, and failure paths. Use for runtime walkthroughs, subsystem architecture, placement questions, and how a PR changes behavior."
---

# Code how

Read [the shared contract](../references/contract.md).

1. Find the public entry point and observable result. Follow one representative input through the actual implementation, including calls outside the diff when they affect the answer.
2. Identify the important data shapes and who owns or changes state. Explain ordering, async work, transactions, caching, or retries only where they matter.
3. For a change, compare the same scenario before and after. Distinguish unchanged infrastructure from the new mechanism.
4. Trace at least the relevant failure or boundary path: bad input, missing data, authorization, cancellation, duplicate work, or dependency failure. Do not invent guarantees that the implementation lacks.
5. Check call sites, registration/wiring, and tests to confirm the path is reachable. Distinguish a definition from an active caller and a test expectation from observed execution.

Answer in this order when it fits: short overview, concrete flow, important ownership/boundaries, and non-obvious limitations. Use a handful of path/symbol anchors so the reader knows where to look next. Explain responsibilities and causal connections rather than paraphrasing every line.

Use code-why for historical reasons. Code shape alone cannot establish why an author chose it.
