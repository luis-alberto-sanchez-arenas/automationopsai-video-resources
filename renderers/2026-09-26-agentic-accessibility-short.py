#!/usr/bin/env python3
"""Narration-first vertical Short: an AI accessibility gate with real evidence."""
from __future__ import annotations

import argparse
import json
import math
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS = 540, 960, 30
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
# Warm print-lab palette. Deliberately unrelated to the neon/dark visual system
# used by the earlier contrast episode.
INK, PAPER, CYAN, LIME, CORAL, VIOLET = "#14213D", "#F7F3E8", "#2F5BEA", "#1B7F5C", "#E4572E", "#F2C14E"
SURFACE, GRID, MUTED = "#FFFDF7", "#D6D0C1", "#5C6475"

SEGMENTS = (
    "Your AI generated interface can pass unit tests and still lock out keyboard users. Audit the behavior, not the screenshot.",
    "Run the automated scan first. It finds four deterministic violations: contrast, missing names, duplicate labels, and no main landmark.",
    "Fix them, rerun the same command, and automated violations drop from four to zero.",
    "But zero is not compliance. W three C says no tool alone can determine whether a site is accessible.",
    "Now replay the keyboard path. A sticky footer hides checkout, and only three of six focus stops remain visible.",
    "Add scroll padding and a strong focus ring. The same replay now exposes all six stops, including checkout.",
    "Gate the pull request on both results, then keep manual and assistive technology review. Ship evidence, not an accessibility score.",
)


def ff(size: int, bold=False, mono=False):
    return ImageFont.truetype(MONO if mono else BOLD if bold else FONT, size)


def clamp(v, lo=0.0, hi=1.0): return max(lo, min(hi, v))
def ease(v):
    v = clamp(v)
    return v * v * (3 - 2 * v)


def wrap(draw, text, face, width):
    out, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if draw.textbbox((0, 0), trial, font=face)[2] <= width:
            line = trial
        else:
            out.append(line)
            line = word
    if line: out.append(line)
    return out


def label(draw, xy, text, size, color=PAPER, anchor="la", mono=False):
    draw.text(xy, text, font=ff(size, True, mono), fill=color, anchor=anchor)


def glow_panel(image, box, color=CYAN, radius=10, fill=SURFACE):
    # Offset ink shadow evokes a screen-printed engineering notebook, not glass UI.
    draw = ImageDraw.Draw(image)
    x1, y1, x2, y2 = box
    draw.rounded_rectangle((x1 + 7, y1 + 7, x2 + 7, y2 + 7), radius, fill=INK)
    draw.rounded_rectangle(box, radius, fill=fill, outline=color, width=3)


def base(t):
    image = Image.new("RGBA", (W, H), PAPER)
    draw = ImageDraw.Draw(image, "RGBA")
    # Blueprint grid plus one moving evidence rail. Motion is causal and stays
    # behind the browser/terminal/text masks.
    for x in range(0, W, 36): draw.line((x, 0, x, H), fill=GRID + "66", width=1)
    for y in range(0, H, 36): draw.line((0, y, W, y), fill=GRID + "66", width=1)
    draw.line((22, 96, 22, 790), fill=CORAL, width=5)
    pulse_y = 105 + ((t * 96) % 670)
    draw.ellipse((13, pulse_y - 9, 31, pulse_y + 9), fill=VIOLET, outline=INK, width=2)
    return image


def browser_shell(image, t):
    draw = ImageDraw.Draw(image)
    glow_panel(image, (38, 96, 505, 718), CYAN, 10)
    draw.rectangle((38, 96, 505, 146), fill=INK)
    for i, c in enumerate((CORAL, "#FFD06A", LIME)):
        draw.ellipse((48 + i * 21, 112, 59 + i * 21, 123), fill=c)
    label(draw, (125, 121), "preview.local / checkout", 13, PAPER, "lm", True)
    draw.rectangle((58, 169, 485, 227), fill="#E5EAF8", outline=INK, width=2)
    label(draw, (75, 198), "RELEASE LAB", 20, INK, "lm")
    label(draw, (462, 198), "Cart 2", 15, INK, "rm")
    draw.rectangle((61, 255, 482, 355), fill=SURFACE, outline=INK, width=2)
    label(draw, (80, 285), "Deployment guard", 17, INK)
    label(draw, (80, 320), "Blocks unsafe release paths", 13, MUTED)
    draw.rectangle((61, 380, 257, 457), fill="#FFF0D0", outline=INK, width=2)
    draw.rectangle((286, 380, 482, 457), fill="#E9F3EE", outline=INK, width=2)
    label(draw, (78, 405), "Audit events", 14, MUTED)
    label(draw, (78, 438), "12,408", 24, INK)
    label(draw, (303, 405), "Policy hits", 14, MUTED)
    label(draw, (303, 438), "27", 24, INK)
    draw.rectangle((61, 484, 482, 548), fill=SURFACE, outline=INK, width=2)
    label(draw, (80, 516), "Email receipt", 15, INK, "lm")
    draw.rectangle((61, 570, 482, 646), fill=CYAN, outline=INK, width=3)
    label(draw, (270, 608), "CHECKOUT", 20, "white", "mm")
    # subtle parallax in the page content
    x = 58 + 12 * math.sin(t * .9)
    draw.rectangle((x, 662, x + 150, 688), fill=VIOLET, outline=INK, width=2)


def terminal(image, progress, repaired=False):
    draw = ImageDraw.Draw(image)
    glow_panel(image, (50, 178, 497, 682), LIME if repaired else CORAL, 8, INK)
    label(draw, (70, 211), "$ node demo.mjs", 15, PAPER, mono=True)
    before = [
        ("button-name", "FAIL"), ("color-contrast", "FAIL"),
        ("duplicate-label", "FAIL"), ("main-landmark", "FAIL"),
    ]
    after = [("automated violations", "0"), ("gate", "AUTO PASS")]
    rows = after if repaired else before
    visible = max(1, min(len(rows), int(progress * len(rows)) + 1))
    for i, (name, result) in enumerate(rows[:visible]):
        y = 270 + i * 78
        label(draw, (74, y), name, 16, PAPER, mono=True)
        label(draw, (464, y), result, 16, LIME if repaired else CORAL, "ra", True)
        draw.line((74, y + 24, 466, y + 24), fill="#7D879F", width=1)
    if repaired:
        label(draw, (70, 545), "manual review", 16, PAPER, mono=True)
        label(draw, (464, 545), "REQUIRED", 16, "#FFD06A", "ra", True)


def audit_overlay(image, count, color, title):
    draw = ImageDraw.Draw(image)
    draw.rectangle((318, 158, 486, 239), fill=VIOLET, outline=INK, width=3)
    label(draw, (335, 181), title, 11, INK)
    label(draw, (338, 218), str(count), 34, color, "ls", True)


def focus_path(image, progress, repaired):
    draw = ImageDraw.Draw(image)
    stops = [(85, 198), (448, 198), (92, 516), (270, 608), (395, 608), (454, 682)]
    visible = int(ease(progress) * 6 + .7)
    for i, (x, y) in enumerate(stops):
        active = i < visible
        color = LIME if repaired else (CYAN if i < 3 else CORAL)
        if active:
            r = 11 + 3 * math.sin(progress * 10 + i)
            draw.ellipse((x-r, y-r, x+r, y+r), outline=color, width=4)
            label(draw, (x, y-18), str(i+1), 10, color, "mm", True)
    if not repaired:
        draw.rectangle((38, 598, 505, 718), fill=CORAL)
        label(draw, (270, 635), "STICKY FOOTER", 15, INK, "mm", True)
        label(draw, (270, 665), "CHECKOUT OBSCURED", 19, "white", "mm")
    label(draw, (270, 690), f"KEYBOARD  {'6/6 VISIBLE' if repaired else '3/6 VISIBLE'}", 20,
          LIME if repaired else CORAL, "mm", True)


def caption(image, text, progress):
    draw = ImageDraw.Draw(image)
    draw.rectangle((38, 740, 505, 850), fill=INK, outline=CORAL, width=4)
    words = text.split()
    active = min(len(words)-1, max(0, int(progress * len(words))))
    start = max(0, min(active-5, max(0, len(words)-11)))
    selected = words[start:start+11]
    rows = wrap(draw, " ".join(selected), ff(18, True), 440)
    y = 785 if len(rows) == 1 else 772
    for row in rows[:2]:
        label(draw, (270, y), row, 18, PAPER, "ma")
        y += 31


def header(image, index):
    draw = ImageDraw.Draw(image)
    label(draw, (38, 46), "ACCESSIBILITY LAB", 19, INK)
    draw.rectangle((392, 25, 505, 68), fill=VIOLET, outline=INK, width=3)
    label(draw, (448, 47), f"TEST {index+1}/7", 11, INK, "mm", True)


def scene(image, index, progress, t):
    draw = ImageDraw.Draw(image)
    if index == 0:
        browser_shell(image, t)
        audit_overlay(image, "?", VIOLET, "SCREENSHOT SCORE")
        label(draw, (270, 775), "BEHAVIOR > APPEARANCE", 21, CORAL, "mm")
    elif index == 1:
        terminal(image, progress, False)
        audit_overlay(image, 4, CORAL, "AUTO VIOLATIONS")
    elif index == 2:
        terminal(image, progress, True)
        audit_overlay(image, 0, LIME, "AUTO VIOLATIONS")
    elif index == 3:
        browser_shell(image, t)
        audit_overlay(image, 0, LIME, "AUTO VIOLATIONS")
        draw.rectangle((62, 274, 478, 354), fill=VIOLET, outline=INK, width=3)
        label(draw, (270, 297), "ZERO ≠ COMPLIANCE", 22, INK, "ma")
        label(draw, (270, 330), "manual evidence required", 14, INK, "ma")
    elif index == 4:
        browser_shell(image, t)
        focus_path(image, progress, False)
    elif index == 5:
        browser_shell(image, t)
        focus_path(image, progress, True)
        label(draw, (270, 716), "scroll-padding + focus ring", 14, MUTED, "mm", True)
    else:
        browser_shell(image, t)
        draw.rectangle((62, 245, 478, 630), fill=SURFACE, outline=INK, width=4)
        rows = (("AUTOMATED", "0 violations"), ("KEYBOARD", "6/6 visible"), ("MANUAL", "required"))
        for i, (left, right) in enumerate(rows):
            y = 315 + i * 100
            label(draw, (82, y), left, 17, MUTED, mono=True)
            label(draw, (458, y), right, 19, LIME if i < 2 else CORAL, "ra", True)
            draw.line((82, y+30, 458, y+30), fill=GRID, width=2)
        label(draw, (270, 690), "PULL REQUEST: PASS", 24, LIME, "mm", True)


def synthesize(kokoro, output):
    pieces, timeline, cursor = [], [], 0.0
    gap = np.zeros(int(24000 * .12), dtype=np.float32)
    for i, text in enumerate(SEGMENTS):
        audio, rate = kokoro.create(text, voice="af_heart", speed=1.04, lang="en-us", sentence_pause=.16, clause_pause=.07)
        audio = np.asarray(audio, dtype=np.float32)
        start, end = cursor, cursor + len(audio) / rate
        timeline.append({"index": i, "text": text, "start": round(start, 4), "end": round(end, 4), "words": len(text.split())})
        pieces.append(audio); cursor = end
        if i < len(SEGMENTS)-1:
            pieces.append(gap); cursor += len(gap) / 24000
    voice = np.concatenate(pieces)
    sf.write(output / "voice.wav", voice, 24000)
    data = {"voice": "Kokoro af_heart", "sampleRate": 24000, "duration": round(len(voice)/24000, 4), "segments": timeline}
    (output / "timeline.json").write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--voices", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(); args.output.mkdir(parents=True, exist_ok=True)
    timeline = synthesize(Kokoro(args.model, args.voices), args.output)
    duration = timeline["duration"] + .18
    visual = args.output / "visuals.mp4"
    proc = subprocess.Popen([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-vf", "scale=1080:1920:flags=lanczos",
        "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "17", "-pix_fmt", "yuv420p", str(visual)
    ], stdin=subprocess.PIPE)
    segments = timeline["segments"]
    for frame in range(math.ceil(duration * FPS)):
        t = frame / FPS
        index = next((i for i, s in enumerate(segments) if t < s["end"] + (.12 if i < 6 else .18)), 6)
        current = segments[index]
        progress = clamp((t-current["start"]) / max(.1, current["end"]-current["start"]))
        image = base(t); header(image, index); scene(image, index, progress, t); caption(image, current["text"], progress)
        proc.stdin.write(image.convert("RGB").tobytes())
    proc.stdin.close()
    if proc.wait() != 0: raise RuntimeError("FFmpeg visual render failed")
    final = args.output / "ai-accessibility-audit.mp4"
    subprocess.run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(visual), "-i", str(args.output/"voice.wav"),
        "-filter:a", "highpass=f=70,acompressor=threshold=-20dB:ratio=2.2:attack=8:release=150,loudnorm=I=-16:TP=-1.5:LRA=7",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", str(final)
    ], check=True)
    thumb_t = segments[4]["start"] + .6
    thumb = base(thumb_t); header(thumb, 4); scene(thumb, 4, 1.0, thumb_t)
    ImageDraw.Draw(thumb).rectangle((52, 96, 492, 170), fill=VIOLET, outline=INK, width=4)
    label(ImageDraw.Draw(thumb), (270, 133), "0 AUTO BUGS. KEYBOARD FAILS.", 22, INK, "mm")
    thumb.convert("RGB").resize((1080,1920), Image.Resampling.LANCZOS).save(args.output/"thumbnail.jpg", quality=95, subsampling=0)
    print(json.dumps({"video": str(final), "duration": duration, "timeline": str(args.output/"timeline.json")}))


if __name__ == "__main__": main()
