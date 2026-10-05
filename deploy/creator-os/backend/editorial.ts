import { copyFile, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db, storage, type Stored } from './platform.js';
import { generateJson } from './ai.js';
import { fontDir, fontName, remoteFileSize, runFfmpeg, synthesizeNeuralSpeech } from './media.js';

export const EDITORIAL_PREFIX='editorial-pro-v2-';
const PIPELINE_VERSION='editorial-pro-v2';
const PROJECT_TABLE='editorial_projects_v2';
const SCENE_TABLE='editorial_scenes_v2';
const COOLDOWN_HOURS=0;

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

type Stage='research'|'problem'|'outline'|'script'|'fact_review'|'storyboard'|'quality_gate'|'revision'|'rendering'|'assembly'|'ready'|'queued'|'published'|'rejected';
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
  editorialOrigin?:'internal-ai'|'chatgpt-membership';externalReview?:ExternalReview;
  research?:{sources:Source[];opportunities:Opportunity[];demandSignals:string[]};
  selected?:Selected;outline?:Outline;script?:string;claimDrafts?:Array<{claim:string;sourceKeys:string[]}>;claims?:Claim[];
  storyboard?:ScenePlan[];gate?:Gate;title?:string;description?:string;tags?:string[];
  thumbnailText?:string;thumbnailSubtext?:string;finalStoragePath?:string;thumbnailStoragePath?:string;
  youtubeVideoId?:string;youtubeUrl?:string;publishedAt?:string;lastError?:string;createdAt:string;updatedAt:string;
};
type SceneRecord=ScenePlan&{userId:string;projectKey:string;status:'planned'|'rendered'|'failed';retryCount:number;segmentStoragePath?:string;bytes?:number;lastError?:string;createdAt:string;updatedAt:string};

type ExternalReview={
  reviewer:string;reviewedAt:string;scores:GateScores;
  checks:{officialSources:boolean;claimEvidence:boolean;originality:boolean;monetizationPolicy:boolean;narrationStoryboardSync:boolean;commercialRights:boolean;syntheticMediaDisclosure:boolean};
};
type EditorialPackage={
  packageVersion:1;packageKey:string;format:'standard';createdAt:string;language:string;
  research:{demandSignals:string[];competitiveGap:string;sources:Array<Source&{evidenceExcerpt:string}>};
  selected:Selected;outline:Outline;script:string;
  claims:Array<{claim:string;sourceKeys:string[];evidenceExcerpt:string}>;
  storyboard:ScenePlan[];
  metadata:{title:string;description:string;tags:string[];thumbnailText:string;thumbnailSubtext:string};
  rights:{thirdPartyMedia:boolean;originalOrProceduralVisuals:boolean;commercialUseCleared:boolean;syntheticVoiceDisclosed:boolean};
  review:ExternalReview;
};

export type EditorialContext={demandSignals:string[];recentVideos:Array<{title:string;transcript?:string}>;blockedTopics?:string[]};
export type PublishSpec={automationKey:string;title:string;description:string;tags:string[];transcript:string;preparedStoragePath:string;thumbnailStoragePath:string};
export type EditorialStatus={projectKey?:string;stage:Stage|'idle'|'cooldown';title?:string;problem?:string;revision?:number;qualityScore?:number;blockers?:string[];renderedScenes?:number;totalScenes?:number;youtubeUrl?:string;lastError?:string;createdAt?:string;updatedAt?:string;nextAction:string};

function now(){return new Date().toISOString();}
function clean(v:unknown){return String(v??'').replace(/\s+/g,' ').trim();}
function score(v:unknown){const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.min(100,Math.round(n))):0;}
function stripHtml(v:string){return clean(v.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&'));}
function words(v:string){return v.trim().split(/\s+/).filter(Boolean).length;}
function hoursSince(v?:string){return v?Math.max(0,(Date.now()-new Date(v).getTime())/3600000):Infinity;}
const TOPIC_STOP=new Set(['about','after','agent','agents','before','build','building','from','guide','how','into','shorts','that','this','using','video','with','your','para','como','este','esta']);
function topicTokens(value:string){
  return new Set(value.toLowerCase().replace(/#\w+/g,' ').split(/[^a-z0-9]+/).filter(x=>x.length>2&&!TOPIC_STOP.has(x)));
}
function topicSimilarity(left:string,right:string){
  const a=topicTokens(left),b=topicTokens(right);if(!a.size||!b.size)return 0;
  const common=[...a].filter(x=>b.has(x)).length;
  return common/Math.min(a.size,b.size);
}

function normalizedEvidence(v:string){return stripHtml(v).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function requireText(value:unknown,label:string,min=1,max=10000){
  const text=String(value??'').trim();
  if(text.length<min||text.length>max)throw new Error(`${label} must contain ${min}-${max} characters`);
  return text;
}
function safePackageKey(value:unknown){
  const key=String(value??'');
  if(!/^[a-z0-9][a-z0-9-]{5,79}$/.test(key))throw new Error('packageKey must be a 6-80 character lowercase slug');
  return key;
}
function safeSourceKey(value:unknown){
  const key=String(value??'');
  if(!/^[a-z0-9][a-z0-9-]{1,79}$/.test(key))throw new Error('source key must be a 2-80 character lowercase slug');
  return key;
}
function safeHttpsUrl(value:unknown,label:string){
  const url=new URL(String(value??''));
  if(url.protocol!=='https:'||url.username||url.password||url.hostname==='localhost'||url.hostname.endsWith('.local')||/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname))throw new Error(`${label} must be a public HTTPS URL`);
  return url.toString();
}

async function verifyPackageSource(source:Source&{evidenceExcerpt:string}){
  const url=safeHttpsUrl(source.url,`source ${source.key}`);
  const evidence=normalizedEvidence(requireText(source.evidenceExcerpt,`source ${source.key} evidenceExcerpt`,80,900));
  const response=await fetch(url,{redirect:'follow',headers:{'user-agent':'AutomationOpsAI/2.0 editorial-package-verifier'}});
  if(!response.ok)throw new Error(`source ${source.key} returned HTTP ${response.status}`);
  const body=normalizedEvidence((await response.text()).slice(0,2_000_000));
  if(!body.includes(evidence))throw new Error(`source ${source.key} does not contain its evidenceExcerpt`);
  return {...source,url,excerpt:stripHtml(await Promise.resolve(source.excerpt||source.evidenceExcerpt)).slice(0,4200),evidenceExcerpt:stripHtml(source.evidenceExcerpt),fetchedAt:now()};
}

function validateExternalReview(review:ExternalReview){
  requireText(review?.reviewer,'review.reviewer',3,120);
  const reviewedAt=new Date(review?.reviewedAt||'');
  if(!Number.isFinite(reviewedAt.getTime()))throw new Error('review.reviewedAt is invalid');
  const checks=review?.checks;
  if(!checks||Object.values(checks).some(value=>value!==true))throw new Error('Every external review check must be true');
  const scores=review?.scores;
  if(!scores)throw new Error('review.scores is missing');
  for(const key of ['utility','demonstrability','factuality','originality','narrative','visualPlan','monetizationSafety','thumbnail','overall'] as const){
    if(score(scores[key])!==scores[key])throw new Error(`review.scores.${key} must be an integer from 0 to 100`);
  }
}

async function validateEditorialPackage(raw:unknown):Promise<EditorialPackage>{
  const pkg=raw as EditorialPackage;
  if(pkg?.packageVersion!==1||pkg?.format!=='standard')throw new Error('Only packageVersion=1 and format=standard are supported');
  pkg.packageKey=safePackageKey(pkg.packageKey);requireText(pkg.language,'language',2,20);
  const createdAt=new Date(pkg.createdAt||'');
  if(!Number.isFinite(createdAt.getTime())||createdAt.getTime()>Date.now()+300_000||Date.now()-createdAt.getTime()>7*86400_000)throw new Error('createdAt must be within the last seven days');
  if(!pkg.research||!Array.isArray(pkg.research.sources)||pkg.research.sources.length<3)throw new Error('At least three official sources are required');
  requireText(pkg.research.competitiveGap,'research.competitiveGap',40,600);
  const sourceKeys=new Set<string>();
  for(const source of pkg.research.sources){
    const key=safeSourceKey(source.key);if(sourceKeys.has(key))throw new Error(`Duplicate source key: ${key}`);source.key=key;sourceKeys.add(key);
    requireText(source.title,`source ${key} title`,3,180);
  }
  pkg.research.sources=await Promise.all(pkg.research.sources.map(verifyPackageSource));
  if(!pkg.selected||!pkg.outline)throw new Error('selected and outline are required');
  if(!pkg.selected.sourceKeys?.length||pkg.selected.sourceKeys.some(key=>!sourceKeys.has(key)))throw new Error('selected.sourceKeys contains an unknown source');
  if(!Array.isArray(pkg.outline.sections)||pkg.outline.sections.length<9||pkg.outline.sections.length>14)throw new Error('outline.sections must contain 9-14 sections');
  if(pkg.outline.sections.some(section=>!section.sourceKeys?.length||section.sourceKeys.some(key=>!sourceKeys.has(key))))throw new Error('Every outline section must reference known sources');
  pkg.script=requireText(pkg.script,'script',3000,14000);const scriptWords=words(pkg.script);
  if(scriptWords<1000||scriptWords>1900)throw new Error(`script must contain 1000-1900 words (received ${scriptWords})`);
  if(!Array.isArray(pkg.claims)||pkg.claims.length<4||pkg.claims.length>12)throw new Error('claims must contain 4-12 material claims');
  for(const [index,claim] of pkg.claims.entries()){
    requireText(claim.claim,`claims[${index}].claim`,15,500);const evidence=normalizedEvidence(requireText(claim.evidenceExcerpt,`claims[${index}].evidenceExcerpt`,40,900));
    if(!claim.sourceKeys?.length||claim.sourceKeys.some(key=>!sourceKeys.has(key)))throw new Error(`claims[${index}] references an unknown source`);
    if(!claim.sourceKeys.some(key=>normalizedEvidence(pkg.research.sources.find(source=>source.key===key)?.evidenceExcerpt||'').includes(evidence)))throw new Error(`claims[${index}] evidence is absent from its cited source excerpt`);
  }
  if(!Array.isArray(pkg.storyboard)||pkg.storyboard.length<10||pkg.storyboard.length>12)throw new Error('storyboard must contain 10-12 scenes');
  pkg.storyboard.forEach((scene,index)=>{
    if(scene.sceneIndex!==index)throw new Error('storyboard sceneIndex values must be consecutive from zero');
    if(!['diagram','code','terminal','checklist','metric'].includes(scene.visualType))throw new Error(`storyboard[${index}] uses an unsupported visualType`);
    if(!scene.sourceKey||!sourceKeys.has(scene.sourceKey))throw new Error(`storyboard[${index}] sourceKey is unknown`);
    requireText(scene.narration,`storyboard[${index}].narration`,80,1600);
  });
  if(normalizedEvidence(pkg.storyboard.map(scene=>scene.narration).join(' '))!==normalizedEvidence(pkg.script))throw new Error('Storyboard narration must exactly cover the final script in order');
  const metadata=pkg.metadata;if(!metadata)throw new Error('metadata is missing');
  requireText(metadata.title,'metadata.title',10,100);requireText(metadata.description,'metadata.description',80,5000);
  if(!Array.isArray(metadata.tags)||metadata.tags.length<5||metadata.tags.length>12)throw new Error('metadata.tags must contain 5-12 precise search tags');
  requireText(metadata.thumbnailText,'metadata.thumbnailText',3,28);requireText(metadata.thumbnailSubtext,'metadata.thumbnailSubtext',3,36);
  const rights=pkg.rights;
  if(!rights||rights.thirdPartyMedia!==false||rights.originalOrProceduralVisuals!==true||rights.commercialUseCleared!==true||rights.syntheticVoiceDisclosed!==true)throw new Error('Rights declaration does not permit commercial publication');
  validateExternalReview(pkg.review);
  return pkg;
}

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
function compactSourceText(sources:Source[],charsPerSource=1100){
  return sources.map(x=>`[${x.key}] ${x.title}\nURL: ${x.url}\nEXCERPT: ${x.excerpt.slice(0,charsPerSource)}`).join('\n\n');
}

async function listProjects(userId:string){
  // db.list orders by physical created_at ASC before LIMIT, so a small limit
  // eventually hides new projects completely. Load the bounded full project
  // history and sort in application code so the newest active record is visible.
  const {items}=await db.list<Project>(PROJECT_TABLE,{filter:{userId},limit:5000});
  return items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}

export async function importChatGptEditorialPackages(userId:string){
  if(process.env.CHATGPT_EDITORIAL_PACKAGES_ENABLED==='false')return {imported:[],skipped:[],failed:[]};
  const directory=process.env.CHATGPT_EDITORIAL_PACKAGE_DIR||join(process.cwd(),'editorial-packages','inbox');
  let files:string[]=[];
  try{files=(await readdir(directory)).filter(name=>name.endsWith('.json')).sort();}
  catch(error:any){if(error?.code==='ENOENT')return {imported:[],skipped:[],failed:[]};throw error;}
  const existing=new Set((await listProjects(userId)).map(project=>project.projectKey));
  const imported:string[]=[],skipped:string[]=[],failed:Array<{file:string;error:string}>=[];
  for(const file of files){
    try{
      const raw=await readFile(join(directory,file),'utf8');
      if(Buffer.byteLength(raw)>1_000_000)throw new Error('Package exceeds 1 MB');
      const pkg=await validateEditorialPackage(JSON.parse(raw));
      const projectKey=`chatgpt-${pkg.packageKey}`;
      if(existing.has(projectKey)){skipped.push(projectKey);continue;}
      const createdAt=now();
      const claims:Claim[]=pkg.claims.map(item=>({claim:clean(item.claim),sourceKeys:item.sourceKeys,supported:true,confidence:100,note:'Evidence excerpt revalidated against the live cited page during import.'}));
      const opportunity:Opportunity={
        problem:clean(pkg.selected.problem),audience:clean(pkg.selected.audience),whyNow:clean(pkg.selected.whyNow),proofArtifact:clean(pkg.selected.proofArtifact),
        sourceKeys:pkg.selected.sourceKeys,utilityScore:score(pkg.selected.utilityScore),demoScore:score(pkg.selected.demoScore),
      };
      const record:Project={
        userId,projectKey,pipelineVersion:PIPELINE_VERSION,stage:'quality_gate',revision:0,editorialOrigin:'chatgpt-membership',externalReview:pkg.review,
        research:{sources:pkg.research.sources,opportunities:[opportunity],demandSignals:pkg.research.demandSignals.map(clean).filter(Boolean).slice(0,30)},
        selected:{...pkg.selected,workingTitle:clean(pkg.selected.workingTitle).slice(0,100)},outline:pkg.outline,script:pkg.script,
        claimDrafts:pkg.claims.map(item=>({claim:clean(item.claim),sourceKeys:item.sourceKeys})),claims,
        storyboard:pkg.storyboard,title:clean(pkg.metadata.title).slice(0,100),description:String(pkg.metadata.description).trim(),
        tags:pkg.metadata.tags.map(clean).filter(Boolean).slice(0,12),thumbnailText:clean(pkg.metadata.thumbnailText).slice(0,28),thumbnailSubtext:clean(pkg.metadata.thumbnailSubtext).slice(0,36),
        createdAt,updatedAt:createdAt,
      };
      await db.add(PROJECT_TABLE,[record]);existing.add(projectKey);imported.push(projectKey);
    }catch(error){failed.push({file,error:(error instanceof Error?error.message:String(error)).slice(0,500)});}
  }
  return {imported,skipped,failed};
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
  const terminal=new Set<Stage>(['queued','published','rejected']);
  const rank:Record<Stage,number>={
    research:0,problem:1,outline:2,script:3,fact_review:4,storyboard:5,quality_gate:6,
    revision:7,rendering:8,assembly:9,ready:10,queued:11,published:12,rejected:-1
  };
  const active=projects
    .filter(x=>!terminal.has(x.stage))
    .sort((a,b)=>{
      const aReviewed=a.editorialOrigin==='chatgpt-membership'?1:0,bReviewed=b.editorialOrigin==='chatgpt-membership'?1:0;
      return (bReviewed-aReviewed)||(aReviewed?b.createdAt.localeCompare(a.createdAt):0)||(rank[b.stage]-rank[a.stage])||b.updatedAt.localeCompare(a.updatedAt);
    });
  if(active.length){
    const chosen=active[0];
    // Invariant: only one editorial project may be active. Previous pagination
    // bug created duplicate research/problem projects; archive them so they
    // cannot resume later and consume free-provider quota.
    for(const duplicate of active.slice(1)){
      duplicate.stage='rejected';
      duplicate.lastError=`Superseded duplicate active project; continuing ${chosen.projectKey}`;
      await saveProject(duplicate);
    }
    return {project:chosen,cooldown:false};
  }
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
    prompt:`Demand/title signals:\n${ctx.demandSignals.slice(0,20).join('\n')}\n\nRecent titles to avoid repeating:\n${ctx.recentVideos.slice(0,12).map(x=>x.title).join('\n')}\n\nTopics blocked because they remained at zero views for at least seven days:\n${(ctx.blockedTopics||[]).slice(0,12).join('\n')||'None'}\n\nOfficial sources:\n${compactSourceText(sources,650)}\n\nProduce exactly 4 evidence-backed, demonstrable opportunities. Keep problem, audience, whyNow and proofArtifact concise (max 180 characters each). Never propose a blocked topic or a semantic variant. Each opportunity must state the underserved question or missing proof that differentiates it from common tutorials. Score utility and demonstrability 0-100.`,
    schema:RESEARCH_SCHEMA,temperature:.35,maxTokens:2200,
  });
  const keys=new Set(sources.map(x=>x.key));
  const rawOpportunities=Array.isArray(result?.opportunities)?result.opportunities:[];
  const opportunities=rawOpportunities.map((x:any)=>({
    ...x,
    problem:clean(x?.problem).slice(0,220),
    audience:clean(x?.audience).slice(0,180),
    whyNow:clean(x?.whyNow).slice(0,180),
    proofArtifact:clean(x?.proofArtifact).slice(0,180),
    sourceKeys:(Array.isArray(x?.sourceKeys)?x.sourceKeys:[]).filter((k:string)=>keys.has(k)).slice(0,4),
    utilityScore:score(x?.utilityScore),
    demoScore:score(x?.demoScore)
  })).filter((x:any)=>x.problem&&x.sourceKeys.length&&x.utilityScore>=78&&x.demoScore>=78);
  if(opportunities.length<3)throw new Error('Research produced fewer than three strong opportunities');
  p.research={sources,opportunities,demandSignals:ctx.demandSignals.slice(0,30)};
  p.stage='problem';p.lastError=undefined;await saveProject(p);
}

const SELECT_SCHEMA:any={type:'object',properties:{selectedIndex:{type:'integer'},promise:{type:'string'},viewerOutcome:{type:'string'},scope:{type:'array',items:{type:'string'}},exclusions:{type:'array',items:{type:'string'}},workingTitle:{type:'string'}},required:['selectedIndex','promise','viewerOutcome','scope','exclusions','workingTitle']};
async function selectProblem(p:Stored<Project>,ctx:EditorialContext){
  if(!p.research)throw new Error('Research missing');
  const r=await generateJson<any>({
    system:'Select one problem for a rigorous technical tutorial. Favor utility, a real implementation/debug artifact, evidence and meaningful distinction from recent videos. Reject generic AI hype.',
    prompt:`Opportunities:\n${p.research.opportunities.map((x,i)=>`${i}. ${JSON.stringify(x)}`).join('\n')}\n\nRecent titles:\n${ctx.recentVideos.map(x=>x.title).slice(0,20).join('\n')}\n\nHard-blocked zero-view topics:\n${(ctx.blockedTopics||[]).join('\n')||'None'}`,
    schema:SELECT_SCHEMA,maxTokens:1800,temperature:.2,
  });
  const selected=p.research.opportunities[r.selectedIndex];
  if(!selected)throw new Error('Invalid selected opportunity');
  const proposed=`${selected.problem} ${r.workingTitle}`;
  const blocked=(ctx.blockedTopics||[]).find(title=>topicSimilarity(proposed,title)>=0.5);
  if(blocked)throw new Error(`Selected topic is too similar to a video with zero views after seven days: ${blocked}`);
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
    prompt:`Problem:\n${JSON.stringify(p.selected)}\n\nEvidence:\n${compactSourceText(sources,1000)}\n\nCreate 9-14 sections. Every section must specify a visible proof artifact such as configuration, workflow branch, terminal output, test, failure reproduction, before/after behavior or observable result. Thumbnail main text <=28 chars and subtext <=36.`,
    schema:OUTLINE_SCHEMA,maxTokens:2400,temperature:.25,
  });
  r.sections=r.sections.map(x=>({...x,heading:clean(x.heading),purpose:clean(x.purpose),demonstration:clean(x.demonstration),sourceKeys:x.sourceKeys.filter(k=>allowed.has(k))}));
  if(r.sections.some(x=>!x.sourceKeys.length))throw new Error('Outline section without official evidence');
  p.outline=r;p.thumbnailText=clean(r.thumbnailText).slice(0,28);p.thumbnailSubtext=clean(r.thumbnailSubtext).slice(0,36);
  p.stage='script';p.lastError=undefined;await saveProject(p);
}

const SCRIPT_SCHEMA:any={type:'object',properties:{title:{type:'string'},description:{type:'string'},tags:{type:'array',items:{type:'string'}},script:{type:'string'},claims:{type:'array',minItems:4,items:{type:'object',properties:{claim:{type:'string'},sourceKeys:{type:'array',items:{type:'string'}}},required:['claim','sourceKeys']}}},required:['title','description','tags','script','claims']};
const SCRIPT_SEGMENT_SCHEMA:any={type:'object',properties:{narration:{type:'string'},claims:{type:'array',items:{type:'object',properties:{claim:{type:'string'},sourceKeys:{type:'array',items:{type:'string'}}},required:['claim','sourceKeys']}}},required:['narration','claims']};
const SCRIPT_META_SCHEMA:any={type:'object',properties:{title:{type:'string'},description:{type:'string'},tags:{type:'array',items:{type:'string'}},thumbnailText:{type:'string'},thumbnailSubtext:{type:'string'}},required:['title','description','tags','thumbnailText','thumbnailSubtext']};

function splitInto<T>(items:T[],count:number){
  return Array.from({length:count},(_,i)=>items.slice(Math.floor(i*items.length/count),Math.floor((i+1)*items.length/count)));
}
function wordChunks(value:string,count:number){
  const tokens=value.trim().split(/\s+/).filter(Boolean);return splitInto(tokens,count).map(x=>x.join(' '));
}
async function generateScriptPackage(p:Stored<Project>,sources:Source[],revisionContext?:unknown){
  if(!p.selected||!p.outline)throw new Error('Script package inputs missing');
  const allowed=new Set(p.selected.sourceKeys);
  const groups=splitInto(p.outline.sections,4),previous=p.script?wordChunks(p.script,4):[];
  const segments:string[]=[];const claims:Array<{claim:string;sourceKeys:string[]}>=[];
  for(let index=0;index<groups.length;index++){
    let accepted:any=null,lastWords=0;
    for(let attempt=0;attempt<2;attempt++){
      const r=await generateJson<any>({
        system:'Write one contiguous segment of an expert technical-video narration. Use only supplied official evidence. Include concrete implementation, failure behavior, validation and tradeoffs. No intro/outro filler, hype, fabricated UI, unsupported product behavior or markdown headings. Return concise JSON.',
        prompt:`Video problem:\n${JSON.stringify(p.selected)}\n\nSegment ${index+1}/4 outline:\n${JSON.stringify(groups[index])}\n\n${revisionContext?`Revision blockers:\n${JSON.stringify(revisionContext)}\n\nExisting segment to rebuild:\n${previous[index]||''}\n\n`:''}Official evidence:\n${compactSourceText(sources,850)}\n\nWrite 225-310 words that connect naturally with the full tutorial. Return every material factual claim with its supporting source keys.${attempt?' The prior segment was too short; deliver the complete requested length.':''}`,
        schema:SCRIPT_SEGMENT_SCHEMA,maxTokens:850,temperature:attempt?.16:.26,
      });
      const narration=String(r.narration||'').trim();lastWords=words(narration);
      if(lastWords>=210&&lastWords<=340){accepted={...r,narration};break;}
    }
    if(!accepted)throw new Error(`Chunked script segment too short after retry: segment=${index+1}, words=${lastWords}`);
    segments.push(accepted.narration);
    for(const item of Array.isArray(accepted.claims)?accepted.claims:[]){
      const sourceKeys=(Array.isArray(item.sourceKeys)?item.sourceKeys:[]).filter((k:string)=>allowed.has(k));
      const claim=clean(item.claim);if(claim&&sourceKeys.length)claims.push({claim,sourceKeys});
    }
  }
  const script=segments.join('\n\n'),wc=words(script);
  if(wc<900||wc>1360)throw new Error(`Chunked script failed length gate: ${wc} words`);
  if(claims.length<4)throw new Error(`Chunked script claim ledger too small: ${claims.length}`);
  const metadata=await generateJson<any>({
    system:'Package a factual technical YouTube tutorial. Metadata must describe exactly the demonstrated outcome. Avoid clickbait, generic hashtags and service offers.',
    prompt:`Problem:\n${JSON.stringify(p.selected)}\n\nOutline:\n${JSON.stringify(p.outline)}\n\nNarration:\n${script}\n\nReturn an honest title <=100 characters, description whose first 200 characters contain the natural search phrase, 5-12 search tags, 3-5 precise hashtags inside the description, thumbnailText <=28 characters and thumbnailSubtext <=36 characters.`,
    schema:SCRIPT_META_SCHEMA,maxTokens:650,temperature:.18,
  });
  return {script,claims,metadata};
}
async function writeScript(p:Stored<Project>){
  if(!p.research||!p.selected||!p.outline)throw new Error('Outline missing');
  const allowed=new Set(p.selected.sourceKeys);
  const sources=p.research.sources.filter(x=>allowed.has(x.key));
  const result=await generateScriptPackage(p,sources);
  p.title=clean(result.metadata.title).slice(0,100);p.description=String(result.metadata.description||'').trim();p.tags=(Array.isArray(result.metadata.tags)?result.metadata.tags:[]).map(clean).filter(Boolean).slice(0,12);
  p.thumbnailText=clean(result.metadata.thumbnailText).slice(0,28);p.thumbnailSubtext=clean(result.metadata.thumbnailSubtext).slice(0,36);
  p.script=result.script;p.claimDrafts=result.claims;p.stage='fact_review';p.lastError=undefined;await saveProject(p);
}

// The fact gate deliberately returns only a compact claim ledger. Asking a
// free-tier model to echo a 1,000+ word script inside JSON made otherwise valid
// responses hit their output limit and left the pipeline stuck on malformed
// JSON. The script is allowed through only when every material claim passes;
// any unsupported claim sends the project back to revision.
const FACT_SCHEMA:any={type:'object',properties:{claims:{type:'array',minItems:4,items:{type:'object',properties:{claim:{type:'string'},sourceKeys:{type:'array',items:{type:'string'}},supported:{type:'boolean'},confidence:{type:'number'},note:{type:'string'}},required:['claim','sourceKeys','supported','confidence','note']}}},required:['claims']};
async function factReview(p:Stored<Project>){
  if(!p.research||!p.script||!p.claimDrafts?.length)throw new Error('Fact-review inputs missing');
  const keys=new Set(p.claimDrafts.flatMap(x=>x.sourceKeys));
  const sources=p.research.sources.filter(x=>keys.has(x.key));
  const compactEvidence=sources.map(x=>`[${x.key}] ${x.title}\n${x.excerpt.slice(0,1400)}`).join('\n\n');
  const compactClaims=p.claimDrafts.slice(0,12).map(x=>({claim:x.claim,sourceKeys:x.sourceKeys}));
  const r=await generateJson<{claims:Claim[]}>({
    system:'Be a strict factual reviewer. Evaluate each supplied material claim only against the supplied official evidence. Preserve every claim and its source keys in the returned ledger. Mark unsupported or ambiguous claims as unsupported. Do not rewrite the script, add claims, or reveal reasoning. Keep each note under 25 words.',
    prompt:`Claims to evaluate:\n${JSON.stringify(compactClaims)}\n\nOfficial evidence:\n${compactEvidence}`,
    schema:FACT_SCHEMA,maxTokens:850,temperature:.05,
  });
  const claims=(Array.isArray(r.claims)?r.claims:[])
    .map(x=>({...x,claim:clean(x.claim||''),confidence:score(x.confidence),note:clean(x.note||'')}))
    .filter(x=>x.claim);
  const supported=claims.filter(x=>x.supported&&x.confidence>=70);
  const reviewedAll=claims.length===compactClaims.length;
  const allSupported=reviewedAll&&supported.length===compactClaims.length;
  const wc=words(p.script);
  p.claims=supported;
  if(wc>=900&&allSupported&&supported.length>=4){
    p.stage='storyboard';p.lastError=undefined;
  }else if(p.revision>=2){
    p.stage='rejected';p.lastError=`Factual gate rejected: script=${wc} words, reviewedClaims=${claims.length}/${compactClaims.length}, supportedClaims=${supported.length}`;
  }else{
    p.stage='revision';p.lastError=`Factual gate needs revision: script=${wc} words, reviewedClaims=${claims.length}/${compactClaims.length}, supportedClaims=${supported.length}`;
  }
  await saveProject(p);
}

const STORY_SCHEMA:any={type:'object',properties:{scenes:{type:'array',minItems:4,maxItems:4,items:{type:'object',properties:{title:{type:'string'},narration:{type:'string'},callout:{type:'string'},visualType:{type:'string',enum:['diagram','code','terminal','checklist','metric']},items:{type:'array',items:{type:'string'}},code:{type:'string'},sourceKey:{type:'string'}},required:['title','narration','callout','visualType','items','code','sourceKey']}}},required:['scenes']};
async function storyboard(p:Stored<Project>){
  if(!p.script||!p.selected)throw new Error('Verified script missing');
  const allowed=new Set(p.selected.sourceKeys);
  const batches:Array<Omit<ScenePlan,'sceneIndex'>>=[];
  const chunks=wordChunks(p.script,3);
  for(let index=0;index<chunks.length;index++){
    const r=await generateJson<{scenes:Array<Omit<ScenePlan,'sceneIndex'>>}>({
      system:'Create four consecutive proof-oriented scenes for a professional technical video. Use diagrams, code/config, terminal/debug output, checklists or measurable states. Never use decorative B-roll or invent screenshots of real software.',
      prompt:`Narration portion ${index+1}/3:\n${chunks[index]}\n\nCreate exactly 4 scenes. Each narration 55-95 words. At least 3 scenes must be diagram/code/terminal. Do not use the same visual type three times consecutively. Use exact short on-screen labels. sourceKey must be one of: ${[...allowed].join(', ')}.`,
      schema:STORY_SCHEMA,maxTokens:900,temperature:.24,
    });
    if(r.scenes.length!==4)throw new Error(`Storyboard batch ${index+1} returned ${r.scenes.length} scenes`);
    batches.push(...r.scenes);
  }
  p.storyboard=batches.map((x,i)=>({
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
  if(p.editorialOrigin==='chatgpt-membership'){
    if(!p.externalReview)throw new Error('ChatGPT editorial package is missing its external review');
    validateExternalReview(p.externalReview);
    const s=p.externalReview.scores;
    const blockers=Object.entries(det.checks).filter(([,passed])=>!passed).map(([key])=>`Deterministic check failed: ${key}`);
    const pass=s.utility>=92&&s.demonstrability>=90&&s.factuality>=95&&s.originality>=90&&s.narrative>=88&&s.visualPlan>=90&&s.monetizationSafety>=95&&s.thumbnail>=85&&s.overall>=92&&blockers.length===0;
    p.gate={passed:pass,scores:s,blockers,revisionNotes:pass?[]:['Rebuild the membership editorial package; automated revision would discard the reviewed provenance.'],checks:det.checks,maxTitleSimilarity:det.titleSim,maxScriptSimilarity:det.scriptSim};
    if(pass){p.stage='rendering';p.lastError=undefined;}
    else {p.stage='rejected';p.lastError=`Membership package Quality Gate rejected: ${blockers.join(' | ').slice(0,900)}`;}
    await saveProject(p);return;
  }
  const r=await generateJson<any>({
    system:'Act as a severe final editorial board. Reject generic, repetitive or mass-produced-feeling technical content, weak proof, stock-heavy visuals, unsupported claims, shallow narration, clickbait metadata and interchangeable scenes. AI may aid production but the finished work must have clear original educational value.',
    prompt:`Title: ${p.title}\nProblem: ${JSON.stringify(p.selected)}\nClaims: ${JSON.stringify(p.claims)}\nStoryboard: ${JSON.stringify(p.storyboard)}\nScript:\n${p.script}\n\nDeterministic checks: ${JSON.stringify(det)}`,
    schema:GATE_SCHEMA,maxTokens:850,temperature:.08,
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
  // Heal legacy/inconsistent persisted projects instead of deadlocking revision.
  if(!p.research){
    p.stage='research';p.lastError='Recovered revision: research package was missing';await saveProject(p);return;
  }
  if(!p.selected){
    p.stage='problem';p.lastError='Recovered revision: selected problem was missing';await saveProject(p);return;
  }
  if(!p.script){
    p.stage='script';p.lastError='Recovered revision: script was missing';await saveProject(p);return;
  }
  const revisionContext=p.gate||{
    passed:false,
    scores:{},
    blockers:[p.lastError||'Factual gate requested revision'],
    revisionNotes:['Remove or strengthen unsupported claims, then repeat fact review.'],
    checks:{},
  };
  const allowed=new Set(p.selected.sourceKeys);
  const sources=p.research.sources.filter(x=>allowed.has(x.key));
  const result=await generateScriptPackage(p,sources,revisionContext);
  p.title=clean(result.metadata.title).slice(0,100);p.description=String(result.metadata.description).trim();p.tags=(result.metadata.tags||p.tags||[]).map(clean).slice(0,12);
  p.thumbnailText=clean(result.metadata.thumbnailText).slice(0,28);p.thumbnailSubtext=clean(result.metadata.thumbnailSubtext).slice(0,36);
  p.script=result.script;p.claimDrafts=result.claims;
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
  const audio=join(tmpdir(),`${key}.wav`),video=join(tmpdir(),`${key}.mp4`),subs=await sceneAss(scene,key);
  try{
    if(p.editorialOrigin==='chatgpt-membership'){
      const preparedAudio=join(process.cwd(),'editorial-packages','audio',p.projectKey,`scene-${String(scene.sceneIndex).padStart(2,'0')}.mp3`);
      try{await copyFile(preparedAudio,audio);}
      catch(e){throw new Error(`Prepared narration asset pending: ${preparedAudio}: ${e instanceof Error?e.message:String(e)}`);}
    }else{
      await synthesizeNeuralSpeech(scene.narration,audio);
    }
    const common=['-map','0:v:0','-map','1:a:0','-r','30','-c:v','libx264','-preset','veryfast','-crf','22','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-af','loudnorm=I=-16:TP=-1.5:LRA=10','-shortest','-movflags','+faststart',video];
    if(scene.visualType==='broll'){
      const source=BROLL[scene.sceneIndex%BROLL.length];
      try{
        await runFfmpeg(['-y','-stream_loop','-1','-ss',String((scene.sceneIndex*3)%12),'-i',source,'-i',audio,'-vf',vf(scene,subs),...common]);
      }catch{
        await runFfmpeg(['-y','-f','lavfi','-i','color=c=0x07111f:s=1920x1080:r=30','-i',audio,'-vf',vf({...scene,visualType:'checklist'},subs),...common]);
      }
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
    const message=(e instanceof Error?e.message:String(e)).slice(0,1000);
    if(message.startsWith('Prepared narration asset pending'))throw e;
    const {id,...record}=candidate;record.status='failed';record.retryCount++;record.lastError=message;record.updatedAt=now();
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
  return advanceProject(p,ctx);
}

async function advanceProject(p:Stored<Project>,ctx:EditorialContext){
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
  const refreshed=(await listProjects(p.userId)).find(x=>x.projectKey===p.projectKey)||p;
  return {status:refreshed.stage,project:refreshed,publishSpec:publishSpec(refreshed)};
}

export async function advanceChatGptEditorial(userId:string,ctx:EditorialContext){
  const project=(await listProjects(userId)).find(item=>item.editorialOrigin==='chatgpt-membership'&&!['queued','published','rejected'].includes(item.stage));
  if(!project)return {status:'idle' as const,project:undefined,publishSpec:undefined};
  return advanceProject(project,ctx);
}

export async function getEditorialStatus(userId:string):Promise<EditorialStatus>{
  const projects=await listProjects(userId);
  if(!projects.length)return {stage:'idle',nextAction:'Create the first professional editorial project.'};
  const active=projects.find(x=>!['queued','published','rejected'].includes(x.stage));const p=active||projects[0];
  const cooldown=!active&&p.stage==='published'&&hoursSince(p.publishedAt||p.updatedAt)<COOLDOWN_HOURS;
  const scenes=p.storyboard?await sceneRecords(userId,p.projectKey):[];
  const actions:Record<string,string>={
    research:'Research official sources and current demand.',problem:'Select a concrete demonstrable problem.',outline:'Design implementation outline.',script:'Write technical script.',fact_review:'Verify material claims.',storyboard:'Create proof-oriented visual plan.',quality_gate:'Apply strict editorial Quality Gate.',revision:'Structurally revise rejected package.',rendering:'Render one neural-narrated scene.',assembly:'Assemble and verify master assets.',ready:'Approved package awaiting queue assignment.',queued:'Approved package queued for a production slot.',published:'Collect performance and start the next editorial cycle.',rejected:'Archive and start a new concept later.'
  };
  return {projectKey:p.projectKey,stage:cooldown?'cooldown':p.stage,title:p.title||p.selected?.workingTitle,problem:p.selected?.problem,revision:p.revision,qualityScore:p.gate?.scores.overall,blockers:p.gate?.blockers.slice(0,5),renderedScenes:scenes.filter(x=>x.status==='rendered').length,totalScenes:p.storyboard?.length,youtubeUrl:p.youtubeUrl,lastError:p.lastError,createdAt:p.createdAt,updatedAt:p.updatedAt,nextAction:cooldown?`Editorial cooldown: one long video every ${COOLDOWN_HOURS}h.`:(actions[p.stage]||'Continue pipeline.')};
}

export async function markQueued(userId:string,projectKey:string){
  const project=(await listProjects(userId)).find(x=>x.projectKey===projectKey);
  if(!project)throw new Error('Editorial project not found');
  if(project.stage==='queued'||project.stage==='published')return;
  if(project.stage!=='ready')throw new Error(`Editorial project is not ready (stage=${project.stage})`);
  project.stage='queued';project.lastError=undefined;await saveProject(project);
}

export async function markPublished(userId:string,projectKey:string,videoId:string,url:string){
  const p=(await listProjects(userId)).find(x=>x.projectKey===projectKey);if(!p)return;
  p.stage='published';p.youtubeVideoId=videoId;p.youtubeUrl=url;p.publishedAt=now();p.lastError=undefined;await saveProject(p);
}
