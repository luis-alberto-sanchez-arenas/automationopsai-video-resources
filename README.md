# AutomationOpsAI Video Resources

Reproducible, security-conscious resources used in AutomationOpsAI YouTube tutorials.

## Featured tutorial

**Fix AI Agent JSON Parsing Errors in n8n Workflows**

- Video: https://www.youtube.com/watch?v=jMe7vz0CZ5w
- Example: [`examples/n8n-ai-json-parser/`](examples/n8n-ai-json-parser/)
- Goal: enforce a strict JSON contract, validate the result, and route malformed output for review.

## Quick start

1. Download `workflow.json`.
2. In n8n, choose **Import from File**.
3. Open **Google Gemini Chat Model** and select your own credential.
4. Replace the sample prompt/data with a non-sensitive test record.
5. Run the workflow and compare the valid and malformed payloads in `payloads/`.

No API keys, tokens, personal data, copyrighted media, or paid assets are included.

## Repository policy

- Every example must be reproducible from the files committed here.
- Secrets belong in n8n credentials or environment variables, never in Git.
- Claims must be demonstrable; benchmark claims require a documented test.
- Visual/audio assets must be original, generated for the project, or accompanied by a compatible license.
- AI-assisted material is reviewed and meaningfully edited before publication.
- Do not use these examples to imitate people, mislead viewers, evade platform policies, or process data without permission.

## Report a result or problem

Open an issue: https://github.com/luis-alberto-sanchez-arenas/automationopsai-video-resources/issues

Include your n8n version, node versions, expected result, actual result, and redacted logs. Never paste credentials or customer data.

## License

Code and example configurations are released under the MIT License. Video, channel branding, narration, and thumbnails are not granted under that license unless explicitly stated.
