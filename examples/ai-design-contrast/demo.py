#!/usr/bin/env python3
"""Deterministic WCAG contrast proof for an AI-generated UI token."""

def luminance(value: str) -> float:
    rgb = [int(value[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in rgb]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]

def contrast(foreground: str, background: str) -> float:
    light, dark = sorted((luminance(foreground), luminance(background)), reverse=True)
    return (light + 0.05) / (dark + 0.05)

background = "#475569"
before = contrast("#94A3B8", background)
after = contrast("#F8FAFC", background)
print(f"before={before:.2f}:1 {'PASS' if before >= 4.5 else 'FAIL'}")
print(f"after={after:.2f}:1 {'PASS' if after >= 4.5 else 'FAIL'}")
assert before < 4.5
assert after >= 4.5
print("PASS: token repaired without changing layout")
