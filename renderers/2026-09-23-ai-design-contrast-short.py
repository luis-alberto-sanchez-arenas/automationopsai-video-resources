#!/usr/bin/env python3
"""Narration-first Short: test and repair contrast in an AI-generated UI."""
from __future__ import annotations
import argparse, json, math, subprocess
from pathlib import Path
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W,H,FPS=540,960,30
FONT="/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
BOLD="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
MONO="/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
SEGMENTS=(
 "AI can generate a polished interface in seconds. But did anyone test whether users can read it?",
 "This generated button uses gray text on a slate background. The contrast test returns two point nine six to one.",
 "WCAG double A needs four point five to one for normal text. Pretty is not the same as accessible.",
 "Keep the layout. Replace only the text token, then run the exact same deterministic test again.",
 "Now the ratio is seven point two four to one. The component passes without asking AI to redesign the page.",
 "The useful workflow is generate, measure, repair, and regression test. Not prompt, screenshot, and ship.",
 "Put contrast, focus states, responsive overflow, and design token drift in continuous integration.",
)
def ff(n,b=False,m=False): return ImageFont.truetype(MONO if m else BOLD if b else FONT,n)
def ease(x): x=max(0,min(1,x)); return x*x*(3-2*x)
def wrap(d,s,f,w):
 out=[]; line=""
 for word in s.split():
  trial=(line+" "+word).strip()
  if d.textbbox((0,0),trial,font=f)[2]<=w: line=trial
  else: out.append(line); line=word
 if line: out.append(line)
 return out
def center(d,y,s,n,c="#fff",w=460):
 f=ff(n,True); rows=wrap(d,s,f,w); top=y-len(rows)*(n+7)/2
 for i,row in enumerate(rows): d.text((W/2,top+i*(n+7)),row,font=f,fill=c,anchor="ma")
def panel(im,box,c="#4de8d0"):
 glow=Image.new("RGBA",im.size); ImageDraw.Draw(glow).rounded_rectangle(box,18,fill=c+"45")
 im.alpha_composite(glow.filter(ImageFilter.GaussianBlur(13)))
 ImageDraw.Draw(im).rounded_rectangle(box,18,fill=(5,13,25,244),outline=c,width=2)
def base(t):
 im=Image.new("RGBA",(W,H),"#07111f"); d=ImageDraw.Draw(im,"RGBA")
 for i in range(18):
  y=100+i*39; x=((i*91+t*(18+i%4))%(W+120))-60
  d.line((0,y,W,y),fill="#1f526b30"); d.ellipse((x-3,y-3,x+3,y+3),fill="#4de8d090")
 return im
def chrome(im,i):
 d=ImageDraw.Draw(im); d.rounded_rectangle((24,24,516,76),16,fill="#030912",outline="#4de8d0",width=2)
 d.text((43,39),"AUTOMATION OPS AI",font=ff(16,True),fill="white"); d.text((430,39),f"0{i+1}/07",font=ff(13,True),fill="#4de8d0")
def button(im,fg,label,y=390):
 d=ImageDraw.Draw(im); panel(im,(70,y,470,y+150),"#7d8cff"); d.rounded_rectangle((120,y+45,420,y+112),16,fill="#475569")
 d.text((270,y+78),label,font=ff(22,True),fill=fg,anchor="mm")
def gauge(im,value,passed,y=640):
 d=ImageDraw.Draw(im); c="#53e29c" if passed else "#ff5b78"; panel(im,(70,y,470,y+104),c)
 d.rounded_rectangle((100,y+54,440,y+72),9,fill="#182c3d"); d.rounded_rectangle((100,y+54,100+340*min(value/8,1),y+72),9,fill=c)
 d.text((100,y+25),f"{value:.2f}:1",font=ff(22,True,True),fill="white"); d.text((438,y+25),"PASS" if passed else "FAIL",font=ff(20,True),fill=c,anchor="ra")
def terminal(im,p):
 d=ImageDraw.Draw(im); panel(im,(38,235,502,720),"#53e29c"); d.text((65,265),"python3 demo.py",font=ff(15,True,True),fill="#b9ccda")
 rows=(("before=2.96:1","FAIL","#ff5b78"),("after=7.24:1","PASS","#53e29c"),("layout unchanged","PASS","#53e29c"))
 for j,(a,b,c) in enumerate(rows[:max(1,int(p*3)+1)]):
  y=350+j*105; d.text((65,y),a,font=ff(19,True,True),fill="white"); d.text((440,y),b,font=ff(19,True,True),fill=c,anchor="ra")
def scene(im,i,p):
 d=ImageDraw.Draw(im)
 if i==0:
  center(d,150,"AI-GENERATED ≠ READY",34); button(im,"#94A3B8","Create account"); center(d,690,"MEASURE BEFORE SHIP",24,"#4de8d0")
 elif i==1:
  center(d,145,"LOOKS POLISHED. FAILS.",33,"#ff5b78"); button(im,"#94A3B8","Create account",315); gauge(im,2.955,False,610)
 elif i==2:
  center(d,150,"WCAG AA CONTRAST",34); gauge(im,4.5,True,360); center(d,590,"NORMAL TEXT",24); center(d,650,"MINIMUM 4.5:1",30,"#53e29c")
 elif i==3:
  center(d,145,"REPAIR ONE TOKEN",34); button(im,"#F8FAFC","Create account",310)
  for j,(a,b) in enumerate((("text.muted","#94A3B8"),("text.button","#F8FAFC"))): d.text((80,610+j*55),a,font=ff(17,True,True),fill="#a9bdca"); d.text((450,610+j*55),b,font=ff(18,True,True),fill=b,anchor="ra")
 elif i==4:
  center(d,145,"SAME UI. VERIFIED FIX.",32,"#53e29c"); button(im,"#F8FAFC","Create account",315); gauge(im,7.243,True,610)
 elif i==5:
  center(d,140,"DESIGN QUALITY GATE",34)
  for j,x in enumerate(("GENERATE","MEASURE","REPAIR","REGRESSION TEST")):
   y=280+j*105; panel(im,(75,y,465,y+70),("#7d8cff","#ffca62","#4de8d0","#53e29c")[j]); center(d,y+35,x,21)
 else:
  center(d,145,"SHIP EVIDENCE, NOT VIBES",32)
  for j,x in enumerate(("CONTRAST","FOCUS","RESPONSIVE","TOKEN DRIFT")):
   y=280+j*105; panel(im,(75,y,465,y+70),"#4de8d0"); center(d,y+35,x,21)
def caption(im,s,p):
 d=ImageDraw.Draw(im); d.rounded_rectangle((24,820,516,940),18,fill=(2,7,14,248),outline="#4de8d0",width=2)
 words=s.split(); active=min(len(words)-1,int(p*len(words))); shown=words[max(0,active-5):active+6]
 rows=wrap(d," ".join(shown),ff(18,True),440)
 for j,row in enumerate(rows[:2]): d.text((270,854+j*31),row,font=ff(18,True),fill="white",anchor="ma")
def main():
 ap=argparse.ArgumentParser(); ap.add_argument("--model",required=True); ap.add_argument("--voices",required=True); ap.add_argument("--output",type=Path,required=True); a=ap.parse_args(); out=a.output; out.mkdir(parents=True,exist_ok=True)
 k=Kokoro(a.model,a.voices); pieces=[]; timeline=[]; cursor=0.; gap=np.zeros(int(24000*.13),dtype=np.float32)
 for i,s in enumerate(SEGMENTS):
  audio,rate=k.create(s,voice="af_heart",speed=1.02,lang="en-us",sentence_pause=.18,clause_pause=.08); audio=np.asarray(audio,dtype=np.float32); start=cursor; end=start+len(audio)/rate; timeline.append({"index":i,"text":s,"start":round(start,4),"end":round(end,4)}); pieces.append(audio); cursor=end
  if i<6: pieces.append(gap); cursor+=len(gap)/rate
 voice=np.concatenate(pieces); sf.write(out/"voice.wav",voice,24000); (out/"timeline.json").write_text(json.dumps({"segments":timeline},indent=2)+"\n")
 duration=len(voice)/24000+.2; visual=out/"visuals.mp4"; proc=subprocess.Popen(["ffmpeg","-y","-hide_banner","-loglevel","error","-f","rawvideo","-pix_fmt","rgb24","-s",f"{W}x{H}","-r",str(FPS),"-i","-","-vf","scale=1080:1920:flags=lanczos","-an","-c:v","libx264","-preset","fast","-crf","18","-pix_fmt","yuv420p",str(visual)],stdin=subprocess.PIPE)
 for n in range(math.ceil(duration*FPS)):
  t=n/FPS; i=next((j for j,s in enumerate(timeline) if t<s["end"]+(.13 if j<6 else .2)),6); s=timeline[i]; p=max(0,min(1,(t-s["start"])/max(.1,s["end"]-s["start"]))); im=base(t); chrome(im,i); scene(im,i,p); caption(im,s["text"],p); proc.stdin.write(im.convert("RGB").tobytes())
 proc.stdin.close(); assert proc.wait()==0; final=out/"ai-design-contrast.mp4"
 subprocess.run(["ffmpeg","-y","-hide_banner","-loglevel","error","-i",str(visual),"-i",str(out/"voice.wav"),"-filter:a","highpass=f=70,acompressor=threshold=-20dB:ratio=2.2:attack=8:release=150,loudnorm=I=-16:TP=-1.5:LRA=7","-c:v","copy","-c:a","aac","-b:a","192k","-shortest","-movflags","+faststart",str(final)],check=True)
 thumb=base(timeline[4]["start"]+.8); chrome(thumb,4); scene(thumb,4,.55)
 thumb.convert("RGB").resize((1080,1920),Image.Resampling.LANCZOS).save(out/"thumbnail.jpg",quality=94,subsampling=0)
 print(json.dumps({"video":str(final),"duration":duration}))
if __name__=="__main__": main()
