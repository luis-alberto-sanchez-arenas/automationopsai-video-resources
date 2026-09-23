#!/usr/bin/env python3
"""Narration-first vertical Short showing an executable idempotency proof."""

from __future__ import annotations

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
SEGMENTS = (
    "Your agent timed out. Did the action fail, or did only the response disappear?",
    "Watch this executable demo. The first request creates ticket T zero zero one, then the connection drops.",
    "A blind retry creates T zero zero two. One intention just produced two real side effects.",
    "Now derive one idempotency key from the workflow run and the intended action.",
    "Store that key atomically with the first result before returning success.",
    "The retry sends the same key. The API returns T zero zero one and creates nothing new.",
    "For agent tools: verify before retry, reuse the action key, and make side effects measurable.",
)


def ff(size: int, bold: bool = False, mono: bool = False):
    return ImageFont.truetype(MONO if mono else (BOLD if bold else FONT), size)


def ease(v: float) -> float:
    v = max(0.0, min(1.0, v))
    return v * v * (3 - 2 * v)


def wrap(draw, text, face, width):
    out, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if draw.textbbox((0, 0), trial, font=face)[2] <= width:
            line = trial
        else:
            out.append(line); line = word
    if line: out.append(line)
    return out


def center(draw, y, text, size, color="#ffffff", width=455):
    face = ff(size, True)
    rows = wrap(draw, text, face, width)
    top = y - len(rows) * (size + 7) / 2
    for i, row in enumerate(rows):
        box = draw.textbbox((0, 0), row, font=face)
        draw.text(((W-box[2])/2, top+i*(size+7)), row, font=face, fill=color)


def panel(im, box, color="#55e6ff"):
    glow = Image.new("RGBA", im.size)
    ImageDraw.Draw(glow).rounded_rectangle(box, 18, fill=color+"45")
    im.alpha_composite(glow.filter(ImageFilter.GaussianBlur(14)))
    ImageDraw.Draw(im).rounded_rectangle(box, 18, fill=(5, 13, 25, 238), outline=color, width=2)


def base(t):
    im = Image.new("RGBA", (W, H), "#07111f")
    d = ImageDraw.Draw(im)
    for i in range(22):
        y = 100 + i*33
        x = ((i*83 + t*(20+i%5)) % 680)-70
        d.line((0,y,x,y), fill="#1d547044", width=1)
        d.ellipse((x-3,y-3,x+3,y+3), fill="#55e6ff88")
    scan = int((t*110) % 760)+90
    d.rectangle((25,scan,515,scan+2), fill="#55e6ff28")
    return im


def chrome(im, index):
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((24,24,516,76),16,fill=(3,9,18,235),outline="#55e6ff",width=2)
    d.text((43,39),"AUTOMATION OPS AI",font=ff(16,True),fill="#ffffff")
    d.text((430,39),f"0{index+1}/07",font=ff(13,True),fill="#55e6ff")


def terminal(im, rows, p, danger=False):
    color = "#ff5b78" if danger else "#55e6ff"
    panel(im,(33,214,507,730),color)
    d=ImageDraw.Draw(im)
    d.ellipse((54,237,64,247),fill="#ff5b78"); d.ellipse((72,237,82,247),fill="#ffc857"); d.ellipse((90,237,100,247),fill="#53e29c")
    d.text((119,229),"python3 demo.py",font=ff(15,True,True),fill="#b7cbda")
    visible=max(1,min(len(rows),int(p*len(rows)+1)))
    for i,(cmd,state,col) in enumerate(rows[:visible]):
        y=292+i*74
        d.text((54,y),cmd,font=ff(14,False,True),fill="#edf7ff")
        d.text((54,y+29),state,font=ff(15,True,True),fill=col)


def scene(im,index,p,t):
    d=ImageDraw.Draw(im)
    if index==0:
        center(d,150,"TIMEOUT ≠ NO SIDE EFFECT",37,"#ffffff")
        d.arc((120,285,420,585),20,320*ease(p)+20,fill="#ffc857",width=13)
        center(d,455,"?",105,"#ffc857")
        center(d,675,"RETRY OR VERIFY?",27,"#55e6ff")
    elif index==1:
        center(d,135,"FIRST ATTEMPT",34)
        terminal(im,[("> POST /tickets","201  T-001","#53e29c"),("< response","TIMEOUT","#ffc857")],p)
    elif index==2:
        center(d,135,"BLIND RETRY",34,"#ff5b78")
        terminal(im,[("> attempt 1","created T-001","#53e29c"),("! timeout","response lost","#ffc857"),("> attempt 2","created T-002","#ff5b78"),("side_effects","2  DUPLICATE","#ff5b78")],p,True)
    elif index==3:
        center(d,140,"ONE INTENT → ONE KEY",34)
        for i,value in enumerate(("workflow: run-7","action: refund-42","SHA-256 → 6f8b…a21c")):
            y=285+i*130; panel(im,(58,y,482,y+82),("#55e6ff","#7d8cff","#53e29c")[i]); center(d,y+42,value,21)
    elif index==4:
        center(d,135,"ATOMIC RESULT LEDGER",33)
        for i,(left,right) in enumerate((("key","6f8b…a21c"),("status","DONE"),("result","T-001"))):
            y=285+i*120; panel(im,(55,y,485,y+75),"#53e29c"); d.text((80,y+22),left,font=ff(18,True),fill="#9cb4c7"); d.text((250,y+22),right,font=ff(18,True,True),fill="#ffffff")
    elif index==5:
        center(d,135,"SAFE RETRY",34,"#53e29c")
        terminal(im,[("> attempt 1","T-001  CREATED","#53e29c"),("! timeout","verify key","#ffc857"),("> same key","T-001  REPLAY","#55e6ff"),("side_effects","1  PASS","#53e29c")],p)
    else:
        center(d,145,"RETRY WITHOUT REPEATING",36)
        for i,label in enumerate(("VERIFY STATE","REUSE ACTION KEY","COUNT SIDE EFFECTS")):
            y=300+i*125; panel(im,(63,y,477,y+79),("#55e6ff","#7d8cff","#53e29c")[i]); center(d,y+40,label,22)
        center(d,730,"DETERMINISTIC PROOF ✓",22,"#53e29c")


def caption(im,text,p):
    d=ImageDraw.Draw(im)
    d.rounded_rectangle((24,827,516,938),18,fill=(2,7,14,244),outline="#55e6ff",width=2)
    words=text.split(); active=min(len(words)-1,max(0,int(p*len(words))))
    start=max(0,min(active-4,max(0,len(words)-10))); shown=words[start:start+10]
    rows=[]; row=[]
    for i,w in enumerate(shown):
        trial=" ".join(x[0] for x in row+[(w,start+i==active)])
        if row and d.textbbox((0,0),trial,font=ff(18,True))[2]>440: rows.append(row); row=[]
        row.append((w,start+i==active))
    if row: rows.append(row)
    y=856 if len(rows)>1 else 873
    for row in rows[:2]:
        widths=[d.textbbox((0,0),w,font=ff(18,True))[2] for w,_ in row]; space=7; x=(W-sum(widths)-space*(len(row)-1))/2
        for (word,on),ww in zip(row,widths): d.text((x,y),word,font=ff(18,True),fill="#55e6ff" if on else "#ffffff"); x+=ww+space
        y+=29


def main():
    import argparse
    ap=argparse.ArgumentParser(); ap.add_argument("--model",type=Path,required=True); ap.add_argument("--voices",type=Path,required=True); ap.add_argument("--output",type=Path,required=True)
    args=ap.parse_args(); out=args.output; out.mkdir(parents=True,exist_ok=True)
    kokoro=Kokoro(str(args.model),str(args.voices)); pieces=[]; timeline=[]; cursor=0.0; gap=np.zeros(int(24000*.12),dtype=np.float32)
    for i,text in enumerate(SEGMENTS):
        audio,rate=kokoro.create(text,voice="am_adam",speed=1.05,lang="en-us",sentence_pause=.16,clause_pause=.07); audio=np.asarray(audio,dtype=np.float32)
        start=cursor; end=start+len(audio)/rate; timeline.append({"index":i,"text":text,"start":round(start,4),"end":round(end,4)}); pieces.append(audio); cursor=end
        if i<6: pieces.append(gap); cursor+=len(gap)/rate
    voice=np.concatenate(pieces); sf.write(out/"voice.wav",voice,24000)
    meta={"title":"Stop AI Agent Retries from Duplicating Actions","duration":round(len(voice)/24000,4),"voice":"Kokoro am_adam","segments":timeline}; (out/"timeline.json").write_text(json.dumps(meta,indent=2)+"\n")
    duration=meta["duration"]+.25; visual=out/"visuals.mp4"
    proc=subprocess.Popen(["ffmpeg","-y","-hide_banner","-loglevel","error","-f","rawvideo","-pix_fmt","rgb24","-s",f"{W}x{H}","-r",str(FPS),"-i","-","-vf","scale=1080:1920:flags=lanczos","-an","-c:v","libx264","-preset","fast","-crf","18","-pix_fmt","yuv420p",str(visual)],stdin=subprocess.PIPE)
    for n in range(math.ceil(duration*FPS)):
        t=n/FPS; index=next((i for i,s in enumerate(timeline) if t<s["end"]+(.12 if i<6 else .25)),6); s=timeline[index]; p=max(0,min(1,(t-s["start"])/max(.1,s["end"]-s["start"])))
        im=base(t); chrome(im,index); scene(im,index,p,t); caption(im,s["text"],p); proc.stdin.write(im.convert("RGB").tobytes())
    proc.stdin.close(); assert proc.wait()==0
    final=out/"agent-idempotency.mp4"
    subprocess.run(["ffmpeg","-y","-hide_banner","-loglevel","error","-i",str(visual),"-i",str(out/"voice.wav"),"-filter:a","loudnorm=I=-16:TP=-1.5:LRA=7","-c:v","copy","-c:a","aac","-b:a","192k","-shortest","-movflags","+faststart",str(final)],check=True)
    subprocess.run(["ffmpeg","-y","-hide_banner","-loglevel","error","-ss",str(max(1.5,timeline[2]["start"]+.7)),"-i",str(final),"-frames:v","1","-q:v","2",str(out/"thumbnail.jpg")],check=True)
    print(json.dumps({"video":str(final),**meta}))


if __name__=="__main__": main()
