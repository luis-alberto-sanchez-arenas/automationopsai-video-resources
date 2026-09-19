# Reproduce JSON validation failures

Companion exercise for [the tutorial](https://www.youtube.com/watch?v=jMe7vz0CZ5w). This is a small deterministic reproduction, not an export of the workflow shown in the published video.

## Run locally — no token required

Use Node.js 20 or newer:

```sh
node examples/n8n-ai-json-parser/test.mjs
```

Expected: **10 cases passed**. Tests cover malformed JSON, missing and extra fields, wrong types, arrays, null, and numeric boundaries. `payloads/malformed.json` is valid JSON syntax but invalid business data: parsing and validation are different steps.

## Import into n8n

Import `workflow.json` from a file and run it manually. The synthetic input node supplies one valid and one invalid model-output example. The validation node returns `valid`, `route`, and redacted validation errors. No API key or external service is used. It does not write to a CRM. Connect `route=accepted` and `route=review` to your own IF/Switch branches before adding side effects.

Validation functions and generated node code are tested locally. Import and execution in an actual n8n instance are not yet verified; node compatibility depends on the installed n8n version.

## Connect real AI output

Replace the synthetic input with your model's output, mapping it to `raw`. Configure n8n's **Structured Output Parser → Define using JSON Schema** with `schema.json`. A JSON schema gives an output contract; deterministic validation remains useful before side effects. The email check validates a simple shape, not mailbox existence or deliverability. Confidence is model output, not a calibrated probability or evidence of correctness.

Official reference: https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.outputparserstructured

## Viewer challenge

Add one failing case, explain why it fails, then fix it. Share the n8n version and a synthetic reproduction in Issues. Never include tokens, cookies, customer data, or private URLs.
