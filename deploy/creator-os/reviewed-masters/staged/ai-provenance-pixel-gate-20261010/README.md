# AI provenance pixel gate Short

This staged Short demonstrates a deterministic local test: hash a procedural PNG, change pixel `(61, 37)`, hash the new bytes, and reject the mismatch. The demonstration intentionally describes a checksum as tamper evidence only; it does not claim authorship, licensing, identity, or legal compliance.

## Reproduce

```bash
python proof.py
```

The source asset and all motion graphics are procedural. Narration uses the Apache-2.0 Kokoro model with stock voice `af_heart`. There is no music, third-party footage, copied character, cloned voice, or protected logo.

## Review status

Technical QA, contact sheet, boundary frames, safe text, effect masks, deterministic proof, and originality passed for video SHA-256 `c484d9fe7c4831a03905b58484feff143ea3a01b431f17c609f1e8106c8b232c`.

Publication remains blocked until a listening-capable reviewer approves voice naturalness, pronunciation, pacing, and perceptual voice/action synchronization for that exact binary.

## Sources

- European Commission, AI Act transparency overview: https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai
- Python `hashlib`: https://docs.python.org/3/library/hashlib.html
