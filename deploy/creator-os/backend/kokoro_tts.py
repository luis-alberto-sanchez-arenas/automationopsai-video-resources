#!/usr/bin/env python3
"""Offline Kokoro ONNX speech synthesis for the editorial worker.

Text is read from stdin so long narrations never exceed the process argument limit.
The output is always a PCM WAV file; ffmpeg performs the final AAC encoding and
loudness normalization during scene rendering.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import soundfile as sf
from kokoro_onnx import Kokoro


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--voices", required=True)
    parser.add_argument("--voice", default="af_heart")
    parser.add_argument("--speed", type=float, default=0.97)
    parser.add_argument("--lang", default="en-us")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    text = sys.stdin.read().strip()
    if not text:
        raise ValueError("Kokoro received empty narration")
    if not 0.75 <= args.speed <= 1.25:
        raise ValueError(f"Kokoro speed outside quality range: {args.speed}")

    for label, raw_path in (("model", args.model), ("voices", args.voices)):
        path = Path(raw_path)
        if not path.is_file() or path.stat().st_size < 1_000_000:
            raise FileNotFoundError(f"Kokoro {label} missing or invalid: {path}")

    # Avoid oversubscribing the small production worker while ffmpeg is active.
    os.environ.setdefault("OMP_NUM_THREADS", "2")
    os.environ.setdefault("OMP_WAIT_POLICY", "PASSIVE")

    engine = Kokoro(args.model, args.voices)
    samples, sample_rate = engine.create(
        text,
        voice=args.voice,
        speed=args.speed,
        lang=args.lang,
    )
    if sample_rate < 16_000 or len(samples) < sample_rate // 2:
        raise RuntimeError(
            f"Kokoro output failed quality floor: {len(samples)} samples at {sample_rate} Hz"
        )

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    sf.write(output, samples, sample_rate, format="WAV", subtype="PCM_16")
    if output.stat().st_size < 16_000:
        raise RuntimeError(f"Kokoro WAV failed size floor: {output.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
