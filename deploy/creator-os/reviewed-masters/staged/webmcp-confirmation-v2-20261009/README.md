# Consequence policy: reproducible browser simulation

Open `demo.html` in a browser. Run the unmarked tool, reset, check the consequence
annotation, run again, then reject. The first case records a fictional $480 charge;
the rejected case performs zero executions. The four-assertion button also tests
the explicit approval path. No AI model, native WebMCP API, payment or travel API
is called. This illustrates a client enforcement policy, not an automatic security
guarantee provided by an annotation.

Reference: https://developer.chrome.com/docs/ai/webmcp/imperative-api

## Reproduce

Install Node Playwright 1.55.1 with Chromium, Python Pillow 11.3.0, numpy 2.2.6,
FFmpeg and DejaVu fonts. Run:

```sh
node episodes/webmcp-confirmation-v2/test-demo.cjs
node episodes/webmcp-confirmation-v2/capture-demo.cjs
python episodes/webmcp-confirmation-v2/render.py --output draft
python tools/video_qa.py draft/video.mp4 --report draft/qa-report.json
```

`alignment.json` is acoustic forced alignment of the existing source narration
using PocketSphinx 5.0.4, sampled at 16 kHz with 10 ms frames. It is an acoustic
estimate; listening review is still required. `tools/align_existing_voice.py`
reproduces alignment without voice synthesis or networking. The renderer checks
the source audio file's SHA-256 and copies the audio stream without re-encoding.

The browser tests use actual clicks, abort external network requests and capture
states from this demo. The video is a replay of those states with the actual
policy source shown. It must not be represented as a native WebMCP recording.

## Rights and review

Visuals and simulation code are original project resources. Font: DejaVu fonts,
permissive license at https://dejavu-fonts.github.io/License.html . Existing
narration uses the stock Kokoro voice from the source episode; weights Apache
2.0: https://huggingface.co/hexgrad/Kokoro-82M . No music or third-party footage.
This build generates no new speech and loads no ONNX model.

This directory is **unapproved**. Technical QA and a pixel mask are not proof of
natural narration, original design, audience demand, or monetization eligibility.
The staged draft cannot be imported by the publisher. Required pending checks are
listed in `publication-review.json`. Do not promote it or claim success merely
because FFmpeg finishes.
