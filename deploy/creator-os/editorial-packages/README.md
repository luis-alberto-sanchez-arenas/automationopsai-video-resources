# ChatGPT membership editorial bridge

This directory is the audited hand-off between ChatGPT Work/Codex and the
AutomationOpsAI Railway worker. It does **not** turn a ChatGPT subscription into
API credit and it never stores ChatGPT, Google, TikTok, Railway or admin tokens.

## Flow

1. ChatGPT/Codex researches a current gap and writes one complete editorial
   package from official sources.
2. The package is checked against `schema-v1.json` and committed as
   `inbox/<package-key>.json`.
3. Railway rebuilds from GitHub. The worker re-downloads every cited page and
   rejects the package unless each evidence excerpt is still present.
4. The worker applies deterministic originality, proof-density, metadata,
   rights and narration/storyboard-sync gates.
5. Only a passing package enters render, audiovisual QA and the existing
   YouTube publication queue.

The bridge currently accepts `format: "standard"` only. A Short must not be
disguised as a standard video; vertical rendering and Short-specific retention
checks require their own reviewed renderer before this schema is extended.

## Required invariants

- `createdAt` is no more than seven days old.
- 3+ live HTTPS official sources with exact evidence excerpts.
- 1,000–1,900 word final narration.
- 10–12 consecutive demonstrative scenes.
- Concatenated scene narration exactly equals the final script.
- No third-party media; visuals are original or procedural and cleared for
  commercial use.
- Synthetic narration is disclosed.
- The external review meets the same score thresholds as the internal board.

Invalid files remain unimported and are reported in worker logs. Import is
idempotent: `packageKey` becomes `chatgpt-<packageKey>` in the database.

