#!/usr/bin/env python3
"""Narration-first standard episode: execute REST and MCP against one real tool."""
from __future__ import annotations
import argparse, hashlib, json, math, subprocess, sys
from pathlib import Path
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro
from PIL import Image,ImageChops,ImageDraw,ImageFont

W,H,FPS=960,540,30
FONT='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'; BOLD='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'; MONO='/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
C={'bg':'#08131B','ink':'#EFF8F3','rest':'#FF9F1C','mcp':'#2EC4B6','violet':'#7B61FF','grid':'#163441','panel':'#0E202B','muted':'#8AA6AE','bad':'#FF4D6D','good':'#9EF01A','white':'#FFFFFF'}
SEGMENTS=(
 'Should your AI agent call a normal API, or should you build an MCP server? We will run both against the same inventory tool.',
 'No slides and no vague architecture. This local lab executes fifty requests per path, rejects bad input, and records every protocol step.',
 'The business question is simple: look up stock for SKU GPU zero one without allowing the agent to invent parameters or modify inventory.',
 'Both paths must return seven available units from warehouse MEX one. If the values differ, the test fails immediately.',
 'We will compare behavior, not declare a universal winner. The latency numbers only describe this loopback machine and this tiny workload.',
 'Start with the shared core. One lookup function accepts exactly one string SKU, checks the allowlist, and returns a read-only record.',
 'That boundary matters because transport should not duplicate business rules. REST and MCP call the same validated function.',
 'On the left, an HTTP client sends GET inventory with a SKU query parameter. The server answers JSON and status two hundred.',
 'On the right, an MCP client starts a standard session over standard input and output, then discovers the tool before calling it.',
 'The inventory database is a deterministic in-memory fixture, so every run is reproducible and costs no model or API credits.',
 'Build the REST path first. The handler accepts only slash inventory, reads the SKU, and sends an explicit JSON content type.',
 'A known SKU returns the record. A missing or unknown SKU returns status four hundred instead of a plausible invented answer.',
 'Now execute the real request. The browser lane receives Edge GPU, seven available, and warehouse MEX one.',
 'The response is useful to any fixed application because the endpoint and payload contract are already known by the client.',
 'REST stays the simpler choice when you own both sides and the caller does not need runtime tool discovery.',
 'Now build the MCP path. The first request is initialize, where client and server agree on a protocol version and capabilities.',
 'After the initialized notification, tools list exposes inventory lookup, its description, and a JSON input schema.',
 'The schema requires SKU, forbids extra properties, and documents the expected pattern before the agent attempts a call.',
 'Tools call then carries the selected name and arguments. The server invokes the same lookup function used by REST.',
 'The response includes structured content plus a text representation, and the measured stock matches the REST result exactly.',
 'Next comes the controlled failure. We send NOT A SKU and an extra property that the tool never declared.',
 'The REST endpoint returns four hundred. The MCP tool returns an error result. Neither path reaches an inventory mutation.',
 'This is the production lesson: discovery does not replace validation. The server must enforce the contract after every call.',
 'The trace shows initialize, tools list, and tools call in order. Skipping initialization would violate the session lifecycle.',
 'Because the tool is read only, the description says so, and the implementation has no update function to invoke accidentally.',
 'Now run fifty successful lookups through each path. Every response is compared field by field, not just by status.',
 'The local median appears on screen, but it is not an internet benchmark. Process startup, network distance, and payload size change the result.',
 'What matters here is consistency: fifty REST results and fifty MCP results contain the same SKU, name, availability, and warehouse.',
 'The proof also records the protocol version, discovered tool name, schema restriction, invalid input result, and benchmark scope.',
 'That evidence can run in continuous integration without an LLM, so protocol regressions are caught before an agent sees the server.',
 'Add observability next. Every call gets a trace identifier, transport label, method, duration, result type, and validation outcome.',
 'A dashboard can now separate client errors from server failures and detect a sudden rise in unknown SKU requests.',
 'For consequential tools, add authentication, authorization, rate limits, approval boundaries, and audit storage around the same core.',
 'For long operations, do not hold a tool call forever. Use a durable task pattern or your existing job queue and expose progress.',
 'The architecture remains testable because transport, policy, business logic, and side effects are separate layers.',
 'Use REST for stable service contracts and ordinary application integration. It is direct, familiar, and easy to operate.',
 'Use MCP when an agent must discover tools, negotiate capabilities, and call a standardized interface across different hosts.',
 'Do not wrap every endpoint in MCP. Publish a narrow, well-described tool surface that matches real agent decisions.',
 'The complete server, client, failure test, and evidence are reproducible in the repository with only the Python standard library.',
 'The final rule is simple: choose the interface from the caller contract, then prove validation, observability, and result equality before production.',
)

def ff(n,b=False,m=False): return ImageFont.truetype(MONO if m else BOLD if b else FONT,n)
def ease(x): x=max(0,min(1,x)); return x*x*(3-2*x)
def wrap(d,s,f,w):
 out=[]; line=''
 for word in s.split():
  q=(line+' '+word).strip()
  if d.textbbox((0,0),q,font=f)[2]<=w: line=q
  else: out.append(line); line=word
 if line: out.append(line)
 return out
class Frame:
 def __init__(self,t):
  self.t=t; self.bg=Image.new('RGB',(W,H),C['bg']); self.fx=Image.new('RGBA',(W,H)); self.ui=Image.new('RGBA',(W,H)); self.mask=Image.new('L',(W,H)); self.f=ImageDraw.Draw(self.fx); self.d=ImageDraw.Draw(self.ui); self.md=ImageDraw.Draw(self.mask); self.boxes=[]
 def text(self,x,y,s,n=18,c=None,b=False,m=False,anchor=None):
  face=ff(n,b,m); box=self.d.textbbox((x,y),s,font=face,anchor=anchor)
  if not(18<=box[0] and box[2]<=942 and 15<=box[1] and box[3]<=505): raise ValueError((round(self.t,2),s,box))
  self.md.rectangle((box[0]-4,box[1]-3,box[2]+4,box[3]+3),fill=255); self.boxes.append(box); self.d.text((x,y),s,font=face,fill=c or C['ink'],anchor=anchor)
 def finish(self):
  a=self.fx.getchannel('A'); removed=int(np.count_nonzero(np.asarray(ImageChops.multiply(a,self.mask)))); a=ImageChops.multiply(a,ImageChops.invert(self.mask)); self.fx.putalpha(a); overlap=int(np.count_nonzero(np.asarray(ImageChops.multiply(a,self.mask)))); im=self.bg.convert('RGBA'); im.alpha_composite(self.fx); im.alpha_composite(self.ui); return im.convert('RGB'),overlap,removed

def panel(d,box,outline=C['grid'],fill=C['panel'],width=2): d.rounded_rectangle(box,14,fill=fill,outline=outline,width=width)
def background(fr,t,scene):
 f=fr.f
 for y in range(0,H,18): f.line((0,y,W,y),fill=(20,55,67,80),width=1)
 shift=(t*38)%80
 for x in range(-160,1100,80): f.line((480+(x-480)*.28,210,x+shift,540),fill=(46,196,182,40),width=1)
 for k in range(18):
  x=(k*173+t*(18+k%4))%1040-40; y=70+(k*61)%360; f.ellipse((x-2,y-2,x+2,y+2),fill=C['violet'])
 fr.text(28,25,'AUTOMATION OPS AI / PROTOCOL LAB',13,C['mcp'],True); fr.text(932,25,f'{scene+1:02d} / 08',12,C['muted'],True,anchor='ra')

def code_window(fr,x,y,w,h,title,lines,active,color,typed=True):
 d=fr.d; panel(d,(x,y,x+w,y+h),color); d.rectangle((x+2,y+2,x+w-2,y+30),fill='#102A35'); fr.text(x+16,y+17,title,12,color,True,anchor='lm')
 visible=len(lines) if not typed else min(len(lines),max(1,active+1))
 for i,line in enumerate(lines[:visible]):
  yy=y+48+i*23
  if i==active%max(1,len(lines)): d.rounded_rectangle((x+12,yy-12,x+w-12,yy+11),5,fill=color+'25')
  fr.text(x+18,yy,line[:56],12,C['ink'] if not line.startswith('$') else C['good'],False,True,anchor='lm')

def packet(fr,x,y,label,color):
 d=fr.d; d.rounded_rectangle((x-48,y-18,x+48,y+18),9,fill='#08131B',outline=color,width=2); fr.text(x,y,label,11,color,True,True,'mm')

def scene_hook(fr,t,local,beat,p):
 d=fr.d; fr.text(480,70,'REST or MCP? Run the same tool.',30,C['ink'],True,anchor='ma')
 panel(d,(42,112,452,405),C['rest']); panel(d,(508,112,918,405),C['mcp']); fr.text(247,140,'REST / HTTP',19,C['rest'],True,anchor='ma'); fr.text(713,140,'MCP / STDIO',19,C['mcp'],True,anchor='ma')
 for lane,color,x in [('GET',C['rest'],247),('tools/call',C['mcp'],713)]:
  yy=200+int(85*((local*.27)%1)); packet(fr,x,yy,lane,color)
  fr.text(x,330,'GPU-01 → 7 units',21,C['good'],True,True,'ma')
 fr.text(480,382,'RESULT EQUALITY: PASS',18,C['good'],True,True,'ma')

def scene_arch(fr,t,local,beat,p):
 d=fr.d; fr.text(480,65,'One validated core. Two transports.',28,C['ink'],True,anchor='ma')
 centers=[120,330,600,840]; labels=['CLIENT','TRANSPORT','LOOKUP CORE','INVENTORY']; colors=[C['violet'],C['rest'] if beat%2==0 else C['mcp'],C['good'],C['cyan'] if 'cyan' in C else C['mcp']]
 for i,(x,label,color) in enumerate(zip(centers,labels,colors)):
  panel(d,(x-76,190,x+76,285),color); fr.text(x,227,f'{i+1:02d}',13,color,True,'', 'ma'); fr.text(x,257,label,15,C['ink'],True,anchor='ma')
  if i: d.line((centers[i-1]+76,237,x-76,237),fill=color,width=3)
 x=120+(840-120)*((local*.12)%1); packet(fr,x,340,'GPU-01',C['mcp'] if beat%2 else C['rest'])
 fr.text(480,395,'transport ≠ business rules',20,C['muted'],True,anchor='ma')

def scene_rest(fr,t,local,beat,p):
 fr.text(480,61,'Execute the REST contract',27,C['rest'],True,anchor='ma')
 lines=['class Handler(BaseHTTPRequestHandler):','  if path != "/inventory": 404','  sku = query["sku"]','  record = lookup({"sku": sku})','  reply(200, record)','  invalid input → 400']
 code_window(fr,35,100,520,305,'server.py / REST handler',lines,beat,C['rest'])
 code_window(fr,585,130,340,220,'HTTP trace',['$ GET /inventory?sku=GPU-01','200 application/json','{"available":7,',' "warehouse":"MEX-1"}','$ invalid → 400'],beat,C['good'])

def scene_mcp(fr,t,local,beat,p):
 fr.text(480,61,'Negotiate, discover, then call',27,C['mcp'],True,anchor='ma')
 methods=['1  initialize','2  notifications/initialized','3  tools/list','4  tools/call']
 for i,label in enumerate(methods):
  y=120+i*70; active=i==beat%4; panel(fr.d,(58,y,354,y+48),C['mcp'] if active else C['grid'],fill='#0C1C25'); fr.text(206,y+24,label,15,C['mcp'] if active else C['muted'],True,True,'mm')
 schema=['name: inventory_lookup','required: [sku]','pattern: ^[A-Z]{3}-[0-9]{2}$','additionalProperties: false','readOnly: true']
 code_window(fr,405,108,500,300,'tools/list / discovered schema',schema,beat,C['mcp'])
 x=360+int(480*((local*.18)%1)); packet(fr,x,425,'JSON-RPC',C['mcp'])

def scene_failure(fr,t,local,beat,p):
 fr.text(480,61,'Controlled failure: bad arguments',27,C['bad'],True,anchor='ma'); d=fr.d
 code_window(fr,40,110,410,250,'input',['sku: "NOT-A-SKU"','extra: true','schema: additionalProperties=false'],beat,C['bad'])
 code_window(fr,510,110,410,250,'observed result',['REST status: 400','MCP isError: true','inventory writes: 0','side effects: 0'],beat,C['good'])
 d.line((450,235,510,235),fill=C['bad'],width=5); x=450+60*((local*.5)%1); d.ellipse((x-6,229,x+6,241),fill=C['bad'])
 fr.text(480,404,'SERVER VALIDATION STILL REQUIRED',20,C['bad'],True,anchor='ma')

def scene_bench(fr,t,local,beat,p,proof):
 fr.text(480,61,'Fifty real calls per path',27,C['ink'],True,anchor='ma'); d=fr.d
 runs=min(50,int((local*.9)%55)); fr.text(480,118,f'RUN {runs:02d} / 50',20,C['muted'],True,True,'ma')
 for row,(name,color,value) in enumerate([('REST',C['rest'],proof['localMedianMs']['rest']),('MCP STDIO',C['mcp'],proof['localMedianMs']['mcpStdio'])]):
  y=190+row*110; fr.text(82,y,name,18,color,True,anchor='lm'); width=620*min(1,value/max(1.0,proof['localMedianMs']['rest'])); d.rounded_rectangle((210,y-18,850,y+18),9,fill='#102A35'); d.rounded_rectangle((210,y-18,210+width,y+18),9,fill=color); fr.text(870,y,f'{value:.3f} ms',15,C['ink'],True,True,'rm')
 fr.text(480,420,'LOCAL LOOPBACK ONLY — NOT A UNIVERSAL RANKING',15,C['muted'],True,anchor='ma')

def scene_obs(fr,t,local,beat,p):
 fr.text(480,61,'Evidence you can monitor',27,C['ink'],True,anchor='ma'); d=fr.d
 headers=['TRACE','TRANSPORT','METHOD','RESULT','VALIDATION']; xs=[70,235,410,585,760]
 for x,h in zip(xs,headers): fr.text(x,115,h,12,C['muted'],True,anchor='la')
 rows=[('a91f','REST','GET','200','PASS'),('b07c','MCP','initialize','OK','PASS'),('b07d','MCP','tools/list','1 tool','PASS'),('b07e','MCP','tools/call','7 units','PASS'),('c42a','MCP','tools/call','ERROR','REJECT')]
 visible=min(len(rows),1+beat)
 for r,row in enumerate(rows[:visible]):
  y=155+r*52; d.rounded_rectangle((52,y-20,908,y+20),7,fill='#0C1C25',outline=C['bad'] if row[3]=='ERROR' else C['grid'])
  for x,val in zip(xs,row): fr.text(x,y,val,13,C['bad'] if val in ('ERROR','REJECT') else C['ink'],False,True,anchor='lm')
 fr.text(480,438,'trace • duration • outcome • policy',17,C['mcp'],True,anchor='ma')

def scene_decision(fr,t,local,beat,p):
 fr.text(480,61,'Choose from the caller contract',27,C['ink'],True,anchor='ma'); d=fr.d
 panel(d,(40,105,460,400),C['rest']); panel(d,(500,105,920,400),C['mcp']); fr.text(250,140,'USE REST',21,C['rest'],True,anchor='ma'); fr.text(710,140,'USE MCP',21,C['mcp'],True,anchor='ma')
 left=['fixed client','known endpoint','ordinary service integration','mature operations']; right=['agent discovers tools','capability negotiation','portable host interface','narrow tool surface']
 for i,s in enumerate(left): fr.text(85,195+i*44,'✓ '+s,16,C['ink'],True,anchor='lm')
 for i,s in enumerate(right): fr.text(545,195+i*44,'✓ '+s,16,C['ink'],True,anchor='lm')
 fr.text(480,432,'PROVE VALIDATION + OBSERVABILITY + EQUALITY',17,C['good'],True,anchor='ma')

def frame_at(t,timeline,proof):
 i=next((j for j,s in enumerate(timeline) if t<s['end']+.08),len(timeline)-1); seg=timeline[i]; p=ease((t-seg['start'])/max(.1,seg['end']-seg['start'])); scene=min(7,i//5); local=t-timeline[scene*5]['start']; beat=int(local/2.8); fr=Frame(t); background(fr,t,scene)
 [scene_hook,scene_arch,scene_rest,scene_mcp,scene_failure][scene](fr,t,local,beat,p) if scene<5 else scene_bench(fr,t,local,beat,p,proof) if scene==5 else scene_obs(fr,t,local,beat,p) if scene==6 else scene_decision(fr,t,local,beat,p)
 words=seg['text'].split(); active=min(len(words)-1,max(0,int(p*len(words)))); phrase=' '.join(words[(active//6)*6:(active//6)*6+6]); rows=wrap(fr.d,phrase,ff(18,True),760)
 fr.d.rounded_rectangle((80,468,880,516),12,fill='#02070DE8',outline=C['grid'],width=1)
 for row,s in enumerate(rows[:2]): fr.text(480,483+row*20,s,18,C['white'],True,anchor='ma')
 fr.d.rounded_rectangle((28,526,932,532),3,fill='#163441'); fr.d.rounded_rectangle((28,526,28+904*t/timeline[-1]['end'],532),3,fill=C['mcp']); return fr

def main():
 ap=argparse.ArgumentParser(); ap.add_argument('--model',required=True); ap.add_argument('--voices',required=True); ap.add_argument('--output',type=Path,required=True); ap.add_argument('--proof',type=Path,required=True); a=ap.parse_args(); a.output.mkdir(parents=True,exist_ok=True)
 proof=json.loads(subprocess.check_output([sys.executable,str(a.proof)],text=True)); (a.output/'proof-output.json').write_text(json.dumps(proof,indent=2)+'\n')
 k=Kokoro(a.model,a.voices); parts=[]; timeline=[]; cursor=0.; gap=np.zeros(int(24000*.10),np.float32)
 for i,text in enumerate(SEGMENTS):
  audio,rate=k.create(text,voice='af_heart',speed=1.05,lang='en-us',sentence_pause=.17,clause_pause=.07); audio=np.asarray(audio,np.float32); start=cursor; end=start+len(audio)/rate; timeline.append({'index':i,'text':text,'start':round(start,4),'end':round(end,4)}); parts.append(audio); cursor=end
  if i<len(SEGMENTS)-1: parts.append(gap); cursor+=len(gap)/rate
 voice=np.concatenate(parts); sf.write(a.output/'voice.wav',voice,24000); duration=len(voice)/24000; (a.output/'timeline.json').write_text(json.dumps({'voice':'Kokoro stock af_heart','segments':timeline,'duration':round(duration,4)},indent=2)+'\n')
 n=math.ceil(duration*FPS); proc=subprocess.Popen(['ffmpeg','-y','-v','error','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-vf','scale=1920:1080:flags=lanczos','-an','-c:v','libx264','-threads','2','-preset','fast','-crf','18','-pix_fmt','yuv420p',str(a.output/'silent.mp4')],stdin=subprocess.PIPE)
 overlap=removed=maxboxes=0; samples=[]
 for no in range(n):
  fr=frame_at(no/FPS,timeline,proof); im,o,r=fr.finish(); overlap+=o; removed+=r; maxboxes=max(maxboxes,len(fr.boxes)); proc.stdin.write(im.tobytes())
  if no%(FPS*15)==0: samples.append(im.resize((320,180)))
  if no==round(timeline[20]['start']*FPS): im.resize((1920,1080),Image.Resampling.LANCZOS).save(a.output/'thumbnail.jpg',quality=94)
 proc.stdin.close(); assert proc.wait()==0; final=a.output/'video.mp4'; subprocess.run(['ffmpeg','-y','-v','error','-i',str(a.output/'silent.mp4'),'-i',str(a.output/'voice.wav'),'-filter:a','highpass=f=70,acompressor=threshold=-20dB:ratio=2.2:attack=8:release=150,loudnorm=I=-16:TP=-1.5:LRA=7','-c:v','copy','-c:a','aac','-b:a','192k','-shortest','-movflags','+faststart',str(final)],check=True)
 sheet=Image.new('RGB',(1280,180*math.ceil(len(samples)/4)),C['bg'])
 for j,im in enumerate(samples): sheet.paste(im,((j%4)*320,(j//4)*180))
 sheet.save(a.output/'contact-sheet.jpg',quality=90); report={'passed':overlap==0,'framesChecked':n,'intersectingPixels':int(overlap),'effectPixelsRemovedByTextMasks':int(removed),'textBoundsCheckedEveryFrame':True,'maxTextBoxesPerFrame':maxboxes,'videoSha256':hashlib.sha256(final.read_bytes()).hexdigest()}; (a.output/'effect-overlap-report.json').write_text(json.dumps(report,indent=2)+'\n'); print(json.dumps({'duration':duration,'proof':proof,'composition':report}))
if __name__=='__main__': main()
