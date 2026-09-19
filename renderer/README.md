# Measured scene renderer

Original programmatic diagrams and text, rendered to ASS subtitles and H.264 video using FFmpeg/libass and DejaVu fonts.

```sh
node renderer/preview.mjs /tmp/automationops-preview
```

Prerequisites: Node.js 20+, FFmpeg built with libass, DejaVu Sans and DejaVu Sans Mono. The demo is a silent 24-second visual regression preview. Its cues are synthetic; production cues come from the durations of spoken segments.

Features: measured glyph widths, bounded text blocks, code pagination without truncation, preserved JSON braces, explicit graph edges, progressive node/edge construction, active-step emphasis, and rejection of oversized titles. Metric scenes use equal cards rather than invented bar heights. Text geometry is checked before rendering. Unknown glyphs use a conservative fallback width; fonts must match the supplied metrics.

`integration.patch` adapts the existing AutomationOpsAI `backend/editorial.ts` to this renderer, extends scene schemas with explicit edges, and adds deterministic layout checks. Apply only to the matching source version and review the diff. Copy `scene-renderer.mjs` and `font-metrics.json` beside `editorial.ts`.

This renderer does not certify factual correctness, asset rights, audience demand, or YouTube monetization eligibility. Those require separate editorial and platform review.
