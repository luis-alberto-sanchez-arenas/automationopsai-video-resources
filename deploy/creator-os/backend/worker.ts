import cron from 'node-cron';
import { db, initPlatform, withLock } from './platform.js';
import { advanceEditorial } from './editorial.js';
import { demandContext, ensurePublishJob, processOnePublishStep, promoteApprovedReviewedJobs, youtubeConnected } from './youtube.js';
import {ensureTikTokPublishJob,processOneTikTokStep,tiktokMirrorEnabled} from './tiktok.js';

const USER_ID=process.env.OWNER_USER_ID||'owner';
const SCHEDULER_TABLE='scheduler_state_v1';
const AUTO_EDITORIAL=process.env.AUTO_EDITORIAL_ENABLED==='true';
await initPlatform();

type SchedulerState={
  userId:string;editorialFailures:number;nextEditorialAt?:string;lastEditorialAt?:string;
  lastEditorialResult?:string;lastPublisherAt?:string;lastPublisherResult?:string;updatedAt:string;
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

async function editorialCycle(){
  const scheduler=await state();
  if(!AUTO_EDITORIAL){
    scheduler.lastEditorialAt=new Date().toISOString();scheduler.lastEditorialResult='disabled-quality-protection';
    await saveState(scheduler);return;
  }
  if(scheduler.nextEditorialAt&&Date.now()<new Date(scheduler.nextEditorialAt).getTime())return;
  if(!await youtubeConnected(USER_ID)){
    scheduler.lastEditorialAt=new Date().toISOString();scheduler.lastEditorialResult='waiting-youtube-oauth';
    scheduler.nextEditorialAt=new Date(Date.now()+60*60_000).toISOString();await saveState(scheduler);
    console.log('worker: waiting for YouTube OAuth');
    return;
  }
  try{
    const context=await demandContext(USER_ID);
    const step=await advanceEditorial(USER_ID,context);
    await ensurePublishJob(USER_ID,step.publishSpec);
    await ensureTikTokPublishJob(USER_ID,step.publishSpec);
    scheduler.editorialFailures=0;scheduler.nextEditorialAt=undefined;
    scheduler.lastEditorialAt=new Date().toISOString();scheduler.lastEditorialResult=step.status;
    await saveState(scheduler);console.log(`worker: editorial=${step.status}`);
  }catch(error){
    scheduler.editorialFailures=(scheduler.editorialFailures||0)+1;
    const message=error instanceof Error?error.message:String(error);
    const providerBlocked=/All configured AI providers failed|\b402\b|\b429\b|RESOURCE_EXHAUSTED|insufficient balance/i.test(message);
    const delay=providerBlocked?6*60*60_000:Math.min(6*60*60_000,15*60_000*2**Math.min(5,scheduler.editorialFailures-1));
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
  const promoted=await promoteApprovedReviewedJobs(USER_ID);
  if(promoted.length)console.log(`worker: promoted=${JSON.stringify(promoted)}`);
  const scheduler=await state();scheduler.lastPublisherAt=new Date().toISOString();
  scheduler.lastPublisherResult=JSON.stringify(youtube.status==='fulfilled'?youtube.value:{status:'failed',error:String(youtube.reason)}).slice(0,700);
  await saveState(scheduler);
}
async function guarded(name:string,fn:()=>Promise<unknown>){
  try{await withLock(`automationopsai:${name}`,fn);}
  catch(e){console.error(`worker ${name}:`,e);}
}

const TIMEZONE=process.env.SCHEDULE_TIMEZONE||'America/Mexico_City';
cron.schedule('*/5 * * * *',()=>void guarded('editorial',editorialCycle),{timezone:TIMEZONE});
cron.schedule('* * * * *',()=>void guarded('publisher',publishCycle),{timezone:TIMEZONE});

console.log(`AutomationOpsAI worker started: editorial=${AUTO_EDITORIAL?'enabled/5min':'disabled-quality-protection'}; publisher=1min; timezone=${TIMEZONE}; external production slots=06:00 short, 11:00 standard, 15:00 short, 22:00 short`);
if(AUTO_EDITORIAL)void guarded('startup-editorial',editorialCycle);
void guarded('startup-publisher',publishCycle);
