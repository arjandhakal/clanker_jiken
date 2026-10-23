# Attribution

Pi Context Lens is an original Pi-specific implementation inspired by nilenso's Context Viewer / Context Lens pipeline: normalization, stable deterministic role/type composition, semantic classification and weighted aggregation. No upstream implementation code or bundled CLI dependencies are incorporated. This package does not install or invoke `@nilenso/context-lens`.

Research source: https://github.com/nilenso/context-viewer at revision **d776680798bde244671498f6f58da003a30fe91a**. Relevant source: `src/parser.ts`, `src/static-componentisation.ts`, `src/segmentation.ts`, `src/componentisation.ts`, `src/aggregation.ts`, `src/add-token-counts.ts`. The GPT-4o tokenizer, OpenAI calls, model-produced regex segmentation, hosted viewer, exports and sharing behavior are not reused.

The separately published `@nilenso/context-lens` **0.1.1** was inspected from its npm tarball (SHA1 `b2ac0ed1db52cb9318c5105de2ced8b3d4fca99d`, verified against registry metadata). Its build revision was not assumed to match the browser repository. See `RESEARCH.md` for precise findings. Public research downloads are ignored development artifacts, not runtime assets.

For clarity and preservation of the original attribution, the upstream repository's complete MIT notice follows verbatim:

```text
MIT License

Copyright (c) 2025 nilenso software llp

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Pi SDK/TUI are host-provided peers, not vendored. Their own licenses continue to apply. API usage follows the installed Pi examples; the extension/UI implementation is original.
