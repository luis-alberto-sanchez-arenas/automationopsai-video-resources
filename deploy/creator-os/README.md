# AutomationOpsAI Portable

A clean migration of the professional YouTube editorial pipeline away from AppDeploy.

## Production path

`official-source research → problem selection → outline → technical script → hostile fact-check → proof-oriented storyboard → strict Quality Gate → neural narration → FFmpeg rendering → assembly → private YouTube upload → processing verification → custom thumbnail → unlisted review`

There is deliberately no automatic transition to public.

## Removed from the AppDeploy version

- generic legacy long-form generator
- autonomous generic Shorts generator
- meSpeak/eSpeak publication fallback
- stale six-lane serverless cron wrappers
- AppDeploy SDK/runtime coupling
- realtime code not needed by publishing

## Quality invariants

- 1 long-form video at most every 72 hours
- 1000–1900-word verified script
- 10–12 scenes
- >=60% diagram/code/terminal scenes
- <=15% B-roll
- factual claims must pass >=70 confidence and official-source support
- title similarity <0.55
- script 4-gram similarity <0.14
- final AI editorial board thresholds:
  - utility >=92
  - demonstrability >=90
  - factuality >=95
  - originality >=90
  - narrative >=88
  - visual plan >=90
  - monetization safety >=95
  - thumbnail >=85
  - overall >=92
- Kokoro narration is mandatory for generated episodes; missing or failed TTS blocks the job
- Edge TTS and robotic fallback voices are intentionally unsupported

## Railway topology

Two services from the same private GitHub repository:

1. `automationopsai-web`
   - `npm run start`
   - healthcheck `/api/_healthcheck`
2. `automationopsai-worker`
   - `npm run worker`

Both point at the same PostgreSQL database. Metadata and rendered media use PostgreSQL during migration so a shared filesystem is not required. For sustained production volume, migrate `app_blobs` to S3/R2 without changing the editorial state machine.

## Required secrets

See `.env.example`.

Google OAuth must contain:

`https://<PUBLIC_ORIGIN_HOST>/api/oauth/callback`

The new OAuth authorization creates a fresh encrypted refresh token in the portable database. Existing AppDeploy secret values and encrypted refresh tokens cannot be extracted safely from AppDeploy and are not copied.

## AI provider

Preferred starter path: Gemini API through `GEMINI_API_KEY`. The provider is configurable. An OpenAI-compatible endpoint can be used instead.

## Deployment safety

Do not set a public publication target during migration. First successful deployment must be verified with one **unlisted** video:
1. healthcheck
2. Postgres
3. AI provider
4. Kokoro TTS service or a separately audited reviewed master
5. Google OAuth
6. one complete editorial Quality Gate
7. render/assembly
8. private upload
9. YouTube processing
10. thumbnail
11. unlisted review
