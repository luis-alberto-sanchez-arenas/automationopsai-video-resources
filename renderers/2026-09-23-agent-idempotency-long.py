#!/usr/bin/env python3
"""Narration-first motion renderer for an executable AutomationOpsAI episode.

All visuals are procedural and original. Narration is generated locally with
Kokoro, aligned to the reviewed SRT, and never imitates a known person.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np
os.environ.setdefault("ORT_DISABLE_TELEMETRY", "1")
from kokoro_onnx import Kokoro
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS = 960, 540, 30
ROOT = Path(__file__).resolve().parents[1]
QA = ROOT / "qa"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_M = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"


def run(args):
    subprocess.run(args, check=True)


def font(size, bold=False, mono=False):
    return ImageFont.truetype(FONT_M if mono else FONT_B if bold else FONT, size)


def clamp(v, lo=0.0, hi=1.0):
    return max(lo, min(hi, v))


def ease(v):
    v = clamp(v)
    return v * v * (3 - 2 * v)


def spring(v):
    v = clamp(v)
    return 1 - math.exp(-7 * v) * math.cos(9 * v)


def srt_seconds(value):
    h, m, rest = value.split(":")
    s, ms = rest.split(",")
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000


def load_srt(path):
    blocks = re.split(r"\n\s*\n", path.read_text().strip())
    out = []
    for block in blocks:
        lines = block.splitlines()
        start, end = lines[1].split(" --> ")
        out.append({"start": srt_seconds(start), "end": srt_seconds(end), "text": " ".join(lines[2:])})
    return out


def wrap(draw, text, max_width, fnt, max_lines=3):
    words, lines, cur = text.split(), [], ""
    for word in words:
        trial = (cur + " " + word).strip()
        if draw.textbbox((0, 0), trial, font=fnt)[2] <= max_width:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines[:max_lines]


def text(draw, xy, value, size, color="#F4F8FF", bold=False, mono=False, anchor="la"):
    draw.text(xy, value, font=font(size, bold, mono), fill=color, anchor=anchor)


def panel(draw, box, fill="#091827", outline="#284A5C", radius=14, width=2):
    draw.rounded_rectangle(box, radius, fill=fill, outline=outline, width=width)


def glow_line(layer, points, color="#34E7C2", width=3):
    blur = Image.new("RGBA", layer.size)
    ImageDraw.Draw(blur).line(points, fill=color, width=width * 5, joint="curve")
    layer.alpha_composite(blur.filter(ImageFilter.GaussianBlur(9)))
    ImageDraw.Draw(layer).line(points, fill=color, width=width, joint="curve")


def base_frame(t, scene):
    palettes = [
        ("#050A15", "#16213B", "#35E6C1"),
        ("#06131A", "#123849", "#48BFFF"),
        ("#10091C", "#35204A", "#FFB54A"),
        ("#061016", "#17313D", "#65F19F"),
        ("#09101D", "#1A2D55", "#56D9FF"),
        ("#100A17", "#3A1D43", "#F6A84B"),
    ]
    a, b, accent = palettes[scene]
    ia = tuple(int(a[i:i+2], 16) for i in (1, 3, 5))
    ib = tuple(int(b[i:i+2], 16) for i in (1, 3, 5))
    im = Image.new("RGB", (W, H), ia)
    d = ImageDraw.Draw(im, "RGBA")
    for y in range(H):
        q = y / H
        d.line((0, y, W, y), fill=tuple(int(ia[k] * (1-q) + ib[k] * q) for k in range(3)))
    horizon = 365
    shift = (t * 45) % 52
    for i in range(-10, 11):
        d.line((W/2+i*28, horizon, W/2+i*95, H), fill=(*tuple(int(accent[j:j+2],16) for j in (1,3,5)), 34), width=1)
    for j in range(8):
        y = horizon + ((j * 52 + shift) ** 1.18) * .48
        if y < H:
            d.line((0, y, W, y), fill=(*tuple(int(accent[k:k+2],16) for k in (1,3,5)), 32), width=1)
    for i in range(28):
        x = (i * 181 + t * (12 + i % 5) * (-1 if i % 2 else 1)) % (W + 80) - 40
        y = (i * 83 + 35 * math.sin(t * .65 + i)) % H
        r = 1 + i % 2
        d.ellipse((x-r, y-r, x+r, y+r), fill=accent + "75")
    return im.convert("RGBA"), accent


def chrome(layer, title, accent):
    d = ImageDraw.Draw(layer, "RGBA")
    panel(d, (34, 38, 926, 495), "#07121FEF", accent, 18, 2)
    d.rectangle((36, 40, 924, 78), fill="#101E2EEF")
    for i, c in enumerate(("#FF657A", "#FFC65B", "#42E7BF")):
        d.ellipse((55+i*22, 54, 65+i*22, 64), fill=c)
    text(d, (480, 59), title, 15, "#C6D6E2", anchor="mm")


def header(layer, scene, title, accent):
    d = ImageDraw.Draw(layer, "RGBA")
    text(d, (42, 24), "AUTOMATION OPS AI", 14, accent, True)
    text(d, (918, 24), f"0{scene+1} / 06", 13, "#8DAABD", True, anchor="ra")
    d.line((42, 34, 918, 34), fill="#355368", width=1)
    lines = wrap(d, title, 720, font(27, True), 2)
    for i, line in enumerate(lines):
        text(d, (480, 98+i*34), line, 27, "#F7FAFF", True, anchor="mm")


def packet(draw, x, y, label, accent, scale=1):
    w, h = 132*scale, 72*scale
    panel(draw, (x-w/2, y-h/2, x+w/2, y+h/2), "#081724", accent, int(14*scale), 2)
    text(draw, (x, y-8*scale), "{  }", int(25*scale), accent, True, anchor="mm")
    text(draw, (x, y+20*scale), label, int(11*scale), "#EEF7FF", True, anchor="mm")


def draw_diagram(layer, local, items, accent, n8n=False):
    d = ImageDraw.Draw(layer, "RGBA")
    centers = [(145+i*222, 303) for i in range(4)]
    progress = clamp(local / max(.1, 1.0))
    for i, (cx, cy) in enumerate(centers):
        at = i * .7
        a = spring((local-at)/.6)
        w, h = 168*a, 104*a
        if a > .02:
            panel(d, (cx-w/2, cy-h/2, cx+w/2, cy+h/2), "#0A1A29EE", accent if i <= int(local/2.5) else "#385268", 14, 2)
            text(d, (cx, cy-10), f"0{i+1}", 14, accent, True, anchor="mm")
            for j, line in enumerate(wrap(d, items[i], 140, font(16, True), 2)):
                text(d, (cx, cy+17+j*19), line, 16, "#F4F8FF", True, anchor="mm")
        if i:
            p = ease((local-at+.25)/.7)
            x1, x2 = centers[i-1][0]+84, cx-84
            glow_line(layer, [(x1,cy),(x1+(x2-x1)*p,cy)], accent, 2)
            px = x1 + (x2-x1) * ((local*.55+i*.17) % 1)
            d.ellipse((px-4, cy-4, px+4, cy+4), fill="#FFFFFF", outline=accent, width=2)
    # A real moving packet demonstrates data flow rather than a static arrow.
    route = clamp((local-2.4)/6.5)
    x = centers[0][0] + (centers[-1][0]-centers[0][0]) * route
    packet(d, x, 420, "payload" if not n8n else "item", accent, .72)
    text(d, (480, 466), "live data flow • values are validated before side effects", 15, "#A9C2D2", anchor="mm")


def draw_code(layer, local, code, accent, terminal=False):
    d = ImageDraw.Draw(layer, "RGBA")
    chrome(layer, "terminal / verified execution" if terminal else "validator.js / reviewed source", accent)
    lines = code.splitlines()
    page = min(max(0, len(lines)-11), int(max(0, local-5)/4)) if len(lines)>11 else 0
    shown = lines[page:page+11]
    reveal = min(len(shown), int(local*1.7)+1)
    for i, line in enumerate(shown[:reveal]):
        y = 102+i*31
        if i == reveal-1:
            d.rounded_rectangle((62, y-4, 897, y+25), 6, fill=accent+"28")
        text(d, (58, y+7), str(page+i+1).rjust(2,"0"), 14, "#6E899A", mono=True, anchor="lm")
        color = "#71F2B0" if terminal and ("PASS" in line or "passed" in line) else "#F6FAFF"
        text(d, (98, y+7), line[:72], 15 if terminal else 14, color, mono=True, anchor="lm")
    cursor_y = 102+(max(0,reveal-1))*31
    if int(local*3)%2:
        d.rectangle((99+min(720, len(shown[max(0,reveal-1)][:72])*8), cursor_y-3, 105+min(720, len(shown[max(0,reveal-1)][:72])*8), cursor_y+22), fill=accent)
    # Scanning beam and progress make the source visibly execute.
    scan_y = 88 + (local*70)%350
    d.rectangle((45, scan_y, 915, scan_y+2), fill=accent+"80")
    d.rounded_rectangle((62, 463, 898, 471), 4, fill="#183447")
    d.rounded_rectangle((62, 463, 62+836*((local*.09)%1), 471), 4, fill=accent)


def draw_checklist(layer, local, items, accent):
    d = ImageDraw.Draw(layer, "RGBA")
    for i, item in enumerate(items):
        y = 206+i*67
        p = spring((local-i*.8)/.65)
        x = 104 + (1-p)*90
        panel(d, (x, y, 856, y+49), "#091927E8", accent if p>.7 else "#355064", 12, 2)
        d.ellipse((x+18, y+13, x+42, y+37), fill=accent if p>.7 else "#253A48")
        if p>.7:
            d.line((x+24,y+25,x+30,y+31,x+39,y+18), fill="#06131A", width=3)
        text(d, (x+58, y+25), item, 18, "#F5F9FC", True, anchor="lm")
    # Keep the subtitle exclusion zone (y >= 478) completely clear.
    pulse = 5 + 3*math.sin(local*3)
    d.ellipse((876-pulse, 420-pulse, 876+pulse, 420+pulse), fill=accent)


def caption(layer, seg, t, accent, duration):
    d = ImageDraw.Draw(layer, "RGBA")
    words = seg["text"].split()
    p = clamp((t-seg["start"])/max(.01,seg["end"]-seg["start"]))
    center = int(p*len(words))
    phrase = " ".join(words[max(0,center-5):min(len(words),center+6)])
    panel(d, (170, 486, 790, 528), "#02070DEB", "#345468", 12, 1)
    lines = wrap(d, phrase, 580, font(14, True), 2)
    for i, line in enumerate(lines):
        text(d, (480, 500+i*16), line, 14, "#FFFFFF", True, anchor="mm")
    d.rounded_rectangle((42, 531, 918, 536), 3, fill="#183447")
    d.rounded_rectangle((42, 531, 42+876*(t/duration), 536), 3, fill=accent)


def render_frame(t, scenes, segments, test_output):
    seg_index = next((i for i,s in enumerate(segments) if s["start"] <= t <= s["end"]+.05), len(segments)-1)
    scene = min(5, seg_index//4)
    scene_start = segments[scene*4]["start"]
    local = t-scene_start
    im, accent = base_frame(t, scene)
    layer = Image.new("RGBA", (W,H))
    header(layer, scene, scenes[scene]["title"], accent)
    visual = scenes[scene]["visualType"]
    if visual == "diagram":
        draw_diagram(layer, local, scenes[scene]["items"], accent, scene==4)
    elif visual in ("code","terminal"):
        code = test_output if visual=="terminal" else scenes[scene]["code"]
        draw_code(layer, local, code, accent, visual=="terminal")
    else:
        draw_checklist(layer, local, scenes[scene]["items"], accent)
    caption(layer, segments[seg_index], t, accent, segments[-1]["end"])
    # Motivated light sweep at each narration beat; it stays behind captions.
    beat_start = segments[seg_index]["start"]
    dt = t-beat_start
    if 0 <= dt < .35:
        x = int(-180 + (W+360)*(dt/.35))
        ImageDraw.Draw(layer,"RGBA").polygon([(x-120,38),(x+20,38),(x+180,478),(x+40,478)], fill=(255,255,255,int(80*(1-dt/.35))))
    im.alpha_composite(layer)
    return im.convert("RGB")


def atempo_chain(factor):
    parts=[]
    while factor>2:
        parts.append(2.0); factor/=2
    while factor<.5:
        parts.append(.5); factor/=.5
    parts.append(factor)
    return ",".join(f"atempo={x:.6f}" for x in parts)


def write_wav(path, audio, sample_rate):
    pcm=np.int16(np.clip(np.asarray(audio,dtype=np.float32),-1,1)*32767)
    with wave.open(str(path),"wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())


def make_voice(segments, out, model_path, voices_path):
    model = Kokoro(str(model_path), str(voices_path))
    work = out.parent/"voice-v4-parts"; work.mkdir(exist_ok=True)
    concat=[]
    cursor=0.0
    for i, seg in enumerate(segments):
        if seg["start"]>cursor+.001:
            gap=work/f"{i:02d}-gap.wav"
            if not gap.exists(): run(["ffmpeg","-y","-loglevel","error","-f","lavfi","-i",f"anullsrc=r=24000:cl=mono","-t",str(seg["start"]-cursor),str(gap)])
            concat.append(gap)
        raw=work/f"{i:02d}-raw.wav"; fitted=work/f"{i:02d}-fit.wav"
        if fitted.exists():
            concat.append(fitted); cursor=seg["end"]; continue
        audio,sr=model.create(seg["text"],voice="af_heart",speed=.98,lang="en-us",sentence_pause=.18,clause_pause=.08)
        write_wav(raw,audio,sr)
        source=len(audio)/sr; target=seg["end"]-seg["start"]
        run(["ffmpeg","-y","-loglevel","error","-i",str(raw),"-af",atempo_chain(source/target),"-ar","24000","-ac","1",str(fitted)])
        concat.append(fitted); cursor=seg["end"]
    listing=work/"concat.txt"
    listing.write_text("\n".join("file '"+str(p.resolve()).replace("'","'\\''")+"'" for p in concat))
    run(["ffmpeg","-y","-loglevel","error","-f","concat","-safe","0","-i",str(listing),"-c:a","pcm_s16le",str(out)])


def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--output",required=True); ap.add_argument("--srt",required=True); ap.add_argument("--scenes",required=True); ap.add_argument("--demo",required=True); ap.add_argument("--voice-cache",required=True); ap.add_argument("--model",required=True); ap.add_argument("--voices",required=True); args=ap.parse_args()
    out=Path(args.output); out.parent.mkdir(parents=True,exist_ok=True)
    segments=load_srt(Path(args.srt))
    scenes=json.loads(Path(args.scenes).read_text())
    demo=Path(args.demo)
    test_output=subprocess.check_output((["python3",str(demo)] if demo.suffix==".py" else ["node",str(demo)]),text=True).strip()
    duration=segments[-1]["end"]
    with tempfile.TemporaryDirectory(prefix="automationops-v4-") as td:
        td=Path(td); visual=td/"visual.mp4"; voice=Path(args.voice_cache)
        if not voice.exists():
            make_voice(segments,voice,Path(args.model),Path(args.voices))
        proc=subprocess.Popen(["ffmpeg","-y","-loglevel","error","-f","rawvideo","-pix_fmt","rgb24","-s",f"{W}x{H}","-r",str(FPS),"-i","-","-an","-c:v","libx264","-preset","veryfast","-crf","18","-pix_fmt","yuv420p",str(visual)],stdin=subprocess.PIPE)
        for i in range(math.ceil(duration*FPS)):
            proc.stdin.write(render_frame(i/FPS,scenes,segments,test_output).tobytes())
        proc.stdin.close(); proc.wait()
        if proc.returncode: raise SystemExit(proc.returncode)
        run(["ffmpeg","-y","-loglevel","error","-i",str(visual),"-i",str(voice),"-vf","scale=1920:1080:flags=lanczos","-af","highpass=f=70,acompressor=threshold=-20dB:ratio=2.2:attack=8:release=150,loudnorm=I=-16:LRA=7:TP=-1.5","-c:v","libx264","-preset","medium","-crf","18","-pix_fmt","yuv420p","-r","30","-c:a","aac","-b:a","192k","-shortest","-movflags","+faststart",str(out)])
    print(json.dumps({"output":str(out),"duration":duration,"renderer":"motion-v4","rights":"original procedural visuals; Kokoro Apache-2.0 model; DejaVu fonts"},indent=2))


if __name__=="__main__":
    main()
