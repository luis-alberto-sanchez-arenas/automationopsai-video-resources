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
INK, PAPER, CYAN, LIME, CORAL, VIOLET = "#071015", "#EDF8F6", "#14D9C5", "#B7F34A", "#FF665A", "#9C7BFF"

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


def glow_panel(image, box, color=CYAN, radius=16, fill=(7, 16, 21, 242)):
    layer = Image.new("RGBA", image.size)
    ImageDraw.Draw(layer).rounded_rectangle(box, radius, fill=color + "32")
    image.alpha_composite(layer.filter(ImageFilter.GaussianBlur(11)))
    ImageDraw.Draw(image).rounded_rectangle(box, radius, fill=fill, outline=color, width=2)


def base(t):
    image = Image.new("RGBA", (W, H), INK)
    draw = ImageDraw.Draw(image, "RGBA")
    # A moving causal data path; all effects remain behind UI and captions.
    for lane in range(8):
        y = 100 + lane * 82
        draw.line((28, y, 512, y), fill="#1E746950", width=2)
        x = 28 + ((t * (44 + lane * 4) + lane * 67) % 484)
        draw.ellipse((x - 3, y - 3, x + 3, y + 3), fill=CYAN + "A0")
    return image


def browser_shell(image, t):
    draw = ImageDraw.Draw(image)
    glow_panel(image, (25, 92, 515, 718), VIOLET, 20)
    draw.rounded_rectangle((25, 92, 515, 143), 20, fill="#111C26")
    for i, c in enumerate((CORAL, "#FFD06A", LIME)):
        draw.ellipse((48 + i * 21, 112, 59 + i * 21, 123), fill=c)
    label(draw, (125, 118), "preview.local / checkout", 13, "#AEC6D1", "lm", True)
    draw.rounded_rectangle((50, 167, 490, 228), 12, fill="#102C34")
    label(draw, (72, 198), "AI STORE", 20, CYAN, "lm")
    label(draw, (463, 198), "Cart 2", 15, PAPER, "rm")
    draw.rounded_rectangle((55, 255, 485, 355), 14, fill="#12202A")
    label(draw, (77, 285), "Deployment guard", 17, PAPER)
    label(draw, (77, 320), "Blocks unsafe release paths", 13, "#9BB4BE")
    draw.rounded_rectangle((55, 380, 260, 457), 14, fill="#132A31")
    draw.rounded_rectangle((280, 380, 485, 457), 14, fill="#132A31")
    label(draw, (75, 405), "Audit events", 14, "#AFC4CB")
    label(draw, (75, 438), "12,408", 24, PAPER)
    label(draw, (300, 405), "Policy hits", 14, "#AFC4CB")
    label(draw, (300, 438), "27", 24, PAPER)
    draw.rounded_rectangle((55, 484, 485, 548), 12, fill="#101C24")
    label(draw, (78, 516), "Email receipt", 15, PAPER, "lm")
    draw.rounded_rectangle((55, 570, 485, 646), 14, fill="#17404A")
    label(draw, (270, 608), "CHECKOUT", 20, PAPER, "mm")
    # subtle parallax in the page content
    x = 58 + 12 * math.sin(t * .9)
    draw.rounded_rectangle((x, 662, x + 150, 688), 8, fill=CYAN + "35")


def terminal(image, progress, repaired=False):
    draw = ImageDraw.Draw(image)
    glow_panel(image, (43, 178, 497, 682), LIME if repaired else CORAL, 18, (3, 10, 14, 247))
    label(draw, (66, 207), "$ node demo.mjs", 15, "#C5D8DC", mono=True)
    before = [
        ("button-name", "FAIL"), ("color-contrast", "FAIL"),
        ("duplicate-label", "FAIL"), ("main-landmark", "FAIL"),
    ]
    after = [("automated violations", "0"), ("gate", "AUTO PASS")]
    rows = after if repaired else before
    visible = max(1, min(len(rows), int(progress * len(rows)) + 1))
    for i, (name, result) in enumerate(rows[:visible]):
        y = 270 + i * 78
        label(draw, (70, y), name, 16, PAPER, mono=True)
        label(draw, (464, y), result, 16, LIME if repaired else CORAL, "ra", True)
        draw.line((70, y + 24, 466, y + 24), fill="#25414A", width=1)
    if repaired:
        label(draw, (70, 545), "manual review", 16, PAPER, mono=True)
        label(draw, (464, 545), "REQUIRED", 16, "#FFD06A", "ra", True)


def audit_overlay(image, count, color, title):
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((320, 154, 488, 235), 13, fill="#050C10", outline=color, width=2)
    label(draw, (338, 177), title, 11, "#A9C0C7")
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
        draw.rectangle((25, 598, 515, 718), fill="#02080DEB")
        label(draw, (270, 635), "STICKY FOOTER", 15, CORAL, "mm", True)
        label(draw, (270, 665), "CHECKOUT OBSCURED", 19, PAPER, "mm")
    label(draw, (270, 750), f"KEYBOARD  {'6/6 VISIBLE' if repaired else '3/6 VISIBLE'}", 20,
          LIME if repaired else CORAL, "mm", True)


def caption(image, text, progress):
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((24, 818, 516, 940), 18, fill=(2, 7, 10, 250), outline=CYAN, width=2)
    words = text.split()
    active = min(len(words)-1, max(0, int(progress * len(words))))
    start = max(0, min(active-5, max(0, len(words)-11)))
    selected = words[start:start+11]
    rows = wrap(draw, " ".join(selected), ff(18, True), 440)
    y = 858 if len(rows) == 1 else 844
    for row in rows[:2]:
        label(draw, (270, y), row, 18, PAPER, "ma")
        y += 31


def header(image, index):
    draw = ImageDraw.Draw(image)
    label(draw, (28, 40), "AI ACCESSIBILITY AUDIT", 19, PAPER)
    draw.rounded_rectangle((394, 25, 512, 68), 12, fill="#10262B", outline=CYAN, width=2)
    label(draw, (453, 47), f"EVIDENCE {index+1}/7", 11, CYAN, "mm", True)


def scene(image, index, progress, t):
    draw = ImageDraw.Draw(image)
    if index == 0:
        browser_shell(image, t)
        audit_overlay(image, "?", VIOLET, "SCREENSHOT SCORE")
        label(draw, (270, 775), "BEHAVIOR > APPEARANCE", 21, CYAN, "mm")
    elif index == 1:
        terminal(image, progress, False)
        audit_overlay(image, 4, CORAL, "AUTO VIOLATIONS")
    elif index == 2:
        terminal(image, progress, True)
        audit_overlay(image, 0, LIME, "AUTO VIOLATIONS")
    elif index == 3:
        browser_shell(image, t)
        audit_overlay(image, 0, LIME, "AUTO VIOLATIONS")
        draw.rounded_rectangle((56, 274, 484, 354), 14, fill="#2B2313", outline="#FFD06A", width=2)
        label(draw, (270, 297), "ZERO ≠ COMPLIANCE", 22, "#FFD06A", "ma")
        label(draw, (270, 330), "manual evidence required", 14, PAPER, "ma")
    elif index == 4:
        browser_shell(image, t)
        focus_path(image, progress, False)
    elif index == 5:
        browser_shell(image, t)
        focus_path(image, progress, True)
        label(draw, (270, 782), "scroll-padding + focus ring", 14, "#B8CBD1", "mm", True)
    else:
        browser_shell(image, t)
        draw.rounded_rectangle((55, 245, 485, 630), 18, fill="#061013F2", outline=LIME, width=2)
        rows = (("AUTOMATED", "0 violations"), ("KEYBOARD", "6/6 visible"), ("MANUAL", "required"))
        for i, (left, right) in enumerate(rows):
            y = 315 + i * 100
            label(draw, (82, y), left, 17, "#AFC6CC", mono=True)
            label(draw, (458, y), right, 19, LIME if i < 2 else "#FFD06A", "ra", True)
            draw.line((82, y+30, 458, y+30), fill="#254149", width=1)
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
    thumb_t = segments[5]["start"] + .6
    thumb = base(thumb_t); header(thumb, 5); scene(thumb, 5, .68, thumb_t)
    ImageDraw.Draw(thumb).rounded_rectangle((40, 96, 500, 170), 16, fill="#02090DF2", outline=LIME, width=3)
    label(ImageDraw.Draw(thumb), (270, 133), "0 AUTO BUGS. STILL NOT DONE.", 22, PAPER, "mm")
    thumb.convert("RGB").resize((1080,1920), Image.Resampling.LANCZOS).save(args.output/"thumbnail.jpg", quality=95, subsampling=0)
    print(json.dumps({"video": str(final), "duration": duration, "timeline": str(args.output/"timeline.json")}))


if __name__ == "__main__": main()
