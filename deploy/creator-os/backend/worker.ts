import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import cron from 'node-cron';
import { db, initPlatform, storage, withLock } from './platform.js';
import { advanceChatGptEditorial, advanceEditorial, importChatGptEditorialPackages, markQueued } from './editorial.js';
import { demandContext, ensurePublishJob, ensureReviewedPublishJob, listJobs, processOnePublishStep, promoteApprovedReviewedJobs, releaseUploadedAssets, repairPublishedDiscoveryMetadata, youtubeConnected } from './youtube.js';
import {ensureTikTokPublishJob,processOneTikTokStep,tiktokMirrorEnabled} from './tiktok.js';
import {validateReviewedMaster} from './master-review.js';

const USER_ID=process.env.OWNER_USER_ID||'owner';
const SCHEDULER_TABLE='scheduler_state_v1';
const AUTO_EDITORIAL=process.env.AUTO_EDITORIAL_ENABLED==='true';
await initPlatform();

type SchedulerState={
  userId:string;editorialFailures:number;nextEditorialAt?:string;lastEditorialAt?:string;
  lastEditorialResult?:string;lastPublisherAt?:string;lastPublisherResult?:string;
  lastMetadataRepairAt?:string;lastMetadataRepairResult?:string;providerConfigRev?:string;updatedAt:string;
};
async function state(){
  const {items}=await db.list<SchedulerState>(SCHEDULER_TABLE,{filter:{userId:USER_ID},limit:1});
  if(items[0])return items[0];
  const record:SchedulerState={userId:USER_ID,editorialFailures:0,updatedAt:new Date().toISOString()};
  const [id]=await db.add(SCHEDULER_TABLE,[record]);return {...record,id};
}
async function saveState(value:Awaited<ReturnType<typeof state>>){
  const {id,...record}=value;record.updatedAt=new Date().toISOString();await db.update(SCHEDULER_TABLE,[{id,record}]);
}

async function importBundledReviewedMasters(){
  const root=join(process.cwd(),'reviewed-masters','bundled');
  let directories:string[]=[];
  try{directories=await readdir(root);}catch{return [];}
  const imported:string[]=[];
  for(const directory of directories){
    try{
      const base=join(root,directory);
      const manifest=JSON.parse(await readFile(join(base,'manifest.json'),'utf8')) as {
        key:string;title:string;description:string;tags:string[];transcript:string;video:string;thumbnail:string;stageOnly?:boolean;
      };
      // A draft remains a draft even if it is accidentally copied into bundled.
      if(manifest.stageOnly === true){
        console.warn(`worker reviewed-master blocked ${directory}: stageOnly`);
        continue;
      }
      const video=await readFile(join(base,'video.mp4'));
      const loadEvidence=async(name:string)=>JSON.parse(await readFile(join(base,name),'utf8'));
      const [review,qa,composition,originality]=await Promise.all([
        loadEvidence('publication-review.json'),loadEvidence('qa-report.json'),
        loadEvidence('composition-report.json'),loadEvidence('originality-report.json'),
      ]);
      const failures=validateReviewedMaster(video,{manifest,review,qa,composition,originality});
      if(failures.length){console.warn(`worker reviewed-master blocked ${directory}: ${failures.join('; ')}`);continue;}
      const thumb=await readFile(join(base,'thumbnail.jpg'));
      const videoPath=`reviewed-masters/${manifest.key}/video.mp4`;
      const thumbPath=`reviewed-masters/${manifest.key}/thumbnail.jpg`;
      const [storedVideo,storedThumb]=await Promise.all([storage.info(videoPath),storage.info(thumbPath)]);
      const missingAssets=[];
      if(!storedVideo)missingAssets.push({path:videoPath,content:video,contentType:'video/mp4'});
      if(!storedThumb)missingAssets.push({path:thumbPath,content:thumb,contentType:'image/jpeg'});
      if(missingAssets.length)await storage.write(missingAssets);
      await ensureReviewedPublishJob(USER_ID,{
        key:manifest.key,title:manifest.title,description:manifest.description,tags:manifest.tags,
        transcript:manifest.transcript,preparedStoragePath:videoPath,thumbnailStoragePath:thumbPath,
      });
      imported.push(manifest.key);
    }catch(error){
      console.error(`worker reviewed-master import ${directory}:`,error);
    }
  }
  return imported;
}

async function editorialCycle(){
  const importedMasters=await importBundledReviewedMasters();
  if(importedMasters.length)console.log(`worker: reviewed-masters=${JSON.stringify(importedMasters)}`);
  const scheduler=await state();
  const packageMode=process.env.CHATGPT_EDITORIAL_PACKAGES_ENABLED!=='false';
  const packageImport=packageMode?await importChatGptEditorialPackages(USER_ID):{imported:[],skipped:[],failed:[]};
  if(packageImport.imported.length||packageImport.failed.length)console.log(`worker: chatgpt-editorial-packages=${JSON.stringify(packageImport)}`);
  if(!AUTO_EDITORIAL&&!packageMode){
    scheduler.lastEditorialAt=new Date().toISOString();scheduler.lastEditorialResult='disabled-quality-protection';
    await saveState(scheduler);return;
  }
  const providerConfigRev=process.env.AI_PROVIDER_CONFIG_REV||'';
  if(providerConfigRev&&scheduler.providerConfigRev!==providerConfigRev){
    console.log(`worker: provider config changed (${scheduler.providerConfigRev||'none'} -> ${providerConfigRev}); clearing editorial backoff`);
    scheduler.providerConfigRev=providerConfigRev;
    scheduler.nextEditorialAt=undefined;
    scheduler.editorialFailures=0;
    await saveState(scheduler);
  }
  if(!AUTO_EDITORIAL&&packageMode&&scheduler.nextEditorialAt){
    scheduler.nextEditorialAt=undefined;scheduler.editorialFailures=0;
    await saveState(scheduler);
  }
  if(scheduler.nextEditorialAt&&Date.now()<new Date(scheduler.nextEditorialAt).getTime()){
    const previous=scheduler.lastEditorialResult||'';
    const nextTs=new Date(scheduler.nextEditorialAt).getTime();
    const lastTs=scheduler.lastEditorialAt?new Date(scheduler.lastEditorialAt).getTime():Date.now();
    const scheduledDelay=Math.max(0,nextTs-lastTs);
    const hardBlock=/\b402\b|insufficient balance|suspended due to insufficient|\b429\b|RESOURCE_EXHAUSTED/i.test(previous);
    const transient=/\b503\b|UNAVAILABLE|high demand|temporar/i.test(previous);
    const inheritedLongTransient=transient&&!hardBlock&&scheduledDelay>90*60_000;
    const fixedStateError=/Revision package missing|Prepared narration asset pending|FFmpeg failed|AI returned invalid JSON/i.test(previous);
    if(inheritedLongTransient||fixedStateError){
      console.log(`worker: clearing recoverable editorial backoff scheduled for ${scheduler.nextEditorialAt}`);
      scheduler.nextEditorialAt=undefined;
      await saveState(scheduler);
    }else return;
  }
  try{
    const context=await demandContext(USER_ID);
    const step=AUTO_EDITORIAL?await advanceEditorial(USER_ID,context):await advanceChatGptEditorial(USER_ID,context);
    if(step.status==='idle'){
      scheduler.editorialFailures=0;scheduler.nextEditorialAt=undefined;
      scheduler.lastEditorialAt=new Date().toISOString();scheduler.lastEditorialResult='membership-package-idle';
      await saveState(scheduler);return;
    }
    await ensurePublishJob(USER_ID,step.publishSpec);
    await ensureTikTokPublishJob(USER_ID,step.publishSpec);
    if(step.status==='ready'&&step.project?.projectKey)await markQueued(USER_ID,step.project.projectKey);
    scheduler.editorialFailures=0;scheduler.nextEditorialAt=undefined;
    scheduler.lastEditorialAt=new Date().toISOString();scheduler.lastEditorialResult=step.status;
    await saveState(scheduler);console.log(`worker: editorial=${step.status} detail=${JSON.stringify({projectKey:step.project?.projectKey,revision:step.project?.revision,qualityScore:step.project?.gate?.scores?.overall,blockers:step.project?.gate?.blockers?.slice(0,4),lastError:step.project?.lastError}).slice(0,1200)}`);
  }catch(error){
    scheduler.editorialFailures=(scheduler.editorialFailures||0)+1;
    const message=error instanceof Error?error.message:String(error);
    const billingBlocked=/\b402\b|insufficient balance|suspended due to insufficient/i.test(message);
    const quotaBlocked=/\b429\b|RESOURCE_EXHAUSTED/i.test(message);
    const transient=/\b503\b|UNAVAILABLE|high demand|temporar/i.test(message);
    const retryMatch=message.match(/retry-after=(\d+)/i)||message.match(/retry in\s+(\d+)m(?:in)?\s*(\d+)?s?/i);
    let quotaDelay=5*60_000;
    if(retryMatch){
      if(/retry-after=/i.test(retryMatch[0]))quotaDelay=Math.max(60_000,Math.min(30*60_000,Number(retryMatch[1])*1000));
      else quotaDelay=Math.max(60_000,Math.min(30*60_000,(Number(retryMatch[1])*60+Number(retryMatch[2]||0))*1000));
    }
    const delay=billingBlocked?6*60*60_000:quotaBlocked?quotaDelay:transient?5*60_000:
      Math.min(30*60_000,3*60_000*2**Math.min(4,scheduler.editorialFailures-1));
    scheduler.nextEditorialAt=new Date(Date.now()+delay).toISOString();scheduler.lastEditorialAt=new Date().toISOString();
    scheduler.lastEditorialResult=`failed: ${message.slice(0,500)}`;await saveState(scheduler);throw error;
  }
}
async function publishCycle(){
  const [youtube,tiktok]=await Promise.allSettled([
    youtubeConnected(USER_ID).then(connected=>connected?processOnePublishStep(USER_ID):{status:'not-connected'}),
    tiktokMirrorEnabled()?processOneTikTokStep(USER_ID):Promise.resolve({status:'disabled'}),
  ]);
  console.log(`worker: youtube=${JSON.stringify(youtube.status==='fulfilled'?youtube.value:{status:'failed',error:String(youtube.reason)})}`);
  console.log(`worker: tiktok=${JSON.stringify(tiktok.status==='fulfilled'?tiktok.value:{status:'failed',error:String(tiktok.reason)})}`);
  const queue=await listJobs(USER_ID);
  const queueHealth={total:queue.length,pending:queue.filter(x=>x.status==='pending').length,uploading:queue.filter(x=>x.status==='uploading').length,failed:queue.filter(x=>x.status==='failed').length,public:queue.filter(x=>x.status==='published'&&x.privacyStatus==='public').length,recentFailures:queue.filter(x=>x.status==='failed').slice(0,3).map(x=>({key:x.automationKey,error:(x.lastError||'unknown').slice(0,180)}))};
  console.log(`worker: queue=${JSON.stringify(queueHealth)}`);
  const promoted=await promoteApprovedReviewedJobs(USER_ID);
  if(promoted.length)console.log(`worker: promoted=${JSON.stringify(promoted)}`);
  const released=await releaseUploadedAssets(USER_ID);
  if(released.length)console.log(`worker: released-upload-assets=${JSON.stringify(released)}`);
  const scheduler=await state();scheduler.lastPublisherAt=new Date().toISOString();
  scheduler.lastPublisherResult=JSON.stringify(youtube.status==='fulfilled'?youtube.value:{status:'failed',error:String(youtube.reason)}).slice(0,700);
  await saveState(scheduler);
}
async function metadataRepairCycle(){
  if(!await youtubeConnected(USER_ID))return;
  const result=await repairPublishedDiscoveryMetadata(USER_ID);
  const scheduler=await state();scheduler.lastMetadataRepairAt=new Date().toISOString();
  scheduler.lastMetadataRepairResult=JSON.stringify(result).slice(0,1000);await saveState(scheduler);
  console.log(`worker: metadata-repair=${JSON.stringify(result)}`);
}
async function guarded(name:string,fn:()=>Promise<unknown>){
  try{await withLock(`automationopsai:${name}`,fn);}
  catch(e){console.error(`worker ${name}:`,e);}
}

const TIMEZONE=process.env.SCHEDULE_TIMEZONE||'America/Mexico_City';
cron.schedule('* * * * *',()=>void guarded('editorial',editorialCycle),{timezone:TIMEZONE});
cron.schedule('* * * * *',()=>void guarded('publisher',publishCycle),{timezone:TIMEZONE});
cron.schedule('30 4 * * *',()=>void guarded('metadata-repair',metadataRepairCycle),{timezone:TIMEZONE});

const EDITORIAL_MODE=AUTO_EDITORIAL?'internal+membership':process.env.CHATGPT_EDITORIAL_PACKAGES_ENABLED!=='false'?'membership-packages-only':'reviewed-masters-only';
console.log(`AutomationOpsAI worker started: editorial=${EDITORIAL_MODE}; publisher=1min; timezone=${TIMEZONE}; production slots=06:00 short, 11:00 standard, 15:00 short, 22:00 short`);
void guarded('startup-editorial',editorialCycle);
void guarded('startup-publisher',publishCycle);
void guarded('startup-metadata-repair',metadataRepairCycle);
