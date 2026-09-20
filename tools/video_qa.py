#!/usr/bin/env python3
"""Deterministic pre-publication checks for AutomationOpsAI videos."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path


def run(*args: str) -> str:
    result = subprocess.run(args, text=True, capture_output=True)
    return (result.stdout or "") + (result.stderr or "")


def probe(path: Path) -> dict:
    output = subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
        text=True,
    )
    return json.loads(output)


def manifest_checks(path: Path, width: int, height: int) -> list[str]:
    failures: list[str] = []
    data = json.loads(path.read_text(encoding="utf-8"))
    for scene in data.get("scenes", []):
        for box in scene.get("boxes", []):
            x, y = float(box.get("x", 0)), float(box.get("y", 0))
            w, h = float(box.get("w", 0)), float(box.get("h", 0))
            if x < 0 or y < 0 or x + w > width or y + h > height:
                failures.append(f"scene {scene.get('index')}: box outside frame: {box.get('text', '')[:60]}")
            if box.get("kind") == "text" and not box.get("lines"):
                failures.append(f"scene {scene.get('index')}: text has no measured lines")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("video", type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--report", type=Path, default=Path("qa-report.json"))
    parser.add_argument("--min-width", type=int, default=1920)
    parser.add_argument("--min-height", type=int, default=1080)
    parser.add_argument("--target-lufs", type=float, default=-16.0)
    args = parser.parse_args()

    info = probe(args.video)
    video = next((s for s in info["streams"] if s.get("codec_type") == "video"), None)
    audio = next((s for s in info["streams"] if s.get("codec_type") == "audio"), None)
    failures: list[str] = []
    if not video:
        failures.append("missing video stream")
    if not audio:
        failures.append("missing audio stream")
    if video and (int(video.get("width", 0)) < args.min_width or int(video.get("height", 0)) < args.min_height):
        failures.append("resolution below required minimum")

    black = run(
        "ffmpeg", "-hide_banner", "-nostats", "-i", str(args.video),
        "-vf", "blackdetect=d=0.50:pix_th=0.10", "-an", "-f", "null", "-",
    )
    black_segments = re.findall(r"black_start:([0-9.]+).*?black_end:([0-9.]+)", black)
    if black_segments:
        failures.append(f"detected {len(black_segments)} black segment(s) >=0.5s")

    silence = run(
        "ffmpeg", "-hide_banner", "-nostats", "-i", str(args.video),
        "-af", "silencedetect=noise=-45dB:d=1.2", "-vn", "-f", "null", "-",
    )
    long_silences = re.findall(r"silence_duration: ([0-9.]+)", silence)
    if long_silences:
        failures.append(f"detected {len(long_silences)} silence segment(s) >=1.2s")

    loudness_log = run(
        "ffmpeg", "-hide_banner", "-nostats", "-i", str(args.video),
        "-af", "loudnorm=I=-16:LRA=11:TP=-1.0:print_format=json", "-vn", "-f", "null", "-",
    )
    matches = re.findall(r'\{\s*"input_i".*?\}', loudness_log, re.S)
    loudness = json.loads(matches[-1]) if matches else {}
    measured = float(loudness.get("input_i", -99))
    true_peak = float(loudness.get("input_tp", 99))
    if abs(measured - args.target_lufs) > 1.5:
        failures.append(f"integrated loudness {measured:.2f} LUFS is outside target tolerance")
    if true_peak > -0.5:
        failures.append(f"true peak {true_peak:.2f} dBTP is too high")

    if args.manifest:
        failures.extend(manifest_checks(args.manifest, int(video["width"]), int(video["height"])))

    report = {
        "video": str(args.video),
        "passed": not failures,
        "failures": failures,
        "technical": {
            "width": int(video.get("width", 0)) if video else 0,
            "height": int(video.get("height", 0)) if video else 0,
            "duration": float(info["format"].get("duration", 0)),
            "integrated_lufs": measured,
            "true_peak_dbtp": true_peak,
            "black_segments": black_segments,
            "long_silences": [float(x) for x in long_silences],
        },
    }
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
