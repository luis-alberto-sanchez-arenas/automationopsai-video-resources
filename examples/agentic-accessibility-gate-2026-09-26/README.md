# AI accessibility audit gate

This is the deterministic companion for the AutomationOpsAI Short **“AI Accessibility Audit: Catch What Axe Misses”**.

```bash
node demo.mjs
```

Expected evidence:

- before: 4 automated violations, 3/6 keyboard stops visible, gate blocked;
- after: 0 automated violations, 6/6 keyboard stops visible, gate passed;
- manual review remains required.

The numbers are a small synthetic fixture used to demonstrate the gate, not a benchmark and not proof of WCAG conformance.

Official references:

- [W3C: Evaluating Web Accessibility](https://www.w3.org/WAI/test-evaluate/)
- [WCAG 2.2: Focus Not Obscured (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)
- [axe-core](https://github.com/dequelabs/axe-core)

The demo and renderer source in this repository are MIT licensed. Narration and final video remain channel assets.
