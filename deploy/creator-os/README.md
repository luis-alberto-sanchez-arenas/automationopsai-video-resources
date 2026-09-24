# AutomationOpsAI Portable

A clean migration of the professional YouTube editorial pipeline away from AppDeploy.

## Production path

`analytics → official-source research → competitive gap → topic-specific renderer → strict audiovisual QA → reviewed-master upload → private YouTube processing → custom thumbnail → scheduled/public release`

The generic built-in editorial renderer is disabled by default because its
card-based visual language is not sufficient for public monetization-oriented
releases. Public automation accepts only reviewed masters produced by a
topic-specific renderer and passing the complete QA manifest.

## Removed from the AppDeploy version

- generic legacy long-form generator
- autonomous generic Shorts generator
- meSpeak/eSpeak publication fallback
- stale six-lane serverless cron wrappers
- AppDeploy SDK/runtime coupling
- realtime code not needed by publishing

## Quality invariants

- release targets: Shorts at 06:00, 15:00 and 22:00; standard video at 11:00 (America/Mexico_City)
- missed slots never release a lower-quality fallback; the reviewed master remains queued
- 1000–1900-word verified script
- 10–12 scenes
- >=75% demonstrative/action scenes
- <=10% licensed B-roll; prefer original execution capture and procedural motion
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

## TikTok Direct Post

The web and worker services support the official Content Posting API. Configure the same values on both services:

- `TIKTOK_CLIENT_KEY`
- `TIKTOK_CLIENT_SECRET`
- `TIKTOK_MIRROR_ENABLED=true`
- `TIKTOK_PRIVACY_LEVEL=PUBLIC_TO_EVERYONE`

Register this exact Web redirect URI in TikTok Login Kit:

`https://automationopsai-web-v2-production.up.railway.app/api/tiktok/oauth/callback/`

Use `SELF_ONLY` and keep mirroring disabled while testing an unaudited client. Public Direct Post requires TikTok approval for `video.publish`; the dashboard intentionally reports the integration as pending until credentials and account authorization are present.

## AI provider

Preferred starter path: Gemini API through `GEMINI_API_KEY`. The provider is configurable. An OpenAI-compatible endpoint can be used instead. Billing/quota failures receive long circuit-breaker cooldowns; the worker must never retry a depleted provider every minute.

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
