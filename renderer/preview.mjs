import { writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { buildSceneAss, width, layoutIssues } from './scene-renderer.mjs';
import assert from 'node:assert/strict';
const out=process.argv[2]||'preview'; mkdirSync(out,{recursive:true});
const scenes=[
 {sceneIndex:0,visualType:'diagram',title:'Validate AI output before it reaches your CRM',callout:'A valid JSON object can still contain invalid business data.',items:['AI output','Parse JSON','Validate contract','Accept or review'],edges:[{from:0,to:1,label:''},{from:1,to:2,label:''},{from:2,to:3,label:''}]},
 {sceneIndex:1,visualType:'code',title:'Keep the contract explicit',callout:'confidence must be a number from 0 to 1. Extra fields are rejected.',items:[],code:'{\n  "leadId": "lead_demo_001",\n  "email": "demo@example.com",\n  "intent": "sales",\n  "confidence": 0.93,\n  "crmAction": "create"\n}'},
 {sceneIndex:2,visualType:'checklist',title:'Test the failure path',callout:'Try the example. Report the failing case with redacted logs.',items:['Pass: a valid object reaches the accepted output.','Fail: confidence = 93 is outside the contract.','Fail: an unexpected field is rejected.','Review: missing or malformed data requires correction.']}
];
writeFileSync(out+'/scenes.json',JSON.stringify(scenes,null,2));
for(let i=0;i<scenes.length;i++) {
 const result=buildSceneAss(scenes[i],[0,1.8,3.6,5.4],8);
 for(const b of result.boxes) {
  assert.ok(b.x>=0&&b.y>=0&&b.x+b.w<=1920&&b.y+b.h<=1080);
  for(const line of b.lines) assert.ok(width(line,b.size,b.mono)<=b.w,`Overflow: ${line}`);
 }
 writeFileSync(`${out}/scene-${i}.ass`,result.ass);
 writeFileSync(`${out}/layout-${i}.json`,JSON.stringify(result.boxes,null,2));
 const r=spawnSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=0x07111f:s=1920x1080:r=30','-t','8','-vf',`ass=${out}/scene-${i}.ass`,'-c:v','libx264','-preset','ultrafast','-crf','22','-pix_fmt','yuv420p',`${out}/scene-${i}.mp4`],{encoding:'utf8'});
 if(r.status!==0) throw new Error(r.stderr);
 const p=spawnSync('ffmpeg',['-v','error','-y','-ss','6.5','-i',`${out}/scene-${i}.mp4`,'-frames:v','1',`${out}/scene-${i}.png`],{encoding:'utf8'});
 if(p.status!==0)throw new Error(p.stderr);
}
// A long URL/code token must wrap without loss; oversize titles must fail visibly.
const long='https://example.com/'+ 'x'.repeat(280);
assert.ok(layoutIssues({...scenes[0],title:'W'.repeat(500)}).length>0);
const stress=buildSceneAss({...scenes[1],code:long},[],8);
assert.equal(stress.boxes.filter(b=>b.mono&&b.x===198).flatMap(b=>b.lines).join(''),long);
writeFileSync(out+'/concat.txt',scenes.map((_,i)=>`file 'scene-${i}.mp4'`).join('\n'));
const c=spawnSync('ffmpeg',['-v','error','-y','-f','concat','-safe','0','-i',out+'/concat.txt','-c','copy',out+'/visual-quality-preview.mp4'],{encoding:'utf8'});
if(c.status!==0)throw new Error(c.stderr);
console.log('PASS: 3 scenes rendered; text bounds, long token preservation and rejection checks passed.');
