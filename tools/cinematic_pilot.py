#!/usr/bin/env python3
"""Render a motion-first AutomationOpsAI pilot with an audio-reactive avatar.

The renderer uses only Pillow, NumPy and FFmpeg. All graphics and music are
generated locally, so the result is reproducible and has no stock-media claims.
"""

from __future__ import annotations

import argparse
import math
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS = 1920, 1080, 30
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


def ease(v: float) -> float:
    v = clamp(v)
    return v * v * (3 - 2 * v)


def spring(v: float) -> float:
    v = clamp(v)
    return 1 - math.exp(-7 * v) * math.cos(10 * v)


def rgba(hex_color: str, alpha: int = 255) -> tuple[int, int, int, int]:
    h = hex_color.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (alpha,)


def mix(a, b, t: float):
    return tuple(int(x + (y - x) * t) for x, y in zip(a, b))


def font(size: int, bold: bool = False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT, size)


def glow_line(layer, points, color, width=5, glow=20):
    blur = Image.new("RGBA", layer.size)
    d = ImageDraw.Draw(blur)
    d.line(points, fill=color, width=width * 3, joint="curve")
    blur = blur.filter(ImageFilter.GaussianBlur(glow))
    layer.alpha_composite(blur)
    ImageDraw.Draw(layer).line(points, fill=color, width=width, joint="curve")


def centered_text(draw, xy, text, fnt, fill, stroke=0, stroke_fill=None):
    box = draw.textbbox((0, 0), text, font=fnt, stroke_width=stroke)
    x = xy[0] - (box[2] - box[0]) / 2
    y = xy[1] - (box[3] - box[1]) / 2
    draw.text((x, y), text, font=fnt, fill=fill, stroke_width=stroke,
              stroke_fill=stroke_fill or fill)


def rounded_panel(layer, box, fill, outline, radius=28, width=2, glow=None):
    if glow:
        g = Image.new("RGBA", layer.size)
        ImageDraw.Draw(g).rounded_rectangle(box, radius, fill=glow)
        layer.alpha_composite(g.filter(ImageFilter.GaussianBlur(20)))
    ImageDraw.Draw(layer).rounded_rectangle(box, radius, fill=fill, outline=outline, width=width)


def background(t: float, scene: int) -> Image.Image:
    palettes = [
        ((7, 10, 25), (42, 15, 53), (255, 92, 92)),
        ((8, 20, 30), (10, 47, 56), (43, 224, 190)),
        ((18, 10, 33), (56, 23, 70), (255, 180, 75)),
    ]
    a, b, accent = palettes[scene % len(palettes)]
    # The smooth gradient is calculated at quarter resolution and enlarged;
    # this keeps full-HD rendering fast without changing visible detail.
    bw, bh = W // 4, H // 4
    yy, xx = np.mgrid[0:bh, 0:bw]
    wave_x = bw * (0.50 + 0.16 * math.sin(t * 0.28 + scene))
    wave_y = bh * (0.43 + 0.14 * math.cos(t * 0.23))
    rad = np.sqrt(((xx - wave_x) / bw) ** 2 + ((yy - wave_y) / bh) ** 2)
    blend = np.clip(rad * 1.8, 0, 1)[..., None]
    arr = np.array(a)[None, None, :] * blend + np.array(b)[None, None, :] * (1 - blend)
    halo = np.exp(-(((xx - wave_x) / 108) ** 2 + ((yy - wave_y) / 85) ** 2))[..., None]
    arr += np.array(accent)[None, None, :] * halo * 0.14
    img = Image.fromarray(np.uint8(np.clip(arr, 0, 255)), "RGB").resize((W, H), Image.Resampling.BILINEAR).convert("RGBA")
    layer = Image.new("RGBA", (W, H))
    d = ImageDraw.Draw(layer)
    # Perspective floor grid creates continuous camera motion.
    horizon = 665
    for i in range(-12, 13):
        x0 = W / 2 + i * 52
        x1 = W / 2 + i * 170
        d.line((x0, horizon, x1, H), fill=(*accent, 28), width=2)
    offset = (t * 85) % 80
    for j in range(12):
        y = horizon + ((j * 80 + offset) ** 1.22) * 0.55
        if y < H:
            d.line((0, y, W, y), fill=(*accent, max(5, 36 - j * 2)), width=2)
    # Deterministic particles with parallax.
    for i in range(48):
        px = (i * 211 + t * (18 + i % 7) * (1 if i % 2 else -1)) % (W + 160) - 80
        py = (i * 97 + 90 * math.sin(t * 0.35 + i)) % H
        r = 1 + i % 3
        d.ellipse((px-r, py-r, px+r, py+r), fill=(*accent, 60 + (i % 4) * 25))
    img.alpha_composite(layer)
    return img


def draw_brand(layer, t):
    d = ImageDraw.Draw(layer)
    x = 62 + 5 * math.sin(t * 1.7)
    d.rounded_rectangle((x, 48, x + 54, 102), 16, fill=rgba("#2BE0BE"), outline=rgba("#BFFFF1"), width=2)
    d.line((x+15, 75, x+27, 63, x+39, 75, x+27, 88, x+15, 75), fill=rgba("#071822"), width=5, joint="curve")
    d.text((x + 72, 54), "AUTOMATION OPS", font=font(28, True), fill=rgba("#F7FAFF"))
    d.text((x + 72, 84), "BUILD • TEST • SHIP", font=font(16, True), fill=rgba("#75A9B8"))


def draw_avatar(layer, t, amp, point=False):
    # Original non-human guide, deliberately small and non-photorealistic.
    cx, cy = 1650, 820
    bob = 8 * math.sin(t * 2.1)
    cy += bob
    g = Image.new("RGBA", layer.size)
    gd = ImageDraw.Draw(g)
    gd.ellipse((cx-150, cy-150, cx+150, cy+150), fill=rgba("#33E6D0", 70))
    layer.alpha_composite(g.filter(ImageFilter.GaussianBlur(35)))
    d = ImageDraw.Draw(layer)
    d.ellipse((cx-130, cy-130, cx+130, cy+130), fill=rgba("#071622", 225), outline=rgba("#53F2D7", 210), width=4)
    d.arc((cx-116, cy-116, cx+116, cy+116), 195, 335, fill=rgba("#FFB44B"), width=7)
    # Head and face.
    d.rounded_rectangle((cx-72, cy-72, cx+72, cy+58), 40, fill=rgba("#EAFBFF"), outline=rgba("#56EBD4"), width=5)
    blink = (int(t * 1.6) % 9) == 0 and (t * 1.6) % 1 < .12
    eye_h = 3 if blink else 17
    for ex in (cx-33, cx+33):
        d.rounded_rectangle((ex-13, cy-27-eye_h/2, ex+13, cy-27+eye_h/2), 8, fill=rgba("#101C35"))
        if not blink:
            d.ellipse((ex-5, cy-32, ex+5, cy-22), fill=rgba("#2BE0BE"))
    mouth = 5 + 22 * clamp(amp * 3.2)
    d.rounded_rectangle((cx-30, cy+17-mouth/2, cx+30, cy+17+mouth/2), 10, fill=rgba("#17233E"), outline=rgba("#FF9C66"), width=3)
    d.line((cx-40, cy+66, cx-70, cy+100), fill=rgba("#EAFBFF"), width=20)
    if point:
        d.line((cx+35, cy+67, cx-130, cy-160), fill=rgba("#EAFBFF"), width=22)
        d.ellipse((cx-144, cy-176, cx-116, cy-148), fill=rgba("#FFB44B"))
    else:
        d.line((cx+40, cy+66, cx+75, cy+100), fill=rgba("#EAFBFF"), width=20)
    d.rounded_rectangle((cx-112, cy+118, cx+112, cy+156), 18, fill=rgba("#102841", 235), outline=rgba("#53F2D7"), width=2)
    centered_text(d, (cx, cy+136), "NOVA • GUIDE", font(17, True), rgba("#D8FFF8"))


def draw_packet(layer, x, y, scale, ok=True, label="JSON"):
    d = ImageDraw.Draw(layer)
    w, h = 260 * scale, 150 * scale
    box = (x-w/2, y-h/2, x+w/2, y+h/2)
    color = "#2BE0BE" if ok else "#FF646E"
    rounded_panel(layer, box, rgba("#0B1727", 230), rgba(color), int(24*scale), max(2, int(4*scale)), rgba(color, 45))
    centered_text(d, (x, y-18*scale), "{  }", font(max(18, int(58*scale)), True), rgba(color))
    centered_text(d, (x, y+43*scale), label, font(max(14, int(23*scale)), True), rgba("#F6FAFF"))


def draw_node(layer, center, label, sub, color, active=1.0, scale=1.0):
    x, y = center
    w, h = 310*scale, 150*scale
    alpha = int(235 * clamp(active))
    rounded_panel(layer, (x-w/2, y-h/2, x+w/2, y+h/2), rgba("#0A1827", alpha), rgba(color, int(240*clamp(active))), int(26*scale), 3, rgba(color, int(55*clamp(active))))
    d = ImageDraw.Draw(layer)
    d.ellipse((x-w/2+24*scale, y-22*scale, x-w/2+68*scale, y+22*scale), fill=rgba(color, alpha))
    d.text((x-w/2+84*scale, y-h/2+31*scale), label,
           font=font(max(18, int(28*scale)), True), fill=rgba("#F5FAFF", alpha))
    d.text((x-w/2+84*scale, y-h/2+76*scale), sub,
           font=font(max(14, int(18*scale))), fill=rgba("#9DB6C6", alpha))


def connector(layer, a, b, progress, color="#2BE0BE", reverse=False):
    progress = ease(progress)
    ax, ay = a; bx, by = b
    ex, ey = ax + (bx-ax)*progress, ay + (by-ay)*progress
    glow_line(layer, [(ax, ay), (ex, ey)], rgba(color, 230), 5, 16)
    if progress > .07:
        angle = math.atan2(by-ay, bx-ax)
        s = 15
        p1 = (ex-s*math.cos(angle-.55), ey-s*math.sin(angle-.55))
        p2 = (ex-s*math.cos(angle+.55), ey-s*math.sin(angle+.55))
        ImageDraw.Draw(layer).polygon([(ex, ey), p1, p2], fill=rgba(color))
    pulse = (progress * 0.83 + (0.5 if reverse else 0)) % 1
    px, py = ax + (bx-ax)*pulse, ay + (by-ay)*pulse
    ImageDraw.Draw(layer).ellipse((px-9, py-9, px+9, py+9), fill=rgba("#FFFFFF"), outline=rgba(color), width=4)


def caption(layer, text, accent="#FFB44B"):
    d = ImageDraw.Draw(layer)
    f = font(35, True)
    box = d.textbbox((0, 0), text, font=f)
    tw = box[2]-box[0]
    x = 960-tw/2
    rounded_panel(layer, (x-30, 955, x+tw+30, 1025), rgba("#050B14", 220), rgba(accent, 140), 22, 2)
    d.text((x, 970), text, font=f, fill=rgba("#FFFFFF"))


def frame_at(t: float, amp: float) -> Image.Image:
    scene = 0 if t < 12.4 else 1 if t < 24.3 else 2
    img = background(t, scene)
    layer = Image.new("RGBA", (W, H))
    draw_brand(layer, t)
    d = ImageDraw.Draw(layer)

    if t < 12.4:
        p = t / 12.4
        packet_x = -160 + ease(clamp(t/2.4)) * 760
        draw_packet(layer, packet_x, 480, 1.05, True)
        # Scanner / contract gate.
        gate_x = 870
        d.rounded_rectangle((gate_x-22, 270, gate_x+22, 690), 16, fill=rgba("#FFB44B", 220))
        d.ellipse((gate_x-55, 425, gate_x+55, 535), outline=rgba("#FFF0CF"), width=7)
        if t > 2.3:
            result_p = ease((t-2.3)/2.0)
            rx = gate_x + 80 + result_p * 270
            draw_packet(layer, rx, 480, 1.05, t < 4.8, "VALID")
        if 4.0 < t < 8.4:
            a = spring((t-4)/.7)
            centered_text(d, (960, 190), "VALID JSON", font(int(78+12*a), True), rgba("#2BE0BE"), 2, rgba("#07121F"))
            centered_text(d, (960, 760), "CAN STILL FAIL", font(int(88+10*math.sin(t*6)), True), rgba("#FF646E"), 3, rgba("#1A0710"))
        if t >= 8.4:
            a = spring((t-8.4)/.8)
            d.rounded_rectangle((570, 160, 1350, 300), 38, fill=rgba("#0B1928", int(230*a)), outline=rgba("#FFB44B", int(255*a)), width=4)
            centered_text(d, (960, 215), "NO API KEY REQUIRED", font(48, True), rgba("#FFF5DC", int(255*a)))
            centered_text(d, (960, 270), "reproducible local test", font(25), rgba("#FFCA79", int(255*a)))
        draw_avatar(layer, t, amp, point=t > 4)
        caption(layer, "Valid syntax does not guarantee safe data", "#FF646E")

    elif t < 24.3:
        local = t - 12.4
        parser = (520, 470); contract = (960, 470); db = (1400, 470)
        draw_node(layer, parser, "PARSE", "Is the syntax valid?", "#2BE0BE", spring(local/.8))
        connector(layer, (680,470), (800,470), (local-1.2)/1.0)
        draw_node(layer, contract, "CONTRACT", "Are values useful?", "#FFB44B", spring((local-2)/.8))
        connector(layer, (1120,470), (1240,470), (local-4.5)/1.0, "#FF646E")
        draw_node(layer, db, "STORE", "side effect blocked", "#FF646E", spring((local-5.2)/.8))
        scan_x = 375 + (local*170) % 1200
        glow_line(layer, [(scan_x, 300), (scan_x, 650)], rgba("#7B8CFF", 120), 3, 18)
        if local > 7.0:
            d.line((1340, 410, 1460, 530), fill=rgba("#FF646E"), width=12)
            d.line((1460, 410, 1340, 530), fill=rgba("#FF646E"), width=12)
        centered_text(d, (960, 185), "SYNTAX ≠ SEMANTICS", font(68, True), rgba("#FFFFFF"), 2, rgba("#09121C"))
        draw_avatar(layer, t, amp, point=local > 2)
        caption(layer, "Parse first. Validate before you store.", "#2BE0BE")

    else:
        local = t - 24.3
        nodes = [
            ((300, 400), "REQUIRED", "missing keys", "#FFB44B"),
            ((700, 400), "UNEXPECTED", "extra keys", "#7B8CFF"),
            ((1100, 400), "ALLOWED", "known actions", "#2BE0BE"),
            ((1500, 400), "RANGE", "0 ≤ score ≤ 1", "#FF8AA3"),
        ]
        for i, (pos, lab, sub, color) in enumerate(nodes):
            draw_node(layer, pos, lab, sub, color, spring((local-i*.75)/.65), .9)
            if i:
                connector(layer, (nodes[i-1][0][0]+140,400), (pos[0]-140,400), (local-i*.75+.1)/.65, color)
        gate_p = spring((local-3.6)/.8)
        draw_node(layer, (720, 700), "ACCEPTED", "continue safely", "#2BE0BE", gate_p, .95)
        draw_node(layer, (1200, 700), "REVIEW", "stop and inspect", "#FF646E", gate_p, .95)
        if local > 3.4:
            connector(layer, (960, 515), (720,625), (local-3.4)/.8, "#2BE0BE")
            connector(layer, (960, 515), (1200,625), (local-3.4)/.8, "#FF646E", True)
        centered_text(d, (960, 180), "VALIDATE BEFORE SIDE EFFECTS", font(62, True), rgba("#FFF4DF"), 2, rgba("#170B1E"))
        draw_avatar(layer, t, amp, point=True)
        caption(layer, "Required keys • allowed values • numeric range", "#FFB44B")

    # Scene-change light sweeps instead of hard slide cuts.
    for cut in (12.4, 24.3):
        dt = abs(t-cut)
        if dt < .35:
            alpha = int(190*(1-dt/.35))
            x = int((t-cut+.35)/.7*W)
            d.polygon([(x-260,0),(x+80,0),(x+360,H),(x+20,H)], fill=(255,255,255,alpha))
    img.alpha_composite(layer)
    return img.convert("RGB")


def make_bed(path: Path, duration: float, sr: int = 44100):
    n = int(duration*sr)
    t = np.arange(n)/sr
    # Original ambient pulse: Dm(add9), sparse and intentionally quiet.
    freqs = [73.42, 110.0, 146.83, 164.81, 220.0]
    signal = np.zeros(n, dtype=np.float64)
    for i, f in enumerate(freqs):
        signal += (0.10/(i+1)) * np.sin(2*np.pi*f*t + i*.7) * (0.75 + .25*np.sin(2*np.pi*.07*t+i))
    pulse = ((np.sin(2*np.pi*1.0*t) + 1)/2) ** 10
    signal += .018*pulse*np.sin(2*np.pi*55*t)
    rng = np.random.default_rng(9031)
    noise = rng.normal(0, .006, n)
    kernel = np.ones(500)/500
    signal += np.convolve(noise, kernel, mode="same")*2.0
    # Transition whooshes.
    for center in (12.4, 24.3):
        env = np.exp(-((t-center)/.28)**2)
        signal += .035*env*np.sin(2*np.pi*(220*t + 80*(t-center)**2))
    signal *= np.minimum(1, t/1.2) * np.minimum(1, (duration-t)/1.0)
    pcm = np.int16(np.clip(signal, -.95, .95)*32767)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(sr); wf.writeframes(pcm.tobytes())


def audio_rms(path: Path, duration: float):
    with wave.open(str(path), "rb") as wf:
        rate = wf.getframerate(); channels = wf.getnchannels()
        data = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16).astype(np.float32)/32768
    if channels > 1:
        data = data.reshape(-1, channels).mean(axis=1)
    values=[]
    for i in range(int(duration*FPS)):
        a=int(i/FPS*rate); b=int((i+1)/FPS*rate)
        values.append(float(np.sqrt(np.mean(data[a:b]**2))) if b>a else 0)
    peak=max(values) or 1
    return [clamp(v/(peak*.75)) for v in values]


def run(cmd):
    subprocess.run(cmd, check=True)


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("source", type=Path)
    ap.add_argument("output", type=Path)
    ap.add_argument("--duration", type=float, default=35.568)
    args=ap.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="cinematic-pilot-") as td:
        tmp=Path(td); voice=tmp/"voice.wav"; bed=tmp/"bed.wav"; mix_audio=tmp/"mix.wav"; silent=tmp/"silent.mp4"
        run(["ffmpeg","-y","-hide_banner","-loglevel","error","-i",str(args.source),"-t",str(args.duration),"-vn",
             "-af","highpass=f=75,lowpass=f=15500,equalizer=f=250:t=q:w=1:g=-2,equalizer=f=3500:t=q:w=1:g=2,acompressor=threshold=-18dB:ratio=2.6:attack=8:release=110:makeup=2.5,alimiter=limit=0.90",
             "-ar","44100","-ac","1",str(voice)])
        make_bed(bed,args.duration)
        run(["ffmpeg","-y","-hide_banner","-loglevel","error","-i",str(voice),"-i",str(bed),
             "-filter_complex","[1:a]volume=0.22[bed];[bed][0:a]sidechaincompress=threshold=0.025:ratio=8:attack=12:release=280[duck];[0:a][duck]amix=inputs=2:weights='1 0.7':normalize=0,loudnorm=I=-16:LRA=7:TP=-1.0[a]",
             "-map","[a]","-t",str(args.duration),str(mix_audio)])
        amps=audio_rms(voice,args.duration)
        enc=subprocess.Popen(["ffmpeg","-y","-hide_banner","-loglevel","error","-f","rawvideo","-pix_fmt","rgb24","-s",f"{W}x{H}","-r",str(FPS),"-i","-","-an","-c:v","libx264","-preset","medium","-crf","18","-pix_fmt","yuv420p",str(silent)],stdin=subprocess.PIPE)
        frames=int(args.duration*FPS)
        for i in range(frames):
            enc.stdin.write(frame_at(i/FPS,amps[min(i,len(amps)-1)]).tobytes())
        enc.stdin.close()
        if enc.wait()!=0: raise RuntimeError("video encoder failed")
        run(["ffmpeg","-y","-hide_banner","-loglevel","error","-i",str(silent),"-i",str(mix_audio),"-map","0:v","-map","1:a","-c:v","copy","-c:a","aac","-b:a","192k","-movflags","+faststart","-shortest",str(args.output)])


if __name__ == "__main__":
    main()
