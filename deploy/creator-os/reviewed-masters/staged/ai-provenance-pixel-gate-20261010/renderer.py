#!/usr/bin/env python3
"""Narration-first Short: prove that one altered pixel breaks a local asset audit."""
from __future__ import annotations
import argparse, hashlib, json, math, subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro
from PIL import Image, ImageChops, ImageDraw, ImageFont

W,H,FPS=540,960,30
FONT='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'; BOLD='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'; MONO='/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
C={'bg':'#0A0A0B','paper':'#F8F1E1','orange':'#FF7A00','lime':'#B6FF5C','violet':'#9B5DE5','cyan':'#00C2FF','muted':'#A8A6A0','panel':'#171820','bad':'#FF426D'}
SEGMENTS=(
 'This image was generated for a campaign. Before publishing it, record the file hash and a small provenance manifest.',
 'The verifier reads the real P N G bytes. SHA two fifty-six returns this fingerprint, and the release gate passes.',
 'Now change exactly one pixel. It looks identical at normal size, but the underlying file is no longer the approved asset.',
 'Run the same verifier again. The fingerprint changes, so the provenance gate rejects the altered file before upload.',
 'Zoom in and the evidence becomes visible: one green pixel at coordinate sixty-one, thirty-seven, against the orange mark.',
 'A checksum proves tampering, not authorship or legal compliance. Keep the original source, license, model note, and review record too.',
)

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def proof():
 with TemporaryDirectory() as raw:
  root=Path(raw); a=root/'a.png'; b=root/'b.png'; im=Image.new('RGB',(96,96),'#11131A'); d=ImageDraw.Draw(im)
  for y in range(96): d.line((0,y,95,y),fill=(20+y,40+y//2,130+y))
  d.ellipse((22,22,74,74),fill=C['orange'],outline=C['paper'],width=3); im.save(a,optimize=False); before=digest(a)
  im.putpixel((61,37),(182,255,92)); im.save(b,optimize=False); after=digest(b)
 result={'originalHash':before,'alteredHash':after,'hashesMatch':before==after,'changedPixel':[61,37],'gate':'REJECT' if before!=after else 'PASS'}
 assert result['gate']=='REJECT'; return result
def ff(n,b=False,m=False): return ImageFont.truetype(MONO if m else BOLD if b else FONT,n)
def ease(x): x=max(0,min(1,x)); return x*x*(3-2*x)
def wrap(d,s,f,w):
 out=[]; line=''
 for word in s.split():
  trial=(line+' '+word).strip()
  if d.textbbox((0,0),trial,font=f)[2]<=w: line=trial
  else: out.append(line); line=word
 if line: out.append(line)
 return out

class Frame:
 def __init__(self,t):
  self.t=t; self.bg=Image.new('RGB',(W,H),C['bg']); self.fx=Image.new('RGBA',(W,H)); self.ui=Image.new('RGBA',(W,H)); self.mask=Image.new('L',(W,H)); self.f=ImageDraw.Draw(self.fx); self.d=ImageDraw.Draw(self.ui); self.md=ImageDraw.Draw(self.mask); self.boxes=[]
 def text(self,x,y,s,n=18,c=None,b=False,m=False,anchor=None):
  face=ff(n,b,m); box=self.d.textbbox((x,y),s,font=face,anchor=anchor)
  if not(22<=box[0] and box[2]<=518 and 46<=box[1] and box[3]<=908): raise ValueError((round(self.t,3),s,box))
  self.md.rectangle((box[0]-5,box[1]-4,box[2]+5,box[3]+4),fill=255); self.boxes.append(box); self.d.text((x,y),s,font=face,fill=c or C['paper'],anchor=anchor)
 def finish(self):
  a=self.fx.getchannel('A'); removed=int(np.count_nonzero(np.asarray(ImageChops.multiply(a,self.mask)))); a=ImageChops.multiply(a,ImageChops.invert(self.mask)); self.fx.putalpha(a); overlap=int(np.count_nonzero(np.asarray(ImageChops.multiply(a,self.mask)))); im=self.bg.convert('RGBA'); im.alpha_composite(self.fx); im.alpha_composite(self.ui); return im.convert('RGB'),overlap,removed

def asset(d,x,y,size,altered,scan):
 d.rounded_rectangle((x,y,x+size,y+size),18,fill='#11131A',outline=C['paper'],width=2)
 for row in range(24):
  yy=y+8+row*(size-16)/24; d.line((x+8,yy,x+size-8,yy),fill=(20+row*3,40+row,130+row*3),width=3)
 d.ellipse((x+size*.23,y+size*.23,x+size*.77,y+size*.77),fill=C['orange'],outline=C['paper'],width=3)
 if altered:
  px=x+int(size*61/96); py=y+int(size*37/96); d.rectangle((px-2,py-2,px+3,py+3),fill=C['lime'])
 sy=y+10+int((size-20)*scan); d.line((x+8,sy,x+size-8,sy),fill=C['cyan'],width=2)

def draw(t,timeline,result):
 fr=Frame(t); d,f=fr.d,fr.f; i=next((j for j,s in enumerate(timeline) if t<s['end']+.1),5); seg=timeline[i]; p=ease((t-seg['start'])/max(.1,seg['end']-seg['start']))
 for ring in range(5):
  r=60+ring*52+10*math.sin(t*1.4+ring); f.ellipse((270-r,390-r,270+r,390+r),outline=C['violet'],width=2)
 for k in range(12):
  phase=(t*.18+k/12)%1; f.line((20+phase*500,118+k*52,72+phase*500,118+k*52),fill=C['cyan'],width=2)
 fr.text(28,56,'SYNTHETIC ASSET / FORENSIC GATE',14,C['cyan'],True); fr.text(28,88,'One pixel changed. Ship it?',25,C['paper'],True)
 d.rounded_rectangle((24,132,516,742),24,fill=C['panel'],outline='#383A48',width=2); altered=i>=2
 if i==4:
  size=310; x,y=115,174; asset(d,x,y,size,True,(t*.28)%1); px=x+int(size*61/96); py=y+int(size*37/96); r=44+int(8*math.sin(t*5)); d.ellipse((px-r,py-r,px+r,py+r),outline=C['lime'],width=5)
  fr.text(270,520,'PIXEL 61,37',22,C['lime'],True,True,'ma'); fr.text(270,554,'#B6FF5C',18,C['paper'],False,True,'ma'); hash_y=604; status_y=700
 else:
  size=244; x=148+int(18*math.sin(t*.8)); y=164+int(8*math.cos(t*.7)); asset(d,x,y,size,altered,(t*.28)%1)
  fr.text(270,432,'ALTERED COPY' if altered else 'APPROVED SOURCE',18,C['bad'] if altered else C['lime'],True,anchor='ma'); hash_y=486; status_y=594
 value=result['alteredHash'] if altered else result['originalHash']; visible=max(8,min(64,int(p*68))) if i in (1,3) else 16
 fr.text(48,hash_y,'SHA-256',14,C['muted'],True); fr.text(48,hash_y+28,value[:min(32,visible)],14,C['paper'],False,True)
 if visible>32: fr.text(48,hash_y+53,value[32:visible],14,C['paper'],False,True)
 if i<2: status,color='MATCH / PASS',C['lime']
 elif i==2: status,color='1 PIXEL MUTATION',C['orange']
 else: status,color='MISMATCH / REJECT',C['bad']
 d.rounded_rectangle((48,status_y,492,status_y+72),14,outline=color,width=3); fr.text(270,status_y+35,status,23,color,True,True,'mm')
 if i==5:
  labels=['HASH: TAMPER EVIDENCE','SOURCE + LICENSE','MODEL NOTE + REVIEW']
  for row,label in enumerate(labels):
   yy=682+row*40; d.ellipse((42,yy+2,54,yy+14),fill=C['cyan'] if row==0 else C['lime']); fr.text(66,yy+8,label,14,C['paper'],True,anchor='lm')
 words=seg['text'].split(); active=min(len(words)-1,max(0,int(p*len(words)))); caption=' '.join(words[(active//5)*5:(active//5)*5+5]); rows=wrap(d,caption,ff(22,True),474)
 for row,s in enumerate(rows[:2]): fr.text(270,824+row*30,s,22,C['paper'],True,anchor='ma')
 d.rounded_rectangle((28,925,512,932),4,fill='#30323B'); d.rounded_rectangle((28,925,28+484*t/timeline[-1]['end'],932),4,fill=C['orange']); return fr

def main():
 ap=argparse.ArgumentParser(); ap.add_argument('--model',required=True); ap.add_argument('--voices',required=True); ap.add_argument('--output',type=Path,required=True); a=ap.parse_args(); a.output.mkdir(parents=True,exist_ok=True); result=proof(); (a.output/'proof-output.json').write_text(json.dumps(result,indent=2)+'\n')
 k=Kokoro(a.model,a.voices); parts=[]; timeline=[]; cursor=0.; gap=np.zeros(int(24000*.12),np.float32)
 for i,text in enumerate(SEGMENTS):
  audio,rate=k.create(text,voice='af_heart',speed=1.03,lang='en-us',sentence_pause=.18,clause_pause=.08); audio=np.asarray(audio,np.float32); start=cursor; end=start+len(audio)/rate; timeline.append({'index':i,'text':text,'start':round(start,4),'end':round(end,4)}); parts.append(audio); cursor=end
  if i<len(SEGMENTS)-1: parts.append(gap); cursor+=len(gap)/rate
 voice=np.concatenate(parts); sf.write(a.output/'voice.wav',voice,24000); duration=len(voice)/24000; (a.output/'timeline.json').write_text(json.dumps({'voice':'Kokoro stock af_heart','segments':timeline,'duration':round(duration,4)},indent=2)+'\n')
 n=math.ceil(duration*FPS); proc=subprocess.Popen(['ffmpeg','-y','-v','error','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-vf','scale=1080:1920:flags=lanczos','-an','-c:v','libx264','-threads','2','-preset','fast','-crf','18','-pix_fmt','yuv420p',str(a.output/'visuals.mp4')],stdin=subprocess.PIPE)
 overlap=removed=maxboxes=0; samples=[]
 for no in range(n):
  fr=draw(no/FPS,timeline,result); im,o,r=fr.finish(); overlap+=o; removed+=r; maxboxes=max(maxboxes,len(fr.boxes)); proc.stdin.write(im.tobytes())
  if no%(FPS*5)==0: samples.append(im.resize((270,480)))
  if no==round(timeline[3]['start']*FPS): im.resize((1080,1920),Image.Resampling.LANCZOS).save(a.output/'thumbnail.jpg',quality=94)
 proc.stdin.close(); assert proc.wait()==0; final=a.output/'video.mp4'; subprocess.run(['ffmpeg','-y','-v','error','-i',str(a.output/'visuals.mp4'),'-i',str(a.output/'voice.wav'),'-filter:a','highpass=f=70,acompressor=threshold=-20dB:ratio=2.2:attack=8:release=150,loudnorm=I=-16:TP=-1.5:LRA=7','-c:v','copy','-c:a','aac','-b:a','192k','-shortest','-movflags','+faststart',str(final)],check=True)
 sheet=Image.new('RGB',(1080,480*math.ceil(len(samples)/4)),C['bg'])
 for j,im in enumerate(samples): sheet.paste(im,((j%4)*270,(j//4)*480))
 sheet.save(a.output/'contact-sheet.jpg',quality=90); report={'passed':overlap==0,'framesChecked':n,'intersectingPixels':int(overlap),'effectPixelsRemovedByTextMasks':int(removed),'textBoundsCheckedEveryFrame':True,'maxTextBoxesPerFrame':maxboxes,'videoSha256':digest(final)}; (a.output/'effect-overlap-report.json').write_text(json.dumps(report,indent=2)+'\n'); print(json.dumps({'duration':duration,'proof':result,'composition':report}))
if __name__=='__main__': main()
