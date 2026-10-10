# MCP vs REST inventory lab — staged master

This package is intentionally staged, not bundled for automatic publication.

## Verifiable result

- One validated inventory core is exercised through a real local REST endpoint and an MCP stdio JSON-RPC session.
- The MCP session performs `initialize`, `notifications/initialized`, `tools/list`, and `tools/call`.
- Both paths return the same `GPU-01` record: 7 available units in `MEX-1`.
- Invalid REST input returns HTTP 400; invalid MCP arguments are rejected with `isError: true`.
- Fifty successful lookups per path are compared. Reported latency is explicitly scoped to local loopback and is not a universal protocol ranking.

## Quality evidence

- 1920×1080, 30 fps, 327.93 seconds.
- Audio: −16.13 LUFS integrated; −1.34 dBTP true peak.
- No black segments or long silences.
- 9,838 frames checked for text/effect overlap; zero intersections.
- 286.11 seconds of verified action/proof (87.25% of runtime); zero text-card-only seconds.
- Eight unique scene signatures with no renderer, palette/background, or signature reuse detected against bundled history.

## Rights

Visuals are original procedural graphics produced by the included renderer. Narration uses the stock Kokoro `af_heart` voice with commercially usable open model assets. No music, third-party footage, celebrity voice, logo, or protected character is included.

## Publication block

Automated timing, composition, audio, originality, and copyright checks pass. Publication remains blocked until a listening-capable reviewer confirms voice naturalness, pronunciation, and perceptual synchronization between narration and visible actions.
