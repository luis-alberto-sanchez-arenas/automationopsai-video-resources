import { readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db, storage, type Stored } from './platform.js';
import { generateJson } from './ai.js';
import { fontDir, fontName, remoteFileSize, runFfmpeg, synthesizeNeuralSpeech } from './media.js';

export const EDITORIAL_PREFIX='editorial-pro-v2-';
const PIPELINE_VERSION='editorial-pro-v2';
const PROJECT_TABLE='editorial_projects_v2';
const SCENE_TABLE='editorial_scenes_v2';
const COOLDOWN_HOURS=72;

const BROLL=[
  'https://videos.pexels.com/video-files/7165691/7165691-hd_1920_1080_25fps.mp4',
  'https://videos.pexels.com/video-files/6563925/6563925-hd_1920_1080_25fps.mp4',
  'https://videos.pexels.com/video-files/7706637/7706637-uhd_4096_2160_25fps.mp4',
];

const SOURCES=[
  ['n8n-overview','n8n documentation','https://docs.n8n.io/'],
  ['n8n-executions','n8n execution debugging','https://docs.n8n.io/workflows/executions/all-executions/'],
  ['n8n-security','n8n security audit','https://docs.n8n.io/hosting/securing/security-audit/'],
  ['n8n-webhook','n8n Webhook node','https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/'],
  ['n8n-queue','n8n queue mode','https://docs.n8n.io/hosting/scaling/queue-mode/'],
  ['n8n-human','n8n human fallback','https://docs.n8n.io/advanced-ai/examples/human-fallback/'],
  ['openai-tracing','OpenAI Agents tracing','https://openai.github.io/openai-agents-python/tracing/'],
  ['openai-guardrails','OpenAI Agents guardrails','https://openai.github.io/openai-agents-python/guardrails/'],
  ['github-security','GitHub Actions secure use','https://docs.github.com/en/actions/reference/security/secure-use'],
  ['figma-ai','Figma AI product capabilities','https://www.figma.com/ai/'],
  ['figma-design-trends','Figma web design trends 2026','https://www.figma.com/resource-library/web-design-trends/'],
  ['adobe-firefly','Adobe Firefly current capabilities','https://helpx.adobe.com/firefly/web/whats-new/new-features/whats-new.html'],
  ['wcag-quickref','W3C WCAG 2.2 quick reference','https://www.w3.org/WAI/WCAG22/quickref/'],
] as const;

type Stage='research'|'problem'|'outline'|'script'|'fact_review'|'storyboard'|'quality_gate'|'revision'|'rendering'|'assembly'|'ready'|'published'|'rejected';
type Source={key:string;title:string;url:string;excerpt:string;fetchedAt:string};
type Opportunity={problem:string;audience:string;whyNow:string;proofArtifact:string;sourceKeys:string[];utilityScore:number;demoScore:number};
type Selected=Opportunity&{promise:string;viewerOutcome:string;scope:string[];exclusions:string[];workingTitle:string};
type Outline={hook:string;sections:Array<{heading:string;purpose:string;demonstration:string;sourceKeys:string[]}>;titleCandidates:string[];thumbnailText:string;thumbnailSubtext:string};
type Claim={claim:string;sourceKeys:string[];supported:boolean;confidence:number;note:string};
export type VisualType='diagram'|'code'|'terminal'|'checklist'|'metric'|'broll';
export type ScenePlan={sceneIndex:number;title:string;narration:string;callout:string;visualType:VisualType;items:string[];code?:string;sourceKey?:string};
type GateScores={utility:number;demonstrability:number;factuality:number;originality:number;narrative:number;visualPlan:number;monetizationSafety:number;thumbnail:number;overall:number};
type Gate={passed:boolean;scores:GateScores;blockers:string[];revisionNotes:string[];checks:Record<string,boolean>;maxTitleSimilarity:number;maxScriptSimilarity:number};
type Project={
  userId:string;projectKey:string;pipelineVersion:string;stage:Stage;revision:number;
  research?:{sources:Source[];opportunities:Opportunity[];demandSignals:string[]};
  selected?:Selected;outline?:Outline;script?:string;claimDrafts?:Array<{claim:string;sourceKeys:string[]}>;claims?:Claim[];
  storyboard?:ScenePlan[];gate?:Gate;title?:string;description?:string;tags?:string[];
  thumbnailText?:string;thumbnailSubtext?:string;finalStoragePath?:string;thumbnailStoragePath?:string;
  youtubeVideoId?:string;youtubeUrl?:string;publishedAt?:string;lastError?:string;createdAt:string;updatedAt:string;
};
type SceneRecord=ScenePlan&{userId:string;projectKey:string;status:'planned'|'rendered'|'failed';retryCount:number;segmentStoragePath?:string;bytes?:number;lastError?:string;createdAt:string;updatedAt:string};

export type EditorialContext={demandSignals:string[];recentVideos:Array<{title:string;transcript?:string}>};
export type PublishSpec={automationKey:string;title:string;description:string;tags:string[];transcript:string;preparedStoragePath:string;thumbnailStoragePath:string};
export type EditorialStatus={projectKey?:string;stage:Stage|'idle'|'cooldown';title?:string;problem?:string;revision?:number;qualityScore?:number;blockers?:string[];renderedScenes?:number;totalScenes?:number;youtubeUrl?:string;lastError?:string;createdAt?:string;updatedAt?:string;nextAction:string};

function now(){return new Date().toISOString();}
function clean(v:string){return v.replace(/\s+/g,' ').trim();}
function score(v:unknown){const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.min(100,Math.round(n))):0;}
function stripHtml(v:string){return clean(v.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&'));}
function words(v:string){return v.trim().split(/\s+/).filter(Boolean).length;}
function hoursSince(v?:string){return v?Math.max(0,(Date.now()-new Date(v).getTime())/3600000):Infinity;}

async function fetchSources(){
  const results:Array<Source|null>=await Promise.all(SOURCES.map(async ([key,title,url]):Promise<Source|null>=>{
    try{
      const response=await fetch(url,{redirect:'follow',headers:{'user-agent':'AutomationOpsAI/2.0 editorial research'}});
      if(!response.ok)return null;
      const text=stripHtml(await response.text());
      if(text.length<500)return null;
      return {key,title,url,excerpt:text.slice(0,4200),fetchedAt:now()} satisfies Source;
    }catch{return null;}
  }));
  return results.filter((x):x is Source=>x!==null);
}
function sourceText(sources:Source[]){return sources.map(x=>`[${x.key}] ${x.title}\nURL: ${x.url}\nEXCERPT: ${x.excerpt}`).join('\n\n');}

async function listProjects(userId:string){
  const {items}=await db.list<Project>(PROJECT_TABLE,{filter:{userId},limit:30});
  return items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
async function saveProject(project:Stored<Project>){
  const {id,...record}=project;record.updatedAt=now();
  const [ok]=await db.update(PROJECT_TABLE,[{id,record}]);
  if(!ok)throw new Error('Failed to persist editorial project');
}
async function newProject(userId:string){
  const stamp=new Date().toISOString().replace(/[^0-9]/g,'').slice(0,14);
  const record:Project={userId,projectKey:`${EDITORIAL_PREFIX}${stamp}`,pipelineVersion:PIPELINE_VERSION,stage:'research',revision:0,createdAt:now(),updatedAt:now()};
  const [id]=await db.add(PROJECT_TABLE,[record]);
  return {...record,id} as Stored<Project>;
}
async function currentProject(userId:string){
  const projects=await listProjects(userId);
  const active=projects.find(x=>!['published','rejected'].includes(x.stage));
  if(active)return {project:active,cooldown:false};
  const last=projects.find(x=>x.stage==='published');
  if(last&&hoursSince(last.publishedAt||last.updatedAt)<COOLDOWN_HOURS)return {project:last,cooldown:true};
  return {project:await newProject(userId),cooldown:false};
}

const RESEARCH_SCHEMA:any={
  type:'object',properties:{opportunities:{type:'array',minItems:4,maxItems:6,items:{
    type:'object',properties:{problem:{type:'string'},audience:{type:'string'},whyNow:{type:'string'},proofArtifact:{type:'string'},sourceKeys:{type:'array',items:{type:'string'}},utilityScore:{type:'number'},demoScore:{type:'number'}},
    required:['problem','audience','whyNow','proofArtifact','sourceKeys','utilityScore','demoScore']
  }}},required:['opportunities']
};

async function doResearch(p:Stored<Project>,ctx:EditorialContext){
  const sources=await fetchSources();
  if(sources.length<3)throw new Error(`Only ${sources.length} official sources available; refusing to invent a tutorial`);
  const result=await generateJson<{opportunities:Opportunity[]}>({
    system:'You are a senior technical YouTube editor. Find concrete practitioner problems across AI automation, agents, software architecture, cybersecurity, productivity, AI-assisted design, design systems, accessibility and design-to-code. Reject hype, generic tool lists, income claims, trend-only topics and topics that cannot be demonstrated. A popular topic is insufficient: require a specific competitive gap that existing tutorials usually omit. Use only supplied source keys.',
    prompt:`Demand/title signals:\n${ctx.demandSignals.slice(0,25).join('\n')}\n\nRecent titles to avoid:\n${ctx.recentVideos.slice(0,20).map(x=>x.title).join('\n')}\n\nOfficial sources:\n${sourceText(sources)}\n\nProduce 4-6 evidence-backed, demonstrable opportunities. Each opportunity must state the underserved question or missing proof that differentiates it from common tutorials. Score utility and demonstrability 0-100.`,
    schema:RESEARCH_SCHEMA,temperature:.35,maxTokens:4000,
  });
  const keys=new Set(sources.map(x=>x.key));
  const opportunities=result.opportunities.map(x=>({...x,problem:clean(x.problem),audience:clean(x.audience),whyNow:clean(x.whyNow),proofArtifact:clean(x.proofArtifact),sourceKeys:x.sourceKeys.filter(k=>keys.has(k)).slice(0,4),utilityScore:score(x.utilityScore),demoScore:score(x.demoScore)})).filter(x=>x.sourceKeys.length&&x.utilityScore>=78&&x.demoScore>=78);
  if(opportunities.length<3)throw new Error('Research produced fewer than three strong opportunities');
  p.research={sources,opportunities,demandSignals:ctx.demandSignals.slice(0,30)};
  p.stage='problem';p.lastError=undefined;await saveProject(p);
}

const SELECT_SCHEMA:any={type:'object',properties:{selectedIndex:{type:'integer'},promise:{type:'string'},viewerOutcome:{type:'string'},scope:{type:'array',items:{type:'string'}},exclusions:{type:'array',items:{type:'string'}},workingTitle:{type:'string'}},required:['selectedIndex','promise','viewerOutcome','scope','exclusions','workingTitle']};
async function selectProblem(p:Stored<Project>,ctx:EditorialContext){
  if(!p.research)throw new Error('Research missing');
  const r=await generateJson<any>({
    system:'Select one problem for a rigorous technical tutorial. Favor utility, a real implementation/debug artifact, evidence and meaningful distinction from recent videos. Reject generic AI hype.',
    prompt:`Opportunities:\n${p.research.opportunities.map((x,i)=>`${i}. ${JSON.stringify(x)}`).join('\n')}\n\nRecent titles:\n${ctx.recentVideos.map(x=>x.title).slice(0,20).join('\n')}`,
    schema:SELECT_SCHEMA,maxTokens:1800,temperature:.2,
  });
  const selected=p.research.opportunities[r.selectedIndex];
  if(!selected)throw new Error('Invalid selected opportunity');
  p.selected={...selected,promise:clean(r.promise),viewerOutcome:clean(r.viewerOutcome),scope:r.scope.map(clean),exclusions:r.exclusions.map(clean),workingTitle:clean(r.workingTitle).slice(0,100)};
  p.stage='outline';p.lastError=undefined;await saveProject(p);
}

const OUTLINE_SCHEMA:any={type:'object',properties:{hook:{type:'string'},sections:{type:'array',minItems:9,maxItems:14,items:{type:'object',properties:{heading:{type:'string'},purpose:{type:'string'},demonstration:{type:'string'},sourceKeys:{type:'array',items:{type:'string'}}},required:['heading','purpose','demonstration','sourceKeys']}},titleCandidates:{type:'array',items:{type:'string'}},thumbnailText:{type:'string'},thumbnailSubtext:{type:'string'}},required:['hook','sections','titleCandidates','thumbnailText','thumbnailSubtext']};
async function buildOutline(p:Stored<Project>){
  if(!p.research||!p.selected)throw new Error('Selection missing');
  const allowed=new Set(p.selected.sourceKeys);
  const sources=p.research.sources.filter(x=>allowed.has(x.key));
  const r=await generateJson<Outline>({
    system:'Design a tutorial for experienced builders. First 30 seconds: concrete problem, promised outcome, and proof. Every section must advance a build/debug process. No filler or generic motivation.',
    prompt:`Problem:\n${JSON.stringify(p.selected)}\n\nEvidence:\n${sourceText(sources)}\n\nCreate 9-14 sections. Every section must specify a visible proof artifact such as configuration, workflow branch, terminal output, test, failure reproduction, before/after behavior or observable result. Thumbnail main text <=28 chars and subtext <=36.`,
    schema:OUTLINE_SCHEMA,maxTokens:4200,temperature:.25,
  });
  r.sections=r.sections.map(x=>({...x,heading:clean(x.heading),purpose:clean(x.purpose),demonstration:clean(x.demonstration),sourceKeys:x.sourceKeys.filter(k=>allowed.has(k))}));
  if(r.sections.some(x=>!x.sourceKeys.length))throw new Error('Outline section without official evidence');
  p.outline=r;p.thumbnailText=clean(r.thumbnailText).slice(0,28);p.thumbnailSubtext=clean(r.thumbnailSubtext).slice(0,36);
  p.stage='script';p.lastError=undefined;await saveProject(p);
}

const SCRIPT_SCHEMA:any={type:'object',properties:{title:{type:'string'},description:{type:'string'},tags:{type:'array',items:{type:'string'}},script:{type:'string'},claims:{type:'array',minItems:4,items:{type:'object',properties:{claim:{type:'string'},sourceKeys:{type:'array',items:{type:'string'}}},required:['claim','sourceKeys']}}},required:['title','description','tags','script','claims']};
async function writeScript(p:Stored<Project>){
  if(!p.research||!p.selected||!p.outline)throw new Error('Outline missing');
  const allowed=new Set(p.selected.sourceKeys);
  const sources=p.research.sources.filter(x=>allowed.has(x.key));
  const r=await generateJson<any>({
    system:'Write like an experienced engineer teaching a real implementation. Use concrete examples, explicit failure cases, testing, debugging, observability and tradeoffs. Never fabricate product behavior, benchmarks, versions, API fields, prices or guarantees. No generic AI-copy transitions.',
    prompt:`Problem:\n${JSON.stringify(p.selected)}\n\nOutline:\n${JSON.stringify(p.outline)}\n\nOfficial evidence:\n${sourceText(sources)}\n\nWrite 1100-1700 words. Include a failure reproduction+fix, validation/test section, production tradeoff, and concise conclusion. Return a ledger of every material factual/product claim with source keys.`,
    schema:SCRIPT_SCHEMA,maxTokens:8500,temperature:.28,
  });
  const wc=words(r.script);
  if(wc<1000||wc>1900)throw new Error(`Script outside quality range (${wc} words)`);
  const claims=(r.claims as any[]).map(x=>({claim:clean(x.claim),sourceKeys:x.sourceKeys.filter((k:string)=>allowed.has(k))})).filter(x=>x.sourceKeys.length);
  if(claims.length<4)throw new Error('Claim ledger incomplete');
  p.title=clean(r.title).slice(0,100);p.description=String(r.description).trim();p.tags=(r.tags as string[]).map(clean).filter(Boolean).slice(0,12);
  p.script=String(r.script).trim();p.claimDrafts=claims;p.stage='fact_review';p.lastError=undefined;await saveProject(p);
}

const FACT_SCHEMA:any={type:'object',properties:{verifiedScript:{type:'string'},claims:{type:'array',minItems:4,items:{type:'object',properties:{claim:{type:'string'},sourceKeys:{type:'array',items:{type:'string'}},supported:{type:'boolean'},confidence:{type:'number'},note:{type:'string'}},required:['claim','sourceKeys','supported','confidence','note']}}},required:['verifiedScript','claims']};
async function factReview(p:Stored<Project>){
  if(!p.research||!p.script||!p.claimDrafts?.length)throw new Error('Fact-review inputs missing');
  const keys=new Set(p.claimDrafts.flatMap(x=>x.sourceKeys));
  const sources=p.research.sources.filter(x=>keys.has(x.key));
  const r=await generateJson<{verifiedScript:string;claims:Claim[]}>({
    system:'Be a hostile factual reviewer. Compare each material claim with official evidence. Remove or qualify anything unsupported. Do not mark unsupported product behavior as supported.',
    prompt:`Script:\n${p.script}\n\nClaims:\n${JSON.stringify(p.claimDrafts)}\n\nEvidence:\n${sourceText(sources)}`,
    schema:FACT_SCHEMA,maxTokens:8500,temperature:.1,
  });
  const claims=r.claims.map(x=>({...x,claim:clean(x.claim),confidence:score(x.confidence),note:clean(x.note)}));
  const unsupported=claims.filter(x=>!x.supported||x.confidence<70);
  p.script=r.verifiedScript.trim();p.claims=claims;
  if(unsupported.length){
    if(p.revision>=2){p.stage='rejected';p.lastError=`Factual gate rejected: ${unsupported.map(x=>x.claim).join(' | ').slice(0,900)}`;}
    else {p.stage='revision';p.lastError=`Factual gate needs revision: ${unsupported.length} unsupported/weak claims`;}
  } else {p.stage='storyboard';p.lastError=undefined;}
  await saveProject(p);
}

const STORY_SCHEMA:any={type:'object',properties:{scenes:{type:'array',minItems:10,maxItems:12,items:{type:'object',properties:{title:{type:'string'},narration:{type:'string'},callout:{type:'string'},visualType:{type:'string',enum:['diagram','code','terminal','checklist','metric','broll']},items:{type:'array',items:{type:'string'}},code:{type:'string'},sourceKey:{type:'string'}},required:['title','narration','callout','visualType','items','code','sourceKey']}}},required:['scenes']};
async function storyboard(p:Stored<Project>){
  if(!p.script||!p.selected)throw new Error('Verified script missing');
  const allowed=new Set(p.selected.sourceKeys);
  const r=await generateJson<{scenes:Array<Omit<ScenePlan,'sceneIndex'>>}>({
    system:'Create a professional technical-video storyboard. Visuals must prove or clarify implementation. Prefer diagrams, code/config, terminal/debug output, checklists and measurable states. B-roll is brief pacing only. Never invent screenshots of real software.',
    prompt:`Verified script:\n${p.script}\n\nCreate 10-12 scenes. At least 60% must be diagram/code/terminal, at most 15% broll. Never use the same visual type 3 times consecutively. Each narration roughly 55-110 words. Use exact on-screen labels. sourceKey must be one of: ${[...allowed].join(', ')}.`,
    schema:STORY_SCHEMA,maxTokens:8500,temperature:.28,
  });
  p.storyboard=r.scenes.map((x,i)=>({
    sceneIndex:i,title:clean(x.title),narration:clean(x.narration),callout:clean(x.callout),visualType:x.visualType,
    items:x.items.map(clean).filter(Boolean).slice(0,6),code:x.code?.trim()||undefined,sourceKey:allowed.has(x.sourceKey||'')?x.sourceKey:p.selected!.sourceKeys[0],
  }));
  p.stage='quality_gate';p.lastError=undefined;await saveProject(p);
}

function tokenSet(v:string){return new Set(v.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(x=>x.length>2));}
function ngrams(v:string,n:number){const a=[...v.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(x=>x.length>2)];const s=new Set<string>();for(let i=0;i<=a.length-n;i++)s.add(a.slice(i,i+n).join(' '));return s;}
function jac(a:Set<string>,b:Set<string>){if(!a.size||!b.size)return 0;let i=0;for(const x of a)if(b.has(x))i++;return i/(a.size+b.size-i);}
function maxSimilarity(v:string,recent:Array<{title:string;transcript?:string}>,field:'title'|'transcript'){const n=field==='title'?1:4;const a=ngrams(v,n);return Number(Math.max(0,...recent.map(x=>jac(a,ngrams(field==='title'?x.title:(x.transcript||''),n)))).toFixed(3));}
function deterministicGate(p:Stored<Project>,ctx:EditorialContext){
  const scenes=p.storyboard||[];const script=p.script||'';
  const broll=scenes.filter(x=>x.visualType==='broll').length;
  const proof=scenes.filter(x=>['diagram','code','terminal'].includes(x.visualType)).length;
  let triples=false;for(let i=2;i<scenes.length;i++)if(scenes[i].visualType===scenes[i-1].visualType&&scenes[i-1].visualType===scenes[i-2].visualType)triples=true;
  const titleSim=maxSimilarity(p.title||'',ctx.recentVideos,'title');
  const scriptSim=maxSimilarity(script,ctx.recentVideos,'transcript');
  const checks={
    scriptLength:words(script)>=1000&&words(script)<=1900,
    sceneCount:scenes.length>=10&&scenes.length<=12,
    brollLimit:scenes.length>0&&broll/scenes.length<=.15,
    proofDensity:scenes.length>0&&proof/scenes.length>=.60,
    evidenceCoverage:scenes.length>0&&scenes.filter(x=>x.sourceKey).length/scenes.length>=.9,
    visualVariety:!triples,
    factualSupport:Boolean(p.claims?.length)&&p.claims!.every(x=>x.supported&&x.confidence>=70),
    titleOriginality:titleSim<.55,
    scriptOriginality:scriptSim<.14,
    thumbnailConcise:Boolean(p.thumbnailText)&&(p.thumbnailText?.length||99)<=28&&(p.thumbnailSubtext?.length||99)<=36,
  };
  return {checks,titleSim,scriptSim};
}

const GATE_SCHEMA:any={type:'object',properties:{scores:{type:'object',properties:{utility:{type:'number'},demonstrability:{type:'number'},factuality:{type:'number'},originality:{type:'number'},narrative:{type:'number'},visualPlan:{type:'number'},monetizationSafety:{type:'number'},thumbnail:{type:'number'}},required:['utility','demonstrability','factuality','originality','narrative','visualPlan','monetizationSafety','thumbnail']},blockers:{type:'array',items:{type:'string'}},revisionNotes:{type:'array',items:{type:'string'}}},required:['scores','blockers','revisionNotes']};
async function qualityGate(p:Stored<Project>,ctx:EditorialContext){
  if(!p.script||!p.storyboard||!p.title)throw new Error('Editorial package incomplete');
  const det=deterministicGate(p,ctx);
  const r=await generateJson<any>({
    system:'Act as a severe final editorial board. Reject generic, repetitive or mass-produced-feeling technical content, weak proof, stock-heavy visuals, unsupported claims, shallow narration, clickbait metadata and interchangeable scenes. AI may aid production but the finished work must have clear original educational value.',
    prompt:`Title: ${p.title}\nProblem: ${JSON.stringify(p.selected)}\nClaims: ${JSON.stringify(p.claims)}\nStoryboard: ${JSON.stringify(p.storyboard)}\nScript:\n${p.script}\n\nDeterministic checks: ${JSON.stringify(det)}`,
    schema:GATE_SCHEMA,maxTokens:3500,temperature:.08,
  });
  const s:any={};for(const k of ['utility','demonstrability','factuality','originality','narrative','visualPlan','monetizationSafety','thumbnail'])s[k]=score(r.scores[k]);
  s.overall=Math.round(s.utility*.18+s.demonstrability*.17+s.factuality*.16+s.originality*.16+s.narrative*.10+s.visualPlan*.10+s.monetizationSafety*.08+s.thumbnail*.05);
  const blockers=[...Object.entries(det.checks).filter(([,v])=>!v).map(([k])=>`Deterministic check failed: ${k}`),...(r.blockers||[]).map(clean)];
  const pass=s.utility>=92&&s.demonstrability>=90&&s.factuality>=95&&s.originality>=90&&s.narrative>=88&&s.visualPlan>=90&&s.monetizationSafety>=95&&s.thumbnail>=85&&s.overall>=92&&blockers.length===0;
  p.gate={passed:pass,scores:s,blockers,revisionNotes:(r.revisionNotes||[]).map(clean),checks:det.checks,maxTitleSimilarity:det.titleSim,maxScriptSimilarity:det.scriptSim};
  if(pass){p.stage='rendering';p.lastError=undefined;}
  else if(p.revision<2){p.stage='revision';p.lastError=`Quality Gate rejected: ${blockers.join(' | ').slice(0,900)}`;}
  else {p.stage='rejected';p.lastError=`Quality Gate rejected after revisions: ${blockers.join(' | ').slice(0,900)}`;}
  await saveProject(p);
}

async function revise(p:Stored<Project>){
  // Fact review can reject a package before the final Quality Gate exists.
  // Treat that rejection as revision context instead of deadlocking the state
  // machine in `revision` with `Revision package missing`.
  if(!p.research||!p.selected||!p.script)throw new Error('Revision package missing');
  const revisionContext=p.gate||{
    passed:false,
    scores:{},
    blockers:[p.lastError||'Factual gate requested revision'],
    revisionNotes:['Remove or strengthen unsupported claims, then repeat fact review.'],
    checks:{},
  };
  const allowed=new Set(p.selected.sourceKeys);
  const sources=p.research.sources.filter(x=>allowed.has(x.key));
  const r=await generateJson<any>({
    system:'Substantially revise a rejected technical tutorial. Fix blockers structurally: more proof, less generic language, better first 30 seconds, stronger narrative progression, and no unsupported claims. Do not merely paraphrase.',
    prompt:`Problem: ${JSON.stringify(p.selected)}\nGate: ${JSON.stringify(revisionContext)}\nScript:\n${p.script}\n\nEvidence:\n${sourceText(sources)}\n\nReturn title, description, thumbnailText, thumbnailSubtext, revised 1100-1700 word script, and material claim ledger.`,
    schema:{...SCRIPT_SCHEMA,properties:{...SCRIPT_SCHEMA.properties,thumbnailText:{type:'string'},thumbnailSubtext:{type:'string'}},required:['title','description','tags','script','claims','thumbnailText','thumbnailSubtext']},
    maxTokens:8500,temperature:.3,
  });
  p.title=clean(r.title).slice(0,100);p.description=String(r.description).trim();p.tags=(r.tags||p.tags||[]).map(clean).slice(0,12);
  p.thumbnailText=clean(r.thumbnailText).slice(0,28);p.thumbnailSubtext=clean(r.thumbnailSubtext).slice(0,36);
  p.script=String(r.script).trim();p.claimDrafts=(r.claims as any[]).map(x=>({claim:clean(x.claim),sourceKeys:x.sourceKeys.filter((k:string)=>allowed.has(k))})).filter(x=>x.sourceKeys.length);
  p.claims=undefined;p.storyboard=undefined;p.gate=undefined;p.revision++;p.stage='fact_review';p.lastError=undefined;await saveProject(p);
}

async function sceneRecords(userId:string,projectKey:string){
  const {items}=await db.list<SceneRecord>(SCENE_TABLE,{limit:50});
  return items.filter(x=>x.userId===userId&&x.projectKey===projectKey).sort((a,b)=>a.sceneIndex-b.sceneIndex);
}
async function seedScenes(p:Stored<Project>){
  if(!p.storyboard)throw new Error('Storyboard missing');
  const existing=await sceneRecords(p.userId,p.projectKey);if(existing.length)return existing;
  const t=now();
  await db.add(SCENE_TABLE,p.storyboard.map(x=>({...x,userId:p.userId,projectKey:p.projectKey,status:'planned' as const,retryCount:0,createdAt:t,updatedAt:t})));
  return sceneRecords(p.userId,p.projectKey);
}
function ass(v:string){return v.replace(/[{}\\]/g,'').replace(/\r?\n/g,'\\N').trim();}
function wrap(v:string,max=58){const words=v.replace(/\r?\n/g,' ').split(/\s+/);const lines:string[]=[];let line='';for(const w of words){const n=line?`${line} ${w}`:w;if(n.length>max&&line){lines.push(line);line=w;}else line=n;}if(line)lines.push(line);return lines.slice(0,10).join('\\N');}
async function sceneAss(scene:ScenePlan,key:string){
  const path=join(tmpdir(),`${key}.ass`);
  const itemText=scene.visualType==='code'||scene.visualType==='terminal'?(scene.code||scene.items.join('\n')):scene.items.map(x=>`• ${x}`).join('\n');
  const content=`[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,${fontName()},50,&H00FFFFFF,&H000000FF,&H00101825,&H00000000,-1,0,0,0,100,100,0,0,1,3,0,7,80,80,50,1
Style: Callout,${fontName()},30,&H00FFFFFF,&H000000FF,&H00101825,&H88000000,-1,0,0,0,100,100,0,0,3,2,0,1,80,80,55,1
Style: Body,${fontName()},34,&H00EAF4FF,&H000000FF,&H00101825,&H00000000,0,0,0,0,100,100,0,0,1,1,0,7,120,120,80,1
Style: Brand,${fontName()},20,&H0096E9FF,&H000000FF,&H00101825,&H00000000,-1,0,0,0,100,100,2,0,1,2,0,9,60,60,50,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:20:00.00,Title,,0,0,0,,{\\pos(90,75)}${ass(scene.title)}
Dialogue: 0,0:00:00.00,0:20:00.00,Brand,,0,0,0,,{\\pos(1830,70)}AUTOMATION OPS AI
Dialogue: 0,0:00:00.00,0:20:00.00,Body,,0,0,0,,{\\pos(145,260)}${ass(wrap(itemText,72))}
Dialogue: 0,0:00:00.00,0:20:00.00,Callout,,0,0,0,,{\\pos(90,990)}${ass(scene.callout)}
`;
  await writeFile(path,content,'utf8');return path;
}
function vf(scene:ScenePlan,assPath:string){
  const base=`drawbox=x=0:y=0:w=iw:h=ih:color=0x07111f@0.20:t=fill,drawbox=x=0:y=915:w=1920:h=165:color=0x020817@0.88:t=fill`;
  if(scene.visualType==='diagram'){
    const boxes=[100,450,800,1150,1500].map((x,i)=>`drawbox=x=${x}:y=390:w=290:h=190:color=0x10283d@0.98:t=fill,drawbox=x=${x}:y=390:w=290:h=190:color=0x38bdf8@0.75:t=3`).join(',');
    return `${base},${boxes},ass=${assPath}:fontsdir=${fontDir()}`;
  }
  if(scene.visualType==='code'||scene.visualType==='terminal')return `${base},drawbox=x=90:y=180:w=1740:h=680:color=0x09111e@0.98:t=fill,drawbox=x=90:y=180:w=1740:h=680:color=0x334155@0.9:t=2,ass=${assPath}:fontsdir=${fontDir()}`;
  if(scene.visualType==='checklist')return `${base},drawbox=x=100:y=190:w=1720:h=650:color=0x0b1728@0.96:t=fill,drawbox=x=100:y=190:w=12:h=650:color=0x22d3ee@0.95:t=fill,ass=${assPath}:fontsdir=${fontDir()}`;
  if(scene.visualType==='metric')return `${base},drawbox=x=410:y=270:w=1100:h=430:color=0x0b1728@0.96:t=fill,drawbox=x=410:y=270:w=1100:h=430:color=0x22d3ee@0.8:t=4,ass=${assPath}:fontsdir=${fontDir()}`;
  return `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,${base},ass=${assPath}:fontsdir=${fontDir()}`;
}
async function renderScene(p:Stored<Project>,scene:Stored<SceneRecord>){
  const key=`${p.projectKey}-${String(scene.sceneIndex).padStart(2,'0')}-${Date.now()}`;
  const audio=join(tmpdir(),`${key}.mp3`),video=join(tmpdir(),`${key}.mp4`),subs=await sceneAss(scene,key);
  try{
    await synthesizeNeuralSpeech(scene.narration,audio);
    const common=['-map','0:v:0','-map','1:a:0','-r','30','-c:v','libx264','-preset','veryfast','-crf','22','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-af','loudnorm=I=-16:TP=-1.5:LRA=10','-shortest','-movflags','+faststart',video];
    if(scene.visualType==='broll'){
      const source=BROLL[scene.sceneIndex%BROLL.length];
      await runFfmpeg(['-y','-stream_loop','-1','-ss',String((scene.sceneIndex*3)%12),'-i',source,'-i',audio,'-vf',vf(scene,subs),...common]);
    }else await runFfmpeg(['-y','-f','lavfi','-i','color=c=0x07111f:s=1920x1080:r=30','-i',audio,'-vf',vf(scene,subs),...common]);
    const info=await stat(video);if(info.size<250000)throw new Error(`Scene ${scene.sceneIndex} render too small`);
    const path=`editorial/${p.userId}/${p.projectKey}/scenes/${String(scene.sceneIndex).padStart(2,'0')}.mp4`;
    await storage.write([{path,content:await readFile(video),contentType:'video/mp4'}]);
    return {path,bytes:info.size};
  }finally{await Promise.all([unlink(audio).catch(()=>{}),unlink(video).catch(()=>{}),unlink(subs).catch(()=>{})]);}
}
async function advanceRender(p:Stored<Project>){
  await seedScenes(p);const scenes=await sceneRecords(p.userId,p.projectKey);
  const terminal=scenes.find(x=>x.status==='failed'&&x.retryCount>=3);
  if(terminal){p.stage='rejected';p.lastError=`Scene ${terminal.sceneIndex} exhausted retries: ${terminal.lastError}`;await saveProject(p);return;}
  const candidate=scenes.find(x=>x.status==='planned'||(x.status==='failed'&&x.retryCount<3));
  if(!candidate){p.stage='assembly';await saveProject(p);return;}
  try{
    const r=await renderScene(p,candidate);
    const {id,...record}=candidate;record.status='rendered';record.segmentStoragePath=r.path;record.bytes=r.bytes;record.lastError=undefined;record.updatedAt=now();
    await db.update(SCENE_TABLE,[{id,record}]);
  }catch(e){
    const {id,...record}=candidate;record.status='failed';record.retryCount++;record.lastError=(e instanceof Error?e.message:String(e)).slice(0,1000);record.updatedAt=now();
    await db.update(SCENE_TABLE,[{id,record}]);throw e;
  }
}

async function concat(paths:string[],output:string,key:string){
  const file=join(tmpdir(),`${key}-concat-${Date.now()}.txt`);
  const urls=await Promise.all(paths.map(x=>storage.url(x)));
  await writeFile(file,urls.map(x=>`file '${x.replace(/'/g,'%27')}'`).join('\n')+'\n','utf8');
  try{await runFfmpeg(['-y','-protocol_whitelist','file,http,https,tcp,tls','-f','concat','-safe','0','-i',file,'-c','copy','-movflags','+faststart',output]);}
  finally{await unlink(file).catch(()=>{});}
}
async function thumbnail(p:Stored<Project>){
  const out=join(tmpdir(),`${p.projectKey}-thumb.jpg`);
  const subs=join(tmpdir(),`${p.projectKey}-thumb.ass`);
  const main=ass(p.thumbnailText||p.title||'BUILD IT RIGHT'),sub=ass(p.thumbnailSubtext||'PRODUCTION WORKFLOW');
  await writeFile(subs,`[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
ScaledBorderAndShadow: yes
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,${fontName()},76,&H00FFFFFF,&H000000FF,&H00101825,&H00000000,-1,0,0,0,100,100,0,0,1,5,0,7,70,70,70,1
Style: Sub,${fontName()},32,&H0096E9FF,&H000000FF,&H00101825,&H00000000,-1,0,0,0,100,100,1,0,1,3,0,7,70,70,70,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:05.00,Main,,0,0,0,,{\\pos(75,160)}${main}
Dialogue: 0,0:00:00.00,0:00:05.00,Sub,,0,0,0,,{\\pos(80,380)}${sub}
`,'utf8');
  try{
    await runFfmpeg(['-y','-f','lavfi','-i','color=c=0x07111f:s=1280x720','-frames:v','1','-vf',`drawbox=x=0:y=0:w=760:h=720:color=0x06101e@0.96:t=fill,drawbox=x=0:y=0:w=14:h=720:color=0x22d3ee@0.95:t=fill,drawbox=x=830:y=140:w=330:h=130:color=0x10283d@1:t=fill,drawbox=x=830:y=360:w=330:h=130:color=0x10283d@1:t=fill,ass=${subs}:fontsdir=${fontDir()}`,'-q:v','2',out]);
    return out;
  }catch(e){await unlink(out).catch(()=>{});throw e;}finally{await unlink(subs).catch(()=>{});}
}
async function assemble(p:Stored<Project>){
  const scenes=await sceneRecords(p.userId,p.projectKey);
  if(!scenes.length||scenes.some(x=>x.status!=='rendered'||!x.segmentStoragePath)){p.stage='rendering';await saveProject(p);return;}
  const base=`editorial/${p.userId}/${p.projectKey}`;
  if(!p.finalStoragePath){
    const out=join(tmpdir(),`${p.projectKey}-final.mp4`);
    try{
      await concat(scenes.map(x=>x.segmentStoragePath!),out,p.projectKey);
      const info=await stat(out);if(info.size<2_000_000)throw new Error(`Final video too small (${info.size})`);
      const path=`${base}/final.mp4`;await storage.write([{path,content:await readFile(out),contentType:'video/mp4'}]);p.finalStoragePath=path;await saveProject(p);return;
    }finally{await unlink(out).catch(()=>{});}
  }
  if(!p.thumbnailStoragePath){
    const out=await thumbnail(p);
    try{const info=await stat(out);if(info.size<20_000)throw new Error('Thumbnail too small');const path=`${base}/thumbnail.jpg`;await storage.write([{path,content:await readFile(out),contentType:'image/jpeg'}]);p.thumbnailStoragePath=path;await saveProject(p);return;}
    finally{await unlink(out).catch(()=>{});}
  }
  const vi=await storage.info(p.finalStoragePath),ti=await storage.info(p.thumbnailStoragePath);
  if(!vi||Number(vi.bytes)<2_000_000||!ti||Number(ti.bytes)<20_000)throw new Error('Stored assets failed integrity gate');
  p.stage='ready';p.lastError=undefined;await saveProject(p);
}

function publishSpec(p:Stored<Project>):PublishSpec|undefined{
  if(p.stage!=='ready'||!p.finalStoragePath||!p.thumbnailStoragePath||!p.title||!p.description||!p.tags||!p.script)return;
  return {automationKey:p.projectKey,title:p.title,description:p.description,tags:p.tags,transcript:p.script,preparedStoragePath:p.finalStoragePath,thumbnailStoragePath:p.thumbnailStoragePath};
}

export async function advanceEditorial(userId:string,ctx:EditorialContext){
  const current=await currentProject(userId);if(current.cooldown)return {status:'cooldown' as const,project:current.project,publishSpec:undefined};
  const p=current.project;
  try{
    if(p.stage==='research')await doResearch(p,ctx);
    else if(p.stage==='problem')await selectProblem(p,ctx);
    else if(p.stage==='outline')await buildOutline(p);
    else if(p.stage==='script')await writeScript(p);
    else if(p.stage==='fact_review')await factReview(p);
    else if(p.stage==='storyboard')await storyboard(p);
    else if(p.stage==='quality_gate')await qualityGate(p,ctx);
    else if(p.stage==='revision')await revise(p);
    else if(p.stage==='rendering')await advanceRender(p);
    else if(p.stage==='assembly')await assemble(p);
  }catch(e){p.lastError=(e instanceof Error?e.message:String(e)).slice(0,1200);await saveProject(p).catch(()=>{});throw e;}
  const refreshed=(await listProjects(userId)).find(x=>x.projectKey===p.projectKey)||p;
  return {status:refreshed.stage,project:refreshed,publishSpec:publishSpec(refreshed)};
}

export async function getEditorialStatus(userId:string):Promise<EditorialStatus>{
  const projects=await listProjects(userId);
  if(!projects.length)return {stage:'idle',nextAction:'Create the first professional editorial project.'};
  const active=projects.find(x=>!['published','rejected'].includes(x.stage));const p=active||projects[0];
  const cooldown=!active&&p.stage==='published'&&hoursSince(p.publishedAt||p.updatedAt)<COOLDOWN_HOURS;
  const scenes=p.storyboard?await sceneRecords(userId,p.projectKey):[];
  const actions:Record<string,string>={
    research:'Research official sources and current demand.',problem:'Select a concrete demonstrable problem.',outline:'Design implementation outline.',script:'Write technical script.',fact_review:'Verify material claims.',storyboard:'Create proof-oriented visual plan.',quality_gate:'Apply strict editorial Quality Gate.',revision:'Structurally revise rejected package.',rendering:'Render one neural-narrated scene.',assembly:'Assemble and verify master assets.',ready:'Approved package awaiting unlisted upload.',published:'Collect performance and wait for next editorial cycle.',rejected:'Archive and start a new concept later.'
  };
  return {projectKey:p.projectKey,stage:cooldown?'cooldown':p.stage,title:p.title||p.selected?.workingTitle,problem:p.selected?.problem,revision:p.revision,qualityScore:p.gate?.scores.overall,blockers:p.gate?.blockers.slice(0,5),renderedScenes:scenes.filter(x=>x.status==='rendered').length,totalScenes:p.storyboard?.length,youtubeUrl:p.youtubeUrl,lastError:p.lastError,createdAt:p.createdAt,updatedAt:p.updatedAt,nextAction:cooldown?`Editorial cooldown: one long video every ${COOLDOWN_HOURS}h.`:(actions[p.stage]||'Continue pipeline.')};
}

export async function markPublished(userId:string,projectKey:string,videoId:string,url:string){
  const p=(await listProjects(userId)).find(x=>x.projectKey===projectKey);if(!p)return;
  p.stage='published';p.youtubeVideoId=videoId;p.youtubeUrl=url;p.publishedAt=now();p.lastError=undefined;await saveProject(p);
}
