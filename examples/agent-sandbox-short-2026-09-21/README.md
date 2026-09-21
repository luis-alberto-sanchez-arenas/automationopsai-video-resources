# AI Coding Agent Sandbox Short

Published video: https://www.youtube.com/watch?v=Q93rrjWCp2k

## Reproduce the procedural visuals

```bash
python3 renderers/2026-09-21-agent-sandbox-short.py
```

Requirements: Python 3, Pillow, FFmpeg, DejaVu Sans. Output is a 58-second, 1080x1920, 30 fps H.264 animation.

## Demonstrated architecture

1. Disposable workspace
2. No production secrets; scoped, short-lived credentials only when needed
3. Outbound-network allowlist
4. Patch and tests as output; human approval before merge or deployment

## Technical references

- OpenAI, “Designing AI agents to resist prompt injection,” March 11, 2026: https://openai.com/index/designing-agents-to-resist-prompt-injection/
- OWASP, “State of Agentic AI Security and Governance 2.0,” June 1, 2026: https://genai.owasp.org/learning_persona/practitioners/
- GitHub Docs, Copilot agent mode and command approval: https://docs.github.com/copilot/quickstart

## Rights and disclosure

All visuals, diagrams, avatar, and the sound bed are original/procedural. Narration is synthetic. No third-party footage, music, voices, protected characters, or logos were used.
