# AI N+1 query benchmark Short — staged review package

The renderer builds an in-memory SQLite fixture with 100 customers and 100 orders.
The slow implementation runs one order query and 100 customer queries. The repaired
implementation runs one JOIN. Assertions verify query counts, row equality, total
equality and the first returned customer. This is a local reproducible benchmark,
not a production latency claim.

Technical reference: https://sqlite.org/queryplanner.html

Visuals, fixture and renderer are original procedural project resources. DejaVu
fonts use their permissive license. Narration uses the stock Kokoro `af_heart`
voice and Apache-2.0 weights: https://huggingface.co/hexgrad/Kokoro-82M . There is
no music, stock footage, cloned voice, protected character or brand imitation.

The video remains staged because acoustic alignment verifies spoken token timing,
but no listening-capable reviewer has yet approved naturalness and pronunciation.
Do not move this package to `bundled` until that final review is recorded against
the exact video SHA-256.
