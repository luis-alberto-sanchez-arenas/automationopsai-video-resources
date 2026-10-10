#!/usr/bin/env python3
"""Block generic/reused video packages before upload.

Usage:
  python tools/originality_gate.py --current build/originality-manifest.json \
      --history reviewed-masters --report build/originality-report.json

History may be a directory containing originality-manifest.json files.
Exit 0 means pass; exit 2 means publication must be blocked.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any


REQUIRED_TEXT = (
    "rendererId",
    "backgroundGrammar",
    "cameraModel",
    "primaryInteraction",
)
MAX_SCENE_OVERLAP = 0.35
MIN_PROOF_RATIO = 0.70
MAX_CARD_RATIO = 0.10


def load(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path}: manifest root must be an object")
    value["_path"] = str(path)
    return value


def ratio(value: Any, duration: float) -> float:
    try:
        return max(0.0, float(value)) / duration
    except (TypeError, ValueError, ZeroDivisionError):
        return 0.0


def signatures(manifest: dict[str, Any]) -> set[str]:
    raw = manifest.get("sceneSignatures", [])
    if not isinstance(raw, list):
        return set()
    return {str(item).strip().lower() for item in raw if str(item).strip()}


def palette_key(manifest: dict[str, Any]) -> tuple[str, ...]:
    raw = manifest.get("palette", [])
    if not isinstance(raw, list):
        return ()
    return tuple(sorted(str(item).strip().lower() for item in raw if str(item).strip()))


def overlap(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


def evaluate(current: dict[str, Any], history: list[dict[str, Any]]) -> dict[str, Any]:
    failures: list[str] = []
    checks: dict[str, Any] = {}

    for key in REQUIRED_TEXT:
        ok = isinstance(current.get(key), str) and bool(current[key].strip())
        checks[f"required.{key}"] = ok
        if not ok:
            failures.append(f"Missing non-empty {key}")

    current_signatures = signatures(current)
    try:
        duration = float(current.get("durationSeconds") or 0)
    except (TypeError, ValueError):
        duration = 0.0
    if not math.isfinite(duration):
        duration = 0.0
    for key in ("proofSeconds", "textCardSeconds"):
        value = current.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= duration:
            failures.append(f"{key} requires a finite measured duration between zero and durationSeconds")
    if not history:
        failures.append("Originality comparison unavailable: no historical manifests; review prior published videos before approval")
    proof_ratio = ratio(current.get("proofSeconds"), duration)
    card_ratio = ratio(current.get("textCardSeconds"), duration)
    checks.update({
        "durationSeconds": duration,
        "sceneSignatureCount": len(current_signatures),
        "proofRatio": round(proof_ratio, 4),
        "textCardRatio": round(card_ratio, 4),
        "paletteCount": len(palette_key(current)),
    })
    if duration <= 0:
        failures.append("durationSeconds must be greater than zero")
    if len(current_signatures) < 6:
        failures.append("At least six topic-specific scene signatures are required")
    if len(palette_key(current)) < 3:
        failures.append("At least three declared palette colors are required")
    if proof_ratio < MIN_PROOF_RATIO:
        failures.append(f"Verifiable action density {proof_ratio:.1%} is below {MIN_PROOF_RATIO:.0%}")
    if card_ratio > MAX_CARD_RATIO:
        failures.append(f"Text-card density {card_ratio:.1%} exceeds {MAX_CARD_RATIO:.0%}")

    comparisons: list[dict[str, Any]] = []
    for previous in history[-10:]:
        previous_signatures = signatures(previous)
        scene_overlap = overlap(current_signatures, previous_signatures)
        same_renderer = current.get("rendererId") == previous.get("rendererId")
        same_visual_system = (
            palette_key(current)
            and palette_key(current) == palette_key(previous)
            and current.get("backgroundGrammar") == previous.get("backgroundGrammar")
        )
        item = {
            "path": previous.get("_path"),
            "rendererReused": same_renderer,
            "paletteAndBackgroundReused": bool(same_visual_system),
            "sceneOverlap": round(scene_overlap, 4),
        }
        comparisons.append(item)
        if same_renderer:
            failures.append(f"rendererId reused from {previous.get('_path')}")
        if same_visual_system:
            failures.append(f"Palette + background grammar reused from {previous.get('_path')}")
        if scene_overlap > MAX_SCENE_OVERLAP:
            failures.append(
                f"Scene overlap {scene_overlap:.1%} exceeds {MAX_SCENE_OVERLAP:.0%} vs {previous.get('_path')}"
            )

    rights = current.get("rights") if isinstance(current.get("rights"), dict) else {}
    required_rights = ("commercialUseCleared", "originalOrProceduralVisuals", "voiceLicenseCleared")
    for key in required_rights:
        ok = rights.get(key) is True
        checks[f"rights.{key}"] = ok
        if not ok:
            failures.append(f"Rights check failed: {key}")

    return {
        "passed": not failures,
        "limits": {
            "maxSceneOverlap": MAX_SCENE_OVERLAP,
            "minProofRatio": MIN_PROOF_RATIO,
            "maxTextCardRatio": MAX_CARD_RATIO,
            "historyWindow": 10,
        },
        "checks": checks,
        "comparisons": comparisons,
        "failures": sorted(set(failures)),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--current", type=Path, required=True)
    parser.add_argument("--history", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    current = load(args.current)
    history: list[dict[str, Any]] = []
    if args.history and args.history.exists():
        paths = sorted(args.history.rglob("originality-manifest.json"))
        history = [load(path) for path in paths if path.resolve() != args.current.resolve()]

    result = evaluate(current, history)
    rendered = json.dumps(result, ensure_ascii=False, indent=2)
    print(rendered)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(rendered + "\n", encoding="utf-8")
    return 0 if result["passed"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
