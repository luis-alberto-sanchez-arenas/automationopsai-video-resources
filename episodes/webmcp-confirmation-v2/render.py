#!/usr/bin/env python3
"""Original audio-led transaction workbench; no speech synthesis or network calls.

Usage: python episodes/webmcp-confirmation-v2/render.py --output <draft-dir>
The video uses a custom policy simulation, NOT native browser WebMCP execution.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import subprocess
from functools import lru_cache
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageChops

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
SOURCE = ROOT/'deploy/creator-os/reviewed-masters/staged/webmcp-confirmation-gate-20261009/video.mp4'
W,H,FPS,DURATION = 1080,1920,30,56.3
P = dict(bg='#211733', paper='#FAF3E8', orange='#EC743F', violet='#AC8BE8', green='#DBEA8D', ink='#241C31', muted='#CDC1DA')


def execute(consequential, decision=None):
    """Actual deterministic demo function; no money or third-party APIs."""
    if consequential and decision is not True:
        return dict(status='REJECTED' if decision is False else 'CONFIRMATION REQUIRED',
                    executions=0,bookings=0,charged=0)
    return dict(status='BOOKED',executions=1,bookings=1,charged=480)


def proof():
    values = dict(unsafe=execute(False), waiting=execute(True),
                  rejected=execute(True,False), approved=execute(True,True))
    assert values['unsafe']['charged']==480
    assert values['waiting']['executions']==0
    assert values['rejected']['charged']==0 and values['rejected']['bookings']==0
    assert values['approved']['executions']==1
    return values


@lru_cache(maxsize=80)
def font(n,bold=False,mono=False):
    name='DejaVuSansMono' if mono else 'DejaVuSans'
    return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/'+name+('-Bold' if bold else '')+'.ttf',n)


def ease(x):
    x=max(0,min(1,x));return x*x*(3-2*x)


class Frame:
    def __init__(self,t):
        self.t=t
        self.bg=Image.new('RGB',(W,H),P['bg'])
        self.ui=Image.new('RGBA',(W,H))
        self.fx=Image.new('RGBA',(W,H))
        self.d=ImageDraw.Draw(self.ui)
        self.f=ImageDraw.Draw(self.fx)
        self.mask=Image.new('L',(W,H))
        self.md=ImageDraw.Draw(self.mask)
        self.boxes=[]

    def text(self,x,y,s,n=40,c=None,bold=False,mono=False,anchor=None):
        face=font(n,bold,mono)
        box=self.d.textbbox((x,y),s,font=face,anchor=anchor)
        if not (58<=box[0] and box[2]<=984 and 132<=box[1] and box[3]<=1755):
            raise ValueError(f'Text outside mobile safe bounds at {self.t}: {s}: {box}')
        self.boxes.append(dict(text=s,bbox=box))
        self.md.rectangle((box[0]-12,box[1]-10,box[2]+12,box[3]+10),fill=255)
        self.d.text((x,y),s,font=face,fill=c or P['paper'],anchor=anchor)

    def rect(self,box,fill,outline=None,r=18):
        self.d.rounded_rectangle(box,r,fill=fill,outline=outline,width=2)

    def finish(self):
        alpha=self.fx.getchannel('A')
        blocked=ImageChops.multiply(alpha,self.mask)
        clipped=np.count_nonzero(np.asarray(blocked))
        alpha=ImageChops.multiply(alpha,ImageChops.invert(self.mask))
        self.fx.putalpha(alpha)
        overlap=np.count_nonzero(np.asarray(ImageChops.multiply(alpha,self.mask)))
        # UI base, then clipped effects, then text/UI again: effects never obscure letters.
        result=self.bg.convert('RGBA')
        result.alpha_composite(self.ui)
        result.alpha_composite(self.fx)
        # Text is opaque and protected by raster exclusion masks above.
        return result.convert('RGB'),int(overlap),int(clipped)


def word_time(segments,index,word):
    return next(x['start'] for x in segments[index]['words'] if x['word']==word)


def milestones(segments):
    return [
        ('register',word_time(segments,1,'first')),
        ('schema',word_time(segments,1,'schema')),
        ('call',word_time(segments,2,'calls')),
        ('charge',word_time(segments,2,'booked')),
        ('patch',word_time(segments,3,'true')),
        ('replay',word_time(segments,4,'run')),
        ('hold',word_time(segments,4,'stops')),
        ('required',word_time(segments,4,'required')),
        ('reject',word_time(segments,5,'reject')),
        ('zero',word_time(segments,5,'zero')),
        ('scope',word_time(segments,6,'proposed')),
        ('test',word_time(segments,7,'test')),
    ]


def draw(t,segments,events,values):
    frame=Frame(t);d=frame.d;f=frame.f
    ev=dict(events)
    stage=next((i for i,s in enumerate(segments) if t < s['end']+.1),7)
    frame.text(70,146,'AUTOMATION OPERATOR / LAB 02',28,bold=True,c=P['violet'])
    frame.text(70,205,'Who authorizes the charge?',52,bold=True)
    frame.text(70,289,'LOCAL POLICY SIMULATION · NOT A REAL PURCHASE',26,c=P['muted'])
    frame.rect((62,358,980,1400),P['paper'],r=32)
    frame.text(96,386,'book_trip',46,c=P['ink'],mono=True,bold=True)
    frame.text(940,393,'MEX → SFO',36,c=P['ink'],bold=True,anchor='ra')

    # Persistent route instrument: the moving object represents the pending tool request.
    # It reaches execution only after the corresponding function was evaluated.
    center=(524,615)
    for k in range(4):
        a=t*.15+k*math.pi/2
        rx,ry=340,150
        f.arc((center[0]-rx,center[1]-ry,center[0]+rx,center[1]+ry),
              int(a*180/math.pi),int(a*180/math.pi)+64,fill=P['violet'],width=3)
    p=(t*.23)%1
    if ev['hold']<=t<ev['reject']:p=.48+.018*math.sin(t*5)
    if t>=ev['reject']:p=max(0,.5-(t-ev['reject'])*.3)
    path=[(180+i*720/60,650-95*math.sin(i*math.pi/60)) for i in range(61)]
    f.line(path,fill=P['violet'],width=5)
    cx=180+720*p;cy=650-95*math.sin(p*math.pi)
    f.ellipse((cx-17,cy-17,cx+17,cy+17),fill=P['orange'])
    frame.text(112,497,'REQUEST',28,c=P['ink'],bold=True)
    frame.text(948,497,'EXECUTE',28,c=P['ink'],bold=True,anchor='ra')
    frame.text(540,622,'$480',100,c=P['ink'],bold=True,anchor='mm')
    frame.text(540,704,'Proposed total · USD',30,c=P['ink'],anchor='ma')
    # Consequence annotation lives in one stable instrument, not a sequence of cards.
    frame.rect((91,797,950,1010),'#EBE2F3',r=22)
    frame.text(114,819,'TOOL CONTRACT',28,c=P['ink'],bold=True)
    patched=t>=ev['patch']
    frame.text(114,875,'consequentialHint:',38,c=P['ink'],mono=True)
    frame.text(920,875,'true' if patched else 'false',48,c=P['ink'],mono=True,bold=True,anchor='ra')
    subtitle='inputSchema → route + totalUsd'
    if t>=ev['patch']:subtitle='Client policy → require confirmation'
    if t>=ev['reject']:subtitle='Rejected → execute() was NOT called'
    frame.text(114,957,subtitle,30,c=P['ink'],mono=True)
    # Blink an editing caret behind the value only on the measured "true" cue.
    if ev['patch']<=t<ev['patch']+1.4:
        f.rectangle((918,880,925,943),fill=P['orange'])

    current=dict(status='READY',executions=0,bookings=0,charged=0)
    label='RUN 1 / UNMARKED TOOL'
    if t>=ev['call']:current['status']='RUNNING'
    if t>=ev['charge']:current=values['unsafe']
    if t>=ev['patch']:
        label='RUN 2 / CLEAN SANDBOX'
        current=dict(status='READY',executions=0,bookings=0,charged=0)
    if t>=ev['replay']:current=dict(current,status='RUNNING')
    if t>=ev['hold']:current=values['waiting']
    if t>=ev['reject']:current=values['rejected']
    frame.text(103,1048,label,28,c=P['ink'],bold=True)
    status=current['status']
    frame.text(103,1102,status,39 if len(status)>18 else 54,c=P['ink'],bold=True)
    frame.text(103,1204,'EXECUTIONS',27,c=P['ink'])
    frame.text(420,1204,'BOOKINGS',27,c=P['ink'])
    frame.text(918,1204,'CHARGED',27,c=P['ink'],anchor='ra')
    frame.text(103,1250,str(current['executions']),65,c=P['ink'],bold=True,mono=True)
    frame.text(420,1250,str(current['bookings']),65,c=P['ink'],bold=True,mono=True)
    frame.text(918,1250,f"${current['charged']}",65,c=P['ink'],bold=True,mono=True,anchor='ra')

    # Boundary reacts to actual state transitions, not ornamental particles.
    if ev['hold']<=t<ev['reject']:
        f.line((535,510,535,735),fill=P['orange'],width=10)
    if t>=ev['reject']:
        fade=1-ease((t-ev['reject'])/2)
        f.arc((175,454,873,786),170,350,fill=P['orange'],width=max(1,round(12*fade)))

    if t<ev['register']:note='One request. Two execution paths.'
    elif t<ev['schema']:note='Register a structured tool'
    elif t<ev['call']:note='A schema is not permission'
    elif t<ev['charge']:note='Calling the unmarked tool…'
    elif t<ev['patch']:note='Side effect occurred in simulation'
    elif t<ev['replay']:note='Annotation + client enforcement'
    elif t<ev['hold']:note='Replay the SAME input'
    elif t<ev['reject']:note='Waiting for a human decision'
    elif t<ev['scope']:note='Rejected. No execution. No charge.'
    elif t<ev['test']:note='WebMCP: proposed / experimental'
    else:note='4/4 local assertions pass'
    frame.text(70,1430,note,36,bold=True,c=P['green'])

    # Each subtitle group uses acoustically aligned starts, never character ratios.
    seg=segments[stage];words=seg['words']
    active=next((i for i,w in enumerate(words) if t<w['end']),len(words)-1)
    group=words[(active//5)*5:(active//5)*5+5]
    text=' '.join(w['word'] for w in group)
    # Wrap using measured font extents at a fixed readable size.
    rows=[];row=''
    for word in text.split():
        test=(row+' '+word).strip()
        if d.textlength(test,font=font(44,True))>880:
            rows.append(row);row=word
        else:row=test
    if row:rows.append(row)
    for i,row in enumerate(rows):frame.text(70,1540+58*i,row,44,bold=True)
    frame.text(70,1674,'Synthetic voice · reproducible local test',27,c=P['muted'])
    d.rounded_rectangle((70,1740,972,1750),5,fill='#493758')
    d.rounded_rectangle((70,1740,70+902*t/DURATION,1750),5,fill=P['orange'])
    return frame


def draw_browser(t,segments,events,values):
    """Replay verified browser states; source editing is explicitly a source view."""
    frame=Frame(t);d=frame.d;f=frame.f;ev=dict(events)
    frame.text(70,146,'AUTOMATION OPERATOR / LOCAL DEMO',28,bold=True,c=P['violet'])
    frame.text(70,205,'Before an agent can spend',52,bold=True)
    frame.text(70,290,'Tested browser replay · fictional $480',30,c=P['muted'])
    state='ready'
    if t>=ev['charge']:state='booked'
    if t>=ev['patch']:state='patched'
    if t>=ev['hold']:state='waiting'
    if t>=ev['reject']:state='rejected'
    if t>=ev['test']:state='tests'
    source_view=ev['register']<=t<ev['call'] or ev['patch']-2.8<=t<ev['patch']+2
    if source_view:
        frame.rect((62,358,980,1414),'#302340',r=24)
        frame.text(92,389,'demo.html / client policy',32,bold=True,c=P['green'])
        lines=[
            'function execute(hint, decision=null) {',
            '  if (hint && decision !== true)',
            '    return {',
            '      status: decision === false',
            "        ? 'REJECTED'",
            "        : 'CONFIRMATION REQUIRED',",
            '      executions: 0,',
            '      bookings: 0, charged: 0',
            '    };',
            "  return {status: 'BOOKED',",
            '    executions: 1, bookings: 1,',
            '    charged: 480};',
            '}',
        ]
        if t<ev['call']:
            shown=min(len(lines),max(1,int((t-ev['register'])*2.2)+1))
        else:shown=len(lines)
        for i,line in enumerate(lines[:shown]):
            frame.text(88,483+i*57,line,32,c=P['paper'],mono=True)
        frame.text(88,1280,'Annotation + enforced client policy',32,bold=True,c=P['green'])
        frame.text(88,1340,'No payment API. No real purchase.',28,c=P['muted'])
    else:
        source=Image.open(HERE/'browser-captures'/f'{state}.png').convert('RGBA')
        # All captured UI remains inside a safe viewport. No simulated browser click.
        im=source.resize((918,1056))
        frame.ui.alpha_composite(im,(62,358))
        frame.md.rectangle((62,358,980,1414),fill=255)
        f.rounded_rectangle((59,354,983,1418),22,outline=P['violet'],width=3)
    labels={
        'ready':'Run 1: no consequence annotation',
        'booked':'Observed result: one simulated charge',
        'patched':'Reset. Enable consequence annotation.',
        'waiting':'Client pauses before execute()',
        'rejected':'Reject → zero bookings / zero charge',
        'tests':'Four actual assertions passed',
    }
    frame.text(70,1440,labels[state],32,bold=True,c=P['green'])
    stage=next((i for i,s in enumerate(segments) if t<s['end']+.1),7)
    words=segments[stage]['words']
    active=next((i for i,w in enumerate(words) if t<w['end']),len(words)-1)
    group=words[(active//5)*5:(active//5)*5+5]
    rows=[];row=''
    for word in [w['word'] for w in group]:
        test=(row+' '+word).strip()
        if d.textlength(test,font=font(44,True))>880:rows.append(row);row=word
        else:row=test
    if row:rows.append(row)
    for i,row in enumerate(rows):frame.text(70,1540+58*i,row,44,bold=True)
    frame.text(70,1674,'Synthetic narration · experimental WebMCP',27,c=P['muted'])
    d.rounded_rectangle((70,1740,972,1750),5,fill='#493758')
    d.rounded_rectangle((70,1740,70+902*t/DURATION,1750),5,fill=P['orange'])
    return frame


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--output',type=Path,required=True)
    args=ap.parse_args();out=args.output;out.mkdir(parents=True,exist_ok=True)
    aligned=json.loads((HERE/'alignment.json').read_text())
    assert hashlib.sha256(SOURCE.read_bytes()).hexdigest()==aligned['sourceSha256']
    browser_proof=json.loads((HERE/'browser-captures'/'proof.json').read_text())
    assert browser_proof['actualBrowserClicks'] is True and browser_proof['assertionsPassed']==4
    segments=aligned['segments'];events=milestones(segments);values=proof()
    (out/'proof-output.json').write_text(json.dumps(dict(cases=values,assertionsPassed=4),indent=2)+'\n')
    (out/'timeline.json').write_text(json.dumps(dict(segments=segments,actionCues=[dict(action=k,time=v) for k,v in events]),indent=2)+'\n')
    nframes=round(DURATION*FPS)
    samples={0,90,210,450,600,780,990,1130,1350,1550}
    for _,t in events:
        samples.update([max(0,round(t*FPS)-1),min(nframes-1,round(t*FPS)+1)])
    pictures=[];checked=0;overlaps=0;clipped=0;max_boxes=0
    process=subprocess.Popen(['ffmpeg','-y','-v','error','-f','rawvideo','-pix_fmt','rgb24',
        '-s',f'{W}x{H}','-r',str(FPS),'-i','-','-an','-c:v','libx264','-threads','2',
        '-preset','fast','-crf','20','-pix_fmt','yuv420p',str(out/'silent.mp4')],stdin=subprocess.PIPE)
    (out/'review-frames').mkdir(exist_ok=True)
    for i in range(nframes):
        frame=draw_browser(i/FPS,segments,events,values)
        im,intersection,removed=frame.finish()
        checked+=1;overlaps+=intersection;clipped+=removed;max_boxes=max(max_boxes,len(frame.boxes))
        if i in samples:
            im.save(out/'review-frames'/f'{i:05d}-{i/FPS:.3f}s.jpg',quality=88)
            small=im.resize((270,480));pictures.append((i,small))
        if i==round(dict(events)['reject']*FPS)+20:im.save(out/'thumbnail.jpg',quality=94)
        process.stdin.write(im.tobytes())
    process.stdin.close();assert process.wait()==0
    subprocess.run(['ffmpeg','-y','-v','error','-i',str(out/'silent.mp4'),'-i',str(SOURCE),
        '-map','0:v','-map','1:a','-c','copy','-t',str(DURATION),'-movflags','+faststart',str(out/'video.mp4')],check=True)
    sheet=Image.new('RGB',(270*5,510*math.ceil(len(pictures)/5)),'#211733')
    sd=ImageDraw.Draw(sheet)
    for j,(i,im) in enumerate(pictures):
        x,y=(j%5)*270,(j//5)*510;sheet.paste(im,(x,y));sd.text((x+8,y+485),f'{i/FPS:.3f} s',font=font(18),fill='white')
    sheet.save(out/'contact-sheet.jpg',quality=90)
    report=dict(passed=overlaps==0,framesChecked=checked,intersectingPixels=overlaps,
                effectPixelsRemovedByTextMasks=clipped,method='per-frame raster alpha times text exclusion mask',
                safeTextBounds=[58,132,984,1755],textBoundsCheckedEveryFrame=True,
                maxTextBoxesPerFrame=max_boxes,videoSha256=hashlib.sha256((out/'video.mp4').read_bytes()).hexdigest())
    (out/'composition-report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))


if __name__=='__main__':main()
