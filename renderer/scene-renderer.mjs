import { readFileSync } from 'node:fs';
const metrics = JSON.parse(readFileSync(new URL('./font-metrics.json', import.meta.url), 'utf8'));
export const VERSION = 'visual-v3';
const colors = { ink:'F8FAFC', muted:'94A3B8', cyan:'22D3EE', violet:'A78BFA', panel:'102238', edge:'31516C', green:'4ADE80' };
const bgr = hex => hex.match(/../g).reverse().join('');
const time = s => `${Math.floor(s/3600)}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${(s%60).toFixed(2).padStart(5,'0')}`;
export function width(text, size, mono=false) {
  return Array.from(text).reduce((n,c)=>n+(metrics[mono?'mono':'sans'][c]??1.1)*size,0);
}
export function wrapLines(text, maxWidth, size, mono=false) {
  const out=[];
  for (const paragraph of String(text??'').replace(/\t/g,'  ').split(/\r?\n/)) {
    let line='';
    for(const char of Array.from(paragraph)) {
      if(line && width(line+char,size,mono)>maxWidth) {
        const breakAt=mono?-1:line.lastIndexOf(' ');
        if(breakAt>line.length*.35) {out.push(line.slice(0,breakAt));line=line.slice(breakAt+1);}
        else {out.push(line);line='';}
      }
      line+=char;
    }
    out.push(line.trimEnd());
  }
  return out;
}
// libass supports escaped braces. Replace backslashes FIRST so literal source
// such as \\N cannot become a subtitle line break or an override instruction.
export function escapeText(s) { return String(s).replace(/\\/g,'\\\u2060').replace(/{/g,'\\{').replace(/}/g,'\\}').replace(/ /g,'\\h').replace(/\r?\n/g,'\\N'); }
function fit(text,w,h,size,mono=false) {
  const lines=wrapLines(text,w-8,size,mono);
  if(lines.length*size*1.25>h) throw new Error(`Visual capacity exceeded: ${String(text).slice(0,70)} (${lines.length} lines)`);
  return lines;
}
export function layoutIssues(scene) {
  const issues=[];
  try { fit(scene.title,1400,132,48); } catch(e) {issues.push(e.message);}
  try { fit(scene.callout,1680,92,30); } catch(e) {issues.push(e.message);}
  if(scene.visualType==='diagram') {
    if(!scene.items?.length || scene.items.length>5) issues.push('Diagram requires 1–5 nodes');
    const n=Math.max(1,scene.items?.length||1),w=(1720-(n-1)*54)/n;
    for(const item of scene.items||[]) try {fit(item,w-40,166,30);} catch(e) {issues.push(e.message);}
    for(const edge of scene.edges||[]) if(!Number.isInteger(edge.from)||!Number.isInteger(edge.to)||edge.from<0||edge.to>=n||edge.to<=edge.from) issues.push('Edges must reference ordered forward nodes');
  }
  return issues;
}
export function buildSceneAss(scene,cues=[],duration=12) {
  if(!Number.isFinite(duration)||duration<=0) throw new Error('Invalid scene duration');
  const errors=layoutIssues(scene); if(errors.length) throw new Error(errors.join('; '));
  const events=[], boxes=[];
  const end=time(duration),event=(layer,start,stop,tags,text)=>events.push(`Dialogue: ${layer},${time(start)},${time(stop)},Default,,0,0,0,,{${tags}}${text}`);
  const text=(value,x,y,w,h,size,start=0,stop=duration,options={})=>{
    const lines=fit(value,w,h,size,options.mono);
    boxes.push({kind:'text',text:value,x,y,w,h,size,lines,mono:!!options.mono});
    event(3,start,stop,`\\an7\\pos(${x},${y})\\fn${options.mono?'DejaVu Sans Mono':'DejaVu Sans'}\\fs${size}\\1c&H${bgr(options.color||colors.ink)}&\\bord0\\shad0\\fad(140,100)`,lines.map(escapeText).join('\\N'));
  };
  const rect=(x,y,w,h,color,start=0,stop=duration,layer=0)=>event(layer,start,stop,`\\an7\\pos(0,0)\\p1\\bord0\\shad0\\1c&H${bgr(color)}&\\fad(140,100)`,`m ${x} ${y} l ${x+w} ${y} ${x+w} ${y+h} ${x} ${y+h}`);
  const cue=(i,n)=>{
    if(!cues.length) return i*duration/Math.max(1,n);
    const k=Math.round(i/Math.max(1,n-1)*(cues.length-1));
    return Math.max(0,Math.min(duration-.3,Number(cues[k])||0));
  };
  rect(0,0,1920,1080,'07111F');
  rect(100,73,66,5,colors.cyan);
  text(scene.title,100,105,1400,132,48);
  text('AUTOMATION\nOPS AI',1570,99,250,65,22,0,duration,{color:colors.cyan});
  rect(100,909,1720,2,colors.edge);
  text(scene.callout,112,943,1680,92,30,0,duration,{color:colors.cyan});
  const items=scene.items||[],mono=['code','terminal'].includes(scene.visualType);
  if(scene.visualType==='diagram') {
    const n=items.length,w=(1720-(n-1)*54)/n,y=370,h=254;
    const xs=items.map((_,i)=>100+i*(w+54));
    // Only explicit, reviewed graph edges are drawn; list order is not proof of a connection.
    for(const [edgeIndex,edge] of (scene.edges||[]).entries()) {
      const x1=xs[edge.from]+w,x2=xs[edge.to],at=cue(edge.to,n),cy=y+h/2;
      if(edge.to>edge.from+1) {
        const a=xs[edge.from]+w/2,b=xs[edge.to]+w/2,lane=344-edgeIndex*12;
        rect(a-2,lane,4,y-lane,colors.cyan,at,duration,1);
        rect(a,lane,b-a,4,colors.cyan,at,duration,1);
        rect(b-2,lane,4,y-lane-8,colors.cyan,at,duration,1);
        event(2,at,duration,`\\an7\\pos(0,0)\\p1\\bord0\\1c&H${bgr(colors.cyan)}&`,`m ${b-8} ${y-12} l ${b} ${y} ${b+8} ${y-12}`);
        continue;
      }
      rect(x1,cy-2,x2-x1-10,4,colors.cyan,at,duration,1);
      event(2,at,duration,`\\an7\\pos(0,0)\\p1\\bord0\\1c&H${bgr(colors.cyan)}&`,`m ${x2-14} ${cy-9} l ${x2} ${cy} ${x2-14} ${cy+9}`);
      event(4,at,Math.min(duration,at+1.1),`\\an5\\move(${x1},${cy},${x2-14},${cy},0,900)\\fs22\\1c&H${bgr(colors.ink)}&\\bord0`,'•');
      if(edge.label) text(edge.label,x1-20,cy+28,x2-x1+40,65,18,at,duration,{color:colors.muted});
    }
    items.forEach((item,i)=>{
      const at=cue(i,n),next=i+1<n?cue(i+1,n):duration;
      rect(xs[i],y,w,h,colors.edge,at);
      rect(xs[i]+2,y+2,w-4,h-4,colors.panel,at);
      rect(xs[i],y,w,5,colors.cyan,at,Math.max(at+.1,next),2);
      text(String(i+1).padStart(2,'0'),xs[i]+22,y+23,w-44,38,24,at,duration,{color:colors.cyan});
      text(item,xs[i]+22,y+80,w-44,166,30,at);
    });
    text(scene.edges?.length?'DATA FLOW · follow the highlighted step':'COMPONENTS · relationships not specified',100,284,1650,50,23,0,duration,{color:colors.muted});
  } else if(mono) {
    const lines=wrapLines(scene.code||items.join('\n'),1570,29,true),pageSize=12,pages=Math.ceil(lines.length/pageSize);
    rect(100,267,1720,594,colors.panel);
    rect(100,267,1720,43,'18314B');
    text(scene.visualType==='terminal'?'TERMINAL · commands / illustrative output':'CODE · source excerpt',124,277,1300,30,18,0,duration,{color:colors.muted});
    for(let page=0;page<pages;page++) {
      const start=duration*page/pages,stop=duration*(page+1)/pages;
      const subset=lines.slice(page*pageSize,(page+1)*pageSize);
      subset.forEach((line,i)=>{
        const at=pages===1?cue(i,subset.length):start+(stop-start)*.55*i/Math.max(1,subset.length-1);
        text(String(page*pageSize+i+1).padStart(2,'0'),122,326+i*42,54,40,23,at,stop,{mono:true,color:colors.muted});
        text(line,198,324+i*42,1580,40,29,at,stop,{mono:true});
      });
      text(`${page+1} / ${pages}`,1630,276,150,30,18,start,stop,{color:colors.muted});
    }
  } else {
    // Metric scenes use equal cards. Never draw fake bars from arbitrary heights.
    const pages=Math.ceil(items.length/4)||1;
    for(let page=0;page<pages;page++) {
      const start=duration*page/pages,stop=duration*(page+1)/pages,subset=items.slice(page*4,page*4+4);
      subset.forEach((item,i)=>{
        const at=pages===1?cue(i,subset.length):start+(stop-start)*.55*i/Math.max(1,subset.length-1),y=284+i*139;
        rect(100,y,1720,117,colors.panel,at,stop);
        rect(100,y,5,117,colors.cyan,at,stop);
        text(String(page*4+i+1).padStart(2,'0'),126,y+35,70,45,30,at,stop,{color:colors.cyan});
        text(item,230,y+22,1535,92,32,at,stop);
      });
    }
  }
  return {ass:`[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 2\nScaledBorderAndShadow: yes\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,DejaVu Sans,30,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events.join('\n')}\n`,boxes,version:VERSION};
}
