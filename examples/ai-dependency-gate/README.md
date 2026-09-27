# AI dependency gate

This original, synthetic demonstration compares a baseline lock snapshot with
two candidate changes produced by an AI coding workflow.

Run it locally:

```sh
python3 demo.py
```

The unsafe candidate is blocked by five deterministic findings: missing
integrity, an unapproved registry, an install script, missing provenance, and
an unknown license. The repaired candidate passes with zero findings.

The example does not claim that provenance alone proves a package is safe.
npm documents provenance as a verifiable link to source code and build
instructions; GitHub dependency review can enforce checks on dependency
changes in pull requests. Production systems should also use current
vulnerability intelligence and manual review.

Official references:

- https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review
- https://docs.npmjs.com/generating-provenance-statements/

All package names and results in this demo are synthetic. The code is covered
by the repository license and uses no external service, credential, paid API,
stock media, or third-party package content.
