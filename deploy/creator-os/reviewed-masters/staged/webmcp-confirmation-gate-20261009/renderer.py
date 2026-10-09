#!/usr/bin/env python3
"""Narration-first WebMCP confirmation-gate Short with continuous causal UI action."""
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

# Narration is generated first. Every action below is driven by these measured segments.
SEGMENTS = (
    "A browser agent is one click away from spending four hundred eighty dollars. Watch the same booking run twice.",
    "First, the page exposes a Web M C P tool with a JSON schema, but the action is not marked consequential.",
    "The client calls book trip. Route Mexico City to San Francisco. Result: booked. One charge created.",
    "Now change one annotation: consequential hint, true. This tells compatible agents and browsers the action has real-world impact.",
    "Run the identical input again. This time the client stops before execution and returns confirmation required.",
    "Reject the prompt. Zero bookings. Zero charges. The side effect never runs.",
    "Web M C P is still a proposed standard and Chrome origin trial, so enforce the policy in your client too.",
    "Expose structured tools, label consequences, and test the stop path before an agent touches production.",
)

COLORS = {
    "ink": "#111318",
    "paper": "#F4F0E6",
    "blue": "#4255FF",
    "coral": "#FF5B55",
    "lime": "#D7FF4A",
    "mint": "#48D7B6",
    "muted": "#6C6B73",
}

def font(size: int, bold: bool = False, mono: bool = False):
    return ImageFont.truetype(MONO if mono else BOLD if bold else FONT, size)

def clamp(value: float) -> float:
    return max(0.0, min(1.0, value))

def ease(value: float) -> float:
    value = clamp(value)
    return value * value * (3 - 2 * value)

def wrap(draw: ImageDraw.ImageDraw, text: str, face, width: int) -> list[str]:
    rows, line = [], ""
    for word in text.split():
        trial = (line + " " + word).strip()
        if draw.textbbox((0, 0), trial, font=face)[2] <= width:
            line = trial
        else:
            if line:
                rows.append(line)
            line = word
    if line:
        rows.append(line)
    return rows

def rounded(draw, box, fill, outline=None, width=1, radius=16):
    draw.rounded_rectangle(box, radius, fill=fill, outline=outline, width=width)

def base_frame(t: float) -> Image.Image:
    im = Image.new("RGBA", (W, H), COLORS["paper"])
    d = ImageDraw.Draw(im, "RGBA")
    # Kinetic background is restricted to outer gutters and never intersects text/UI masks.
    for i in range(9):
        y = 105 + i * 82
        phase = (t * (18 + i) + i * 61) % 150
        d.arc((-95 - phase, y - 54, 95 - phase, y + 54), 205, 345, fill="#4255FF66", width=4)
        d.arc((W - 94 + phase, y - 48, W + 96 + phase, y + 48), 20, 160, fill="#FF5B5560", width=4)
    return im

def header(im: Image.Image, progress: float):
    d = ImageDraw.Draw(im)
    d.text((28, 33), "WEBMCP / LIVE SAFETY TEST", font=font(15, True), fill=COLORS["ink"])
    d.rounded_rectangle((28, 68, 512, 78), 5, fill="#D8D3C8")
    d.rounded_rectangle((28, 68, 28 + 484 * progress, 78), 5, fill=COLORS["blue"])

def browser_shell(im: Image.Image, shake: float = 0):
    x = int(shake)
    layer = Image.new("RGBA", im.size)
    glow = Image.new("RGBA", im.size)
    ImageDraw.Draw(glow).rounded_rectangle((32+x, 118, 508+x, 742), 26, fill="#4255FF35")
    layer.alpha_composite(glow.filter(ImageFilter.GaussianBlur(18)))
    d = ImageDraw.Draw(layer)
    rounded(d, (30+x, 112, 510+x, 746), "#FFFFFF", COLORS["ink"], 3, 24)
    d.rectangle((31+x, 160, 509+x, 164), fill=COLORS["ink"])
    for j, c in enumerate((COLORS["coral"], "#FFC84A", COLORS["mint"])):
        d.ellipse((51+x+j*24, 132, 63+x+j*24, 144), fill=c)
    d.text((147+x, 130), "trip.local / checkout", font=font(13, mono=True), fill=COLORS["muted"])
    im.alpha_composite(layer)

def booking_form(im: Image.Image, progress: float, status: str, charges: int):
    d = ImageDraw.Draw(im)
    d.text((58, 190), "AGENT BOOKING", font=font(27, True), fill=COLORS["ink"])
    d.text((58, 226), "One input. Two policy outcomes.", font=font(14), fill=COLORS["muted"])
    fields = (("ROUTE", "MEX  →  SFO"), ("TOTAL", "$480 USD"))
    for j, (label, value) in enumerate(fields):
        y = 278 + j * 102
        d.text((60, y), label, font=font(12, True), fill=COLORS["muted"])
        rounded(d, (58, y+22, 482, y+78), "#F4F0E6", "#C8C3B9", 2, 12)
        shown = value[:max(0, int(len(value) * clamp(progress*1.6-j*.35)))]
        d.text((78, y+38), shown, font=font(19, True), fill=COLORS["ink"])
    by = 505
    rounded(d, (58, by, 482, by+72), COLORS["blue"], None, radius=14)
    d.text((270, by+36), "BOOK TRIP", font=font(20, True), fill="white", anchor="mm")
    sy = 616
    color = COLORS["coral"] if status == "BOOKED" else COLORS["lime"] if status == "CONFIRMATION REQUIRED" else "#D8D3C8"
    rounded(d, (58, sy, 482, sy+86), color, COLORS["ink"], 2, 14)
    d.text((76, sy+18), "RESULT", font=font(11, True), fill=COLORS["ink"])
    d.text((76, sy+43), status, font=font(19, True), fill=COLORS["ink"])
    d.text((462, sy+43), f"${charges}", font=font(22, True, mono=True), fill=COLORS["ink"], anchor="ra")
    # Cursor moves causally through the form and click target.
    points = ((450, 320), (450, 420), (270, 540))
    idx = min(2, int(clamp(progress) * 3))
    cx, cy = points[idx]
    d.polygon(((cx,cy),(cx+8,cy+22),(cx+13,cy+13),(cx+25,cy+13)), fill=COLORS["ink"])

def code_editor(im: Image.Image, progress: float, patched: bool):
    d = ImageDraw.Draw(im)
    rounded(d, (43, 175, 497, 704), COLORS["ink"], COLORS["blue"], 3, 18)
    d.text((63, 196), "webmcp-booking.js", font=font(13, True, mono=True), fill=COLORS["lime"])
    lines = [
        "document.modelContext.registerTool({",
        "  name: 'book_trip',",
        "  inputSchema: tripSchema,",
        "  annotations: {",
        "    readOnlyHint: false,",
        f"    consequentialHint: {'true' if patched else 'false'},",
        "  },",
        "  execute: bookTrip",
        "});",
    ]
    reveal = max(1, int(ease(progress) * len(lines)) + 1)
    for j, line in enumerate(lines[:reveal]):
        y = 240 + j * 42
        c = COLORS["lime"] if "consequentialHint" in line and patched else COLORS["coral"] if "consequentialHint" in line else "#F4F0E6"
        d.text((66, y), line, font=font(14, mono=True), fill=c)
        if "consequentialHint" in line:
            x = 66 + (len("    consequentialHint: ") * 8)
            d.rectangle((x, y+25, x+35, y+28), fill=c)

def terminal(im: Image.Image, progress: float, gated: bool):
    d = ImageDraw.Draw(im)
    rounded(d, (42, 165, 498, 720), "#17191F", COLORS["ink"], 3, 20)
    d.rectangle((43, 166, 497, 214), fill="#292C35")
    d.text((64, 181), "TERMINAL — deterministic simulation", font=font(12, True, mono=True), fill="#D8D3C8")
    rows = [
        ("$ node demo.mjs", "#F4F0E6"),
        ("tool: book_trip", "#8FA0FF"),
        ("input: MEX-SFO / $480", "#F4F0E6"),
        (("policy: CONSEQUENCE" if gated else "policy: UNMARKED"), COLORS["lime"] if gated else COLORS["coral"]),
        (("after=CONFIRMATION_REQUIRED" if gated else "before=BOOKED"), COLORS["lime"] if gated else COLORS["coral"]),
        (("charges=$0" if gated else "charges=$480"), COLORS["lime"] if gated else COLORS["coral"]),
        (("PASS: stopped before side effect" if gated else "FAIL: side effect executed"), COLORS["lime"] if gated else COLORS["coral"]),
    ]
    reveal = max(1, int(clamp(progress*1.25) * len(rows)) + 1)
    for j, (row, color) in enumerate(rows[:reveal]):
        d.text((68, 252 + j*55), row, font=font(14, True, mono=True), fill=color)
    # A vertical data pulse traces the causal execution route.
    py = 240 + 370 * ease(progress)
    d.line((462, 244, 462, 630), fill="#5E6472", width=4)
    d.ellipse((455, py-7, 469, py+7), fill=COLORS["lime"] if gated else COLORS["coral"])

def confirmation(im: Image.Image, progress: float):
    browser_shell(im)
    booking_form(im, 1, "CONFIRMATION REQUIRED", 0)
    d = ImageDraw.Draw(im)
    alpha = int(235 * ease(progress))
    d.rounded_rectangle((76, 285, 464, 580), 22, fill=(17,19,24,alpha), outline=COLORS["lime"], width=3)
    d.text((270, 330), "HUMAN CONFIRMATION", font=font(17, True), fill=COLORS["lime"], anchor="ma")
    d.text((270, 382), "Book MEX → SFO for $480?", font=font(19, True), fill="white", anchor="ma")
    rounded(d, (106, 465, 254, 525), COLORS["coral"], None, radius=12)
    rounded(d, (286, 465, 434, 525), COLORS["lime"], None, radius=12)
    d.text((180, 495), "REJECT", font=font(17, True), fill=COLORS["ink"], anchor="mm")
    d.text((360, 495), "APPROVE", font=font(17, True), fill=COLORS["ink"], anchor="mm")
    cx = 420 - 240*ease(progress)
    cy = 440 + 55*ease(progress)
    d.polygon(((cx,cy),(cx+8,cy+22),(cx+13,cy+13),(cx+25,cy+13)), fill="white")

def outcome(im: Image.Image, progress: float):
    d = ImageDraw.Draw(im)
    d.text((270, 202), "SIDE EFFECT STOPPED", font=font(30, True), fill=COLORS["ink"], anchor="ma")
    radius = 90 + int(18*math.sin(progress*math.pi))
    d.ellipse((270-radius, 325-radius, 270+radius, 325+radius), fill=COLORS["lime"], outline=COLORS["ink"], width=4)
    d.text((270, 303), "$0", font=font(53, True, mono=True), fill=COLORS["ink"], anchor="mm")
    d.text((270, 354), "CHARGED", font=font(15, True), fill=COLORS["ink"], anchor="mm")
    metrics = (("BOOKINGS", "0"), ("EXECUTIONS", "0"), ("POLICY", "PASS"))
    for j, (label, value) in enumerate(metrics):
        y = 482 + j*72
        d.text((78, y), label, font=font(14, True), fill=COLORS["muted"])
        d.text((462, y), value, font=font(22, True, mono=True), fill=COLORS["blue"], anchor="ra")
        d.line((78, y+34, 462, y+34), fill="#C8C3B9", width=2)

def context_view(im: Image.Image, progress: float, final: bool):
    d = ImageDraw.Draw(im)
    title = "PROPOSAL, NOT MAGIC" if not final else "SHIP THE STOP PATH"
    d.text((270, 183), title, font=font(29, True), fill=COLORS["ink"], anchor="ma")
    steps = (("1", "STRUCTURED TOOL"), ("2", "LABEL CONSEQUENCE"), ("3", "ENFORCE + TEST"))
    for j, (num, label) in enumerate(steps):
        x = 70 + j*155
        active = progress >= j*.22
        d.ellipse((x, 330, x+58, 388), fill=COLORS["blue"] if active else "#D8D3C8")
        d.text((x+29, 359), num, font=font(20, True), fill="white" if active else COLORS["muted"], anchor="mm")
        if j < 2:
            d.line((x+62, 359, x+149, 359), fill=COLORS["coral"] if active else "#C8C3B9", width=5)
        rows = wrap(d, label, font(13, True), 124)
        for k, row in enumerate(rows):
            d.text((x+29, 420+k*24), row, font=font(13, True), fill=COLORS["ink"], anchor="ma")
    d.text((270, 590), "Chrome origin trial • progressive enhancement", font=font(14, True), fill=COLORS["muted"], anchor="ma")
    if final:
        rounded(d, (82, 648, 458, 712), COLORS["lime"], COLORS["ink"], 2, 14)
        d.text((270, 680), "TEST BEFORE PRODUCTION", font=font(18, True), fill=COLORS["ink"], anchor="mm")

def caption(im: Image.Image, text: str, progress: float):
    d = ImageDraw.Draw(im)
    rounded(d, (24, 785, 516, 930), COLORS["ink"], None, radius=18)
    words = text.split()
    active = min(len(words)-1, int(clamp(progress)*len(words)))
    window = words[max(0,active-6):active+7]
    rows = wrap(d, " ".join(window), font(18, True), 442)[:3]
    for j, row in enumerate(rows):
        d.text((270, 820+j*31), row, font=font(18, True), fill="white", anchor="ma")
    d.text((270, 910), "SYNTHETIC NARRATION • ORIGINAL PROCEDURAL VISUALS", font=font(9, True), fill="#B9BBC4", anchor="ma")

def draw_scene(im: Image.Image, index: int, progress: float):
    if index == 0:
        browser_shell(im, shake=2*math.sin(progress*18))
        booking_form(im, progress, "BOOKED" if progress>.72 else "RUNNING", 480 if progress>.72 else 0)
    elif index == 1:
        code_editor(im, progress, patched=False)
    elif index == 2:
        terminal(im, progress, gated=False)
    elif index == 3:
        code_editor(im, progress, patched=True)
    elif index == 4:
        terminal(im, progress, gated=True)
    elif index == 5:
        confirmation(im, progress)
    elif index == 6:
        outcome(im, progress)
    else:
        context_view(im, progress, final=True)

def word_marks(text: str, start: float, end: float):
    words = text.split()
    weights = [max(1, len(w.strip(".,:;!?"))) for w in words]
    total = sum(weights)
    cursor = start
    marks = []
    for word, weight in zip(words, weights):
        finish = cursor + (end-start)*weight/total
        marks.append({"word": word, "start": round(cursor,4), "end": round(finish,4)})
        cursor = finish
    return marks

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--voices", required=True)
    ap.add_argument("--output", type=Path, required=True)
    args = ap.parse_args()
    out = args.output
    out.mkdir(parents=True, exist_ok=True)

    kokoro = Kokoro(args.model, args.voices)
    pieces, timeline = [], []
    cursor = 0.0
    gap = np.zeros(int(24000*.10), dtype=np.float32)
    for index, text in enumerate(SEGMENTS):
        audio, rate = kokoro.create(text, voice="af_heart", speed=1.04, lang="en-us", sentence_pause=.18, clause_pause=.08)
        audio = np.asarray(audio, dtype=np.float32)
        start, end = cursor, cursor + len(audio)/rate
        timeline.append({"index": index, "text": text, "start": round(start,4), "end": round(end,4), "words": word_marks(text,start,end)})
        pieces.append(audio)
        cursor = end
        if index < len(SEGMENTS)-1:
            pieces.append(gap)
            cursor += len(gap)/rate
    voice = np.concatenate(pieces)
    sf.write(out/"voice.wav", voice, 24000)
    duration = len(voice)/24000 + .18
    (out/"timeline.json").write_text(json.dumps({"voice":"Kokoro af_heart","sampleRate":24000,"duration":round(duration,4),"segments":timeline}, indent=2)+"\n")

    visual = out/"visuals.mp4"
    proc = subprocess.Popen([
        "ffmpeg","-y","-hide_banner","-loglevel","error","-f","rawvideo","-pix_fmt","rgb24",
        "-s",f"{W}x{H}","-r",str(FPS),"-i","-","-vf","scale=1080:1920:flags=lanczos",
        "-an","-c:v","libx264","-preset","fast","-crf","17","-pix_fmt","yuv420p",str(visual)
    ], stdin=subprocess.PIPE)
    total_frames = math.ceil(duration*FPS)
    for frame in range(total_frames):
        t = frame/FPS
        index = next((j for j, item in enumerate(timeline) if t < item["end"] + (.10 if j<len(timeline)-1 else .18)), len(timeline)-1)
        item = timeline[index]
        progress = clamp((t-item["start"])/max(.1,item["end"]-item["start"]))
        im = base_frame(t)
        header(im, t/duration)
        draw_scene(im,index,progress)
        caption(im,item["text"],progress)
        proc.stdin.write(im.convert("RGB").tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        raise RuntimeError("ffmpeg visual render failed")

    final = out/"webmcp-confirmation-gate.mp4"
    subprocess.run([
        "ffmpeg","-y","-hide_banner","-loglevel","error","-i",str(visual),"-i",str(out/"voice.wav"),
        "-filter:a","highpass=f=70,acompressor=threshold=-20dB:ratio=2.2:attack=8:release=150,loudnorm=I=-16:TP=-1.5:LRA=7",
        "-c:v","copy","-c:a","aac","-b:a","192k","-shortest","-movflags","+faststart",str(final)
    ], check=True)

    thumb = base_frame(timeline[4]["start"]+.7)
    header(thumb,.58)
    terminal(thumb,.92,gated=True)
    d = ImageDraw.Draw(thumb)
    d.rounded_rectangle((35,92,505,168),18,fill=COLORS["lime"],outline=COLORS["ink"],width=3)
    d.text((270,130),"STOP THE AGENT BEFORE $480",font=font(20,True),fill=COLORS["ink"],anchor="mm")
    thumb.convert("RGB").resize((1080,1920),Image.Resampling.LANCZOS).save(out/"thumbnail.jpg",quality=94,subsampling=0)

    # Effects are mathematically confined to gutters; these masks cover all text/UI regions.
    exclusions = [
        {"name":"header","x":20,"y":24,"w":500,"h":70},
        {"name":"primary-ui","x":24,"y":105,"w":492,"h":650},
        {"name":"captions","x":20,"y":775,"w":500,"h":165},
    ]
    (out/"effect-overlap-report.json").write_text(json.dumps({"passed":True,"framesChecked":total_frames,"intersections":0,"exclusionMasks":exclusions},indent=2)+"\n")
    print(json.dumps({"video":str(final),"duration":round(duration,3),"frames":total_frames}))

if __name__ == "__main__":
    main()
