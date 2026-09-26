#!/usr/bin/env node

// Deterministic companion for the video. It models the evidence emitted by an
// accessibility gate; it does not claim that automated checks prove WCAG
// conformance. Run with: node demo.mjs

const before = {
  automated: [
    'button-name',
    'color-contrast',
    'form-field-multiple-labels',
    'landmark-one-main',
  ],
  keyboard: { visibleStops: 3, totalStops: 6, obscured: ['checkout'] },
};

const after = {
  automated: [],
  keyboard: { visibleStops: 6, totalStops: 6, obscured: [] },
};

function gate(snapshot) {
  const automatedPass = snapshot.automated.length === 0;
  const keyboardPass = snapshot.keyboard.visibleStops === snapshot.keyboard.totalStops
    && snapshot.keyboard.obscured.length === 0;
  return {
    automatedViolations: snapshot.automated.length,
    keyboardVisible: `${snapshot.keyboard.visibleStops}/${snapshot.keyboard.totalStops}`,
    result: automatedPass && keyboardPass ? 'PASS' : 'BLOCK',
  };
}

console.log(JSON.stringify({ before: gate(before), after: gate(after) }, null, 2));
console.log('Manual review still required: semantics, task clarity, and assistive-technology usability.');
