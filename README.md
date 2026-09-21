# AutomationOpsAI — reproducible video resources

Examples and original renderer code for AutomationOpsAI tutorials.

## JSON parsing tutorial

[Watch the published tutorial](https://www.youtube.com/watch?v=jMe7vz0CZ5w) · [Run the companion exercise](examples/n8n-ai-json-parser/)

The companion exercise is a deterministic reproduction added after the video. It is not an export of the exact workflow in the recording. It needs no token and makes no external API calls.

```sh
node examples/n8n-ai-json-parser/test.mjs
```

Expected: **10 cases passed**. You can also import [workflow.json](examples/n8n-ai-json-parser/workflow.json) into n8n. Local validation tests pass; execution in a real n8n instance remains unverified.

## Visual renderer

[Renderer and reproduction instructions](renderer/) provide progressive diagrams, explicit data-flow arrows, measured text wrapping, preserved JSON syntax, code pagination and deterministic capacity checks.

```sh
node renderer/preview.mjs /tmp/automationops-preview
```

Requires Node.js 20+, FFmpeg/libass and DejaVu fonts. Generates a 24-second silent visual test. Source contains no third-party video or music.

## Motion-first cinematic pilot

[`tools/cinematic_pilot.py`](tools/cinematic_pilot.py) renders a 1080p explainer with a moving 2.5D environment, progressive data-flow diagrams, scene transitions, an original audio-reactive guide avatar and procedurally generated music. It uses Pillow, NumPy and FFmpeg; no stock footage, music or generative-video subscription is required.

```sh
python3 tools/cinematic_pilot.py input.mp4 cinematic-pilot.mp4
python3 tools/video_qa.py cinematic-pilot.mp4 --report cinematic-pilot-qa.json
```

The source video's first 35.568 seconds supply the narration. The renderer processes the voice, ducks procedural music under speech and targets `-16 LUFS` with a `-1 dBTP` ceiling.

## Participate

Try one failing payload, explain its failure, then fix it. [Open an issue](https://github.com/luis-alberto-sanchez-arenas/automationopsai-video-resources/issues) with synthetic data, your software version, expected behavior and actual behavior. Read [CONTRIBUTING.md](CONTRIBUTING.md); never share tokens, customer data or private URLs.

## Scope and rights

Example code is MIT licensed. Video, channel branding and narration are outside that license unless stated otherwise. Third-party tools and fonts retain their respective licenses. This repository does not guarantee YouTube monetization, copyright clearance of unrelated videos, or production suitability without testing.


## Production system

- Free-first production and monetization playbook: [docs/production-playbook.md](docs/production-playbook.md)
- Deterministic technical QA: [tools/video_qa.py](tools/video_qa.py)
- Safe-layout vertical renderer: [tools/shorts_factory.py](tools/shorts_factory.py)
- Idempotent unlisted publisher: [tools/youtube-publisher/upload.mjs](tools/youtube-publisher/upload.mjs)

The JSON-validation example includes an editorial Shorts plan and reviewed English captions.
